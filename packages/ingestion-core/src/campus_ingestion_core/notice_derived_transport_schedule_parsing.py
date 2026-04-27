from __future__ import annotations

import re
from collections.abc import Sequence
from datetime import date, datetime, time, timedelta, timezone

from campus_ingestion_core.transport_schedule_projection import (
    _calendar_matches,
    _date_range,
)
from campus_ingestion_core.transport_schedule_projection_routes import (
    route_by_id,
)

_SHANGHAI_TZ = timezone(timedelta(hours=8))
_TIME_RE = re.compile(r"(?<!\d)([01]?\d|2[0-3])[:：]([0-5]\d)(?!\d)")
_FULL_DATE_RE = re.compile(r"(20\d{2})[年\-/\.](\d{1,2})[月\-/\.](\d{1,2})日?")
_YEARLESS_EFFECTIVE_RE = re.compile(r"(?<!\d)(\d{1,2})月(\d{1,2})日[）)]?(?:起|开始|执行|生效)")
_YEARLESS_SINGLE_DATE_RE = re.compile(r"(?<!\d)(\d{1,2})月(\d{1,2})日")
_YEARLESS_MULTI_DAY_RE = re.compile(r"(?<!\d)(\d{1,2})月(\d{1,2})[、,，](\d{1,2})日")
_CHINESE_DATE_RANGE_RE = re.compile(
    r"(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日?\s*"
    r"(?:至|到|\-|—|~|～)\s*"
    r"(?:(20\d{2})年)?(\d{1,2})月(\d{1,2})日?"
)
_ORDINAL_RE = re.compile(r"^\d+[\.、]?$")
_BODY_TEXT_SPLIT_RE = re.compile(r"[\n。；;]")
_ONE_OFF_DATE_HINTS = ("本周", "周末", "临时", "当天", "当日")
_SERVICE_STOP_KEYWORDS = ("停运", "暂停", "停止运营", "不运行")


def _service_dates_for_row(
    *,
    row,
    anchor_date: date,
    service_horizon_days: int,
) -> list[str]:
    effective = date.fromisoformat(row.effective_from)
    horizon_dates = tuple(_date_range(max(anchor_date, effective), service_horizon_days))
    if not row.service_date_ranges:
        return [
            candidate.isoformat()
            for candidate in horizon_dates
            if _calendar_matches(candidate, row.weekday_scope)
        ]
    service_dates: list[str] = []
    for start_text, end_text in row.service_date_ranges:
        start_date = max(date.fromisoformat(start_text), effective)
        end_date = date.fromisoformat(end_text)
        if end_date < start_date:
            continue
        for candidate in _date_range(start_date, (end_date - start_date).days + 1):
            if candidate >= anchor_date and candidate not in horizon_dates:
                continue
            if _calendar_matches(candidate, row.weekday_scope):
                service_dates.append(candidate.isoformat())
    return sorted(dict.fromkeys(service_dates))


def _source_ref(entry) -> str:
    parts = str(entry.source_notice_document_id or "").split(":")
    if len(parts) == 3 and parts[0] == "notice":
        return entry.source_notice_document_id
    return f"notice:muc_internal_portal:{entry.source_notice_id}"


def _published_at(entry) -> str:
    return _parse_datetime(
        entry.source_notice_release_time or entry.updated_at,
        field_name="source_notice_release_time",
    ).isoformat()


def _snapshot_id(*, source_notice_id: str, published_at: str) -> str:
    published_date = _parse_datetime(published_at, field_name="published_at").date().isoformat()
    return f"snapshot:transport-schedule:{published_date}:{source_notice_id}"


def _start_of_day(value: str) -> str:
    return datetime.combine(date.fromisoformat(value), time.min, _SHANGHAI_TZ).isoformat()


def _effective_until_for_ranges(service_date_ranges: tuple[tuple[str, str], ...]) -> str:
    if not service_date_ranges:
        return ""
    latest_end = max(date.fromisoformat(end_date) for _start_date, end_date in service_date_ranges)
    return datetime.combine(latest_end + timedelta(days=1), time.min, _SHANGHAI_TZ).isoformat()


