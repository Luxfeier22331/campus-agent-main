from __future__ import annotations

import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

from campus_ingestion_core.campusrag_ingestion_support import S3ObjectStoreWriter
from campus_ingestion_core.internal_notice_read_model_memory import (
    InMemoryInternalNoticeReadModelStore,
)
from campus_ingestion_core.internal_notice_read_model_postgres import (
    PostgresInternalNoticeReadModelStore,
)
from campus_ingestion_core.internal_notice_read_model_shared import (
    DEFAULT_INTERNAL_NOTICE_BODY_EXCERPT_MAX_CHARS,
    DEFAULT_INTERNAL_NOTICE_READ_MODEL_ENV_KEY,
    DEFAULT_INTERNAL_NOTICE_READ_MODEL_MANAGEMENT_ENV_KEY,
    DEFAULT_INTERNAL_NOTICE_READ_MODEL_OPERATOR_ENV_KEY,
    DEFAULT_INTERNAL_NOTICE_READ_MODEL_SCHEMA,
    DEFAULT_INTERNAL_NOTICE_READ_MODEL_TABLE,
    DEFAULT_INTERNAL_NOTICE_SEARCH_TEXT_MAX_CHARS,
    InternalNoticeReadModelEntry,
    InternalNoticeReadModelStore,
    normalize_notice_ids,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_PROCUREMENT_NOTICE_HISTORY,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NOTICE_TARGET_SURFACE_UNSUPPORTED,
    NoticeConsumptionProjectionEntry,
    NoticeConsumptionProjectionStore,
    build_notice_consumption_projection_store_from_env,
    is_notice_query_retained_consumption_status,
)
from campus_ingestion_core.postgres_runtime import build_operator_postgres_connection_url
from campus_ingestion_core.registry import (
    DOCUMENT_REGISTRY_ENV_KEY,
    DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY,
    DOCUMENT_REGISTRY_OPERATOR_ENV_KEY,
    SHARED_POSTGRES_ENV_KEY,
    SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
    _postgres_connection,
    build_document_registry_from_env,
)
from campus_ingestion_core.settings import ObjectStoreSettings


class InternalNoticeReadModelObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class InternalNoticeReadModelConsistencyReport:
    source_corpus: str
    source_collection: str
    selected_notice_ids: tuple[str, ...]
    projection_entry_count: int
    projection_queryable_count: int
    read_model_entry_count: int
    missing_queryable_projection_unit_ids: tuple[str, ...]
    extra_read_model_unit_ids: tuple[str, ...]
    ok: bool


@dataclass(frozen=True, slots=True)
class InternalNoticeReadModelRepairReport:
    source_corpus: str
    source_collection: str
    selected_notice_ids: tuple[str, ...]
    before: InternalNoticeReadModelConsistencyReport
    after: InternalNoticeReadModelConsistencyReport
    rebuilt_count: int


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


def rebuild_internal_notice_read_model(
    *,
    source_corpus: str = "campus_notices",
    source_collection: str = "internal_notice",
    notice_ids: Sequence[str] = (),
    env: Mapping[str, str] | None = None,
    projection_store: NoticeConsumptionProjectionStore | None = None,
    read_model_store: InternalNoticeReadModelStore | None = None,
    registry=None,
    object_store: InternalNoticeReadModelObjectStore | None = None,
    bucket_derived: str | None = None,
) -> tuple[InternalNoticeReadModelEntry, ...]:
    source = dict(env if env is not None else os.environ)
    runtime_projection_store = (
        projection_store or build_notice_consumption_projection_store_from_env(source)
    )
    runtime_read_model_store = read_model_store or build_internal_notice_read_model_store_from_env(
        source
    )
    runtime_registry = registry or build_document_registry_from_env(source)
    if object_store is None or bucket_derived is None:
        object_settings = ObjectStoreSettings.from_env(source)
        runtime_object_store = object_store or S3ObjectStoreWriter(object_settings)
        runtime_bucket_derived = bucket_derived or object_settings.bucket_derived
    else:
        runtime_object_store = object_store
        runtime_bucket_derived = bucket_derived
    normalized_notice_ids = normalize_notice_ids(notice_ids)
    if not normalized_notice_ids and isinstance(
        runtime_read_model_store, PostgresInternalNoticeReadModelStore
    ):
        raise ValueError(
            "refusing persistent full-scope internal notice read model rebuild without "
            "explicit notice_ids"
        )
    projection_entries = runtime_projection_store.list_by_scope(
        source_corpus,
        source_collection,
        notice_ids=normalized_notice_ids,
    )
    rows = build_internal_notice_read_model_entries(
        projection_entries,
        registry=runtime_registry,
        object_store=runtime_object_store,
        bucket_derived=runtime_bucket_derived,
    )
    if normalized_notice_ids:
        runtime_read_model_store.replace_notices(
            source_corpus,
            source_collection,
            notice_ids=normalized_notice_ids,
            records=rows,
        )
        return runtime_read_model_store.list_by_scope(
            source_corpus,
            source_collection,
            notice_ids=normalized_notice_ids,
        )
    runtime_read_model_store.replace_scope(source_corpus, source_collection, rows)
    return runtime_read_model_store.list_by_scope(source_corpus, source_collection)


