from __future__ import annotations

import re
from datetime import date, datetime, time, timedelta, timezone

from campus_ingestion_core.notice_derived_service_status_models import _ServiceStatusCandidate

_SHANGHAI_TZ = timezone(timedelta(hours=8))
_FULL_EFFECTIVE_DATE_RE = re.compile(
    r"(?:自|从)?(20\d{2})[年\-/\.](\d{1,2})[月\-/\.](\d{1,2})日?(?:起|开始|执行|生效)"
)
_YEARLESS_EFFECTIVE_DATE_RE = re.compile(
    r"(?<!\d)(\d{1,2})月(\d{1,2})日[）)]?(?:起|开始|执行|生效)"
)
_YEARLESS_DATE_RE = re.compile(r"(?<!\d)(\d{1,2})月(\d{1,2})日")
_MONTH_COLON_DAY_RE = re.compile(r"(?<!\d)(\d{1,2})月[:：]\s*(\d{1,2})日?")
_RANGE_SEPARATOR_RE = r"(?:至|到|-+|—+|－+)"
_FULL_DATETIME_RANGE_RE = re.compile(
    r"(20\d{2})年(\d{1,2})月(\d{1,2})日\s*([0-2]?\d)[:：]([0-5]\d)"
    rf"\s*{_RANGE_SEPARATOR_RE}\s*"
    r"(20\d{2})年(\d{1,2})月(\d{1,2})日\s*([0-2]?\d)[:：]([0-5]\d)"
)
_FULL_TO_YEARLESS_DATETIME_RANGE_RE = re.compile(
    r"(20\d{2})年(\d{1,2})月(\d{1,2})日\s*([0-2]?\d)[:：]([0-5]\d)"
    rf"\s*{_RANGE_SEPARATOR_RE}\s*"
    r"(\d{1,2})月(\d{1,2})日\s*([0-2]?\d)[:：]([0-5]\d)"
)
_YEARLESS_DATE_RANGE_WITH_TIME_RE = re.compile(
    rf"(?<!\d)(\d{{1,2}})月(\d{{1,2}})日\s*{_RANGE_SEPARATOR_RE}\s*"
    r"(\d{1,2})月(\d{1,2})日.*?([0-2]?\d)[:：]([0-5]\d)\s*"
    rf"{_RANGE_SEPARATOR_RE}\s*"
    r"([0-2]?\d)[:：]([0-5]\d)"
)
_FULL_TO_YEARLESS_DATE_RANGE_RE = re.compile(
    rf"(20\d{{2}})年(\d{{1,2}})月(\d{{1,2}})日\s*{_RANGE_SEPARATOR_RE}\s*"
    r"(\d{1,2})月(\d{1,2})日"
)
_YEARLESS_SAME_MONTH_DAY_RANGE_RE = re.compile(
    rf"(?<!\d)(\d{{1,2}})月(\d{{1,2}})日(?:[（(][^）)]*[）)])?\s*{_RANGE_SEPARATOR_RE}\s*"
    r"(\d{1,2})日"
)
_YEARLESS_DATE_RANGE_RE = re.compile(
    rf"(?<!\d)(\d{{1,2}})月(\d{{1,2}})日(?:[（(][^）)]*[）)])?\s*{_RANGE_SEPARATOR_RE}\s*"
    r"(\d{1,2})月(\d{1,2})日"
)
_RESTORE_YEARLESS_DATE_RE = re.compile(
    r"(?<!\d)(\d{1,2})月(\d{1,2})日[）)]?(?:起|开始)?[^，。；;]{0,8}?恢复"
)
_TIME_RANGE_RE = re.compile(
    rf"([0-2]?\d)[:：]([0-5]\d)\s*{_RANGE_SEPARATOR_RE}\s*([0-2]?\d)[:：]([0-5]\d)"
)


def _resolve_effective_date(text: str, release_dt: datetime) -> date:
    full_match = _FULL_EFFECTIVE_DATE_RE.search(text)
    if full_match is not None:
        return date(
            int(full_match.group(1)),
            int(full_match.group(2)),
            int(full_match.group(3)),
        )
    effective_match = _YEARLESS_EFFECTIVE_DATE_RE.search(text)
    if effective_match is not None:
        return _yearless_date(
            int(effective_match.group(1)),
            int(effective_match.group(2)),
            release_dt,
        )
    first_match = _YEARLESS_DATE_RE.search(text)
    if first_match is not None:
        return _yearless_date(
            int(first_match.group(1)),
            int(first_match.group(2)),
            release_dt,
        )
    month_colon_match = _MONTH_COLON_DAY_RE.search(text)
    if month_colon_match is not None:
        return _yearless_date(
            int(month_colon_match.group(1)),
            int(month_colon_match.group(2)),
            release_dt,
        )
    return release_dt.date()


