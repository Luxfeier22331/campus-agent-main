from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from typing import Any

from campus_ingestion_core.authenticated_notice_notice_family import (
    AuthenticatedNoticeNoticeFamilyConfig,
)
from campus_ingestion_core.authenticated_notice_routing_sampling_models import (
    AuthenticatedNoticeRoutingAuditReport,
    AuthenticatedNoticeRoutingDecision,
    AuthenticatedNoticeRoutingObjectStore,
    AuthenticatedNoticeRoutingReviewLaterCluster,
    AuthenticatedNoticeRoutingSample,
    AuthenticatedNoticeRoutingSampleReport,
)
from campus_ingestion_core.authenticated_notice_routing_sampling_review import (
    build_authenticated_notice_review_later_clusters,
)
from campus_ingestion_core.authenticated_notice_routing_sampling_samples import (
    sample_authenticated_notice_routing_from_bundle_record,
    sample_authenticated_notice_routing_from_inventory_entry,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
)


def build_authenticated_notice_routing_sample_report_from_bundle_records(
    *,
    bundle_records: Sequence[Mapping[str, Any]],
    config: AuthenticatedNoticeNoticeFamilyConfig,
    sample_limit_per_group: int = 12,
    boundary_sample_limit: int = 30,
) -> AuthenticatedNoticeRoutingSampleReport:
    samples = tuple(
        sample_authenticated_notice_routing_from_bundle_record(record, config=config)
        for record in bundle_records
    )
    return _build_report(
        samples=samples,
        source_corpus=config.corpus,
        source_collection=config.collection,
        sample_limit_per_group=sample_limit_per_group,
        boundary_sample_limit=boundary_sample_limit,
    )


def build_authenticated_notice_routing_audit_report_from_bundle_records(
    *,
    bundle_records: Sequence[Mapping[str, Any]],
    config: AuthenticatedNoticeNoticeFamilyConfig,
) -> AuthenticatedNoticeRoutingAuditReport:
    samples = tuple(
        sample_authenticated_notice_routing_from_bundle_record(record, config=config)
        for record in bundle_records
    )
    return _build_audit_report(
        samples=samples,
        source_corpus=config.corpus,
        source_collection=config.collection,
    )


def build_authenticated_notice_routing_audit_report_from_inventory_entries(
    *,
    inventory_entries: Sequence[AuthenticatedNoticeSourceTruthInventoryEntry],
    config: AuthenticatedNoticeNoticeFamilyConfig,
    object_store: AuthenticatedNoticeRoutingObjectStore | None = None,
    source_bucket: str = "",
) -> AuthenticatedNoticeRoutingAuditReport:
    samples = tuple(
        sample_authenticated_notice_routing_from_inventory_entry(
            entry,
            config=config,
            object_store=object_store,
            source_bucket=source_bucket,
        )
        for entry in inventory_entries
    )
    return _build_audit_report(
        samples=samples,
        source_corpus=config.corpus,
        source_collection=config.collection,
    )


def build_authenticated_notice_routing_sample_report_from_inventory_entries(
    *,
    inventory_entries: Sequence[AuthenticatedNoticeSourceTruthInventoryEntry],
    config: AuthenticatedNoticeNoticeFamilyConfig,
    sample_limit_per_group: int = 12,
    boundary_sample_limit: int = 30,
    object_store: AuthenticatedNoticeRoutingObjectStore | None = None,
    source_bucket: str = "",
) -> AuthenticatedNoticeRoutingSampleReport:
    samples = tuple(
        sample_authenticated_notice_routing_from_inventory_entry(
            entry,
            config=config,
            object_store=object_store,
            source_bucket=source_bucket,
        )
        for entry in inventory_entries
    )
    return _build_report(
        samples=samples,
        source_corpus=config.corpus,
        source_collection=config.collection,
        sample_limit_per_group=sample_limit_per_group,
        boundary_sample_limit=boundary_sample_limit,
    )


def resolve_authenticated_notice_routing_samples_from_inventory_entries(
    *,
    inventory_entries: Sequence[AuthenticatedNoticeSourceTruthInventoryEntry],
    config: AuthenticatedNoticeNoticeFamilyConfig,
    object_store: AuthenticatedNoticeRoutingObjectStore | None = None,
    source_bucket: str = "",
) -> tuple[AuthenticatedNoticeRoutingSample, ...]:
    return tuple(
        sample_authenticated_notice_routing_from_inventory_entry(
            entry,
            config=config,
            object_store=object_store,
            source_bucket=source_bucket,
        )
        for entry in inventory_entries
    )


