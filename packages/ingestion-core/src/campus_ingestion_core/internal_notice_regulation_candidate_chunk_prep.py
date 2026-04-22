from __future__ import annotations

import json
from collections import Counter
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.internal_notice_regulation_projection import (
    build_internal_notice_regulation_projected_document,
)
from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationCandidateArtifactDocument,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import IndexableChunk, build_indexable_chunks_from_jsonl

_TARGET_SCOPE = ("regulations", "institutional_rules")
_PARSER_VERSION = "internal_notice_regulation_projection_preview_v1"
_IMPORT_SOURCE = "internal_notice_regulation_candidate_chunk_prep"
_SCHEMA_VERSION = "internal_notice_regulation_candidate_chunk_prep_v1"
_HIGH_CONFIDENCE_WRAPPER_LEAK_MARKERS = (
    "特此通知",
    "请遵照执行",
    "学校各单位、各部门",
    "现将有关事项通知如下",
    "附件：",
)
_FRONT_MATTER_LEAK_MARKERS = (
    "schema_version:",
    "candidate_id:",
    "source_document_id:",
    "artifact_body_sha256:",
)
_REQUIRED_PROJECTION_METADATA_FIELDS = (
    "promotion_class",
    "regulation_title_normalized",
    "source_notice_ids",
    "source_notice_document_id",
    "semantic_owner_document_id",
    "promotion_source_collection",
)
_SHORT_BODY_TOKEN_THRESHOLD = 40


@dataclass(frozen=True, slots=True)
class InternalNoticeRegulationCandidateChunkPrepDocumentReport:
    candidate_id: str
    source_document_id: str
    target_document_id: str
    target_version_id: str
    regulation_title_normalized: str
    promotion_class: str
    unit_count: int
    chunk_count: int
    unit_type_counts: dict[str, int]
    split_reason_counts: dict[str, int]
    header_mode_counts: dict[str, int]
    missing_title_chunk_count: int
    missing_contextualization_count: int
    missing_projection_metadata_count: int
    wrapper_notice_leak_chunk_count: int
    front_matter_leak_chunk_count: int
    short_body_chunk_count: int
    passed: bool
    issues: tuple[str, ...]
    artifact_markdown_path: str
    document_units_path: str
    chunk_catalog_path: str


@dataclass(frozen=True, slots=True)
class InternalNoticeRegulationCandidateChunkPrepManifestEntry:
    candidate_id: str
    source_document_id: str
    target_document_id: str
    regulation_title_normalized: str
    document_units_path: str
    chunk_catalog_path: str


@dataclass(frozen=True, slots=True)
class InternalNoticeRegulationCandidateChunkPrepManifest:
    schema_version: str
    prepared_at: str
    target_corpus: str
    target_collection: str
    prepared_candidate_count: int
    total_unit_count: int
    total_chunk_count: int
    documents: tuple[InternalNoticeRegulationCandidateChunkPrepManifestEntry, ...]


@dataclass(frozen=True, slots=True)
class InternalNoticeRegulationCandidateChunkPrepValidationReport:
    schema_version: str
    passed: bool
    prepared_candidate_count: int
    total_unit_count: int
    total_chunk_count: int
    unit_type_counts: dict[str, int]
    split_reason_counts: dict[str, int]
    header_mode_counts: dict[str, int]
    missing_title_chunk_count: int
    missing_contextualization_count: int
    missing_projection_metadata_count: int
    wrapper_notice_leak_chunk_count: int
    front_matter_leak_chunk_count: int
    short_body_chunk_count: int
    failed_candidate_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class InternalNoticeRegulationCandidateChunkPrepExportReport:
    manifest_path: str
    validation_summary_path: str
    document_reports_path: str
    prepared_candidate_count: int
    total_unit_count: int
    total_chunk_count: int
    passed: bool
    prepared_documents: tuple[InternalNoticeRegulationCandidateChunkPrepManifestEntry, ...]


@dataclass(frozen=True, slots=True)
class _PreparedCandidate:
    candidate_document: InternalNoticeRegulationCandidateArtifactDocument
    report: InternalNoticeRegulationCandidateChunkPrepDocumentReport
    document_units_bytes: bytes
    chunks: tuple[IndexableChunk, ...]


