from __future__ import annotations

import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import replace

from campus_ingestion_core.authenticated_notice_closeout_models import utc_now
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
    AuthenticatedNoticeSourceTruthInventoryStore,
    build_authenticated_notice_source_truth_inventory_store_from_env,
)
from campus_ingestion_core.campusrag_ingestion_support import S3ObjectStoreWriter
from campus_ingestion_core.internal_notice_multimodal_processing_attempts import (
    DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_ENV_KEY as DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_ENV_KEY,
)
from campus_ingestion_core.internal_notice_multimodal_processing_attempts import (
    DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_MANAGEMENT_ENV_KEY as DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_MANAGEMENT_ENV_KEY,
)
from campus_ingestion_core.internal_notice_multimodal_processing_attempts import (
    DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_ENV_KEY as DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_ENV_KEY,
)
from campus_ingestion_core.internal_notice_multimodal_processing_attempts import (
    DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_TABLE as DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_TABLE,
)
from campus_ingestion_core.internal_notice_multimodal_processing_attempts import (
    PostgresInternalNoticeMultimodalAttemptStore as PostgresInternalNoticeMultimodalAttemptStore,
)
from campus_ingestion_core.internal_notice_multimodal_processing_attempts import (
    build_internal_notice_multimodal_attempt_store_from_env as build_internal_notice_multimodal_attempt_store_from_env,
)
from campus_ingestion_core.internal_notice_multimodal_processing_models import (
    InMemoryInternalNoticeMultimodalAttemptStore as InMemoryInternalNoticeMultimodalAttemptStore,
)
from campus_ingestion_core.internal_notice_multimodal_processing_models import (
    InternalNoticeMultimodalAttachment,
    InternalNoticeMultimodalAttempt,
    InternalNoticeMultimodalAttemptStore,
    InternalNoticeMultimodalDecision,
    InternalNoticeMultimodalDrainReport,
    InternalNoticeMultimodalItemReport,
    InternalNoticeMultimodalObjectStore,
    InternalNoticeMultimodalProcessingReport,
    InternalNoticeMultimodalProcessingRequest,
    InternalNoticeMultimodalProcessor,
)
from campus_ingestion_core.internal_notice_multimodal_processing_processor import (
    DEFAULT_INTERNAL_NOTICE_MULTIMODAL_BASE_URL as DEFAULT_INTERNAL_NOTICE_MULTIMODAL_BASE_URL,
)
from campus_ingestion_core.internal_notice_multimodal_processing_processor import (
    DEFAULT_INTERNAL_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS as DEFAULT_INTERNAL_NOTICE_MULTIMODAL_MAX_OUTPUT_TOKENS,
)
from campus_ingestion_core.internal_notice_multimodal_processing_processor import (
    DEFAULT_INTERNAL_NOTICE_MULTIMODAL_RUNTIME as DEFAULT_INTERNAL_NOTICE_MULTIMODAL_RUNTIME,
)
from campus_ingestion_core.internal_notice_multimodal_processing_processor import (
    INTERNAL_NOTICE_MULTIMODAL_RUNTIME_AGENTS_SDK as INTERNAL_NOTICE_MULTIMODAL_RUNTIME_AGENTS_SDK,
)
from campus_ingestion_core.internal_notice_multimodal_processing_processor import (
    INTERNAL_NOTICE_MULTIMODAL_RUNTIME_CHAT_COMPLETIONS as INTERNAL_NOTICE_MULTIMODAL_RUNTIME_CHAT_COMPLETIONS,
)
from campus_ingestion_core.internal_notice_multimodal_processing_processor import (
    AgentsSdkInternalNoticeMultimodalProcessor as AgentsSdkInternalNoticeMultimodalProcessor,
)
from campus_ingestion_core.internal_notice_multimodal_processing_processor import (
    ChatCompletionsInternalNoticeMultimodalProcessor as ChatCompletionsInternalNoticeMultimodalProcessor,
)
from campus_ingestion_core.internal_notice_multimodal_processing_processor import (
    build_internal_notice_multimodal_processor_from_env as build_internal_notice_multimodal_processor_from_env,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
    NOTICE_COMPLETENESS_COMPLETE,
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_DEFAULT_AGENT_NOTICE,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_UNSUPPORTED,
    NoticeConsumptionProjectionEntry,
    NoticeConsumptionProjectionStore,
    build_notice_consumption_projection_store_from_env,
    normalize_notice_ids,
)
from campus_ingestion_core.settings import ObjectStoreSettings

