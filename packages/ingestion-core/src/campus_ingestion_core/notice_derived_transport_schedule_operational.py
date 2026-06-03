from __future__ import annotations

from campus_ingestion_core.notice_consumption_projection import NoticeConsumptionProjectionEntry
from campus_ingestion_core.notice_derived_transport_schedule_constants import _MARKDOWN_HEADING_RE
from campus_ingestion_core.notice_derived_transport_schedule_models import (
    NoticeDerivedTransportOperationalNotice,
)
from campus_ingestion_core.notice_derived_transport_schedule_parsing import (
    _clean_cell,
    _resolve_effective_date,
    _resolve_route,
    _start_of_day,
    _text_segments,
)


def _extract_operational_notices_from_parent_text(
    *,
    parent_text: str,
    projection_entry: NoticeConsumptionProjectionEntry,
    source_ref: str,
) -> list[NoticeDerivedTransportOperationalNotice]:
    notices: list[NoticeDerivedTransportOperationalNotice] = []
    for segment in _text_segments(parent_text):
        if _MARKDOWN_HEADING_RE.match(segment):
            continue
        notice_kind = _operational_notice_kind(segment)
        if not notice_kind:
            continue
        route_ids = _operational_notice_route_ids(segment)
        if not route_ids:
            continue
        effective_from = _start_of_day(
            _resolve_effective_date(
                text=segment,
                release_time=projection_entry.source_notice_release_time,
            )
        )
        notices.append(
            NoticeDerivedTransportOperationalNotice(
                source_notice_id=projection_entry.source_notice_id,
                source_ref=source_ref,
                notice_kind=notice_kind,
                route_ids=route_ids,
                effective_from=effective_from,
                effective_until="",
                operational_comment=_clean_cell(segment),
            )
        )
    return notices


def _operational_notice_kind(segment: str) -> str:
    compact = "".join(str(segment or "").split())
    if not compact:
        return ""
    if not any(keyword in compact for keyword in ("调整", "更改", "变更", "迁至", "改为")):
        return ""
    if any(
        keyword in compact
        for keyword in ("乘车点", "乘车地点", "发车地点", "候车点", "站点", "上车点", "下车点")
    ):
        return "boarding_point_change"
    return ""


def _operational_notice_route_ids(segment: str) -> tuple[str, ...]:
    route = _resolve_route(segment)
    if route is not None:
        return (route.route_id,)
    compact = "".join(str(segment or "").split())
    if "通勤" in compact and "丰台" in compact:
        return ("route:fengtai-to-haidian",)
    if "通勤" in compact and "海淀" in compact:
        return ("route:haidian-to-fengtai",)
    if "接驳" in compact or "地铁" in compact:
        return ("route:subway-shuttle",)
    return ()
