from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

from campus_ingestion_core.collection_source_ocr import resolve_collection_source_ocr_runtime
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
DEFAULT_OCR_MODEL_SLUG = resolve_collection_source_ocr_runtime(
    corpus="curriculum",
    collection="curriculum_plan",
).model_slug
DEFAULT_RENDER_DPI = 180
DEFAULT_MAX_INFLIGHT_PAGES = 3
DEFAULT_MAX_REQUEST_ATTEMPTS = 3
DEFAULT_COURSE_MAP_MULTIMODAL_BASE_URL = "https://api.openai.com/v1"
DEFAULT_COURSE_MAP_MULTIMODAL_TRANSPORT = "responses"
DEFAULT_COURSE_MAP_MULTIMODAL_CONNECT_TIMEOUT_SECONDS = 10.0
DEFAULT_CURRICULUM_COURSE_MAP_PROMPT_READ_TIMEOUT_SECONDS = 60.0
DEFAULT_COURSE_MAP_MULTIMODAL_WRITE_TIMEOUT_SECONDS = 10.0
DEFAULT_COURSE_MAP_MULTIMODAL_POOL_TIMEOUT_SECONDS = 3.0
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
CourseMapMultimodalTransport = Literal["responses", "chat_completions"]
_WHITESPACE_RE = re.compile(r"\s+")
_DASH_RE = re.compile(r"[—–－-]+")
_COURSE_MAP_HINT_RE = re.compile(r"(课程地图|拓扑图|拓补图|课程结构图|结果拓扑图)")
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
    provider_page_width: float | None = None

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
        if self.provider_page_width is not None and self.provider_page_width <= 0:
            raise ValueError("provider_page_width must be greater than zero")


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
    node_id: str = ""
    stage_id: str = ""

    def __post_init__(self) -> None:
        if not self.node_label.strip():
            raise ValueError("node_label is required")


@dataclass(frozen=True, slots=True)
class CourseMapEdge:
    source_label: str
    target_label: str
    source_node_id: str = ""
    target_node_id: str = ""
    edge_id: str = ""

    def __post_init__(self) -> None:
        if not self.source_node_id.strip() and not self.source_label.strip():
            raise ValueError("source_node_id or source_label is required")
        if not self.target_node_id.strip() and not self.target_label.strip():
            raise ValueError("target_node_id or target_label is required")


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
    "DEFAULT_COURSE_MAP_MULTIMODAL_BASE_URL",
    "DEFAULT_COURSE_MAP_MULTIMODAL_CONNECT_TIMEOUT_SECONDS",
    "DEFAULT_COURSE_MAP_MULTIMODAL_POOL_TIMEOUT_SECONDS",
    "DEFAULT_COURSE_MAP_MULTIMODAL_TRANSPORT",
    "DEFAULT_COURSE_MAP_MULTIMODAL_WRITE_TIMEOUT_SECONDS",
    "DEFAULT_CURRICULUM_COURSE_MAP_PROMPT_READ_TIMEOUT_SECONDS",
    "DEFAULT_CURRICULUM_RAW_ASSET_ID",
    "DEFAULT_CURRICULUM_RAW_VERSION_ID",
    "DEFAULT_CURRICULUM_YEAR",
    "DEFAULT_GOLD_MANIFEST_PATH",
    "DEFAULT_GOLD_PASS_RATE_THRESHOLD",
    "DEFAULT_MAX_INFLIGHT_PAGES",
    "DEFAULT_MAX_REQUEST_ATTEMPTS",
    "DEFAULT_OCR_MODEL_SLUG",
    "DEFAULT_PROMPT_RUNS",
    "DEFAULT_REGION_TILE_COLS",
    "DEFAULT_REGION_TILE_ROWS",
    "DEFAULT_RENDER_DPI",
    "DEFAULT_REPEATABILITY_PASS_RATE_THRESHOLD",
    "DEFAULT_REPEATABILITY_THRESHOLD",
    "DEFAULT_SAMPLE_MANIFEST_PATH",
    "DEFAULT_SPLIT_MANIFEST_PATH",
    "DEFAULT_TILE_OVERLAP_RATIO",
    "_COURSE_MAP_HINT_RE",
    "CourseMapEdge",
    "CourseMapFinding",
    "CourseMapMultimodalTransport",
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
    "ObjectStoreByteReader",
    "TitleConfidence",
    "_coerce_bbox",
    "_coerce_normalized_bbox",
    "_jaccard",
    "_mean",
    "_normalize_label",
    "_recall",
    "_write_json",
    "default_curriculum_layout_elements_key",
    "default_curriculum_provider_response_key",
    "default_curriculum_source_pdf_key",
]