def check_internal_notice_read_model_consistency(
    *,
    source_corpus: str = "campus_notices",
    source_collection: str = "internal_notice",
    notice_ids: Sequence[str] = (),
    env: Mapping[str, str] | None = None,
    projection_store: NoticeConsumptionProjectionStore | None = None,
    read_model_store: InternalNoticeReadModelStore | None = None,
) -> InternalNoticeReadModelConsistencyReport:
    source = dict(env if env is not None else os.environ)
    runtime_projection_store = (
        projection_store or build_notice_consumption_projection_store_from_env(source)
    )
    runtime_read_model_store = read_model_store or build_internal_notice_read_model_store_from_env(
        source
    )
    normalized_notice_ids = normalize_notice_ids(notice_ids)
    projection_entries = runtime_projection_store.list_by_scope(
        source_corpus,
        source_collection,
        notice_ids=normalized_notice_ids,
    )
    read_model_rows = runtime_read_model_store.list_by_scope(
        source_corpus,
        source_collection,
        notice_ids=normalized_notice_ids,
    )
    projection_unit_ids = {entry.unit_id for entry in projection_entries}
    queryable_projection_unit_ids = {
        entry.unit_id for entry in projection_entries if _is_queryable(entry)
    }
    read_model_unit_ids = {row.unit_id for row in read_model_rows}
    missing_queryable_projection_unit_ids = tuple(
        sorted(queryable_projection_unit_ids - read_model_unit_ids)
    )
    extra_read_model_unit_ids = tuple(sorted(read_model_unit_ids - projection_unit_ids))
    return InternalNoticeReadModelConsistencyReport(
        source_corpus=source_corpus,
        source_collection=source_collection,
        selected_notice_ids=normalized_notice_ids,
        projection_entry_count=len(projection_entries),
        projection_queryable_count=len(queryable_projection_unit_ids),
        read_model_entry_count=len(read_model_rows),
        missing_queryable_projection_unit_ids=missing_queryable_projection_unit_ids,
        extra_read_model_unit_ids=extra_read_model_unit_ids,
        ok=not missing_queryable_projection_unit_ids and not extra_read_model_unit_ids,
    )


def repair_internal_notice_read_model_consistency(
    *,
    source_corpus: str = "campus_notices",
    source_collection: str = "internal_notice",
    notice_ids: Sequence[str] = (),
    env: Mapping[str, str] | None = None,
    projection_store: NoticeConsumptionProjectionStore | None = None,
    read_model_store: InternalNoticeReadModelStore | None = None,
    registry=None,
    object_store: InternalNoticeReadModelObjectStore | None = None,
    bucket_derived: str | None = None,
) -> InternalNoticeReadModelRepairReport:
    normalized_notice_ids = normalize_notice_ids(notice_ids)
    if not normalized_notice_ids:
        raise ValueError("selected notice_ids are required for read model consistency repair")
    before = check_internal_notice_read_model_consistency(
        source_corpus=source_corpus,
        source_collection=source_collection,
        notice_ids=normalized_notice_ids,
        env=env,
        projection_store=projection_store,
        read_model_store=read_model_store,
    )
    rows = rebuild_internal_notice_read_model(
        source_corpus=source_corpus,
        source_collection=source_collection,
        notice_ids=normalized_notice_ids,
        env=env,
        projection_store=projection_store,
        read_model_store=read_model_store,
        registry=registry,
        object_store=object_store,
        bucket_derived=bucket_derived,
    )
    after = check_internal_notice_read_model_consistency(
        source_corpus=source_corpus,
        source_collection=source_collection,
        notice_ids=normalized_notice_ids,
        env=env,
        projection_store=projection_store,
        read_model_store=read_model_store,
    )
    return InternalNoticeReadModelRepairReport(
        source_corpus=source_corpus,
        source_collection=source_collection,
        selected_notice_ids=normalized_notice_ids,
        before=before,
        after=after,
        rebuilt_count=len(rows),
    )


