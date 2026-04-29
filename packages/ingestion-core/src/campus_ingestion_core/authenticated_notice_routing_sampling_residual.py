from __future__ import annotations

import re
from collections.abc import Sequence

from campus_ingestion_core.authenticated_notice_routing_sampling_models import (
    AuthenticatedNoticeRoutingResidualCluster,
    AuthenticatedNoticeRoutingSample,
)

_RESIDUAL_ACTION_TERMS = (
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
_RESIDUAL_SERVICE_TERMS = (
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
_RESIDUAL_PUBLICITY_TERMS = (
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


def build_authenticated_notice_residual_clusters(
    samples: Sequence[AuthenticatedNoticeRoutingSample],
) -> tuple[AuthenticatedNoticeRoutingResidualCluster, ...]:
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
        action_signals = _matched_terms(_RESIDUAL_ACTION_TERMS, text)
        service_signals = _matched_terms(_RESIDUAL_SERVICE_TERMS, text)
        publicity_signals = _matched_terms(_RESIDUAL_PUBLICITY_TERMS, text)
        attachment_bucket = _attachment_bucket(sample)
        recommended_action = _recommend_residual_action(
            action_signals=action_signals,
            service_signals=service_signals,
            publicity_signals=publicity_signals,
        )
        title_signature = _residual_title_signature(
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

    clusters: list[AuthenticatedNoticeRoutingResidualCluster] = []
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
        cluster_id = f"residual_cluster_{index:03d}"
        preview_samples = tuple(cluster_samples[:8])
        clusters.append(
            AuthenticatedNoticeRoutingResidualCluster(
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


def _recommend_residual_action(
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
    return "keep_terminal_no_adoption"


def _residual_title_signature(
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


__all__ = ["build_authenticated_notice_residual_clusters"]
