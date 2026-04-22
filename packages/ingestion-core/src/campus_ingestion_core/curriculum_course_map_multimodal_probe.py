from __future__ import annotations

import json
import re
from base64 import b64encode
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Literal, Protocol

import httpx

from campus_ingestion_core.object_store import (
    build_raw_asset_key,
    build_source_provider_artifact_key,
    build_source_truth_artifact_key,
)

CURRICULUM_COURSE_MAP_PROBE_SCHEMA_VERSION = "curriculum_course_map_multimodal_probe_v1"
CURRICULUM_COURSE_MAP_SAMPLE_MANIFEST_VERSION = "curriculum_course_map_probe_samples_v1"
CURRICULUM_COURSE_MAP_GOLD_MANIFEST_VERSION = "curriculum_course_map_probe_gold_v1"
DEFAULT_CURRICULUM_RAW_ASSET_ID = "asset:curriculum-plan-2022"
DEFAULT_CURRICULUM_RAW_VERSION_ID = (
    "sha256:0416e3d70c48d86238d2869c477ab60407ddbb9a09a76bee57aaeb0c97ab3f67"
)
DEFAULT_CURRICULUM_YEAR = "2022"
DEFAULT_OCR_MODEL_SLUG = "paddleocr-vl-1-5"
DEFAULT_RENDER_DPI = 180
DEFAULT_PROMPT_RUNTIME_BASE_URL = "https://api.openai.com/v1"
DEFAULT_PROMPT_RUNTIME_TRANSPORT = "responses"
DEFAULT_PROMPT_RUNTIME_CONNECT_TIMEOUT_SECONDS = 10.0
DEFAULT_PROMPT_RUNTIME_READ_TIMEOUT_SECONDS = 60.0
DEFAULT_PROMPT_RUNTIME_WRITE_TIMEOUT_SECONDS = 10.0
DEFAULT_PROMPT_RUNTIME_POOL_TIMEOUT_SECONDS = 3.0
DEFAULT_SAMPLE_MANIFEST_PATH = Path(
    "configs/ingestion/curriculum/curriculum_plan/course-map-probe-samples.v1.json"
)
DEFAULT_GOLD_MANIFEST_PATH = Path(
    "configs/ingestion/curriculum/curriculum_plan/course-map-probe-gold.v1.json"
)
DEFAULT_SPLIT_MANIFEST_PATH = Path(
    "configs/ingestion/curriculum/curriculum_plan/split-manifest.v1.json"
)
DEFAULT_PROMPT_RUNS = 3
DEFAULT_REPEATABILITY_THRESHOLD = 0.78
DEFAULT_GOLD_PASS_RATE_THRESHOLD = 0.66
DEFAULT_REPEATABILITY_PASS_RATE_THRESHOLD = 0.75
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
class CurriculumCourseMapGoldExpectation:
    page_number: int
    document_id: str
    document_title: str
    expected_map_titles: tuple[str, ...]
    expected_node_labels: tuple[str, ...]
    expected_edges: tuple[tuple[str, str], ...]
    min_title_recall: float = 1.0
    min_node_recall: float = 0.6
    min_edge_recall: float = 0.5

    def __post_init__(self) -> None:
        if self.page_number <= 0:
            raise ValueError("page_number must be greater than zero")
        if not self.document_id.strip():
            raise ValueError("document_id is required")
        if not self.document_title.strip():
            raise ValueError("document_title is required")


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
    map_title: str
    stage_labels: tuple[str, ...]
    nodes: tuple[CourseMapNode, ...]
    edges: tuple[CourseMapEdge, ...]
    manual_review_notes: tuple[str, ...]

    def __post_init__(self) -> None:
        if not self.map_title.strip():
            raise ValueError("map_title is required")