DEFAULT_INTERNAL_NOTICE_MULTIMODAL_MAX_ATTEMPTS = 3


def process_internal_notice_pending_multimodal_entries(
    *,
    source_corpus: str = "campus_notices",
    source_collection: str = "internal_notice",
    notice_ids: Sequence[str] = (),
    env: Mapping[str, str] | None = None,
    projection_store: NoticeConsumptionProjectionStore | None = None,
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore | None = None,
    object_store: InternalNoticeMultimodalObjectStore | None = None,
    source_bucket: str | None = None,
    processor: InternalNoticeMultimodalProcessor | None = None,
    attempt_store: InternalNoticeMultimodalAttemptStore | None = None,
    max_attempts: int = DEFAULT_INTERNAL_NOTICE_MULTIMODAL_MAX_ATTEMPTS,
    admission_batch_id: str = "",
    admission_command: str = "",
    admission_created_at: str = "",
) -> InternalNoticeMultimodalProcessingReport:
    normalized_notice_ids = normalize_notice_ids(notice_ids)
    if not normalized_notice_ids:
        raise ValueError("selected notice_ids are required for multimodal processing")
    if max_attempts <= 0:
        raise ValueError("max_attempts must be greater than zero")
    source = dict(env if env is not None else os.environ)
    runtime_projection_store = (
        projection_store or build_notice_consumption_projection_store_from_env(source)
    )
    entries = runtime_projection_store.list_by_scope(
        source_corpus,
        source_collection,
        notice_ids=normalized_notice_ids,
    )
    updated_entries: list[NoticeConsumptionProjectionEntry] = []
    item_reports: list[InternalNoticeMultimodalItemReport] = []
    retained_count = 0
    no_adoption_count = 0
    still_pending_count = 0
    failed_count = 0
    pending_count = 0
    processed_count = 0
    runtime_inventory_store = source_truth_inventory_store
    inventory_by_notice_id: dict[str, AuthenticatedNoticeSourceTruthInventoryEntry] | None = None
    runtime_object_store = object_store
    runtime_source_bucket = source_bucket
    runtime_processor = processor
    for entry in entries:
        if not _is_pending_multimodal_entry(entry):
            updated_entries.append(entry)
            continue
        pending_count += 1
        if runtime_object_store is None or runtime_source_bucket is None:
            object_settings = ObjectStoreSettings.from_env(source)
            runtime_object_store = runtime_object_store or S3ObjectStoreWriter(object_settings)
            runtime_source_bucket = runtime_source_bucket or object_settings.bucket_source
        if runtime_processor is None:
            runtime_processor = build_internal_notice_multimodal_processor_from_env(source)
        if inventory_by_notice_id is None:
            runtime_inventory_store = (
                runtime_inventory_store
                or build_authenticated_notice_source_truth_inventory_store_from_env(source)
            )
            inventory_entries = runtime_inventory_store.list_by_scope(
                source_corpus,
                source_collection,
                notice_ids=normalized_notice_ids,
            )
            inventory_by_notice_id = {item.notice_id: item for item in inventory_entries}
        inventory_entry = inventory_by_notice_id.get(entry.source_notice_id)
        request = _build_processing_request(
            entry=entry,
            inventory_entry=inventory_entry,
            object_store=runtime_object_store,
            source_bucket=runtime_source_bucket,
        )
        try:
            raw_decision = runtime_processor.process(request)
            decision = _guard_multimodal_decision(raw_decision)
        except Exception as exc:
            attempt_number = _next_attempt_number(attempt_store, entry.unit_id)
            decision = InternalNoticeMultimodalDecision(
                action="needs_additional_processing",
                summary="",
                extracted_text="",
                reasons=("processor_failed",),
                confidence="low",
            )
            terminal = attempt_number >= max_attempts
            _record_attempt(
                attempt_store=attempt_store,
                entry=entry,
                source_corpus=source_corpus,
                source_collection=source_collection,
                attempt_number=attempt_number,
                admission_batch_id=admission_batch_id,
                model=_processor_model_label(runtime_processor),
                decision_action="failed",
                status="failed_terminal" if terminal else "failed",
                reasons=decision.reasons,
                error=str(exc),
            )
            failed_count += 1
            if terminal:
                no_adoption_count += 1
                updated_entries.append(
                    _mark_attempts_exhausted(
                        entry,
                        decision,
                        admission_batch_id=admission_batch_id,
                        admission_command=admission_command,
                        admission_created_at=admission_created_at,
                    )
                )
            else:
                still_pending_count += 1
                updated_entries.append(
                    _mark_still_pending(
                        entry,
                        decision,
                        admission_batch_id=admission_batch_id,
                        admission_command=admission_command,
                        admission_created_at=admission_created_at,
                    )
                )
            item_reports.append(
                InternalNoticeMultimodalItemReport(
                    source_notice_id=entry.source_notice_id,
                    unit_id=entry.unit_id,
                    action="failed",
                    status=NOTICE_CONSUMPTION_STATUS_NO_ADOPTION
                    if terminal
                    else NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
                    reason=str(exc),
                )
            )
            continue
        processed_count += 1
        attempt_number = _next_attempt_number(attempt_store, entry.unit_id)
        _record_attempt(
            attempt_store=attempt_store,
            entry=entry,
            source_corpus=source_corpus,
            source_collection=source_collection,
            attempt_number=attempt_number,
            admission_batch_id=admission_batch_id,
            model=_processor_model_label(runtime_processor),
            decision_action=raw_decision.action,
            status="processed_guarded" if decision != raw_decision else "processed",
            reasons=decision.reasons,
            error=None,
        )
        if decision.action == "retain_for_notice_query":
            retained_count += 1
            updated = _mark_retained_for_notice_query(
                entry,
                decision,
                admission_batch_id=admission_batch_id,
                admission_command=admission_command,
                admission_created_at=admission_created_at,
            )
        elif decision.action == "no_adoption":
            no_adoption_count += 1
            updated = _mark_no_adoption(
                entry,
                decision,
                admission_batch_id=admission_batch_id,
                admission_command=admission_command,
                admission_created_at=admission_created_at,
            )
        elif attempt_number >= max_attempts:
            no_adoption_count += 1
            updated = _mark_attempts_exhausted(
                entry,
                decision,
                admission_batch_id=admission_batch_id,
                admission_command=admission_command,
                admission_created_at=admission_created_at,
            )
        else:
            still_pending_count += 1
            updated = _mark_still_pending(
                entry,
                decision,
                admission_batch_id=admission_batch_id,
                admission_command=admission_command,
                admission_created_at=admission_created_at,
            )
        updated_entries.append(updated)
        item_reports.append(
            InternalNoticeMultimodalItemReport(
                source_notice_id=entry.source_notice_id,
                unit_id=entry.unit_id,
                action=decision.action,
                status=updated.consumption_status,
            )
        )
    runtime_projection_store.replace_notices(
        source_corpus,
        source_collection,
        notice_ids=normalized_notice_ids,
        records=tuple(updated_entries),
    )
    return InternalNoticeMultimodalProcessingReport(
        source_corpus=source_corpus,
        source_collection=source_collection,
        selected_notice_ids=normalized_notice_ids,
        projection_entry_count=len(entries),
        pending_entry_count=pending_count,
        processed_count=processed_count,
        retained_for_notice_query_count=retained_count,
        no_adoption_count=no_adoption_count,
        still_pending_count=still_pending_count,
        failed_count=failed_count,
        item_reports=tuple(item_reports),
    )


