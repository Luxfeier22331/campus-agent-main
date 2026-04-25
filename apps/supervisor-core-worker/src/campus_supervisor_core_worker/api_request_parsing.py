from __future__ import annotations

from dataclasses import dataclass

from campus_contracts import (
    ALLOWED_REQUESTED_CAPABILITIES,
    ActorContext,
    AuthorizationProjection,
    AuthorizedRetrievalFilter,
    CampusNoticeDiscoverPayload,
    CampusNoticeGetPayload,
    ContextProjection,
    KnowledgeScope,
    ProfileMemoryItem,
    ProfileMemorySummary,
    RagRequestPayload,
    ServiceStatusLookupPayload,
    SessionSlot,
    SessionSummary,
    SpecialistRequest,
    SupervisorRequest,
    TemporalQuery,
    TraceContext,
    TransportRouteSelector,
    TransportScheduleLookupPayload,
    TransportServiceTimeQuery,
    VersionQuery,
)


@dataclass(frozen=True, slots=True)
class BridgeSupervisorEnvelope:
    request: SupervisorRequest
    specialist_request: SpecialistRequest | None = None


def _parse_bridge_supervisor_request(payload: dict[str, object]) -> SupervisorRequest:
    return _parse_bridge_supervisor_envelope(payload).request


def _parse_bridge_supervisor_envelope(payload: dict[str, object]) -> BridgeSupervisorEnvelope:
    _require_bridge_version(payload.get("bridge_version"))
    effective_capability = _parse_effective_capability(payload)
    lane = _require_string(payload.get("lane"), field_name="lane")
    request = SupervisorRequest(
        user_goal=_require_string(payload.get("user_goal"), field_name="user_goal"),
        conversation_id=_parse_optional_string(payload.get("conversation_id")) or "",
        request_id=_require_string(payload.get("request_id"), field_name="request_id"),
        safety_identifier=_parse_optional_string(payload.get("safety_identifier")),
        trace=_parse_trace_context(payload.get("trace")),
        actor=_parse_actor_context(payload.get("actor"), field_prefix="actor"),
        context=_parse_bridge_context_projection(payload.get("context")),
        requested_capability=effective_capability,
        requested_scope=_parse_requested_scope(payload.get("requested_scope")),
        version_query=_parse_version_query(
            _require_object(payload.get("version_query"), field_name="version_query")
        ),
    )
    runtime_specialist_request = _parse_runtime_decisions(
        payload.get("runtime_decisions"),
        effective_capability=effective_capability,
        lane=lane,
        request=request,
    )
    return BridgeSupervisorEnvelope(
        request=request,
        specialist_request=runtime_specialist_request,
    )


def _require_bridge_version(raw_version: object) -> None:
    bridge_version = _require_string(raw_version, field_name="bridge_version")
    if bridge_version != "supervisor_bridge_v4":
        raise ValueError("bridge_version must be supervisor_bridge_v4")


def _parse_effective_capability(payload: dict[str, object]) -> str:
    effective_capability = _parse_requested_capability(payload.get("effective_capability"))
    if effective_capability is None:
        raise ValueError("effective_capability must be a non-empty string")
    if effective_capability not in ALLOWED_REQUESTED_CAPABILITIES:
        raise ValueError(f"unsupported effective_capability: {effective_capability}")
    requested_capability = _parse_requested_capability(payload.get("requested_capability"))
    if requested_capability is not None and requested_capability != effective_capability:
        raise ValueError("requested_capability must match effective_capability")
    return effective_capability


