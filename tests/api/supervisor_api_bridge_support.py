from __future__ import annotations

import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from campus_contracts import (
    CapabilityResponse,
    KnowledgeScope,
    RagRequestPayload,
    VersionQuery,
)
from campus_supervisor_agent_worker.capability_dispatch import MissingCapabilityDelegateError
from campus_supervisor_agent_worker.app import create_bridge_app
from campus_supervisor_agent_worker.bridge_v6_parser import parse_bridge_supervisor_envelope
from campus_supervisor_agent_worker.settings import ApiSettings


def _bridge_v6_payload(
    *,
    user_goal: str = "test",
    conversation_id: str = "",
    request_id: str = "req-001",
    trace_id: str = "trace-001",
    effective_capability: str = "knowledge",
    lane: str = "rag",
    actor: dict[str, object] | None = None,
    context: dict[str, object] | None = None,
    version_query: dict[str, object] | None = None,
    preplan_delegate: bool = True,
) -> dict[str, object]:
    if context is None:
        context = {
            "actor": {
                "user_id": "student@example.edu",
            },
            "authorization": {
                "retrieval_filter": {
                    "entitlement_groups": [],
                    "visibility_level": "public",
                    "policy_projection_version": "phase1-authorization-projection-v1",
                },
            },
        }
    if actor is None:
        actor = dict(context.get("actor", {})) if isinstance(context.get("actor"), dict) else {}
    if version_query is None:
        version_query = {"mode": "current"}
    body: dict[str, object] = {
        "bridge_version": "supervisor_bridge_v6",
        "response_contract": "capability_response",
        "user_goal": user_goal,
        "conversation_id": conversation_id,
        "request_id": request_id,
        "trace": {"trace_id": trace_id},
        "requested_capability": effective_capability,
        "effective_capability": effective_capability,
        "lane": lane,
        "actor": actor,
        "context": context,
        "version_query": version_query,
        "runtime_decisions": {
            "schema_version": "supervisor-runtime-decisions-v1",
            "effective_capability": effective_capability,
            "lane": lane,
            "scope_gate": {
                "decision": "in_scope",
                "reason": "scope_undetermined_delegate",
                "matched_signal": "",
            },
            "policy_gate": {
                "decision": "delegate",
                "reason": "",
                "risk_level": "low",
                "matched_signal": "",
            },
            "context_preflight": {
                "state": "not_follow_up",
                "reference_type": "none",
                "missing_slots": [],
                "resolved_slots": {},
                "matched_signal": "",
                "ambiguity_reason": "",
            },
            "tool_policy": {
                "policy_version": "runtime-policy-v1",
            },
            "runtime_decision_summary": {
                "schema_version": "runtime-decision-summary-v1",
                "scope_gate_decision": "in_scope",
                "policy_gate_decision": "delegate",
                "context_preflight_state": "not_follow_up",
                "routing_next_action": "delegate",
                "planning_outcome": "not_preplanned",
            },
            "routing_frame": {
                "capability": effective_capability,
                "task_kind": "knowledge_lookup",
                "domain_candidates": ["knowledge"],
                "missing_slots": [],
                "risk_level": "low",
                "needs_clarification": False,
                "suggested_next_action": "delegate",
                "personalization_mode": "generic",
                "clarification_subject": "",
                "scope_class": "in_scope",
                "policy_reason": "",
                "launch_state": "open",
                "scope_reason": "scope_undetermined_delegate",
                "matched_signal": "",
                "classifier_version": "go-runtime-policy-v2",
                "schema_version": "intent-schema-1.0.0",
                "routing_confidence": "high",
                "ambiguity_signal": "",
                "context_resolution_state": "not_follow_up",
                "context_reference_type": "none",
                "resolved_slots": {},
                "ambiguity_reason": "",
            },
        },
    }
    if preplan_delegate:
        runtime_decisions = body["runtime_decisions"]
        assert isinstance(runtime_decisions, dict)
        runtime_decisions.update(
            _handoff_fields_for_capability(
                effective_capability=effective_capability,
                user_goal=user_goal,
                request_id=request_id,
                conversation_id=conversation_id,
                trace_id=trace_id,
                context=context,
                version_query=version_query,
            )
        )
    return body