def select_internal_notice_pending_multimodal_notice_ids(
    *,
    source_corpus: str = "campus_notices",
    source_collection: str = "internal_notice",
    notice_ids: Sequence[str] = (),
    env: Mapping[str, str] | None = None,
    projection_store: NoticeConsumptionProjectionStore | None = None,
    limit: int = 100,
) -> tuple[str, ...]:
    if limit <= 0:
        raise ValueError("limit must be greater than zero")
    source = dict(env if env is not None else os.environ)
    runtime_projection_store = (
        projection_store or build_notice_consumption_projection_store_from_env(source)
    )
    entries = runtime_projection_store.list_by_scope(
        source_corpus,
        source_collection,
        notice_ids=normalize_notice_ids(notice_ids),
    )
    return _pending_multimodal_notice_ids(entries, limit=limit)


def drain_internal_notice_pending_multimodal_entries(
    *,
    source_corpus: str = "campus_notices",
    source_collection: str = "internal_notice",
    notice_ids: Sequence[str] = (),
    env: Mapping[str, str] | None = None,
    projection_store: NoticeConsumptionProjectionStore | None = None,
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore | None = None,
    object_store: InternalNoticeMultimodalObjectStore | None = None,
    source_bucket: str | None = None,
    processor: InternalNoticeMultimodalProcessor | None = None,
    attempt_store: InternalNoticeMultimodalAttemptStore | None = None,
    max_attempts: int = DEFAULT_INTERNAL_NOTICE_MULTIMODAL_MAX_ATTEMPTS,
    limit: int = 100,
    batch_size: int = 20,
    admission_batch_id: str = "",
    admission_command: str = "",
    admission_created_at: str = "",
) -> InternalNoticeMultimodalDrainReport:
    if limit <= 0:
        raise ValueError("limit must be greater than zero")
    if batch_size <= 0:
        raise ValueError("batch_size must be greater than zero")
    source = dict(env if env is not None else os.environ)
    normalized_notice_ids = normalize_notice_ids(notice_ids)
    runtime_projection_store = (
        projection_store or build_notice_consumption_projection_store_from_env(source)
    )
    entries = runtime_projection_store.list_by_scope(
        source_corpus,
        source_collection,
        notice_ids=normalized_notice_ids,
    )
    pending_notice_ids = _pending_multimodal_notice_ids(entries, limit=limit)
    batch_reports: list[InternalNoticeMultimodalProcessingReport] = []
    item_reports: list[InternalNoticeMultimodalItemReport] = []
    for batch_notice_ids in _chunked(pending_notice_ids, batch_size):
        batch_report = process_internal_notice_pending_multimodal_entries(
            source_corpus=source_corpus,
            source_collection=source_collection,
            notice_ids=batch_notice_ids,
            env=source,
            projection_store=runtime_projection_store,
            source_truth_inventory_store=source_truth_inventory_store,
            object_store=object_store,
            source_bucket=source_bucket,
            processor=processor,
            attempt_store=attempt_store,
            max_attempts=max_attempts,
            admission_batch_id=admission_batch_id,
            admission_command=admission_command,
            admission_created_at=admission_created_at,
        )
        batch_reports.append(batch_report)
        item_reports.extend(batch_report.item_reports)
    return InternalNoticeMultimodalDrainReport(
        source_corpus=source_corpus,
        source_collection=source_collection,
        selected_notice_ids=normalized_notice_ids,
        pending_notice_ids=pending_notice_ids,
        scanned_projection_entry_count=len(entries),
        batch_count=len(batch_reports),
        projection_entry_count=sum(report.projection_entry_count for report in batch_reports),
        pending_entry_count=sum(report.pending_entry_count for report in batch_reports),
        processed_count=sum(report.processed_count for report in batch_reports),
        retained_for_notice_query_count=sum(
            report.retained_for_notice_query_count for report in batch_reports
        ),
        no_adoption_count=sum(report.no_adoption_count for report in batch_reports),
        still_pending_count=sum(report.still_pending_count for report in batch_reports),
        failed_count=sum(report.failed_count for report in batch_reports),
        item_reports=tuple(item_reports),
    )