def _parse_runtime_decisions(
    raw_decisions: object,
    *,
    effective_capability: str,
    lane: str,
    request: SupervisorRequest,
) -> SpecialistRequest:
    decisions = _require_object(raw_decisions, field_name="runtime_decisions")
    decision_capability = _require_string(
        decisions.get("effective_capability"),
        field_name="runtime_decisions.effective_capability",
    )
    decision_lane = _require_string(
        decisions.get("lane"),
        field_name="runtime_decisions.lane",
    )
    if decision_capability != effective_capability:
        raise ValueError("runtime_decisions.effective_capability must match effective_capability")
    if decision_lane != lane:
        raise ValueError("runtime_decisions.lane must match lane")
    suggested_next_action = _parse_routing_frame(
        decisions.get("routing_frame"),
        effective_capability=effective_capability,
    )
    raw_handoff = decisions.get("handoff")
    if raw_handoff is None:
        raise ValueError("runtime_decisions.handoff must be present for Python delegate bridge")
    if suggested_next_action != "delegate":
        raise ValueError("Python delegate bridge only accepts delegate routing frames")
    handoff = _require_object(raw_handoff, field_name="runtime_decisions.handoff")
    planning_outcome = _parse_optional_string(handoff.get("planning_outcome"))
    if planning_outcome != "preplanned":
        raise ValueError("runtime_decisions.handoff.planning_outcome must be preplanned")
    target = _require_string(
        handoff.get("target"),
        field_name="runtime_decisions.handoff.target",
    )
    allowed_tools = _parse_string_tuple(
        handoff.get("allowed_tools"),
        field_name="runtime_decisions.handoff.allowed_tools",
    )
    specialist_request = _parse_specialist_request(
        handoff.get("specialist_request"),
        expected_target=target,
        expected_allowed_tools=allowed_tools,
    )
    _assert_specialist_request_matches_supervisor_request(specialist_request, request)
    return specialist_request


def _parse_routing_frame(raw_frame: object, *, effective_capability: str) -> str:
    frame = _require_object(raw_frame, field_name="runtime_decisions.routing_frame")
    capability = _require_string(
        frame.get("capability"),
        field_name="runtime_decisions.routing_frame.capability",
    )
    if capability != effective_capability:
        raise ValueError(
            "runtime_decisions.routing_frame.capability must match effective_capability"
        )
    _require_string(
        frame.get("task_kind"),
        field_name="runtime_decisions.routing_frame.task_kind",
    )
    _parse_string_tuple(
        frame.get("domain_candidates"),
        field_name="runtime_decisions.routing_frame.domain_candidates",
    )
    _parse_string_tuple(
        frame.get("missing_slots"),
        field_name="runtime_decisions.routing_frame.missing_slots",
    )
    _require_string(
        frame.get("risk_level"),
        field_name="runtime_decisions.routing_frame.risk_level",
    )
    _require_bool(
        frame.get("needs_clarification"),
        field_name="runtime_decisions.routing_frame.needs_clarification",
    )
    suggested_next_action = _require_string(
        frame.get("suggested_next_action"),
        field_name="runtime_decisions.routing_frame.suggested_next_action",
    )
    _parse_string_dict(
        frame.get("resolved_slots"),
        field_name="runtime_decisions.routing_frame.resolved_slots",
    )
    return suggested_next_action


def _parse_specialist_request(
    raw_request: object,
    *,
    expected_target: str,
    expected_allowed_tools: tuple[str, ...],
) -> SpecialistRequest:
    request = _require_object(
        raw_request,
        field_name="runtime_decisions.handoff.specialist_request",
    )
    target = _require_string(
        request.get("target"),
        field_name="runtime_decisions.handoff.specialist_request.target",
    )
    if target != expected_target:
        raise ValueError("runtime_decisions.handoff.specialist_request.target must match target")
    allowed_tools = _parse_string_tuple(
        request.get("allowed_tools"),
        field_name="runtime_decisions.handoff.specialist_request.allowed_tools",
    )
    if allowed_tools != expected_allowed_tools:
        raise ValueError(
            "runtime_decisions.handoff.specialist_request.allowed_tools must match allowed_tools"
        )
    payload_envelope = _require_object(
        request.get("payload"),
        field_name="runtime_decisions.handoff.specialist_request.payload",
    )
    payload_kind = _require_string(
        payload_envelope.get("kind"),
        field_name="runtime_decisions.handoff.specialist_request.payload.kind",
    )
    payload = _require_object(
        payload_envelope.get("payload"),
        field_name="runtime_decisions.handoff.specialist_request.payload.payload",
    )
    return SpecialistRequest(
        target=target,  # type: ignore[arg-type]
        user_goal=_require_string(
            request.get("user_goal"),
            field_name="runtime_decisions.handoff.specialist_request.user_goal",
        ),
        conversation_id=(_parse_optional_string(request.get("conversation_id")) or ""),
        request_id=_require_string(
            request.get("request_id"),
            field_name="runtime_decisions.handoff.specialist_request.request_id",
        ),
        safety_identifier=_parse_optional_string(request.get("safety_identifier")),
        trace=_parse_trace_context(request.get("trace")),
        actor=_parse_actor_context(
            request.get("actor"),
            field_prefix="runtime_decisions.handoff.specialist_request.actor",
        ),
        context=_parse_bridge_context_projection(request.get("context")),
        payload=_parse_payload_by_kind(payload_kind, payload),
        allowed_tools=allowed_tools,  # type: ignore[arg-type]
    )


