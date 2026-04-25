from __future__ import annotations

import re
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
        "health_welfare_service_notice",
        "form_template_download",
        "survey_feedback_collection",
        "library_resource_notice",
        "academic_course_exam_operation",
        "academic_program_selection",
        "student_status_registration",
        "student_program_award_selection",
        "it_platform_operation_notice",
        "library_acquisition_service",
    }
)
_SERVICE_STATUS_CANDIDATE_FAMILIES = frozenset(
    {
        "service_status_override",
        "facility_service_status",
        "it_platform_service_status",
        "library_service_status",
        "transport_commute_status",
        "facility_transport_classroom_status",
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
        "staff_internal_admin",
        "research_publicity_call",
        "governance_party_life",
        "culture_publicity_activity",
        "campus_news_publicity",
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
_REVIEW_LATER_ACTION_TERMS = (
    "报名",
    "提交",
    "报送",
    "领取",
    "缴费",
    "扣款",
    "办理",
    "申请",
    "申报",
    "确认",
    "下载",
    "查询",
    "考试",
    "评审",
    "招录",
    "选拔",
)
_REVIEW_LATER_SERVICE_TERMS = (
    "开放",
    "暂停",
    "调整",
    "维护",
    "停用",
    "恢复",
    "关闭",
    "试运行",
    "运营",
    "停电",
    "断网",
    "班车",
    "教室",
    "图书馆",
    "门户",
)
_REVIEW_LATER_PUBLICITY_TERMS = (
    "预告",
    "展映",
    "活动总结",
    "倡议",
    "简报",
    "喜讯",
    "讲座",
    "沙龙",
    "论坛",
    "文化节",
    "征文",
    "竞赛",
    "比赛",
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


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeRoutingReviewLaterCluster:
    cluster_id: str
    count: int
    notice_type_names: tuple[str, ...]
    title_signature: str
    action_signals: tuple[str, ...]
    service_signals: tuple[str, ...]
    publicity_signals: tuple[str, ...]
    attachment_bucket: str
    recommended_action: str
    sample_notice_ids: tuple[str, ...]
    sample_titles: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeRoutingAuditReport:
    source_corpus: str
    source_collection: str
    notice_count: int
    family_counts: dict[str, int]
    admission_policy_counts: dict[str, int]
    suggested_consumption_route_counts: dict[str, int]
    machine_processing_policy_counts: dict[str, int]
    review_later_count: int
    review_later_notices: tuple[AuthenticatedNoticeRoutingSample, ...]
    review_later_clusters: tuple[AuthenticatedNoticeRoutingReviewLaterCluster, ...]


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


def build_authenticated_notice_routing_audit_report_from_bundle_records(
    *,
    bundle_records: Sequence[Mapping[str, Any]],
    config: AuthenticatedNoticeNoticeFamilyConfig,
) -> AuthenticatedNoticeRoutingAuditReport:
    samples = tuple(_sample_from_bundle_record(record, config=config) for record in bundle_records)
    return _build_audit_report(
        samples=samples,
        source_corpus=config.corpus,
        source_collection=config.collection,
    )


def build_authenticated_notice_routing_audit_report_from_inventory_entries(
    *,
    inventory_entries: Sequence[AuthenticatedNoticeSourceTruthInventoryEntry],
    config: AuthenticatedNoticeNoticeFamilyConfig,
) -> AuthenticatedNoticeRoutingAuditReport:
    samples = tuple(
        _sample_from_bundle_record(
            _bundle_record_from_inventory_entry(entry),
            config=config,
            inventory_entry=entry,
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
        review_later_count=len(review_later_notices),
        review_later_notices=review_later_notices,
        review_later_clusters=_build_review_later_clusters(review_later_notices),
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


def _build_review_later_clusters(
    samples: Sequence[AuthenticatedNoticeRoutingSample],
) -> tuple[AuthenticatedNoticeRoutingReviewLaterCluster, ...]:
    grouped: dict[
        tuple[
            tuple[str, ...],
            str,
            tuple[str, ...],
            tuple[str, ...],
            tuple[str, ...],
            str,
            str,
        ],
        list[AuthenticatedNoticeRoutingSample],
    ] = {}
    for sample in samples:
        text = "".join(f"{sample.notice_title}".split())
        action_signals = _matched_terms(_REVIEW_LATER_ACTION_TERMS, text)
        service_signals = _matched_terms(_REVIEW_LATER_SERVICE_TERMS, text)
        publicity_signals = _matched_terms(_REVIEW_LATER_PUBLICITY_TERMS, text)
        attachment_bucket = _attachment_bucket(sample)
        recommended_action = _recommend_review_later_action(
            action_signals=action_signals,
            service_signals=service_signals,
            publicity_signals=publicity_signals,
        )
        title_signature = _review_later_title_signature(
            title=sample.notice_title,
            action_signals=action_signals,
            service_signals=service_signals,
            publicity_signals=publicity_signals,
        )
        notice_type_names = sample.notice_type_names or ("unknown",)
        key = (
            notice_type_names,
            title_signature,
            action_signals,
            service_signals,
            publicity_signals,
            attachment_bucket,
            recommended_action,
        )
        grouped.setdefault(key, []).append(sample)

    clusters: list[AuthenticatedNoticeRoutingReviewLaterCluster] = []
    for index, (key, cluster_samples) in enumerate(
        sorted(
            grouped.items(),
            key=lambda item: (-len(item[1]), item[0]),
        ),
        start=1,
    ):
        (
            notice_type_names,
            title_signature,
            action_signals,
            service_signals,
            publicity_signals,
            attachment_bucket,
            recommended_action,
        ) = key
        cluster_id = f"review_later_cluster_{index:03d}"
        preview_samples = tuple(cluster_samples[:8])
        clusters.append(
            AuthenticatedNoticeRoutingReviewLaterCluster(
                cluster_id=cluster_id,
                count=len(cluster_samples),
                notice_type_names=notice_type_names,
                title_signature=title_signature,
                action_signals=action_signals,
                service_signals=service_signals,
                publicity_signals=publicity_signals,
                attachment_bucket=attachment_bucket,
                recommended_action=recommended_action,
                sample_notice_ids=tuple(sample.notice_id for sample in preview_samples),
                sample_titles=tuple(sample.notice_title for sample in preview_samples),
            )
        )
    return tuple(clusters)


def _matched_terms(terms: Sequence[str], text: str) -> tuple[str, ...]:
    return tuple(term for term in terms if term in text)


def _attachment_bucket(sample: AuthenticatedNoticeRoutingSample) -> str:
    if sample.multimodal_processing_required_count > 0:
        return "multimodal_required"
    if sample.attachment_ref_count > 0:
        return "has_attachments"
    return "no_attachments"


def _recommend_review_later_action(
    *,
    action_signals: tuple[str, ...],
    service_signals: tuple[str, ...],
    publicity_signals: tuple[str, ...],
) -> str:
    if service_signals:
        return "candidate_service_status_rule"
    if action_signals:
        return "candidate_notice_level_query_rule"
    if publicity_signals:
        return "candidate_defer_skip_rule"
    return "keep_other_review_later"


def _review_later_title_signature(
    *,
    title: str,
    action_signals: tuple[str, ...],
    service_signals: tuple[str, ...],
    publicity_signals: tuple[str, ...],
) -> str:
    if service_signals:
        return "service:" + "+".join(service_signals)
    if action_signals:
        return "action:" + "+".join(action_signals)
    if publicity_signals:
        return "publicity:" + "+".join(publicity_signals)
    normalized = re.sub(r"\d{4}(?:-\d{4})?", "", title)
    normalized = re.sub(r"[\s《》“”\"'：:，,、（）()【】/\\—-]+", "", normalized)
    for token in ("关于", "温馨提醒", "通知", "公告", "的"):
        normalized = normalized.replace(token, "")
    return (normalized[:18] or "uncategorized").strip()


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
    suggested_consumption_route = _resolve_suggested_consumption_route(
        classification.family,
        classification.admission_policy,
        title=notice_title,
    )
    machine_processing_policy = _resolve_machine_processing_policy(
        family=classification.family,
        suggested_consumption_route=suggested_consumption_route,
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
        suggested_consumption_route=suggested_consumption_route,
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


def _resolve_suggested_consumption_route(
    family: str,
    admission_policy: str,
    *,
    title: str = "",
) -> str:
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
    if family == "other" and admission_policy == "review_later":
        return _resolve_other_review_later_consumption_route(title)
    if admission_policy in {"defer", "review_later"}:
        return admission_policy
    return "notice_level_query"


def _resolve_other_review_later_consumption_route(title: str) -> str:
    normalized = _compact_review_later_title(title)
    if normalized in {"讣告", "通知", "公告", "通告"}:
        return "no_adoption"
    return "review_later"


def _compact_review_later_title(title: str) -> str:
    return re.sub(r"[\s《》“”\"'：:，,、（）()【】/\\—-]+", "", str(title or ""))


def _resolve_machine_processing_policy(
    *,
    family: str,
    suggested_consumption_route: str,
    title: str,
    body: str,
    multimodal_processing_required_count: int,
) -> str:
    if suggested_consumption_route in {"defer", "review_later", "no_adoption"}:
        return "skip"
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
    "AuthenticatedNoticeRoutingAuditReport",
    "AuthenticatedNoticeRoutingReviewLaterCluster",
    "AuthenticatedNoticeRoutingSample",
    "AuthenticatedNoticeRoutingSampleReport",
    "build_authenticated_notice_routing_audit_report_from_bundle_records",
    "build_authenticated_notice_routing_audit_report_from_inventory_entries",
    "build_authenticated_notice_routing_sample_report_from_bundle_records",
    "build_authenticated_notice_routing_sample_report_from_inventory_entries",
]
