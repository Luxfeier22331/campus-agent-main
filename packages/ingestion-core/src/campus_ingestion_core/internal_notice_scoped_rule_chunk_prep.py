from __future__ import annotations

import json
from collections import Counter
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import IndexableChunk, build_indexable_chunks_from_jsonl
from campus_ingestion_core.settings import DEFAULT_BUCKET_DERIVED

_TARGET_SCOPE = ("regulations", "scoped_rules")
_SCHEMA_VERSION = "internal_notice_scoped_rule_chunk_prep_v1"
_REQUIRED_PROJECTION_METADATA_FIELDS = (
    "document_nature",
    "promotion_source_collection",
    "regulation_title_normalized",
    "source_notice_ids",
    "source_notice_release_time",
)
_HIGH_CONFIDENCE_WRAPPER_LEAK_MARKERS = (
    "特此通知",
    "请遵照执行",
    "学校各单位、各部门",
    "现将有关事项通知如下",
)
_FRONT_MATTER_LEAK_MARKERS = (
    "schema_version:",
    "source_document_id:",
    "source_notice_ids:",
    "source_attachment_ref_id:",
)
_SHORT_BODY_TOKEN_THRESHOLD = 40


class ScopedRuleChunkPrepObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class ScopedRuleChunkPrepDocumentReport:
    target_document_id: str
    target_version_id: str
    title: str
    document_nature: str
    source_notice_ids: tuple[str, ...]
    unit_count: int
    chunk_count: int
    unit_type_counts: dict[str, int]
    split_reason_counts: dict[str, int]
    header_mode_counts: dict[str, int]
    missing_title_chunk_count: int
    missing_contextualization_count: int
    missing_projection_metadata_count: int
    missing_cycle_year_count: int
    missing_school_unit_name_count: int
    wrapper_notice_leak_chunk_count: int
    front_matter_leak_chunk_count: int
    short_body_chunk_count: int
    passed: bool
    issues: tuple[str, ...]
    document_units_path: str
    chunk_catalog_path: str


@dataclass(frozen=True, slots=True)
class ScopedRuleChunkPrepManifestEntry:
    target_document_id: str
    title: str
    document_nature: str
    source_notice_ids: tuple[str, ...]
    document_units_path: str
    chunk_catalog_path: str


@dataclass(frozen=True, slots=True)
class ScopedRuleChunkPrepManifest:
    schema_version: str
    prepared_at: str
    target_corpus: str
    target_collection: str
    prepared_document_count: int
    total_unit_count: int
    total_chunk_count: int
    documents: tuple[ScopedRuleChunkPrepManifestEntry, ...]


@dataclass(frozen=True, slots=True)
class ScopedRuleChunkPrepValidationReport:
    schema_version: str
    passed: bool
    prepared_document_count: int
    total_unit_count: int
    total_chunk_count: int
    unit_type_counts: dict[str, int]
    split_reason_counts: dict[str, int]
    header_mode_counts: dict[str, int]
    missing_title_chunk_count: int
    missing_contextualization_count: int
    missing_projection_metadata_count: int
    missing_cycle_year_count: int
    missing_school_unit_name_count: int
    wrapper_notice_leak_chunk_count: int
    front_matter_leak_chunk_count: int
    short_body_chunk_count: int
    failed_document_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ScopedRuleChunkPrepExportReport:
    manifest_path: str
    validation_summary_path: str
    document_reports_path: str
    prepared_document_count: int
    total_unit_count: int
    total_chunk_count: int
    passed: bool
    prepared_documents: tuple[ScopedRuleChunkPrepManifestEntry, ...]


@dataclass(frozen=True, slots=True)
class _PreparedScopedRule:
    record: DocumentRegistryRecord
    report: ScopedRuleChunkPrepDocumentReport
    chunks: tuple[IndexableChunk, ...]


def prepare_scoped_rule_chunks(
    *,
    records: Sequence[DocumentRegistryRecord],
    object_store: ScopedRuleChunkPrepObjectStore,
    output_dir: Path,
    bucket_derived: str = DEFAULT_BUCKET_DERIVED,
) -> ScopedRuleChunkPrepExportReport:
    scoped_rule_records = tuple(
        record for record in records if (record.corpus, record.collection) == _TARGET_SCOPE
    )
    prepared_documents = tuple(
        _prepare_scoped_rule_record(
            record=record,
            object_store=object_store,
            bucket_derived=bucket_derived,
            output_dir=Path(output_dir),
        )
        for record in scoped_rule_records
    )
    manifest = build_scoped_rule_chunk_prep_manifest(prepared_documents=prepared_documents)
    validation_report = build_scoped_rule_chunk_prep_validation_report(
        prepared_documents=prepared_documents
    )
    manifest_path, validation_path, document_reports_path = export_scoped_rule_chunk_prep_artifacts(
        output_dir=Path(output_dir),
        prepared_documents=prepared_documents,
        manifest=manifest,
        validation_report=validation_report,
    )
    return ScopedRuleChunkPrepExportReport(
        manifest_path=str(manifest_path),
        validation_summary_path=str(validation_path),
        document_reports_path=str(document_reports_path),
        prepared_document_count=manifest.prepared_document_count,
        total_unit_count=manifest.total_unit_count,
        total_chunk_count=manifest.total_chunk_count,
        passed=validation_report.passed,
        prepared_documents=manifest.documents,
    )