def load_internal_notice_regulation_candidate_documents(
    path: Path,
) -> tuple[InternalNoticeRegulationCandidateArtifactDocument, ...]:
    documents: list[InternalNoticeRegulationCandidateArtifactDocument] = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        normalized = line.strip()
        if not normalized:
            continue
        documents.append(_candidate_document_from_dict(json.loads(normalized)))
    return tuple(documents)


def prepare_internal_notice_regulation_candidate_chunks(
    *,
    documents: Sequence[InternalNoticeRegulationCandidateArtifactDocument],
    output_dir: Path,
) -> InternalNoticeRegulationCandidateChunkPrepExportReport:
    prepared_documents = tuple(
        _prepare_candidate_document(
            candidate_document=document,
            output_dir=Path(output_dir),
        )
        for document in documents
    )
    manifest = build_internal_notice_regulation_candidate_chunk_prep_manifest(
        prepared_documents=prepared_documents
    )
    validation_report = build_internal_notice_regulation_candidate_chunk_prep_validation_report(
        prepared_documents=prepared_documents
    )
    manifest_path, validation_path, document_reports_path = (
        export_internal_notice_regulation_candidate_chunk_prep_artifacts(
            output_dir=Path(output_dir),
            prepared_documents=prepared_documents,
            manifest=manifest,
            validation_report=validation_report,
        )
    )
    return InternalNoticeRegulationCandidateChunkPrepExportReport(
        manifest_path=str(manifest_path),
        validation_summary_path=str(validation_path),
        document_reports_path=str(document_reports_path),
        prepared_candidate_count=manifest.prepared_candidate_count,
        total_unit_count=manifest.total_unit_count,
        total_chunk_count=manifest.total_chunk_count,
        passed=validation_report.passed,
        prepared_documents=manifest.documents,
    )


def build_internal_notice_regulation_candidate_chunk_prep_manifest(
    *,
    prepared_documents: Sequence[_PreparedCandidate],
) -> InternalNoticeRegulationCandidateChunkPrepManifest:
    return InternalNoticeRegulationCandidateChunkPrepManifest(
        schema_version=_SCHEMA_VERSION,
        prepared_at=datetime.now(UTC).isoformat(),
        target_corpus=_TARGET_SCOPE[0],
        target_collection=_TARGET_SCOPE[1],
        prepared_candidate_count=len(prepared_documents),
        total_unit_count=sum(item.report.unit_count for item in prepared_documents),
        total_chunk_count=sum(item.report.chunk_count for item in prepared_documents),
        documents=tuple(
            InternalNoticeRegulationCandidateChunkPrepManifestEntry(
                candidate_id=item.report.candidate_id,
                source_document_id=item.report.source_document_id,
                target_document_id=item.report.target_document_id,
                regulation_title_normalized=item.report.regulation_title_normalized,
                document_units_path=item.report.document_units_path,
                chunk_catalog_path=item.report.chunk_catalog_path,
            )
            for item in prepared_documents
        ),
    )


def build_internal_notice_regulation_candidate_chunk_prep_validation_report(
    *,
    prepared_documents: Sequence[_PreparedCandidate],
) -> InternalNoticeRegulationCandidateChunkPrepValidationReport:
    unit_type_counts: Counter[str] = Counter()
    split_reason_counts: Counter[str] = Counter()
    header_mode_counts: Counter[str] = Counter()
    failed_candidate_ids: list[str] = []
    missing_title_chunk_count = 0
    missing_contextualization_count = 0
    missing_projection_metadata_count = 0
    wrapper_notice_leak_chunk_count = 0
    front_matter_leak_chunk_count = 0
    short_body_chunk_count = 0

    for item in prepared_documents:
        unit_type_counts.update(item.report.unit_type_counts)
        split_reason_counts.update(item.report.split_reason_counts)
        header_mode_counts.update(item.report.header_mode_counts)
        if not item.report.passed:
            failed_candidate_ids.append(item.report.candidate_id)
        missing_title_chunk_count += item.report.missing_title_chunk_count
        missing_contextualization_count += item.report.missing_contextualization_count
        missing_projection_metadata_count += item.report.missing_projection_metadata_count
        wrapper_notice_leak_chunk_count += item.report.wrapper_notice_leak_chunk_count
        front_matter_leak_chunk_count += item.report.front_matter_leak_chunk_count
        short_body_chunk_count += item.report.short_body_chunk_count

    return InternalNoticeRegulationCandidateChunkPrepValidationReport(
        schema_version=_SCHEMA_VERSION,
        passed=not failed_candidate_ids,
        prepared_candidate_count=len(prepared_documents),
        total_unit_count=sum(item.report.unit_count for item in prepared_documents),
        total_chunk_count=sum(item.report.chunk_count for item in prepared_documents),
        unit_type_counts=dict(sorted(unit_type_counts.items())),
        split_reason_counts=dict(sorted(split_reason_counts.items())),
        header_mode_counts=dict(sorted(header_mode_counts.items())),
        missing_title_chunk_count=missing_title_chunk_count,
        missing_contextualization_count=missing_contextualization_count,
        missing_projection_metadata_count=missing_projection_metadata_count,
        wrapper_notice_leak_chunk_count=wrapper_notice_leak_chunk_count,
        front_matter_leak_chunk_count=front_matter_leak_chunk_count,
        short_body_chunk_count=short_body_chunk_count,
        failed_candidate_ids=tuple(sorted(failed_candidate_ids)),
    )


