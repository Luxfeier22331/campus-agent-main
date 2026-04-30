from __future__ import annotations

import re
from collections.abc import Mapping
from datetime import date
from typing import Any

from campus_ingestion_core.collected_notice_media_role_classifier import (
    MEDIA_ROLE_SCHEDULE_TABLE_CARRIER,
    classify_notice_media_roles,
)
from campus_ingestion_core.notice_derived_transport_schedule_parsing import (
    _resolve_segment_service_date_ranges,
    _resolve_service_date_ranges,
)

TRANSPORT_SCHEDULE_TARGET = "transport_schedule"


def target_hints(unit: Mapping[str, Any]) -> list[str]:
    hints = unit.get("target_hints")
    if not isinstance(hints, Mapping):
        return []
    values = hints.get("candidate_targets")
    if not isinstance(values, list | tuple):
        return []
    return [str(value).strip() for value in values if str(value).strip()]


def multimodal_policy(unit: Mapping[str, Any]) -> str:
    status = str(unit.get("multimodal_status") or "")
    if status == "not_required":
        return "not_required"
    if status == "completed":
        return "completed"
    if status == "pending":
        return "pending"
    if status == "failed":
        return "failed"
    return "not_required"


def transport_baseline_policy(
    *,
    unit: Mapping[str, Any],
    generated_at: str,
    transport_baseline_effective_date: str,
    transport_baseline_source_notice_ids: tuple[str, ...],
    requires_schedule_image_ocr: bool,
) -> dict[str, Any]:
    baseline_date = _parse_iso_date(transport_baseline_effective_date)
    anchor_date = _parse_iso_date(generated_at) or date.today()
    service_date_ranges = _service_date_ranges(unit)
    release_date = _parse_iso_date(str(unit.get("published_at") or ""))
    policy_text = _policy_text(unit)
    baseline_status = "available" if baseline_date is not None else "missing"
    baseline_reason_codes: list[str] = []
    explicit_service_date_ranges = _explicit_service_date_ranges(unit)
    bounded_service_date_ranges = explicit_service_date_ranges or service_date_ranges
    source_notice_id = str(unit.get("source_notice_id") or "")

    if baseline_date is not None and source_notice_id in set(transport_baseline_source_notice_ids):
        temporal_relation = "baseline_source"
        overlay_kind = "covered_by_official_baseline"
        ocr_priority = "search_only"
        baseline_reason_codes.append("official_baseline_source_covered")
    elif baseline_date is None:
        temporal_relation = _window_temporal_relation(
            service_date_ranges=service_date_ranges,
            anchor_date=anchor_date,
        )
        overlay_kind = (
            "awaiting_baseline"
            if requires_schedule_image_ocr
            else _overlay_kind(
                service_date_ranges=service_date_ranges,
                policy_text=policy_text,
                fallback="manual_review",
            )
        )
        ocr_priority = "defer_until_baseline" if requires_schedule_image_ocr else "search_only"
        baseline_reason_codes.append("transport_baseline_missing")
        if requires_schedule_image_ocr:
            baseline_reason_codes.append("schedule_image_requires_ocr")
    elif release_date is not None and release_date < baseline_date:
        temporal_relation = "pre_baseline"
        overlay_kind = "historical_search_only"
        ocr_priority = "search_only"
        baseline_reason_codes.append("pre_baseline_historical_search_only")
    elif bounded_service_date_ranges and _looks_like_temporary_window(policy_text):
        temporal_relation = _window_temporal_relation(
            service_date_ranges=bounded_service_date_ranges,
            anchor_date=anchor_date,
        )
        overlay_kind = _overlay_kind(
            service_date_ranges=bounded_service_date_ranges,
            policy_text=policy_text,
            fallback="temporary_overlay",
        )
        ocr_priority = (
            "execute_now"
            if requires_schedule_image_ocr and temporal_relation == "active_or_future_window"
            else "search_only"
        )
        baseline_reason_codes.append("temporary_window_detected")
        if requires_schedule_image_ocr:
            baseline_reason_codes.append("schedule_image_requires_ocr")
    elif _looks_like_baseline_delta(policy_text):
        temporal_relation = "post_baseline"
        overlay_kind = "baseline_delta_candidate"
        ocr_priority = "execute_now" if requires_schedule_image_ocr else "search_only"
        baseline_reason_codes.append("post_baseline_delta_candidate")
        if requires_schedule_image_ocr:
            baseline_reason_codes.append("schedule_image_requires_ocr")
    elif bounded_service_date_ranges:
        temporal_relation = _window_temporal_relation(
            service_date_ranges=bounded_service_date_ranges,
            anchor_date=anchor_date,
        )
        overlay_kind = _overlay_kind(
            service_date_ranges=bounded_service_date_ranges,
            policy_text=policy_text,
            fallback="temporary_overlay",
        )
        ocr_priority = (
            "execute_now"
            if requires_schedule_image_ocr and temporal_relation == "active_or_future_window"
            else "search_only"
        )
        baseline_reason_codes.append("temporary_window_detected")
        if requires_schedule_image_ocr:
            baseline_reason_codes.append("schedule_image_requires_ocr")
    else:
        temporal_relation = "post_baseline" if release_date else "unknown"
        overlay_kind = "manual_review"
        ocr_priority = "manual_review" if requires_schedule_image_ocr else "search_only"
        baseline_reason_codes.append("manual_review_required")
        if requires_schedule_image_ocr:
            baseline_reason_codes.append("schedule_image_requires_ocr")

    return {
        "baseline_status": baseline_status,
        "baseline_effective_date": transport_baseline_effective_date if baseline_date else "",
        "temporal_relation": temporal_relation,
        "overlay_kind": overlay_kind,
        "ocr_priority": ocr_priority,
        "current_eligible": False,
        "baseline_gate_reason_codes": list(dict.fromkeys(baseline_reason_codes)),
    }


