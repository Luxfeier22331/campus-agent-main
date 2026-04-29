from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

ScheduleBodyExtractionStatus = Literal["extracted", "no_schedule_body"]

_TIME_RE = re.compile(r"(?<!\d)([01]?\d|2[0-3])[:：]([0-5]\d)(?!\d)")
_BUS_SEQUENCE_RE = re.compile(
    r"(?P<label>第[一二三四五六七八九十]+班)\s*"
    r"(?P<hour>[01]?\d|2[0-3])[:：](?P<minute>[0-5]\d)"
)
_DIRECTION_SECTION_RE = re.compile(
    r"(?:\d+[.、]\s*)?(?P<label>出发|接站|返程|去程)\s*[:：]\s*"
    r"(?P<body>.*?)(?=(?:\d+[.、]\s*)?(?:出发|接站|返程|去程)\s*[:：]|三、|四、|$)",
    re.S,
)
_LOCATION_SECTION_RE = re.compile(
    r"乘车地点[:：]?\s*(?P<body>.*?)(?=乘车方式|预约|特此通知|$)",
    re.S,
)
_ROUTE_SECTION_RE = re.compile(
    r"运行区间[:：]?\s*(?P<body>.*?)(?=(?:[一二三四五六七八九十]+、\s*)?运行时间|二、|三、|$)",
    re.S,
)
_LOCATION_ITEM_RE = re.compile(
    r"(?:\d+[.、]\s*)?(?P<label>出发|接站|返程|去程)\s*[:：]\s*"
    r"(?P<body>.*?)(?=(?:\d+[.、]\s*)?(?:出发|接站|返程|去程)\s*[:：]|$)",
    re.S,
)
_SERVICE_WINDOW_RE = re.compile(
    r"\d{1,2}月\d{1,2}日(?:[（(][^）)]{1,12}[）)])?\s*"
    r"(?:-|—|至|到)\s*"
    r"(?:\d{1,2}月)?\d{1,2}日(?:[（(][^）)]{1,12}[）)])?"
    r"(?:之间|期间)?"
)
_SERVICE_SINGLE_DATE_RE = re.compile(
    r"(?:本周|周末|临时|当天|当日)[^。；;\n]{0,20}?"
    r"(?P<date>\d{1,2}月\d{1,2}日)"
)
_ONE_OFF_ROUTE_RE = re.compile(
    r"(?P<route>(?:海淀|丰台)校区[”\"]?\s*(?:发往|开往|至|到)\s*[“\"]?"
    r"(?:海淀|丰台)校区).*?"
    r"(?:临时)?(?:增加|增开|加开)\s*(?:一趟|1趟|一班|1班)?\s*"
    r"(?P<hour>[01]?\d|2[0-3])[:：](?P<minute>[0-5]\d)",
    re.S,
)


@dataclass(frozen=True, slots=True)
class ScheduleNoticeBody:
    notice_id: str
    notice_title: str
    release_time: str
    organization: str
    context_before: str
    context_after: str


@dataclass(frozen=True, slots=True)
class ScheduleNoticeBodyExtraction:
    notice_id: str
    status: ScheduleBodyExtractionStatus
    source: str
    service_window: str
    rows: tuple[dict[str, str], ...]


def extract_schedule_from_notice_body(
    body: ScheduleNoticeBody,
) -> ScheduleNoticeBodyExtraction:
    text = _normalize_text("\n".join((body.notice_title, body.context_before, body.context_after)))
    routes = _extract_direction_routes(text)
    locations = _extract_direction_locations(text)
    rows: list[dict[str, str]] = []
    for section in _DIRECTION_SECTION_RE.finditer(text):
        direction_label = section.group("label")
        section_body = section.group("body")
        for match in _BUS_SEQUENCE_RE.finditer(section_body):
            rows.append(
                {
                    "notice_id": body.notice_id,
                    "direction_label": direction_label,
                    "route_text": routes.get(direction_label, ""),
                    "sequence_label": match.group("label"),
                    "departure_time": f"{int(match.group('hour')):02d}:{match.group('minute')}",
                    "boarding_location": locations.get(direction_label, ""),
                }
            )
    rows.extend(_extract_one_off_route_rows(text, body.notice_id))
    if not rows:
        return ScheduleNoticeBodyExtraction(
            notice_id=body.notice_id,
            status="no_schedule_body",
            source="authenticated_notice_body",
            service_window="",
            rows=(),
        )
    return ScheduleNoticeBodyExtraction(
        notice_id=body.notice_id,
        status="extracted",
        source="authenticated_notice_body",
        service_window=_extract_service_window(text),
        rows=tuple(rows),
    )


def _extract_one_off_route_rows(text: str, notice_id: str) -> tuple[dict[str, str], ...]:
    rows: list[dict[str, str]] = []
    for match in _ONE_OFF_ROUTE_RE.finditer(text):
        rows.append(
            {
                "notice_id": notice_id,
                "direction_label": "临时增加",
                "route_text": _clean_route_text(match.group("route")),
                "sequence_label": "临时增加班次",
                "departure_time": f"{int(match.group('hour')):02d}:{match.group('minute')}",
                "boarding_location": "",
            }
        )
    return tuple(rows)


def _extract_direction_routes(text: str) -> dict[str, str]:
    routes: dict[str, str] = {}
    section = _ROUTE_SECTION_RE.search(text)
    if section is None:
        return routes
    route_body = section.group("body")
    for item in _LOCATION_ITEM_RE.finditer(route_body):
        routes[item.group("label")] = _clean_route_text(item.group("body"))
    return routes


def _extract_direction_locations(text: str) -> dict[str, str]:
    locations: dict[str, str] = {}
    section = _LOCATION_SECTION_RE.search(text)
    if section is None:
        return locations
    location_body = section.group("body")
    for item in _LOCATION_ITEM_RE.finditer(location_body):
        locations[item.group("label")] = _clean_location(item.group("body"))
    return locations


def _extract_service_window(text: str) -> str:
    match = _SERVICE_WINDOW_RE.search(text)
    if match:
        return match.group(0)
    single_date_match = _SERVICE_SINGLE_DATE_RE.search(text)
    return single_date_match.group("date") if single_date_match else ""


def _normalize_text(text: str) -> str:
    return re.sub(r"\s+", " ", text or "").strip()


def _clean_route_text(text: str) -> str:
    value = re.sub(r"\s+", " ", text or "").strip()
    value = re.sub(r"(?:二、|运行时间).*$", "", value).strip()
    return value.rstrip("。；;，, ")


def _clean_location(text: str) -> str:
    value = re.sub(r"\s+", " ", text or "").strip()
    value = re.sub(r"(?:四、|乘车方式).*$", "", value).strip()
    value = re.sub(r"\d{1,2}月\d{1,2}日.*$", "", value).strip()
    return value.rstrip("。；;，, ")


__all__ = [
    "ScheduleBodyExtractionStatus",
    "ScheduleNoticeBody",
    "ScheduleNoticeBodyExtraction",
    "extract_schedule_from_notice_body",
]
