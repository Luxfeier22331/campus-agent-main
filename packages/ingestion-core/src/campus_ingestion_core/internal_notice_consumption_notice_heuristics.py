from __future__ import annotations

import json
from collections.abc import Mapping

from campus_ingestion_core.authenticated_notice_routing_sampling import (
    AuthenticatedNoticeRoutingSample,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
)
from campus_ingestion_core.internal_notice_consumption_projection_models import (
    InternalNoticeConsumptionProjectionObjectStore,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_PRIMARY_ROLE_LECTURE_ACTIVITY,
    NOTICE_PRIMARY_ROLE_PROCUREMENT_NOTICE,
    NOTICE_PRIMARY_ROLE_ROSTER_PUBLICATION,
)


def _resolve_notice_level_primary_role(
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry,
    routing_sample: AuthenticatedNoticeRoutingSample | None = None,
) -> str | None:
    parent_snapshot = dict(inventory_entry.parent_snapshot or {})
    title = str(parent_snapshot.get("notice_title") or "")
    if routing_sample is not None:
        if routing_sample.suggested_consumption_route == "procurement_notice_history":
            return NOTICE_PRIMARY_ROLE_PROCUREMENT_NOTICE
        if routing_sample.notice_family == "roster_publication":
            return NOTICE_PRIMARY_ROLE_ROSTER_PUBLICATION
        if (
            routing_sample.notice_family == "lecture_publicity"
            and routing_sample.suggested_consumption_route in {"defer", "no_adoption"}
        ):
            return NOTICE_PRIMARY_ROLE_LECTURE_ACTIVITY
    if _looks_like_roster_publication(title):
        return NOTICE_PRIMARY_ROLE_ROSTER_PUBLICATION
    return None


def _looks_like_procurement_notice(title: str) -> bool:
    normalized = "".join(str(title or "").split())
    if not normalized:
        return False
    if any(
        keyword in normalized
        for keyword in (
            "管理办法",
            "管理规定",
            "实施细则",
            "制度",
            "工作规程",
            "条例",
            "章程",
            "准则",
            "指导意见",
        )
    ):
        return False
    return any(
        keyword in normalized
        for keyword in (
            "采购公告",
            "采购通知",
            "采购项目",
            "招标公告",
            "招标项目",
            "比选公告",
            "比选结果",
            "询价公告",
            "竞价公告",
            "成交公告",
            "中标公告",
            "中选结果",
            "谈判结果",
        )
    )


def _looks_like_service_status_override_notice(
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry,
) -> bool:
    parent_snapshot = dict(inventory_entry.parent_snapshot or {})
    title = str(parent_snapshot.get("notice_title") or "")
    normalized = "".join(title.split())
    if not normalized:
        return False
    if any(
        keyword in normalized
        for keyword in (
            "管理办法",
            "管理规定",
            "实施细则",
            "工作规程",
            "制度",
            "条例",
            "章程",
            "准则",
            "指导意见",
        )
    ):
        return False
    service_signal = any(
        keyword in normalized
        for keyword in (
            "办理",
            "服务",
            "开放",
            "暂停",
            "恢复",
            "调整",
            "闭馆",
            "停办",
            "开通",
            "运行",
        )
    )
    bounded_time_signal = any(
        keyword in normalized
        for keyword in (
            "暑假期间",
            "寒假期间",
            "假期期间",
            "临时",
            "试运行",
            "运营时间",
            "服务时间",
            "开放时间",
        )
    )
    service_owner_signal = any(
        keyword in normalized
        for keyword in (
            "就业",
            "图书馆",
            "档案",
            "校车",
            "食堂",
            "浴室",
            "体育馆",
            "办事大厅",
            "业务",
            "窗口",
        )
    )
    return service_signal and (bounded_time_signal or service_owner_signal)


def _resolve_special_service_candidate_kind(
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry,
    *,
    routing_sample: AuthenticatedNoticeRoutingSample | None = None,
    object_store: InternalNoticeConsumptionProjectionObjectStore | None = None,
    source_bucket: str = "",
) -> str:
    if _looks_like_transport_reservation_instruction_notice(
        inventory_entry,
        routing_sample=routing_sample,
        object_store=object_store,
        source_bucket=source_bucket,
    ):
        return "transport_reservation_instruction"
    if _looks_like_medical_special_service_notice(inventory_entry):
        return "medical_special_service"
    return ""


def _looks_like_special_service_notice(
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry,
) -> bool:
    return bool(_resolve_special_service_candidate_kind(inventory_entry))


def _looks_like_medical_special_service_notice(
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry,
) -> bool:
    title = _notice_title_compact(inventory_entry)
    if not title:
        return False
    medical_special_signal = any(
        keyword in title
        for keyword in (
            "HPV",
            "hpv",
            "九价",
            "四价",
            "二价",
            "叶酸",
        )
    )
    service_action_signal = any(
        keyword in title
        for keyword in (
            "预约",
            "接种",
            "领取",
            "开放",
            "办理",
            "登记",
        )
    )
    return medical_special_signal and service_action_signal


def _looks_like_transport_reservation_instruction_notice(
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry,
    *,
    routing_sample: AuthenticatedNoticeRoutingSample | None = None,
    object_store: InternalNoticeConsumptionProjectionObjectStore | None = None,
    source_bucket: str = "",
) -> bool:
    title = _notice_title_compact(inventory_entry)
    body = _notice_body_text_compact(
        inventory_entry,
        object_store=object_store,
        source_bucket=source_bucket,
    )
    combined = f"{title}\n{body}"
    if not combined.strip():
        return False
    transport_signal = any(keyword in combined for keyword in ("接驳车", "班车", "校车", "通勤车"))
    if routing_sample is not None and routing_sample.notice_family in {
        "transport_commute_status",
        "facility_transport_classroom_status",
    }:
        transport_signal = True
    reservation_signal = "预约" in combined and any(
        keyword in combined for keyword in ("开放预约", "释放", "可预约资源", "预约系统")
    )
    return transport_signal and reservation_signal


