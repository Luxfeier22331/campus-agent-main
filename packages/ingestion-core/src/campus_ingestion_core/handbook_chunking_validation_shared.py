from __future__ import annotations

import json
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from typing import Literal, Protocol

from campus_ingestion_core.chunking import ChunkProfile
from campus_ingestion_core.models import DocumentRegistryRecord

DEFAULT_HANDBOOK_MANIFEST_PATH = Path(
    "configs/ingestion/regulations/student_handbook/split-manifest.v1.json"
)
HANDBOOK_SCOPE = ("regulations", "student_handbook")
PARENT_UNIT_TYPES = {"article_body", "policy_page"}
SAMPLE_BUCKETS = (
    ("structure-boundary", "触发结构优先拆分"),
    ("token-guardrail", "触发 token_guardrail"),
    ("table", "包含表格与表格行"),
    ("policy-page", "以 policy_page 为主"),
    ("plain-article", "普通 article_body"),
)
TINY_TEXTUAL_FINAL_TOKEN_THRESHOLD = 80
HEADER_DOMINANT_RATIO_THRESHOLD = 0.4
VERBOSE_HEADER_MODES = {"full_path", "compact_path", "required"}
RUNNING_HEADER_LINES = frozenset({"学生手册"})
APPENDIX_WEAK_TEXTUAL_KEYWORDS = ("申请表", "调查表", "统计表", "汇总表", "明细表", "报送时间")