@dataclass(frozen=True, slots=True)
class CurriculumCourseMapPageProbe:
    sample_id: str
    page_number: int
    document_id: str
    document_title: str
    parent_heading_hint: str
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
) -> CurriculumCourseMapProbeReport:
    if prompt_runs <= 0:
        raise ValueError("prompt_runs must be greater than zero")
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
            bucket=source_bucket, key=provider_response_key
        )
    if layout_elements_bytes is None:
        if runtime_object_store is None:
            raise ValueError("object_store is required when layout_elements_bytes is not provided")
        layout_elements_bytes = runtime_object_store.get_bytes(
            bucket=source_bucket, key=layout_elements_key
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
        _write_json(output_path / "inventory.json", [asdict(item) for item in inventory])
        _write_json(
            output_path / "selected-samples.json",
            [
                {
                    "selection": asdict(selection),
                    "inventory": asdict(entry),
                }
                for selection, entry in selected_entries
            ],
        )

    runs = tuple(
        CurriculumCourseMapProbeRun(
            run_index=run_index,
            pages=tuple(
                probe_curriculum_course_map_page(
                    source=source,
                    rendered_sample=sample,
                )
                for sample in rendered_samples
            ),
        )
        for run_index in range(1, prompt_runs + 1)
    )
    repeatability = build_curriculum_course_map_repeatability_report(
        runs=runs,
        threshold=repeatability_threshold,
    )
    gold = build_curriculum_course_map_gold_report(
        runs=runs,
        gold_manifest=gold_manifest,
    )
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
        owner = _resolve_document_for_page(
            document_ranges=document_ranges,
            page_number=page_number,
        )
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
            expected_map_titles=tuple(
                str(value).strip() for value in item.get("expected_map_titles") or ()
            ),
            expected_node_labels=tuple(
                str(value).strip() for value in item.get("expected_node_labels") or ()
            ),
            expected_edges=tuple(
                (str(pair[0]).strip(), str(pair[1]).strip())
                for pair in item.get("expected_edges") or ()
            ),
            min_title_recall=float(item.get("min_title_recall") or 1.0),
            min_node_recall=float(item.get("min_node_recall") or 0.6),
            min_edge_recall=float(item.get("min_edge_recall") or 0.5),
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


def probe_curriculum_course_map_page(
    *,
    source: dict[str, str],
    rendered_sample: CurriculumCourseMapRenderedSample,
) -> CurriculumCourseMapPageProbe:
    api_key = (source.get("PROMPT_RUNTIME_API_KEY") or source.get("LLM_API_KEY") or "").strip()
    model_name = (source.get("PROMPT_RUNTIME_MODEL") or "").strip()
    base_url = (
        source.get("PROMPT_RUNTIME_BASE_URL")
        or source.get("LLM_BASE_URL")
        or DEFAULT_PROMPT_RUNTIME_BASE_URL
    ).strip()
    transport = (source.get("PROMPT_RUNTIME_TRANSPORT") or DEFAULT_PROMPT_RUNTIME_TRANSPORT).strip()
    reasoning_effort = (source.get("PROMPT_RUNTIME_REASONING_EFFORT") or "").strip()
    max_output_tokens = (source.get("PROMPT_RUNTIME_MAX_OUTPUT_TOKENS") or "").strip()
    if not api_key:
        raise ValueError("PROMPT_RUNTIME_API_KEY is required for curriculum course-map probe")
    if not model_name:
        raise ValueError("PROMPT_RUNTIME_MODEL is required for curriculum course-map probe")
    parsed_transport = _normalize_prompt_runtime_transport(transport)
    raw_payload = _request_course_map_probe_payload(
        transport=parsed_transport,
        api_key=api_key,
        model_name=model_name,
        base_url=base_url,
        reasoning_effort=reasoning_effort or None,
        max_output_tokens=int(max_output_tokens) if max_output_tokens else None,
        rendered_sample=rendered_sample,
    )
    return _coerce_curriculum_course_map_page_probe(
        sample_id=rendered_sample.sample_id,
        page_number=rendered_sample.page_number,
        document_id=rendered_sample.document_id,
        document_title=rendered_sample.document_title,
        parent_heading_hint=rendered_sample.parent_heading_hint,
        payload=raw_payload,
    )


def _request_course_map_probe_response(
    *,
    api_key: str,
    model_name: str,
    base_url: str,
    reasoning_effort: str | None,
    max_output_tokens: int | None,
    rendered_sample: CurriculumCourseMapRenderedSample,
) -> dict[str, object]:
    schema = _curriculum_course_map_page_probe_schema()
    schema_json = json.dumps(schema, ensure_ascii=False, separators=(",", ":"))
    content: list[dict[str, object]] = [
        {
            "type": "input_text",
            "text": (
                f"Document title: {rendered_sample.document_title}\n"
                f"Page number: {rendered_sample.page_number}\n"
                f"Parent heading hint: {rendered_sample.parent_heading_hint or '<none>'}\n"
                "Image 1 is the full PDF page.\n"
                "Image 2 is the bounded crop for the detected course-map image block.\n"
                "Extract only visible course maps, visible node labels, and visible directed arrows."
            ),
        },
        {
            "type": "input_image",
            "image_url": f"data:image/png;base64,{b64encode(rendered_sample.full_page_png).decode('ascii')}",
        },
        {
            "type": "input_image",
            "image_url": f"data:image/png;base64,{b64encode(rendered_sample.crop_png).decode('ascii')}",
        },
    ]
    payload: dict[str, object] = {
        "model": model_name,
        "stream": False,
        "input": [
            {
                "role": "system",
                "type": "message",
                "content": [
                    {
                        "type": "input_text",
                        "text": (
                            "You are auditing a bounded curriculum course-map page. "
                            "Return only high-confidence visible course-map structures. "
                            "Do not infer hidden prerequisites, hidden course names, or off-page content."
                        ),
                    }
                ],
            },
            {
                "role": "user",
                "type": "message",
                "content": content,
            },
        ],
        "text": {
            "format": {
                "type": "json_schema",
                "name": "curriculum_course_map_page_probe",
                "schema": schema,
                "strict": True,
            }
        },
    }
    if reasoning_effort:
        payload["reasoning"] = {"effort": reasoning_effort}
    if max_output_tokens is not None:
        payload["max_output_tokens"] = max_output_tokens
    with httpx.Client(base_url=base_url, timeout=_DEFAULT_TIMEOUT) as client:
        response = client.post(
            "/responses",
            json=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )
        if response.status_code >= 500:
            fallback_content = list(content)
            fallback_content[0] = {
                "type": "input_text",
                "text": (
                    f"{content[0]['text']}\n"
                    "Return exactly one JSON object with no markdown fences, no prose, and no extra keys. "
                    f"Match this schema exactly: {schema_json}"
                ),
            }
            fallback_payload: dict[str, object] = {
                "model": model_name,
                "stream": False,
                "input": [
                    {
                        "role": "system",
                        "type": "message",
                        "content": [
                            {
                                "type": "input_text",
                                "text": (
                                    "You are auditing a bounded curriculum course-map page. "
                                    "Return only high-confidence visible course-map structures. "
                                    "Do not infer hidden prerequisites, hidden course names, or off-page content. "
                                    "Return a single JSON object only."
                                ),
                            }
                        ],
                    },
                    {
                        "role": "user",
                        "type": "message",
                        "content": fallback_content,
                    },
                ],
            }
            if reasoning_effort:
                fallback_payload["reasoning"] = {"effort": reasoning_effort}
            if max_output_tokens is not None:
                fallback_payload["max_output_tokens"] = max_output_tokens
            fallback_response = client.post(
                "/responses",
                json=fallback_payload,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
            )
            if fallback_response.is_success:
                response = fallback_response
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:  # pragma: no cover
        raise ValueError(
            f"curriculum course-map probe request failed: {response.status_code} {response.text}"
        ) from exc
    response_json = response.json()
    if not isinstance(response_json, dict):
        raise ValueError("curriculum course-map probe response must be a JSON object")
    status = str(response_json.get("status") or "").strip()
    if status not in {"", "completed"}:
        raise ValueError(f"curriculum course-map probe response status {status!r}")
    if response_json.get("error"):
        raise ValueError(json.dumps(response_json["error"], ensure_ascii=False))
    return response_json


def _request_course_map_probe_chat_completion(
    *,
    api_key: str,
    model_name: str,
    base_url: str,
    reasoning_effort: str | None,
    max_output_tokens: int | None,
    rendered_sample: CurriculumCourseMapRenderedSample,
) -> dict[str, object]:
    content = _build_chat_completion_probe_content(rendered_sample=rendered_sample)
    payload: dict[str, object] = {
        "model": model_name,
        "messages": [
            {
                "role": "system",
                "content": (
                    "You are auditing a bounded curriculum course-map page. "
                    "Return only high-confidence visible course-map structures. "
                    "Do not infer hidden prerequisites, hidden course names, or off-page content. "
                    "Return a single JSON object only. No markdown fences and no prose."
                ),
            },
            {
                "role": "user",
                "content": content,
            },
        ],
    }
    if reasoning_effort:
        payload["reasoning_effort"] = reasoning_effort
    if max_output_tokens is not None:
        payload["max_completion_tokens"] = max_output_tokens
    with httpx.Client(base_url=base_url, timeout=_DEFAULT_TIMEOUT) as client:
        response = client.post(
            "/chat/completions",
            json=payload,
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
        )
    try:
        response.raise_for_status()
    except httpx.HTTPStatusError as exc:  # pragma: no cover
        raise ValueError(
            f"curriculum course-map probe request failed: {response.status_code} {response.text}"
        ) from exc
    response_json = response.json()
    if not isinstance(response_json, dict):
        raise ValueError("curriculum course-map probe response must be a JSON object")
    if response_json.get("error"):
        raise ValueError(json.dumps(response_json["error"], ensure_ascii=False))
    return response_json


def _build_chat_completion_probe_content(
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
                "Image 2 is the bounded crop for the detected course-map image block.\n"
                "Extract only visible course maps, visible node labels, and visible directed arrows.\n"
                "Return exactly one JSON object with keys course_maps, manual_review_required, "
                "global_manual_review_notes.\n"
                "Each course_maps item must contain map_title, stage_labels, nodes, edges, "
                "manual_review_notes.\n"
                "Each node must contain node_label, stage_label, category_label.\n"
                "Each edge must contain source_label, target_label."
            ),
        },
        {
            "type": "image_url",
            "image_url": {
                "url": (
                    f"data:image/png;base64,{b64encode(rendered_sample.full_page_png).decode('ascii')}"
                )
            },
        },
        {
            "type": "image_url",
            "image_url": {
                "url": (
                    f"data:image/png;base64,{b64encode(rendered_sample.crop_png).decode('ascii')}"
                )
            },
        },
    ]


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
                return json.loads(text)
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
        return json.loads(content)
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
            return json.loads("\n".join(parts))
    raise ValueError("curriculum course-map chat completion missing parsed output")