def _resolve_schedule_scope(
    *,
    parent_text: str,
    row_text: str,
    service_date_ranges: tuple[tuple[str, str], ...],
) -> str:
    combined = f"{parent_text}\n{row_text}"
    if any(keyword in combined for keyword in ("停运", "暂停", "不运行")):
        return "exception_status"
    if service_date_ranges:
        if any(keyword in combined for keyword in ("调整", "变更", "优化")):
            return "temporary_period_revision"
        return "temporary_period"
    return "baseline_revision"


def _schedule_scope_precedence(schedule_scope: str) -> int:
    return {
        "exception_status": 400,
        "temporary_period_revision": 300,
        "temporary_period": 250,
        "baseline_revision": 100,
    }.get(schedule_scope, 0)


def _resolve_service_date_ranges(
    *,
    text: str,
    release_time: str | None,
) -> tuple[tuple[str, str], ...]:
    release_year = _parse_datetime(
        release_time or datetime.now(_SHANGHAI_TZ).isoformat(),
        field_name="source_notice_release_time",
    ).year
    ranges: list[tuple[str, str]] = []
    for match in _CHINESE_DATE_RANGE_RE.finditer(text):
        start_year = int(match.group(1) or release_year)
        end_year = int(match.group(4) or start_year)
        start_date = date(start_year, int(match.group(2)), int(match.group(3)))
        end_date = date(end_year, int(match.group(5)), int(match.group(6)))
        if end_date < start_date and match.group(4) is None:
            end_date = date(start_year + 1, end_date.month, end_date.day)
        ranges.append((start_date.isoformat(), end_date.isoformat()))
    return tuple(dict.fromkeys(ranges))


def _resolve_segment_service_date_ranges(
    *,
    text: str,
    release_time: str | None,
    allow_open_ended_effective_date: bool,
) -> tuple[tuple[str, str], ...]:
    ranges = list(_resolve_service_date_ranges(text=text, release_time=release_time))
    release_year = _parse_datetime(
        release_time or datetime.now(_SHANGHAI_TZ).isoformat(),
        field_name="source_notice_release_time",
    ).year
    for match in _FULL_DATE_RE.finditer(text):
        value = date(int(match.group(1)), int(match.group(2)), int(match.group(3))).isoformat()
        ranges.append((value, value))
    for match in _YEARLESS_MULTI_DAY_RE.finditer(text):
        month = int(match.group(1))
        for day_text in (match.group(2), match.group(3)):
            value = date(release_year, month, int(day_text)).isoformat()
            ranges.append((value, value))
    should_use_yearless_single_date = allow_open_ended_effective_date or any(
        hint in text for hint in _ONE_OFF_DATE_HINTS
    )
    if should_use_yearless_single_date:
        for match in _YEARLESS_SINGLE_DATE_RE.finditer(text):
            value = date(release_year, int(match.group(1)), int(match.group(2))).isoformat()
            ranges.append((value, value))
    return tuple(dict.fromkeys(ranges))


def _resolve_effective_date(*, text: str, release_time: str | None) -> str:
    full_date = _first_full_date(text)
    if full_date is not None:
        return full_date.isoformat()
    release_year = _parse_datetime(
        release_time or datetime.now(_SHANGHAI_TZ).isoformat(),
        field_name="source_notice_release_time",
    ).year
    yearless_match = _YEARLESS_EFFECTIVE_RE.search(text)
    if yearless_match is not None:
        return date(
            release_year,
            int(yearless_match.group(1)),
            int(yearless_match.group(2)),
        ).isoformat()
    return (
        _parse_datetime(
            release_time or datetime.now(_SHANGHAI_TZ).isoformat(),
            field_name="source_notice_release_time",
        )
        .date()
        .isoformat()
    )


def _first_full_date(value: str) -> date | None:
    match = _FULL_DATE_RE.search(value)
    if match is None:
        return None
    return date(int(match.group(1)), int(match.group(2)), int(match.group(3)))


