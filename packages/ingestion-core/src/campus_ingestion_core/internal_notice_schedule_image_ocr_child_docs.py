from __future__ import annotations

import hashlib
from collections.abc import Sequence
from typing import Any

from campus_ingestion_core.internal_notice_schedule_image_ocr_constants import _GUIDE_HINTS
from campus_ingestion_core.internal_notice_schedule_image_ocr_models import (
    ScheduleImageOcrChildDocument,
    ScheduleImageOcrChildDocumentArtifactReport,
    ScheduleImageOcrEvidence,
    ScheduleImageOcrProviderResult,
    ScheduleImageOcrWritableObjectStore,
)
from campus_ingestion_core.internal_notice_schedule_image_ocr_payloads import (
    _document_units_jsonl,
    _tables_payload,
)
from campus_ingestion_core.internal_notice_schedule_image_ocr_scalars import (
    _clean_context_line,
    normalize_schedule_image_ocr_attachment_ref_id,
)
from campus_ingestion_core.models import DocumentRegistryRecord


def write_schedule_image_ocr_child_document_artifacts(
    *,
    document: ScheduleImageOcrChildDocument,
    object_store: ScheduleImageOcrWritableObjectStore,
    derived_bucket: str,
    year: str,
) -> ScheduleImageOcrChildDocumentArtifactReport:
    base_key = (
        "campus_notices/documents/internal_notice/"
        f"{document.source_notice_id}/{document.attachment_ref_id}/source-faithful/{year}"
    )
    canonical_key = f"{base_key}/canonical.md"
    units_key = f"{base_key}/document-units.jsonl"
    canonical_bytes = document.canonical_markdown.encode("utf-8")
    units_bytes = _document_units_jsonl(document.document_units).encode("utf-8")
    object_store.put_bytes(
        bucket=derived_bucket,
        key=canonical_key,
        data=canonical_bytes,
        content_type="text/markdown; charset=utf-8",
    )
    object_store.put_bytes(
        bucket=derived_bucket,
        key=units_key,
        data=units_bytes,
        content_type="application/x-ndjson; charset=utf-8",
    )
    content_hash = "sha256:" + hashlib.sha256(canonical_bytes + b"\n" + units_bytes).hexdigest()
    return ScheduleImageOcrChildDocumentArtifactReport(
        document_id=document.document_id,
        canonical_markdown_object_key=canonical_key,
        document_units_object_key=units_key,
        content_hash=content_hash,
    )


def build_schedule_image_ocr_child_document_registry_record(
    *,
    evidence: ScheduleImageOcrEvidence,
    document: ScheduleImageOcrChildDocument,
    artifact_report: ScheduleImageOcrChildDocumentArtifactReport,
    generated_at: str,
) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document.document_id,
        revision_track="source-faithful",
        version_id=f"{artifact_report.content_hash}:source-faithful",
        source_uri=(
            "authenticated_notice_portal://example_internal_portal/notices/"
            f"{evidence.notice_id}/attachments/{document.attachment_ref_id}"
        ),
        content_hash=artifact_report.content_hash,
        corpus="campus_notices",
        collection="internal_notice",
        cleaning_policy_version="authenticated_notice_schedule_image_ocr.v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp=generated_at,
        parser_version="authenticated_notice_schedule_image_ocr.v1",
        source_channel="authenticated_notice_portal",
        is_current=True,
        published_date=evidence.release_time.split(maxsplit=1)[0]
        if evidence.release_time
        else None,
        provenance_status="source_ocr_admitted",
        document_units_object_key=artifact_report.document_units_object_key,
        canonical_markdown_object_key=artifact_report.canonical_markdown_object_key,
        processed_object_keys=(
            artifact_report.canonical_markdown_object_key,
            artifact_report.document_units_object_key,
        ),
        import_source="authenticated_notice_schedule_image_ocr",
    )


def _build_child_document(
    *,
    evidence: ScheduleImageOcrEvidence,
    result: ScheduleImageOcrProviderResult,
    schedule_tables: tuple[tuple[tuple[str, ...], ...], ...],
    generated_at: str,
) -> ScheduleImageOcrChildDocument:
    attachment_ref_id = normalize_schedule_image_ocr_attachment_ref_id(evidence.attachment_ref_id)
    document_id = (
        "notice_attachment:example_internal_portal:"
        f"{evidence.notice_id}:{attachment_ref_id}:schedule-ocr"
    )
    table_context_lines = _schedule_table_context_lines(result)
    markdown_parts = [
        f"# {evidence.notice_title}",
        "",
        f"- notice_id: `{evidence.notice_id}`",
        f"- attachment_ref_id: `{attachment_ref_id}`",
        f"- generated_at: `{generated_at}`",
        f"- ocr_provider: `{result.provider}`",
        f"- ocr_model: `{result.model}`",
        "",
    ]
    if table_context_lines:
        markdown_parts.extend(table_context_lines)
        markdown_parts.append("")
    document_units: list[dict[str, Any]] = []
    for index, table in enumerate(schedule_tables, start=1):
        markdown_parts.append(f"## Schedule table {index}")
        markdown_parts.append("")
        markdown_parts.extend(_markdown_table(table))
        markdown_parts.append("")
        document_units.append(
            {
                "unit_id": f"{document_id}:table-{index}",
                "unit_type": "table_unit",
                "source_notice_id": evidence.notice_id,
                "source_attachment_ref_id": attachment_ref_id,
                "clean_text": _table_unit_clean_text(
                    context_lines=table_context_lines,
                    table=table,
                ),
                "table_cells": _tables_payload((table,))[0],
                "metadata": {
                    "source": "authenticated_notice_schedule_image_ocr",
                    "confidence": result.confidence,
                    "image_index": evidence.image_index,
                    "context_lines": list(table_context_lines),
                },
            }
        )
    return ScheduleImageOcrChildDocument(
        document_id=document_id,
        canonical_markdown="\n".join(markdown_parts).rstrip() + "\n",
        document_units=tuple(document_units),
        source_notice_id=evidence.notice_id,
        attachment_ref_id=attachment_ref_id,
    )


def _schedule_table_context_lines(result: ScheduleImageOcrProviderResult) -> tuple[str, ...]:
    lines: list[str] = []
    for raw_line in str(result.extracted_text or "").splitlines():
        line = _clean_context_line(raw_line)
        if not line:
            continue
        if any(hint in line for hint in _GUIDE_HINTS):
            continue
        if "表" not in line:
            continue
        if not any(hint in line for hint in ("班次", "时刻", "发车", "通勤", "接驳")):
            continue
        lines.append(line)
    return tuple(dict.fromkeys(lines))


def _table_unit_clean_text(
    *,
    context_lines: Sequence[str],
    table: Sequence[Sequence[str]],
) -> str:
    table_lines = tuple(
        " | ".join(str(cell or "").strip() for cell in row if str(cell or "").strip())
        for row in table
        if row
    )
    return "\n".join([*context_lines, *table_lines]).strip()


def _markdown_table(table: Sequence[Sequence[str]]) -> list[str]:
    if not table:
        return []
    width = max((len(row) for row in table), default=0)
    rows = [[str(cell or "").strip() for cell in row] for row in table]
    rows = [row + [""] * (width - len(row)) for row in rows]
    header = rows[0]
    body = rows[1:]
    lines = [
        "| " + " | ".join(header) + " |",
        "| " + " | ".join("---" for _ in header) + " |",
    ]
    lines.extend("| " + " | ".join(row) + " |" for row in body)
    return lines
