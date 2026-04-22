from __future__ import annotations

import asyncio
import json
import math
import re
import time
from base64 import b64encode
from collections import defaultdict
from dataclasses import asdict, dataclass
from io import BytesIO
from pathlib import Path
from typing import Literal, Protocol

import httpx
from PIL import Image

from campus_ingestion_core.object_store import (
    build_raw_asset_key,
    build_source_provider_artifact_key,
    build_source_truth_artifact_key,
)

CURRICULUM_COURSE_MAP_PROBE_SCHEMA_VERSION = "curriculum_course_map_multimodal_probe_v2"
CURRICULUM_COURSE_MAP_SAMPLE_MANIFEST_VERSION = "curriculum_course_map_probe_samples_v1"
CURRICULUM_COURSE_MAP_GOLD_MANIFEST_VERSION = "curriculum_course_map_probe_gold_v2"
DEFAULT_CURRICULUM_RAW_ASSET_ID = "asset:curriculum-plan-2022"
DEFAULT_CURRICULUM_RAW_VERSION_ID = (
    "sha256:0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67"
)
DEFAULT_CURRICULUM_YEAR = "2022"
DEFAULT_OCR_MODEL_SLUG = "paddleocr-vl-1-5"
DEFAULT_RENDER_DPI = 180
DEFAULT_PROMPT_RUNTIME_BASE_URL = "https://api.openai.com/v1"
DEFAULT_PROMPT_RUNTIME_TRANSPORT = "responses"
DEFAULT_MAX_INFLIGHT_PAGES = 3
DEFAULT_MAX_REQUEST_ATTEMPTS = 3
DEFAULT_PROMPT_RUNTIME_CONNECT_TIMEOUT_SECONDS = 10.0
DEFAULT_PROMPT_RUNTIME_READ_TIMEOUT_SECONDS = 60.0
DEFAULT_PROMPT_RUNTIME_WRITE_TIMEOUT_SECONDS = 10.0
DEFAULT_PROMPT_RUNTIME_POOL_TIMEOUT_SECONDS = 3.0
DEFAULT_SAMPLE_MANIFEST_PATH = Path(
    "configs/ingestion/curriculum/curriculum_plan/course-map-probe-samples.v1.json"
)
DEFAULT_GOLD_MANIFEST_PATH = Path(
    "configs/ingestion/curriculum/curriculum_plan/course-map-probe-gold.v2.json"
)
DEFAULT_SPLIT_MANIFEST_PATH = Path(
    "configs/ingestion/curriculum/curriculum_plan/split-manifest.v1.json"
)
DEFAULT_PROMPT_RUNS = 3
DEFAULT_REPEATABILITY_THRESHOLD = 0.78
DEFAULT_GOLD_PASS_RATE_THRESHOLD = 0.66
DEFAULT_REPEATABILITY_PASS_RATE_THRESHOLD = 0.75
DEFAULT_REGION_TILE_ROWS = 2
DEFAULT_REGION_TILE_COLS = 2
DEFAULT_TILE_OVERLAP_RATIO = 0.06
TitleConfidence = Literal["visible", "partial", "absent"]
PromptRuntimeTransport = Literal["responses", "chat_completions"]
_WHITESPACE_RE = re.compile(r"\s+")
_DASH_RE = re.compile(r"[—–－-]+")
_COURSE_MAP_HINT_RE = re.compile(r"(课程地图|拓扑图|拓补图|课程结构图|结果拓扑图)")
_DEFAULT_TIMEOUT = httpx.Timeout(
    connect=DEFAULT_PROMPT_RUNTIME_CONNECT_TIMEOUT_SECONDS,
    read=DEFAULT_PROMPT_RUNTIME_READ_TIMEOUT_SECONDS,
    write=DEFAULT_PROMPT_RUNTIME_WRITE_TIMEOUT_SECONDS,
    pool=DEFAULT_PROMPT_RUNTIME_POOL_TIMEOUT_SECONDS,
)
_NORMALIZE_TRANSLATION = str.maketrans(
    {
        "（": "(",
        "）": ")",
        "，": ",",
        "：": ":",
        "“": "",
        "”": "",
        "‘": "",
        "’": "",
        "、": "",
        "·": "",
    }
)