def _resolve_restore_date(text: str, release_dt: datetime) -> date | None:
    match = _RESTORE_YEARLESS_DATE_RE.search(text)
    if match is None:
        return None
    return _yearless_date(int(match.group(1)), int(match.group(2)), release_dt)


def _resolve_datetime_window(text: str, release_dt: datetime) -> tuple[datetime, datetime] | None:
    full = _FULL_DATETIME_RANGE_RE.search(text)
    if full is not None:
        start = datetime(
            int(full.group(1)),
            int(full.group(2)),
            int(full.group(3)),
            int(full.group(4)),
            int(full.group(5)),
            tzinfo=_SHANGHAI_TZ,
        )
        end = datetime(
            int(full.group(6)),
            int(full.group(7)),
            int(full.group(8)),
            int(full.group(9)),
            int(full.group(10)),
            tzinfo=_SHANGHAI_TZ,
        )
        return (start, end) if end > start else None
    full_to_yearless = _FULL_TO_YEARLESS_DATETIME_RANGE_RE.search(text)
    if full_to_yearless is not None:
        start = datetime(
            int(full_to_yearless.group(1)),
            int(full_to_yearless.group(2)),
            int(full_to_yearless.group(3)),
            int(full_to_yearless.group(4)),
            int(full_to_yearless.group(5)),
            tzinfo=_SHANGHAI_TZ,
        )
        end_date = date(
            start.year,
            int(full_to_yearless.group(6)),
            int(full_to_yearless.group(7)),
        )
        if end_date < start.date():
            end_date = date(start.year + 1, end_date.month, end_date.day)
        end = datetime.combine(
            end_date,
            time(int(full_to_yearless.group(8)), int(full_to_yearless.group(9))),
            _SHANGHAI_TZ,
        )
        return (start, end) if end > start else None
    yearless = _YEARLESS_DATE_RANGE_WITH_TIME_RE.search(text)
    if yearless is not None:
        start_date = _yearless_date(int(yearless.group(1)), int(yearless.group(2)), release_dt)
        end_date = _yearless_date(int(yearless.group(3)), int(yearless.group(4)), release_dt)
        start = datetime.combine(
            start_date,
            time(int(yearless.group(5)), int(yearless.group(6))),
            _SHANGHAI_TZ,
        )
        end = datetime.combine(
            end_date,
            time(int(yearless.group(7)), int(yearless.group(8))),
            _SHANGHAI_TZ,
        )
        return (start, end) if end > start else None
    full_to_yearless_date = _FULL_TO_YEARLESS_DATE_RANGE_RE.search(text)
    if full_to_yearless_date is not None:
        start_date = date(
            int(full_to_yearless_date.group(1)),
            int(full_to_yearless_date.group(2)),
            int(full_to_yearless_date.group(3)),
        )
        end_date = date(
            start_date.year,
            int(full_to_yearless_date.group(4)),
            int(full_to_yearless_date.group(5)),
        )
        if end_date < start_date:
            end_date = date(start_date.year + 1, end_date.month, end_date.day)
        return _start_of_day(start_date), _start_of_day(end_date + timedelta(days=1))
    same_month_day_range = _YEARLESS_SAME_MONTH_DAY_RANGE_RE.search(text)
    if same_month_day_range is not None:
        start_date = _yearless_date(
            int(same_month_day_range.group(1)),
            int(same_month_day_range.group(2)),
            release_dt,
        )
        end_date = _yearless_date(
            int(same_month_day_range.group(1)),
            int(same_month_day_range.group(3)),
            release_dt,
        )
        return _start_of_day(start_date), _start_of_day(end_date + timedelta(days=1))
    yearless_date_range = _YEARLESS_DATE_RANGE_RE.search(text)
    if yearless_date_range is not None:
        start_date = _yearless_date(
            int(yearless_date_range.group(1)),
            int(yearless_date_range.group(2)),
            release_dt,
        )
        end_date = _yearless_date(
            int(yearless_date_range.group(3)),
            int(yearless_date_range.group(4)),
            release_dt,
        )
        return _start_of_day(start_date), _start_of_day(end_date + timedelta(days=1))
    restore = _resolve_restore_date(text, release_dt)
    if restore is not None:
        start_date = _resolve_effective_date_before_restore(text, release_dt)
        start = _start_of_day(start_date)
        end = _start_of_day(restore)
        return (start, end) if end > start else None
    if any(keyword in text for keyword in ("暂停办理", "暂停服务", "暂停开放", "暂停访问")):
        start = _start_of_day(_resolve_effective_date(text, release_dt))
        return start, start + timedelta(days=1)
    return None


