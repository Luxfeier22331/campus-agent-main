from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Literal

_DATE_RE = re.compile(r"(?<!\d)(20\d{2})[年\-/\.](\d{1,2})[月\-/\.](\d{1,2})日?(?!\d)")


@dataclass(frozen=True, slots=True)
class TransportRouteSeed:
    route_id: str
    display_name: str
    service_family: str
    aliases: tuple[str, ...]
    origin_campus: str
    destination_campus: str
    origin_stop_id: str
    origin_stop_name: str
    origin_stop_aliases: tuple[str, ...]
    destination_stop_id: str
    destination_stop_name: str
    destination_stop_aliases: tuple[str, ...]
    default_calendar: Literal["weekdays", "daily"]


TRANSPORT_ROUTES: tuple[TransportRouteSeed, ...] = (
    TransportRouteSeed(
        route_id="route:haidian-to-fengtai",
        display_name="海淀到丰台通勤车",
        service_family="intercampus_commute",
        aliases=("海淀校区至丰台校区", "海淀至丰台", "海淀到丰台", "去丰台", "丰台线"),
        origin_campus="haidian",
        destination_campus="fengtai",
        origin_stop_id="stop:haidian-east-gate",
        origin_stop_name="海淀东门",
        origin_stop_aliases=("海淀东门", "海淀校区"),
        destination_stop_id="stop:fengtai-main-gate",
        destination_stop_name="丰台南门",
        destination_stop_aliases=("丰台南门", "丰台校区"),
        default_calendar="weekdays",
    ),
    TransportRouteSeed(
        route_id="route:fengtai-to-haidian",
        display_name="丰台到海淀通勤车",
        service_family="intercampus_commute",
        aliases=("丰台校区至海淀校区", "丰台至海淀", "丰台到海淀", "回海淀", "海淀线"),
        origin_campus="fengtai",
        destination_campus="haidian",
        origin_stop_id="stop:fengtai-main-gate",
        origin_stop_name="丰台南门",
        origin_stop_aliases=("丰台南门", "丰台校区"),
        destination_stop_id="stop:haidian-east-gate",
        destination_stop_name="海淀东门",
        destination_stop_aliases=("海淀东门", "海淀校区"),
        default_calendar="weekdays",
    ),
    TransportRouteSeed(
        route_id="route:subway-shuttle",
        display_name="地铁接驳车",
        service_family="subway_shuttle",
        aliases=("地铁接驳车", "接驳车", "地铁班车"),
        origin_campus="haidian",
        destination_campus="subway",
        origin_stop_id="stop:haidian-east-gate",
        origin_stop_name="海淀东门",
        origin_stop_aliases=("海淀东门", "海淀校区"),
        destination_stop_id="stop:subway-station",
        destination_stop_name="地铁站",
        destination_stop_aliases=("地铁站",),
        default_calendar="daily",
    ),
    TransportRouteSeed(
        route_id="route:fengtai-to-wukesong-subway",
        display_name="丰台到五棵松地铁接驳车",
        service_family="subway_shuttle",
        aliases=("丰台校区至五棵松地铁站", "丰台到五棵松", "五棵松方向接驳车"),
        origin_campus="fengtai",
        destination_campus="subway",
        origin_stop_id="stop:fengtai-juyacanting-parking-lot",
        origin_stop_name="丰台聚雅餐厅东侧停车场路口",
        origin_stop_aliases=("聚雅餐厅东侧停车场路口", "丰台校区"),
        destination_stop_id="stop:wukesong-subway-a-north",
        destination_stop_name="五棵松地铁站A口北侧国家开放大学东门口",
        destination_stop_aliases=("五棵松地铁站A口", "五棵松", "国家开放大学东门口"),
        default_calendar="daily",
    ),
    TransportRouteSeed(
        route_id="route:wukesong-subway-to-fengtai",
        display_name="五棵松到丰台地铁接驳车",
        service_family="subway_shuttle",
        aliases=("五棵松地铁站至丰台校区", "五棵松到丰台", "丰台方向接驳车"),
        origin_campus="subway",
        destination_campus="fengtai",
        origin_stop_id="stop:wukesong-subway-a-north",
        origin_stop_name="五棵松地铁站A口北侧国家开放大学东门口",
        origin_stop_aliases=("五棵松地铁站A口", "五棵松", "国家开放大学东门口"),
        destination_stop_id="stop:fengtai-juyacanting-parking-lot",
        destination_stop_name="丰台聚雅餐厅东侧停车场路口",
        destination_stop_aliases=("聚雅餐厅东侧停车场路口", "丰台校区"),
        default_calendar="daily",
    ),
    TransportRouteSeed(
        route_id="route:fengtai-to-libafang-subway",
        display_name="丰台到篱笆房地铁接驳车",
        service_family="subway_shuttle",
        aliases=(
            "丰台校区至篱笆房地铁站",
            "丰台校区→篱笆房地铁站",
            "丰台到篱笆房",
            "篱笆房方向接驳车",
        ),
        origin_campus="fengtai",
        destination_campus="subway",
        origin_stop_id="stop:fengtai-student-activity-center-west-parking-lot",
        origin_stop_name="丰台学生活动中心西侧停车场路口",
        origin_stop_aliases=("学生活动中心西侧停车场路口", "丰台校区"),
        destination_stop_id="stop:libafang-subway-b2",
        destination_stop_name="篱笆房地铁站B2口",
        destination_stop_aliases=("篱笆房地铁站 B2 口", "篱笆房地铁站B2口", "篱笆房"),
        default_calendar="daily",
    ),
    TransportRouteSeed(
        route_id="route:libafang-subway-to-fengtai",
        display_name="篱笆房到丰台地铁接驳车",
        service_family="subway_shuttle",
        aliases=(
            "篱笆房地铁站至丰台校区",
            "篱笆房地铁站→丰台校区",
            "篱笆房到丰台",
            "丰台方向接驳车",
        ),
        origin_campus="subway",
        destination_campus="fengtai",
        origin_stop_id="stop:libafang-subway-b2",
        origin_stop_name="篱笆房地铁站B2口",
        origin_stop_aliases=("篱笆房地铁站 B2 口", "篱笆房地铁站B2口", "篱笆房"),
        destination_stop_id="stop:fengtai-student-activity-center-west-parking-lot",
        destination_stop_name="丰台学生活动中心西侧停车场路口",
        destination_stop_aliases=("学生活动中心西侧停车场路口", "丰台校区"),
        default_calendar="daily",
    ),
    TransportRouteSeed(
        route_id="route:fengtai-to-zhangguozhuang-special-bus",
        display_name="丰台到张郭庄社会实践专车",
        service_family="temporary_special_bus",
        aliases=(
            "丰台校区至地铁14号线张郭庄站",
            "丰台校区至张郭庄站",
            "丰台到张郭庄",
            "社会实践专车出发",
        ),
        origin_campus="fengtai",
        destination_campus="subway",
        origin_stop_id="stop:fengtai-smart-center-south",
        origin_stop_name="丰台校区智慧中心南侧",
        origin_stop_aliases=("智慧中心南侧", "丰台校区 智慧中心南侧"),
        destination_stop_id="stop:zhangguozhuang-subway-14",
        destination_stop_name="地铁14号线张郭庄站",
        destination_stop_aliases=("张郭庄站", "张郭庄地铁站", "地铁14号线张郭庄站"),
        default_calendar="daily",
    ),
    TransportRouteSeed(
        route_id="route:yuanboyuan-to-fengtai-special-bus",
        display_name="园博园到丰台社会实践专车",
        service_family="temporary_special_bus",
        aliases=(
            "地铁14号线园博园站至丰台校区",
            "园博园站至丰台校区",
            "园博园到丰台",
            "社会实践专车接站",
        ),
        origin_campus="subway",
        destination_campus="fengtai",
        origin_stop_id="stop:yuanboyuan-subway-a-west-50m",
        origin_stop_name="园博园地铁站A出口右转西侧50米",
        origin_stop_aliases=("园博园地铁站A出口", "园博园站A口", "园博园站"),
        destination_stop_id="stop:fengtai-campus",
        destination_stop_name="丰台校区",
        destination_stop_aliases=("丰台校区",),
        default_calendar="daily",
    ),
)