def build_scoped_rule_chunk_prep_manifest(
    *,
    prepared_documents: Sequence[_PreparedScopedRule],
) -> ScopedRuleChunkPrepManifest:
    return ScopedRuleChunkPrepManifest(
        schema_version=_SCHEMA_VERSION,
        prepared_at=datetime.now(UTC).isoformat(),
        target_corpus=_TARGET_SCOPE[0],
        target_collection=_TARGET_SCOPE[1],
        prepared_document_count=len(prepared_documents),
        total_unit_count=sum(item.report.unit_count for item in prepared_documents),
        total_chunk_count=sum(item.report.chunk_count for item in prepared_documents),
        documents=tuple(
            ScopedRuleChunkPrepManifestEntry(
                target_document_id=item.report.target_document_id,
                title=item.report.title,
                document_nature=item.report.document_nature,
                source_notice_ids=item.report.source_notice_ids,
                document_units_path=item.report.document_units_path,
                chunk_catalog_path=item.report.chunk_catalog_path,
            )
            for item in prepared_documents
        ),
    )


def build_scoped_rule_chunk_prep_validation_report(
    *,
    prepared_documents: Sequence[_PreparedScopedRule],
) -> ScopedRuleChunkPrepValidationReport:
    unit_type_counts: Counter[str] = Counter()
    split_reason_counts: Counter[str] = Counter()
    header_mode_counts: Counter[str] = Counter()
    failed_document_ids: list[str] = []
    missing_title_chunk_count = 0
    missing_contextualization_count = 0
    missing_projection_metadata_count = 0
    missing_cycle_year_count = 0
    missing_school_unit_name_count = 0
    wrapper_notice_leak_chunk_count = 0
    front_matter_leak_chunk_count = 0
    short_body_chunk_count = 0

    for item in prepared_documents:
        unit_type_counts.update(item.report.unit_type_counts)
        split_reason_counts.update(item.report.split_reason_counts)
        header_mode_counts.update(item.report.header_mode_counts)
        if not item.report.passed:
            failed_document_ids.append(item.report.target_document_id)
        missing_title_chunk_count += item.report.missing_title_chunk_count
        missing_contextualization_count += item.report.missing_contextualization_count
        missing_projection_metadata_count += item.report.missing_projection_metadata_count
        missing_cycle_year_count += item.report.missing_cycle_year_count
        missing_school_unit_name_count += item.report.missing_school_unit_name_count
        wrapper_notice_leak_chunk_count += item.report.wrapper_notice_leak_chunk_count
        front_matter_leak_chunk_count += item.report.front_matter_leak_chunk_count
        short_body_chunk_count += item.report.short_body_chunk_count

    return ScopedRuleChunkPrepValidationReport(
        schema_version=_SCHEMA_VERSION,
        passed=not failed_document_ids,
        prepared_document_count=len(prepared_documents),
        total_unit_count=sum(item.report.unit_count for item in prepared_documents),
        total_chunk_count=sum(item.report.chunk_count for item in prepared_documents),
        unit_type_counts=dict(sorted(unit_type_counts.items())),
        split_reason_counts=dict(sorted(split_reason_counts.items())),
        header_mode_counts=dict(sorted(header_mode_counts.items())),
        missing_title_chunk_count=missing_title_chunk_count,
        missing_contextualization_count=missing_contextualization_count,
        missing_projection_metadata_count=missing_projection_metadata_count,
        missing_cycle_year_count=missing_cycle_year_count,
        missing_school_unit_name_count=missing_school_unit_name_count,
        wrapper_notice_leak_chunk_count=wrapper_notice_leak_chunk_count,
        front_matter_leak_chunk_count=front_matter_leak_chunk_count,
        short_body_chunk_count=short_body_chunk_count,
        failed_document_ids=tuple(sorted(failed_document_ids)),
    )


