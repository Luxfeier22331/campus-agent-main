from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any

from campus_ingestion_core.authenticated_notice_closeout_models import utc_now
from campus_ingestion_core.authenticated_notice_notice_family import (
    AuthenticatedNoticeNoticeFamilyConfig,
)
from campus_ingestion_core.authenticated_notice_routing_sampling import (
    resolve_authenticated_notice_routing_samples_from_inventory_entries,
)
from campus_ingestion_core.authenticated_notice_routing_sampling_models import (
    AuthenticatedNoticeRoutingObjectStore,
    AuthenticatedNoticeRoutingSample,
)
from campus_ingestion_core.authenticated_notice_routing_sampling_samples import (
    sample_authenticated_notice_routing_from_bundle_record,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
)
from campus_ingestion_core.internal_notice_consumer_admission_manifest import (
    CONSUMER_ADMISSION_BODY_QUALITY_EMPTY,
    CONSUMER_ADMISSION_BODY_QUALITY_PRESENT,
    CONSUMER_ADMISSION_BODY_QUALITY_TITLE_ONLY,
    CONSUMER_ADMISSION_DECISION_ADMIT,
    CONSUMER_ADMISSION_DECISION_NO_ADOPTION,
    CONSUMER_ADMISSION_SCOPE_WRITE_MODE_UPSERT_SELECTED,
    CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION,
    ConsumerAdmissionDecisionRecord,
    InternalNoticeConsumerAdmissionManifest,
    compute_consumer_admission_selection_sha256,
    validate_internal_notice_consumer_admission_manifest,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
    NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_PROCUREMENT_NOTICE_HISTORY,
    NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
    NOTICE_TARGET_SURFACE_SPECIAL_SERVICE_CANDIDATE,
    NOTICE_TARGET_SURFACE_STABLE_CONTACT_CANDIDATE,
    NOTICE_TARGET_SURFACE_UNSUPPORTED,
    normalize_notice_ids,
)


def build_internal_notice_consumer_admission_manifest_from_bundle_records(
    *,
    bundle_records: Sequence[Mapping[str, Any]],
    config: AuthenticatedNoticeNoticeFamilyConfig,
    admission_run_id: str,
    selection_source: str,
    selection_path: str,
    site_id: str = "",
    scope_write_mode: str = CONSUMER_ADMISSION_SCOPE_WRITE_MODE_UPSERT_SELECTED,
    created_at: str | None = None,
) -> InternalNoticeConsumerAdmissionManifest:
    records = tuple(dict(record) for record in bundle_records)
    samples = tuple(
        sample_authenticated_notice_routing_from_bundle_record(record, config=config)
        for record in records
    )
    bundle_by_notice_id = {_notice_id_from_bundle_record(record): record for record in records}
    decisions = tuple(
        _decision_from_sample(
            sample,
            site_id=site_id,
            raw_asset_id=_raw_asset_id_from_bundle_record(
                bundle_by_notice_id.get(sample.notice_id, {}),
                site_id=site_id,
                notice_id=sample.notice_id,
            ),
            raw_version_id=_raw_version_id_from_bundle_record(
                bundle_by_notice_id.get(sample.notice_id, {}),
                notice_id=sample.notice_id,
            ),
            body_quality=_body_quality_from_bundle_record(
                bundle_by_notice_id.get(sample.notice_id, {})
            ),
        )
        for sample in samples
    )
    return _build_manifest(
        decisions=decisions,
        config=config,
        admission_run_id=admission_run_id,
        selection_source=selection_source,
        selection_path=selection_path,
        scope_write_mode=scope_write_mode,
        created_at=created_at,
    )


