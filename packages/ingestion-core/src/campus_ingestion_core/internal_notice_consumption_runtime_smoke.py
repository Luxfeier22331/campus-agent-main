from __future__ import annotations

import os
from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass

from campus_ingestion_core.internal_notice_consumption_admission import (
    InternalNoticeConsumptionAdmissionStore,
    build_internal_notice_consumption_admission_store_from_env,
)
from campus_ingestion_core.internal_notice_multimodal_processing import (
    ChatCompletionsInternalNoticeMultimodalProcessor,
    InternalNoticeMultimodalAttemptStore,
    build_internal_notice_multimodal_attempt_store_from_env,
)
from campus_ingestion_core.internal_notice_read_model import (
    build_internal_notice_read_model_store_from_env,
    check_internal_notice_read_model_consistency,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NoticeConsumptionProjectionStore,
    build_notice_consumption_projection_store_from_env,
    normalize_notice_ids,
)


@dataclass(frozen=True, slots=True)
class InternalNoticeConsumptionRuntimeSmokeReport:
    source_corpus: str
    source_collection: str
    selected_notice_ids: tuple[str, ...]
    projection_entry_count: int
    pending_multimodal_processing_count: int
    admission_batch_count: int
    multimodal_attempt_count: int
    projection_entries_missing_admission_count: int
    pending_multimodal_without_attempt_count: int
    read_model_ok: bool
    chat_endpoint_checked: bool
    chat_endpoint_ok: bool
    chat_endpoint_error: str
    ok: bool


def run_internal_notice_consumption_runtime_smoke(
    *,
    source_corpus: str = "campus_notices",
    source_collection: str = "internal_notice",
    notice_ids: Sequence[str] = (),
    env: Mapping[str, str] | None = None,
    projection_store: NoticeConsumptionProjectionStore | None = None,
    read_model_store=None,
    admission_store: InternalNoticeConsumptionAdmissionStore | None = None,
    attempt_store: InternalNoticeMultimodalAttemptStore | None = None,
    allow_unattempted_pending: bool = False,
    check_chat_endpoint: bool = False,
    chat_endpoint_checker: Callable[[Mapping[str, str]], tuple[bool, str]] | None = None,
) -> InternalNoticeConsumptionRuntimeSmokeReport:
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
        or build_internal_notice_multimodal_attempt_store_from_env(source, prefer_operator=True)
    )
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
        limit=50,
    )
    completed_admission_batch_ids = {record.batch_id for record in admission_records}
    projection_entries_missing_admission_count = sum(
        1
        for entry in projection_entries
        if not _projection_entry_has_completed_admission(
            entry,
            completed_admission_batch_ids=completed_admission_batch_ids,
        )
    )
    pending_count = sum(
        1
        for entry in projection_entries
        if entry.consumption_status == NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING
    )
    attempt_counts_by_pending_unit = {
        entry.unit_id: len(runtime_attempt_store.list_by_unit(entry.unit_id))
        for entry in projection_entries
        if entry.consumption_status == NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING
    }
    attempt_count = sum(attempt_counts_by_pending_unit.values())
    pending_multimodal_without_attempt_count = sum(
        1
        for attempt_count_for_unit in attempt_counts_by_pending_unit.values()
        if attempt_count_for_unit == 0
    )
    chat_endpoint_ok = True
    chat_endpoint_error = ""
    if check_chat_endpoint:
        chat_endpoint_ok, chat_endpoint_error = _check_chat_endpoint(
            source,
            chat_endpoint_checker=chat_endpoint_checker,
        )
    ok = (
        bool(projection_entries)
        and bool(admission_records)
        and projection_entries_missing_admission_count == 0
        and (allow_unattempted_pending or pending_multimodal_without_attempt_count == 0)
        and consistency.ok
        and chat_endpoint_ok
    )
    return InternalNoticeConsumptionRuntimeSmokeReport(
        source_corpus=source_corpus,
        source_collection=source_collection,
        selected_notice_ids=normalized_notice_ids,
        projection_entry_count=len(projection_entries),
        pending_multimodal_processing_count=pending_count,
        admission_batch_count=len(admission_records),
        multimodal_attempt_count=attempt_count,
        projection_entries_missing_admission_count=(projection_entries_missing_admission_count),
        pending_multimodal_without_attempt_count=pending_multimodal_without_attempt_count,
        read_model_ok=consistency.ok,
        chat_endpoint_checked=check_chat_endpoint,
        chat_endpoint_ok=chat_endpoint_ok,
        chat_endpoint_error=chat_endpoint_error,
        ok=ok,
    )


def _projection_entry_has_completed_admission(
    entry,
    *,
    completed_admission_batch_ids: set[str],
) -> bool:
    batch_id = str(entry.role_metadata.get("consumer_admission_batch_id") or "").strip()
    return bool(batch_id) and batch_id in completed_admission_batch_ids


def _check_chat_endpoint(
    env: Mapping[str, str],
    *,
    chat_endpoint_checker: Callable[[Mapping[str, str]], tuple[bool, str]] | None,
) -> tuple[bool, str]:
    if chat_endpoint_checker is not None:
        return chat_endpoint_checker(env)
    try:
        ChatCompletionsInternalNoticeMultimodalProcessor.from_env(env)
    except Exception as exc:
        return False, str(exc)
    return True, ""


__all__ = [
    "InternalNoticeConsumptionRuntimeSmokeReport",
    "run_internal_notice_consumption_runtime_smoke",
]