class ChunkValidationArtifactReader(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def healthcheck(self, *, bucket: str) -> None: ...


@dataclass(frozen=True, slots=True)
class ChunkValidationFailure:
    document_id: str
    title: str
    artifact_key: str | None
    error: str


@dataclass(frozen=True, slots=True)
class StudentHandbookChunkingValidationReport:
    passed: bool
    chunk_policy_version: str
    tokenizer_name: str
    manifest_document_count: int
    registry_record_count: int
    registry_unique_document_count: int
    selected_source_faithful_record_count: int
    validated_document_count: int
    total_units: int
    total_chunks: int
    avg_units_per_document: float
    avg_chunks_per_document: float
    max_chunks_in_document: int
    min_chunks_in_document: int
    extra_registry_document_ids: tuple[str, ...]
    missing_registry_document_ids: tuple[str, ...]
    read_failures: tuple[ChunkValidationFailure, ...]
    chunk_failures: tuple[ChunkValidationFailure, ...]
    empty_document_ids: tuple[str, ...]
    non_table_oversize_chunk_count: int
    header_only_table_chunk_count: int
    generic_table_label_chunk_count: int
    polluted_section_path_count: int
    boilerplate_policy_page_count: int
    weak_appendix_textual_chunk_count: int
    missing_contextualization_count: int
    broken_citation_linebreak_count: int
    unclosed_citation_context_count: int
    heading_body_glue_count: int
    adjacent_overlap_duplication_count: int
    tiny_textual_chunk_count: int
    header_dominant_chunk_count: int
    small_unaggregated_chunk_count: int
    unit_type_counts: dict[str, int]
    split_reason_counts: dict[str, int]
    boundary_rule_counts: dict[str, int]
    header_mode_counts: dict[str, int]
    oversize_parent_unit_counts: dict[str, int]
    oversize_multiline_parent_unit_counts: dict[str, int]
    structure_eligible_unit_counts: dict[str, int]
    chunk_token_histogram: dict[str, int]
    header_token_histogram: dict[str, int]
    display_token_histogram: dict[str, int]


@dataclass(frozen=True, slots=True)
class StudentHandbookValidationInputs:
    source: dict[str, str]
    chunk_profile: ChunkProfile
    registry: object
    object_store: ChunkValidationArtifactReader
    derived_bucket: str
    manifest_path: Path
    manifest_titles: dict[str, str]
    records: tuple[DocumentRegistryRecord, ...]
    records_by_doc: dict[str, tuple[DocumentRegistryRecord, ...]]
    selected_records: tuple[DocumentRegistryRecord, ...]
    extra_registry_document_ids: tuple[str, ...]
    missing_registry_document_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class StudentHandbookChunkSampleCandidate:
    title: str
    document_id: str
    record: DocumentRegistryRecord
    rows: tuple[dict[str, object], ...]
    chunks: tuple[object, ...]
    split_reasons: dict[str, int]
    unit_types: dict[str, int]
    boundary_rules: dict[str, int]


@dataclass(frozen=True, slots=True)
class StudentHandbookScannedDocument:
    title: str
    record: DocumentRegistryRecord
    rows: tuple[dict[str, object], ...]
    chunks: tuple[object, ...]
    read_failure: ChunkValidationFailure | None = None
    chunk_failure: ChunkValidationFailure | None = None


@dataclass(frozen=True, slots=True)
class StudentHandbookChunkingScanResult:
    mode: Literal["full", "samples"]
    inputs: StudentHandbookValidationInputs
    documents: tuple[StudentHandbookScannedDocument, ...]


def _resolve_validation_workers(source: dict[str, str]) -> int:
    raw_value = (source.get("HANDBOOK_CHUNK_VALIDATION_WORKERS") or "4").strip()
    try:
        return max(1, int(raw_value))
    except ValueError:
        return 4


def _resolve_validation_cache_dir(source: dict[str, str]) -> Path | None:
    configured = (source.get("HANDBOOK_VALIDATION_CACHE_DIR") or "").strip()
    if not configured:
        return None
    return Path(configured)


def _load_rows(structured_jsonl_bytes: bytes) -> list[dict[str, object]]:
    return [
        json.loads(line)
        for line in structured_jsonl_bytes.decode("utf-8").splitlines()
        if line.strip()
    ]


def _build_sample_candidate(
    document: StudentHandbookScannedDocument,
) -> StudentHandbookChunkSampleCandidate:
    split_reasons = Counter(
        str(chunk.metadata.get("split_reason") or "none") for chunk in document.chunks
    )
    unit_types = Counter(
        str(chunk.metadata.get("unit_type") or "unknown") for chunk in document.chunks
    )
    boundary_rules = Counter(
        str(chunk.metadata.get("boundary_rule") or "none") for chunk in document.chunks
    )
    return StudentHandbookChunkSampleCandidate(
        title=document.title,
        document_id=document.record.document_id,
        record=document.record,
        rows=document.rows,
        chunks=document.chunks,
        split_reasons=dict(split_reasons),
        unit_types=dict(unit_types),
        boundary_rules=dict(boundary_rules),
    )


def _sample_candidate_matches_bucket(
    candidate: StudentHandbookChunkSampleCandidate,
    *,
    bucket_name: str,
) -> bool:
    if bucket_name == "structure-boundary":
        return candidate.split_reasons.get("structure_boundary", 0) > 0
    if bucket_name == "token-guardrail":
        return candidate.split_reasons.get("token_guardrail", 0) > 0
    if bucket_name == "table":
        return any(
            candidate.unit_types.get(unit_type, 0) > 0
            for unit_type in ("table", "table_row", "table_unit")
        )
    if bucket_name == "policy-page":
        return candidate.unit_types.get("policy_page", 0) > 0
    if bucket_name == "plain-article":
        return (
            candidate.unit_types.get("article_body", 0) > 0
            and candidate.split_reasons.get("structure_boundary", 0) == 0
            and candidate.split_reasons.get("token_guardrail", 0) == 0
            and candidate.unit_types.get("policy_page", 0) == 0
            and candidate.unit_types.get("table", 0) == 0
            and candidate.unit_types.get("table_row", 0) == 0
            and candidate.unit_types.get("table_unit", 0) == 0
        )
    return False


def _filter_embedding_consumable_rows(
    rows: tuple[dict[str, object], ...],
) -> tuple[dict[str, object], ...]:
    filtered: list[dict[str, object]] = []
    for row in rows:
        if str(row.get("unit_type") or "") == "table":
            continue
        filtered.append(row)
    return tuple(filtered)


def _format_value(value: object) -> str:
    if value is None:
        return "None"
    if isinstance(value, str):
        return value
    return repr(value)


def _summarize_tokens(values: list[int]) -> dict[str, int]:
    ordered = sorted(int(value) for value in values)
    if not ordered:
        return {"min": 0, "p50": 0, "p90": 0, "p95": 0, "p99": 0, "max": 0}
    return {
        "min": ordered[0],
        "p50": _percentile(ordered, 50),
        "p90": _percentile(ordered, 90),
        "p95": _percentile(ordered, 95),
        "p99": _percentile(ordered, 99),
        "max": ordered[-1],
    }


def _percentile(values: list[int], percentile: int) -> int:
    if not values:
        return 0
    rank = ((percentile * len(values)) + 99) // 100 - 1
    rank = min(max(rank, 0), len(values) - 1)
    return values[rank]