def _handoff_fields_for_capability(
    *,
    effective_capability: str,
    user_goal: str,
    request_id: str,
    conversation_id: str,
    trace_id: str,
    context: dict[str, object],
    version_query: dict[str, object],
) -> dict[str, object]:
    if effective_capability == "campus_services":
        target = "campus_services"
        payload_kind = "transport_schedule_lookup"
        allowed_tools = ["transport_schedule_lookup"]
        return {
            "runtime_decision_summary": {
                "schema_version": "runtime-decision-summary-v1",
                "scope_gate_decision": "in_scope",
                "policy_gate_decision": "delegate",
                "context_preflight_state": "not_follow_up",
                "routing_next_action": "delegate",
                "planning_outcome": "preplanned",
            },
            "handoff": {
                "planning_outcome": "preplanned",
                "target": target,
                "allowed_tools": allowed_tools,
                "agent_request": _agent_request_payload(
                    target=target,
                    user_goal=user_goal,
                    request_id=request_id,
                    conversation_id=conversation_id,
                    trace_id=trace_id,
                    context=context,
                    payload_kind=payload_kind,
                    payload={
                        "query_text": user_goal,
                        "intent": "timetable",
                        "snapshot_query": {"mode": "current"},
                    },
                    allowed_tools=allowed_tools,
                ),
            },
            "workflow_plan": _workflow_plan_payload(
                target=target,
                payload_kind=payload_kind,
                allowed_tools=allowed_tools,
            ),
        }
    if effective_capability == "notice":
        target = "notice"
        payload_kind = "campus_notice_discover"
        allowed_tools = ["campus_notice_discover"]
        return {
            "runtime_decision_summary": {
                "schema_version": "runtime-decision-summary-v1",
                "scope_gate_decision": "in_scope",
                "policy_gate_decision": "delegate",
                "context_preflight_state": "not_follow_up",
                "routing_next_action": "delegate",
                "planning_outcome": "preplanned",
            },
            "handoff": {
                "planning_outcome": "preplanned",
                "target": target,
                "allowed_tools": allowed_tools,
                "agent_request": _agent_request_payload(
                    target=target,
                    user_goal=user_goal,
                    request_id=request_id,
                    conversation_id=conversation_id,
                    trace_id=trace_id,
                    context=context,
                    payload_kind=payload_kind,
                    payload={
                        "query_text": user_goal,
                        "temporal_query": {"mode": "current"},
                    },
                    allowed_tools=allowed_tools,
                ),
            },
            "workflow_plan": _workflow_plan_payload(
                target=target,
                payload_kind=payload_kind,
                allowed_tools=allowed_tools,
            ),
        }
    target = "knowledge"
    payload_kind = "rag_request"
    allowed_tools: list[str] = []
    return {
        "runtime_decision_summary": {
            "schema_version": "runtime-decision-summary-v1",
            "scope_gate_decision": "in_scope",
            "policy_gate_decision": "delegate",
            "context_preflight_state": "not_follow_up",
            "routing_next_action": "delegate",
            "planning_outcome": "preplanned",
        },
        "handoff": {
            "planning_outcome": "preplanned",
            "target": target,
            "allowed_tools": allowed_tools,
            "agent_request": _agent_request_payload(
                target=target,
                user_goal=user_goal,
                request_id=request_id,
                conversation_id=conversation_id,
                trace_id=trace_id,
                context=context,
                payload_kind=payload_kind,
                payload={
                    "scope": None,
                    "version_query": version_query,
                },
                allowed_tools=allowed_tools,
            ),
        },
        "workflow_plan": _workflow_plan_payload(
            target=target,
            payload_kind=payload_kind,
            allowed_tools=allowed_tools,
        ),
    }


def _agent_request_payload(
    *,
    target: str,
    user_goal: str,
    request_id: str,
    conversation_id: str = "",
    payload_kind: str,
    payload: dict[str, object],
    allowed_tools: list[str],
    trace_id: str = "trace-001",
    context: dict[str, object] | None = None,
) -> dict[str, object]:
    if context is None:
        context = {
            "actor": {"user_id": "student@example.edu"},
            "authorization": {
                "retrieval_filter": {
                    "entitlement_groups": [],
                    "visibility_level": "public",
                    "policy_projection_version": "phase1-authorization-projection-v1",
                },
            },
        }
    return {
        "target": target,
        "user_goal": user_goal,
        "conversation_id": conversation_id,
        "request_id": request_id,
        "safety_identifier": None,
        "trace": {"trace_id": trace_id},
        "actor": context.get("actor", {}),
        "context": context,
        "payload": {
            "kind": payload_kind,
            "payload": payload,
        },
        "allowed_tools": allowed_tools,
        "workflow_context": _workflow_context_payload(
            target=target,
            payload_kind=payload_kind,
            request_id=request_id,
        ),
    }


