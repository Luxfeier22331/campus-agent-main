from __future__ import annotations

from dataclasses import dataclass

from campus_contracts import (
    ALLOWED_REQUESTED_CAPABILITIES,
    AgentRequest,
    SupervisorRequest,
)

from campus_supervisor_agent_worker.bridge_context_codecs import (
    parse_actor_context,
    parse_bridge_context_projection,
    parse_requested_scope,
    parse_trace_context,
    parse_version_query,
)
from campus_supervisor_agent_worker.bridge_parse_utils import (
    parse_optional_string,
    parse_requested_capability,
    parse_string_dict,
    parse_string_tuple,
    require_bool,
    require_object,
    require_string,
)
from campus_supervisor_agent_worker.bridge_payload_codecs import parse_agent_payload_by_kind


@dataclass(frozen=True, slots=True)
class BridgeSupervisorEnvelope:
    request: SupervisorRequest
    agent_request: AgentRequest | None = None


def parse_bridge_supervisor_envelope(payload: dict[str, object]) -> BridgeSupervisorEnvelope:
    _require_bridge_version(payload.get("bridge_version"))
    _require_response_contract(payload.get("response_contract"))
    effective_capability = _parse_effective_capability(payload)
    lane = require_string(payload.get("lane"), field_name="lane")
    request = SupervisorRequest(
        user_goal=require_string(payload.get("user_goal"), field_name="user_goal"),
        conversation_id=parse_optional_string(payload.get("conversation_id")) or "",
        request_id=require_string(payload.get("request_id"), field_name="request_id"),
        safety_identifier=parse_optional_string(payload.get("safety_identifier")),
        trace=parse_trace_context(payload.get("trace")),
        actor=parse_actor_context(payload.get("actor"), field_prefix="actor"),
        context=parse_bridge_context_projection(payload.get("context")),
        requested_capability=effective_capability,
        requested_scope=parse_requested_scope(payload.get("requested_scope")),
        version_query=parse_version_query(
            require_object(payload.get("version_query"), field_name="version_query")
        ),
    )
    return BridgeSupervisorEnvelope(
        request=request,
        agent_request=_parse_runtime_decisions(
            payload.get("runtime_decisions"),
            effective_capability=effective_capability,
            lane=lane,
            request=request,
        ),
    )


def _require_bridge_version(raw_version: object) -> None:
    bridge_version = require_string(raw_version, field_name="bridge_version")
    if bridge_version != "supervisor_bridge_v6":
        raise ValueError("bridge_version must be supervisor_bridge_v6")


def _require_response_contract(raw_contract: object) -> None:
    response_contract = require_string(raw_contract, field_name="response_contract")
    if response_contract != "agent_response":
        raise ValueError("response_contract must be agent_response")


def _parse_effective_capability(payload: dict[str, object]) -> str:
    effective_capability = parse_requested_capability(payload.get("effective_capability"))
    if effective_capability is None:
        raise ValueError("effective_capability must be a non-empty string")
    if effective_capability not in ALLOWED_REQUESTED_CAPABILITIES:
        raise ValueError(f"unsupported effective_capability: {effective_capability}")
    requested_capability = parse_requested_capability(payload.get("requested_capability"))
    if requested_capability is not None and requested_capability != effective_capability:
        raise ValueError("requested_capability must match effective_capability")
    return effective_capability


