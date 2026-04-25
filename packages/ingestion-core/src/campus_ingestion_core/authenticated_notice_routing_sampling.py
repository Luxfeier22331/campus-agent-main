from __future__ import annotations

from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from campus_ingestion_core.authenticated_notice_notice_family import (
    AuthenticatedNoticeNoticeFamilyConfig,
    classify_authenticated_notice_bundle_record,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
)

_NOTICE_LEVEL_QUERY_FAMILIES = frozenset(
    {
        "course_teaching_arrangement",
        "student_affairs_application",
        "document_collection_deadline",
        "exchange_visit_project",
        "research_project_application",
        "operational_procedure",
        "safety_compliance_notice",
        "academic_affairs_lifecycle",
        "finance_payment_action",
        "health_medical_action",
        "form_template_download",
        "survey_feedback_collection",
        "library_resource_notice",
    }
)
_SERVICE_STATUS_CANDIDATE_FAMILIES = frozenset(
    {
        "service_status_override",
        "facility_service_status",
        "it_platform_service_status",
        "library_service_status",
        "transport_commute_status",
    }
)
_LOW_VALUE_MACHINE_SKIP_FAMILIES = frozenset(
    {
        "lecture_publicity",
        "event_activity",
        "competition_event",
        "meeting_training",
        "job_recruitment",
        "internal_governance_party_admin",
        "general_publicity_culture",
    }
)
_MACHINE_PROCESSING_VALUE_TERMS = (
    "采购",
    "招标",
    "比选",
    "公示",
    "名单",
    "结果",
    "操作手册",
    "手册",
    "附件",
    "材料",
    "表格",
    "申请表",
    "报名表",
    "二维码",
    "扫码",
    "报名",
    "资格审核",
    "提交",
    "报送",
)


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeRoutingSample:
    notice_id: str
    notice_title: str
    notice_type_names: tuple[str, ...]
    notice_family: str
    admission_policy: str
    priority: int
    suggested_consumption_route: str
    machine_processing_policy: str
    matched_title_patterns: tuple[str, ...]
    matched_body_patterns: tuple[str, ...]
    attachment_ref_count: int = 0
    attachment_document_count: int = 0
    text_extractable_count: int = 0
    ocr_required_count: int = 0
    reference_only_count: int = 0
    multimodal_processing_required_count: int = 0
    reviewer_verdict: str = ""


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeRoutingSampleReport:
    source_corpus: str
    source_collection: str
    notice_count: int
    sample_limit_per_group: int
    boundary_sample_limit: int
    family_counts: dict[str, int]
    admission_policy_counts: dict[str, int]
    suggested_consumption_route_counts: dict[str, int]
    machine_processing_policy_counts: dict[str, int]
    samples: tuple[AuthenticatedNoticeRoutingSample, ...]


def build_authenticated_notice_routing_sample_report_from_bundle_records(
    *,
    bundle_records: Sequence[Mapping[str, Any]],
    config: AuthenticatedNoticeNoticeFamilyConfig,
    sample_limit_per_group: int = 12,
    boundary_sample_limit: int = 30,
) -> AuthenticatedNoticeRoutingSampleReport:
    samples = tuple(_sample_from_bundle_record(record, config=config) for record in bundle_records)
    return _build_report(
        samples=samples,
        source_corpus=config.corpus,
        source_collection=config.collection,
        sample_limit_per_group=sample_limit_per_group,
        boundary_sample_limit=boundary_sample_limit,
    )


