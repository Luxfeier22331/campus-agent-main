from __future__ import annotations

import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import IndexableChunk

INTERNAL_NOTICE_SCOPE = ("campus_notices", "internal_notice")
DEFAULT_INTERNAL_NOTICE_SAMPLE_SEED = 20260406
_NOTICE_BODY_LANE = "notice_body"
_ATTACHMENT_TEXT_LANE = "attachment_text_extractable"
_ATTACHMENT_OCR_LANE = "attachment_ocr_required"
_TEXTUAL_CHUNK_UNIT_TYPES = frozenset(
    {"article_body", "attachment_body", "section_text", "table_unit"}
)
_ATTACHMENT_SUBSTANTIVE_CHUNK_UNIT_TYPES = frozenset(
    {"attachment_body", "section_text", "table_unit"}
)
_ATTACHMENT_OCR_NOISE_UNIT_TYPES = frozenset({"attachment_body", "section_text"})
_ATTACHMENT_LINEAGE_FIELDS = (
    "parent_document_id",
    "attachment_ref_id",
    "attachment_filename",
    "attachment_kind",
    "attachment_role",
    "extraction_class",
)
_MARKUP_LEAK_RE = re.compile(r"<(?:/?[a-zA-Z][^>\n]{0,120}|!--)")
_USEFUL_CHAR_RE = re.compile(r"[\u4e00-\u9fffA-Za-z0-9]")
_NON_SPACE_RE = re.compile(r"\S")
_SAFE_FILENAME_RE = re.compile(r"[^a-z0-9]+")
_NOTICE_BODY_FRAGMENT_FINAL_TOKEN_THRESHOLD = 48
_OCR_HEADER_DOMINANT_RATIO_THRESHOLD = 0.4
_OCR_HEADER_DOMINANT_DISPLAY_TOKEN_THRESHOLD = 80
_OCR_USEFUL_CHAR_RATIO_THRESHOLD = 0.55
_OCR_SHORT_LINE_RATIO_THRESHOLD = 0.6


