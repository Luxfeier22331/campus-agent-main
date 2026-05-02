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
from campus_ingestion_core.regulation_chunk_quality import (
    contains_form_tail_marker,
    contains_html_tag,
    contains_publication_imprint,
    header_dominance_is_blocking_quality_gap,
    header_duplicates_display_text,
    is_regulation_body_role,
    is_regulation_title_role,
    looks_like_structural_heading,
    page_anchor_is_fabricated,
    section_path_contains_body_like_item,
    section_path_contains_body_text,
    section_path_depth_exceeds,
    section_path_has_long_segment,
    title_text_is_duplicated,
    token_guardrail_indicates_coarse_unit,
)
from campus_ingestion_core.settings import DEFAULT_BUCKET_DERIVED

_TARGET_SCOPE = ("regulations", "institutional_rules")
_SCHEMA_VERSION = "internal_notice_institutional_regulation_chunk_prep_v1"
_REQUIRED_IDENTITY_METADATA_FIELDS = (
    "promotion_class",
    "promotion_source_collection",
    "regulation_title_normalized",
    "regulation_work_title",
    "regulation_display_title",
    "source_title_literal",
    "source_notice_ids",
    "source_notice_document_id",
    "semantic_owner_document_id",
    "semantic_owner_kind",
)
_HIGH_CONFIDENCE_WRAPPER_LEAK_MARKERS = (
    "特此通知",
    "请遵照执行",
    "学校各单位、各部门",
    "现将有关事项通知如下",
)
_FRONT_MATTER_LEAK_MARKERS = (
    "schema_version:",
    "candidate_id:",
    "source_document_id:",
    "artifact_body_sha256:",
)
_SHORT_BODY_TOKEN_THRESHOLD = 40
_MAX_SECTION_PATH_DEPTH = 3
_MAX_SECTION_PATH_SEGMENT_CHARS = 60


class InstitutionalRegulationChunkPrepObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class InstitutionalRegulationChunkPrepDocumentReport:
    target_document_id: str
    target_version_id: str
    title: str
    semantic_owner_kind: str
    source_notice_ids: tuple[str, ...]
    unit_count: int
    chunk_count: int
    unit_type_counts: dict[str, int]
    split_reason_counts: dict[str, int]
    header_mode_counts: dict[str, int]
    missing_title_chunk_count: int
    missing_contextualization_count: int
    missing_identity_metadata_count: int
    invalid_semantic_owner_lineage_count: int
    wrapper_notice_leak_chunk_count: int
    front_matter_leak_chunk_count: int
    short_body_chunk_count: int
    heading_only_body_chunk_count: int
    section_path_body_text_chunk_count: int
    html_tag_chunk_count: int
    form_tail_marker_chunk_count: int
    body_like_section_path_chunk_count: int
    deep_section_path_chunk_count: int
    long_section_path_segment_chunk_count: int
    publication_imprint_chunk_count: int
    header_body_duplicate_chunk_count: int
    title_duplicate_chunk_count: int
    header_dominant_chunk_count: int
    fabricated_page_anchor_chunk_count: int
    coarse_token_guardrail_chunk_count: int
    passed: bool
    issues: tuple[str, ...]
    document_units_path: str
    chunk_catalog_path: str


@dataclass(frozen=True, slots=True)
class InstitutionalRegulationChunkPrepManifestEntry:
    target_document_id: str
    title: str
    semantic_owner_kind: str
    source_notice_ids: tuple[str, ...]
    document_units_path: str
    chunk_catalog_path: str


@dataclass(frozen=True, slots=True)
class InstitutionalRegulationChunkPrepManifest:
    schema_version: str
    prepared_at: str
    target_corpus: str
    target_collection: str
    prepared_document_count: int
    total_unit_count: int
    total_chunk_count: int
    documents: tuple[InstitutionalRegulationChunkPrepManifestEntry, ...]