def _pending_multimodal_notice_ids(
    entries: Sequence[NoticeConsumptionProjectionEntry],
    *,
    limit: int,
) -> tuple[str, ...]:
    pending_notice_ids: list[str] = []
    seen: set[str] = set()
    for entry in entries:
        if not _is_pending_multimodal_entry(entry):
            continue
        if entry.source_notice_id in seen:
            continue
        seen.add(entry.source_notice_id)
        pending_notice_ids.append(entry.source_notice_id)
        if len(pending_notice_ids) >= limit:
            break
    return tuple(pending_notice_ids)


def _chunked(values: Sequence[str], size: int) -> tuple[tuple[str, ...], ...]:
    return tuple(tuple(values[index : index + size]) for index in range(0, len(values), size))


def _is_pending_multimodal_entry(entry: NoticeConsumptionProjectionEntry) -> bool:
    return entry.consumption_status == NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING


def _build_processing_request(
    *,
    entry: NoticeConsumptionProjectionEntry,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    object_store: InternalNoticeMultimodalObjectStore,
    source_bucket: str,
) -> InternalNoticeMultimodalProcessingRequest:
    metadata = dict(entry.role_metadata or {})
    notice_title = (
        str(metadata.get("notice_title") or "").strip()
        or str(metadata.get("title") or "").strip()
        or (
            str((inventory_entry.parent_snapshot or {}).get("notice_title") or "").strip()
            if inventory_entry is not None
            else ""
        )
        or entry.source_notice_document_id
    )
    return InternalNoticeMultimodalProcessingRequest(
        source_notice_id=entry.source_notice_id,
        unit_id=entry.unit_id,
        notice_title=notice_title,
        primary_role=entry.primary_role,
        reasons=_extract_reasons(entry),
        attachments=_load_multimodal_processing_attachments(
            inventory_entry=inventory_entry,
            object_store=object_store,
            source_bucket=source_bucket,
        ),
    )