def _resolve_route(row_text: str):
    compact = "".join(row_text.split())
    fengtai_index = compact.find("丰台")
    wukesong_index = compact.find("五棵松")
    if fengtai_index >= 0 and wukesong_index >= 0:
        if fengtai_index < wukesong_index:
            return route_by_id("route:fengtai-to-wukesong-subway")
        return route_by_id("route:wukesong-subway-to-fengtai")
    haidian_index = compact.find("海淀")
    if haidian_index >= 0 and fengtai_index >= 0:
        if haidian_index < fengtai_index:
            return route_by_id("route:haidian-to-fengtai")
        return route_by_id("route:fengtai-to-haidian")
    if "接驳" in compact or "地铁" in compact:
        return route_by_id("route:subway-shuttle")
    return None


def _route_direction(route_id: str) -> str:
    return {
        "route:haidian-to-fengtai": "haidian_to_fengtai",
        "route:fengtai-to-haidian": "fengtai_to_haidian",
        "route:subway-shuttle": "subway_shuttle",
        "route:fengtai-to-wukesong-subway": "fengtai_to_wukesong_subway",
        "route:wukesong-subway-to-fengtai": "wukesong_subway_to_fengtai",
    }.get(route_id, route_id)


def _resolve_weekday_scope(row_text: str, default_calendar: str) -> str:
    if any(keyword in row_text for keyword in ("工作日", "周一至周五", "星期一至星期五")):
        return "weekdays"
    if any(keyword in row_text for keyword in ("周末", "周六", "周日", "星期六", "星期日")):
        return "weekends"
    if any(keyword in row_text for keyword in ("每日", "每天", "周一至周日")):
        return "daily"
    return default_calendar


def _resolve_rider_type(row_text: str) -> str:
    if "师生" in row_text:
        return "师生"
    if "学生" in row_text:
        return "学生"
    if "教师" in row_text or "教职工" in row_text:
        return "教师"
    return ""


def _resolve_remarks(row: Sequence[str]) -> str:
    values = [
        cell
        for cell in row
        if cell
        and not _TIME_RE.fullmatch(cell)
        and not _ORDINAL_RE.fullmatch(cell)
        and cell not in {"工作日", "周末", "每日", "每天"}
        and "校区" not in cell
        and "东门" not in cell
        and "南门" not in cell
        and cell not in {"学生", "教师", "师生", "教职工"}
    ]
    return "；".join(dict.fromkeys(values))


def _extract_times(value: str) -> tuple[str, ...]:
    return tuple(
        dict.fromkeys(
            f"{int(match.group(1)):02d}:{match.group(2)}" for match in _TIME_RE.finditer(value)
        )
    )


def _is_header_row(value: str) -> bool:
    return "发车时间" in value or ("运行方向" in value and "乘车" in value)


def _text_segments(value: str) -> tuple[str, ...]:
    return tuple(
        segment
        for segment in (_clean_cell(item) for item in _BODY_TEXT_SPLIT_RE.split(value))
        if segment
    )


def _parse_datetime(value: object, *, field_name: str) -> datetime:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    candidates = [normalized.replace("Z", "+00:00")]
    if " " in normalized and "T" not in normalized:
        candidates.append(normalized.replace(" ", "T"))
    for candidate in candidates:
        try:
            parsed = datetime.fromisoformat(candidate)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=_SHANGHAI_TZ)
            return parsed.astimezone(_SHANGHAI_TZ)
        except ValueError:
            pass
    for layout in ("%Y-%m-%d %H:%M", "%Y-%m-%d", "%Y/%m/%d %H:%M", "%Y/%m/%d"):
        try:
            return datetime.strptime(normalized, layout).replace(tzinfo=_SHANGHAI_TZ)
        except ValueError:
            pass
    raise ValueError(f"{field_name} must be an ISO datetime or local date/time")


def _clean_cell(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "").replace("：", ":")).strip()


def _coerce_int(value: object) -> int:
    try:
        return int(value or 0)
    except (TypeError, ValueError):
        return 0