class ObjectStoreByteReader(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class CurriculumCourseMapInventoryEntry:
    document_id: str
    document_title: str
    page_number: int
    row_id: str
    parent_heading_hint: str
    bbox_provider: tuple[float, float, float, float]
    provider_page_height: float
    raw_asset_id: str
    raw_version_id: str
    source_pdf_key: str
    provider_response_key: str
    layout_elements_key: str

    def __post_init__(self) -> None:
        if not self.document_id.strip():
            raise ValueError("document_id is required")
        if not self.document_title.strip():
            raise ValueError("document_title is required")
        if self.page_number <= 0:
            raise ValueError("page_number must be greater than zero")
        if not self.row_id.strip():
            raise ValueError("row_id is required")
        if len(self.bbox_provider) != 4:
            raise ValueError("bbox_provider must contain four numbers")
        if self.provider_page_height <= 0:
            raise ValueError("provider_page_height must be greater than zero")


@dataclass(frozen=True, slots=True)
class CurriculumCourseMapSampleSelection:
    sample_id: str
    page_number: int
    document_id: str
    document_title: str

    def __post_init__(self) -> None:
        if not self.sample_id.strip():
            raise ValueError("sample_id is required")
        if self.page_number <= 0:
            raise ValueError("page_number must be greater than zero")
        if not self.document_id.strip():
            raise ValueError("document_id is required")
        if not self.document_title.strip():
            raise ValueError("document_title is required")


@dataclass(frozen=True, slots=True)
class CurriculumCourseMapGoldMapExpectation:
    map_index: int
    expected_title: str | None
    title_required: bool
    expected_node_labels: tuple[str, ...]
    expected_edges: tuple[tuple[str, str], ...]
    min_node_recall: float = 0.6
    min_edge_recall: float = 0.5

    def __post_init__(self) -> None:
        if self.map_index <= 0:
            raise ValueError("map_index must be greater than zero")
        if self.title_required and not (self.expected_title or "").strip():
            raise ValueError("expected_title is required when title_required is true")


@dataclass(frozen=True, slots=True)
class CurriculumCourseMapGoldExpectation:
    page_number: int
    document_id: str
    document_title: str
    expected_maps: tuple[CurriculumCourseMapGoldMapExpectation, ...]
    min_map_detection_recall: float = 1.0
    min_slot_pass_rate: float = 1.0

    def __post_init__(self) -> None:
        if self.page_number <= 0:
            raise ValueError("page_number must be greater than zero")
        if not self.document_id.strip():
            raise ValueError("document_id is required")
        if not self.document_title.strip():
            raise ValueError("document_title is required")
        if not self.expected_maps:
            raise ValueError("expected_maps must contain at least one map slot")


@dataclass(frozen=True, slots=True)
class CurriculumCourseMapRenderedSample:
    sample_id: str
    page_number: int
    document_id: str
    document_title: str
    row_id: str
    parent_heading_hint: str
    provider_bbox: tuple[float, float, float, float]
    provider_canvas: tuple[float, float]
    pdf_bbox: tuple[float, float, float, float]
    full_page_png: bytes
    crop_png: bytes
    full_page_image_path: str | None = None
    crop_image_path: str | None = None


@dataclass(frozen=True, slots=True)
class DetectedCourseMapRegion:
    map_index: int
    map_title: str | None
    title_confidence: TitleConfidence
    region_bbox_normalized: tuple[float, float, float, float]
    region_bbox_pdf: tuple[float, float, float, float]
    region_bbox_provider: tuple[float, float, float, float]
    manual_review_notes: tuple[str, ...]

    def __post_init__(self) -> None:
        if self.map_index <= 0:
            raise ValueError("map_index must be greater than zero")
        if len(self.region_bbox_normalized) != 4:
            raise ValueError("region_bbox_normalized must contain four numbers")
        if self.title_confidence not in {"visible", "partial", "absent"}:
            raise ValueError("unsupported title_confidence")


@dataclass(frozen=True, slots=True)
class CurriculumCourseMapRenderedRegion:
    detected_region: DetectedCourseMapRegion
    crop_png: bytes
    tile_pngs: tuple[bytes, ...]
    crop_image_path: str | None = None
    tile_image_paths: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class CourseMapNode:
    node_label: str
    stage_label: str = ""
    category_label: str = ""

    def __post_init__(self) -> None:
        if not self.node_label.strip():
            raise ValueError("node_label is required")


@dataclass(frozen=True, slots=True)
class CourseMapEdge:
    source_label: str
    target_label: str

    def __post_init__(self) -> None:
        if not self.source_label.strip():
            raise ValueError("source_label is required")
        if not self.target_label.strip():
            raise ValueError("target_label is required")


@dataclass(frozen=True, slots=True)
class CourseMapFinding:
    map_index: int
    map_title: str | None
    stage_labels: tuple[str, ...]
    nodes: tuple[CourseMapNode, ...]
    edges: tuple[CourseMapEdge, ...]
    manual_review_notes: tuple[str, ...]

    def __post_init__(self) -> None:
        if self.map_index <= 0:
            raise ValueError("map_index must be greater than zero")


@dataclass(frozen=True, slots=True)
class CurriculumCourseMapPageProbe:
    sample_id: str
    page_number: int
    document_id: str
    document_title: str
    parent_heading_hint: str
    detected_maps: tuple[DetectedCourseMapRegion, ...]
    course_maps: tuple[CourseMapFinding, ...]
    manual_review_required: bool
    global_manual_review_notes: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.sample_id.strip():
            raise ValueError("sample_id is required")
        if self.page_number <= 0:
            raise ValueError("page_number must be greater than zero")
        if not self.document_id.strip():
            raise ValueError("document_id is required")
        if not self.document_title.strip():
            raise ValueError("document_title is required")


@dataclass(frozen=True, slots=True)
class CurriculumCourseMapProbeRun:
    run_index: int
    pages: tuple[CurriculumCourseMapPageProbe, ...]


@dataclass(frozen=True, slots=True)
class CurriculumCourseMapRepeatabilityPageScore:
    page_number: int
    document_id: str
    compared_run_pairs: int
    title_jaccard: float
    node_jaccard: float
    edge_jaccard: float
    map_count_agreement: float
    overall_score: float
    passed: bool


@dataclass(frozen=True, slots=True)
class CurriculumCourseMapRepeatabilityReport:
    schema_version: str
    threshold: float
    page_scores: tuple[CurriculumCourseMapRepeatabilityPageScore, ...]
    pass_rate: float
    overall_score: float


@dataclass(frozen=True, slots=True)
class CurriculumCourseMapGoldPageScore:
    page_number: int
    document_id: str
    map_detection_recall: float
    slot_pass_rate: float
    title_recall: float
    node_recall: float
    edge_recall: float
    stable_titles: tuple[str, ...]
    stable_nodes: tuple[str, ...]
    stable_edges: tuple[tuple[str, str], ...]
    passed: bool


@dataclass(frozen=True, slots=True)
class CurriculumCourseMapGoldReport:
    schema_version: str
    page_scores: tuple[CurriculumCourseMapGoldPageScore, ...]
    pass_rate: float


@dataclass(frozen=True, slots=True)
class CurriculumCourseMapAdmissionSummary:
    schema_version: str
    recommendation: str
    repeatability_pass_rate: float
    gold_pass_rate: float
    repeatability_overall_score: float
    reasons: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class CurriculumCourseMapProbeReport:
    schema_version: str
    source_bucket: str
    raw_asset_id: str
    raw_version_id: str
    source_pdf_key: str
    provider_response_key: str
    layout_elements_key: str
    inventory_count: int
    selected_sample_count: int
    sample_ids: tuple[str, ...]
    run_count: int
    output_dir: str | None
    runs: tuple[CurriculumCourseMapProbeRun, ...]
    repeatability: CurriculumCourseMapRepeatabilityReport
    gold: CurriculumCourseMapGoldReport
    admission: CurriculumCourseMapAdmissionSummary


def default_curriculum_source_pdf_key() -> str:
    return build_raw_asset_key(
        corpus="curriculum",
        raw_asset_id=DEFAULT_CURRICULUM_RAW_ASSET_ID,
        raw_version_id=DEFAULT_CURRICULUM_RAW_VERSION_ID,
        filename="curriculum-plan-2022.pdf",
        year=DEFAULT_CURRICULUM_YEAR,
    )


def default_curriculum_provider_response_key() -> str:
    return build_source_provider_artifact_key(
        raw_asset_id=DEFAULT_CURRICULUM_RAW_ASSET_ID,
        raw_version_id=DEFAULT_CURRICULUM_RAW_VERSION_ID,
        filename="provider-response.jsonl",
        year=DEFAULT_CURRICULUM_YEAR,
        model_slug=DEFAULT_OCR_MODEL_SLUG,
    )


def default_curriculum_layout_elements_key() -> str:
    return build_source_truth_artifact_key(
        raw_asset_id=DEFAULT_CURRICULUM_RAW_ASSET_ID,
        raw_version_id=DEFAULT_CURRICULUM_RAW_VERSION_ID,
        filename="layout-elements.jsonl",
        year=DEFAULT_CURRICULUM_YEAR,
    )


def run_curriculum_course_map_multimodal_probe(
    *,
    source: dict[str, str],
    source_bucket: str,
    split_manifest_path: Path = DEFAULT_SPLIT_MANIFEST_PATH,
    sample_manifest_path: Path = DEFAULT_SAMPLE_MANIFEST_PATH,
    gold_manifest_path: Path = DEFAULT_GOLD_MANIFEST_PATH,
    object_store: ObjectStoreByteReader | None = None,
    pdf_bytes: bytes | None = None,
    provider_response_bytes: bytes | None = None,
    layout_elements_bytes: bytes | None = None,
    source_pdf_key: str = default_curriculum_source_pdf_key(),
    provider_response_key: str = default_curriculum_provider_response_key(),
    layout_elements_key: str = default_curriculum_layout_elements_key(),
    output_dir: Path | None = None,
    prompt_runs: int = DEFAULT_PROMPT_RUNS,
    repeatability_threshold: float = DEFAULT_REPEATABILITY_THRESHOLD,
    prompt_transport: str | None = None,
    max_inflight_pages: int = DEFAULT_MAX_INFLIGHT_PAGES,
    max_request_attempts: int = DEFAULT_MAX_REQUEST_ATTEMPTS,
    resume: bool = False,
) -> CurriculumCourseMapProbeReport:
    if prompt_runs <= 0:
        raise ValueError("prompt_runs must be greater than zero")
    if max_inflight_pages <= 0:
        raise ValueError("max_inflight_pages must be greater than zero")
    if max_request_attempts <= 0:
        raise ValueError("max_request_attempts must be greater than zero")
    if resume and output_dir is None:
        raise ValueError("output_dir is required when resume is enabled")
    runtime_object_store = object_store
    if runtime_object_store is None and (
        pdf_bytes is None or provider_response_bytes is None or layout_elements_bytes is None
    ):
        from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
        from campus_ingestion_core.settings import ObjectStoreSettings

        runtime_object_store = S3ObjectStoreAdmin(ObjectStoreSettings.from_env(source))
    if pdf_bytes is None:
        if runtime_object_store is None:
            raise ValueError("object_store is required when pdf_bytes is not provided")
        pdf_bytes = runtime_object_store.get_bytes(bucket=source_bucket, key=source_pdf_key)
    if provider_response_bytes is None:
        if runtime_object_store is None:
            raise ValueError(
                "object_store is required when provider_response_bytes is not provided"
            )
        provider_response_bytes = runtime_object_store.get_bytes(
            bucket=source_bucket,
            key=provider_response_key,
        )
    if layout_elements_bytes is None:
        if runtime_object_store is None:
            raise ValueError("object_store is required when layout_elements_bytes is not provided")
        layout_elements_bytes = runtime_object_store.get_bytes(
            bucket=source_bucket,
            key=layout_elements_key,
        )

    inventory = build_curriculum_course_map_inventory(
        split_manifest_bytes=Path(split_manifest_path).read_bytes(),
        provider_response_bytes=provider_response_bytes,
        layout_elements_bytes=layout_elements_bytes,
        source_pdf_key=source_pdf_key,
        provider_response_key=provider_response_key,
        layout_elements_key=layout_elements_key,
        raw_asset_id=DEFAULT_CURRICULUM_RAW_ASSET_ID,
        raw_version_id=DEFAULT_CURRICULUM_RAW_VERSION_ID,
    )
    sample_manifest = load_curriculum_course_map_sample_manifest(Path(sample_manifest_path))
    gold_manifest = load_curriculum_course_map_gold_manifest(Path(gold_manifest_path))
    resolved_prompt_transport = _normalize_prompt_runtime_transport(
        prompt_transport
        or source.get("PROMPT_RUNTIME_TRANSPORT")
        or DEFAULT_PROMPT_RUNTIME_TRANSPORT
    )
    selected_entries = select_curriculum_course_map_samples(
        inventory=inventory,
        sample_manifest=sample_manifest,
    )
    render_dir = None if output_dir is None else Path(output_dir) / "renders"
    rendered_samples = tuple(
        render_curriculum_course_map_sample(
            pdf_bytes=pdf_bytes,
            entry=entry,
            sample_id=selection.sample_id,
            output_dir=render_dir,
        )
        for selection, entry in selected_entries
    )
    if output_dir is not None:
        output_path = Path(output_dir)
        output_path.mkdir(parents=True, exist_ok=True)
        probe_config = _build_probe_config(
            prompt_transport=resolved_prompt_transport,
            prompt_runs=prompt_runs,
            max_inflight_pages=max_inflight_pages,
            max_request_attempts=max_request_attempts,
            source_bucket=source_bucket,
            source_pdf_key=source_pdf_key,
            provider_response_key=provider_response_key,
            layout_elements_key=layout_elements_key,
            split_manifest_path=Path(split_manifest_path),
            sample_manifest_path=Path(sample_manifest_path),
            gold_manifest_path=Path(gold_manifest_path),
        )
        if resume:
            _validate_resume_probe_config(output_path=output_path, expected=probe_config)
        else:
            _write_json(output_path / "probe-config.json", probe_config)
        _write_json(output_path / "inventory.json", [asdict(item) for item in inventory])
        _write_json(
            output_path / "selected-samples.json",
            [
                {"selection": asdict(selection), "inventory": asdict(entry)}
                for selection, entry in selected_entries
            ],
        )
    runs = asyncio.run(
        _run_curriculum_course_map_probe_runs_async(
            source=source,
            rendered_samples=rendered_samples,
            output_dir=Path(output_dir) if output_dir is not None else None,
            prompt_runs=prompt_runs,
            prompt_transport=resolved_prompt_transport,
            max_inflight_pages=max_inflight_pages,
            max_request_attempts=max_request_attempts,
            resume=resume,
        )
    )
    repeatability = build_curriculum_course_map_repeatability_report(
        runs=runs,
        threshold=repeatability_threshold,
    )
    gold = build_curriculum_course_map_gold_report(runs=runs, gold_manifest=gold_manifest)
    admission = build_curriculum_course_map_admission_summary(
        repeatability=repeatability,
        gold=gold,
    )
    report = CurriculumCourseMapProbeReport(
        schema_version=CURRICULUM_COURSE_MAP_PROBE_SCHEMA_VERSION,
        source_bucket=source_bucket,
        raw_asset_id=DEFAULT_CURRICULUM_RAW_ASSET_ID,
        raw_version_id=DEFAULT_CURRICULUM_RAW_VERSION_ID,
        source_pdf_key=source_pdf_key,
        provider_response_key=provider_response_key,
        layout_elements_key=layout_elements_key,
        inventory_count=len(inventory),
        selected_sample_count=len(selected_entries),
        sample_ids=tuple(selection.sample_id for selection, _ in selected_entries),
        run_count=len(runs),
        output_dir=str(Path(output_dir).resolve()) if output_dir is not None else None,
        runs=runs,
        repeatability=repeatability,
        gold=gold,
        admission=admission,
    )
    if output_dir is not None:
        output_path = Path(output_dir)
        _write_json(output_path / "runs.json", [asdict(item) for item in runs])
        _write_json(output_path / "repeatability.json", asdict(repeatability))
        _write_json(output_path / "gold.json", asdict(gold))
        _write_json(output_path / "admission-summary.json", asdict(admission))
        _write_json(output_path / "probe-report.json", asdict(report))
    return report


def build_curriculum_course_map_inventory(
    *,
    split_manifest_bytes: bytes,
    provider_response_bytes: bytes,
    layout_elements_bytes: bytes,
    source_pdf_key: str,
    provider_response_key: str,
    layout_elements_key: str,
    raw_asset_id: str,
    raw_version_id: str,
) -> tuple[CurriculumCourseMapInventoryEntry, ...]:
    document_ranges = _load_split_manifest_document_ranges(split_manifest_bytes)
    provider_page_heights = load_provider_page_heights(provider_response_bytes)
    inventory: list[CurriculumCourseMapInventoryEntry] = []
    for row in _load_jsonl_bytes(layout_elements_bytes):
        if str(row.get("row_type") or "").strip() != "image":
            continue
        page_number = int(row.get("page_start") or 0)
        if page_number <= 0:
            raise ValueError("course-map image row missing page_start")
        owner = _resolve_document_for_page(document_ranges=document_ranges, page_number=page_number)
        if owner is None:
            continue
        parent_heading_hint = str(row.get("parent_heading_hint") or "").strip()
        if not _is_curriculum_course_map_candidate(parent_heading_hint):
            continue
        owner_document_id, owner_document_title = owner
        provider_page_height = float(provider_page_heights.get(page_number) or 0.0)
        if provider_page_height <= 0:
            raise ValueError(f"missing provider page height for page {page_number}")
        inventory.append(
            CurriculumCourseMapInventoryEntry(
                document_id=owner_document_id,
                document_title=owner_document_title,
                page_number=page_number,
                row_id=str(row.get("row_id") or "").strip(),
                parent_heading_hint=parent_heading_hint,
                bbox_provider=_coerce_bbox(row.get("bbox")),
                provider_page_height=provider_page_height,
                raw_asset_id=raw_asset_id,
                raw_version_id=raw_version_id,
                source_pdf_key=source_pdf_key,
                provider_response_key=provider_response_key,
                layout_elements_key=layout_elements_key,
            )
        )
    return tuple(sorted(inventory, key=lambda item: (item.page_number, item.row_id)))


def load_provider_page_heights(provider_response_bytes: bytes) -> dict[int, float]:
    heights: dict[int, float] = {}
    page_number = 0
    for line in provider_response_bytes.decode("utf-8").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        payload = json.loads(stripped)
        results = ((payload.get("result") or {}).get("layoutParsingResults")) or []
        for item in results:
            if not isinstance(item, dict):
                continue
            pruned = item.get("prunedResult") or {}
            page_number += 1
            height = float(pruned.get("height") or 0.0)
            if height <= 0:
                raise ValueError(f"provider page {page_number} missing positive height")
            heights[page_number] = height
    if not heights:
        raise ValueError("provider-response payload does not contain any page heights")
    return heights


def load_curriculum_course_map_sample_manifest(
    path: Path,
) -> tuple[CurriculumCourseMapSampleSelection, ...]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if (
        str(payload.get("manifest_version") or "").strip()
        != CURRICULUM_COURSE_MAP_SAMPLE_MANIFEST_VERSION
    ):
        raise ValueError("unsupported curriculum course-map sample manifest version")
    selections = tuple(
        CurriculumCourseMapSampleSelection(
            sample_id=str(item.get("sample_id") or "").strip(),
            page_number=int(item.get("page_number") or 0),
            document_id=str(item.get("document_id") or "").strip(),
            document_title=str(item.get("document_title") or "").strip(),
        )
        for item in payload.get("entries") or ()
    )
    if not selections:
        raise ValueError("course-map sample manifest must contain at least one entry")
    return selections


def load_curriculum_course_map_gold_manifest(
    path: Path,
) -> tuple[CurriculumCourseMapGoldExpectation, ...]:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if (
        str(payload.get("manifest_version") or "").strip()
        != CURRICULUM_COURSE_MAP_GOLD_MANIFEST_VERSION
    ):
        raise ValueError("unsupported curriculum course-map gold manifest version")
    expectations = tuple(
        CurriculumCourseMapGoldExpectation(
            page_number=int(item.get("page_number") or 0),
            document_id=str(item.get("document_id") or "").strip(),
            document_title=str(item.get("document_title") or "").strip(),
            expected_maps=tuple(
                CurriculumCourseMapGoldMapExpectation(
                    map_index=int(slot.get("map_index") or 0),
                    expected_title=(
                        str(slot["expected_title"]).strip()
                        if slot.get("expected_title") is not None
                        else None
                    ),
                    title_required=bool(slot.get("title_required", False)),
                    expected_node_labels=tuple(
                        str(value).strip() for value in slot.get("expected_node_labels") or ()
                    ),
                    expected_edges=tuple(
                        (str(edge[0]).strip(), str(edge[1]).strip())
                        for edge in slot.get("expected_edges") or ()
                    ),
                    min_node_recall=float(slot.get("min_node_recall") or 0.6),
                    min_edge_recall=float(slot.get("min_edge_recall") or 0.5),
                )
                for slot in item.get("expected_maps") or ()
            ),
            min_map_detection_recall=float(item.get("min_map_detection_recall") or 1.0),
            min_slot_pass_rate=float(item.get("min_slot_pass_rate") or 1.0),
        )
        for item in payload.get("entries") or ()
    )
    if not expectations:
        raise ValueError("course-map gold manifest must contain at least one entry")
    return expectations


def select_curriculum_course_map_samples(
    *,
    inventory: tuple[CurriculumCourseMapInventoryEntry, ...],
    sample_manifest: tuple[CurriculumCourseMapSampleSelection, ...],
) -> tuple[tuple[CurriculumCourseMapSampleSelection, CurriculumCourseMapInventoryEntry], ...]:
    inventory_by_page: dict[int, list[CurriculumCourseMapInventoryEntry]] = defaultdict(list)
    for entry in inventory:
        inventory_by_page[entry.page_number].append(entry)
    selected: list[
        tuple[CurriculumCourseMapSampleSelection, CurriculumCourseMapInventoryEntry]
    ] = []
    for selection in sample_manifest:
        candidates = inventory_by_page.get(selection.page_number) or []
        match = next(
            (
                candidate
                for candidate in candidates
                if candidate.document_id == selection.document_id
                and candidate.document_title == selection.document_title
            ),
            None,
        )
        if match is None:
            raise ValueError(
                f"sample page {selection.page_number} / {selection.document_id} not found in course-map inventory"
            )
        selected.append((selection, match))
    return tuple(selected)


def render_curriculum_course_map_sample(
    *,
    pdf_bytes: bytes,
    entry: CurriculumCourseMapInventoryEntry,
    sample_id: str,
    output_dir: Path | None = None,
) -> CurriculumCourseMapRenderedSample:
    try:
        import fitz
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("pymupdf is required for curriculum course-map rendering") from exc

    with fitz.open(stream=pdf_bytes, filetype="pdf") as document:
        if entry.page_number > document.page_count:
            raise ValueError(
                f"page {entry.page_number} exceeds PDF page_count {document.page_count}"
            )
        page = document.load_page(entry.page_number - 1)
        page_rect = page.rect
        provider_canvas = derive_provider_canvas(
            pdf_page_width=page_rect.width,
            pdf_page_height=page_rect.height,
            provider_page_height=entry.provider_page_height,
        )
        pdf_bbox = project_provider_bbox_to_pdf_rect(
            provider_bbox=entry.bbox_provider,
            provider_canvas=provider_canvas,
            pdf_page_width=page_rect.width,
            pdf_page_height=page_rect.height,
        )
        full_page_png = page.get_pixmap(dpi=DEFAULT_RENDER_DPI, alpha=False).tobytes("png")
        crop_png = page.get_pixmap(
            dpi=DEFAULT_RENDER_DPI,
            alpha=False,
            clip=fitz.Rect(*pdf_bbox),
        ).tobytes("png")

    full_page_image_path = None
    crop_image_path = None
    if output_dir is not None:
        output_dir.mkdir(parents=True, exist_ok=True)
        full_page_path = output_dir / f"{sample_id}-page-{entry.page_number}.png"
        crop_path = output_dir / f"{sample_id}-page-{entry.page_number}-crop.png"
        full_page_path.write_bytes(full_page_png)
        crop_path.write_bytes(crop_png)
        full_page_image_path = str(full_page_path.resolve())
        crop_image_path = str(crop_path.resolve())
    return CurriculumCourseMapRenderedSample(
        sample_id=sample_id,
        page_number=entry.page_number,
        document_id=entry.document_id,
        document_title=entry.document_title,
        row_id=entry.row_id,
        parent_heading_hint=entry.parent_heading_hint,
        provider_bbox=entry.bbox_provider,
        provider_canvas=provider_canvas,
        pdf_bbox=pdf_bbox,
        full_page_png=full_page_png,
        crop_png=crop_png,
        full_page_image_path=full_page_image_path,
        crop_image_path=crop_image_path,
    )


def derive_provider_canvas(
    *,
    pdf_page_width: float,
    pdf_page_height: float,
    provider_page_height: float,
) -> tuple[float, float]:
    if pdf_page_width <= 0 or pdf_page_height <= 0:
        raise ValueError("pdf page dimensions must be positive")
    if provider_page_height <= 0:
        raise ValueError("provider_page_height must be positive")
    provider_width = provider_page_height * (pdf_page_width / pdf_page_height)
    return (provider_width, provider_page_height)


def project_provider_bbox_to_pdf_rect(
    *,
    provider_bbox: tuple[float, float, float, float],
    provider_canvas: tuple[float, float],
    pdf_page_width: float,
    pdf_page_height: float,
) -> tuple[float, float, float, float]:
    canvas_width, canvas_height = provider_canvas
    if canvas_width <= 0 or canvas_height <= 0:
        raise ValueError("provider canvas must be positive")
    if pdf_page_width <= 0 or pdf_page_height <= 0:
        raise ValueError("pdf page dimensions must be positive")
    x0, y0, x1, y1 = provider_bbox
    if x1 <= x0 or y1 <= y0:
        raise ValueError("provider bbox must have positive area")
    scale_x = pdf_page_width / canvas_width
    scale_y = pdf_page_height / canvas_height
    return (
        max(0.0, x0 * scale_x),
        max(0.0, y0 * scale_y),
        min(pdf_page_width, x1 * scale_x),
        min(pdf_page_height, y1 * scale_y),
    )


def _build_probe_config(
    *,
    prompt_transport: PromptRuntimeTransport,
    prompt_runs: int,
    max_inflight_pages: int,
    max_request_attempts: int,
    source_bucket: str,
    source_pdf_key: str,
    provider_response_key: str,
    layout_elements_key: str,
    split_manifest_path: Path,
    sample_manifest_path: Path,
    gold_manifest_path: Path,
) -> dict[str, object]:
    return {
        "schema_version": CURRICULUM_COURSE_MAP_PROBE_SCHEMA_VERSION,
        "prompt_transport": prompt_transport,
        "prompt_runs": prompt_runs,
        "max_inflight_pages": max_inflight_pages,
        "max_request_attempts": max_request_attempts,
        "source_bucket": source_bucket,
        "source_pdf_key": source_pdf_key,
        "provider_response_key": provider_response_key,
        "layout_elements_key": layout_elements_key,
        "split_manifest_path": str(split_manifest_path.resolve()),
        "sample_manifest_path": str(sample_manifest_path.resolve()),
        "gold_manifest_path": str(gold_manifest_path.resolve()),
    }


def _validate_resume_probe_config(*, output_path: Path, expected: dict[str, object]) -> None:
    config_path = output_path / "probe-config.json"
    if not config_path.exists():
        raise ValueError("resume requires existing probe-config.json")
    actual = json.loads(config_path.read_text(encoding="utf-8"))
    if actual != expected:
        raise ValueError("resume probe-config.json does not match current probe configuration")


def _resolve_base_url(source: dict[str, str]) -> str:
    return (
        source.get("PROMPT_RUNTIME_BASE_URL")
        or source.get("LLM_BASE_URL")
        or DEFAULT_PROMPT_RUNTIME_BASE_URL
    ).strip()


def _build_progress_state(
    *,
    rendered_samples: tuple[CurriculumCourseMapRenderedSample, ...],
    prompt_runs: int,
) -> dict[str, object]:
    return {
        "schema_version": CURRICULUM_COURSE_MAP_PROBE_SCHEMA_VERSION,
        "sample_ids": [sample.sample_id for sample in rendered_samples],
        "prompt_runs": prompt_runs,
        "completed_pages_by_run": {str(run_index): [] for run_index in range(1, prompt_runs + 1)},
        "completed_runs": [],
        "updated_at_epoch_seconds": round(time.time(), 3),
    }


def _sample_output_dir(*, output_dir: Path, run_index: int, sample_id: str) -> Path:
    return output_dir / "page-results" / f"run-{run_index:02d}" / sample_id


def _detected_maps_path(*, output_dir: Path, run_index: int, sample_id: str) -> Path:
    return (
        _sample_output_dir(output_dir=output_dir, run_index=run_index, sample_id=sample_id)
        / "detected-maps.json"
    )


def _extracted_map_path(
    *,
    output_dir: Path,
    run_index: int,
    sample_id: str,
    map_index: int,
) -> Path:
    return (
        _sample_output_dir(output_dir=output_dir, run_index=run_index, sample_id=sample_id)
        / "maps"
        / f"map-{map_index:02d}.json"
    )


def _page_summary_path(*, output_dir: Path, run_index: int, sample_id: str) -> Path:
    return (
        _sample_output_dir(output_dir=output_dir, run_index=run_index, sample_id=sample_id)
        / "page-summary.json"
    )


def _load_detected_maps_checkpoint(path: Path) -> tuple[DetectedCourseMapRegion, ...]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, list):
        raise ValueError("detected-maps checkpoint must be a JSON list")
    return tuple(_coerce_detected_course_map_region(item) for item in payload)