def _assert_specialist_request_matches_supervisor_request(
    specialist_request: SpecialistRequest,
    request: SupervisorRequest,
) -> None:
    if specialist_request.user_goal != request.user_goal:
        raise ValueError(
            "runtime_decisions.handoff.specialist_request.user_goal must match user_goal"
        )
    if specialist_request.conversation_id != request.conversation_id:
        raise ValueError(
            "runtime_decisions.handoff.specialist_request.conversation_id must match conversation_id"
        )
    if specialist_request.request_id != request.request_id:
        raise ValueError(
            "runtime_decisions.handoff.specialist_request.request_id must match request_id"
        )
    if specialist_request.safety_identifier != request.safety_identifier:
        raise ValueError(
            "runtime_decisions.handoff.specialist_request.safety_identifier must match safety_identifier"
        )
    if specialist_request.trace.trace_id != request.trace.trace_id:
        raise ValueError(
            "runtime_decisions.handoff.specialist_request.trace.trace_id must match trace.trace_id"
        )
    if specialist_request.context != request.context:
        raise ValueError("runtime_decisions.handoff.specialist_request.context must match context")


def _require_object(raw_value: object, *, field_name: str) -> dict[str, object]:
    if not isinstance(raw_value, dict):
        raise ValueError(f"{field_name} must be an object")
    return raw_value


def _parse_payload_by_kind(
    payload_kind: str,
    payload: dict[str, object],
) -> (
    TransportScheduleLookupPayload
    | ServiceStatusLookupPayload
    | CampusNoticeDiscoverPayload
    | CampusNoticeGetPayload
    | RagRequestPayload
):
    if payload_kind == "rag_request":
        return RagRequestPayload(
            scope=_parse_requested_scope(payload.get("scope")),
            version_query=_parse_version_query(payload.get("version_query")),
        )
    if payload_kind == "transport_schedule_lookup":
        route_selector = payload.get("route_selector")
        service_time_query = payload.get("service_time_query")
        return TransportScheduleLookupPayload(
            query_text=_require_string(payload.get("query_text"), field_name="query_text"),
            intent=_require_string(payload.get("intent"), field_name="intent"),
            route_selector=(
                None
                if route_selector is None
                else TransportRouteSelector(
                    **_require_object(route_selector, field_name="route_selector")
                )
            ),
            snapshot_query=_parse_temporal_query(payload.get("snapshot_query")),
            service_time_query=(
                None
                if service_time_query is None
                else TransportServiceTimeQuery(
                    **_require_object(service_time_query, field_name="service_time_query")
                )
            ),
            result_limit=_parse_optional_int(payload.get("result_limit")),
        )
    if payload_kind == "service_status_lookup":
        return ServiceStatusLookupPayload(
            subject_query=_require_string(payload.get("subject_query"), field_name="subject_query"),
            temporal_query=_parse_temporal_query(payload.get("temporal_query")),
            campus_scope=_parse_optional_string(payload.get("campus_scope")) or "",
        )
    if payload_kind == "campus_notice_discover":
        return CampusNoticeDiscoverPayload(
            query_text=_require_string(payload.get("query_text"), field_name="query_text"),
            temporal_query=_parse_temporal_query(payload.get("temporal_query")),
            source_families=_parse_string_tuple(
                payload.get("source_families"),
                field_name="source_families",
            ),
            target_surfaces=_parse_string_tuple(
                payload.get("target_surfaces"),
                field_name="target_surfaces",
            ),
            max_results=_parse_optional_int(payload.get("max_results")) or 5,
        )
    if payload_kind == "campus_notice_get":
        return CampusNoticeGetPayload(
            notice_id=_require_string(payload.get("notice_id"), field_name="notice_id"),
            source_family=_parse_optional_string(payload.get("source_family")) or "",
        )
    raise ValueError(f"unsupported preplanned specialist payload kind: {payload_kind}")


