from __future__ import annotations

import re
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Literal

ScheduleNoticeScope = Literal[
    "body_schedule",
    "image_schedule",
    "mixed_schedule_and_visual",
    "guide_or_reservation_only",
    "not_schedule",
    "needs_review",
]
ScheduleNoticeImageAction = Literal[
    "body_schedule",
    "image_schedule_table",
    "visual_or_guide",
    "not_schedule",
    "needs_review",
]

_TRANSPORT_RE = re.compile(r"通勤班车|接驳车|班车|校车|专车|地铁接驳")
_BODY_BUS_SEQUENCE_RE = re.compile(r"第[一二三四五六七八九十]+班\s*([01]?\d|2[0-3])[:：][0-5]\d")
_TIME_RE = re.compile(r"(?<!\d)([01]?\d|2[0-3])[:：][0-5]\d(?!\d)")
_SCHEDULE_TABLE_RE = re.compile(
    r"班次表|班次信息如下|班次安排|班次调整情况|运行安排|安排如下|具体如下|具体见下表|具体如下表|发车时间"
)
_VISUAL_RE = re.compile(
    r"图\s*\d+|图\d+|实景图|路线图|乘车点|乘车区|候车区|上下车点|二维码|扫一扫|扫码|预约方式|乘车方式|我的预约"
)
_GUIDE_RE = re.compile(r"预约|扫码|扫一扫|乘车方式|我的预约|取消预约|违约|可预约资源")
_STOP_ONLY_RE = re.compile(r"暂停运营|停止运营")


@dataclass(frozen=True, slots=True)
class ScheduleNoticeImageRoutingInput:
    notice_id: str
    notice_title: str
    release_time: str
    organization: str
    image_index: int
    attachment_ref_id: str
    image_use: str
    context_before: str = ""
    context_after: str = ""
    reason_codes: tuple[str, ...] = ()
    raw_record: Mapping[str, object] | None = None


@dataclass(frozen=True, slots=True)
class ScheduleNoticeImageRoute:
    notice_id: str
    attachment_ref_id: str
    image_index: int
    notice_scope: ScheduleNoticeScope
    image_action: ScheduleNoticeImageAction
    should_run_image_ocr: bool
    should_run_body_extractor: bool
    confidence: str
    reason_codes: tuple[str, ...]
    matched_terms: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class ScheduleNoticeRoutingReport:
    image_count: int
    notice_count: int
    image_ocr_count: int
    body_schedule_count: int
    skipped_visual_count: int
    needs_review_count: int
    counts: Mapping[str, int]
    routes: tuple[ScheduleNoticeImageRoute, ...]


def route_schedule_notice_images(
    entries: Sequence[ScheduleNoticeImageRoutingInput],
) -> ScheduleNoticeRoutingReport:
    routes = tuple(route_schedule_notice_image(entry) for entry in entries)
    counts = Counter(route.image_action for route in routes)
    return ScheduleNoticeRoutingReport(
        image_count=len(routes),
        notice_count=len({route.notice_id for route in routes}),
        image_ocr_count=sum(1 for route in routes if route.should_run_image_ocr),
        body_schedule_count=sum(1 for route in routes if route.should_run_body_extractor),
        skipped_visual_count=counts.get("visual_or_guide", 0),
        needs_review_count=counts.get("needs_review", 0),
        counts=dict(sorted(counts.items())),
        routes=routes,
    )


def route_schedule_notice_image(
    entry: ScheduleNoticeImageRoutingInput,
) -> ScheduleNoticeImageRoute:
    text = _all_text(entry)
    near_before = _tail(entry.context_before)
    near_after = _head(entry.context_after)
    near_text = _compact_text(" ".join((near_before, near_after)))
    reason_codes: list[str] = []
    matched_terms: list[str] = []

    if not _has_transport_context(text):
        return _route(
            entry,
            notice_scope="not_schedule",
            image_action="not_schedule",
            reason_codes=("no_transport_schedule_context",),
        )

    if _has_body_schedule(text):
        reason_codes.append("body_bus_sequence")
        matched_terms.extend(_matches(_BODY_BUS_SEQUENCE_RE, text))
        return _route(
            entry,
            notice_scope="body_schedule",
            image_action="body_schedule",
            should_run_body_extractor=True,
            confidence="high",
            reason_codes=tuple(reason_codes),
            matched_terms=tuple(matched_terms),
        )

    has_visual_near = bool(_VISUAL_RE.search(near_text))
    has_schedule_near = bool(_SCHEDULE_TABLE_RE.search(near_text))
    has_schedule_anywhere = bool(_SCHEDULE_TABLE_RE.search(text))
    has_visual_anywhere = bool(_VISUAL_RE.search(text) or _GUIDE_RE.search(text))
    has_strong_visual_anchor = _has_strong_visual_anchor(entry)
    matched_terms.extend(_matches(_SCHEDULE_TABLE_RE, near_text))
    matched_terms.extend(_matches(_VISUAL_RE, near_text))

    if has_strong_visual_anchor or (has_visual_near and not has_schedule_near):
        return _route(
            entry,
            notice_scope="mixed_schedule_and_visual"
            if has_schedule_anywhere or entry.image_use == "mixed_schedule_and_guide_image"
            else "guide_or_reservation_only",
            image_action="visual_or_guide",
            confidence="high",
            reason_codes=("near_visual_anchor",),
            matched_terms=tuple(matched_terms),
        )

    if has_schedule_near or _image_use_says_schedule(entry):
        scope: ScheduleNoticeScope = (
            "mixed_schedule_and_visual" if has_visual_anywhere else "image_schedule"
        )
        return _route(
            entry,
            notice_scope=scope,
            image_action="image_schedule_table",
            should_run_image_ocr=True,
            confidence="high" if has_schedule_near else "medium",
            reason_codes=("near_schedule_table_anchor",)
            if has_schedule_near
            else ("image_use_schedule_candidate",),
            matched_terms=tuple(matched_terms),
        )

    if _STOP_ONLY_RE.search(text):
        return _route(
            entry,
            notice_scope="not_schedule",
            image_action="not_schedule",
            confidence="medium",
            reason_codes=("transport_stop_only_without_table",),
        )

    return _route(
        entry,
        notice_scope="needs_review",
        image_action="needs_review",
        confidence="low",
        reason_codes=("transport_context_without_clear_table_or_visual_anchor",),
        matched_terms=tuple(matched_terms),
    )