def _load_extracted_map_checkpoint(path: Path) -> CourseMapFinding:
    payload = json.loads(path.read_text(encoding="utf-8"))
    return _coerce_course_map_finding(payload)


def _load_page_probe_checkpoint(path: Path) -> CurriculumCourseMapPageProbe:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("page probe checkpoint must be a JSON object")
    return CurriculumCourseMapPageProbe(
        sample_id=str(payload.get("sample_id") or "").strip(),
        page_number=int(payload.get("page_number") or 0),
        document_id=str(payload.get("document_id") or "").strip(),
        document_title=str(payload.get("document_title") or "").strip(),
        parent_heading_hint=str(payload.get("parent_heading_hint") or "").strip(),
        detected_maps=tuple(
            _coerce_detected_course_map_region(item) for item in payload.get("detected_maps") or ()
        ),
        course_maps=tuple(
            _coerce_course_map_finding(item) for item in payload.get("course_maps") or ()
        ),
        manual_review_required=bool(payload.get("manual_review_required", False)),
        global_manual_review_notes=tuple(
            str(value).strip() for value in payload.get("global_manual_review_notes") or ()
        ),
    )


def _append_jsonl(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, ensure_ascii=False) + "\n")


def _is_retryable_probe_exception(exc: Exception) -> bool:
    if isinstance(
        exc,
        (
            httpx.ConnectError,
            httpx.ReadTimeout,
            httpx.WriteTimeout,
            httpx.PoolTimeout,
            httpx.ReadError,
        ),
    ):
        return True
    if isinstance(exc, httpx.HTTPStatusError):
        return exc.response.status_code == 429 or 500 <= exc.response.status_code < 600
    return False