def _bridge_v6_payload_with_handoff(
    *,
    user_goal: str,
    request_id: str,
    trace_id: str,
    effective_capability: str,
    lane: str,
    handoff_target: str,
    payload_kind: str,
    payload: dict[str, object],
    allowed_tools: list[str],
    context: dict[str, object] | None = None,
) -> dict[str, object]:
    body = _bridge_v6_payload(
        user_goal=user_goal,
        request_id=request_id,
        trace_id=trace_id,
        effective_capability=effective_capability,
        lane=lane,
        context=context,
    )
    body["runtime_decisions"] = {
        "schema_version": "supervisor-runtime-decisions-v1",
        "effective_capability": effective_capability,
        "lane": lane,
        "scope_gate": {
            "decision": "in_scope",
            "reason": "go_handoff",
            "matched_signal": "",
        },
        "policy_gate": {
            "decision": "delegate",
            "reason": "",
            "risk_level": "low",
            "matched_signal": "",
        },
        "context_preflight": {
            "state": "not_follow_up",
            "reference_type": "none",
            "missing_slots": [],
            "resolved_slots": {},
            "matched_signal": "",
            "ambiguity_reason": "",
        },
        "tool_policy": {
            "policy_version": "runtime-policy-v1",
        },
        "routing_frame": {
            "capability": effective_capability,
            "task_kind": {
                "campus_services": "campus_services_lookup",
                "notice": "notice_lookup",
            }.get(effective_capability, "knowledge_lookup"),
            "domain_candidates": {
                "campus_services": ["campus_services"],
                "notice": ["notice"],
            }.get(effective_capability, ["knowledge"]),
            "missing_slots": [],
            "risk_level": "low",
            "needs_clarification": False,
            "suggested_next_action": "delegate",
            "personalization_mode": "generic",
            "clarification_subject": "",
            "scope_class": "in_scope",
            "policy_reason": "",
            "launch_state": "open",
            "scope_reason": "go_handoff",
            "matched_signal": "",
            "classifier_version": "go-runtime-policy-v2",
            "schema_version": "intent-schema-1.0.0",
            "routing_confidence": "high",
            "ambiguity_signal": "",
            "context_resolution_state": "not_follow_up",
            "context_reference_type": "none",
            "resolved_slots": {},
            "ambiguity_reason": "",
        },
        "runtime_decision_summary": {
            "schema_version": "runtime-decision-summary-v1",
            "scope_gate_decision": "in_scope",
            "policy_gate_decision": "delegate",
            "context_preflight_state": "not_follow_up",
            "routing_next_action": "delegate",
            "planning_outcome": "preplanned",
        },
        "handoff": {
            "planning_outcome": "preplanned",
            "target": handoff_target,
            "allowed_tools": allowed_tools,
            "agent_request": _agent_request_payload(
                target=handoff_target,
                user_goal=user_goal,
                request_id=request_id,
                trace_id=trace_id,
                payload_kind=payload_kind,
                payload=payload,
                allowed_tools=allowed_tools,
                context=context,
            ),
        },
        "workflow_plan": _workflow_plan_payload(
            target=handoff_target,
            payload_kind=payload_kind,
            allowed_tools=allowed_tools,
        ),
    }
    return body


def _workflow_context_payload(
    *,
    target: str,
    payload_kind: str,
    request_id: str,
) -> dict[str, object]:
    return {
        "schema_version": "workflow-capability-context-v1",
        "visibility": "capability_private",
        "workflow_run_ref": f"workflow:{request_id}",
        "step_id": f"handoff:{target}:{payload_kind}",
        "capability_id": target,
        "target": target,
        "required_projection_kind": "",
        "expected_output_artifacts": _expected_artifacts_for_handoff(
            target=target,
            payload_kind=payload_kind,
        ),
        "projection_refs": [],
    }


def _workflow_plan_payload(
    *,
    target: str,
    payload_kind: str,
    allowed_tools: list[str],
) -> dict[str, object]:
    return {
        "schema_version": "workflow-plan-v1",
        "plan_id": f"plan:single_step:{target}:{payload_kind}",
        "workflow_mode": "single_step",
        "allowed_capabilities": [target],
        "steps": [
            {
                "step_id": f"handoff:{target}:{payload_kind}",
                "step_kind": "handoff",
                "target": target,
                "payload_kind": payload_kind,
                "allowed_tools": allowed_tools,
                "selected_tool": allowed_tools[0] if len(allowed_tools) == 1 else "",
            }
        ],
        "edges": [],
        "terminal_policy": {"fail_close_on_invalid_plan": True},
        "resume_policy": {"resume_supported": False},
        "semantic_retry_policy": {"max_replans": 0},
    }


def _expected_artifacts_for_handoff(*, target: str, payload_kind: str) -> list[str]:
    if target == "notice" and payload_kind == "campus_notice_get":
        return ["notice_context"]
    if target == "notice" and payload_kind == "campus_notice_change_set_lookup":
        return ["notice_change_set"]
    if target == "campus_services" and payload_kind == "transport_schedule_lookup":
        return ["schedule_baseline"]
    if target == "knowledge" and payload_kind == "rag_request":
        return ["evidence_bundle", "grounding_verdict"]
    return []


class SupervisorApiBridgeBaseTest(unittest.TestCase):
    pass


__all__ = [name for name in globals() if not name.startswith("__")]
