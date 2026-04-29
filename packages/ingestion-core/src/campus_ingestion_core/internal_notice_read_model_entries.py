from __future__ import annotations

from collections.abc import Sequence
from typing import Protocol

from campus_ingestion_core.internal_notice_read_model_shared import (
    DEFAULT_INTERNAL_NOTICE_BODY_EXCERPT_MAX_CHARS,
    DEFAULT_INTERNAL_NOTICE_SEARCH_TEXT_MAX_CHARS,
    InternalNoticeReadModelEntry,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_UNSUPPORTED,
    NoticeConsumptionProjectionEntry,
    is_notice_query_retained_consumption_status,
)


class InternalNoticeReadModelObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


def build_internal_notice_read_model_entries(
    projection_entries: Sequence[NoticeConsumptionProjectionEntry],
    *,
    registry,
    object_store: InternalNoticeReadModelObjectStore,
    bucket_derived: str,
) -> tuple[InternalNoticeReadModelEntry, ...]:
    if not projection_entries:
        return ()
    source_corpus = projection_entries[0].source_corpus
    source_collection = projection_entries[0].source_collection
    records_by_document_id = _index_current_scope_records(
        registry.list_by_scope(source_corpus, source_collection)
    )
    rows: list[InternalNoticeReadModelEntry] = []
    for entry in projection_entries:
        if not _is_notice_read_model_surface(entry):
            continue
        document_id = entry.source_document_id or entry.source_notice_document_id
        record = records_by_document_id.get(document_id) or records_by_document_id.get(
            entry.source_notice_document_id
        )
        if record is None:
            continue
        title = _resolve_title(entry, record)
        canonical_key = record.canonical_markdown_object_key or ""
        body = (
            object_store.get_bytes(bucket=bucket_derived, key=canonical_key).decode("utf-8")
            if canonical_key
            else ""
        )
        body_excerpt = _build_body_excerpt(_build_read_model_body_text(entry, body))
        rows.append(
            InternalNoticeReadModelEntry(
                source_family=entry.source_family,
                source_corpus=entry.source_corpus,
                source_collection=entry.source_collection,
                source_notice_id=entry.source_notice_id,
                unit_id=entry.unit_id,
                primary_role=entry.primary_role,
                target_surface=entry.target_surface,
                consumption_status=entry.consumption_status,
                queryable=_is_queryable(entry),
                title=title,
                visibility_level=record.visibility_level,
                entitlement_groups=record.entitlement_groups,
                policy_projection_version=record.policy_projection_version,
                published_at=entry.source_notice_release_time or record.published_date or "",
                source_url=record.source_uri,
                canonical_url=record.source_uri,
                canonical_document_id=record.document_id,
                canonical_markdown_object_key=canonical_key,
                attachment_refs=entry.source_attachment_ref_ids,
                provenance_refs=_build_provenance_refs(entry, record),
                body_excerpt=body_excerpt,
                search_text=_build_search_text(
                    entry,
                    title=title,
                    body_excerpt=body_excerpt,
                ),
                projection_updated_at=entry.updated_at,
            )
        )
    return tuple(sorted(rows, key=lambda item: (item.source_notice_id, item.unit_id)))


def _resolve_title(
    entry: NoticeConsumptionProjectionEntry,
    record: DocumentRegistryRecord,
) -> str:
    metadata = entry.role_metadata
    return (
        str(metadata.get("notice_title") or "").strip()
        or str(metadata.get("title") or "").strip()
        or str(metadata.get("regulation_title_normalized") or "").strip()
        or record.document_id
    )


def _is_queryable(entry: NoticeConsumptionProjectionEntry) -> bool:
    return _is_notice_read_model_surface(entry)


def _is_notice_read_model_surface(entry: NoticeConsumptionProjectionEntry) -> bool:
    return (
        is_notice_query_retained_consumption_status(entry.consumption_status)
        and entry.consumption_status != NOTICE_CONSUMPTION_STATUS_NO_ADOPTION
        and entry.target_surface == NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY
        and entry.target_surface != NOTICE_TARGET_SURFACE_UNSUPPORTED
    )


def _build_search_text(
    entry: NoticeConsumptionProjectionEntry,
    *,
    title: str,
    body_excerpt: str,
) -> str:
    metadata_values = [
        str(value)
        for key, value in sorted(entry.role_metadata.items())
        if key
        in {
            "multimodal_extracted_text",
            "multimodal_summary",
            "notice_category",
            "notice_title",
            "title",
        }
    ]
    return "\n".join(
        item.strip()
        for item in (
            title,
            entry.source_notice_id,
            entry.primary_role,
            entry.target_surface,
            *metadata_values,
            body_excerpt,
        )
        if item and item.strip()
    )[:DEFAULT_INTERNAL_NOTICE_SEARCH_TEXT_MAX_CHARS]


def _build_body_excerpt(body: str) -> str:
    return body.strip()[:DEFAULT_INTERNAL_NOTICE_BODY_EXCERPT_MAX_CHARS]


def _build_read_model_body_text(entry: NoticeConsumptionProjectionEntry, body: str) -> str:
    metadata = entry.role_metadata or {}
    return "\n\n".join(
        item
        for item in (
            body.strip(),
            str(metadata.get("multimodal_summary") or "").strip(),
            str(metadata.get("multimodal_extracted_text") or "").strip(),
        )
        if item
    )


def _build_provenance_refs(
    entry: NoticeConsumptionProjectionEntry,
    record: DocumentRegistryRecord,
) -> tuple[str, ...]:
    values = (
        entry.source_notice_document_id,
        entry.source_document_id or "",
        record.document_id,
        *entry.source_attachment_ref_ids,
        entry.unit_id,
    )
    return tuple(dict.fromkeys(str(item).strip() for item in values if str(item).strip()))


def _index_current_scope_records(
    records: Sequence[DocumentRegistryRecord],
) -> dict[str, DocumentRegistryRecord]:
    indexed: dict[str, DocumentRegistryRecord] = {}
    for record in records:
        current = indexed.get(record.document_id)
        if current is None or (record.is_current and not current.is_current):
            indexed[record.document_id] = record
    return indexed


__all__ = (
    "InternalNoticeReadModelObjectStore",
    "build_internal_notice_read_model_entries",
)