async def _run_curriculum_course_map_probe_runs_async(
    *,
    source: dict[str, str],
    rendered_samples: tuple[CurriculumCourseMapRenderedSample, ...],
    output_dir: Path | None,
    prompt_runs: int,
    prompt_transport: PromptRuntimeTransport,
    max_inflight_pages: int,
    max_request_attempts: int,
    resume: bool,
) -> tuple[CurriculumCourseMapProbeRun, ...]:
    progress_state = _build_progress_state(
        rendered_samples=rendered_samples, prompt_runs=prompt_runs
    )
    metrics_lock = asyncio.Lock()
    progress_lock = asyncio.Lock()
    async with httpx.AsyncClient(
        base_url=_resolve_base_url(source), timeout=_DEFAULT_TIMEOUT
    ) as http_client:
        runs: list[CurriculumCourseMapProbeRun] = []
        for run_index in range(1, prompt_runs + 1):
            run = await _run_curriculum_course_map_probe_run_async(
                run_index=run_index,
                source=source,
                rendered_samples=rendered_samples,
                output_dir=output_dir,
                prompt_transport=prompt_transport,
                max_inflight_pages=max_inflight_pages,
                max_request_attempts=max_request_attempts,
                resume=resume,
                http_client=http_client,
                progress_state=progress_state,
                progress_lock=progress_lock,
                metrics_lock=metrics_lock,
            )
            runs.append(run)
        return tuple(runs)


async def _run_curriculum_course_map_probe_run_async(
    *,
    run_index: int,
    source: dict[str, str],
    rendered_samples: tuple[CurriculumCourseMapRenderedSample, ...],
    output_dir: Path | None,
    prompt_transport: PromptRuntimeTransport,
    max_inflight_pages: int,
    max_request_attempts: int,
    resume: bool,
    http_client: httpx.AsyncClient | None,
    progress_state: dict[str, object] | None = None,
    progress_lock: asyncio.Lock | None = None,
    metrics_lock: asyncio.Lock | None = None,
) -> CurriculumCourseMapProbeRun:
    semaphore = asyncio.Semaphore(max_inflight_pages)
    pages: list[CurriculumCourseMapPageProbe | None] = [None] * len(rendered_samples)

    async def record_metric(row: dict[str, object]) -> None:
        if output_dir is None:
            return
        if metrics_lock is None:
            _append_jsonl(output_dir / "page-metrics.jsonl", row)
            return
        async with metrics_lock:
            _append_jsonl(output_dir / "page-metrics.jsonl", row)

    async def update_progress(sample_id: str) -> None:
        if output_dir is None or progress_state is None:
            return
        run_key = str(run_index)
        completed = progress_state.setdefault("completed_pages_by_run", {})
        sample_ids = completed.setdefault(run_key, [])
        if sample_id not in sample_ids:
            sample_ids.append(sample_id)
            sample_ids.sort()
        completed_runs = progress_state.setdefault("completed_runs", [])
        if len(sample_ids) == len(rendered_samples) and run_key not in completed_runs:
            completed_runs.append(run_key)
            completed_runs.sort()
        progress_state["updated_at_epoch_seconds"] = round(time.time(), 3)
        if progress_lock is None:
            _write_json(output_dir / "progress.json", progress_state)
            return
        async with progress_lock:
            _write_json(output_dir / "progress.json", progress_state)

    async def execute_sample(
        index: int, sample: CurriculumCourseMapRenderedSample
    ) -> tuple[int, CurriculumCourseMapPageProbe]:
        sample_dir = (
            _sample_output_dir(
                output_dir=output_dir, run_index=run_index, sample_id=sample.sample_id
            )
            if output_dir is not None
            else None
        )
        summary_path = (
            _page_summary_path(
                output_dir=output_dir, run_index=run_index, sample_id=sample.sample_id
            )
            if output_dir is not None
            else None
        )
        if resume and summary_path is not None and summary_path.exists():
            page = _load_page_probe_checkpoint(summary_path)
            await record_metric(
                {
                    "run_index": run_index,
                    "sample_id": sample.sample_id,
                    "map_index": None,
                    "stage": "page",
                    "attempt": 0,
                    "transport": prompt_transport,
                    "status": "checkpoint_reused",
                    "duration_ms": 0,
                    "started_at_epoch_seconds": round(time.time(), 3),
                    "completed_at_epoch_seconds": round(time.time(), 3),
                }
            )
            await update_progress(sample.sample_id)
            return index, page

        async with semaphore:
            page = await _probe_curriculum_course_map_page_async(
                source=source,
                rendered_sample=sample,
                prompt_transport=prompt_transport,
                max_request_attempts=max_request_attempts,
                http_client=http_client,
                on_attempt=record_metric,
                run_index=run_index,
                output_dir=sample_dir,
                resume=resume,
            )
        if summary_path is not None:
            summary_path.parent.mkdir(parents=True, exist_ok=True)
            _write_json(summary_path, asdict(page))
        await update_progress(sample.sample_id)
        return index, page

    results = await asyncio.gather(
        *(execute_sample(index, sample) for index, sample in enumerate(rendered_samples))
    )
    for index, page in results:
        pages[index] = page
    return CurriculumCourseMapProbeRun(
        run_index=run_index,
        pages=tuple(page for page in pages if page is not None),
    )


async def _probe_curriculum_course_map_page_async(
    *,
    source: dict[str, str],
    rendered_sample: CurriculumCourseMapRenderedSample,
    prompt_transport: PromptRuntimeTransport,
    max_request_attempts: int,
    http_client: httpx.AsyncClient | None,
    on_attempt,
    run_index: int,
    output_dir: Path | None,
    resume: bool,
) -> CurriculumCourseMapPageProbe:
    detected_maps_path = None
    if output_dir is not None:
        detected_maps_path = output_dir / "detected-maps.json"
    if resume and detected_maps_path is not None and detected_maps_path.exists():
        detected_maps = _load_detected_maps_checkpoint(detected_maps_path)
        await on_attempt(
            {
                "run_index": run_index,
                "sample_id": rendered_sample.sample_id,
                "map_index": None,
                "stage": "detect",
                "attempt": 0,
                "transport": prompt_transport,
                "status": "checkpoint_reused",
                "duration_ms": 0,
                "started_at_epoch_seconds": round(time.time(), 3),
                "completed_at_epoch_seconds": round(time.time(), 3),
            }
        )
    else:
        detected_maps = await _detect_curriculum_course_map_regions_async(
            source=source,
            rendered_sample=rendered_sample,
            prompt_transport=prompt_transport,
            max_request_attempts=max_request_attempts,
            http_client=http_client,
            on_attempt=on_attempt,
            run_index=run_index,
        )
        if detected_maps_path is not None:
            detected_maps_path.parent.mkdir(parents=True, exist_ok=True)
            _write_json(detected_maps_path, [asdict(region) for region in detected_maps])

    extracted_maps: list[CourseMapFinding] = []
    for detected_region in detected_maps:
        map_path = None
        if output_dir is not None:
            map_path = output_dir / "maps" / f"map-{detected_region.map_index:02d}.json"
        if resume and map_path is not None and map_path.exists():
            finding = _load_extracted_map_checkpoint(map_path)
            await on_attempt(
                {
                    "run_index": run_index,
                    "sample_id": rendered_sample.sample_id,
                    "map_index": detected_region.map_index,
                    "stage": "extract",
                    "attempt": 0,
                    "transport": prompt_transport,
                    "status": "checkpoint_reused",
                    "duration_ms": 0,
                    "started_at_epoch_seconds": round(time.time(), 3),
                    "completed_at_epoch_seconds": round(time.time(), 3),
                }
            )
        else:
            rendered_region = _build_rendered_region(
                rendered_sample=rendered_sample,
                detected_region=detected_region,
                output_dir=(output_dir / "regions") if output_dir is not None else None,
            )
            finding = await _extract_curriculum_course_map_region_async(
                source=source,
                rendered_sample=rendered_sample,
                rendered_region=rendered_region,
                prompt_transport=prompt_transport,
                max_request_attempts=max_request_attempts,
                http_client=http_client,
                on_attempt=on_attempt,
                run_index=run_index,
            )
            if map_path is not None:
                map_path.parent.mkdir(parents=True, exist_ok=True)
                _write_json(map_path, asdict(finding))
        extracted_maps.append(finding)
    return _build_page_probe_from_detected_and_extracted(
        rendered_sample=rendered_sample,
        detected_maps=detected_maps,
        extracted_maps=tuple(sorted(extracted_maps, key=lambda item: item.map_index)),
    )


async def _detect_curriculum_course_map_regions_async(
    *,
    source: dict[str, str],
    rendered_sample: CurriculumCourseMapRenderedSample,
    prompt_transport: PromptRuntimeTransport,
    max_request_attempts: int,
    http_client: httpx.AsyncClient | None,
    on_attempt,
    run_index: int,
) -> tuple[DetectedCourseMapRegion, ...]:
    payload = await _request_course_map_detector_payload_async(
        transport=prompt_transport,
        source=source,
        rendered_sample=rendered_sample,
        http_client=http_client,
        max_request_attempts=max_request_attempts,
        on_attempt=on_attempt,
        run_index=run_index,
    )
    return _coerce_detected_regions_payload(
        rendered_sample=rendered_sample,
        payload=payload,
    )


async def _extract_curriculum_course_map_region_async(
    *,
    source: dict[str, str],
    rendered_sample: CurriculumCourseMapRenderedSample,
    rendered_region: CurriculumCourseMapRenderedRegion,
    prompt_transport: PromptRuntimeTransport,
    max_request_attempts: int,
    http_client: httpx.AsyncClient | None,
    on_attempt,
    run_index: int,
) -> CourseMapFinding:
    payload = await _request_course_map_region_payload_async(
        transport=prompt_transport,
        source=source,
        rendered_sample=rendered_sample,
        rendered_region=rendered_region,
        http_client=http_client,
        max_request_attempts=max_request_attempts,
        on_attempt=on_attempt,
        run_index=run_index,
    )
    return _coerce_course_map_finding(
        {
            "map_index": rendered_region.detected_region.map_index,
            "map_title": payload.get("map_title"),
            "stage_labels": payload.get("stage_labels") or (),
            "nodes": payload.get("nodes") or (),
            "edges": payload.get("edges") or (),
            "manual_review_notes": payload.get("manual_review_notes") or (),
        }
    )


