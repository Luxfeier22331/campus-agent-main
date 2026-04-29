from __future__ import annotations

import os
from collections import Counter
from collections.abc import Mapping, Sequence

from campus_ingestion_core.internal_notice_consumption_projection_models import (
    InternalNoticeProcessingGapsReport,
    InternalNoticeProcessingGapUnit,
    NoticeConsumptionProjectionStatus,
    NoticeConsumptionProjectionUnitStatus,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
    NOTICE_SEMANTIC_OWNER_AUTHORITY_PENDING,
    NOTICE_TARGET_SURFACE_UNSUPPORTED,
    NoticeConsumptionProjectionEntry,
    NoticeConsumptionProjectionStore,
    build_notice_consumption_projection_store_from_env,
    is_notice_query_retained_consumption_status,
    normalize_notice_ids,
)


def read_notice_consumption_projection_status(
    store: NoticeConsumptionProjectionStore,
    *,
    source_corpus: str,
    source_collection: str,
    source_notice_id: str,
) -> NoticeConsumptionProjectionStatus:
    entries = store.list_by_scope(
        source_corpus,
        source_collection,
        notice_ids=(source_notice_id,),
    )
    units = tuple(_build_unit_status(entry) for entry in entries)
    ready_count = sum(
        1
        for entry in entries
        if entry.consumption_status == NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET
    )
    held_count = sum(
        1
        for entry in entries
        if is_notice_query_retained_consumption_status(entry.consumption_status)
    )
    pending_multimodal_count = sum(
        1
        for entry in entries
        if entry.consumption_status == NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING
    )
    no_adoption_count = sum(
        1 for entry in entries if entry.consumption_status == NOTICE_CONSUMPTION_STATUS_NO_ADOPTION
    )
    source_multimodal_required_count = _sum_notice_multimodal_metadata(
        entries,
        "source_multimodal_processing_required_count",
    )
    multimodal_skipped_low_value_count = _sum_notice_multimodal_metadata(
        entries,
        "multimodal_skipped_attachment_count",
    )
    return NoticeConsumptionProjectionStatus(
        source_corpus=source_corpus,
        source_collection=source_collection,
        source_notice_id=source_notice_id,
        unit_count=len(entries),
        ready_unit_count=ready_count,
        held_unit_count=held_count,
        pending_multimodal_unit_count=pending_multimodal_count,
        no_adoption_unit_count=no_adoption_count,
        has_target_ready_units=ready_count > 0,
        units=units,
        source_multimodal_required_count=source_multimodal_required_count,
        multimodal_skipped_low_value_count=multimodal_skipped_low_value_count,
        multimodal_action_required_count=pending_multimodal_count,
    )


def check_internal_notice_processing_gaps(
    *,
    source_corpus: str = "campus_notices",
    source_collection: str = "internal_notice",
    notice_ids: Sequence[str] = (),
    env: Mapping[str, str] | None = None,
    projection_store: NoticeConsumptionProjectionStore | None = None,
) -> InternalNoticeProcessingGapsReport:
    source = dict(env if env is not None else os.environ)
    runtime_projection_store = (
        projection_store or build_notice_consumption_projection_store_from_env(source)
    )
    normalized_notice_ids = normalize_notice_ids(notice_ids)
    entries = runtime_projection_store.list_by_scope(
        source_corpus,
        source_collection,
        notice_ids=normalized_notice_ids,
    )
    consumption_status_counts = Counter(entry.consumption_status for entry in entries)
    target_surface_counts = Counter(entry.target_surface for entry in entries)
    pending_multimodal_count = consumption_status_counts.get(
        NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
        0,
    )
    authority_pending_count = sum(
        1 for entry in entries if entry.semantic_owner == NOTICE_SEMANTIC_OWNER_AUTHORITY_PENDING
    )
    unsupported_count = target_surface_counts.get(NOTICE_TARGET_SURFACE_UNSUPPORTED, 0)
    no_adoption_count = consumption_status_counts.get(NOTICE_CONSUMPTION_STATUS_NO_ADOPTION, 0)
    ready_for_target_count = consumption_status_counts.get(
        NOTICE_CONSUMPTION_STATUS_READY_FOR_TARGET,
        0,
    )
    retained_for_notice_query_count = sum(
        1
        for entry in entries
        if is_notice_query_retained_consumption_status(entry.consumption_status)
    )
    source_multimodal_required_count = _sum_notice_multimodal_metadata(
        entries,
        "source_multimodal_processing_required_count",
    )
    multimodal_skipped_low_value_count = _sum_notice_multimodal_metadata(
        entries,
        "multimodal_skipped_attachment_count",
    )
    return InternalNoticeProcessingGapsReport(
        source_corpus=source_corpus,
        source_collection=source_collection,
        selected_notice_ids=normalized_notice_ids,
        projection_entry_count=len(entries),
        pending_multimodal_processing_count=pending_multimodal_count,
        authority_pending_count=authority_pending_count,
        unsupported_count=unsupported_count,
        no_adoption_count=no_adoption_count,
        ready_for_target_count=ready_for_target_count,
        retained_for_notice_query_count=retained_for_notice_query_count,
        consumption_status_counts=dict(sorted(consumption_status_counts.items())),
        target_surface_counts=dict(sorted(target_surface_counts.items())),
        gap_units=tuple(_build_processing_gap_units(entries)),
        source_multimodal_required_count=source_multimodal_required_count,
        multimodal_skipped_low_value_count=multimodal_skipped_low_value_count,
        multimodal_action_required_count=pending_multimodal_count,
    )