def _parse_temporal_query(raw_query: object) -> TemporalQuery:
    if raw_query is None:
        return TemporalQuery()
    query = _require_object(raw_query, field_name="temporal_query")
    return TemporalQuery(
        mode=_parse_optional_string(query.get("mode")) or "current",
        as_of=_parse_optional_string(query.get("as_of")) or "",
        year_hint=_parse_optional_string(query.get("year_hint")) or "",
    )


def _parse_optional_int(raw_value: object) -> int | None:
    if raw_value is None:
        return None
    if not isinstance(raw_value, int) or isinstance(raw_value, bool):
        raise ValueError("integer field must be an integer")
    return raw_value


def _parse_optional_bool(raw_value: object) -> bool | None:
    if raw_value is None:
        return None
    if not isinstance(raw_value, bool):
        raise ValueError("boolean field must be a boolean")
    return raw_value


def _task_kind_for_capability(capability: str) -> str:
    if capability == "campus_services":
        return "campus_services_lookup"
    if capability == "notice":
        return "notice_lookup"
    if capability == "place_lookup":
        return "place_lookup"
    return "knowledge_lookup"


def _domain_candidates_for_target(target: str) -> tuple[str, ...]:
    if target == "campus-services-agent":
        return ("campus_services",)
    if target == "notice-agent":
        return ("notice",)
    if target == "navigation-agent":
        return ("navigation",)
    return ("knowledge",)


def _parse_trace_context(raw_trace: object) -> TraceContext:
    if not isinstance(raw_trace, dict):
        raise ValueError("trace must be an object")
    trace_id = _require_string(raw_trace.get("trace_id"), field_name="trace.trace_id")
    return TraceContext(trace_id=trace_id)


def _parse_bridge_context_projection(raw_context: object) -> ContextProjection:
    if not isinstance(raw_context, dict):
        raise ValueError("context must be an object")

    projected_actor = _parse_actor_context(raw_context.get("actor"), field_prefix="context.actor")
    if projected_actor == ActorContext():
        raise ValueError("context.actor is required")

    return ContextProjection(
        actor=projected_actor,
        authorization=_parse_authorization_projection(
            raw_context.get("authorization"),
            actor=projected_actor,
            require_explicit_filter=True,
        ),
        profile_memory=_parse_profile_memory_summary(raw_context.get("profile_memory")),
        session=_parse_session_summary(raw_context.get("session")),
    )


def _parse_profile_memory_summary(raw_memory: object) -> ProfileMemorySummary:
    if raw_memory is None:
        return ProfileMemorySummary()
    if not isinstance(raw_memory, dict):
        raise ValueError("context.profile_memory must be an object")

    raw_items = raw_memory.get("items", [])
    if not isinstance(raw_items, list):
        raise ValueError("context.profile_memory.items must be an array")

    items: list[ProfileMemoryItem] = []
    for raw_item in raw_items:
        if not isinstance(raw_item, dict):
            raise ValueError("context.profile_memory.items must only contain objects")
        kwargs: dict[str, str] = {}
        source_type = _parse_optional_string(raw_item.get("source_type"))
        confidence = _parse_optional_string(raw_item.get("confidence"))
        visibility = _parse_optional_string(raw_item.get("visibility"))
        last_verified_at = _parse_optional_string(raw_item.get("last_verified_at"))
        if source_type is not None:
            kwargs["source_type"] = source_type
        if confidence is not None:
            kwargs["confidence"] = confidence
        if visibility is not None:
            kwargs["visibility"] = visibility
        if last_verified_at is not None:
            kwargs["last_verified_at"] = last_verified_at
        items.append(
            ProfileMemoryItem(
                item_id=_require_string(
                    raw_item.get("item_id"), field_name="context.profile_memory.items[].item_id"
                ),
                key=_require_string(
                    raw_item.get("key"), field_name="context.profile_memory.items[].key"
                ),
                value=_require_string(
                    raw_item.get("value"), field_name="context.profile_memory.items[].value"
                ),
                **kwargs,
            )
        )

    return ProfileMemorySummary(items=tuple(items))