async def _request_course_map_detector_payload_async(
    *,
    transport: PromptRuntimeTransport,
    source: dict[str, str],
    rendered_sample: CurriculumCourseMapRenderedSample,
    http_client: httpx.AsyncClient | None,
    max_request_attempts: int,
    on_attempt,
    run_index: int,
) -> dict[str, object]:
    return await _request_structured_multimodal_payload_async(
        transport=transport,
        source=source,
        path_label="detect",
        schema=_curriculum_course_map_detector_schema(),
        system_prompt=(
            "You are detecting bounded course-map regions inside a curriculum page image crop. "
            "A single course map spanning most of the crop still counts as one detected map region, "
            "so return one full-region bbox instead of an empty list in that case. "
            "Return one JSON object with key detected_maps. "
            "Each detected map item must use exactly these keys: "
            "map_title, title_confidence, region_bbox_normalized, manual_review_notes. "
            "Do not rename them to aliases like regions, map_regions, or bbox. "
            "Do not invent missing titles. If the title is not clearly visible, return map_title as null "
            "and title_confidence as absent or partial."
        ),
        user_content=_build_course_map_detector_content(rendered_sample=rendered_sample),
        rendered_sample=rendered_sample,
        http_client=http_client,
        max_request_attempts=max_request_attempts,
        on_attempt=on_attempt,
        run_index=run_index,
        map_index=None,
    )


async def _request_course_map_region_payload_async(
    *,
    transport: PromptRuntimeTransport,
    source: dict[str, str],
    rendered_sample: CurriculumCourseMapRenderedSample,
    rendered_region: CurriculumCourseMapRenderedRegion,
    http_client: httpx.AsyncClient | None,
    max_request_attempts: int,
    on_attempt,
    run_index: int,
) -> dict[str, object]:
    return await _request_structured_multimodal_payload_async(
        transport=transport,
        source=source,
        path_label="extract",
        schema=_curriculum_course_map_region_schema(),
        system_prompt=(
            "You are extracting one bounded curriculum course map. "
            "Stability is more important than recall. "
            "Return one JSON object with exactly these top-level keys: "
            "map_title, stage_labels, nodes, edges, manual_review_notes. "
            "Each node must use keys node_label, stage_label, category_label. "
            "Each edge must use keys source_label and target_label. "
            "Do not rename them to label, id, from, or to. "
            "Only output edges whose arrow direction is clearly visible. "
            "Do not infer missing edges, hidden prerequisites, or off-region content. "
            "If a stage or category is unclear, use an empty string instead of omitting the field. "
            "If no clear map title is visible inside this region, return map_title as null."
        ),
        user_content=_build_course_map_region_content(
            rendered_sample=rendered_sample,
            rendered_region=rendered_region,
        ),
        rendered_sample=rendered_sample,
        http_client=http_client,
        max_request_attempts=max_request_attempts,
        on_attempt=on_attempt,
        run_index=run_index,
        map_index=rendered_region.detected_region.map_index,
    )


async def _request_structured_multimodal_payload_async(
    *,
    transport: PromptRuntimeTransport,
    source: dict[str, str],
    path_label: str,
    schema: dict[str, object],
    system_prompt: str,
    user_content: list[dict[str, object]],
    rendered_sample: CurriculumCourseMapRenderedSample,
    http_client: httpx.AsyncClient | None,
    max_request_attempts: int,
    on_attempt,
    run_index: int,
    map_index: int | None,
) -> dict[str, object]:
    api_key = (source.get("PROMPT_RUNTIME_API_KEY") or source.get("LLM_API_KEY") or "").strip()
    model_name = (source.get("PROMPT_RUNTIME_MODEL") or "").strip()
    reasoning_effort = (source.get("PROMPT_RUNTIME_REASONING_EFFORT") or "").strip()
    max_output_tokens = (source.get("PROMPT_RUNTIME_MAX_OUTPUT_TOKENS") or "").strip()
    if not api_key:
        raise ValueError("PROMPT_RUNTIME_API_KEY is required for curriculum course-map probe")
    if not model_name:
        raise ValueError("PROMPT_RUNTIME_MODEL is required for curriculum course-map probe")
    if http_client is None:
        raise ValueError("http_client is required for async probe requests")
    if transport == "responses":
        payload: dict[str, object] = {
            "model": model_name,
            "stream": False,
            "input": [
                {
                    "role": "system",
                    "type": "message",
                    "content": [{"type": "input_text", "text": system_prompt}],
                },
                {
                    "role": "user",
                    "type": "message",
                    "content": user_content,
                },
            ],
            "text": {
                "format": {
                    "type": "json_schema",
                    "name": f"curriculum_course_map_{path_label}",
                    "schema": schema,
                    "strict": True,
                }
            },
        }
        if reasoning_effort:
            payload["reasoning"] = {"effort": reasoning_effort}
        if max_output_tokens:
            payload["max_output_tokens"] = int(max_output_tokens)
        response_json = await _post_probe_json_async(
            http_client=http_client,
            path="/responses",
            payload=payload,
            api_key=api_key,
            max_request_attempts=max_request_attempts,
            on_attempt=on_attempt,
            run_index=run_index,
            sample_id=rendered_sample.sample_id,
            transport="responses",
            stage=path_label,
            map_index=map_index,
        )
        raw_payload = response_json.get("output_parsed")
        if raw_payload is None:
            raw_payload = _extract_output_parsed(response_json)
        if not isinstance(raw_payload, dict):
            raise ValueError("curriculum course-map probe parsed payload must be a JSON object")
        return raw_payload

    payload = {
        "model": model_name,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_content},
        ],
        "response_format": {
            "type": "json_schema",
            "json_schema": {
                "name": f"curriculum_course_map_{path_label}",
                "schema": schema,
                "strict": True,
            },
        },
    }
    if reasoning_effort:
        payload["reasoning_effort"] = reasoning_effort
    if max_output_tokens:
        payload["max_completion_tokens"] = int(max_output_tokens)
    response_json = await _post_probe_json_async(
        http_client=http_client,
        path="/chat/completions",
        payload=payload,
        api_key=api_key,
        max_request_attempts=max_request_attempts,
        on_attempt=on_attempt,
        run_index=run_index,
        sample_id=rendered_sample.sample_id,
        transport="chat_completions",
        stage=path_label,
        map_index=map_index,
    )
    raw_payload = _extract_chat_completions_output_parsed(response_json)
    if not isinstance(raw_payload, dict):
        raise ValueError("curriculum course-map probe parsed payload must be a JSON object")
    return raw_payload


async def _post_probe_json_async(
    *,
    http_client: httpx.AsyncClient,
    path: str,
    payload: dict[str, object],
    api_key: str,
    max_request_attempts: int,
    on_attempt,
    run_index: int,
    sample_id: str,
    transport: str,
    stage: str,
    map_index: int | None,
) -> dict[str, object]:
    last_error: Exception | None = None
    for attempt in range(1, max_request_attempts + 1):
        started_at = time.time()
        duration_ms = 0
        try:
            response = await http_client.post(
                path,
                json=payload,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
            )
            duration_ms = round((time.time() - started_at) * 1000)
            await on_attempt(
                {
                    "run_index": run_index,
                    "sample_id": sample_id,
                    "map_index": map_index,
                    "stage": stage,
                    "attempt": attempt,
                    "transport": transport,
                    "status": response.status_code,
                    "duration_ms": duration_ms,
                    "started_at_epoch_seconds": round(started_at, 3),
                    "completed_at_epoch_seconds": round(started_at + (duration_ms / 1000), 3),
                }
            )
            if (
                response.status_code == 429 or 500 <= response.status_code < 600
            ) and attempt < max_request_attempts:
                await asyncio.sleep(float(2 ** (attempt - 1)))
                continue
            response.raise_for_status()
            response_json = response.json()
            if not isinstance(response_json, dict):
                raise ValueError("curriculum course-map probe response must be a JSON object")
            return response_json
        except Exception as exc:
            last_error = exc
            duration_ms = round((time.time() - started_at) * 1000)
            await on_attempt(
                {
                    "run_index": run_index,
                    "sample_id": sample_id,
                    "map_index": map_index,
                    "stage": stage,
                    "attempt": attempt,
                    "transport": transport,
                    "status": type(exc).__name__,
                    "duration_ms": duration_ms,
                    "started_at_epoch_seconds": round(started_at, 3),
                    "completed_at_epoch_seconds": round(started_at + (duration_ms / 1000), 3),
                }
            )
            if not _is_retryable_probe_exception(exc) or attempt >= max_request_attempts:
                if isinstance(exc, httpx.HTTPStatusError):
                    raise ValueError(
                        f"curriculum course-map probe request failed: {exc.response.status_code} {exc.response.text}"
                    ) from exc
                raise
            await asyncio.sleep(float(2 ** (attempt - 1)))
    if last_error is None:  # pragma: no cover
        raise RuntimeError("unreachable")
    raise last_error


def _build_course_map_detector_content(
    *,
    rendered_sample: CurriculumCourseMapRenderedSample,
) -> list[dict[str, object]]:
    return [
        {
            "type": "text",
            "text": (
                f"Document title: {rendered_sample.document_title}\n"
                f"Page number: {rendered_sample.page_number}\n"
                f"Parent heading hint: {rendered_sample.parent_heading_hint or '<none>'}\n"
                "Image 1 is the full PDF page.\n"
                "Image 2 is the bounded course-map crop.\n"
                "If Image 2 already shows one complete course map, return one detected_maps item "
                "with region_bbox_normalized [0, 0, 1, 1].\n"
                "Detect how many distinct course-map diagrams are visible inside Image 2. "
                "Return ordered map regions from top-to-bottom, then left-to-right. "
                "Region bbox values must be normalized floats between 0 and 1 relative to Image 2."
            ),
        },
        {
            "type": "image_url",
            "image_url": {"url": _png_data_url(rendered_sample.full_page_png), "detail": "high"},
        },
        {
            "type": "image_url",
            "image_url": {"url": _png_data_url(rendered_sample.crop_png), "detail": "high"},
        },
    ]


def _build_course_map_region_content(
    *,
    rendered_sample: CurriculumCourseMapRenderedSample,
    rendered_region: CurriculumCourseMapRenderedRegion,
) -> list[dict[str, object]]:
    content: list[dict[str, object]] = [
        {
            "type": "text",
            "text": (
                f"Document title: {rendered_sample.document_title}\n"
                f"Page number: {rendered_sample.page_number}\n"
                f"Parent heading hint: {rendered_sample.parent_heading_hint or '<none>'}\n"
                f"Map index: {rendered_region.detected_region.map_index}\n"
                f"Detector title: {rendered_region.detected_region.map_title or '<none>'}\n"
                f"Detector title confidence: {rendered_region.detected_region.title_confidence}\n"
                "Image 1 is the full PDF page.\n"
                "Image 2 is the bounded region crop for one map.\n"
                "Images 3+ are tiles of Image 2.\n"
                "Use the visible Chinese course names as node_label values.\n"
                "If stage labels are visible, keep them in stage_labels and node.stage_label; "
                "otherwise use an empty string.\n"
                "If category labels are unclear, use an empty string.\n"
                "Only output the visible course-map structure for this single region. "
                "If a title is not clearly visible inside this region, return map_title as null."
            ),
        },
        {
            "type": "image_url",
            "image_url": {"url": _png_data_url(rendered_sample.full_page_png), "detail": "high"},
        },
        {
            "type": "image_url",
            "image_url": {"url": _png_data_url(rendered_region.crop_png), "detail": "high"},
        },
    ]
    for tile in rendered_region.tile_pngs:
        content.append(
            {"type": "image_url", "image_url": {"url": _png_data_url(tile), "detail": "high"}}
        )
    return content


def _png_data_url(payload: bytes) -> str:
    return f"data:image/png;base64,{b64encode(payload).decode('ascii')}"


def _extract_output_parsed(payload: dict[str, object]) -> object:
    for output_item in payload.get("output", []):
        if not isinstance(output_item, dict):
            continue
        for content_item in output_item.get("content", []):
            if not isinstance(content_item, dict):
                continue
            if content_item.get("parsed") is not None:
                return content_item["parsed"]
            text = content_item.get("text")
            if isinstance(text, str) and text.strip():
                return _loads_json_object_loose(text)
    raise ValueError("curriculum course-map probe response missing parsed output")


