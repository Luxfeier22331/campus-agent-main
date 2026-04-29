from __future__ import annotations

import os
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Protocol

from campus_ingestion_core.internal_notice_consumption_admission import (
    InternalNoticeConsumptionAdmissionStore,
    build_internal_notice_consumption_admission_store_from_env,
)
from campus_ingestion_core.internal_notice_read_model import (
    build_internal_notice_read_model_store_from_env,
    check_internal_notice_read_model_consistency,
)
from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NoticeConsumptionProjectionStore,
    build_notice_consumption_projection_store_from_env,
    normalize_notice_ids,
)
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.wechat_public_notice_multimodal import (
    ChatCompletionsWeChatPublicNoticeMultimodalProvider,
    WeChatPublicNoticeMultimodalAttemptStore,
    build_wechat_public_notice_multimodal_attempt_store_from_env,
)


class WeChatPublicNoticeRuntimeSmokeObjectStore(Protocol):
    def head_object(self, *, bucket: str, key: str) -> dict[str, object]: ...


@dataclass(frozen=True, slots=True)
class WeChatPublicNoticeRuntimeSmokeReport:
    source_corpus: str
    source_collection: str
    selected_notice_ids: tuple[str, ...]
    projection_entry_count: int
    completed_admission_batch_count: int
    projection_entries_missing_admission_count: int
    pending_multimodal_without_attempt_count: int
    pending_multimodal_without_source_image_count: int
    queryable_without_captured_body_count: int
    source_truth_missing_object_count: int
    read_model_ok: bool
    multimodal_provider_checked: bool
    multimodal_provider_ok: bool
    multimodal_provider_error: str
    ok: bool


def run_wechat_public_notice_runtime_smoke(
    *,
    source_corpus: str = "campus_notices",
    source_collection: str = "wechat_public_notice",
    notice_ids: Sequence[str] = (),
    env: Mapping[str, str] | None = None,
    projection_store: NoticeConsumptionProjectionStore | None = None,
    read_model_store=None,
    admission_store: InternalNoticeConsumptionAdmissionStore | None = None,
    attempt_store: WeChatPublicNoticeMultimodalAttemptStore | None = None,
    object_store: WeChatPublicNoticeRuntimeSmokeObjectStore | None = None,
    check_multimodal_provider: bool = False,
    multimodal_provider_checker: Callable[[Mapping[str, str]], tuple[bool, str]] | None = None,
) -> WeChatPublicNoticeRuntimeSmokeReport:
    normalized_notice_ids = normalize_notice_ids(notice_ids)
    source = dict(env if env is not None else os.environ)
    runtime_projection_store = (
        projection_store
        or build_notice_consumption_projection_store_from_env(source, prefer_operator=True)
    )
    runtime_read_model_store = read_model_store or build_internal_notice_read_model_store_from_env(
        source
    )
    runtime_admission_store = (
        admission_store
        or build_internal_notice_consumption_admission_store_from_env(
            source,
            prefer_operator=True,
        )
    )
    runtime_attempt_store = (
        attempt_store
        or build_wechat_public_notice_multimodal_attempt_store_from_env(
            source,
            prefer_operator=True,
        )
    )
    runtime_object_store = object_store
    if runtime_object_store is None:
        runtime_object_store = S3ObjectStoreAdmin(ObjectStoreSettings.from_env(source))

    projection_entries = runtime_projection_store.list_by_scope(
        source_corpus,
        source_collection,
        notice_ids=normalized_notice_ids,
    )
    consistency = check_internal_notice_read_model_consistency(
        source_corpus=source_corpus,
        source_collection=source_collection,
        notice_ids=normalized_notice_ids,
        projection_store=runtime_projection_store,
        read_model_store=runtime_read_model_store,
    )
    admission_records = runtime_admission_store.list_records(
        source_corpus=source_corpus,
        source_collection=source_collection,
        notice_ids=normalized_notice_ids,
        statuses=("completed",),
        limit=100,
    )
    completed_batch_ids = {record.batch_id for record in admission_records}

    projection_entries_missing_admission_count = 0
    pending_multimodal_without_attempt_count = 0
    pending_multimodal_without_source_image_count = 0
    queryable_without_captured_body_count = 0
    source_truth_missing_object_count = 0

    for entry in projection_entries:
        metadata = dict(entry.role_metadata or {})
        batch_id = str(metadata.get("consumer_admission_batch_id") or "").strip()
        if not batch_id or batch_id not in completed_batch_ids:
            projection_entries_missing_admission_count += 1
        if (
            _is_queryable_projection_entry(entry)
            and str(metadata.get("body_state") or "") != "captured"
        ):
            queryable_without_captured_body_count += 1
        if _entry_has_missing_source_truth(metadata, object_store=runtime_object_store):
            source_truth_missing_object_count += 1
        if entry.consumption_status != NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING:
            continue
        source_image_keys = _string_tuple(metadata.get("source_image_object_keys"))
        if not source_image_keys:
            pending_multimodal_without_source_image_count += 1
        attempt_count = 0
        for media_ref_id in _string_tuple(metadata.get("inline_image_ref_ids")):
            attempt_count += len(
                runtime_attempt_store.list_by_image(
                    source_notice_id=entry.source_notice_id,
                    media_ref_id=media_ref_id,
                )
            )
        if attempt_count == 0:
            pending_multimodal_without_attempt_count += 1

    multimodal_provider_ok = True
    multimodal_provider_error = ""
    if check_multimodal_provider:
        multimodal_provider_ok, multimodal_provider_error = _check_multimodal_provider(
            source,
            multimodal_provider_checker=multimodal_provider_checker,
        )

    ok = (
        bool(projection_entries)
        and bool(admission_records)
        and projection_entries_missing_admission_count == 0
        and pending_multimodal_without_attempt_count == 0
        and pending_multimodal_without_source_image_count == 0
        and queryable_without_captured_body_count == 0
        and source_truth_missing_object_count == 0
        and consistency.ok
        and multimodal_provider_ok
    )
    return WeChatPublicNoticeRuntimeSmokeReport(
        source_corpus=source_corpus,
        source_collection=source_collection,
        selected_notice_ids=normalized_notice_ids,
        projection_entry_count=len(projection_entries),
        completed_admission_batch_count=len(admission_records),
        projection_entries_missing_admission_count=projection_entries_missing_admission_count,
        pending_multimodal_without_attempt_count=pending_multimodal_without_attempt_count,
        pending_multimodal_without_source_image_count=(
            pending_multimodal_without_source_image_count
        ),
        queryable_without_captured_body_count=queryable_without_captured_body_count,
        source_truth_missing_object_count=source_truth_missing_object_count,
        read_model_ok=consistency.ok,
        multimodal_provider_checked=check_multimodal_provider,
        multimodal_provider_ok=multimodal_provider_ok,
        multimodal_provider_error=multimodal_provider_error,
        ok=ok,
    )