@dataclass(frozen=True, slots=True)
class InstitutionalRegulationChunkPrepValidationReport:
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
    missing_identity_metadata_count: int
    invalid_semantic_owner_lineage_count: int
    wrapper_notice_leak_chunk_count: int
    front_matter_leak_chunk_count: int
    short_body_chunk_count: int
    heading_only_body_chunk_count: int
    section_path_body_text_chunk_count: int
    html_tag_chunk_count: int
    form_tail_marker_chunk_count: int
    body_like_section_path_chunk_count: int
    deep_section_path_chunk_count: int
    long_section_path_segment_chunk_count: int
    publication_imprint_chunk_count: int
    header_body_duplicate_chunk_count: int
    title_duplicate_chunk_count: int
    header_dominant_chunk_count: int
    fabricated_page_anchor_chunk_count: int
    coarse_token_guardrail_chunk_count: int
    failed_document_ids: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class InstitutionalRegulationChunkPrepExportReport:
    manifest_path: str
    validation_summary_path: str
    document_reports_path: str
    prepared_document_count: int
    total_unit_count: int
    total_chunk_count: int
    passed: bool
    prepared_documents: tuple[InstitutionalRegulationChunkPrepManifestEntry, ...]


@dataclass(frozen=True, slots=True)
class _PreparedInstitutionalRegulation:
    record: DocumentRegistryRecord
    report: InstitutionalRegulationChunkPrepDocumentReport
    chunks: tuple[IndexableChunk, ...]


def prepare_institutional_regulation_chunks(
    *,
    records: Sequence[DocumentRegistryRecord],
    object_store: InstitutionalRegulationChunkPrepObjectStore,
    output_dir: Path,
    bucket_derived: str = DEFAULT_BUCKET_DERIVED,
) -> InstitutionalRegulationChunkPrepExportReport:
    target_records = tuple(
        record for record in records if (record.corpus, record.collection) == _TARGET_SCOPE
    )
    prepared_documents = tuple(
        _prepare_target_record(
            record=record,
            object_store=object_store,
            bucket_derived=bucket_derived,
            output_dir=Path(output_dir),
        )
        for record in target_records
    )
    manifest = build_institutional_regulation_chunk_prep_manifest(
        prepared_documents=prepared_documents
    )
    validation_report = build_institutional_regulation_chunk_prep_validation_report(
        prepared_documents=prepared_documents
    )
    manifest_path, validation_path, document_reports_path = (
        export_institutional_regulation_chunk_prep_artifacts(
            output_dir=Path(output_dir),
            prepared_documents=prepared_documents,
            manifest=manifest,
            validation_report=validation_report,
        )
    )
    return InstitutionalRegulationChunkPrepExportReport(
        manifest_path=str(manifest_path),
        validation_summary_path=str(validation_path),
        document_reports_path=str(document_reports_path),
        prepared_document_count=manifest.prepared_document_count,
        total_unit_count=manifest.total_unit_count,
        total_chunk_count=manifest.total_chunk_count,
        passed=validation_report.passed,
        prepared_documents=manifest.documents,
    )


def build_institutional_regulation_chunk_prep_manifest(
    *,
    prepared_documents: Sequence[_PreparedInstitutionalRegulation],
) -> InstitutionalRegulationChunkPrepManifest:
    return InstitutionalRegulationChunkPrepManifest(
        schema_version=_SCHEMA_VERSION,
        prepared_at=datetime.now(UTC).isoformat(),
        target_corpus=_TARGET_SCOPE[0],
        target_collection=_TARGET_SCOPE[1],
        prepared_document_count=len(prepared_documents),
        total_unit_count=sum(item.report.unit_count for item in prepared_documents),
        total_chunk_count=sum(item.report.chunk_count for item in prepared_documents),
        documents=tuple(
            InstitutionalRegulationChunkPrepManifestEntry(
                target_document_id=item.report.target_document_id,
                title=item.report.title,
                semantic_owner_kind=item.report.semantic_owner_kind,
                source_notice_ids=item.report.source_notice_ids,
                document_units_path=item.report.document_units_path,
                chunk_catalog_path=item.report.chunk_catalog_path,
            )
            for item in prepared_documents
        ),
    )