def _extract_chat_completions_output_parsed(payload: dict[str, object]) -> object:
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        raise ValueError("curriculum course-map chat completion missing choices")
    message = choices[0].get("message")
    if not isinstance(message, dict):
        raise ValueError("curriculum course-map chat completion missing assistant message")
    content = message.get("content")
    if isinstance(content, str) and content.strip():
        return _loads_json_object_loose(content)
    if isinstance(content, list):
        parts: list[str] = []
        for item in content:
            if isinstance(item, str) and item.strip():
                parts.append(item)
                continue
            if not isinstance(item, dict):
                continue
            text = item.get("text")
            if isinstance(text, str) and text.strip():
                parts.append(text)
        if parts:
            return _loads_json_object_loose("\n".join(parts))
    raise ValueError("curriculum course-map chat completion missing parsed output")


def _normalize_prompt_runtime_transport(raw_transport: str) -> PromptRuntimeTransport:
    normalized = raw_transport.strip().lower()
    if normalized in {"", "responses"}:
        return "responses"
    if normalized in {"chat_completions", "chat-completions", "chat/completions"}:
        return "chat_completions"
    raise ValueError("PROMPT_RUNTIME_TRANSPORT must be one of responses or chat_completions")


def _loads_json_object_loose(text: str) -> object:
    stripped = text.strip()
    last_error: json.JSONDecodeError | None = None
    try:
        return json.loads(stripped)
    except json.JSONDecodeError as exc:
        last_error = exc
    fence_match = re.search(r"```(?:json)?\s*(\{[\s\S]*\})\s*```", stripped)
    if fence_match is not None:
        return json.loads(fence_match.group(1))
    start = stripped.find("{")
    end = stripped.rfind("}")
    if start >= 0 and end > start:
        return json.loads(stripped[start : end + 1])
    if last_error is not None:
        raise last_error
    raise ValueError("expected JSON object text")


def _extract_detected_maps_payload(payload: dict[str, object]) -> tuple[object, ...]:
    candidates = (
        payload.get("detected_maps"),
        payload.get("map_regions"),
        payload.get("regions"),
        payload.get("maps"),
    )
    for candidate in candidates:
        if isinstance(candidate, list):
            return tuple(candidate)
    return ()


def _normalize_course_map_finding_payload(payload: dict[str, object]) -> dict[str, object]:
    normalized_nodes: list[dict[str, str]] = []
    for node in payload.get("nodes") or payload.get("courses") or ():
        if not isinstance(node, dict):
            normalized_nodes.append({})
            continue
        normalized_nodes.append(
            {
                "node_label": _first_non_empty_string(
                    node.get("node_label"),
                    node.get("label"),
                    node.get("name"),
                    node.get("course_name"),
                    node.get("text"),
                    node.get("id"),
                ),
                "stage_label": _first_non_empty_string(
                    node.get("stage_label"),
                    node.get("stage"),
                    node.get("year_group"),
                    node.get("semester_stage"),
                ),
                "category_label": _first_non_empty_string(
                    node.get("category_label"),
                    node.get("category"),
                    node.get("type"),
                    node.get("group"),
                ),
            }
        )

    normalized_edges: list[dict[str, str]] = []
    for edge in payload.get("edges") or payload.get("links") or payload.get("connections") or ():
        if not isinstance(edge, dict):
            normalized_edges.append({})
            continue
        normalized_edges.append(
            {
                "source_label": _first_non_empty_string(
                    edge.get("source_label"),
                    edge.get("source"),
                    edge.get("from"),
                    edge.get("prerequisite"),
                ),
                "target_label": _first_non_empty_string(
                    edge.get("target_label"),
                    edge.get("target"),
                    edge.get("to"),
                    edge.get("next"),
                ),
            }
        )

    stage_labels = payload.get("stage_labels") or payload.get("stages") or ()
    if not isinstance(stage_labels, (list, tuple)):
        stage_labels = ()
    derived_stage_labels = [
        node["stage_label"] for node in normalized_nodes if node.get("stage_label")
    ]
    return {
        "map_index": payload.get("map_index") or 0,
        "map_title": payload.get("map_title"),
        "stage_labels": tuple(
            dict.fromkeys(
                [
                    *[str(value).strip() for value in stage_labels if str(value).strip()],
                    *derived_stage_labels,
                ]
            )
        ),
        "nodes": tuple(normalized_nodes),
        "edges": tuple(normalized_edges),
        "manual_review_notes": _normalize_string_sequence(
            payload.get("manual_review_notes") or payload.get("notes")
        ),
    }


def _first_non_empty_string(*values: object) -> str:
    for value in values:
        if value is None:
            continue
        text = str(value).strip()
        if text:
            return text
    return ""


def _normalize_string_sequence(values: object) -> tuple[str, ...]:
    if values is None:
        return ()
    if isinstance(values, str):
        return (values.strip(),) if values.strip() else ()
    if isinstance(values, (list, tuple)):
        return tuple(str(value).strip() for value in values if str(value).strip())
    text = str(values).strip()
    return (text,) if text else ()


def _coerce_detected_course_map_region(payload: object) -> DetectedCourseMapRegion:
    if not isinstance(payload, dict):
        raise ValueError("detected course-map region payload must be a JSON object")
    return DetectedCourseMapRegion(
        map_index=int(payload.get("map_index") or 0),
        map_title=(
            str(payload["map_title"]).strip()
            if payload.get("map_title") not in {None, ""}
            else None
        ),
        title_confidence=str(payload.get("title_confidence") or "absent").strip().lower(),  # type: ignore[arg-type]
        region_bbox_normalized=_coerce_bbox(payload.get("region_bbox_normalized")),
        region_bbox_pdf=_coerce_bbox(payload.get("region_bbox_pdf")),
        region_bbox_provider=_coerce_bbox(payload.get("region_bbox_provider")),
        manual_review_notes=_normalize_string_sequence(payload.get("manual_review_notes")),
    )


def _coerce_course_map_finding(payload: object) -> CourseMapFinding:
    if not isinstance(payload, dict):
        raise ValueError("course-map finding payload must be a JSON object")
    payload = _normalize_course_map_finding_payload(payload)
    manual_review_notes = [
        str(value).strip()
        for value in payload.get("manual_review_notes") or ()
        if str(value).strip()
    ]
    nodes: list[CourseMapNode] = []
    for node in payload.get("nodes") or ():
        if not isinstance(node, dict):
            manual_review_notes.append("extractor returned a non-object node and it was dropped")
            continue
        node_label = str(node.get("node_label") or "").strip()
        if not node_label:
            manual_review_notes.append("extractor returned an empty node_label and it was dropped")
            continue
        nodes.append(
            CourseMapNode(
                node_label=node_label,
                stage_label=str(node.get("stage_label") or "").strip(),
                category_label=str(node.get("category_label") or "").strip(),
            )
        )
    edges: list[CourseMapEdge] = []
    for edge in payload.get("edges") or ():
        if not isinstance(edge, dict):
            manual_review_notes.append("extractor returned a non-object edge and it was dropped")
            continue
        source_label = str(edge.get("source_label") or "").strip()
        target_label = str(edge.get("target_label") or "").strip()
        if not source_label or not target_label:
            manual_review_notes.append(
                "extractor returned an empty edge endpoint and it was dropped"
            )
            continue
        edges.append(CourseMapEdge(source_label=source_label, target_label=target_label))
    return CourseMapFinding(
        map_index=int(payload.get("map_index") or 0),
        map_title=(
            str(payload["map_title"]).strip()
            if payload.get("map_title") not in {None, ""}
            else None
        ),
        stage_labels=tuple(str(value).strip() for value in payload.get("stage_labels") or ()),
        nodes=tuple(nodes),
        edges=tuple(edges),
        manual_review_notes=tuple(dict.fromkeys(manual_review_notes)),
    )


def _coerce_detected_regions_payload(
    *,
    rendered_sample: CurriculumCourseMapRenderedSample,
    payload: object,
) -> tuple[DetectedCourseMapRegion, ...]:
    if not isinstance(payload, dict):
        raise ValueError("detected regions payload must be a JSON object")
    detected_maps = _extract_detected_maps_payload(payload)
    regions = [
        _coerce_detected_region_from_raw(
            rendered_sample=rendered_sample, raw_region=item, position=index + 1
        )
        for index, item in enumerate(detected_maps)
    ]
    normalized = _sort_detected_regions(regions)
    if normalized:
        return tuple(normalized)
    return (_default_detected_region(rendered_sample=rendered_sample),)


def _coerce_detected_region_from_raw(
    *,
    rendered_sample: CurriculumCourseMapRenderedSample,
    raw_region: object,
    position: int,
) -> DetectedCourseMapRegion:
    if not isinstance(raw_region, dict):
        raise ValueError("detected region must be a JSON object")
    normalized_bbox = _coerce_normalized_bbox(
        raw_region.get("region_bbox_normalized")
        or raw_region.get("bbox")
        or raw_region.get("region_bbox")
        or raw_region.get("normalized_bbox")
    )
    pdf_bbox, provider_bbox = _project_normalized_crop_bbox_to_sample_bboxes(
        normalized_bbox=normalized_bbox,
        rendered_sample=rendered_sample,
    )
    map_title = (
        str(raw_region["map_title"]).strip()
        if raw_region.get("map_title") not in {None, ""}
        else None
    )
    if map_title is None:
        alias_title = _first_non_empty_string(raw_region.get("title"), raw_region.get("name"))
        map_title = alias_title or None
    title_confidence = str(raw_region.get("title_confidence") or "absent").strip().lower()
    if map_title is None and title_confidence == "visible":
        title_confidence = "partial"
    if title_confidence not in {"visible", "partial", "absent"}:
        title_confidence = "partial" if map_title else "absent"
    return DetectedCourseMapRegion(
        map_index=position,
        map_title=map_title,
        title_confidence=title_confidence,  # type: ignore[arg-type]
        region_bbox_normalized=normalized_bbox,
        region_bbox_pdf=pdf_bbox,
        region_bbox_provider=provider_bbox,
        manual_review_notes=_normalize_string_sequence(raw_region.get("manual_review_notes")),
    )


def _sort_detected_regions(regions: list[DetectedCourseMapRegion]) -> list[DetectedCourseMapRegion]:
    sorted_regions = sorted(
        regions,
        key=lambda item: (
            round(item.region_bbox_normalized[1], 4),
            round(item.region_bbox_normalized[0], 4),
        ),
    )
    normalized: list[DetectedCourseMapRegion] = []
    for index, region in enumerate(sorted_regions, start=1):
        normalized.append(
            DetectedCourseMapRegion(
                map_index=index,
                map_title=region.map_title,
                title_confidence=region.title_confidence,
                region_bbox_normalized=region.region_bbox_normalized,
                region_bbox_pdf=region.region_bbox_pdf,
                region_bbox_provider=region.region_bbox_provider,
                manual_review_notes=region.manual_review_notes,
            )
        )
    return normalized


def _default_detected_region(
    *,
    rendered_sample: CurriculumCourseMapRenderedSample,
) -> DetectedCourseMapRegion:
    return DetectedCourseMapRegion(
        map_index=1,
        map_title=None,
        title_confidence="absent",
        region_bbox_normalized=(0.0, 0.0, 1.0, 1.0),
        region_bbox_pdf=rendered_sample.pdf_bbox,
        region_bbox_provider=rendered_sample.provider_bbox,
        manual_review_notes=(
            "detector did not return any bounded map regions; fell back to the full crop",
        ),
    )