def export_internal_notice_regulation_candidate_chunk_prep_artifacts(
    *,
    output_dir: Path,
    prepared_documents: Sequence[_PreparedCandidate],
    manifest: InternalNoticeRegulationCandidateChunkPrepManifest,
    validation_report: InternalNoticeRegulationCandidateChunkPrepValidationReport,
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


def _prepare_candidate_document(
    *,
    candidate_document: InternalNoticeRegulationCandidateArtifactDocument,
    output_dir: Path,
) -> _PreparedCandidate:
    projected_document = build_internal_notice_regulation_projected_document(
        candidate_document=candidate_document
    )
    record = _build_projection_record(
        candidate_document=candidate_document,
        document_id=projected_document.document_id,
        version_id=projected_document.version_id,
        source_uri=projected_document.source_uri,
        semantic_content_hash=projected_document.semantic_content_hash,
        published_date=projected_document.published_date,
    )
    chunks = build_indexable_chunks_from_jsonl(
        record=record,
        structured_jsonl_bytes=projected_document.document_units_bytes,
    )
    unit_rows = tuple(_load_jsonl_rows(projected_document.document_units_bytes))
    prepared_dir = (
        output_dir
        / "prepared-candidates"
        / f"{_slugify_path_component(candidate_document.regulation_title_normalized)}--{candidate_document.candidate_id}"
    )
    prepared_dir.mkdir(parents=True, exist_ok=True)
    document_units_path = prepared_dir / "document-units.jsonl"
    chunk_catalog_path = prepared_dir / "chunks.jsonl"
    document_units_path.write_bytes(projected_document.document_units_bytes)
    chunk_catalog_path.write_text(
        "".join(json.dumps(asdict(chunk), ensure_ascii=False) + "\n" for chunk in chunks),
        encoding="utf-8",
    )
    report = _build_document_report(
        candidate_document=candidate_document,
        projected_document=projected_document,
        unit_rows=unit_rows,
        chunks=chunks,
        relative_root=output_dir,
        document_units_path=document_units_path,
        chunk_catalog_path=chunk_catalog_path,
    )
    return _PreparedCandidate(
        candidate_document=candidate_document,
        report=report,
        document_units_bytes=projected_document.document_units_bytes,
        chunks=chunks,
    )


def _build_projection_record(
    *,
    candidate_document: InternalNoticeRegulationCandidateArtifactDocument,
    document_id: str,
    version_id: str,
    source_uri: str,
    semantic_content_hash: str,
    published_date: str | None,
) -> DocumentRegistryRecord:
    runtime_profile = load_runtime_profile(*_TARGET_SCOPE)
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track=candidate_document.revision_track,
        version_id=version_id,
        source_uri=source_uri,
        content_hash=semantic_content_hash,
        corpus=_TARGET_SCOPE[0],
        collection=_TARGET_SCOPE[1],
        cleaning_policy_version=runtime_profile.cleaning_policy_version,
        entitlement_groups=candidate_document.entitlement_groups,
        visibility_scope=candidate_document.visibility_scope,
        visibility_level=candidate_document.visibility_level,
        status="active",
        ingestion_timestamp=datetime.now(UTC).isoformat(),
        parser_version=_PARSER_VERSION,
        embedding_model=candidate_document.embedding_model,
        source_channel="manual_curated",
        is_current=candidate_document.is_current,
        published_date=published_date,
        import_source=_IMPORT_SOURCE,
    )