def export_scoped_rule_chunk_prep_artifacts(
    *,
    output_dir: Path,
    prepared_documents: Sequence[_PreparedScopedRule],
    manifest: ScopedRuleChunkPrepManifest,
    validation_report: ScopedRuleChunkPrepValidationReport,
) -> tuple[Path, Path, Path]:
    output_dir.mkdir(parents=True, exist_ok=True)
    document_reports_path = output_dir / "document-reports.jsonl"
    document_reports_path.write_text(
        "".join(
            json.dumps(asdict(item.report), ensure_ascii=False) + "\n"
            for item in prepared_documents
        ),
        encoding="utf-8",
    )
    manifest_path = output_dir / "chunk-prep-manifest.json"
    manifest_path.write_text(
        json.dumps(asdict(manifest), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    validation_path = output_dir / "validation-summary.json"
    validation_path.write_text(
        json.dumps(asdict(validation_report), ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return manifest_path, validation_path, document_reports_path


def _prepare_scoped_rule_record(
    *,
    record: DocumentRegistryRecord,
    object_store: ScopedRuleChunkPrepObjectStore,
    bucket_derived: str,
    output_dir: Path,
) -> _PreparedScopedRule:
    if not record.document_units_object_key:
        raise ValueError(
            f"scoped_rules record missing document_units_object_key: {record.document_id}"
        )
    document_units_bytes = object_store.get_bytes(
        bucket=bucket_derived,
        key=record.document_units_object_key,
    )
    unit_rows = tuple(_load_jsonl_rows(document_units_bytes))
    chunks = build_indexable_chunks_from_jsonl(
        record=record,
        structured_jsonl_bytes=document_units_bytes,
    )
    title = _resolve_title(unit_rows)
    target_suffix = record.document_id.rsplit(":", 1)[-1]
    prepared_dir = (
        output_dir / "prepared-documents" / f"{_slugify_path_component(title)}--{target_suffix}"
    )
    prepared_dir.mkdir(parents=True, exist_ok=True)
    document_units_path = prepared_dir / "document-units.jsonl"
    chunk_catalog_path = prepared_dir / "chunks.jsonl"
    document_units_path.write_bytes(document_units_bytes)
    chunk_catalog_path.write_text(
        "".join(json.dumps(asdict(chunk), ensure_ascii=False) + "\n" for chunk in chunks),
        encoding="utf-8",
    )
    report = _build_document_report(
        record=record,
        title=title,
        unit_rows=unit_rows,
        chunks=chunks,
        relative_root=output_dir,
        document_units_path=document_units_path,
        chunk_catalog_path=chunk_catalog_path,
    )
    return _PreparedScopedRule(record=record, report=report, chunks=chunks)


def _build_document_report(
    *,
    record: DocumentRegistryRecord,
    title: str,
    unit_rows: Sequence[dict[str, Any]],
    chunks: Sequence[IndexableChunk],
    relative_root: Path,
    document_units_path: Path,
    chunk_catalog_path: Path,
) -> ScopedRuleChunkPrepDocumentReport:
    unit_type_counts = Counter(
        str(row.get("unit_type") or "")
        for row in unit_rows
        if str(row.get("unit_type") or "").strip()
    )
    split_reason_counts = Counter(
        str(chunk.metadata.get("split_reason") or "")
        for chunk in chunks
        if str(chunk.metadata.get("split_reason") or "").strip()
    )
    header_mode_counts = Counter(
        str(chunk.metadata.get("header_mode") or "")
        for chunk in chunks
        if str(chunk.metadata.get("header_mode") or "").strip()
    )
    first_metadata = _resolve_first_metadata(unit_rows)
    document_nature = str(first_metadata.get("document_nature") or "").strip()
    source_notice_ids = tuple(
        str(item)
        for item in list(first_metadata.get("source_notice_ids") or [])
        if str(item).strip()
    )
    missing_title_chunk_count = 0
    if not any(
        str(chunk.metadata.get("content_role") or "").strip() == "scoped_rule_title"
        for chunk in chunks
    ):
        missing_title_chunk_count = 1
    missing_contextualization_count = sum(
        1
        for chunk in chunks
        if str(chunk.metadata.get("content_role") or "").strip() != "scoped_rule_title"
        and not bool(chunk.metadata.get("contextualized_text"))
    )
    missing_projection_metadata_count = sum(
        1
        for chunk in chunks
        if any(
            _is_missing_metadata_field(chunk.metadata.get(field))
            for field in _REQUIRED_PROJECTION_METADATA_FIELDS
        )
    )
    missing_cycle_year_count = 0
    if document_nature == "annual_cycle_rule" and _is_missing_metadata_field(
        first_metadata.get("cycle_year")
    ):
        missing_cycle_year_count = 1
    missing_school_unit_name_count = 0
    if document_nature == "annual_cycle_rule" and _is_missing_metadata_field(
        first_metadata.get("school_unit_name")
    ):
        missing_school_unit_name_count = 1
    wrapper_notice_leak_chunk_count = sum(
        1 for chunk in chunks if _contains_marker(chunk.text, _HIGH_CONFIDENCE_WRAPPER_LEAK_MARKERS)
    )
    front_matter_leak_chunk_count = sum(
        1 for chunk in chunks if _contains_marker(chunk.text, _FRONT_MATTER_LEAK_MARKERS)
    )
    short_body_chunk_count = sum(
        1
        for chunk in chunks
        if str(chunk.metadata.get("content_role") or "").strip() != "scoped_rule_title"
        and int(chunk.metadata.get("final_token_count") or 0) < _SHORT_BODY_TOKEN_THRESHOLD
    )
    issues: list[str] = []
    if not chunks:
        issues.append("no_chunks_emitted")
    if missing_title_chunk_count:
        issues.append("missing_title_chunk")
    if missing_contextualization_count:
        issues.append("missing_contextualization")
    if missing_projection_metadata_count:
        issues.append("missing_projection_metadata")
    if missing_cycle_year_count:
        issues.append("missing_cycle_year")
    if missing_school_unit_name_count:
        issues.append("missing_school_unit_name")
    if wrapper_notice_leak_chunk_count:
        issues.append("wrapper_notice_leak")
    if front_matter_leak_chunk_count:
        issues.append("front_matter_leak")
    passed = not any(
        issue
        in {
            "no_chunks_emitted",
            "missing_title_chunk",
            "missing_contextualization",
            "missing_projection_metadata",
            "missing_cycle_year",
            "missing_school_unit_name",
            "wrapper_notice_leak",
            "front_matter_leak",
        }
        for issue in issues
    )
    return ScopedRuleChunkPrepDocumentReport(
        target_document_id=record.document_id,
        target_version_id=record.version_id,
        title=title,
        document_nature=document_nature,
        source_notice_ids=source_notice_ids,
        unit_count=len(unit_rows),
        chunk_count=len(chunks),
        unit_type_counts=dict(sorted(unit_type_counts.items())),
        split_reason_counts=dict(sorted(split_reason_counts.items())),
        header_mode_counts=dict(sorted(header_mode_counts.items())),
        missing_title_chunk_count=missing_title_chunk_count,
        missing_contextualization_count=missing_contextualization_count,
        missing_projection_metadata_count=missing_projection_metadata_count,
        missing_cycle_year_count=missing_cycle_year_count,
        missing_school_unit_name_count=missing_school_unit_name_count,
        wrapper_notice_leak_chunk_count=wrapper_notice_leak_chunk_count,
        front_matter_leak_chunk_count=front_matter_leak_chunk_count,
        short_body_chunk_count=short_body_chunk_count,
        passed=passed,
        issues=tuple(issues),
        document_units_path=str(document_units_path.relative_to(relative_root)),
        chunk_catalog_path=str(chunk_catalog_path.relative_to(relative_root)),
    )


def _load_jsonl_rows(payload: bytes) -> list[dict[str, Any]]:
    return [json.loads(line) for line in payload.decode("utf-8").splitlines() if line.strip()]


def _resolve_first_metadata(rows: Sequence[dict[str, Any]]) -> dict[str, Any]:
    for row in rows:
        metadata = row.get("metadata")
        if isinstance(metadata, dict) and metadata:
            return metadata
    return {}


def _resolve_title(rows: Sequence[dict[str, Any]]) -> str:
    metadata = _resolve_first_metadata(rows)
    for key in ("title", "regulation_title_normalized"):
        value = str(metadata.get(key) or "").strip()
        if value:
            return value
    for row in rows:
        text = str(row.get("clean_text") or "").strip()
        if text:
            return text
    return "scoped-rule"


def _contains_marker(text: str, markers: Sequence[str]) -> bool:
    normalized = text.strip()
    return any(marker in normalized for marker in markers)


def _is_missing_metadata_field(value: object) -> bool:
    if value is None:
        return True
    if isinstance(value, str):
        return not value.strip()
    if isinstance(value, (list, tuple, set, dict)):
        return len(value) == 0
    return False


def _slugify_path_component(value: str) -> str:
    normalized = value.strip()
    return (
        "".join(ch if ch.isalnum() or ch in {"-", "_"} else "-" for ch in normalized).strip("-")
        or "scoped-rule"
    )


__all__ = [
    "ScopedRuleChunkPrepDocumentReport",
    "ScopedRuleChunkPrepExportReport",
    "ScopedRuleChunkPrepManifest",
    "ScopedRuleChunkPrepManifestEntry",
    "ScopedRuleChunkPrepValidationReport",
    "build_scoped_rule_chunk_prep_manifest",
    "build_scoped_rule_chunk_prep_validation_report",
    "export_scoped_rule_chunk_prep_artifacts",
    "prepare_scoped_rule_chunks",
]
