from __future__ import annotations

from collections.abc import Mapping, Sequence

from campus_ingestion_core.authenticated_notice_notice_family import (
    load_authenticated_notice_notice_family_config,
    read_authenticated_notice_notice_family_config_path,
)
from campus_ingestion_core.authenticated_notice_routing_sampling import (
    AuthenticatedNoticeRoutingSample,
    resolve_authenticated_notice_routing_samples_from_inventory_entries,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
)
from campus_ingestion_core.authenticated_notice_target_routing import (
    resolve_authenticated_notice_target_candidates,
)
from campus_ingestion_core.internal_notice_consumption_projection_models import (
    InternalNoticeConsumptionProjectionObjectStore,
)
from campus_ingestion_core.internal_notice_regulation_promotion_shared import (
    InternalNoticeRegulationPromotionDocumentReport,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.settings import ObjectStoreSettings


def resolve_notice_routing_samples_by_notice(
    *,
    inventory_entries: Sequence[AuthenticatedNoticeSourceTruthInventoryEntry],
    env: Mapping[str, str],
    object_store: InternalNoticeConsumptionProjectionObjectStore,
) -> dict[str, AuthenticatedNoticeRoutingSample]:
    if not inventory_entries:
        return {}
    config = load_authenticated_notice_notice_family_config(
        read_authenticated_notice_notice_family_config_path(dict(env))
    )
    source_bucket = ObjectStoreSettings.from_env(dict(env)).bucket_source
    return {
        sample.notice_id: sample
        for sample in resolve_authenticated_notice_routing_samples_from_inventory_entries(
            inventory_entries=inventory_entries,
            config=config,
            object_store=object_store,
            source_bucket=source_bucket,
        )
    }


def routes_to_service_status_candidate(
    *,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry,
    routing_sample: AuthenticatedNoticeRoutingSample | None,
) -> bool:
    if routing_sample is not None:
        if routing_sample.suggested_consumption_route != "service_status_candidate":
            return False
        return bool(
            resolve_authenticated_notice_target_candidates(
                notice_family=routing_sample.notice_family,
                primary_route=routing_sample.suggested_consumption_route,
                title=_inventory_title(
                    inventory_entry,
                    sample_notice_title=routing_sample.notice_title,
                ),
            )
        )
    return False


def should_suppress_regulation_promotion(
    *,
    report: InternalNoticeRegulationPromotionDocumentReport,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    routing_sample: AuthenticatedNoticeRoutingSample | None,
) -> bool:
    del inventory_entry
    if report.action != "promote_candidate":
        return False
    if routing_sample is not None:
        return routing_sample.suggested_consumption_route != "regulation_candidate"
    return False


def resolve_service_status_candidate_kind(
    *,
    title_compact: str,
    routing_sample: AuthenticatedNoticeRoutingSample | None,
) -> str:
    family = routing_sample.notice_family if routing_sample is not None else ""
    route = routing_sample.suggested_consumption_route if routing_sample is not None else ""
    targets = resolve_authenticated_notice_target_candidates(
        notice_family=family,
        primary_route=route or "service_status_candidate",
        title=title_compact,
    )
    if "transport_schedule" in targets:
        return "transport_schedule"
    if "service_status" in targets:
        return "service_status"
    return "notice_level_query"


def _inventory_title(
    entry: AuthenticatedNoticeSourceTruthInventoryEntry,
    *,
    sample_notice_title: str,
) -> str:
    parent_snapshot = dict(entry.parent_snapshot or {})
    return str(parent_snapshot.get("notice_title") or sample_notice_title or "").strip()


def routing_metadata(
    routing_sample: AuthenticatedNoticeRoutingSample | None,
) -> dict[str, object]:
    if routing_sample is None:
        return {}
    return {
        "notice_family": routing_sample.notice_family,
        "admission_policy": routing_sample.admission_policy,
        "suggested_consumption_route": routing_sample.suggested_consumption_route,
        "machine_processing_policy": routing_sample.machine_processing_policy,
        "attachment_processing_policy": routing_sample.attachment_processing_policy,
        "attachment_processing_reason": routing_sample.attachment_processing_reason,
        "matched_title_patterns": routing_sample.matched_title_patterns,
        "matched_body_patterns": routing_sample.matched_body_patterns,
    }


def resolve_attachment_document_ids(
    *,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry,
    attachment_records: Sequence[DocumentRegistryRecord],
) -> tuple[str, ...]:
    parent_snapshot = dict(inventory_entry.parent_snapshot or {})
    ids: list[str] = []
    for plan in tuple(parent_snapshot.get("attachment_projection_plans") or ()):
        if not isinstance(plan, Mapping):
            continue
        document_id = str(plan.get("document_id") or "").strip()
        if document_id.startswith("notice_attachment:"):
            ids.append(document_id)
    ids.extend(record.document_id for record in attachment_records if record.document_id)
    return tuple(dict.fromkeys(sorted(ids)))


def resolve_attachment_ref_ids(
    *,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry,
    attachment_document_ids: Sequence[str],
) -> tuple[str, ...]:
    parent_snapshot = dict(inventory_entry.parent_snapshot or {})
    ref_ids: list[str] = []
    for plan in tuple(parent_snapshot.get("attachment_projection_plans") or ()):
        if not isinstance(plan, Mapping):
            continue
        ref_id = str(plan.get("attachment_ref_id") or "").strip()
        if ref_id:
            ref_ids.append(ref_id)
    for document_id in attachment_document_ids:
        parsed = parse_notice_attachment_document_id(document_id)
        if parsed is not None:
            _site_id, _notice_id, attachment_ref_id = parsed
            ref_ids.append(attachment_ref_id)
    return tuple(dict.fromkeys(ref_ids))


def index_notice_attachment_records(
    records: Sequence[DocumentRegistryRecord],
) -> dict[str, tuple[DocumentRegistryRecord, ...]]:
    grouped: dict[str, list[DocumentRegistryRecord]] = {}
    for record in records:
        parsed = parse_notice_attachment_document_id(record.document_id)
        if parsed is None:
            continue
        _site_id, notice_id, _attachment_ref_id = parsed
        grouped.setdefault(notice_id, []).append(record)
    return {
        notice_id: tuple(sorted(values, key=lambda item: item.document_id))
        for notice_id, values in grouped.items()
    }


def parse_notice_attachment_document_id(document_id: str) -> tuple[str, str, str] | None:
    parts = str(document_id or "").split(":")
    if len(parts) not in {4, 5} or parts[0] != "notice_attachment":
        return None
    site_id, notice_id, attachment_ref_id = parts[1], parts[2], parts[3]
    if not site_id or not notice_id or not attachment_ref_id:
        return None
    return site_id, notice_id, attachment_ref_id


__all__ = [
    "index_notice_attachment_records",
    "parse_notice_attachment_document_id",
    "resolve_attachment_document_ids",
    "resolve_attachment_ref_ids",
    "resolve_notice_routing_samples_by_notice",
    "resolve_service_status_candidate_kind",
    "routes_to_service_status_candidate",
    "routing_metadata",
    "should_suppress_regulation_promotion",
]