def build_institutional_regulation_chunk_prep_validation_report(
    *,
    prepared_documents: Sequence[_PreparedInstitutionalRegulation],
) -> InstitutionalRegulationChunkPrepValidationReport:
    unit_type_counts: Counter[str] = Counter()
    split_reason_counts: Counter[str] = Counter()
    header_mode_counts: Counter[str] = Counter()
    failed_document_ids: list[str] = []
    missing_title_chunk_count = 0
    missing_contextualization_count = 0
    missing_identity_metadata_count = 0
    invalid_semantic_owner_lineage_count = 0
    wrapper_notice_leak_chunk_count = 0
    front_matter_leak_chunk_count = 0
    short_body_chunk_count = 0
    heading_only_body_chunk_count = 0
    section_path_body_text_chunk_count = 0
    html_tag_chunk_count = 0
    form_tail_marker_chunk_count = 0
    body_like_section_path_chunk_count = 0
    deep_section_path_chunk_count = 0
    long_section_path_segment_chunk_count = 0
    publication_imprint_chunk_count = 0
    header_body_duplicate_chunk_count = 0
    title_duplicate_chunk_count = 0
    header_dominant_chunk_count = 0
    fabricated_page_anchor_chunk_count = 0
    coarse_token_guardrail_chunk_count = 0

    for item in prepared_documents:
        unit_type_counts.update(item.report.unit_type_counts)
        split_reason_counts.update(item.report.split_reason_counts)
        header_mode_counts.update(item.report.header_mode_counts)
        if not item.report.passed:
            failed_document_ids.append(item.report.target_document_id)
        missing_title_chunk_count += item.report.missing_title_chunk_count
        missing_contextualization_count += item.report.missing_contextualization_count
        missing_identity_metadata_count += item.report.missing_identity_metadata_count
        invalid_semantic_owner_lineage_count += item.report.invalid_semantic_owner_lineage_count
        wrapper_notice_leak_chunk_count += item.report.wrapper_notice_leak_chunk_count
        front_matter_leak_chunk_count += item.report.front_matter_leak_chunk_count
        short_body_chunk_count += item.report.short_body_chunk_count
        heading_only_body_chunk_count += item.report.heading_only_body_chunk_count
        section_path_body_text_chunk_count += item.report.section_path_body_text_chunk_count
        html_tag_chunk_count += item.report.html_tag_chunk_count
        form_tail_marker_chunk_count += item.report.form_tail_marker_chunk_count
        body_like_section_path_chunk_count += item.report.body_like_section_path_chunk_count
        deep_section_path_chunk_count += item.report.deep_section_path_chunk_count
        long_section_path_segment_chunk_count += (
            item.report.long_section_path_segment_chunk_count
        )
        publication_imprint_chunk_count += item.report.publication_imprint_chunk_count
        header_body_duplicate_chunk_count += item.report.header_body_duplicate_chunk_count
        title_duplicate_chunk_count += item.report.title_duplicate_chunk_count
        header_dominant_chunk_count += item.report.header_dominant_chunk_count
        fabricated_page_anchor_chunk_count += item.report.fabricated_page_anchor_chunk_count
        coarse_token_guardrail_chunk_count += item.report.coarse_token_guardrail_chunk_count

    return InstitutionalRegulationChunkPrepValidationReport(
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
        missing_identity_metadata_count=missing_identity_metadata_count,
        invalid_semantic_owner_lineage_count=invalid_semantic_owner_lineage_count,
        wrapper_notice_leak_chunk_count=wrapper_notice_leak_chunk_count,
        front_matter_leak_chunk_count=front_matter_leak_chunk_count,
        short_body_chunk_count=short_body_chunk_count,
        heading_only_body_chunk_count=heading_only_body_chunk_count,
        section_path_body_text_chunk_count=section_path_body_text_chunk_count,
        html_tag_chunk_count=html_tag_chunk_count,
        form_tail_marker_chunk_count=form_tail_marker_chunk_count,
        body_like_section_path_chunk_count=body_like_section_path_chunk_count,
        deep_section_path_chunk_count=deep_section_path_chunk_count,
        long_section_path_segment_chunk_count=long_section_path_segment_chunk_count,
        publication_imprint_chunk_count=publication_imprint_chunk_count,
        header_body_duplicate_chunk_count=header_body_duplicate_chunk_count,
        title_duplicate_chunk_count=title_duplicate_chunk_count,
        header_dominant_chunk_count=header_dominant_chunk_count,
        fabricated_page_anchor_chunk_count=fabricated_page_anchor_chunk_count,
        coarse_token_guardrail_chunk_count=coarse_token_guardrail_chunk_count,
        failed_document_ids=tuple(sorted(failed_document_ids)),
    )