def build_authenticated_notice_routing_sample_report_from_inventory_entries(
    *,
    inventory_entries: Sequence[AuthenticatedNoticeSourceTruthInventoryEntry],
    config: AuthenticatedNoticeNoticeFamilyConfig,
    sample_limit_per_group: int = 12,
    boundary_sample_limit: int = 30,
) -> AuthenticatedNoticeRoutingSampleReport:
    samples = tuple(
        _sample_from_bundle_record(
            _bundle_record_from_inventory_entry(entry),
            config=config,
            inventory_entry=entry,
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
        samples=selected_samples,
    )


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


def _sample_from_bundle_record(
    record: Mapping[str, Any],
    *,
    config: AuthenticatedNoticeNoticeFamilyConfig,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None = None,
) -> AuthenticatedNoticeRoutingSample:
    notice = dict(record.get("notice") or {})
    classification = classify_authenticated_notice_bundle_record(dict(record), config=config)
    notice_title = str(notice.get("notice_title") or "").strip()
    notice_type_names = tuple(
        dict.fromkeys(
            str(item.get("notice_type_name") or "").strip()
            for item in list(notice.get("categories") or ())
            if isinstance(item, Mapping) and str(item.get("notice_type_name") or "").strip()
        )
    )
    attachment_counts = _resolve_attachment_counts(record, inventory_entry)
    machine_processing_policy = _resolve_machine_processing_policy(
        family=classification.family,
        title=notice_title,
        body=str(notice.get("notice_content") or ""),
        multimodal_processing_required_count=attachment_counts[
            "multimodal_processing_required_count"
        ],
    )
    return AuthenticatedNoticeRoutingSample(
        notice_id=str(record.get("notice_id") or notice.get("notice_id") or "").strip(),
        notice_title=notice_title,
        notice_type_names=notice_type_names,
        notice_family=classification.family,
        admission_policy=classification.admission_policy,
        priority=classification.priority,
        suggested_consumption_route=_resolve_suggested_consumption_route(
            classification.family,
            classification.admission_policy,
        ),
        machine_processing_policy=machine_processing_policy,
        matched_title_patterns=classification.matched_title_patterns,
        matched_body_patterns=classification.matched_body_patterns,
        attachment_ref_count=attachment_counts["attachment_ref_count"],
        attachment_document_count=attachment_counts["attachment_document_count"],
        text_extractable_count=attachment_counts["text_extractable_count"],
        ocr_required_count=attachment_counts["ocr_required_count"],
        reference_only_count=attachment_counts["reference_only_count"],
        multimodal_processing_required_count=attachment_counts[
            "multimodal_processing_required_count"
        ],
    )


def _bundle_record_from_inventory_entry(
    entry: AuthenticatedNoticeSourceTruthInventoryEntry,
) -> dict[str, Any]:
    parent_snapshot = dict(entry.parent_snapshot or {})
    notice_title = str(parent_snapshot.get("notice_title") or entry.document_id)
    notice_type_names = tuple(
        str(item).strip()
        for item in parent_snapshot.get("notice_type_names") or ()
        if str(item).strip()
    )
    categories = tuple({"notice_type": "", "notice_type_name": name} for name in notice_type_names)
    return {
        "notice_id": entry.notice_id,
        "notice": {
            "notice_id": entry.notice_id,
            "notice_title": notice_title,
            "notice_content": str(parent_snapshot.get("notice_content") or ""),
            "notice_release_time": parent_snapshot.get("notice_release_time"),
            "categories": categories,
        },
        "notice_attachments": list(parent_snapshot.get("attachment_projection_plans") or ()),
        "attachments": [],
    }


def _resolve_attachment_counts(
    record: Mapping[str, Any],
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
) -> dict[str, int]:
    if inventory_entry is not None:
        return {
            "attachment_ref_count": int(inventory_entry.attachment_ref_count or 0),
            "attachment_document_count": int(inventory_entry.attachment_document_count or 0),
            "text_extractable_count": int(inventory_entry.text_extractable_count or 0),
            "ocr_required_count": int(inventory_entry.ocr_required_count or 0),
            "reference_only_count": int(inventory_entry.reference_only_count or 0),
            "multimodal_processing_required_count": int(
                inventory_entry.multimodal_processing_required_count or 0
            ),
        }
    attachments = tuple(record.get("notice_attachments") or record.get("attachments") or ())
    return {
        "attachment_ref_count": len(attachments),
        "attachment_document_count": 0,
        "text_extractable_count": 0,
        "ocr_required_count": 0,
        "reference_only_count": 0,
        "multimodal_processing_required_count": 0,
    }


def _resolve_suggested_consumption_route(family: str, admission_policy: str) -> str:
    if family == "policy_regulation":
        return "regulation_candidate"
    if family == "procurement_notice":
        return "procurement_notice_history"
    if family in _SERVICE_STATUS_CANDIDATE_FAMILIES:
        return "service_status_candidate"
    if family in {"roster_publication", "publication_result"}:
        return "no_adoption"
    if family in _NOTICE_LEVEL_QUERY_FAMILIES:
        return "notice_level_query"
    if admission_policy in {"defer", "review_later"}:
        return admission_policy
    return "notice_level_query"


def _resolve_machine_processing_policy(
    *,
    family: str,
    title: str,
    body: str,
    multimodal_processing_required_count: int,
) -> str:
    text = "".join(f"{title}\n{body}".split())
    has_value_signal = any(term in text for term in _MACHINE_PROCESSING_VALUE_TERMS)
    if multimodal_processing_required_count <= 0:
        if family in _LOW_VALUE_MACHINE_SKIP_FAMILIES:
            return "skip"
        return "not_required"
    if has_value_signal:
        return "process"
    if family in _LOW_VALUE_MACHINE_SKIP_FAMILIES:
        return "skip"
    return "process"


__all__ = [
    "AuthenticatedNoticeRoutingSample",
    "AuthenticatedNoticeRoutingSampleReport",
    "build_authenticated_notice_routing_sample_report_from_bundle_records",
    "build_authenticated_notice_routing_sample_report_from_inventory_entries",
]