class InternalNoticeChunkValidationArtifactReader(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


@dataclass(frozen=True, slots=True)
class InternalNoticeChunkValidationFailure:
    document_id: str
    title: str
    artifact_key: str | None
    error: str


@dataclass(frozen=True, slots=True)
class InternalNoticeNoticeRiskProfile:
    notice_id: str
    notice_risk_label: str
    attachment_mix_score: int
    attachment_ref_count: int
    has_text_table_attachment: bool
    has_spatial_attachment: bool
    has_reference_only_attachment: bool


@dataclass(frozen=True, slots=True)
class InternalNoticeValidationInputs:
    source: dict[str, str]
    registry: object | None
    object_store: InternalNoticeChunkValidationArtifactReader
    derived_bucket: str
    corpus: str
    collection: str
    records: tuple[DocumentRegistryRecord, ...]
    selected_records: tuple[DocumentRegistryRecord, ...]
    selection_mode: Literal["current_scope", "verified_closeout_run"]
    preparation_run_id: str | None
    closeout_run_id: str | None
    missing_manifest_records: tuple[str, ...]
    notice_risk_profiles: dict[str, InternalNoticeNoticeRiskProfile]
    notice_risk_counts: dict[str, int]
    high_risk_notice_count: int


@dataclass(frozen=True, slots=True)
class InternalNoticeScannedDocument:
    title: str
    lane: str
    notice_id: str
    notice_risk_profile: InternalNoticeNoticeRiskProfile | None
    record: DocumentRegistryRecord
    rows: tuple[dict[str, object], ...]
    chunks: tuple[IndexableChunk, ...]
    read_failure: InternalNoticeChunkValidationFailure | None = None
    chunk_failure: InternalNoticeChunkValidationFailure | None = None


@dataclass(frozen=True, slots=True)
class InternalNoticeChunkingScanResult:
    mode: Literal["full", "samples"]
    inputs: InternalNoticeValidationInputs
    documents: tuple[InternalNoticeScannedDocument, ...]


@dataclass(frozen=True, slots=True)
class InternalNoticeChunkingValidationReport:
    passed: bool
    corpus: str
    collection: str
    selection_mode: str
    preparation_run_id: str | None
    closeout_run_id: str | None
    registry_record_count: int
    selected_record_count: int
    validated_document_count: int
    total_units: int
    total_chunks: int
    lane_document_counts: dict[str, int]
    lane_chunk_counts: dict[str, int]
    unit_type_counts: dict[str, int]
    split_reason_counts: dict[str, int]
    header_mode_counts: dict[str, int]
    notice_risk_counts: dict[str, int]
    high_risk_notice_count: int
    read_failures: tuple[InternalNoticeChunkValidationFailure, ...]
    chunk_failures: tuple[InternalNoticeChunkValidationFailure, ...]
    missing_manifest_records: tuple[str, ...]
    empty_document_ids: tuple[str, ...]
    missing_title_chunk_count: int
    missing_contextualization_count: int
    missing_lane_metadata_count: int
    missing_attachment_lineage_count: int
    attachment_without_body_count: int
    notice_body_fragmentation_count: int
    notice_body_token_guardrail_chunk_count: int
    markup_leak_chunk_count: int
    replacement_character_chunk_count: int
    header_dominant_ocr_chunk_count: int
    noisy_ocr_chunk_count: int


def _record_key(record: DocumentRegistryRecord) -> tuple[str, str, str]:
    return (record.document_id, record.revision_track, record.version_id)


def _resolve_notice_id_from_document_id(document_id: str) -> str:
    parts = [part.strip() for part in str(document_id).split(":")]
    if len(parts) >= 3 and parts[0] in {"notice", "notice_attachment"} and parts[2]:
        return parts[2]
    return str(document_id).strip()


def _derive_document_title(rows: Sequence[dict[str, object]]) -> str | None:
    for row in rows:
        metadata = dict(row.get("metadata") or {})
        title = str(metadata.get("title") or "").strip()
        if title:
            return title
    for row in rows:
        if str(row.get("unit_type") or "") in {"policy_page", "attachment_title"}:
            title = str(row.get("clean_text") or row.get("text") or "").strip()
            if title:
                return title
    for row in rows:
        title = str(row.get("clean_text") or row.get("text") or "").strip()
        if title:
            return title
    return None


def _document_has_stable_title_source(rows: Sequence[dict[str, object]]) -> bool:
    for row in rows:
        metadata = dict(row.get("metadata") or {})
        if str(metadata.get("title") or "").strip():
            return True
    for row in rows:
        if str(row.get("unit_type") or "") in {"policy_page", "attachment_title"}:
            title = str(row.get("clean_text") or row.get("text") or "").strip()
            if title:
                return True
    return False


def _load_rows(structured_jsonl_bytes: bytes) -> list[dict[str, object]]:
    return [
        json.loads(line)
        for line in structured_jsonl_bytes.decode("utf-8").splitlines()
        if line.strip()
    ]


def _resolve_max_workers(source: dict[str, str]) -> int:
    value = str(source.get("INTERNAL_NOTICE_CHUNK_VALIDATION_MAX_WORKERS") or "8").strip()
    try:
        return max(1, int(value))
    except ValueError:
        return 8


def _require_document_units_key(record: DocumentRegistryRecord) -> str:
    if not record.document_units_object_key:
        raise ValueError("document_units_object_key is required")
    return record.document_units_object_key


def _chunk_unit_type(chunk: IndexableChunk) -> str:
    return str(chunk.metadata.get("unit_type") or "unknown")


def _resolve_chunk_title(chunk: IndexableChunk) -> str:
    return str(chunk.metadata.get("title") or "").strip()


def _resolve_display_text(chunk: IndexableChunk) -> str:
    return str(chunk.metadata.get("display_text") or chunk.text or "")


def _has_attachment_lineage(chunk: IndexableChunk) -> bool:
    return all(
        str(chunk.metadata.get(field_name) or "").strip()
        for field_name in _ATTACHMENT_LINEAGE_FIELDS
    )


def _contains_markup_leak(text: str) -> bool:
    return bool(_MARKUP_LEAK_RE.search(text))


def _is_fragmented_notice_body_chunk(
    *,
    chunk: IndexableChunk,
    document_chunk_count: int,
) -> bool:
    if document_chunk_count <= 1 or _chunk_unit_type(chunk) != "article_body":
        return False
    final_token_count = int(chunk.metadata.get("final_token_count") or 0)
    if final_token_count >= _NOTICE_BODY_FRAGMENT_FINAL_TOKEN_THRESHOLD:
        return False
    return bool(str(chunk.metadata.get("split_reason") or "").strip())


def _is_header_dominant_ocr_chunk(chunk: IndexableChunk) -> bool:
    final_token_count = int(chunk.metadata.get("final_token_count") or 0)
    display_token_count = int(chunk.metadata.get("display_token_count") or 0)
    header_token_count = int(chunk.metadata.get("header_token_count") or 0)
    if final_token_count <= 0 or display_token_count <= 0:
        return False
    if display_token_count >= _OCR_HEADER_DOMINANT_DISPLAY_TOKEN_THRESHOLD:
        return False
    return (header_token_count / final_token_count) > _OCR_HEADER_DOMINANT_RATIO_THRESHOLD


def _looks_like_noisy_ocr_chunk(text: str) -> bool:
    normalized = text.strip()
    if not normalized:
        return False
    non_space_matches = _NON_SPACE_RE.findall(normalized)
    if not non_space_matches:
        return False
    useful_char_ratio = len(_USEFUL_CHAR_RE.findall(normalized)) / len(non_space_matches)
    lines = [line.strip() for line in normalized.splitlines() if line.strip()]
    short_line_ratio = 0.0
    if lines:
        short_line_ratio = sum(1 for line in lines if len(line) <= 3) / len(lines)
    if (
        useful_char_ratio < _OCR_USEFUL_CHAR_RATIO_THRESHOLD
        and short_line_ratio > _OCR_SHORT_LINE_RATIO_THRESHOLD
    ):
        return True
    return useful_char_ratio < 0.35


def _safe_filename(value: str) -> str:
    normalized = _SAFE_FILENAME_RE.sub("-", value.lower()).strip("-")
    return normalized or "sample"
