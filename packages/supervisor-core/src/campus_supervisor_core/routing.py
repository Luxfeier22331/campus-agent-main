from __future__ import annotations

import re
from dataclasses import dataclass

from campus_contracts import (
    CampusNoticeDiscoverPayload,
    CampusNoticeGetPayload,
    PlaceLookupPayload,
    RagRequestPayload,
    RequestedCapability,
    ServiceStatusLookupPayload,
    SpecialistTarget,
    SpecialistToolName,
    TemporalQuery,
    TransportRouteSelector,
    TransportScheduleLookupPayload,
    TransportServiceTimeQuery,
)
from campus_contracts.models import AllowedCorpus

from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.intent import IntentFrame, frame_intent
from campus_supervisor_core.query_policy import assert_scope_is_query_enabled
from campus_supervisor_core.validation import resolve_requested_capability

_TRANSPORT_KEYWORDS = ("校车", "班车", "通勤车", "接驳车")
_SERVICE_STATUS_KEYWORDS = (
    "开门",
    "开放",
    "营业",
    "办公时间",
    "开放时间",
    "开到几点",
    "状态",
)
_NOTICE_KEYWORDS = ("通知", "公告", "公示")
_NOTICE_GET_KEYWORDS = (
    "这条通知",
    "这则通知",
    "通知原文",
    "通知详情",
    "读取这条通知",
    "打开这条通知",
)
_YEAR_RE = re.compile(r"(20\d{2})年")


@dataclass(frozen=True, slots=True)
class RoutingDecision:
    target: SpecialistTarget | None
    primary_corpus: AllowedCorpus | None
    primary_collection: str | None
    intent_frame: IntentFrame
    specialist_payload: (
        RagRequestPayload
        | PlaceLookupPayload
        | ServiceStatusLookupPayload
        | TransportScheduleLookupPayload
        | CampusNoticeDiscoverPayload
        | CampusNoticeGetPayload
        | None
    ) = None
    allowed_tools: tuple[SpecialistToolName, ...] = ()


def classify_structured_runtime_candidate(
    context: SupervisorRequestContext,
) -> RoutingDecision | None:
    capability = resolve_requested_capability(context)
    if capability != "knowledge":
        return None
    if context.requested_scope is not None:
        return None
    if context.version_query.mode in {"historical", "compare"}:
        return None
    return _classify_structured_runtime_candidate(context, capability=capability)


def _classify_structured_runtime_candidate(
    context: SupervisorRequestContext,
    *,
    capability: RequestedCapability,
) -> RoutingDecision | None:
    intent_frame = frame_intent(context, capability=capability)
    if intent_frame.suggested_next_action != "delegate":
        return None

    normalized_goal = context.user_goal.strip()
    if capability in {"knowledge", "campus_services"} and _looks_like_transport_query(
        normalized_goal
    ):
        return RoutingDecision(
            target="campus-services-agent",
            primary_corpus=None,
            primary_collection=None,
            intent_frame=intent_frame,
            specialist_payload=TransportScheduleLookupPayload(
                query_text=context.user_goal,
                intent=_classify_transport_intent(normalized_goal),
                route_selector=_transport_route_selector_from_query(normalized_goal),
                snapshot_query=_temporal_query_from_context(context, normalized_goal),
                service_time_query=_transport_service_time_query_from_goal(normalized_goal),
            ),
            allowed_tools=("transport_schedule_lookup",),
        )
    if capability in {"knowledge", "campus_services"} and _looks_like_service_status_query(
        normalized_goal
    ):
        return RoutingDecision(
            target="campus-services-agent",
            primary_corpus=None,
            primary_collection=None,
            intent_frame=intent_frame,
            specialist_payload=ServiceStatusLookupPayload(
                subject_query=context.user_goal,
                temporal_query=_temporal_query_from_context(context, normalized_goal),
                campus_scope=_campus_scope_from_query(normalized_goal),
            ),
            allowed_tools=("service_status_lookup",),
        )
    if capability == "notice" or (
        capability == "knowledge" and _looks_like_notice_query(normalized_goal)
    ):
        selected_notice_ref = context.context.session.selected_notice_ref
        if selected_notice_ref is not None and _looks_like_notice_get_query(normalized_goal):
            payload = CampusNoticeGetPayload(
                notice_id=selected_notice_ref.notice_id,
                source_family=selected_notice_ref.source_family,
            )
            allowed_tools: tuple[SpecialistToolName, ...] = ("campus_notice_get",)
        else:
            payload = CampusNoticeDiscoverPayload(
                query_text=context.user_goal,
                temporal_query=_temporal_query_from_context(context, normalized_goal),
            )
            allowed_tools = ("campus_notice_discover",)
        return RoutingDecision(
            target="notice-agent",
            primary_corpus=None,
            primary_collection=None,
            intent_frame=intent_frame,
            specialist_payload=payload,
            allowed_tools=allowed_tools,
        )
    return None