def _build_rendered_region(
    *,
    rendered_sample: CurriculumCourseMapRenderedSample,
    detected_region: DetectedCourseMapRegion,
    output_dir: Path | None,
) -> CurriculumCourseMapRenderedRegion:
    crop_png = _crop_png_with_normalized_bbox(
        image_bytes=rendered_sample.crop_png,
        normalized_bbox=detected_region.region_bbox_normalized,
    )
    tile_pngs = _build_region_tiles(crop_png)
    crop_image_path = None
    tile_image_paths: list[str] = []
    if output_dir is not None:
        output_dir.mkdir(parents=True, exist_ok=True)
        crop_path = output_dir / f"map-{detected_region.map_index:02d}.png"
        crop_path.write_bytes(crop_png)
        crop_image_path = str(crop_path.resolve())
        for tile_index, tile_png in enumerate(tile_pngs, start=1):
            tile_path = (
                output_dir / f"map-{detected_region.map_index:02d}-tile-{tile_index:02d}.png"
            )
            tile_path.write_bytes(tile_png)
            tile_image_paths.append(str(tile_path.resolve()))
    return CurriculumCourseMapRenderedRegion(
        detected_region=detected_region,
        crop_png=crop_png,
        tile_pngs=tile_pngs,
        crop_image_path=crop_image_path,
        tile_image_paths=tuple(tile_image_paths),
    )


def _crop_png_with_normalized_bbox(
    *,
    image_bytes: bytes,
    normalized_bbox: tuple[float, float, float, float],
) -> bytes:
    with Image.open(BytesIO(image_bytes)) as image:
        width, height = image.size
        x0 = max(0, min(width - 1, int(math.floor(normalized_bbox[0] * width))))
        y0 = max(0, min(height - 1, int(math.floor(normalized_bbox[1] * height))))
        x1 = max(x0 + 1, min(width, int(math.ceil(normalized_bbox[2] * width))))
        y1 = max(y0 + 1, min(height, int(math.ceil(normalized_bbox[3] * height))))
        cropped = image.crop((x0, y0, x1, y1))
        buffer = BytesIO()
        cropped.save(buffer, format="PNG")
        return buffer.getvalue()


def _build_region_tiles(image_bytes: bytes) -> tuple[bytes, ...]:
    with Image.open(BytesIO(image_bytes)) as image:
        width, height = image.size
        tile_width = max(1, math.ceil(width / DEFAULT_REGION_TILE_COLS))
        tile_height = max(1, math.ceil(height / DEFAULT_REGION_TILE_ROWS))
        overlap_x = math.floor(tile_width * DEFAULT_TILE_OVERLAP_RATIO)
        overlap_y = math.floor(tile_height * DEFAULT_TILE_OVERLAP_RATIO)
        tiles: list[bytes] = []
        for row in range(DEFAULT_REGION_TILE_ROWS):
            for col in range(DEFAULT_REGION_TILE_COLS):
                x0 = max(0, col * tile_width - overlap_x)
                y0 = max(0, row * tile_height - overlap_y)
                x1 = min(width, (col + 1) * tile_width + overlap_x)
                y1 = min(height, (row + 1) * tile_height + overlap_y)
                tile = image.crop((x0, y0, x1, y1))
                buffer = BytesIO()
                tile.save(buffer, format="PNG")
                tiles.append(buffer.getvalue())
        return tuple(tiles)


def _project_normalized_crop_bbox_to_sample_bboxes(
    *,
    normalized_bbox: tuple[float, float, float, float],
    rendered_sample: CurriculumCourseMapRenderedSample,
) -> tuple[tuple[float, float, float, float], tuple[float, float, float, float]]:
    crop_pdf_x0, crop_pdf_y0, crop_pdf_x1, crop_pdf_y1 = rendered_sample.pdf_bbox
    crop_provider_x0, crop_provider_y0, crop_provider_x1, crop_provider_y1 = (
        rendered_sample.provider_bbox
    )
    width_pdf = crop_pdf_x1 - crop_pdf_x0
    height_pdf = crop_pdf_y1 - crop_pdf_y0
    width_provider = crop_provider_x1 - crop_provider_x0
    height_provider = crop_provider_y1 - crop_provider_y0
    pdf_bbox = (
        crop_pdf_x0 + width_pdf * normalized_bbox[0],
        crop_pdf_y0 + height_pdf * normalized_bbox[1],
        crop_pdf_x0 + width_pdf * normalized_bbox[2],
        crop_pdf_y0 + height_pdf * normalized_bbox[3],
    )
    provider_bbox = (
        crop_provider_x0 + width_provider * normalized_bbox[0],
        crop_provider_y0 + height_provider * normalized_bbox[1],
        crop_provider_x0 + width_provider * normalized_bbox[2],
        crop_provider_y0 + height_provider * normalized_bbox[3],
    )
    return pdf_bbox, provider_bbox


def _build_page_probe_from_detected_and_extracted(
    *,
    rendered_sample: CurriculumCourseMapRenderedSample,
    detected_maps: tuple[DetectedCourseMapRegion, ...],
    extracted_maps: tuple[CourseMapFinding, ...],
) -> CurriculumCourseMapPageProbe:
    global_notes: list[str] = []
    manual_review_required = False
    if any(region.title_confidence != "visible" for region in detected_maps):
        global_notes.append(
            "at least one detected map region does not have a clearly visible title"
        )
        manual_review_required = True
    for region in detected_maps:
        if region.manual_review_notes:
            manual_review_required = True
            global_notes.extend(region.manual_review_notes)
    for finding in extracted_maps:
        if finding.manual_review_notes:
            manual_review_required = True
            global_notes.extend(finding.manual_review_notes)
    if not extracted_maps:
        manual_review_required = True
        global_notes.append("no map content was extracted from detected regions")
    return CurriculumCourseMapPageProbe(
        sample_id=rendered_sample.sample_id,
        page_number=rendered_sample.page_number,
        document_id=rendered_sample.document_id,
        document_title=rendered_sample.document_title,
        parent_heading_hint=rendered_sample.parent_heading_hint,
        detected_maps=detected_maps,
        course_maps=extracted_maps,
        manual_review_required=manual_review_required,
        global_manual_review_notes=tuple(
            dict.fromkeys(note for note in global_notes if note.strip())
        ),
    )


def _curriculum_course_map_detector_schema() -> dict[str, object]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["detected_maps"],
        "properties": {
            "detected_maps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "map_title",
                        "title_confidence",
                        "region_bbox_normalized",
                        "manual_review_notes",
                    ],
                    "properties": {
                        "map_title": {"type": ["string", "null"]},
                        "title_confidence": {
                            "type": "string",
                            "enum": ["visible", "partial", "absent"],
                        },
                        "region_bbox_normalized": {
                            "type": "array",
                            "minItems": 4,
                            "maxItems": 4,
                            "items": {"type": "number"},
                        },
                        "manual_review_notes": {"type": "array", "items": {"type": "string"}},
                    },
                },
            },
        },
    }


def _curriculum_course_map_region_schema() -> dict[str, object]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["map_title", "stage_labels", "nodes", "edges", "manual_review_notes"],
        "properties": {
            "map_title": {"type": ["string", "null"]},
            "stage_labels": {"type": "array", "items": {"type": "string"}},
            "nodes": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["node_label", "stage_label", "category_label"],
                    "properties": {
                        "node_label": {"type": "string"},
                        "stage_label": {"type": "string"},
                        "category_label": {"type": "string"},
                    },
                },
            },
            "edges": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": ["source_label", "target_label"],
                    "properties": {
                        "source_label": {"type": "string"},
                        "target_label": {"type": "string"},
                    },
                },
            },
            "manual_review_notes": {"type": "array", "items": {"type": "string"}},
        },
    }


def build_curriculum_course_map_repeatability_report(
    *,
    runs: tuple[CurriculumCourseMapProbeRun, ...],
    threshold: float,
) -> CurriculumCourseMapRepeatabilityReport:
    if not runs:
        raise ValueError("repeatability report requires at least one run")
    page_runs = _group_runs_by_page(runs)
    page_scores: list[CurriculumCourseMapRepeatabilityPageScore] = []
    for page_number, probes in sorted(page_runs.items()):
        if not probes:
            continue
        pair_title_scores: list[float] = []
        pair_node_scores: list[float] = []
        pair_edge_scores: list[float] = []
        count_scores: list[float] = []
        comparisons = 0
        for left_index in range(len(probes)):
            for right_index in range(left_index + 1, len(probes)):
                left = probes[left_index]
                right = probes[right_index]
                comparisons += 1
                max_maps = max(len(left.course_maps), len(right.course_maps))
                slot_title_scores: list[float] = []
                slot_node_scores: list[float] = []
                slot_edge_scores: list[float] = []
                for slot_index in range(max_maps):
                    left_finding = (
                        left.course_maps[slot_index] if slot_index < len(left.course_maps) else None
                    )
                    right_finding = (
                        right.course_maps[slot_index]
                        if slot_index < len(right.course_maps)
                        else None
                    )
                    left_surface = _slot_surface(left_finding)
                    right_surface = _slot_surface(right_finding)
                    slot_title_scores.append(
                        _jaccard(left_surface["titles"], right_surface["titles"])
                    )
                    slot_node_scores.append(_jaccard(left_surface["nodes"], right_surface["nodes"]))
                    slot_edge_scores.append(_jaccard(left_surface["edges"], right_surface["edges"]))
                pair_title_scores.append(_mean(slot_title_scores) if slot_title_scores else 1.0)
                pair_node_scores.append(_mean(slot_node_scores) if slot_node_scores else 1.0)
                pair_edge_scores.append(_mean(slot_edge_scores) if slot_edge_scores else 1.0)
                count_scores.append(1.0 if len(left.course_maps) == len(right.course_maps) else 0.0)
        title_jaccard = _mean(pair_title_scores) if pair_title_scores else 1.0
        node_jaccard = _mean(pair_node_scores) if pair_node_scores else 1.0
        edge_jaccard = _mean(pair_edge_scores) if pair_edge_scores else 1.0
        map_count_agreement = _mean(count_scores) if count_scores else 1.0
        overall_score = _mean([title_jaccard, node_jaccard, edge_jaccard, map_count_agreement])
        page_scores.append(
            CurriculumCourseMapRepeatabilityPageScore(
                page_number=page_number,
                document_id=probes[0].document_id,
                compared_run_pairs=comparisons,
                title_jaccard=round(title_jaccard, 4),
                node_jaccard=round(node_jaccard, 4),
                edge_jaccard=round(edge_jaccard, 4),
                map_count_agreement=round(map_count_agreement, 4),
                overall_score=round(overall_score, 4),
                passed=overall_score >= threshold,
            )
        )
    overall_score = _mean([score.overall_score for score in page_scores]) if page_scores else 0.0
    pass_rate = (
        sum(1 for score in page_scores if score.passed) / len(page_scores) if page_scores else 0.0
    )
    return CurriculumCourseMapRepeatabilityReport(
        schema_version=CURRICULUM_COURSE_MAP_PROBE_SCHEMA_VERSION,
        threshold=threshold,
        page_scores=tuple(page_scores),
        pass_rate=round(pass_rate, 4),
        overall_score=round(overall_score, 4),
    )