def _load_multimodal_processing_attachments(
    *,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    object_store: InternalNoticeMultimodalObjectStore,
    source_bucket: str,
) -> tuple[InternalNoticeMultimodalAttachment, ...]:
    if inventory_entry is None:
        return ()
    plans = [
        dict(item)
        for item in (inventory_entry.parent_snapshot.get("attachment_projection_plans") or ())
        if isinstance(item, dict)
        and str(item.get("classification") or "") == "multimodal_processing_required"
    ]
    if not plans:
        return ()
    attachment_refs = _load_attachment_refs(
        object_store=object_store,
        source_bucket=source_bucket,
        attachment_refs_key=inventory_entry.attachment_refs_key,
    )
    refs_by_id = {
        str(item.get("attachment_ref_id") or "").strip(): item for item in attachment_refs
    }
    attachments: list[InternalNoticeMultimodalAttachment] = []
    for plan in plans:
        attachment_ref_id = str(plan.get("attachment_ref_id") or "").strip()
        if not attachment_ref_id:
            continue
        ref = refs_by_id.get(attachment_ref_id) or {}
        object_key = str(ref.get("object_key") or "").strip()
        if not object_key:
            continue
        try:
            data = object_store.get_bytes(bucket=source_bucket, key=object_key)
        except Exception:
            continue
        attachments.append(
            InternalNoticeMultimodalAttachment(
                attachment_ref_id=attachment_ref_id,
                filename=str(
                    ref.get("filename")
                    or ref.get("original_filename")
                    or ref.get("anchor_text")
                    or attachment_ref_id
                ).strip(),
                mime_type=str(ref.get("mime_type") or "application/octet-stream").strip(),
                object_key=object_key,
                data=data,
            )
        )
    return tuple(attachments)


def _load_attachment_refs(
    *,
    object_store: InternalNoticeMultimodalObjectStore,
    source_bucket: str,
    attachment_refs_key: str,
) -> tuple[dict[str, object], ...]:
    try:
        payload = object_store.get_bytes(bucket=source_bucket, key=attachment_refs_key)
    except Exception:
        return ()
    rows: list[dict[str, object]] = []
    for line in payload.decode("utf-8").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        item = json.loads(stripped)
        if isinstance(item, dict):
            rows.append(item)
    return tuple(rows)


def _mark_retained_for_notice_query(
    entry: NoticeConsumptionProjectionEntry,
    decision: InternalNoticeMultimodalDecision,
    *,
    admission_batch_id: str,
    admission_command: str,
    admission_created_at: str,
) -> NoticeConsumptionProjectionEntry:
    return replace(
        entry,
        default_agent=NOTICE_DEFAULT_AGENT_NOTICE,
        target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
        completeness_status=NOTICE_COMPLETENESS_COMPLETE,
        answerability=NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
        consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
        role_metadata=_build_processed_metadata(
            entry,
            decision,
            admission_batch_id=admission_batch_id,
            admission_command=admission_command,
            admission_created_at=admission_created_at,
        ),
    )


