from __future__ import annotations

from collections.abc import Mapping, Sequence

from campus_ingestion_core.notice_consumption_projection import (
    InMemoryNoticeConsumptionProjectionStore,
    NoticeConsumptionProjectionEntry,
    NoticeConsumptionProjectionStore,
    build_notice_consumption_projection_store_from_env,
)
from campus_ingestion_core.object_store_admin import S3ObjectStoreAdmin
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.wechat_public_notice_projection_models import (
    WeChatPublicNoticeProjectionObjectStore,
)


def _load_reference_projection_entries(
    *,
    projection_store: NoticeConsumptionProjectionStore,
    source_corpus: str,
    source_collection: str,
    reference_scopes: Sequence[tuple[str, str]],
) -> tuple[NoticeConsumptionProjectionEntry, ...]:
    entries: list[NoticeConsumptionProjectionEntry] = []
    visited: set[tuple[str, str]] = set()
    scopes = list(reference_scopes) or [(source_corpus, source_collection)]
    if (source_corpus, source_collection) not in scopes:
        scopes.append((source_corpus, source_collection))
    for scope in scopes:
        if len(scope) != 2:
            continue
        corpus = str(scope[0]).strip()
        collection = str(scope[1]).strip()
        if not (corpus and collection):
            continue
        if (corpus, collection) in visited:
            continue
        visited.add((corpus, collection))
        entries.extend(projection_store.list_by_scope(corpus, collection))
    return tuple(entries)


def _build_projection_store(
    env: Mapping[str, str], *, dry_run: bool
) -> NoticeConsumptionProjectionStore:
    if dry_run:
        return InMemoryNoticeConsumptionProjectionStore()
    return build_notice_consumption_projection_store_from_env(dict(env))


def _build_source_object_store(
    env: Mapping[str, str],
) -> WeChatPublicNoticeProjectionObjectStore:
    settings = ObjectStoreSettings.from_env(dict(env))
    return S3ObjectStoreAdmin(settings)