def build_schedule_routing_input_from_inventory_row(
    raw: Mapping[str, object],
) -> ScheduleNoticeImageRoutingInput:
    return ScheduleNoticeImageRoutingInput(
        notice_id=str(raw.get("notice_id") or "").strip(),
        notice_title=str(raw.get("notice_title") or "").strip(),
        release_time=str(raw.get("release_time") or "").strip(),
        organization=str(raw.get("organization") or "").strip(),
        image_index=_int(raw.get("image_index")),
        attachment_ref_id=_attachment_ref_id(raw),
        image_use=str(raw.get("image_use") or "").strip(),
        context_before=str(raw.get("context_before") or "").strip(),
        context_after=str(raw.get("context_after") or "").strip(),
        reason_codes=tuple(
            str(item).strip() for item in (raw.get("reason_codes") or ()) if str(item).strip()
        ),
        raw_record=raw,
    )


def _route(
    entry: ScheduleNoticeImageRoutingInput,
    *,
    notice_scope: ScheduleNoticeScope,
    image_action: ScheduleNoticeImageAction,
    should_run_image_ocr: bool = False,
    should_run_body_extractor: bool = False,
    confidence: str = "medium",
    reason_codes: tuple[str, ...],
    matched_terms: tuple[str, ...] = (),
) -> ScheduleNoticeImageRoute:
    return ScheduleNoticeImageRoute(
        notice_id=entry.notice_id,
        attachment_ref_id=entry.attachment_ref_id,
        image_index=entry.image_index,
        notice_scope=notice_scope,
        image_action=image_action,
        should_run_image_ocr=should_run_image_ocr,
        should_run_body_extractor=should_run_body_extractor,
        confidence=confidence,
        reason_codes=reason_codes,
        matched_terms=matched_terms,
    )


def _all_text(entry: ScheduleNoticeImageRoutingInput) -> str:
    return _compact_text(
        " ".join((entry.notice_title, entry.image_use, entry.context_before, entry.context_after))
    )


def _has_transport_context(text: str) -> bool:
    return bool(_TRANSPORT_RE.search(text))


def _has_body_schedule(text: str) -> bool:
    if not _BODY_BUS_SEQUENCE_RE.search(text):
        return False
    return "专车" in text or ("出发" in text and "接站" in text)


def _image_use_says_schedule(entry: ScheduleNoticeImageRoutingInput) -> bool:
    image_use = entry.image_use.strip()
    return image_use in {"schedule_table_image", "mixed_schedule_and_guide_image"}


def _has_strong_visual_anchor(entry: ScheduleNoticeImageRoutingInput) -> bool:
    before_tail = _tail(entry.context_before, size=100)
    after_head = _head(entry.context_after, size=140)
    near_text = _compact_text(" ".join((before_tail, after_head)))
    if re.search(r"^\s*图\s*\d+", after_head):
        return True
    if re.search(r"见\s*图\s*\d+", before_tail) and re.search(r"图\s*\d+", after_head):
        return True
    return bool(re.search(r"二维码|扫一扫|扫码|我的预约|接驳车预约", near_text)) and not bool(
        _SCHEDULE_TABLE_RE.search(before_tail)
    )


def _head(value: str, size: int = 180) -> str:
    return str(value or "").strip()[:size]


def _tail(value: str, size: int = 220) -> str:
    return str(value or "").strip()[-size:]


def _compact_text(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def _matches(pattern: re.Pattern[str], value: str) -> list[str]:
    return [match.group(0) for match in pattern.finditer(value)]


def _int(value: object) -> int:
    try:
        return int(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return 0


def _attachment_ref_id(raw: Mapping[str, object]) -> str:
    value = str(raw.get("attachment_ref_id") or "").strip()
    if value:
        return value
    attachment_id = str(raw.get("attachment_id") or "").strip()
    if attachment_id:
        return f"attachment-{attachment_id}"
    return f"image-{_int(raw.get('image_index'))}"


__all__ = [
    "ScheduleNoticeImageAction",
    "ScheduleNoticeImageRoute",
    "ScheduleNoticeImageRoutingInput",
    "ScheduleNoticeRoutingReport",
    "ScheduleNoticeScope",
    "build_schedule_routing_input_from_inventory_row",
    "route_schedule_notice_image",
    "route_schedule_notice_images",
]