def build_internal_notice_read_model_store_from_env(
    env: dict[str, str] | None = None,
    *,
    prefer_operator: bool = False,
) -> PostgresInternalNoticeReadModelStore:
    source = env if env is not None else dict(os.environ)
    if prefer_operator:
        operator_database_url = (
            source.get(DEFAULT_INTERNAL_NOTICE_READ_MODEL_OPERATOR_ENV_KEY)
            or source.get(DEFAULT_INTERNAL_NOTICE_READ_MODEL_MANAGEMENT_ENV_KEY)
            or source.get(DOCUMENT_REGISTRY_OPERATOR_ENV_KEY)
            or source.get(DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY)
            or source.get(SHARED_POSTGRES_OPERATOR_ENV_KEY)
            or source.get(SHARED_POSTGRES_MANAGEMENT_ENV_KEY)
            or ""
        ).strip()
        if not operator_database_url:
            raise ValueError(
                f"{DEFAULT_INTERNAL_NOTICE_READ_MODEL_OPERATOR_ENV_KEY} or "
                f"{DEFAULT_INTERNAL_NOTICE_READ_MODEL_MANAGEMENT_ENV_KEY} or "
                f"{DOCUMENT_REGISTRY_OPERATOR_ENV_KEY} or "
                f"{DOCUMENT_REGISTRY_MANAGEMENT_ENV_KEY} or "
                f"{SHARED_POSTGRES_OPERATOR_ENV_KEY} or "
                f"{SHARED_POSTGRES_MANAGEMENT_ENV_KEY} is required when prefer_operator=True"
            )
        return PostgresInternalNoticeReadModelStore(
            database_url=build_operator_postgres_connection_url(operator_database_url)
        )
    database_url = (
        source.get(DEFAULT_INTERNAL_NOTICE_READ_MODEL_ENV_KEY)
        or source.get(SHARED_POSTGRES_ENV_KEY)
        or source.get(DOCUMENT_REGISTRY_ENV_KEY)
        or ""
    ).strip()
    if not database_url:
        raise ValueError(
            f"{DEFAULT_INTERNAL_NOTICE_READ_MODEL_ENV_KEY} or {SHARED_POSTGRES_ENV_KEY} is required"
        )
    return PostgresInternalNoticeReadModelStore(database_url=database_url)


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
    return (
        is_notice_query_retained_consumption_status(entry.consumption_status)
        and entry.consumption_status != NOTICE_CONSUMPTION_STATUS_NO_ADOPTION
        and entry.target_surface
        in {
            NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
            NOTICE_TARGET_SURFACE_PROCUREMENT_NOTICE_HISTORY,
            NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
        }
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


__all__ = [
    "DEFAULT_INTERNAL_NOTICE_BODY_EXCERPT_MAX_CHARS",
    "DEFAULT_INTERNAL_NOTICE_READ_MODEL_ENV_KEY",
    "DEFAULT_INTERNAL_NOTICE_READ_MODEL_MANAGEMENT_ENV_KEY",
    "DEFAULT_INTERNAL_NOTICE_READ_MODEL_OPERATOR_ENV_KEY",
    "DEFAULT_INTERNAL_NOTICE_READ_MODEL_SCHEMA",
    "DEFAULT_INTERNAL_NOTICE_READ_MODEL_TABLE",
    "DEFAULT_INTERNAL_NOTICE_SEARCH_TEXT_MAX_CHARS",
    "InMemoryInternalNoticeReadModelStore",
    "InternalNoticeReadModelConsistencyReport",
    "InternalNoticeReadModelEntry",
    "InternalNoticeReadModelObjectStore",
    "InternalNoticeReadModelRepairReport",
    "InternalNoticeReadModelStore",
    "PostgresInternalNoticeReadModelStore",
    "_postgres_connection",
    "build_internal_notice_read_model_entries",
    "build_internal_notice_read_model_store_from_env",
    "check_internal_notice_read_model_consistency",
    "normalize_notice_ids",
    "rebuild_internal_notice_read_model",
    "repair_internal_notice_read_model_consistency",
]
