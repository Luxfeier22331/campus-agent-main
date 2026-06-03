from __future__ import annotations

import re
from collections.abc import Sequence

from campus_ingestion_core.internal_notice_schedule_image_ocr_child_docs import (
    _build_child_document,
)
from campus_ingestion_core.internal_notice_schedule_image_ocr_classification import (
    _combined_text,
    _has_route_hint,
    _has_temporal_scope_hint,
    _has_time,
    _table_has_time,
)
from campus_ingestion_core.internal_notice_schedule_image_ocr_constants import (
    _TIME_RE,
)
from campus_ingestion_core.internal_notice_schedule_image_ocr_models import (
    ScheduleImageOcrAdmissionDecision,
    ScheduleImageOcrEvidence,
    ScheduleImageOcrNoticeImageReview,
    ScheduleImageOcrNoticeReview,
    ScheduleImageOcrProviderResult,
)
from campus_ingestion_core.internal_notice_schedule_image_ocr_scalars import _compact


def admit_schedule_image_ocr_child_document(
    *,
    evidence: ScheduleImageOcrEvidence,
    result: ScheduleImageOcrProviderResult,
    generated_at: str,
) -> ScheduleImageOcrAdmissionDecision:
    if result.confidence == "low":
        return ScheduleImageOcrAdmissionDecision(status="rejected", reason="low_confidence")
    if not _has_time(result):
        return ScheduleImageOcrAdmissionDecision(status="rejected", reason="missing_schedule_time")
    if not _has_route_hint(_combined_text(evidence, result)):
        return ScheduleImageOcrAdmissionDecision(status="rejected", reason="missing_route_hint")
    if not _has_temporal_scope_hint(_combined_text(evidence, result)):
        return ScheduleImageOcrAdmissionDecision(status="rejected", reason="missing_temporal_scope")
    schedule_tables = tuple(table for table in result.tables if _table_has_time(table))
    if not schedule_tables:
        return ScheduleImageOcrAdmissionDecision(status="rejected", reason="missing_schedule_table")
    document = _build_child_document(
        evidence=evidence,
        result=result,
        schedule_tables=schedule_tables,
        generated_at=generated_at,
    )
    return ScheduleImageOcrAdmissionDecision(
        status="admitted",
        reason="schedule_table_admitted",
        document=document,
    )


def summarize_schedule_image_ocr_notice_review(
    *,
    items: Sequence[
        tuple[
            ScheduleImageOcrEvidence,
            ScheduleImageOcrProviderResult,
            ScheduleImageOcrAdmissionDecision,
        ]
    ],
) -> ScheduleImageOcrNoticeReview:
    if not items:
        raise ValueError("schedule image OCR notice review requires at least one item")
    notice_ids = {evidence.notice_id for evidence, _, _ in items}
    if len(notice_ids) != 1:
        raise ValueError("schedule image OCR notice review items must belong to one notice")
    image_reviews = tuple(
        _review_notice_image(evidence=evidence, result=result, decision=decision)
        for evidence, result, decision in items
    )
    admitted_count = sum(1 for image in image_reviews if image.image_role == "schedule_table")
    non_schedule_visual_count = sum(
        1 for image in image_reviews if image.image_role == "non_schedule_visual"
    )
    rejected_schedule_count = sum(
        1 for image in image_reviews if image.image_role == "schedule_candidate_rejected"
    )
    body_candidate_count = sum(
        1 for image in image_reviews if image.image_role == "body_schedule_candidate"
    )
    actions: list[str] = []
    if admitted_count:
        actions.append("write_schedule_child_documents")
    if non_schedule_visual_count:
        actions.append("skip_non_schedule_visuals")
    if rejected_schedule_count:
        actions.append("review_rejected_schedule_candidates")
    if body_candidate_count:
        actions.append("run_body_schedule_extractor")
    if not actions:
        actions.append("no_schedule_image_action")
    return ScheduleImageOcrNoticeReview(
        notice_id=next(iter(notice_ids)),
        image_count=len(image_reviews),
        admitted_schedule_image_count=admitted_count,
        non_schedule_visual_count=non_schedule_visual_count,
        rejected_schedule_candidate_count=rejected_schedule_count,
        body_schedule_candidate_count=body_candidate_count,
        recommended_actions=tuple(actions),
        images=image_reviews,
    )


def _review_notice_image(
    *,
    evidence: ScheduleImageOcrEvidence,
    result: ScheduleImageOcrProviderResult,
    decision: ScheduleImageOcrAdmissionDecision,
) -> ScheduleImageOcrNoticeImageReview:
    if decision.status == "admitted":
        return ScheduleImageOcrNoticeImageReview(
            notice_id=evidence.notice_id,
            attachment_ref_id=evidence.attachment_ref_id,
            image_index=evidence.image_index,
            admission_status=decision.status,
            admission_reason=decision.reason,
            image_role="schedule_table",
            rationale="admitted schedule OCR child document",
        )
    combined_text = _combined_text(evidence, result)
    visual_text = result.extracted_text or combined_text
    if _looks_like_non_schedule_visual(visual_text):
        return ScheduleImageOcrNoticeImageReview(
            notice_id=evidence.notice_id,
            attachment_ref_id=evidence.attachment_ref_id,
            image_index=evidence.image_index,
            admission_status=decision.status,
            admission_reason=decision.reason,
            image_role="non_schedule_visual",
            rationale="image appears to be a route map, boarding point photo, QR code, or guide",
        )
    if _looks_like_body_schedule_candidate(evidence):
        return ScheduleImageOcrNoticeImageReview(
            notice_id=evidence.notice_id,
            attachment_ref_id=evidence.attachment_ref_id,
            image_index=evidence.image_index,
            admission_status=decision.status,
            admission_reason=decision.reason,
            image_role="body_schedule_candidate",
            rationale="notice text contains explicit schedule times but image OCR has no table",
        )
    return ScheduleImageOcrNoticeImageReview(
        notice_id=evidence.notice_id,
        attachment_ref_id=evidence.attachment_ref_id,
        image_index=evidence.image_index,
        admission_status=decision.status,
        admission_reason=decision.reason,
        image_role="schedule_candidate_rejected",
        rationale="schedule candidate remains rejected after OCR admission checks",
    )


def _looks_like_non_schedule_visual(text: str) -> bool:
    compact_text = _compact(text)
    visual_hints = (
        "实景图",
        "路线图",
        "二维码",
        "乘车点",
        "乘车区",
        "上下车点",
        "候车区",
        "扫一扫",
        "扫码",
        "步行",
        "公共交通",
        "国家开放大学",
    )
    return any(hint in compact_text for hint in visual_hints) and not _TIME_RE.search(text)


def _looks_like_body_schedule_candidate(evidence: ScheduleImageOcrEvidence) -> bool:
    text = "\n".join((evidence.notice_title, evidence.context_before, evidence.context_after))
    if "专车" not in text:
        return False
    return bool(re.search(r"第[一二三四五六七八九十]+班\s*([01]?\d|2[0-3])[:：][0-5]\d", text))
