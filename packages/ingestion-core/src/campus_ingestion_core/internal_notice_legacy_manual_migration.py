from __future__ import annotations

import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, replace

from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_ANSWERABILITY_NOT_ANSWERABLE,
    NOTICE_COMPLETENESS_REFERENCE_ONLY,
    NOTICE_COMPLETENESS_REQUIRES_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_MANUAL_REVIEW_REQUIRED,
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
    NOTICE_TARGET_SURFACE_UNSUPPORTED,
    NoticeConsumptionProjectionEntry,
    NoticeConsumptionProjectionStore,
    build_notice_consumption_projection_store_from_env,
    normalize_notice_ids,
)

_HARD_UNSUPPORTED_REASONS = frozenset(
    {
        "draft_signal_detected",
        "input_lane_not_admitted",
        "unsupported_revision_track",
    }
)


@dataclass(frozen=True, slots=True)
class InternalNoticeLegacyManualMigrationItem:
    source_notice_id: str
    unit_id: str
    before_status: str
    after_status: str
    after_target_surface: str
    reason: str


@dataclass(frozen=True, slots=True)
class InternalNoticeLegacyManualMigrationReport:
    source_corpus: str
    source_collection: str
    selected_notice_ids: tuple[str, ...]
    applied: bool
    projection_entry_count: int
    legacy_manual_review_count: int
    pending_multimodal_count: int
    no_adoption_count: int
    unchanged_count: int
    item_reports: tuple[InternalNoticeLegacyManualMigrationItem, ...]


def migrate_legacy_manual_review_projection_entries(
    *,
    source_corpus: str = "campus_notices",
    source_collection: str = "internal_notice",
    notice_ids: Sequence[str] = (),
    apply: bool = False,
    env: Mapping[str, str] | None = None,
    projection_store: NoticeConsumptionProjectionStore | None = None,
) -> InternalNoticeLegacyManualMigrationReport:
    normalized_notice_ids = normalize_notice_ids(notice_ids)
    if not normalized_notice_ids:
        raise ValueError("selected notice_ids are required for legacy manual migration")
    source = dict(env if env is not None else os.environ)
    runtime_projection_store = (
        projection_store or build_notice_consumption_projection_store_from_env(source)
    )
    entries = runtime_projection_store.list_by_scope(
        source_corpus,
        source_collection,
        notice_ids=normalized_notice_ids,
    )
    migrated_entries: list[NoticeConsumptionProjectionEntry] = []
    item_reports: list[InternalNoticeLegacyManualMigrationItem] = []
    legacy_count = 0
    pending_count = 0
    no_adoption_count = 0
    unchanged_count = 0
    for entry in entries:
        if entry.consumption_status != NOTICE_CONSUMPTION_STATUS_MANUAL_REVIEW_REQUIRED:
            unchanged_count += 1
            migrated_entries.append(entry)
            continue
        legacy_count += 1
        migrated = _migrate_entry(entry)
        if migrated.consumption_status == NOTICE_CONSUMPTION_STATUS_NO_ADOPTION:
            no_adoption_count += 1
        else:
            pending_count += 1
        migrated_entries.append(migrated)
        item_reports.append(
            InternalNoticeLegacyManualMigrationItem(
                source_notice_id=entry.source_notice_id,
                unit_id=entry.unit_id,
                before_status=entry.consumption_status,
                after_status=migrated.consumption_status,
                after_target_surface=migrated.target_surface,
                reason=str(
                    migrated.role_metadata.get("processing_gap_reason")
                    or migrated.role_metadata.get("no_adoption_reason")
                    or ""
                ),
            )
        )
    if apply:
        runtime_projection_store.replace_notices(
            source_corpus,
            source_collection,
            notice_ids=normalized_notice_ids,
            records=tuple(migrated_entries),
        )
    return InternalNoticeLegacyManualMigrationReport(
        source_corpus=source_corpus,
        source_collection=source_collection,
        selected_notice_ids=normalized_notice_ids,
        applied=apply,
        projection_entry_count=len(entries),
        legacy_manual_review_count=legacy_count,
        pending_multimodal_count=pending_count,
        no_adoption_count=no_adoption_count,
        unchanged_count=unchanged_count,
        item_reports=tuple(item_reports),
    )


def _migrate_entry(entry: NoticeConsumptionProjectionEntry) -> NoticeConsumptionProjectionEntry:
    metadata = dict(entry.role_metadata or {})
    reasons = {str(item).strip() for item in metadata.get("reasons") or () if str(item).strip()}
    if reasons & _HARD_UNSUPPORTED_REASONS:
        return replace(
            entry,
            target_surface=NOTICE_TARGET_SURFACE_UNSUPPORTED,
            completeness_status=NOTICE_COMPLETENESS_REFERENCE_ONLY,
            answerability=NOTICE_ANSWERABILITY_NOT_ANSWERABLE,
            consumption_status=NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
            role_metadata={
                **metadata,
                "legacy_consumption_status": NOTICE_CONSUMPTION_STATUS_MANUAL_REVIEW_REQUIRED,
                "no_adoption_reason": "unsupported_manual_review_legacy_reason",
            },
        )
    return replace(
        entry,
        target_surface=NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
        completeness_status=NOTICE_COMPLETENESS_REQUIRES_MULTIMODAL_PROCESSING,
        answerability=NOTICE_ANSWERABILITY_NOT_ANSWERABLE,
        consumption_status=NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
        role_metadata={
            **metadata,
            "legacy_consumption_status": NOTICE_CONSUMPTION_STATUS_MANUAL_REVIEW_REQUIRED,
            "processing_gap_reason": "multimodal_processing_required",
        },
    )


__all__ = [
    "InternalNoticeLegacyManualMigrationItem",
    "InternalNoticeLegacyManualMigrationReport",
    "migrate_legacy_manual_review_projection_entries",
]
