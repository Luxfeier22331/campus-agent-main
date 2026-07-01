from __future__ import annotations

import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from campus_ingestion_core.campus_agent_ingestion_support import S3ObjectStoreWriter
from campus_ingestion_core.internal_notice_read_model_entries import (
    InternalNoticeReadModelObjectStore,
    _is_queryable,
    build_internal_notice_read_model_entries,
)
from campus_ingestion_core.internal_notice_read_model_env import (
    build_internal_notice_read_model_store_from_env,
)
from campus_ingestion_core.internal_notice_read_model_shared import (
    InternalNoticeReadModelEntry,
    InternalNoticeReadModelStore,
    normalize_notice_ids,
)
from campus_ingestion_core.notice_consumption_projection import (
    NoticeConsumptionProjectionStore,
    build_notice_consumption_projection_store_from_env,
)
from campus_ingestion_core.registry import build_document_registry_from_env
from campus_ingestion_core.settings import ObjectStoreSettings


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


__all__ = (
    "InternalNoticeReadModelConsistencyReport",
    "InternalNoticeReadModelRepairReport",
    "check_internal_notice_read_model_consistency",
    "rebuild_internal_notice_read_model",
    "repair_internal_notice_read_model_consistency",
)