def route_segments(text: str) -> list[tuple[TransportRouteSeed, str]]:
    matches: list[tuple[int, TransportRouteSeed]] = []
    for route in TRANSPORT_ROUTES:
        positions = [text.find(alias) for alias in route.aliases if alias in text]
        if positions:
            matches.append((min(position for position in positions if position >= 0), route))
    matches.sort(key=lambda item: item[0])
    segments: list[tuple[TransportRouteSeed, str]] = []
    for index, (start, route) in enumerate(matches):
        end = matches[index + 1][0] if index + 1 < len(matches) else len(text)
        segments.append((route, text[start:end]))
    return segments


def route_payload(route: TransportRouteSeed) -> dict[str, Any]:
    return {
        "route_id": route.route_id,
        "display_name": route.display_name,
        "service_family": route.service_family,
        "aliases": list(route.aliases),
        "origin_campus": route.origin_campus,
        "destination_campus": route.destination_campus,
        "stops": [
            {
                "stop_id": route.origin_stop_id,
                "display_name": route.origin_stop_name,
                "aliases": list(route.origin_stop_aliases),
            },
            {
                "stop_id": route.destination_stop_id,
                "display_name": route.destination_stop_name,
                "aliases": list(route.destination_stop_aliases),
            },
        ],
    }


def route_by_id(route_id: str) -> TransportRouteSeed:
    for route in TRANSPORT_ROUTES:
        if route.route_id == route_id:
            return route
    raise ValueError(f"unknown transport route: {route_id}")


def route_has_alias(route: TransportRouteSeed, text: str) -> bool:
    return any(alias in text for alias in route.aliases)


def exception_comment(text: str, route: TransportRouteSeed) -> str:
    for segment in re.split(r"[\n。；;]", text):
        if route_has_alias(route, segment) and _DATE_RE.search(segment):
            return segment.strip() + "。"
    return text.strip()