def _coerce_curriculum_course_map_page_probe(
    *,
    sample_id: str,
    page_number: int,
    document_id: str,
    document_title: str,
    parent_heading_hint: str,
    payload: object,
) -> CurriculumCourseMapPageProbe:
    if not isinstance(payload, dict):
        raise ValueError("curriculum course-map page probe payload must be a JSON object")
    return CurriculumCourseMapPageProbe(
        sample_id=sample_id,
        page_number=page_number,
        document_id=document_id,
        document_title=document_title,
        parent_heading_hint=parent_heading_hint,
        course_maps=tuple(
            CourseMapFinding(
                map_title=str(item.get("map_title") or "").strip(),
                stage_labels=tuple(str(value).strip() for value in item.get("stage_labels") or ()),
                nodes=tuple(
                    CourseMapNode(
                        node_label=str(node.get("node_label") or "").strip(),
                        stage_label=str(node.get("stage_label") or "").strip(),
                        category_label=str(node.get("category_label") or "").strip(),
                    )
                    for node in item.get("nodes") or ()
                ),
                edges=tuple(
                    CourseMapEdge(
                        source_label=str(edge.get("source_label") or "").strip(),
                        target_label=str(edge.get("target_label") or "").strip(),
                    )
                    for edge in item.get("edges") or ()
                ),
                manual_review_notes=tuple(
                    str(value).strip() for value in item.get("manual_review_notes") or ()
                ),
            )
            for item in payload.get("course_maps") or ()
        ),
        manual_review_required=bool(payload.get("manual_review_required", False)),
        global_manual_review_notes=tuple(
            str(value).strip() for value in payload.get("global_manual_review_notes") or ()
        ),
    )