def requires_schedule_image_ocr(
    *,
    unit: Mapping[str, Any],
    multimodal_candidate_inventory: Mapping[str, Any],
    text_schedule_row_count: int = 0,
) -> bool:
    if text_schedule_row_count > 0:
        return False
    media_states = classify_notice_media_roles(
        unit=unit,
        multimodal_candidate_inventory=multimodal_candidate_inventory,
        target=TRANSPORT_SCHEDULE_TARGET,
        text_fact_complete=False,
    )
    if any(
        row.get("media_role") == MEDIA_ROLE_SCHEDULE_TABLE_CARRIER
        and row.get("media_state") in {"pending", "manual_review", "failed_retryable"}
        for row in media_states
    ):
        return True
    if multimodal_policy(unit) in {
        "pending",
        "failed",
    } and TRANSPORT_SCHEDULE_TARGET in target_hints(unit):
        return True
    unit_id = str(unit.get("unit_id") or "")
    for row in multimodal_candidate_inventory.get("candidates") or ():
        if not isinstance(row, Mapping):
            continue
        if str(row.get("unit_id") or "") != unit_id:
            continue
        status = str(row.get("status") or "")
        if status not in {"pending", "failed"}:
            continue
        processing_family = str(row.get("processing_family") or "")
        if processing_family == "schedule_image_ocr":
            return True
        if not processing_family and TRANSPORT_SCHEDULE_TARGET in target_hints(unit):
            return True
    return False


def _explicit_service_date_ranges(unit: Mapping[str, Any]) -> tuple[tuple[str, str], ...]:
    return _resolve_service_date_ranges(
        text=_policy_text(unit),
        release_time=str(unit.get("published_at") or ""),
    )


def _service_date_ranges(unit: Mapping[str, Any]) -> tuple[tuple[str, str], ...]:
    text = _policy_text(unit)
    release_time = str(unit.get("published_at") or "")
    ranged = _resolve_service_date_ranges(text=text, release_time=release_time)
    if ranged:
        return ranged
    return _resolve_segment_service_date_ranges(
        text=text,
        release_time=release_time,
        allow_open_ended_effective_date=False,
    )


def _window_temporal_relation(
    *,
    service_date_ranges: tuple[tuple[str, str], ...],
    anchor_date: date,
) -> str:
    if not service_date_ranges:
        return "unknown"
    latest_end = max(date.fromisoformat(end_date) for _start_date, end_date in service_date_ranges)
    return "expired_temporary_window" if latest_end < anchor_date else "active_or_future_window"


def _overlay_kind(
    *,
    service_date_ranges: tuple[tuple[str, str], ...],
    policy_text: str,
    fallback: str,
) -> str:
    if service_date_ranges:
        if any(keyword in policy_text for keyword in ("停运", "暂停", "停止", "不运行")):
            return "temporary_exception"
        return "temporary_overlay"
    if _looks_like_baseline_delta(policy_text):
        return "baseline_delta_candidate"
    return fallback


def _looks_like_baseline_delta(policy_text: str) -> bool:
    compact = "".join(policy_text.split())
    if "临时" in compact and not any(
        marker in compact for marker in ("起", "开始", "执行", "生效")
    ):
        return False
    return any(
        marker in compact
        for marker in (
            "起",
            "开始",
            "调整",
            "增加",
            "增开",
            "加开",
            "恢复",
            "优化",
            "变更",
        )
    )


def _looks_like_temporary_window(policy_text: str) -> bool:
    compact = "".join(policy_text.split())
    return any(marker in compact for marker in ("临时", "期间", "当天", "当日"))


def _policy_text(unit: Mapping[str, Any]) -> str:
    return "\n".join(
        str(unit.get(key) or "") for key in ("title", "body_text", "body_excerpt", "search_text")
    )


def _parse_iso_date(value: str) -> date | None:
    text = str(value or "").strip()
    if not text:
        return None
    match = re.search(r"20\d{2}-\d{1,2}-\d{1,2}", text)
    if not match:
        return None
    year_text, month_text, day_text = match.group(0).split("-")
    return date(int(year_text), int(month_text), int(day_text))


__all__ = [
    "multimodal_policy",
    "requires_schedule_image_ocr",
    "target_hints",
    "transport_baseline_policy",
]