def build_internal_notice_consumer_admission_manifest_from_inventory_entries(
    *,
    inventory_entries: Sequence[AuthenticatedNoticeSourceTruthInventoryEntry],
    config: AuthenticatedNoticeNoticeFamilyConfig,
    admission_run_id: str,
    selection_source: str,
    selection_path: str,
    object_store: AuthenticatedNoticeRoutingObjectStore | None = None,
    source_bucket: str = "",
    scope_write_mode: str = CONSUMER_ADMISSION_SCOPE_WRITE_MODE_UPSERT_SELECTED,
    created_at: str | None = None,
) -> InternalNoticeConsumerAdmissionManifest:
    entries = tuple(inventory_entries)
    samples = resolve_authenticated_notice_routing_samples_from_inventory_entries(
        inventory_entries=entries,
        config=config,
        object_store=object_store,
        source_bucket=source_bucket,
    )
    entries_by_notice_id = {entry.notice_id: entry for entry in entries}
    decisions = tuple(
        _decision_from_sample(
            sample,
            site_id=entries_by_notice_id[sample.notice_id].site_id,
            raw_asset_id=entries_by_notice_id[sample.notice_id].raw_asset_id,
            raw_version_id=entries_by_notice_id[sample.notice_id].raw_version_id,
            body_quality=_body_quality_from_inventory_entry(entries_by_notice_id[sample.notice_id]),
            owner_expectation_count=_owner_expectation_count_from_inventory_entry(
                entries_by_notice_id[sample.notice_id]
            ),
            unsupported_binary_count=entries_by_notice_id[
                sample.notice_id
            ].unsupported_binary_count,
        )
        for sample in samples
        if sample.notice_id in entries_by_notice_id
    )
    return _build_manifest(
        decisions=decisions,
        config=config,
        admission_run_id=admission_run_id,
        selection_source=selection_source,
        selection_path=selection_path,
        scope_write_mode=scope_write_mode,
        created_at=created_at,
    )


def _decision_from_sample(
    sample: AuthenticatedNoticeRoutingSample,
    *,
    site_id: str,
    raw_asset_id: str,
    raw_version_id: str,
    body_quality: str,
    owner_expectation_count: int = 0,
    unsupported_binary_count: int = 0,
) -> ConsumerAdmissionDecisionRecord:
    target_surface, status, admission_decision, reason_codes = _map_sample_to_decision(sample)
    return ConsumerAdmissionDecisionRecord(
        notice_id=sample.notice_id,
        source_notice_id=sample.notice_id,
        site_id=site_id,
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        notice_family=sample.notice_family,
        suggested_consumption_route=sample.suggested_consumption_route,
        target_surface=target_surface,
        consumption_status=status,
        admission_decision=admission_decision,
        admission_reason_codes=reason_codes,
        body_quality=body_quality,
        attachment_ref_count=sample.attachment_ref_count,
        reference_only_attachment_ref_count=sample.reference_only_count,
        owner_expectation_count=owner_expectation_count,
        pending_multimodal_attachment_count=(
            sample.multimodal_processing_required_count
            if target_surface == NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE
            else 0
        ),
        attachment_document_count=sample.attachment_document_count,
        unsupported_binary_count=unsupported_binary_count,
    )


def _map_sample_to_decision(
    sample: AuthenticatedNoticeRoutingSample,
) -> tuple[str, str, str, tuple[str, ...]]:
    route = str(sample.suggested_consumption_route or "").strip()
    if _has_high_value_multimodal_gap(sample) and route not in {
        "defer",
        "no_adoption",
    }:
        return (
            NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
            NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
            CONSUMER_ADMISSION_DECISION_ADMIT,
            ("pending_multimodal_processing", route or "unspecified_route"),
        )
    if route == "notice_level_query":
        return (
            NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
            NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
            CONSUMER_ADMISSION_DECISION_ADMIT,
            ("notice_level_query",),
        )
    if route == "procurement_notice_history":
        return (
            NOTICE_TARGET_SURFACE_PROCUREMENT_NOTICE_HISTORY,
            NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
            CONSUMER_ADMISSION_DECISION_ADMIT,
            ("procurement_notice_history",),
        )
    if route == "regulation_candidate":
        return (
            NOTICE_TARGET_SURFACE_INSTITUTIONAL_RULES,
            CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION,
            CONSUMER_ADMISSION_DECISION_ADMIT,
            ("regulation_candidate",),
        )
    if route == "service_status_candidate":
        return (
            NOTICE_TARGET_SURFACE_SERVICE_STATUS_CANDIDATE,
            CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION,
            CONSUMER_ADMISSION_DECISION_ADMIT,
            ("service_status_candidate",),
        )
    if route == "special_service_candidate":
        return (
            NOTICE_TARGET_SURFACE_SPECIAL_SERVICE_CANDIDATE,
            CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION,
            CONSUMER_ADMISSION_DECISION_ADMIT,
            ("special_service_candidate",),
        )
    if route == "stable_contact_candidate":
        return (
            NOTICE_TARGET_SURFACE_STABLE_CONTACT_CANDIDATE,
            CONSUMER_ADMISSION_STATUS_CANDIDATE_FOR_TYPED_MATERIALIZATION,
            CONSUMER_ADMISSION_DECISION_ADMIT,
            ("stable_contact_candidate",),
        )
    return (
        NOTICE_TARGET_SURFACE_UNSUPPORTED,
        NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
        CONSUMER_ADMISSION_DECISION_NO_ADOPTION,
        (route or "unsupported_route",),
    )