PromptRuntimeTransport = Literal["responses", "chat_completions"]


def _normalize_prompt_runtime_transport(raw_transport: str) -> PromptRuntimeTransport:
    normalized = raw_transport.strip().lower()
    if normalized in {"", "responses"}:
        return "responses"
    if normalized in {"chat_completions", "chat-completions", "chat/completions"}:
        return "chat_completions"
    raise ValueError("PROMPT_RUNTIME_TRANSPORT must be one of responses or chat_completions")


def _request_course_map_probe_payload(
    *,
    transport: PromptRuntimeTransport,
    api_key: str,
    model_name: str,
    base_url: str,
    reasoning_effort: str | None,
    max_output_tokens: int | None,
    rendered_sample: CurriculumCourseMapRenderedSample,
) -> object:
    if transport == "responses":
        response_json = _request_course_map_probe_response(
            api_key=api_key,
            model_name=model_name,
            base_url=base_url,
            reasoning_effort=reasoning_effort,
            max_output_tokens=max_output_tokens,
            rendered_sample=rendered_sample,
        )
        raw_payload = response_json.get("output_parsed")
        if raw_payload is None:
            raw_payload = _extract_output_parsed(response_json)
        return raw_payload
    response_json = _request_course_map_probe_chat_completion(
        api_key=api_key,
        model_name=model_name,
        base_url=base_url,
        reasoning_effort=reasoning_effort,
        max_output_tokens=max_output_tokens,
        rendered_sample=rendered_sample,
    )
    return _extract_chat_completions_output_parsed(response_json)