def route_request(context: SupervisorRequestContext) -> RoutingDecision:
    capability = resolve_requested_capability(context)
    intent_frame = frame_intent(context, capability=capability)

    if intent_frame.suggested_next_action != "delegate":
        return RoutingDecision(
            target=None,
            primary_corpus=None,
            primary_collection=None,
            intent_frame=intent_frame,
        )

    if capability == "place_lookup":
        return RoutingDecision(
            target="navigation-agent",
            primary_corpus=None,
            primary_collection=None,
            intent_frame=intent_frame,
        )
    if capability in {"campus_services", "notice"}:
        structured_decision = _classify_structured_runtime_candidate(
            context,
            capability=capability,
        )
        if structured_decision is not None:
            return structured_decision
        return RoutingDecision(
            target=None,
            primary_corpus=None,
            primary_collection=None,
            intent_frame=intent_frame,
        )

    if context.requested_scope is not None:
        assert_scope_is_query_enabled(context.requested_scope)

    return RoutingDecision(
        target="rag-agent",
        primary_corpus=context.primary_corpus,
        primary_collection=context.primary_collection,
        intent_frame=intent_frame,
    )


def _looks_like_transport_query(user_goal: str) -> bool:
    return any(keyword in user_goal for keyword in _TRANSPORT_KEYWORDS)


def _looks_like_service_status_query(user_goal: str) -> bool:
    return any(keyword in user_goal for keyword in _SERVICE_STATUS_KEYWORDS)


def _looks_like_notice_query(user_goal: str) -> bool:
    return any(keyword in user_goal for keyword in _NOTICE_KEYWORDS)


def _looks_like_notice_get_query(user_goal: str) -> bool:
    return any(keyword in user_goal for keyword in _NOTICE_GET_KEYWORDS)


def _classify_transport_intent(user_goal: str) -> str:
    if "时刻表" in user_goal:
        if "最新" in user_goal or "最近" in user_goal:
            return "schedule_snapshot_metadata"
        return "timetable"
    if "最早" in user_goal:
        return "first_departure"
    if "最后" in user_goal or "最晚" in user_goal:
        return "last_departure"
    if "还有哪些" in user_goal or "哪些班次" in user_goal or "以后有哪些" in user_goal:
        return "departure_list"
    if "停运" in user_goal or "还跑不跑" in user_goal or "运营时间" in user_goal:
        return "service_window"
    return "next_departure"


def _transport_route_selector_from_query(user_goal: str) -> TransportRouteSelector | None:
    origin_campus = ""
    destination_campus = ""
    service_family = ""
    if "地铁" in user_goal:
        service_family = "metro_shuttle"
    elif "通勤车" in user_goal:
        service_family = "intercampus_commute"
    if "去丰台" in user_goal or "到丰台" in user_goal:
        destination_campus = "fengtai"
        if "海淀" in user_goal:
            origin_campus = "haidian"
    elif "回海淀" in user_goal or "到海淀" in user_goal:
        destination_campus = "haidian"
        if "丰台" in user_goal:
            origin_campus = "fengtai"
    if not any((origin_campus, destination_campus, service_family)):
        return None
    return TransportRouteSelector(
        service_family=service_family,
        origin_campus=origin_campus,
        destination_campus=destination_campus,
    )


def _transport_service_time_query_from_goal(
    user_goal: str,
) -> TransportServiceTimeQuery | None:
    if "时刻表" in user_goal and "明天" not in user_goal and "今天" not in user_goal:
        return None
    date_mode = "today"
    if "明天" in user_goal:
        date_mode = "tomorrow"
    year_match = _YEAR_RE.search(user_goal)
    if year_match and "今天" not in user_goal and "明天" not in user_goal:
        return None
    daypart = "all_day"
    if "早上" in user_goal or "上午" in user_goal:
        daypart = "morning"
    elif "下午" in user_goal:
        daypart = "afternoon"
    elif "晚上" in user_goal or "傍晚" in user_goal:
        daypart = "evening"
    return TransportServiceTimeQuery(date_mode=date_mode, daypart=daypart)


def _temporal_query_from_context(
    context: SupervisorRequestContext,
    user_goal: str,
) -> TemporalQuery:
    if context.version_query.mode == "as_of":
        return TemporalQuery(mode="as_of", as_of=context.version_query.as_of)
    year_match = _YEAR_RE.search(user_goal)
    if year_match is not None:
        return TemporalQuery(mode="current_year", year_hint=year_match.group(1))
    return TemporalQuery(mode="current")


def _campus_scope_from_query(user_goal: str) -> str:
    if "海淀" in user_goal:
        return "haidian"
    if "丰台" in user_goal:
        return "fengtai"
    return ""