def _has_high_value_multimodal_gap(sample: AuthenticatedNoticeRoutingSample) -> bool:
    return (
        str(sample.machine_processing_policy or "").strip() in {"process", "process_multimodal"}
        and int(sample.multimodal_processing_required_count or 0) > 0
    )


def _build_manifest(
    *,
    decisions: Sequence[ConsumerAdmissionDecisionRecord],
    config: AuthenticatedNoticeNoticeFamilyConfig,
    admission_run_id: str,
    selection_source: str,
    selection_path: str,
    scope_write_mode: str,
    created_at: str | None,
) -> InternalNoticeConsumerAdmissionManifest:
    normalized_decisions = tuple(sorted(decisions, key=lambda item: item.notice_id))
    selected_notice_ids = normalize_notice_ids(record.notice_id for record in normalized_decisions)
    counts = Counter(record.admission_decision for record in normalized_decisions)
    counts.update(record.target_surface for record in normalized_decisions)
    counts.update(record.consumption_status for record in normalized_decisions)
    manifest = InternalNoticeConsumerAdmissionManifest(
        admission_run_id=admission_run_id,
        source_channel=config.source_channel,
        corpus=config.corpus,
        collection=config.collection,
        selection_source=selection_source,
        selection_path=selection_path,
        selection_sha256=compute_consumer_admission_selection_sha256(selected_notice_ids),
        scope_write_mode=scope_write_mode,
        selected_notice_ids=selected_notice_ids,
        decision_records=normalized_decisions,
        decision_counts=dict(sorted(counts.items())),
        created_at=created_at or utc_now(),
    )
    validate_internal_notice_consumer_admission_manifest(manifest)
    return manifest


def _notice_id_from_bundle_record(record: Mapping[str, Any]) -> str:
    notice = dict(record.get("notice") or {})
    return str(record.get("notice_id") or notice.get("notice_id") or "").strip()


def _raw_asset_id_from_bundle_record(
    record: Mapping[str, Any],
    *,
    site_id: str,
    notice_id: str,
) -> str:
    return (
        str(record.get("raw_asset_id") or "").strip()
        or f"asset:authenticated-notice:{site_id or 'unknown'}:{notice_id}"
    )


def _raw_version_id_from_bundle_record(record: Mapping[str, Any], *, notice_id: str) -> str:
    return str(record.get("raw_version_id") or "").strip() or f"sha256:bundle:{notice_id}"


def _body_quality_from_bundle_record(record: Mapping[str, Any]) -> str:
    notice = dict(record.get("notice") or {})
    title = str(notice.get("notice_title") or "").strip()
    body = str(notice.get("notice_content") or "").strip()
    if body:
        return CONSUMER_ADMISSION_BODY_QUALITY_PRESENT
    if title:
        return CONSUMER_ADMISSION_BODY_QUALITY_TITLE_ONLY
    return CONSUMER_ADMISSION_BODY_QUALITY_EMPTY


def _body_quality_from_inventory_entry(
    entry: AuthenticatedNoticeSourceTruthInventoryEntry,
) -> str:
    parent_snapshot = dict(entry.parent_snapshot or {})
    if str(parent_snapshot.get("notice_content") or "").strip():
        return CONSUMER_ADMISSION_BODY_QUALITY_PRESENT
    if str(parent_snapshot.get("notice_title") or "").strip():
        return CONSUMER_ADMISSION_BODY_QUALITY_TITLE_ONLY
    return CONSUMER_ADMISSION_BODY_QUALITY_EMPTY


def _owner_expectation_count_from_inventory_entry(
    entry: AuthenticatedNoticeSourceTruthInventoryEntry,
) -> int:
    parent_snapshot = dict(entry.parent_snapshot or {})
    owner_expectations = parent_snapshot.get("owner_expectations") or ()
    if isinstance(owner_expectations, Sequence) and not isinstance(owner_expectations, str):
        return len(tuple(owner_expectations))
    return 0


__all__ = [
    "build_internal_notice_consumer_admission_manifest_from_bundle_records",
    "build_internal_notice_consumer_admission_manifest_from_inventory_entries",
]