def export_institutional_regulation_chunk_prep_artifacts(
    *,
    output_dir: Path,
    prepared_documents: Sequence[_PreparedInstitutionalRegulation],
    manifest: InstitutionalRegulationChunkPrepManifest,
    validation_report: InstitutionalRegulationChunkPrepValidationReport,
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


def _prepare_target_record(
    *,
    record: DocumentRegistryRecord,
    object_store: InstitutionalRegulationChunkPrepObjectStore,
    bucket_derived: str,
    output_dir: Path,
) -> _PreparedInstitutionalRegulation:
    if not record.document_units_object_key:
        raise ValueError(
            f"institutional_rules record missing document_units_object_key: {record.document_id}"
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
    return _PreparedInstitutionalRegulation(
        record=record,
        report=report,
        chunks=chunks,
    )


def _build_document_report(
    *,
    record: DocumentRegistryRecord,
    title: str,
    unit_rows: Sequence[dict[str, Any]],
    chunks: Sequence[IndexableChunk],
    relative_root: Path,
    document_units_path: Path,
    chunk_catalog_path: Path,
) -> InstitutionalRegulationChunkPrepDocumentReport:
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
    semantic_owner_kind = str(first_metadata.get("semantic_owner_kind") or "").strip()
    source_notice_ids = tuple(
        str(item)
        for item in list(first_metadata.get("source_notice_ids") or [])
        if str(item).strip()
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
    missing_identity_metadata_count = sum(
        1
        for chunk in chunks
        if any(
            _is_missing_metadata_field(chunk.metadata.get(field))
            for field in _REQUIRED_IDENTITY_METADATA_FIELDS
        )
    )
    invalid_semantic_owner_lineage_count = 0
    if _has_invalid_semantic_owner_lineage(first_metadata):
        invalid_semantic_owner_lineage_count = 1
    wrapper_notice_leak_chunk_count = sum(
        1 for chunk in chunks if _contains_marker(chunk.text, _HIGH_CONFIDENCE_WRAPPER_LEAK_MARKERS)
    )
    front_matter_leak_chunk_count = sum(
        1 for chunk in chunks if _contains_marker(chunk.text, _FRONT_MATTER_LEAK_MARKERS)
    )
    short_body_chunk_count = sum(
        1
        for chunk in chunks
        if not is_regulation_title_role(chunk.metadata.get("content_role"))
        and int(chunk.metadata.get("final_token_count") or 0) < _SHORT_BODY_TOKEN_THRESHOLD
    )
    heading_only_body_chunk_count = sum(
        1
        for chunk in chunks
        if is_regulation_body_role(chunk.metadata.get("content_role"))
        and looks_like_structural_heading(str(chunk.metadata.get("display_text") or ""))
    )
    section_path_body_text_chunk_count = sum(
        1
        for chunk in chunks
        if is_regulation_body_role(chunk.metadata.get("content_role"))
        and section_path_contains_body_text(
            section_path=_resolve_chunk_section_path(chunk),
            display_text=str(chunk.metadata.get("display_text") or ""),
        )
    )
    html_tag_chunk_count = sum(1 for chunk in chunks if contains_html_tag(chunk.text))
    form_tail_marker_chunk_count = sum(
        1 for chunk in chunks if contains_form_tail_marker(chunk.text)
    )
    body_like_section_path_chunk_count = sum(
        1
        for chunk in chunks
        if is_regulation_body_role(chunk.metadata.get("content_role"))
        and section_path_contains_body_like_item(_resolve_chunk_section_path(chunk))
    )
    deep_section_path_chunk_count = sum(
        1
        for chunk in chunks
        if is_regulation_body_role(chunk.metadata.get("content_role"))
        and section_path_depth_exceeds(
            _resolve_chunk_section_path(chunk),
            max_depth=_MAX_SECTION_PATH_DEPTH,
        )
    )
    long_section_path_segment_chunk_count = sum(
        1
        for chunk in chunks
        if is_regulation_body_role(chunk.metadata.get("content_role"))
        and section_path_has_long_segment(
            _resolve_chunk_section_path(chunk),
            max_chars=_MAX_SECTION_PATH_SEGMENT_CHARS,
        )
    )
    publication_imprint_chunk_count = sum(
        1 for chunk in chunks if contains_publication_imprint(chunk.text)
    )
    header_body_duplicate_chunk_count = sum(
        1
        for chunk in chunks
        if is_regulation_body_role(chunk.metadata.get("content_role"))
        and header_duplicates_display_text(
            chunk_text=chunk.text,
            display_text=str(chunk.metadata.get("display_text") or ""),
        )
    )
    title_duplicate_chunk_count = sum(
        1
        for chunk in chunks
        if is_regulation_title_role(chunk.metadata.get("content_role"))
        and title_text_is_duplicated(
            chunk_text=chunk.text,
            display_text=str(chunk.metadata.get("display_text") or ""),
        )
    )
    header_dominant_chunk_count = sum(
        1
        for chunk in chunks
        if header_dominance_is_blocking_quality_gap(
            metadata=chunk.metadata,
            threshold=0.75,
        )
    )
    fabricated_page_anchor_chunk_count = sum(
        1 for chunk in chunks if page_anchor_is_fabricated(chunk.anchor, chunk.metadata)
    )
    coarse_token_guardrail_chunk_count = sum(
        1
        for chunk in chunks
        if is_regulation_body_role(chunk.metadata.get("content_role"))
        and token_guardrail_indicates_coarse_unit(chunk.metadata)
    )
    issues: list[str] = []
    if not chunks:
        issues.append("no_chunks_emitted")
    if missing_title_chunk_count:
        issues.append("missing_title_chunk")
    if missing_contextualization_count:
        issues.append("missing_contextualization")
    if missing_identity_metadata_count:
        issues.append("missing_identity_metadata")
    if invalid_semantic_owner_lineage_count:
        issues.append("invalid_semantic_owner_lineage")
    if wrapper_notice_leak_chunk_count:
        issues.append("wrapper_notice_leak")
    if front_matter_leak_chunk_count:
        issues.append("front_matter_leak")
    if heading_only_body_chunk_count:
        issues.append("heading_only_body_chunk")
    if section_path_body_text_chunk_count:
        issues.append("section_path_body_text")
    if html_tag_chunk_count:
        issues.append("html_tag_residue")
    if form_tail_marker_chunk_count:
        issues.append("form_tail_marker_residue")
    if body_like_section_path_chunk_count:
        issues.append("body_like_section_path")
    if deep_section_path_chunk_count:
        issues.append("deep_section_path")
    if long_section_path_segment_chunk_count:
        issues.append("long_section_path_segment")
    if publication_imprint_chunk_count:
        issues.append("publication_imprint_residue")
    if header_body_duplicate_chunk_count:
        issues.append("header_body_duplicate")
    if title_duplicate_chunk_count:
        issues.append("title_duplicate")
    if header_dominant_chunk_count:
        issues.append("header_dominant")
    if fabricated_page_anchor_chunk_count:
        issues.append("fabricated_page_anchor")
    if coarse_token_guardrail_chunk_count:
        issues.append("coarse_token_guardrail")
    passed = not any(
        issue
        in {
            "no_chunks_emitted",
            "missing_title_chunk",
            "missing_contextualization",
            "missing_identity_metadata",
            "invalid_semantic_owner_lineage",
            "wrapper_notice_leak",
            "front_matter_leak",
            "heading_only_body_chunk",
            "section_path_body_text",
            "html_tag_residue",
            "form_tail_marker_residue",
            "body_like_section_path",
            "deep_section_path",
            "long_section_path_segment",
            "publication_imprint_residue",
            "header_body_duplicate",
            "title_duplicate",
            "header_dominant",
            "fabricated_page_anchor",
            "coarse_token_guardrail",
        }
        for issue in issues
    )
    return InstitutionalRegulationChunkPrepDocumentReport(
        target_document_id=record.document_id,
        target_version_id=record.version_id,
        title=title,
        semantic_owner_kind=semantic_owner_kind,
        source_notice_ids=source_notice_ids,
        unit_count=len(unit_rows),
        chunk_count=len(chunks),
        unit_type_counts=dict(sorted(unit_type_counts.items())),
        split_reason_counts=dict(sorted(split_reason_counts.items())),
        header_mode_counts=dict(sorted(header_mode_counts.items())),
        missing_title_chunk_count=missing_title_chunk_count,
        missing_contextualization_count=missing_contextualization_count,
        missing_identity_metadata_count=missing_identity_metadata_count,
        invalid_semantic_owner_lineage_count=invalid_semantic_owner_lineage_count,
        wrapper_notice_leak_chunk_count=wrapper_notice_leak_chunk_count,
        front_matter_leak_chunk_count=front_matter_leak_chunk_count,
        short_body_chunk_count=short_body_chunk_count,
        heading_only_body_chunk_count=heading_only_body_chunk_count,
        section_path_body_text_chunk_count=section_path_body_text_chunk_count,
        html_tag_chunk_count=html_tag_chunk_count,
        form_tail_marker_chunk_count=form_tail_marker_chunk_count,
        body_like_section_path_chunk_count=body_like_section_path_chunk_count,
        deep_section_path_chunk_count=deep_section_path_chunk_count,
        long_section_path_segment_chunk_count=long_section_path_segment_chunk_count,
        publication_imprint_chunk_count=publication_imprint_chunk_count,
        header_body_duplicate_chunk_count=header_body_duplicate_chunk_count,
        title_duplicate_chunk_count=title_duplicate_chunk_count,
        header_dominant_chunk_count=header_dominant_chunk_count,
        fabricated_page_anchor_chunk_count=fabricated_page_anchor_chunk_count,
        coarse_token_guardrail_chunk_count=coarse_token_guardrail_chunk_count,
        passed=passed,
        issues=tuple(issues),
        document_units_path=str(document_units_path.relative_to(relative_root)),
        chunk_catalog_path=str(chunk_catalog_path.relative_to(relative_root)),
    )


def _has_invalid_semantic_owner_lineage(metadata: dict[str, Any]) -> bool:
    owner_kind = str(metadata.get("semantic_owner_kind") or "").strip()
    notice_document_id = str(metadata.get("source_notice_document_id") or "").strip()
    semantic_owner_document_id = str(metadata.get("semantic_owner_document_id") or "").strip()
    attachment_document_id = str(metadata.get("source_attachment_document_id") or "").strip()
    if owner_kind == "attachment_document":
        return (
            not notice_document_id
            or not semantic_owner_document_id
            or not attachment_document_id
            or notice_document_id == semantic_owner_document_id
            or attachment_document_id != semantic_owner_document_id
        )
    if owner_kind == "notice_body":
        return (
            not notice_document_id
            or not semantic_owner_document_id
            or notice_document_id != semantic_owner_document_id
        )
    return True


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
    for key in ("title", "regulation_display_title", "regulation_title_normalized"):
        value = str(metadata.get(key) or "").strip()
        if value:
            return value
    for row in rows:
        text = str(row.get("clean_text") or "").strip()
        if text:
            return text
    return "institutional-regulation"


def _contains_marker(text: str, markers: Sequence[str]) -> bool:
    normalized = text.strip()
    return any(marker in normalized for marker in markers)


def _resolve_chunk_section_path(chunk: IndexableChunk) -> tuple[object, ...]:
    anchor_path = chunk.anchor.get("section_path")
    if isinstance(anchor_path, list):
        return tuple(anchor_path)
    metadata_path = chunk.metadata.get("section_path")
    if isinstance(metadata_path, list):
        return tuple(metadata_path)
    return ()


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
        or "institutional-regulation"
    )


__all__ = [
    "InstitutionalRegulationChunkPrepDocumentReport",
    "InstitutionalRegulationChunkPrepExportReport",
    "InstitutionalRegulationChunkPrepManifest",
    "InstitutionalRegulationChunkPrepManifestEntry",
    "InstitutionalRegulationChunkPrepValidationReport",
    "build_institutional_regulation_chunk_prep_manifest",
    "build_institutional_regulation_chunk_prep_validation_report",
    "export_institutional_regulation_chunk_prep_artifacts",
    "prepare_institutional_regulation_chunks",
]