def _parse_session_summary(raw_session: object) -> SessionSummary:
    if raw_session is None:
        return SessionSummary()
    if not isinstance(raw_session, dict):
        raise ValueError("context.session must be an object")

    raw_slots = raw_session.get("confirmed_slots", [])
    if not isinstance(raw_slots, list):
        raise ValueError("context.session.confirmed_slots must be an array")

    confirmed_slots: list[SessionSlot] = []
    for raw_slot in raw_slots:
        if not isinstance(raw_slot, dict):
            raise ValueError("context.session.confirmed_slots must only contain objects")
        confirmed = raw_slot.get("confirmed", True)
        if not isinstance(confirmed, bool):
            raise ValueError("context.session.confirmed_slots[].confirmed must be a boolean")
        confirmed_slots.append(
            SessionSlot(
                name=_require_string(
                    raw_slot.get("name"), field_name="context.session.confirmed_slots[].name"
                ),
                value=_require_string(
                    raw_slot.get("value"), field_name="context.session.confirmed_slots[].value"
                ),
                confirmed=confirmed,
            )
        )

    raw_turn_count = raw_session.get("turn_count", 0)
    if not isinstance(raw_turn_count, int) or isinstance(raw_turn_count, bool):
        raise ValueError("context.session.turn_count must be an integer")

    return SessionSummary(
        confirmed_slots=tuple(confirmed_slots),
        turn_count=raw_turn_count,
    )


def _parse_string_tuple(raw_value: object, *, field_name: str) -> tuple[str, ...]:
    if raw_value is None:
        return ()
    if not isinstance(raw_value, list):
        raise ValueError(f"{field_name} must be an array")

    values: list[str] = []
    for item in raw_value:
        if not isinstance(item, str):
            raise ValueError(f"{field_name} must only contain strings")
        normalized = item.strip()
        if normalized:
            values.append(normalized)
    return tuple(values)


def _parse_string_dict(raw_value: object, *, field_name: str) -> dict[str, str]:
    if raw_value is None:
        return {}
    if not isinstance(raw_value, dict):
        raise ValueError(f"{field_name} must be an object")
    values: dict[str, str] = {}
    for key, value in raw_value.items():
        if not isinstance(key, str) or not isinstance(value, str):
            raise ValueError(f"{field_name} must only contain string values")
        normalized_key = key.strip()
        normalized_value = value.strip()
        if normalized_key and normalized_value:
            values[normalized_key] = normalized_value
    return values


def _require_bool(raw_value: object, *, field_name: str) -> bool:
    if not isinstance(raw_value, bool):
        raise ValueError(f"{field_name} must be a boolean")
    return raw_value


def _require_string(raw_value: object, *, field_name: str) -> str:
    value = _parse_optional_string(raw_value)
    if value is None:
        raise ValueError(f"{field_name} must be a non-empty string")
    return value


def _parse_requested_scope(raw_scope: object) -> KnowledgeScope | None:
    if raw_scope is None:
        return None
    if not isinstance(raw_scope, dict):
        raise ValueError("requested_scope must be an object")
    corpus = str(raw_scope.get("corpus", "")).strip()
    collection = str(raw_scope.get("collection", "")).strip()
    if not corpus or not collection:
        raise ValueError("requested_scope requires corpus and collection")
    return KnowledgeScope(corpus=corpus, collection=collection)


def _parse_requested_capability(raw_capability: object) -> str | None:
    if raw_capability is None:
        return None
    capability = str(raw_capability).strip()
    return capability or None


def _parse_version_query(raw_version_query: object) -> VersionQuery:
    if raw_version_query is None:
        return VersionQuery()
    if not isinstance(raw_version_query, dict):
        raise ValueError("version_query must be an object")
    mode = _parse_optional_string(raw_version_query.get("mode"))
    as_of = _parse_optional_string(raw_version_query.get("as_of"))
    version_id = _parse_optional_string(raw_version_query.get("version_id"))
    compare_to_version_id = _parse_optional_string(raw_version_query.get("compare_to_version_id"))
    return VersionQuery(
        mode="current" if mode is None else mode,
        as_of="" if as_of is None else as_of,
        version_id="" if version_id is None else version_id,
        compare_to_version_id="" if compare_to_version_id is None else compare_to_version_id,
    )


def _parse_optional_string(raw_value: object) -> str | None:
    if raw_value is None:
        return None
    value = str(raw_value).strip()
    return value or None


