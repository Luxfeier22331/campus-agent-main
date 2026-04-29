from __future__ import annotations

from dataclasses import dataclass

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
)
from campus_ingestion_core.internal_notice_regulation_promotion_shared import (
    INTERNAL_NOTICE_PROMOTION_ACTION_REQUIRES_MULTIMODAL_PROCESSING,
    InternalNoticeRegulationPromotionDocumentReport,
)

NOTICE_MULTIMODAL_CONSUMPTION_POLICY_NOT_REQUIRED = "not_required"
NOTICE_MULTIMODAL_CONSUMPTION_POLICY_PROCESS = "process"
NOTICE_MULTIMODAL_CONSUMPTION_POLICY_SKIP = "skip"
NOTICE_MULTIMODAL_SKIP_REASON_LOW_VALUE_EPHEMERAL_EVENT_POSTER = "low_value_ephemeral_event_poster"
_LOW_VALUE_EPHEMERAL_EVENT_POSTER_KEYWORDS = (
    "讲座预告",
    "讲座",
    "讲堂",
    "大讲堂",
    "名家讲堂",
    "论坛",
    "女教授论坛",
    "工作坊",
    "读书会",
    "宣讲",
    "项目宣讲",
    "活动",
    "体验活动",
    "行业导师进课堂",
    "挑战杯",
    "赛事",
    "邀请函",
)
_HIGH_VALUE_MULTIMODAL_PROCESSING_KEYWORDS = (
    "采购",
    "招标",
    "比选",
    "询价",
    "竞价",
    "成交",
    "中标",
    "中选",
    "公示",
    "名单",
    "结果",
    "办法",
    "规定",
    "细则",
    "条例",
    "章程",
    "准则",
    "指导意见",
    "流程",
    "操作手册",
    "手册",
    "附件",
    "材料",
    "表格",
    "申请表",
    "报名表",
    "二维码",
    "扫码",
    "报名方式",
    "报名链接",
    "报名二维码",
    "下载",
    "文件发布",
)


@dataclass(frozen=True, slots=True)
class MultimodalConsumptionDecision:
    policy: str
    source_required_count: int = 0
    pending_attachment_count: int = 0
    skipped_attachment_count: int = 0
    action_required: bool = False
    skip_reason: str = ""


def resolve_inventory_multimodal_consumption_decision(
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry,
) -> MultimodalConsumptionDecision:
    source_required_count = max(
        0,
        int(inventory_entry.multimodal_processing_required_count or 0),
    )
    if source_required_count <= 0:
        return MultimodalConsumptionDecision(
            policy=NOTICE_MULTIMODAL_CONSUMPTION_POLICY_NOT_REQUIRED
        )
    parent_snapshot = dict(inventory_entry.parent_snapshot or {})
    notice_title = str(parent_snapshot.get("notice_title") or inventory_entry.document_id)
    if looks_like_low_value_ephemeral_event_poster(notice_title):
        return MultimodalConsumptionDecision(
            policy=NOTICE_MULTIMODAL_CONSUMPTION_POLICY_SKIP,
            source_required_count=source_required_count,
            skipped_attachment_count=source_required_count,
            skip_reason=NOTICE_MULTIMODAL_SKIP_REASON_LOW_VALUE_EPHEMERAL_EVENT_POSTER,
        )
    return MultimodalConsumptionDecision(
        policy=NOTICE_MULTIMODAL_CONSUMPTION_POLICY_PROCESS,
        source_required_count=source_required_count,
        pending_attachment_count=source_required_count,
        action_required=True,
    )


