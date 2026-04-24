from __future__ import annotations

from campus_contracts import ALLOWED_REQUESTED_CAPABILITIES, RequestedCapability

from campus_supervisor_core.context import SupervisorRequestContext
from campus_supervisor_core.errors import (
    InvalidSupervisorRequestError,
    MissingRoutingInputError,
    UnsupportedCapabilityError,
)


def resolve_requested_capability(context: SupervisorRequestContext) -> RequestedCapability:
    capability = context.requested_capability
    has_scope = context.requested_scope is not None
    has_non_current_version_query = context.version_query.mode != "current"

    if capability is None:
        if has_scope:
            return "knowledge"
        inferred_capability = infer_requested_capability_from_goal(context.user_goal)
        if inferred_capability == "place_lookup" and has_non_current_version_query:
            raise InvalidSupervisorRequestError(
                "version_query is not allowed for place_lookup requests"
            )
        return inferred_capability

    if capability not in ALLOWED_REQUESTED_CAPABILITIES:
        raise UnsupportedCapabilityError(f"unsupported requested_capability: {capability}")

    if capability == "knowledge":
        if not has_scope and not has_non_current_version_query:
            inferred_capability = infer_requested_capability_from_goal(context.user_goal)
            if inferred_capability == "place_lookup":
                return inferred_capability
        return capability

    if capability == "place_lookup":
        if has_scope:
            raise InvalidSupervisorRequestError(
                "requested_scope is not allowed for place_lookup requests"
            )
        if has_non_current_version_query:
            raise InvalidSupervisorRequestError(
                "version_query is not allowed for place_lookup requests"
            )
        return capability
    if capability in {"campus_services", "notice"}:
        if has_scope:
            raise InvalidSupervisorRequestError(
                "requested_scope is only allowed for knowledge requests"
            )
        if has_non_current_version_query:
            raise InvalidSupervisorRequestError(
                "version_query is only allowed for knowledge requests"
            )
        return capability
    raise MissingRoutingInputError(f"unsupported requested capability: {capability}")


_PLACE_LOOKUP_SIGNALS = (
    "在哪里",
    "在哪",
    "在哪儿",
    "怎么去",
    "怎么走",
    "位于哪里",
    "在什么地方",
    "在哪个门",
    "从哪个门进",
    "位置在哪",
)
_PLACE_ENTITY_SIGNALS = (
    "图书馆",
    "食堂",
    "会议室",
    "教学楼",
    "宿舍",
    "校医院",
    "博物馆",
    "办公楼",
    "学院楼",
    "校门",
    "操场",
    "体育馆",
    "办公室",
    "办事大厅",
    "服务大厅",
)
_PLACE_LOCATION_NOUN_SIGNALS = (
    "位置",
    "地址",
)
_NON_SPATIAL_WHERE_ACTION_SIGNALS = (
    "在哪里申请",
    "在哪申请",
    "在哪儿申请",
    "在哪里办理",
    "在哪办理",
    "在哪儿办理",
    "在哪里报名",
    "在哪报名",
    "在哪儿报名",
    "在哪里提交",
    "在哪提交",
    "在哪儿提交",
    "在哪里查看",
    "在哪查看",
    "在哪儿查看",
    "在哪里查询",
    "在哪查询",
    "在哪儿查询",
    "在哪里看",
    "在哪看",
    "在哪儿看",
)


def infer_requested_capability_from_goal(user_goal: str) -> RequestedCapability:
    normalized_goal = "".join(user_goal.split()).casefold()
    if _looks_like_non_spatial_where_action(normalized_goal):
        return "knowledge"
    if any(signal in normalized_goal for signal in _PLACE_LOOKUP_SIGNALS) and _has_place_context(
        normalized_goal
    ):
        return "place_lookup"
    if any(entity in normalized_goal for entity in _PLACE_ENTITY_SIGNALS) and any(
        signal in normalized_goal for signal in _PLACE_LOCATION_NOUN_SIGNALS
    ):
        return "place_lookup"
    return "knowledge"


def _has_place_context(normalized_goal: str) -> bool:
    return any(entity in normalized_goal for entity in _PLACE_ENTITY_SIGNALS)


def _looks_like_non_spatial_where_action(normalized_goal: str) -> bool:
    return any(signal in normalized_goal for signal in _NON_SPATIAL_WHERE_ACTION_SIGNALS)