def _resolve_service_counter_window(
    text: str, release_dt: datetime
) -> tuple[datetime, datetime] | None:
    restore = _resolve_restore_date(text, release_dt)
    if restore is not None:
        start_date = _resolve_effective_date_before_restore(text, release_dt)
        start_time, _ = _first_time_range(text) or (time.min, time.min)
        return datetime.combine(start_date, start_time, _SHANGHAI_TZ), _start_of_day(restore)
    if any(keyword in text for keyword in ("寒假", "暑假", "值班安排")):
        date_only_window = _resolve_date_only_window(text, release_dt)
        if date_only_window is not None:
            return date_only_window
    explicit_window = _resolve_datetime_window(text, release_dt)
    if explicit_window is not None:
        return explicit_window
    if any(keyword in text for keyword in ("增开", "正式开诊", "开诊时间")):
        start = _start_of_day(_resolve_effective_date(text, release_dt))
        if start.date() != release_dt.date() or any(
            keyword in text for keyword in ("自", "起", "开诊时间")
        ):
            return start, datetime(2099, 12, 31, 23, 59, 59, tzinfo=_SHANGHAI_TZ)
    return None


def _first_time_range(text: str) -> tuple[time, time] | None:
    match = _TIME_RANGE_RE.search(text)
    if match is None:
        return None
    start = time(int(match.group(1)), int(match.group(2)))
    end = time(int(match.group(3)), int(match.group(4)))
    return start, end


def _resolve_date_only_window(text: str, release_dt: datetime) -> tuple[datetime, datetime] | None:
    full_to_yearless_date = _FULL_TO_YEARLESS_DATE_RANGE_RE.search(text)
    if full_to_yearless_date is not None:
        start_date = date(
            int(full_to_yearless_date.group(1)),
            int(full_to_yearless_date.group(2)),
            int(full_to_yearless_date.group(3)),
        )
        end_date = date(
            start_date.year,
            int(full_to_yearless_date.group(4)),
            int(full_to_yearless_date.group(5)),
        )
        if end_date < start_date:
            end_date = date(start_date.year + 1, end_date.month, end_date.day)
        return _start_of_day(start_date), _start_of_day(end_date + timedelta(days=1))
    same_month_day_range = _YEARLESS_SAME_MONTH_DAY_RANGE_RE.search(text)
    if same_month_day_range is not None:
        start_date = _yearless_date(
            int(same_month_day_range.group(1)),
            int(same_month_day_range.group(2)),
            release_dt,
        )
        end_date = _yearless_date(
            int(same_month_day_range.group(1)),
            int(same_month_day_range.group(3)),
            release_dt,
        )
        return _start_of_day(start_date), _start_of_day(end_date + timedelta(days=1))
    yearless_date_range = _YEARLESS_DATE_RANGE_RE.search(text)
    if yearless_date_range is None:
        return None
    start_date = _yearless_date(
        int(yearless_date_range.group(1)),
        int(yearless_date_range.group(2)),
        release_dt,
    )
    end_date = _yearless_date(
        int(yearless_date_range.group(3)),
        int(yearless_date_range.group(4)),
        release_dt,
    )
    return _start_of_day(start_date), _start_of_day(end_date + timedelta(days=1))


def _yearless_date(month: int, day: int, release_dt: datetime) -> date:
    candidate = date(release_dt.year, month, day)
    if candidate < release_dt.date() - timedelta(days=180):
        candidate = date(release_dt.year + 1, month, day)
    return candidate


def _resolve_effective_date_before_restore(text: str, release_dt: datetime) -> date:
    restore_match = _RESTORE_YEARLESS_DATE_RE.search(text)
    prefix = text[: restore_match.start()] if restore_match is not None else text
    first_match = _YEARLESS_DATE_RE.search(prefix)
    if first_match is not None:
        return _yearless_date(int(first_match.group(1)), int(first_match.group(2)), release_dt)
    month_colon_match = _MONTH_COLON_DAY_RE.search(prefix)
    if month_colon_match is not None:
        return _yearless_date(
            int(month_colon_match.group(1)),
            int(month_colon_match.group(2)),
            release_dt,
        )
    return _resolve_effective_date(text, release_dt)


def _start_of_day(value: date) -> datetime:
    return datetime.combine(value, time.min, _SHANGHAI_TZ)


def _parse_release_time(value: str | None, generated_at: str) -> datetime:
    if value:
        return _parse_datetime(value, "source_notice_release_time")
    return _parse_datetime(generated_at, "generated_at")


def _parse_datetime(value: str, field_name: str) -> datetime:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    candidates = [normalized]
    if " " in normalized and "T" not in normalized:
        candidates.append(normalized.replace(" ", "T"))
    for candidate in candidates:
        try:
            parsed = datetime.fromisoformat(candidate)
            if parsed.tzinfo is None:
                parsed = parsed.replace(tzinfo=_SHANGHAI_TZ)
            return parsed.astimezone(_SHANGHAI_TZ)
        except ValueError:
            continue
    raise ValueError(f"{field_name} must be an ISO datetime")


def _effective_at(candidate: _ServiceStatusCandidate, generated_dt: datetime) -> bool:
    effective_until = _parse_datetime(candidate.effective_until, "effective_until")
    return generated_dt < effective_until