def build_curriculum_course_map_gold_report(
    *,
    runs: tuple[CurriculumCourseMapProbeRun, ...],
    gold_manifest: tuple[CurriculumCourseMapGoldExpectation, ...],
) -> CurriculumCourseMapGoldReport:
    if not runs:
        raise ValueError("gold report requires at least one run")
    page_runs = _group_runs_by_page(runs)
    page_scores: list[CurriculumCourseMapGoldPageScore] = []
    for expectation in gold_manifest:
        probes = page_runs.get(expectation.page_number) or ()
        if not probes:
            raise ValueError(f"gold page {expectation.page_number} is missing from probe runs")
        stable_titles: list[str] = []
        stable_nodes: set[str] = set()
        stable_edges: set[tuple[str, str]] = set()
        slot_presence = 0
        slot_passes = 0
        required_titles = 0
        matched_titles = 0
        expected_node_total = 0
        matched_node_total = 0
        expected_edge_total = 0
        matched_edge_total = 0
        for slot in expectation.expected_maps:
            stable_slot = _stable_slot_surface(probes=probes, map_index=slot.map_index)
            if stable_slot["present"]:
                slot_presence += 1
            if slot.title_required:
                required_titles += 1
                if (
                    slot.expected_title
                    and _normalize_label(slot.expected_title) in stable_slot["titles"]
                ):
                    matched_titles += 1
            expected_node_set = {_normalize_label(value) for value in slot.expected_node_labels}
            expected_edge_set = {
                (_normalize_label(left), _normalize_label(right))
                for left, right in slot.expected_edges
            }
            matched_node_total += len(expected_node_set & stable_slot["nodes"])
            expected_node_total += len(expected_node_set)
            matched_edge_total += len(expected_edge_set & stable_slot["edges"])
            expected_edge_total += len(expected_edge_set)
            slot_node_recall = _recall(expected=expected_node_set, actual=stable_slot["nodes"])
            slot_edge_recall = _recall(expected=expected_edge_set, actual=stable_slot["edges"])
            slot_title_pass = True
            if slot.title_required:
                slot_title_pass = (
                    bool(slot.expected_title)
                    and _normalize_label(slot.expected_title) in stable_slot["titles"]
                )
            if (
                slot_title_pass
                and slot_node_recall >= slot.min_node_recall
                and slot_edge_recall >= slot.min_edge_recall
            ):
                slot_passes += 1
            stable_titles.extend(sorted(stable_slot["titles"]))
            stable_nodes |= stable_slot["nodes"]
            stable_edges |= stable_slot["edges"]
        map_detection_recall = slot_presence / len(expectation.expected_maps)
        slot_pass_rate = slot_passes / len(expectation.expected_maps)
        title_recall = matched_titles / required_titles if required_titles else 1.0
        node_recall = matched_node_total / expected_node_total if expected_node_total else 1.0
        edge_recall = matched_edge_total / expected_edge_total if expected_edge_total else 1.0
        passed = (
            map_detection_recall >= expectation.min_map_detection_recall
            and slot_pass_rate >= expectation.min_slot_pass_rate
        )
        page_scores.append(
            CurriculumCourseMapGoldPageScore(
                page_number=expectation.page_number,
                document_id=expectation.document_id,
                map_detection_recall=round(map_detection_recall, 4),
                slot_pass_rate=round(slot_pass_rate, 4),
                title_recall=round(title_recall, 4),
                node_recall=round(node_recall, 4),
                edge_recall=round(edge_recall, 4),
                stable_titles=tuple(sorted(set(stable_titles))),
                stable_nodes=tuple(sorted(stable_nodes)),
                stable_edges=tuple(sorted(stable_edges)),
                passed=passed,
            )
        )
    pass_rate = (
        sum(1 for score in page_scores if score.passed) / len(page_scores) if page_scores else 0.0
    )
    return CurriculumCourseMapGoldReport(
        schema_version=CURRICULUM_COURSE_MAP_PROBE_SCHEMA_VERSION,
        page_scores=tuple(page_scores),
        pass_rate=round(pass_rate, 4),
    )


def build_curriculum_course_map_admission_summary(
    *,
    repeatability: CurriculumCourseMapRepeatabilityReport,
    gold: CurriculumCourseMapGoldReport,
) -> CurriculumCourseMapAdmissionSummary:
    reasons: list[str] = []
    if repeatability.pass_rate >= DEFAULT_REPEATABILITY_PASS_RATE_THRESHOLD:
        reasons.append("repeatability gate reached bounded admission threshold")
    else:
        reasons.append("repeatability gate is still below bounded admission threshold")
    if gold.pass_rate >= DEFAULT_GOLD_PASS_RATE_THRESHOLD:
        reasons.append("gold coverage is strong enough for a bounded follow-up")
    else:
        reasons.append("gold coverage is still too weak for bounded admission")
    if (
        repeatability.pass_rate >= DEFAULT_REPEATABILITY_PASS_RATE_THRESHOLD
        and gold.pass_rate >= DEFAULT_GOLD_PASS_RATE_THRESHOLD
    ):
        recommendation = "bounded_candidate_for_follow_up"
    elif repeatability.overall_score >= DEFAULT_REPEATABILITY_THRESHOLD:
        recommendation = "bounded_probe_only"
    else:
        recommendation = "not_admitted_keep_fail_close"
    return CurriculumCourseMapAdmissionSummary(
        schema_version=CURRICULUM_COURSE_MAP_PROBE_SCHEMA_VERSION,
        recommendation=recommendation,
        repeatability_pass_rate=repeatability.pass_rate,
        gold_pass_rate=gold.pass_rate,
        repeatability_overall_score=repeatability.overall_score,
        reasons=tuple(reasons),
    )


def _group_runs_by_page(
    runs: tuple[CurriculumCourseMapProbeRun, ...],
) -> dict[int, tuple[CurriculumCourseMapPageProbe, ...]]:
    grouped: dict[int, list[CurriculumCourseMapPageProbe]] = defaultdict(list)
    for run in runs:
        for page in run.pages:
            grouped[page.page_number].append(page)
    return {page_number: tuple(items) for page_number, items in grouped.items()}


def _slot_surface(finding: CourseMapFinding | None) -> dict[str, set[object]]:
    if finding is None:
        return {"titles": set(), "nodes": set(), "edges": set()}
    titles = {_normalize_label(finding.map_title)} if (finding.map_title or "").strip() else set()
    nodes = {_normalize_label(node.node_label) for node in finding.nodes if node.node_label.strip()}
    edges = {
        (_normalize_label(edge.source_label), _normalize_label(edge.target_label))
        for edge in finding.edges
        if edge.source_label.strip() and edge.target_label.strip()
    }
    return {"titles": titles, "nodes": nodes, "edges": edges}


def _stable_slot_surface(
    *,
    probes: tuple[CurriculumCourseMapPageProbe, ...],
    map_index: int,
) -> dict[str, object]:
    present_surfaces: list[dict[str, set[object]]] = []
    for probe in probes:
        if map_index > len(probe.course_maps):
            return {"present": False, "titles": set(), "nodes": set(), "edges": set()}
        present_surfaces.append(_slot_surface(probe.course_maps[map_index - 1]))
    titles = set(present_surfaces[0]["titles"])
    nodes = set(present_surfaces[0]["nodes"])
    edges = set(present_surfaces[0]["edges"])
    for surface in present_surfaces[1:]:
        titles &= set(surface["titles"])
        nodes &= set(surface["nodes"])
        edges &= set(surface["edges"])
    return {"present": True, "titles": titles, "nodes": nodes, "edges": edges}


def _load_split_manifest_document_ranges(
    split_manifest_bytes: bytes,
) -> tuple[tuple[str, str, int, int], ...]:
    payload = json.loads(split_manifest_bytes)
    documents = payload.get("documents") or ()
    ranges: list[tuple[str, str, int, int]] = []
    for item in documents:
        document_id = str(item.get("document_id") or "").strip()
        document_title = str(item.get("title") or "").strip()
        page_start = int(item.get("page_start") or 0)
        page_end = int(item.get("page_end") or 0)
        if not document_id or not document_title or page_start <= 0 or page_end < page_start:
            raise ValueError("split manifest contains invalid document range")
        ranges.append((document_id, document_title, page_start, page_end))
    if not ranges:
        raise ValueError("split manifest does not contain any documents")
    return tuple(ranges)


def _resolve_document_for_page(
    *,
    document_ranges: tuple[tuple[str, str, int, int], ...],
    page_number: int,
) -> tuple[str, str] | None:
    for document_id, document_title, page_start, page_end in document_ranges:
        if page_start <= page_number <= page_end:
            return document_id, document_title
    return None


def _is_curriculum_course_map_candidate(parent_heading_hint: str) -> bool:
    return bool(_COURSE_MAP_HINT_RE.search(parent_heading_hint.strip()))


def _load_jsonl_bytes(payload: bytes) -> tuple[dict[str, object], ...]:
    rows: list[dict[str, object]] = []
    for line in payload.decode("utf-8").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        row = json.loads(stripped)
        if not isinstance(row, dict):
            raise ValueError("jsonl row must be a JSON object")
        rows.append(row)
    return tuple(rows)


def _coerce_bbox(value: object) -> tuple[float, float, float, float]:
    if not isinstance(value, (list, tuple)) or len(value) != 4:
        raise ValueError("bbox must contain four numbers")
    bbox = tuple(float(item) for item in value)
    if bbox[2] <= bbox[0] or bbox[3] <= bbox[1]:
        raise ValueError("bbox must have positive area")
    return bbox


def _coerce_normalized_bbox(value: object) -> tuple[float, float, float, float]:
    bbox = _coerce_bbox(value)
    x0, y0, x1, y1 = bbox
    return (
        max(0.0, min(1.0, x0)),
        max(0.0, min(1.0, y0)),
        max(0.0, min(1.0, x1)),
        max(0.0, min(1.0, y1)),
    )


def _normalize_label(value: str) -> str:
    normalized = value.strip().translate(_NORMALIZE_TRANSLATION)
    normalized = _DASH_RE.sub("-", normalized)
    normalized = _WHITESPACE_RE.sub("", normalized)
    return normalized.lower()


def _jaccard(left: set[object], right: set[object]) -> float:
    if not left and not right:
        return 1.0
    union = left | right
    if not union:
        return 1.0
    return len(left & right) / len(union)


def _recall(*, expected: set[object], actual: set[object]) -> float:
    if not expected:
        return 1.0
    return len(expected & actual) / len(expected)


def _mean(values: list[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)


def _write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


__all__ = [
    "CURRICULUM_COURSE_MAP_GOLD_MANIFEST_VERSION",
    "CURRICULUM_COURSE_MAP_PROBE_SCHEMA_VERSION",
    "CURRICULUM_COURSE_MAP_SAMPLE_MANIFEST_VERSION",
    "CourseMapEdge",
    "CourseMapFinding",
    "CourseMapNode",
    "CurriculumCourseMapAdmissionSummary",
    "CurriculumCourseMapGoldExpectation",
    "CurriculumCourseMapGoldMapExpectation",
    "CurriculumCourseMapGoldPageScore",
    "CurriculumCourseMapGoldReport",
    "CurriculumCourseMapInventoryEntry",
    "CurriculumCourseMapPageProbe",
    "CurriculumCourseMapProbeReport",
    "CurriculumCourseMapProbeRun",
    "CurriculumCourseMapRenderedRegion",
    "CurriculumCourseMapRenderedSample",
    "CurriculumCourseMapRepeatabilityPageScore",
    "CurriculumCourseMapRepeatabilityReport",
    "CurriculumCourseMapSampleSelection",
    "DetectedCourseMapRegion",
    "build_curriculum_course_map_admission_summary",
    "build_curriculum_course_map_gold_report",
    "build_curriculum_course_map_inventory",
    "build_curriculum_course_map_repeatability_report",
    "default_curriculum_layout_elements_key",
    "default_curriculum_provider_response_key",
    "default_curriculum_source_pdf_key",
    "derive_provider_canvas",
    "load_curriculum_course_map_gold_manifest",
    "load_curriculum_course_map_sample_manifest",
    "load_provider_page_heights",
    "project_provider_bbox_to_pdf_rect",
    "render_curriculum_course_map_sample",
    "run_curriculum_course_map_multimodal_probe",
    "select_curriculum_course_map_samples",
]