def _build_audit_report(
    *,
    samples: Sequence[AuthenticatedNoticeRoutingSample],
    source_corpus: str,
    source_collection: str,
) -> AuthenticatedNoticeRoutingAuditReport:
    review_later_notices = tuple(
        sample for sample in samples if sample.suggested_consumption_route == "review_later"
    )
    return AuthenticatedNoticeRoutingAuditReport(
        source_corpus=source_corpus,
        source_collection=source_collection,
        notice_count=len(samples),
        family_counts=dict(sorted(Counter(sample.notice_family for sample in samples).items())),
        admission_policy_counts=dict(
            sorted(Counter(sample.admission_policy for sample in samples).items())
        ),
        suggested_consumption_route_counts=dict(
            sorted(Counter(sample.suggested_consumption_route for sample in samples).items())
        ),
        machine_processing_policy_counts=dict(
            sorted(Counter(sample.machine_processing_policy for sample in samples).items())
        ),
        attachment_processing_policy_counts=dict(
            sorted(Counter(sample.attachment_processing_policy for sample in samples).items())
        ),
        attachment_processing_ref_counts=_attachment_processing_ref_counts(samples),
        review_later_count=len(review_later_notices),
        review_later_notices=review_later_notices,
        review_later_clusters=build_authenticated_notice_review_later_clusters(
            review_later_notices
        ),
    )


def _build_report(
    *,
    samples: Sequence[AuthenticatedNoticeRoutingSample],
    source_corpus: str,
    source_collection: str,
    sample_limit_per_group: int,
    boundary_sample_limit: int,
) -> AuthenticatedNoticeRoutingSampleReport:
    selected_samples = _select_grouped_samples(
        samples,
        sample_limit_per_group=sample_limit_per_group,
        boundary_sample_limit=boundary_sample_limit,
    )
    return AuthenticatedNoticeRoutingSampleReport(
        source_corpus=source_corpus,
        source_collection=source_collection,
        notice_count=len(samples),
        sample_limit_per_group=sample_limit_per_group,
        boundary_sample_limit=boundary_sample_limit,
        family_counts=dict(sorted(Counter(sample.notice_family for sample in samples).items())),
        admission_policy_counts=dict(
            sorted(Counter(sample.admission_policy for sample in samples).items())
        ),
        suggested_consumption_route_counts=dict(
            sorted(Counter(sample.suggested_consumption_route for sample in samples).items())
        ),
        machine_processing_policy_counts=dict(
            sorted(Counter(sample.machine_processing_policy for sample in samples).items())
        ),
        attachment_processing_policy_counts=dict(
            sorted(Counter(sample.attachment_processing_policy for sample in samples).items())
        ),
        attachment_processing_ref_counts=_attachment_processing_ref_counts(samples),
        samples=selected_samples,
    )


def _attachment_processing_ref_counts(
    samples: Sequence[AuthenticatedNoticeRoutingSample],
) -> dict[str, int]:
    totals: dict[str, int] = {}
    for sample in samples:
        policy = sample.attachment_processing_policy
        totals[policy] = totals.get(policy, 0) + int(sample.attachment_ref_count or 0)
    return dict(sorted(totals.items()))


def _select_grouped_samples(
    samples: Sequence[AuthenticatedNoticeRoutingSample],
    *,
    sample_limit_per_group: int,
    boundary_sample_limit: int,
) -> tuple[AuthenticatedNoticeRoutingSample, ...]:
    grouped: dict[str, list[AuthenticatedNoticeRoutingSample]] = {}
    for sample in sorted(samples, key=lambda item: (item.notice_family, item.notice_id)):
        group = grouped.setdefault(sample.notice_family, [])
        if len(group) < max(0, sample_limit_per_group):
            group.append(sample)
    selected: list[AuthenticatedNoticeRoutingSample] = []
    for family in sorted(grouped):
        selected.extend(grouped[family])
    boundary_samples = [
        sample
        for sample in sorted(samples, key=lambda item: (item.notice_id, item.notice_family))
        if sample.machine_processing_policy == "process"
        or sample.suggested_consumption_route
        in {
            "regulation_candidate",
            "procurement_notice_history",
            "service_status_candidate",
        }
    ]
    selected_ids = {sample.notice_id for sample in selected}
    for sample in boundary_samples:
        if len(boundary_samples) > boundary_sample_limit and len(selected) >= boundary_sample_limit:
            break
        if sample.notice_id in selected_ids:
            continue
        selected.append(sample)
        selected_ids.add(sample.notice_id)
    return tuple(selected)


__all__ = [
    "AuthenticatedNoticeRoutingAuditReport",
    "AuthenticatedNoticeRoutingDecision",
    "AuthenticatedNoticeRoutingObjectStore",
    "AuthenticatedNoticeRoutingReviewLaterCluster",
    "AuthenticatedNoticeRoutingSample",
    "AuthenticatedNoticeRoutingSampleReport",
    "build_authenticated_notice_routing_audit_report_from_bundle_records",
    "build_authenticated_notice_routing_audit_report_from_inventory_entries",
    "build_authenticated_notice_routing_sample_report_from_bundle_records",
    "build_authenticated_notice_routing_sample_report_from_inventory_entries",
    "resolve_authenticated_notice_routing_samples_from_inventory_entries",
]
