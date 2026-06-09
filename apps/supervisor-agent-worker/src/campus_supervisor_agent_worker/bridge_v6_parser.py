from __future__ import annotations

from dataclasses import dataclass

from campus_contracts import (
    ALLOWED_REQUESTED_CAPABILITIES,
    CapabilityRequest,
    SupervisorRequest,
    WorkflowCapabilityContext,
)
from pydantic import ValidationError

from campus_supervisor_agent_worker.bridge_actor_codecs import parse_actor_context
from campus_supervisor_agent_worker.bridge_context_projection_codecs import (
    parse_bridge_context_projection,
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
from campus_supervisor_agent_worker.bridge_trace_codecs import (
    parse_requested_scope,
    parse_trace_context,
    parse_version_query,
)
from campus_supervisor_agent_worker.generated.supervisor_execution_contract import (
    BRIDGE_VERSION,
    RESPONSE_CONTRACT,
    RUNTIME_DECISIONS_SCHEMA_VERSION,
    BridgeV6RequestWire,
)
from campus_supervisor_agent_worker.openai_agents_workflow_plan import (
    OpenAIAgentsWorkflowPlanError,
    compile_openai_agents_workflow_plan,
)


@dataclass(frozen=True, slots=True)
class BridgeSupervisorEnvelope:
    request: SupervisorRequest
    capability_request: CapabilityRequest | None = None
    routing_frame: dict[str, object] | None = None


def parse_bridge_supervisor_envelope(payload: dict[str, object]) -> BridgeSupervisorEnvelope:
    try:
        wire_payload = BridgeV6RequestWire.model_validate(payload).model_dump(mode="python")
    except ValidationError as exc:
        raise ValueError(_wire_validation_error(exc)) from exc
    payload = wire_payload
    _require_bridge_version(payload.get("bridge_version"))
    _require_response_contract(payload.get("response_contract"))
    effective_capability = _parse_effective_capability(payload)
    lane = require_string(payload.get("lane"), field_name="lane")
    request = SupervisorRequest(
        user_goal=require_string(payload.get("user_goal"), field_name="user_goal"),
        conversation_id=parse_optional_string(
            payload.get("conversation_id"),
            field_name="conversation_id",
        )
        or "",
        request_id=require_string(payload.get("request_id"), field_name="request_id"),
        safety_identifier=parse_optional_string(
            payload.get("safety_identifier"),
            field_name="safety_identifier",
        ),
        trace=parse_trace_context(payload.get("trace")),
        actor=parse_actor_context(payload.get("actor"), field_prefix="actor"),
        context=parse_bridge_context_projection(payload.get("context")),
        requested_capability=effective_capability,
        requested_scope=parse_requested_scope(payload.get("requested_scope")),
        version_query=parse_version_query(
            require_object(payload.get("version_query"), field_name="version_query")
        ),
    )
    capability_request, routing_frame = _parse_runtime_decisions(
        payload.get("runtime_decisions"),
        effective_capability=effective_capability,
        lane=lane,
        request=request,
    )
    return BridgeSupervisorEnvelope(
        request=request,
        capability_request=capability_request,
        routing_frame=routing_frame,
    )


def _require_bridge_version(raw_version: object) -> None:
    bridge_version = require_string(raw_version, field_name="bridge_version")
    if bridge_version != BRIDGE_VERSION:
        raise ValueError(f"bridge_version must be {BRIDGE_VERSION}")


def _require_response_contract(raw_contract: object) -> None:
    response_contract = require_string(raw_contract, field_name="response_contract")
    if response_contract != RESPONSE_CONTRACT:
        raise ValueError(f"response_contract must be {RESPONSE_CONTRACT}")


def _parse_effective_capability(payload: dict[str, object]) -> str:
    effective_capability = parse_requested_capability(
        payload.get("effective_capability"),
        field_name="effective_capability",
    )
    if effective_capability is None:
        raise ValueError("effective_capability must be a non-empty string")
    if effective_capability not in ALLOWED_REQUESTED_CAPABILITIES:
        raise ValueError(f"unsupported effective_capability: {effective_capability}")
    requested_capability = parse_requested_capability(
        payload.get("requested_capability"),
        field_name="requested_capability",
    )
    if requested_capability is not None and requested_capability != effective_capability:
        raise ValueError("requested_capability must match effective_capability")
    return effective_capability


def _parse_runtime_decisions(
    raw_decisions: object,
    *,
    effective_capability: str,
    lane: str,
    request: SupervisorRequest,
) -> tuple[CapabilityRequest, dict[str, object]]:
    decisions = require_object(raw_decisions, field_name="runtime_decisions")
    schema_version = require_string(
        decisions.get("schema_version"),
        field_name="runtime_decisions.schema_version",
    )
    if schema_version != RUNTIME_DECISIONS_SCHEMA_VERSION:
        raise ValueError(
            "runtime_decisions.schema_version must be " + RUNTIME_DECISIONS_SCHEMA_VERSION
        )
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
    routing_frame, suggested_next_action = _parse_routing_frame(
        decisions.get("routing_frame"),
        effective_capability=effective_capability,
    )
    raw_handoff = decisions.get("handoff")
    if raw_handoff is None:
        raise ValueError("runtime_decisions.handoff must be present for Python delegate bridge")
    if suggested_next_action != "delegate":
        raise ValueError("Python delegate bridge only accepts delegate routing frames")
    handoff = require_object(raw_handoff, field_name="runtime_decisions.handoff")
    planning_outcome = parse_optional_string(
        handoff.get("planning_outcome"),
        field_name="runtime_decisions.handoff.planning_outcome",
    )
    if planning_outcome != "preplanned":
        raise ValueError("runtime_decisions.handoff.planning_outcome must be preplanned")
    capability = require_string(
        handoff.get("capability"),
        field_name="runtime_decisions.handoff.capability",
    )
    allowed_tools = parse_string_tuple(
        handoff.get("allowed_tools"),
        field_name="runtime_decisions.handoff.allowed_tools",
    )
    capability_request = _parse_capability_handoff_request(
        handoff.get("capability_request"),
        expected_capability=capability,
        expected_allowed_tools=allowed_tools,
    )
    _validate_workflow_plan(
        decisions.get("workflow_plan"),
        capability_request=capability_request,
    )
    _assert_capability_request_matches_supervisor_request(capability_request, request)
    return capability_request, routing_frame


def _parse_routing_frame(
    raw_frame: object, *, effective_capability: str
) -> tuple[dict[str, object], str]:
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
    return dict(frame), suggested_next_action


def _parse_capability_handoff_request(
    raw_request: object,
    *,
    expected_capability: str,
    expected_allowed_tools: tuple[str, ...],
) -> CapabilityRequest:
    request = require_object(
        raw_request,
        field_name="runtime_decisions.handoff.capability_request",
    )
    capability = require_string(
        request.get("capability"),
        field_name="runtime_decisions.handoff.capability_request.capability",
    )
    if capability != expected_capability:
        raise ValueError(
            "runtime_decisions.handoff.capability_request.capability must match capability"
        )
    allowed_tools = parse_string_tuple(
        request.get("allowed_tools"),
        field_name="runtime_decisions.handoff.capability_request.allowed_tools",
    )
    if allowed_tools != expected_allowed_tools:
        raise ValueError(
            "runtime_decisions.handoff.capability_request.allowed_tools must match allowed_tools"
        )
    payload_envelope = require_object(
        request.get("payload"),
        field_name="runtime_decisions.handoff.capability_request.payload",
    )
    payload_kind = require_string(
        payload_envelope.get("kind"),
        field_name="runtime_decisions.handoff.capability_request.payload.kind",
    )
    payload = require_object(
        payload_envelope.get("payload"),
        field_name="runtime_decisions.handoff.capability_request.payload.payload",
    )
    return CapabilityRequest(
        capability=capability,  # type: ignore[arg-type]
        user_goal=require_string(
            request.get("user_goal"),
            field_name="runtime_decisions.handoff.capability_request.user_goal",
        ),
        conversation_id=(
            parse_optional_string(
                request.get("conversation_id"),
                field_name="runtime_decisions.handoff.capability_request.conversation_id",
            )
            or ""
        ),
        request_id=require_string(
            request.get("request_id"),
            field_name="runtime_decisions.handoff.capability_request.request_id",
        ),
        safety_identifier=parse_optional_string(
            request.get("safety_identifier"),
            field_name="runtime_decisions.handoff.capability_request.safety_identifier",
        ),
        trace=parse_trace_context(request.get("trace")),
        actor=parse_actor_context(
            request.get("actor"),
            field_prefix="runtime_decisions.handoff.capability_request.actor",
        ),
        context=parse_bridge_context_projection(request.get("context")),
        workflow_context=parse_workflow_capability_context(request.get("workflow_context")),
        payload=parse_agent_payload_by_kind(payload_kind, payload),
        allowed_tools=allowed_tools,  # type: ignore[arg-type]
    )


def _validate_workflow_plan(raw_plan: object, *, capability_request: CapabilityRequest) -> None:
    if raw_plan is None:
        raise ValueError("runtime_decisions.workflow_plan must be present for delegate handoff")
    try:
        compile_openai_agents_workflow_plan(raw_plan, capability_request=capability_request)
    except OpenAIAgentsWorkflowPlanError as exc:
        raise ValueError(
            f"runtime_decisions.workflow_plan {exc.failure_class}: {exc.message}"
        ) from exc


def parse_workflow_capability_context(raw_context: object) -> WorkflowCapabilityContext:
    if raw_context is None:
        return WorkflowCapabilityContext()
    context = require_object(
        raw_context,
        field_name="runtime_decisions.handoff.capability_request.workflow_context",
    )
    raw_projection_refs = context.get("projection_refs", [])
    if not isinstance(raw_projection_refs, list):
        raise ValueError(
            "runtime_decisions.handoff.capability_request.workflow_context.projection_refs must be an array"
        )
    projection_refs = []
    for item in raw_projection_refs:
        projection_refs.append(
            require_object(
                item,
                field_name=(
                    "runtime_decisions.handoff.capability_request.workflow_context.projection_refs[]"
                ),
            )
        )
    return WorkflowCapabilityContext(
        schema_version=(
            parse_optional_string(
                context.get("schema_version"),
                field_name=(
                    "runtime_decisions.handoff.capability_request.workflow_context.schema_version"
                ),
            )
            or "workflow-capability-context-v1"
        ),
        visibility=(
            parse_optional_string(
                context.get("visibility"),
                field_name="runtime_decisions.handoff.capability_request.workflow_context.visibility",
            )
            or "capability_private"
        ),
        workflow_run_ref=require_string(
            context.get("workflow_run_ref"),
            field_name="runtime_decisions.handoff.capability_request.workflow_context.workflow_run_ref",
        ),
        step_id=require_string(
            context.get("step_id"),
            field_name="runtime_decisions.handoff.capability_request.workflow_context.step_id",
        ),
        capability_id=require_string(
            context.get("capability_id"),
            field_name="runtime_decisions.handoff.capability_request.workflow_context.capability_id",
        ),
        capability=(
            parse_optional_string(
                context.get("capability"),
                field_name="runtime_decisions.handoff.capability_request.workflow_context.capability",
            )
            or ""
        ),
        required_projection_kind=(
            parse_optional_string(
                context.get("required_projection_kind"),
                field_name=(
                    "runtime_decisions.handoff.capability_request.workflow_context."
                    "required_projection_kind"
                ),
            )
            or ""
        ),
        expected_output_artifacts=parse_string_tuple(
            context.get("expected_output_artifacts"),
            field_name=(
                "runtime_decisions.handoff.capability_request.workflow_context.expected_output_artifacts"
            ),
        ),
        projection_refs=tuple(projection_refs),
    )


def _assert_capability_request_matches_supervisor_request(
    capability_request: CapabilityRequest,
    request: SupervisorRequest,
) -> None:
    if capability_request.user_goal != request.user_goal:
        raise ValueError(
            "runtime_decisions.handoff.capability_request.user_goal must match user_goal"
        )
    if capability_request.conversation_id != request.conversation_id:
        raise ValueError(
            "runtime_decisions.handoff.capability_request.conversation_id must match conversation_id"
        )
    if capability_request.request_id != request.request_id:
        raise ValueError(
            "runtime_decisions.handoff.capability_request.request_id must match request_id"
        )
    if capability_request.safety_identifier != request.safety_identifier:
        raise ValueError(
            "runtime_decisions.handoff.capability_request.safety_identifier must match safety_identifier"
        )
    if capability_request.trace.trace_id != request.trace.trace_id:
        raise ValueError(
            "runtime_decisions.handoff.capability_request.trace.trace_id must match trace.trace_id"
        )
    if capability_request.context != request.context:
        raise ValueError("runtime_decisions.handoff.capability_request.context must match context")


def _wire_validation_error(exc: ValidationError) -> str:
    first_error = exc.errors()[0] if exc.errors() else {}
    location = ".".join(str(part) for part in first_error.get("loc", ()) if str(part))
    if not location:
        location = "bridge_request"
    message = str(first_error.get("msg") or "invalid bridge request")
    return f"{location}: {message}"