def _is_queryable_projection_entry(entry) -> bool:
    return str(entry.consumption_status or "").strip() == "retained_for_notice_query"


def _entry_has_missing_source_truth(
    metadata: Mapping[str, object],
    *,
    object_store: WeChatPublicNoticeRuntimeSmokeObjectStore | None,
) -> bool:
    bucket = str(metadata.get("source_bucket") or "").strip()
    manifest_key = str(metadata.get("manifest_key") or "").strip()
    content_blocks_key = str(metadata.get("content_blocks_key") or "").strip()
    media_refs_key = str(metadata.get("media_refs_key") or "").strip()
    if not (bucket and manifest_key and content_blocks_key and media_refs_key):
        return True
    if object_store is None:
        return False
    for object_key in (manifest_key, content_blocks_key, media_refs_key):
        try:
            object_store.head_object(bucket=bucket, key=object_key)
        except Exception:
            return True
    return False


def _check_multimodal_provider(
    env: Mapping[str, str],
    *,
    multimodal_provider_checker: Callable[[Mapping[str, str]], tuple[bool, str]] | None,
) -> tuple[bool, str]:
    if multimodal_provider_checker is not None:
        return multimodal_provider_checker(env)
    try:
        ChatCompletionsWeChatPublicNoticeMultimodalProvider.from_env(env)
    except Exception as exc:
        return False, str(exc)
    return True, ""


def _string_tuple(value: object) -> tuple[str, ...]:
    if isinstance(value, str):
        item = value.strip()
        return (item,) if item else ()
    if not isinstance(value, (list, tuple)):
        return ()
    items: list[str] = []
    for item in value:
        normalized = str(item or "").strip()
        if normalized:
            items.append(normalized)
    return tuple(dict.fromkeys(items))


__all__ = [
    "WeChatPublicNoticeRuntimeSmokeReport",
    "run_wechat_public_notice_runtime_smoke",
]