def _parse_actor_context(raw_actor: object, *, field_prefix: str) -> ActorContext:
    if raw_actor is None:
        return ActorContext()
    if not isinstance(raw_actor, dict):
        raise ValueError(f"{field_prefix} must be an object")
    _assert_supported_actor_context_fields(raw_actor, field_prefix=field_prefix)
    return ActorContext(
        user_id=_parse_optional_string(raw_actor.get("user_id")) or "",
        principal_id=_parse_optional_string(raw_actor.get("principal_id")) or "",
        principal_type=_parse_optional_string(raw_actor.get("principal_type")) or "",
        roles=_parse_string_tuple(raw_actor.get("roles"), field_name=f"{field_prefix}.roles"),
        departments=_parse_string_tuple(
            raw_actor.get("departments"),
            field_name=f"{field_prefix}.departments",
        ),
        cohort=_parse_optional_string(raw_actor.get("cohort")),
        major=_parse_optional_string(raw_actor.get("major")),
        program=_parse_optional_string(raw_actor.get("program")),
    )


def _parse_authorization_projection(
    raw_authorization: object,
    *,
    actor: ActorContext,
    require_explicit_filter: bool = True,
) -> AuthorizationProjection:
    if raw_authorization is None:
        raise ValueError("context.authorization is required")
    if not isinstance(raw_authorization, dict):
        raise ValueError("context.authorization must be an object")

    entitlement_groups = _parse_string_tuple(
        raw_authorization.get("entitlement_groups"),
        field_name="context.authorization.entitlement_groups",
    )
    visibility_scope = _parse_optional_string(raw_authorization.get("visibility_scope"))
    retrieval_filter = _parse_authorized_retrieval_filter(
        raw_authorization.get("retrieval_filter"),
        require_explicit=require_explicit_filter,
    )
    return AuthorizationProjection(
        principal_id=_parse_optional_string(raw_authorization.get("principal_id"))
        or actor.principal_id
        or actor.user_id,
        projection_source=_parse_optional_string(raw_authorization.get("projection_source")) or "",
        entitlement_snapshot_id=_parse_optional_string(
            raw_authorization.get("entitlement_snapshot_id")
        )
        or "",
        entitlement_groups=entitlement_groups,
        visibility_scope=visibility_scope,
        applicability_scope=_parse_optional_string(raw_authorization.get("applicability_scope")),
        ownership_scopes=_parse_string_tuple(
            raw_authorization.get("ownership_scopes"),
            field_name="context.authorization.ownership_scopes",
        ),
        approval_state=_parse_optional_string(raw_authorization.get("approval_state")) or "",
        retrieval_filter=retrieval_filter,
    )


def _parse_authorized_retrieval_filter(
    raw_filter: object,
    *,
    require_explicit: bool = True,
) -> AuthorizedRetrievalFilter:
    if raw_filter is None:
        raise ValueError("context.authorization.retrieval_filter is required")
    if not isinstance(raw_filter, dict):
        raise ValueError("context.authorization.retrieval_filter must be an object")
    _assert_supported_retrieval_filter_fields(raw_filter)

    return AuthorizedRetrievalFilter(
        entitlement_groups=_parse_string_tuple(
            raw_filter.get("entitlement_groups"),
            field_name="context.authorization.retrieval_filter.entitlement_groups",
        ),
        visibility_level=_parse_optional_string(raw_filter.get("visibility_level")) or "public",
        visibility_scope=_parse_optional_string(raw_filter.get("visibility_scope")),
        policy_projection_version=_parse_optional_string(
            raw_filter.get("policy_projection_version")
        )
        or "",
    )


def _assert_supported_actor_context_fields(
    raw_actor: dict[str, object], *, field_prefix: str
) -> None:
    supported_fields = (
        "user_id",
        "principal_id",
        "principal_type",
        "roles",
        "departments",
        "cohort",
        "major",
        "program",
    )
    unsupported_fields = tuple(
        field_name for field_name in raw_actor if field_name not in supported_fields
    )
    if unsupported_fields:
        joined = ", ".join(f"{field_prefix}.{field_name}" for field_name in unsupported_fields)
        raise ValueError(f"unsupported actor context fields are not allowed: {joined}")


def _assert_supported_retrieval_filter_fields(raw_filter: dict[str, object]) -> None:
    supported_fields = (
        "entitlement_groups",
        "visibility_level",
        "visibility_scope",
        "policy_projection_version",
    )
    unsupported_fields = tuple(
        field_name for field_name in raw_filter if field_name not in supported_fields
    )
    if unsupported_fields:
        joined = ", ".join(
            f"context.authorization.retrieval_filter.{field_name}"
            for field_name in unsupported_fields
        )
        raise ValueError(f"unsupported retrieval filter fields are not allowed: {joined}")