def _build_document_report(
    *,
    candidate_document: InternalNoticeRegulationCandidateArtifactDocument,
    projected_document,
    unit_rows: Sequence[dict[str, Any]],
    chunks: Sequence[IndexableChunk],
    relative_root: Path,
    document_units_path: Path,
    chunk_catalog_path: Path,
) -> InternalNoticeRegulationCandidateChunkPrepDocumentReport:
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
    missing_title_chunk_count = 0
    if not any(
        str(chunk.metadata.get("content_role") or "").strip() == "regulation_title"
        for chunk in chunks
    ):
        missing_title_chunk_count = 1
    missing_contextualization_count = sum(
        1
        for chunk in chunks
        if str(chunk.metadata.get("content_role") or "").strip() != "regulation_title"
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
    wrapper_notice_leak_chunk_count = sum(
        1 for chunk in chunks if _contains_marker(chunk.text, _HIGH_CONFIDENCE_WRAPPER_LEAK_MARKERS)
    )
    front_matter_leak_chunk_count = sum(
        1 for chunk in chunks if _contains_marker(chunk.text, _FRONT_MATTER_LEAK_MARKERS)
    )
    short_body_chunk_count = sum(
        1
        for chunk in chunks
        if str(chunk.metadata.get("content_role") or "").strip() != "regulation_title"
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
            "wrapper_notice_leak",
            "front_matter_leak",
        }
        for issue in issues
    )
    return InternalNoticeRegulationCandidateChunkPrepDocumentReport(
        candidate_id=candidate_document.candidate_id,
        source_document_id=candidate_document.source_document_id,
        target_document_id=projected_document.document_id,
        target_version_id=projected_document.version_id,
        regulation_title_normalized=candidate_document.regulation_title_normalized,
        promotion_class=candidate_document.promotion_class,
        unit_count=len(unit_rows),
        chunk_count=len(chunks),
        unit_type_counts=dict(sorted(unit_type_counts.items())),
        split_reason_counts=dict(sorted(split_reason_counts.items())),
        header_mode_counts=dict(sorted(header_mode_counts.items())),
        missing_title_chunk_count=missing_title_chunk_count,
        missing_contextualization_count=missing_contextualization_count,
        missing_projection_metadata_count=missing_projection_metadata_count,
        wrapper_notice_leak_chunk_count=wrapper_notice_leak_chunk_count,
        front_matter_leak_chunk_count=front_matter_leak_chunk_count,
        short_body_chunk_count=short_body_chunk_count,
        passed=passed,
        issues=tuple(issues),
        artifact_markdown_path=candidate_document.artifact_markdown_path,
        document_units_path=str(document_units_path.relative_to(relative_root)),
        chunk_catalog_path=str(chunk_catalog_path.relative_to(relative_root)),
    )


def _load_jsonl_rows(payload: bytes) -> list[dict[str, Any]]:
    return [json.loads(line) for line in payload.decode("utf-8").splitlines() if line.strip()]


def _candidate_document_from_dict(
    payload: dict[str, Any],
) -> InternalNoticeRegulationCandidateArtifactDocument:
    data = dict(payload)
    for field_name in (
        "entitlement_groups",
        "quality_gates_passed",
        "reasons",
    ):
        value = data.get(field_name)
        if isinstance(value, list):
            data[field_name] = tuple(str(item) for item in value)
    return InternalNoticeRegulationCandidateArtifactDocument(**data)


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
        or "candidate"
    )


__all__ = [
    "InternalNoticeRegulationCandidateChunkPrepDocumentReport",
    "InternalNoticeRegulationCandidateChunkPrepExportReport",
    "InternalNoticeRegulationCandidateChunkPrepManifest",
    "InternalNoticeRegulationCandidateChunkPrepManifestEntry",
    "InternalNoticeRegulationCandidateChunkPrepValidationReport",
    "build_internal_notice_regulation_candidate_chunk_prep_manifest",
    "build_internal_notice_regulation_candidate_chunk_prep_validation_report",
    "export_internal_notice_regulation_candidate_chunk_prep_artifacts",
    "load_internal_notice_regulation_candidate_documents",
    "prepare_internal_notice_regulation_candidate_chunks",
]
