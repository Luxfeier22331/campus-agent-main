from __future__ import annotations

import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass

from campus_ingestion_core.internal_notice_consumption_admission import (
    InternalNoticeConsumptionAdmissionStore,
    build_internal_notice_consumption_admission_store_from_env,
)
from campus_ingestion_core.internal_notice_read_model import (
    build_internal_notice_read_model_store_from_env,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NoticeConsumptionProjectionStore,
    build_notice_consumption_projection_store_from_env,
    normalize_notice_ids,
)


@dataclass(frozen=True, slots=True)
class WeChatPublicNoticeStateAuditSuspectUnit:
    source_notice_id: str
    unit_id: str
    suspicion_codes: tuple[str, ...]
    recovery_action: str
    consumer_admission_batch_id: str = ""


@dataclass(frozen=True, slots=True)
class WeChatPublicNoticeStateAuditReport:
    source_corpus: str
    source_collection: str
    selected_notice_ids: tuple[str, ...]
    projection_entry_count: int
    read_model_entry_count: int
    completed_admission_batch_count: int
    suspect_notice_count: int
    suspect_unit_count: int
    orphan_read_model_unit_count: int
    reproject_notice_ids: tuple[str, ...]
    purge_notice_ids: tuple[str, ...]
    suspect_units: tuple[WeChatPublicNoticeStateAuditSuspectUnit, ...]


def audit_wechat_public_notice_state(
    *,
    source_corpus: str = "campus_notices",
    source_collection: str = "wechat_public_notice",
    notice_ids: Sequence[str] = (),
    env: Mapping[str, str] | None = None,
    projection_store: NoticeConsumptionProjectionStore | None = None,
    read_model_store=None,
    admission_store: InternalNoticeConsumptionAdmissionStore | None = None,
) -> WeChatPublicNoticeStateAuditReport:
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
    admission_records = runtime_admission_store.list_records(
        source_corpus=source_corpus,
        source_collection=source_collection,
        notice_ids=normalized_notice_ids,
        statuses=("completed",),
        limit=100,
    )
    completed_batch_ids = {record.batch_id for record in admission_records}
    suspect_units: list[WeChatPublicNoticeStateAuditSuspectUnit] = []
    reproject_notice_ids: list[str] = []
    purge_notice_ids: list[str] = []

    for entry in projection_entries:
        metadata = dict(entry.role_metadata or {})
        suspicion_codes: list[str] = []
        batch_id = str(metadata.get("consumer_admission_batch_id") or "").strip()
        if not batch_id or batch_id not in completed_batch_ids:
            suspicion_codes.append("missing_admission_batch_id")
        if _missing_source_truth_metadata(metadata):
            suspicion_codes.append("missing_source_truth_keys")
        if (
            str(entry.consumption_status or "").strip() == "retained_for_notice_query"
            and str(metadata.get("body_state") or "").strip() != "captured"
        ):
            suspicion_codes.append("queryable_without_captured_body")
        if str(
            entry.consumption_status or ""
        ).strip() == NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING and not _string_tuple(
            metadata.get("source_image_object_keys")
        ):
            suspicion_codes.append("pending_without_source_images")
        if not suspicion_codes:
            continue
        recovery_action = (
            "purge"
            if "missing_source_truth_keys" in suspicion_codes
            and not _has_any_source_truth_key(metadata)
            else "reproject"
        )
        suspect_units.append(
            WeChatPublicNoticeStateAuditSuspectUnit(
                source_notice_id=entry.source_notice_id,
                unit_id=entry.unit_id,
                suspicion_codes=tuple(dict.fromkeys(suspicion_codes)),
                recovery_action=recovery_action,
                consumer_admission_batch_id=batch_id,
            )
        )
        if recovery_action == "reproject":
            reproject_notice_ids.append(entry.source_notice_id)
        else:
            purge_notice_ids.append(entry.source_notice_id)

    projection_unit_ids = {entry.unit_id for entry in projection_entries}
    orphan_rows = [
        row
        for row in read_model_rows
        if str(getattr(row, "unit_id", "") or "").strip() not in projection_unit_ids
    ]
    for row in orphan_rows:
        notice_id = str(getattr(row, "source_notice_id", "") or "").strip()
        suspect_units.append(
            WeChatPublicNoticeStateAuditSuspectUnit(
                source_notice_id=notice_id,
                unit_id=str(getattr(row, "unit_id", "") or "").strip(),
                suspicion_codes=("read_model_without_projection",),
                recovery_action="purge",
            )
        )
        if notice_id:
            purge_notice_ids.append(notice_id)

    suspect_notice_ids = {
        unit.source_notice_id for unit in suspect_units if unit.source_notice_id.strip()
    }
    return WeChatPublicNoticeStateAuditReport(
        source_corpus=source_corpus,
        source_collection=source_collection,
        selected_notice_ids=normalized_notice_ids,
        projection_entry_count=len(projection_entries),
        read_model_entry_count=len(read_model_rows),
        completed_admission_batch_count=len(admission_records),
        suspect_notice_count=len(suspect_notice_ids),
        suspect_unit_count=len(suspect_units),
        orphan_read_model_unit_count=len(orphan_rows),
        reproject_notice_ids=tuple(dict.fromkeys(item for item in reproject_notice_ids if item)),
        purge_notice_ids=tuple(dict.fromkeys(item for item in purge_notice_ids if item)),
        suspect_units=tuple(suspect_units),
    )


def _missing_source_truth_metadata(metadata: Mapping[str, object]) -> bool:
    return not (
        str(metadata.get("source_bucket") or "").strip()
        and str(metadata.get("manifest_key") or "").strip()
        and str(metadata.get("content_blocks_key") or "").strip()
        and str(metadata.get("media_refs_key") or "").strip()
    )


def _has_any_source_truth_key(metadata: Mapping[str, object]) -> bool:
    return bool(
        str(metadata.get("manifest_key") or "").strip()
        or str(metadata.get("content_blocks_key") or "").strip()
        or str(metadata.get("media_refs_key") or "").strip()
    )


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
    "WeChatPublicNoticeStateAuditReport",
    "WeChatPublicNoticeStateAuditSuspectUnit",
    "audit_wechat_public_notice_state",
]