def _parse_runtime_decisions(
    raw_decisions: object,
    *,
    effective_capability: str,
    lane: str,
    request: SupervisorRequest,
) -> AgentRequest:
    decisions = require_object(raw_decisions, field_name="runtime_decisions")
    decision_capability = require_string(
        decisions.get("effective_capability"),
        field_name="runtime_decisions.effective_capability",
    )
    decision_lane = require_string(
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
    handoff = require_object(raw_handoff, field_name="runtime_decisions.handoff")
    planning_outcome = parse_optional_string(handoff.get("planning_outcome"))
    if planning_outcome != "preplanned":
        raise ValueError("runtime_decisions.handoff.planning_outcome must be preplanned")
    target = require_string(
        handoff.get("target"),
        field_name="runtime_decisions.handoff.target",
    )
    allowed_tools = parse_string_tuple(
        handoff.get("allowed_tools"),
        field_name="runtime_decisions.handoff.allowed_tools",
    )
    agent_request = _parse_agent_handoff_request(
        handoff.get("agent_request"),
        expected_target=target,
        expected_allowed_tools=allowed_tools,
    )
    _assert_agent_request_matches_supervisor_request(agent_request, request)
    return agent_request


def _parse_routing_frame(raw_frame: object, *, effective_capability: str) -> str:
    frame = require_object(raw_frame, field_name="runtime_decisions.routing_frame")
    capability = require_string(
        frame.get("capability"),
        field_name="runtime_decisions.routing_frame.capability",
    )
    if capability != effective_capability:
        raise ValueError(
            "runtime_decisions.routing_frame.capability must match effective_capability"
        )
    require_string(
        frame.get("task_kind"),
        field_name="runtime_decisions.routing_frame.task_kind",
    )
    parse_string_tuple(
        frame.get("domain_candidates"),
        field_name="runtime_decisions.routing_frame.domain_candidates",
    )
    parse_string_tuple(
        frame.get("missing_slots"),
        field_name="runtime_decisions.routing_frame.missing_slots",
    )
    require_string(
        frame.get("risk_level"),
        field_name="runtime_decisions.routing_frame.risk_level",
    )
    require_bool(
        frame.get("needs_clarification"),
        field_name="runtime_decisions.routing_frame.needs_clarification",
    )
    suggested_next_action = require_string(
        frame.get("suggested_next_action"),
        field_name="runtime_decisions.routing_frame.suggested_next_action",
    )
    parse_string_dict(
        frame.get("resolved_slots"),
        field_name="runtime_decisions.routing_frame.resolved_slots",
    )
    return suggested_next_action


def _parse_agent_handoff_request(
    raw_request: object,
    *,
    expected_target: str,
    expected_allowed_tools: tuple[str, ...],
) -> AgentRequest:
    request = require_object(
        raw_request,
        field_name="runtime_decisions.handoff.agent_request",
    )
    target = require_string(
        request.get("target"),
        field_name="runtime_decisions.handoff.agent_request.target",
    )
    if target != expected_target:
        raise ValueError("runtime_decisions.handoff.agent_request.target must match target")
    allowed_tools = parse_string_tuple(
        request.get("allowed_tools"),
        field_name="runtime_decisions.handoff.agent_request.allowed_tools",
    )
    if allowed_tools != expected_allowed_tools:
        raise ValueError(
            "runtime_decisions.handoff.agent_request.allowed_tools must match allowed_tools"
        )
    payload_envelope = require_object(
        request.get("payload"),
        field_name="runtime_decisions.handoff.agent_request.payload",
    )
    payload_kind = require_string(
        payload_envelope.get("kind"),
        field_name="runtime_decisions.handoff.agent_request.payload.kind",
    )
    payload = require_object(
        payload_envelope.get("payload"),
        field_name="runtime_decisions.handoff.agent_request.payload.payload",
    )
    return AgentRequest(
        target=target,  # type: ignore[arg-type]
        user_goal=require_string(
            request.get("user_goal"),
            field_name="runtime_decisions.handoff.agent_request.user_goal",
        ),
        conversation_id=(parse_optional_string(request.get("conversation_id")) or ""),
        request_id=require_string(
            request.get("request_id"),
            field_name="runtime_decisions.handoff.agent_request.request_id",
        ),
        safety_identifier=parse_optional_string(request.get("safety_identifier")),
        trace=parse_trace_context(request.get("trace")),
        actor=parse_actor_context(
            request.get("actor"),
            field_prefix="runtime_decisions.handoff.agent_request.actor",
        ),
        context=parse_bridge_context_projection(request.get("context")),
        payload=parse_agent_payload_by_kind(payload_kind, payload),
        allowed_tools=allowed_tools,  # type: ignore[arg-type]
    )


def _assert_agent_request_matches_supervisor_request(
    agent_request: AgentRequest,
    request: SupervisorRequest,
) -> None:
    if agent_request.user_goal != request.user_goal:
        raise ValueError("runtime_decisions.handoff.agent_request.user_goal must match user_goal")
    if agent_request.conversation_id != request.conversation_id:
        raise ValueError(
            "runtime_decisions.handoff.agent_request.conversation_id must match conversation_id"
        )
    if agent_request.request_id != request.request_id:
        raise ValueError("runtime_decisions.handoff.agent_request.request_id must match request_id")
    if agent_request.safety_identifier != request.safety_identifier:
        raise ValueError(
            "runtime_decisions.handoff.agent_request.safety_identifier must match safety_identifier"
        )
    if agent_request.trace.trace_id != request.trace.trace_id:
        raise ValueError(
            "runtime_decisions.handoff.agent_request.trace.trace_id must match trace.trace_id"
        )
    if agent_request.context != request.context:
        raise ValueError("runtime_decisions.handoff.agent_request.context must match context")