def _mark_no_adoption(
    entry: NoticeConsumptionProjectionEntry,
    decision: InternalNoticeMultimodalDecision,
    *,
    admission_batch_id: str,
    admission_command: str,
    admission_created_at: str,
) -> NoticeConsumptionProjectionEntry:
    return replace(
        entry,
        default_agent=NOTICE_DEFAULT_AGENT_NOTICE,
        target_surface=NOTICE_TARGET_SURFACE_UNSUPPORTED,
        completeness_status=NOTICE_COMPLETENESS_COMPLETE,
        answerability=NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
        consumption_status=NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
        role_metadata={
            **_build_processed_metadata(
                entry,
                decision,
                admission_batch_id=admission_batch_id,
                admission_command=admission_command,
                admission_created_at=admission_created_at,
            ),
            "no_adoption_reason": "multimodal_no_adoption",
        },
    )


def _mark_attempts_exhausted(
    entry: NoticeConsumptionProjectionEntry,
    decision: InternalNoticeMultimodalDecision,
    *,
    admission_batch_id: str,
    admission_command: str,
    admission_created_at: str,
) -> NoticeConsumptionProjectionEntry:
    return replace(
        entry,
        default_agent=NOTICE_DEFAULT_AGENT_NOTICE,
        target_surface=NOTICE_TARGET_SURFACE_UNSUPPORTED,
        completeness_status=NOTICE_COMPLETENESS_COMPLETE,
        answerability=NOTICE_ANSWERABILITY_BODY_ONLY_ANSWERABLE,
        consumption_status=NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
        role_metadata={
            **_build_processed_metadata(
                entry,
                decision,
                admission_batch_id=admission_batch_id,
                admission_command=admission_command,
                admission_created_at=admission_created_at,
            ),
            "no_adoption_reason": "multimodal_attempts_exhausted",
        },
    )


def _mark_still_pending(
    entry: NoticeConsumptionProjectionEntry,
    decision: InternalNoticeMultimodalDecision,
    *,
    admission_batch_id: str,
    admission_command: str,
    admission_created_at: str,
) -> NoticeConsumptionProjectionEntry:
    return replace(
        entry,
        role_metadata={
            **_build_processed_metadata(
                entry,
                decision,
                admission_batch_id=admission_batch_id,
                admission_command=admission_command,
                admission_created_at=admission_created_at,
            ),
            "processing_gap_reason": _pending_gap_reason(decision),
        },
    )


def _build_processed_metadata(
    entry: NoticeConsumptionProjectionEntry,
    decision: InternalNoticeMultimodalDecision,
    *,
    admission_batch_id: str,
    admission_command: str,
    admission_created_at: str,
) -> dict[str, object]:
    metadata: dict[str, object] = {
        **dict(entry.role_metadata or {}),
        "previous_consumption_status": entry.consumption_status,
        "multimodal_processing_status": decision.action,
        "multimodal_summary": decision.summary,
        "multimodal_extracted_text": decision.extracted_text,
        "multimodal_reasons": decision.reasons,
        "multimodal_confidence": decision.confidence,
    }
    if admission_batch_id:
        metadata["consumer_admission_batch_id"] = admission_batch_id
    if admission_command:
        metadata["consumer_admission_command"] = admission_command
    if admission_created_at:
        metadata["consumer_admission_created_at"] = admission_created_at
    return metadata


def _guard_multimodal_decision(
    decision: InternalNoticeMultimodalDecision,
) -> InternalNoticeMultimodalDecision:
    summary = decision.summary.strip()
    extracted_text = decision.extracted_text.strip()
    if decision.action == "retain_for_notice_query":
        guard_reasons: list[str] = []
        if not summary and not extracted_text:
            guard_reasons.append("retain_missing_content")
        if decision.confidence == "low":
            guard_reasons.append("retain_low_confidence")
        if guard_reasons:
            return replace(
                decision,
                action="needs_additional_processing",
                reasons=tuple(dict.fromkeys((*decision.reasons, *guard_reasons))),
            )
    if decision.action == "no_adoption" and extracted_text:
        return replace(
            decision,
            action="needs_additional_processing",
            reasons=tuple(dict.fromkeys((*decision.reasons, "no_adoption_with_extracted_text"))),
        )
    return decision