def _curriculum_course_map_page_probe_schema() -> dict[str, object]:
    return {
        "type": "object",
        "additionalProperties": False,
        "required": ["course_maps", "manual_review_required", "global_manual_review_notes"],
        "properties": {
            "manual_review_required": {"type": "boolean"},
            "global_manual_review_notes": {
                "type": "array",
                "items": {"type": "string"},
            },
            "course_maps": {
                "type": "array",
                "items": {
                    "type": "object",
                    "additionalProperties": False,
                    "required": [
                        "map_title",
                        "stage_labels",
                        "nodes",
                        "edges",
                        "manual_review_notes",
                    ],
                    "properties": {
                        "map_title": {"type": "string"},
                        "stage_labels": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
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
                        "manual_review_notes": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                    },
                },
            },
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
        title_scores: list[float] = []
        node_scores: list[float] = []
        edge_scores: list[float] = []
        count_scores: list[float] = []
        comparisons = 0
        for left_index in range(len(probes)):
            for right_index in range(left_index + 1, len(probes)):
                left = probes[left_index]
                right = probes[right_index]
                comparisons += 1
                left_surface = _page_surface(left)
                right_surface = _page_surface(right)
                title_scores.append(_jaccard(left_surface["titles"], right_surface["titles"]))
                node_scores.append(_jaccard(left_surface["nodes"], right_surface["nodes"]))
                edge_scores.append(_jaccard(left_surface["edges"], right_surface["edges"]))
                count_scores.append(
                    1.0 if left_surface["map_count"] == right_surface["map_count"] else 0.0
                )
        title_jaccard = _mean(title_scores) if title_scores else 1.0
        node_jaccard = _mean(node_scores) if node_scores else 1.0
        edge_jaccard = _mean(edge_scores) if edge_scores else 1.0
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
        stable_surface = _stable_page_surface(probes)
        title_recall = _recall(
            expected={_normalize_label(value) for value in expectation.expected_map_titles},
            actual=stable_surface["titles"],
        )
        node_recall = _recall(
            expected={_normalize_label(value) for value in expectation.expected_node_labels},
            actual=stable_surface["nodes"],
        )
        edge_recall = _recall(
            expected={
                (_normalize_label(left), _normalize_label(right))
                for left, right in expectation.expected_edges
            },
            actual=stable_surface["edges"],
        )
        passed = (
            title_recall >= expectation.min_title_recall
            and node_recall >= expectation.min_node_recall
            and edge_recall >= expectation.min_edge_recall
        )
        page_scores.append(
            CurriculumCourseMapGoldPageScore(
                page_number=expectation.page_number,
                document_id=expectation.document_id,
                title_recall=round(title_recall, 4),
                node_recall=round(node_recall, 4),
                edge_recall=round(edge_recall, 4),
                stable_titles=tuple(sorted(stable_surface["titles"])),
                stable_nodes=tuple(sorted(stable_surface["nodes"])),
                stable_edges=tuple(sorted(stable_surface["edges"])),
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


def _page_surface(page: CurriculumCourseMapPageProbe) -> dict[str, object]:
    titles = {
        _normalize_label(course_map.map_title)
        for course_map in page.course_maps
        if course_map.map_title.strip()
    }
    nodes = {
        _normalize_label(node.node_label)
        for course_map in page.course_maps
        for node in course_map.nodes
        if node.node_label.strip()
    }
    edges = {
        (_normalize_label(edge.source_label), _normalize_label(edge.target_label))
        for course_map in page.course_maps
        for edge in course_map.edges
        if edge.source_label.strip() and edge.target_label.strip()
    }
    return {
        "titles": titles,
        "nodes": nodes,
        "edges": edges,
        "map_count": len(page.course_maps),
    }


def _stable_page_surface(
    probes: tuple[CurriculumCourseMapPageProbe, ...],
) -> dict[str, set[object]]:
    if not probes:
        raise ValueError("stable page surface requires at least one page probe")
    surfaces = tuple(_page_surface(probe) for probe in probes)
    stable_titles = set(surfaces[0]["titles"])
    stable_nodes = set(surfaces[0]["nodes"])
    stable_edges = set(surfaces[0]["edges"])
    for surface in surfaces[1:]:
        stable_titles &= set(surface["titles"])
        stable_nodes &= set(surface["nodes"])
        stable_edges &= set(surface["edges"])
    return {
        "titles": stable_titles,
        "nodes": stable_nodes,
        "edges": stable_edges,
    }


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
    if not isinstance(value, list | tuple) or len(value) != 4:
        raise ValueError("bbox must contain four numbers")
    bbox = tuple(float(item) for item in value)
    if bbox[2] <= bbox[0] or bbox[3] <= bbox[1]:
        raise ValueError("bbox must have positive area")
    return bbox


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
    "CurriculumCourseMapAdmissionSummary",
    "CurriculumCourseMapGoldExpectation",
    "CurriculumCourseMapGoldPageScore",
    "CurriculumCourseMapGoldReport",
    "CurriculumCourseMapInventoryEntry",
    "CurriculumCourseMapPageProbe",
    "CurriculumCourseMapProbeReport",
    "CurriculumCourseMapProbeRun",
    "CurriculumCourseMapRenderedSample",
    "CurriculumCourseMapRepeatabilityPageScore",
    "CurriculumCourseMapRepeatabilityReport",
    "CurriculumCourseMapSampleSelection",
    "CourseMapEdge",
    "CourseMapFinding",
    "CourseMapNode",
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
    "probe_curriculum_course_map_page",
    "project_provider_bbox_to_pdf_rect",
    "render_curriculum_course_map_sample",
    "run_curriculum_course_map_multimodal_probe",
    "select_curriculum_course_map_samples",
]