def resolve_report_multimodal_consumption_decision(
    *,
    report: InternalNoticeRegulationPromotionDocumentReport,
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry | None,
    title: str,
    body: str,
) -> MultimodalConsumptionDecision:
    source_required_count = (
        max(0, int(inventory_entry.multimodal_processing_required_count or 0))
        if inventory_entry is not None
        else 0
    )
    if not requires_multimodal_processing(report):
        return MultimodalConsumptionDecision(
            policy=NOTICE_MULTIMODAL_CONSUMPTION_POLICY_NOT_REQUIRED,
            source_required_count=source_required_count,
        )
    parent_title = ""
    if inventory_entry is not None:
        parent_snapshot = dict(inventory_entry.parent_snapshot or {})
        parent_title = str(parent_snapshot.get("notice_title") or "")
    policy_text = "\n".join(
        item
        for item in (
            report.source_title,
            title,
            report.regulation_title_normalized or "",
            parent_title,
            body,
        )
        if item
    )
    if looks_like_low_value_ephemeral_event_poster(policy_text):
        skipped_count = source_required_count or 1
        return MultimodalConsumptionDecision(
            policy=NOTICE_MULTIMODAL_CONSUMPTION_POLICY_SKIP,
            source_required_count=source_required_count,
            skipped_attachment_count=skipped_count,
            skip_reason=NOTICE_MULTIMODAL_SKIP_REASON_LOW_VALUE_EPHEMERAL_EVENT_POSTER,
        )
    return MultimodalConsumptionDecision(
        policy=NOTICE_MULTIMODAL_CONSUMPTION_POLICY_PROCESS,
        source_required_count=source_required_count,
        pending_attachment_count=source_required_count or 1,
        action_required=True,
    )


def build_multimodal_consumption_metadata(
    decision: MultimodalConsumptionDecision,
    *,
    include_not_required: bool = False,
) -> dict[str, object]:
    if (
        not include_not_required
        and decision.policy == NOTICE_MULTIMODAL_CONSUMPTION_POLICY_NOT_REQUIRED
        and decision.source_required_count <= 0
    ):
        return {}
    metadata: dict[str, object] = {
        "source_multimodal_processing_required_count": decision.source_required_count,
        "pending_multimodal_attachment_count": decision.pending_attachment_count,
        "multimodal_consumption_policy": decision.policy,
        "multimodal_action_required": decision.action_required,
        "multimodal_skipped_attachment_count": decision.skipped_attachment_count,
    }
    if decision.skip_reason:
        metadata["multimodal_skip_reason"] = decision.skip_reason
    return metadata


def looks_like_low_value_ephemeral_event_poster(text: str) -> bool:
    normalized = "".join(str(text or "").split())
    if not normalized:
        return False
    if any(keyword in normalized for keyword in _HIGH_VALUE_MULTIMODAL_PROCESSING_KEYWORDS):
        return False
    return any(keyword in normalized for keyword in _LOW_VALUE_EPHEMERAL_EVENT_POSTER_KEYWORDS)


def requires_multimodal_processing(
    report: InternalNoticeRegulationPromotionDocumentReport,
) -> bool:
    return (
        report.action == INTERNAL_NOTICE_PROMOTION_ACTION_REQUIRES_MULTIMODAL_PROCESSING
        and report.owner_source_missing_reason is None
        and not is_unsupported_machine_processing_reason(report)
    )


def is_unsupported_machine_processing_reason(
    report: InternalNoticeRegulationPromotionDocumentReport,
) -> bool:
    if report.action != INTERNAL_NOTICE_PROMOTION_ACTION_REQUIRES_MULTIMODAL_PROCESSING:
        return False
    reasons = set(report.reasons)
    return bool(
        reasons
        & {
            "draft_signal_detected",
            "input_lane_not_admitted",
            "unsupported_revision_track",
        }
    )


__all__ = [
    "NOTICE_MULTIMODAL_CONSUMPTION_POLICY_NOT_REQUIRED",
    "NOTICE_MULTIMODAL_CONSUMPTION_POLICY_PROCESS",
    "NOTICE_MULTIMODAL_CONSUMPTION_POLICY_SKIP",
    "NOTICE_MULTIMODAL_SKIP_REASON_LOW_VALUE_EPHEMERAL_EVENT_POSTER",
    "MultimodalConsumptionDecision",
    "build_multimodal_consumption_metadata",
    "is_unsupported_machine_processing_reason",
    "looks_like_low_value_ephemeral_event_poster",
    "requires_multimodal_processing",
    "resolve_inventory_multimodal_consumption_decision",
    "resolve_report_multimodal_consumption_decision",
]