def _sum_notice_multimodal_metadata(
    entries: Sequence[NoticeConsumptionProjectionEntry],
    key: str,
) -> int:
    values_by_notice_id: dict[str, int] = {}
    for entry in entries:
        value = _coerce_int(entry.role_metadata.get(key))
        if value <= 0:
            continue
        values_by_notice_id[entry.source_notice_id] = max(
            values_by_notice_id.get(entry.source_notice_id, 0),
            value,
        )
    return sum(values_by_notice_id.values())


def _build_unit_status(
    entry: NoticeConsumptionProjectionEntry,
) -> NoticeConsumptionProjectionUnitStatus:
    raw_reasons = list(entry.role_metadata.get("reasons") or ())
    for key in (
        "owner_source_missing_reason",
        "no_adoption_reason",
        "processing_gap_reason",
        "notice_query_reason",
        "notice_runtime_reason",
        "archive_reason",
    ):
        value = str(entry.role_metadata.get(key) or "").strip()
        if value:
            raw_reasons.append(value)
    reasons = tuple(dict.fromkeys(str(item).strip() for item in raw_reasons if str(item).strip()))
    return NoticeConsumptionProjectionUnitStatus(
        unit_id=entry.unit_id,
        primary_role=entry.primary_role,
        target_surface=entry.target_surface,
        consumption_status=entry.consumption_status,
        reasons=reasons,
    )


def _build_processing_gap_units(
    entries: Sequence[NoticeConsumptionProjectionEntry],
) -> tuple[InternalNoticeProcessingGapUnit, ...]:
    return tuple(
        _build_processing_gap_unit(entry)
        for entry in sorted(entries, key=lambda item: (item.source_notice_id, item.unit_id))
        if _is_processing_gap_entry(entry)
    )


def _is_processing_gap_entry(entry: NoticeConsumptionProjectionEntry) -> bool:
    return (
        entry.consumption_status
        in {
            NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
            NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
        }
        or entry.semantic_owner == NOTICE_SEMANTIC_OWNER_AUTHORITY_PENDING
        or entry.target_surface == NOTICE_TARGET_SURFACE_UNSUPPORTED
    )


def _build_processing_gap_unit(
    entry: NoticeConsumptionProjectionEntry,
) -> InternalNoticeProcessingGapUnit:
    unit_status = _build_unit_status(entry)
    return InternalNoticeProcessingGapUnit(
        source_notice_id=entry.source_notice_id,
        unit_id=entry.unit_id,
        primary_role=entry.primary_role,
        semantic_owner=entry.semantic_owner,
        target_surface=entry.target_surface,
        consumption_status=entry.consumption_status,
        reasons=unit_status.reasons,
        consumer_admission_batch_id=str(
            entry.role_metadata.get("consumer_admission_batch_id") or ""
        ),
    )


def _coerce_int(value: object) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0


__all__ = [
    "check_internal_notice_processing_gaps",
    "read_notice_consumption_projection_status",
]