def _pending_gap_reason(decision: InternalNoticeMultimodalDecision) -> str:
    reasons = set(decision.reasons)
    if {"retain_missing_content", "retain_low_confidence"} & reasons:
        return "multimodal_retain_guard_failed"
    if "no_adoption_with_extracted_text" in reasons:
        return "multimodal_no_adoption_guard_failed"
    return "multimodal_additional_processing_required"


def _extract_reasons(entry: NoticeConsumptionProjectionEntry) -> tuple[str, ...]:
    raw = entry.role_metadata.get("reasons") or ()
    return tuple(str(item).strip() for item in raw if str(item).strip())


def _next_attempt_number(
    attempt_store: InternalNoticeMultimodalAttemptStore | None,
    unit_id: str,
) -> int:
    if attempt_store is None:
        return 1
    return len(attempt_store.list_by_unit(unit_id)) + 1


def _record_attempt(
    *,
    attempt_store: InternalNoticeMultimodalAttemptStore | None,
    entry: NoticeConsumptionProjectionEntry,
    source_corpus: str,
    source_collection: str,
    attempt_number: int,
    admission_batch_id: str,
    model: str,
    decision_action: str,
    status: str,
    reasons: tuple[str, ...],
    error: str | None,
) -> None:
    if attempt_store is None:
        return
    attempt_store.record(
        InternalNoticeMultimodalAttempt(
            source_corpus=source_corpus,
            source_collection=source_collection,
            source_notice_id=entry.source_notice_id,
            unit_id=entry.unit_id,
            attempt_number=attempt_number,
            admission_batch_id=admission_batch_id,
            model=model,
            decision_action=decision_action,
            status=status,
            reasons=reasons,
            error=error,
            created_at=utc_now(),
        )
    )


def _processor_model_label(processor: InternalNoticeMultimodalProcessor) -> str:
    return str(getattr(processor, "_model", processor.__class__.__name__))


__all__ = [
    "DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_ENV_KEY",
    "DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_MANAGEMENT_ENV_KEY",
    "DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_OPERATOR_ENV_KEY",
    "DEFAULT_INTERNAL_NOTICE_MULTIMODAL_ATTEMPT_TABLE",
    "DEFAULT_INTERNAL_NOTICE_MULTIMODAL_MAX_ATTEMPTS",
    "DEFAULT_INTERNAL_NOTICE_MULTIMODAL_RUNTIME",
    "INTERNAL_NOTICE_MULTIMODAL_RUNTIME_AGENTS_SDK",
    "INTERNAL_NOTICE_MULTIMODAL_RUNTIME_CHAT_COMPLETIONS",
    "AgentsSdkInternalNoticeMultimodalProcessor",
    "ChatCompletionsInternalNoticeMultimodalProcessor",
    "InMemoryInternalNoticeMultimodalAttemptStore",
    "InternalNoticeMultimodalAttachment",
    "InternalNoticeMultimodalAttempt",
    "InternalNoticeMultimodalAttemptStore",
    "InternalNoticeMultimodalDecision",
    "InternalNoticeMultimodalDrainReport",
    "InternalNoticeMultimodalItemReport",
    "InternalNoticeMultimodalObjectStore",
    "InternalNoticeMultimodalProcessingReport",
    "InternalNoticeMultimodalProcessingRequest",
    "InternalNoticeMultimodalProcessor",
    "PostgresInternalNoticeMultimodalAttemptStore",
    "build_internal_notice_multimodal_attempt_store_from_env",
    "build_internal_notice_multimodal_processor_from_env",
    "drain_internal_notice_pending_multimodal_entries",
    "process_internal_notice_pending_multimodal_entries",
    "select_internal_notice_pending_multimodal_notice_ids",
]