def _looks_like_stable_contact_update_notice(
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry,
) -> bool:
    title = _notice_title_compact(inventory_entry)
    if not title:
        return False
    if _looks_like_activity_or_ephemeral_contact_notice_title(title):
        return False
    contact_signal = any(
        keyword in title
        for keyword in (
            "联系方式",
            "联系电话",
            "办公电话",
            "咨询电话",
            "服务热线",
            "服务电话",
            "联系邮箱",
            "办公地点",
        )
    )
    stable_change_signal = any(
        keyword in title
        for keyword in (
            "调整",
            "变更",
            "更新",
            "启用",
            "公布",
            "公告",
            "迁址",
            "搬迁",
        )
    )
    return contact_signal and stable_change_signal


def _looks_like_activity_or_ephemeral_contact_notice_title(title: str) -> bool:
    return any(
        keyword in title
        for keyword in (
            "活动",
            "讲座",
            "会议",
            "培训",
            "比赛",
            "竞赛",
            "征集",
            "招募",
            "志愿者",
            "报名",
            "论坛",
            "展览",
            "演出",
        )
    )


def _notice_title_compact(inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry) -> str:
    parent_snapshot = dict(inventory_entry.parent_snapshot or {})
    return "".join(str(parent_snapshot.get("notice_title") or "").split())


def _notice_body_text_compact(
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry,
    *,
    object_store: InternalNoticeConsumptionProjectionObjectStore | None = None,
    source_bucket: str = "",
) -> str:
    return "".join(
        _notice_body_text(
            inventory_entry,
            object_store=object_store,
            source_bucket=source_bucket,
        ).split()
    )


def _notice_body_text(
    inventory_entry: AuthenticatedNoticeSourceTruthInventoryEntry,
    *,
    object_store: InternalNoticeConsumptionProjectionObjectStore | None = None,
    source_bucket: str = "",
) -> str:
    parent_snapshot = dict(inventory_entry.parent_snapshot or {})
    existing = str(parent_snapshot.get("notice_content") or "").strip()
    if existing:
        return existing
    if object_store is None:
        return ""
    bucket = str(source_bucket or "").strip()
    key = str(
        inventory_entry.content_blocks_key or parent_snapshot.get("content_blocks_key") or ""
    ).strip()
    if not bucket or not key:
        return ""
    try:
        payload = object_store.get_bytes(bucket=bucket, key=key)
    except Exception:
        return ""
    texts: list[str] = []
    for raw_line in payload.decode("utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        try:
            row = json.loads(line)
        except json.JSONDecodeError:
            continue
        text = (
            str(row.get("text_normalized") or "").strip()
            or str(row.get("text_raw") or "").strip()
            or str(row.get("link_text") or "").strip()
        )
        if text:
            texts.append(text)
    return "\n".join(texts)


def _looks_like_attachment_form_template_plan(plan: Mapping[str, object]) -> bool:
    materialization_policy = str(plan.get("materialization_policy") or "").strip()
    classification = str(plan.get("classification") or "").strip()
    if materialization_policy not in {"required_document", "conditional_on_extracted_text"} and (
        classification not in {"text_extractable", "ocr_required"}
    ):
        return False
    text = "".join(
        str(plan.get(key) or "")
        for key in (
            "attachment_filename",
            "original_filename",
            "filename",
            "title",
            "document_id",
        )
    )
    normalized = "".join(text.split())
    if not normalized:
        return False
    if any(
        keyword in normalized
        for keyword in (
            "管理办法",
            "管理规定",
            "实施细则",
            "工作规程",
            "制度",
            "条例",
            "章程",
            "准则",
            "指导意见",
        )
    ):
        return False
    return any(
        keyword in normalized
        for keyword in (
            "报名表",
            "申请表",
            "登记表",
            "汇总表",
            "统计表",
            "信息表",
            "审批表",
            "模板",
            "表格",
            "回执",
            "承诺书",
            "材料清单",
            "附件表",
        )
    )


def _looks_like_attachment_form_template_notice_title(title: str) -> bool:
    normalized = "".join(str(title or "").split())
    if not normalized:
        return False
    if any(
        keyword in normalized
        for keyword in (
            "管理办法",
            "管理规定",
            "实施细则",
            "工作规程",
            "制度",
            "条例",
            "章程",
            "准则",
            "指导意见",
        )
    ):
        return False
    return any(
        keyword in normalized
        for keyword in (
            "报名",
            "申请",
            "申报",
            "登记",
            "审核",
            "资格审查",
            "材料提交",
            "材料报送",
        )
    )


def _looks_like_roster_publication(title: str) -> bool:
    normalized = "".join(str(title or "").split())
    return any(
        keyword in normalized
        for keyword in (
            "名单公示",
            "录取名单",
            "拟接收名单",
            "入选名单",
            "候选人",
            "成绩公示",
            "最终公示",
        )
    )


def _looks_like_lecture_activity(title: str) -> bool:
    normalized = "".join(str(title or "").split())
    return any(
        keyword in normalized
        for keyword in (
            "讲座预告",
            "讲堂",
            "论坛",
            "大讲堂",
            "读书会",
            "前沿讲堂",
            "文华讲堂",
        )
    )
