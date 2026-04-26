from __future__ import annotations

import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, HTTPServer

from campus_contracts import (
    AgentResponse,
    KnowledgeScope,
    RagRequestPayload,
    VersionQuery,
)
from campus_supervisor_agent_worker.agent_dispatch import MissingAgentDelegateError
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
    if version_query is None:
        version_query = {"mode": "current"}
    body: dict[str, object] = {
        "bridge_version": "supervisor_bridge_v6",
        "response_contract": "agent_response",
        "user_goal": user_goal,
        "conversation_id": conversation_id,
        "request_id": request_id,
        "trace": {"trace_id": trace_id},
        "requested_capability": effective_capability,
        "effective_capability": effective_capability,
        "lane": lane,
        "context": context,
        "version_query": version_query,
        "runtime_decisions": {
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
                "classifier_version": "go-runtime-policy-v1",
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
        return {
            "runtime_decision_summary": {
                "scope_gate_decision": "in_scope",
                "policy_gate_decision": "delegate",
                "context_preflight_state": "not_follow_up",
                "routing_next_action": "delegate",
                "planning_outcome": "preplanned",
            },
            "handoff": {
                "planning_outcome": "preplanned",
                "target": "campus-services-agent",
                "allowed_tools": ["transport_schedule_lookup"],
                "agent_request": _agent_request_payload(
                    target="campus-services-agent",
                    user_goal=user_goal,
                    request_id=request_id,
                    conversation_id=conversation_id,
                    trace_id=trace_id,
                    context=context,
                    payload_kind="transport_schedule_lookup",
                    payload={
                        "query_text": user_goal,
                        "intent": "timetable",
                        "snapshot_query": {"mode": "current"},
                    },
                    allowed_tools=["transport_schedule_lookup"],
                ),
            },
        }
    if effective_capability == "notice":
        return {
            "runtime_decision_summary": {
                "scope_gate_decision": "in_scope",
                "policy_gate_decision": "delegate",
                "context_preflight_state": "not_follow_up",
                "routing_next_action": "delegate",
                "planning_outcome": "preplanned",
            },
            "handoff": {
                "planning_outcome": "preplanned",
                "target": "notice-agent",
                "allowed_tools": ["campus_notice_discover"],
                "agent_request": _agent_request_payload(
                    target="notice-agent",
                    user_goal=user_goal,
                    request_id=request_id,
                    conversation_id=conversation_id,
                    trace_id=trace_id,
                    context=context,
                    payload_kind="campus_notice_discover",
                    payload={
                        "query_text": user_goal,
                        "temporal_query": {"mode": "current"},
                    },
                    allowed_tools=["campus_notice_discover"],
                ),
            },
        }
    return {
        "runtime_decision_summary": {
            "scope_gate_decision": "in_scope",
            "policy_gate_decision": "delegate",
            "context_preflight_state": "not_follow_up",
            "routing_next_action": "delegate",
            "planning_outcome": "preplanned",
        },
        "handoff": {
            "planning_outcome": "preplanned",
            "target": "rag-agent",
            "allowed_tools": [],
            "agent_request": _agent_request_payload(
                target="rag-agent",
                user_goal=user_goal,
                request_id=request_id,
                conversation_id=conversation_id,
                trace_id=trace_id,
                context=context,
                payload_kind="rag_request",
                payload={
                    "scope": None,
                    "version_query": version_query,
                },
                allowed_tools=[],
            ),
        },
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
            "classifier_version": "go-runtime-policy-v1",
            "schema_version": "intent-schema-1.0.0",
            "routing_confidence": "high",
            "ambiguity_signal": "",
            "context_resolution_state": "not_follow_up",
            "context_reference_type": "none",
            "resolved_slots": {},
            "ambiguity_reason": "",
        },
        "runtime_decision_summary": {
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
    }
    return body


class SupervisorApiBridgeTest(unittest.TestCase):
    def test_bridge_answer_route_accepts_v6_agent_response_contract(self) -> None:
        captured_requests = []

        def fake_agent(request):
            captured_requests.append(request)
            return AgentResponse(
                target=request.target,
                status="completed",
                answer_text="Agent response returned to Go finalizer.",
                confidence="high",
            )

        body = _bridge_v6_payload(
            user_goal="保研政策怎么准备？",
            request_id="req-v6-agent-response",
            trace_id="trace-v6-agent-response",
        )
        body["bridge_version"] = "supervisor_bridge_v6"
        body["response_contract"] = "agent_response"
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            ),
            agent_handler=fake_agent,
        )

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body=body,
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.headers["x-supervisor-bridge-kind"], "agent_response")
        self.assertEqual(response.json_body["target"], "rag-agent")
        self.assertEqual(response.json_body["status"], "completed")
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(captured_requests[0].target, "rag-agent")

    def test_bridge_answer_route_rejects_bridge_v4_after_agent_response_hardcut(
        self,
    ) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            )
        )

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body={
                **_bridge_v6_payload(request_id="req-v4-rejected"),
                "bridge_version": "supervisor_bridge_v4",
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        self.assertIn("supervisor_bridge_v6", response.json_body["error"]["message"])

    def test_bridge_answer_route_accepts_supervisor_request_payload(self) -> None:
        captured_requests = []

        def fake_agent(request):
            captured_requests.append(request)
            return AgentResponse(
                target=request.target,
                status="completed",
                answer_text="Projected context reached supervisor.",
                confidence="high",
            )

        app = create_bridge_app(
            settings=ApiSettings(
                app_name="campus-agent-v2",
                bridge_shared_secret="bridge-secret",
            ),
            agent_handler=fake_agent,
        )

        body = _bridge_v6_payload(
            user_goal="保研政策怎么准备？",
            conversation_id="conv-001",
            request_id="req-001",
            trace_id="trace-001",
            context={
                "actor": {
                    "user_id": "student@example.edu",
                    "principal_id": "principal-001",
                    "principal_type": "student",
                    "roles": ["student"],
                },
                "authorization": {
                    "principal_id": "principal-001",
                    "entitlement_groups": ["students", "library"],
                    "visibility_scope": "north",
                    "retrieval_filter": {
                        "entitlement_groups": ["students", "library"],
                        "visibility_level": "public",
                        "visibility_scope": "north",
                        "policy_projection_version": "phase1-authorization-projection-v1",
                    },
                },
            },
        )
        body["requested_scope"] = {
            "corpus": "regulations",
            "collection": "student_rules",
        }
        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body=body,
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers["x-supervisor-bridge-kind"],
            "agent_response",
        )
        self.assertEqual(response.json_body["status"], "completed")
        self.assertEqual(response.json_body["target"], "rag-agent")
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(captured_requests[0].trace.trace_id, "trace-001")
        self.assertEqual(captured_requests[0].context.actor.user_id, "student@example.edu")

    def test_bridge_answer_route_rejects_legacy_payload_without_bridge_v6_marker(self) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            )
        )

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body={
                "user_goal": "保研政策怎么准备？",
                "request_id": "req-legacy",
                "trace": {"trace_id": "trace-legacy"},
                "requested_capability": "knowledge",
                "context": {
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
                },
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        self.assertIn("bridge_version", response.json_body["error"]["message"])

    def test_bridge_answer_route_maps_go_effective_capability_to_agent_request(
        self,
    ) -> None:
        captured_requests = []

        def fake_agent(request):
            captured_requests.append(request)
            return AgentResponse(
                target=request.target,
                status="completed",
                answer_text="ok",
                confidence="high",
            )

        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            ),
            agent_handler=fake_agent,
        )

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body=_bridge_v6_payload(
                user_goal="校车时刻表",
                request_id="req-v2-effective",
                trace_id="trace-v2-effective",
                effective_capability="campus_services",
                lane="campus_services",
            ),
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(captured_requests[0].target, "campus-services-agent")

    def test_bridge_answer_rejects_terminal_frame_because_go_handles_terminal_directly(
        self,
    ) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            )
        )
        body = _bridge_v6_payload(
            user_goal="MIT的校长是谁",
            request_id="req-go-policy-out-of-scope",
            trace_id="trace-go-policy-out-of-scope",
            effective_capability="knowledge",
            lane="rag",
        )
        body["runtime_decisions"] = {
            "effective_capability": "knowledge",
            "lane": "rag",
            "scope_gate": {
                "decision": "out_of_scope",
                "reason": "product_scope_boundary",
                "matched_signal": "MIT",
            },
            "policy_gate": {
                "decision": "out_of_scope",
                "reason": "product_scope_boundary",
                "risk_level": "low",
                "matched_signal": "MIT",
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
                "scope_gate_decision": "out_of_scope",
                "policy_gate_decision": "out_of_scope",
                "context_preflight_state": "not_follow_up",
                "routing_next_action": "out_of_scope",
                "planning_outcome": "not_preplanned",
            },
            "routing_frame": {
                "capability": "knowledge",
                "task_kind": "knowledge_lookup",
                "domain_candidates": ["out_of_scope"],
                "missing_slots": [],
                "risk_level": "low",
                "needs_clarification": False,
                "suggested_next_action": "out_of_scope",
                "personalization_mode": "generic",
                "clarification_subject": "",
                "scope_class": "out_of_scope",
                "policy_reason": "product_scope_boundary",
                "launch_state": "closed",
                "scope_reason": "product_scope_boundary",
                "matched_signal": "MIT",
                "classifier_version": "go-runtime-policy-v1",
                "schema_version": "intent-schema-1.0.0",
                "routing_confidence": "high",
                "ambiguity_signal": "",
                "context_resolution_state": "not_follow_up",
                "context_reference_type": "none",
                "resolved_slots": {},
                "ambiguity_reason": "",
            },
            "terminal_envelope": {
                "selected_target": None,
                "status": "no_answer",
                "answer_text": "Go terminal envelope says this is outside the product scope.",
                "follow_up_question": "",
                "confidence": "low",
                "observability": {
                    "retrieval_attempted": False,
                    "candidate_count": 0,
                    "retrieved_source_count": 0,
                    "citation_expected": False,
                    "citation_count": 0,
                    "citation_missing": False,
                    "refusal_class": "out_of_scope",
                    "semantic_outcome": "out_of_scope",
                    "scope_class": "out_of_scope",
                    "policy_reason": "product_scope_boundary",
                    "acl_decision": "allowed",
                    "fail_closed": True,
                },
            },
        }

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body=body,
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        self.assertIn("handoff", response.json_body["error"]["message"])

    def test_bridge_answer_rejects_legacy_payload_without_go_routing_frame(self) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            )
        )
        body = _bridge_v6_payload(
            user_goal="保研政策怎么准备？",
            request_id="req-missing-runtime-frame",
        )
        body["runtime_decisions"] = {
            "effective_capability": "knowledge",
            "lane": "rag",
        }

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body=body,
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        self.assertIn("routing_frame", response.json_body["error"]["message"])

    def test_bridge_answer_rejects_delegate_frame_without_go_handoff(self) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            )
        )

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body=_bridge_v6_payload(
                user_goal="学生手册请假制度怎么规定？",
                request_id="req-missing-handoff",
                trace_id="trace-missing-handoff",
                preplan_delegate=False,
            ),
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        self.assertIn("handoff", response.json_body["error"]["message"])

    def test_bridge_answer_rejects_terminal_frame_without_delegate_handoff(self) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            )
        )
        body = _bridge_v6_payload(
            user_goal="MIT的校长是谁",
            request_id="req-missing-terminal-envelope",
            trace_id="trace-missing-terminal-envelope",
            preplan_delegate=False,
        )
        runtime_decisions = body["runtime_decisions"]
        assert isinstance(runtime_decisions, dict)
        routing_frame = runtime_decisions["routing_frame"]
        assert isinstance(routing_frame, dict)
        routing_frame["suggested_next_action"] = "out_of_scope"
        routing_frame["scope_class"] = "out_of_scope"
        routing_frame["policy_reason"] = "product_scope_boundary"
        summary = runtime_decisions["runtime_decision_summary"]
        assert isinstance(summary, dict)
        summary["routing_next_action"] = "out_of_scope"

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body=body,
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        self.assertIn("handoff", response.json_body["error"]["message"])

    def test_bridge_parser_parses_go_preplanned_knowledge_handoff(self) -> None:
        body = _bridge_v6_payload_with_handoff(
            user_goal="学生手册请假制度怎么规定？",
            request_id="req-go-preplanned-knowledge",
            trace_id="trace-go-preplanned-knowledge",
            effective_capability="knowledge",
            lane="rag",
            handoff_target="rag-agent",
            payload_kind="rag_request",
            allowed_tools=[],
            payload={
                "scope": {
                    "corpus": "regulations",
                    "collection": "student_rules",
                },
                "version_query": {
                    "mode": "compare",
                    "version_id": "v1:student-handbook",
                    "compare_to_version_id": "v2:student-handbook",
                },
            },
        )
        body["requested_scope"] = {
            "corpus": "regulations",
            "collection": "student_rules",
        }
        body["version_query"] = {
            "mode": "compare",
            "version_id": "v1:student-handbook",
            "compare_to_version_id": "v2:student-handbook",
        }

        envelope = parse_bridge_supervisor_envelope(body)

        self.assertEqual(envelope.request.requested_capability, "knowledge")
        self.assertIsNotNone(envelope.agent_request)
        assert envelope.agent_request is not None
        self.assertEqual(envelope.agent_request.target, "rag-agent")
        self.assertEqual(
            envelope.agent_request.payload,
            RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
                version_query=VersionQuery(
                    mode="compare",
                    version_id="v1:student-handbook",
                    compare_to_version_id="v2:student-handbook",
                ),
            ),
        )

    def test_bridge_answer_route_requires_bridge_auth(self) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            )
        )

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            json_body={},
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json_body["error"]["code"], "unauthorized")

    def test_bridge_answer_route_returns_bridge_invalid_request_header(self) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            )
        )

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body={
                "user_goal": "test",
                "trace": {"trace_id": "trace-001"},
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        self.assertEqual(
            response.headers["x-supervisor-bridge-kind"],
            "bridge_invalid_request",
        )

    def test_bridge_answer_route_returns_supervisor_error_header(self) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            ),
            agent_handler=lambda request: (_ for _ in ()).throw(
                MissingAgentDelegateError("missing delegate for agent target: rag-agent")
            ),
        )

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body=_bridge_v6_payload(request_id="req-supervisor-error"),
        )

        self.assertEqual(response.status_code, 500)
        self.assertEqual(
            response.headers["x-supervisor-bridge-kind"],
            "supervisor_error",
        )
        self.assertEqual(response.json_body["error"]["code"], "missing_agent_delegate")

    def test_bridge_readyz_requires_bridge_auth(self) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            )
        )

        response = app.handle("GET", "/internal/bridge/readyz")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json_body["error"]["code"], "unauthorized")

    def test_bridge_cancel_route_marks_active_execution_cancel_requested(self) -> None:
        started = threading.Event()
        release = threading.Event()
        answer_responses = []

        def fake_agent(request):
            started.set()
            release.wait(timeout=1.0)
            return AgentResponse(
                target=request.target,
                status="completed",
                answer_text="completed after cancel signal",
                confidence="medium",
            )

        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            ),
            agent_handler=fake_agent,
        )

        thread = threading.Thread(
            target=lambda: answer_responses.append(
                app.handle(
                    "POST",
                    "/internal/bridge/supervisor/answer",
                    headers={"x-supervisor-bridge-auth": "bridge-secret"},
                    json_body=_bridge_v6_payload(
                        user_goal="图书馆开门吗",
                        request_id="req-active-cancel",
                        trace_id="trace-active-cancel",
                    ),
                )
            )
        )
        thread.start()
        self.assertTrue(started.wait(timeout=1.0))

        response = app.handle(
            "POST",
            "/internal/bridge/execution/cancel",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body={
                "request_id": "req-active-cancel",
                "reason": "user_requested",
            },
        )

        release.set()
        thread.join(timeout=1.0)
        app.close()

        self.assertEqual(response.status_code, 202)
        self.assertEqual(response.json_body["status"], "cancel_requested")
        self.assertEqual(response.json_body["request_id"], "req-active-cancel")
        self.assertEqual(answer_responses[0].status_code, 499)
        self.assertEqual(answer_responses[0].json_body["error"]["code"], "execution_cancelled")

    def test_bridge_answer_wires_configured_campus_services_query_service(self) -> None:
        query_requests: list[dict[str, object]] = []

        class QueryHandler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                content_length = int(self.headers.get("content-length", "0"))
                query_requests.append(
                    {
                        "path": self.path,
                        "auth": self.headers.get("x-supervisor-query-auth"),
                        "body": json.loads(self.rfile.read(content_length).decode("utf-8")),
                    }
                )
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps(
                        {
                            "query_text": "最近一版校车时刻表是什么时候发布的",
                            "intent": "schedule_snapshot_metadata",
                            "outcome": "resolved_current",
                            "queried_time_anchor": "2026-04-24T10:30:00+08:00",
                            "schedule_snapshot": {
                                "snapshot_id": "snapshot:bus:2026-04-20",
                                "published_at": "2026-04-20T18:00:00+08:00",
                                "source_ref": "notice:bus-schedule-2026-04-20",
                            },
                        }
                    ).encode("utf-8")
                )

            def log_message(self, format: str, *args: object) -> None:
                return

        query_server = HTTPServer(("127.0.0.1", 0), QueryHandler)
        thread = threading.Thread(target=query_server.serve_forever, daemon=True)
        thread.start()
        app = None
        try:
            app = create_bridge_app(
                settings=ApiSettings(
                    bridge_shared_secret="bridge-secret",
                    structured_query_base_url=f"http://127.0.0.1:{query_server.server_port}",
                    structured_query_shared_secret="query-secret",
                    structured_query_timeout_seconds=0.75,
                )
            )
            response = app.handle(
                "POST",
                "/internal/bridge/supervisor/answer",
                headers={"x-supervisor-bridge-auth": "bridge-secret"},
                json_body=_bridge_v6_payload_with_handoff(
                    user_goal="最近一版校车时刻表是什么时候发布的",
                    request_id="req-campus-services-query",
                    trace_id="trace-campus-services-query",
                    effective_capability="campus_services",
                    lane="campus_services",
                    handoff_target="campus-services-agent",
                    payload_kind="transport_schedule_lookup",
                    allowed_tools=["transport_schedule_lookup"],
                    payload={
                        "query_text": "最近一版校车时刻表是什么时候发布的",
                        "intent": "schedule_snapshot_metadata",
                        "snapshot_query": {"mode": "current"},
                    },
                ),
            )
        finally:
            if app is not None:
                app.close()
            query_server.shutdown()
            query_server.server_close()
            thread.join(timeout=1.0)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json_body["target"], "campus-services-agent")
        self.assertEqual(response.json_body["status"], "completed")
        self.assertEqual(len(query_requests), 1)
        self.assertEqual(
            query_requests[0]["path"],
            "/internal/query/campus-services/transport-schedule",
        )
        self.assertEqual(query_requests[0]["auth"], "query-secret")
        self.assertEqual(query_requests[0]["body"]["intent"], "schedule_snapshot_metadata")

    def test_bridge_answer_uses_go_preplanned_structured_handoff_without_python_routing(
        self,
    ) -> None:
        query_requests: list[dict[str, object]] = []

        class QueryHandler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                content_length = int(self.headers.get("content-length", "0"))
                query_requests.append(json.loads(self.rfile.read(content_length).decode("utf-8")))
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps(
                        {
                            "query_text": "最早的班车几点",
                            "intent": "first_departure",
                            "outcome": "resolved_current",
                            "queried_time_anchor": "2026-04-25T08:00:00+08:00",
                            "resolved_route": {
                                "route_id": "route:fengtai",
                                "display_name": "海淀-丰台班车",
                                "service_family": "intercampus_commute",
                            },
                            "service_status": "running",
                            "selected_departure": {
                                "departure_at": "2026-04-26T07:30:00+08:00",
                            },
                        }
                    ).encode("utf-8")
                )

            def log_message(self, format: str, *args: object) -> None:
                return

        query_server = HTTPServer(("127.0.0.1", 0), QueryHandler)
        thread = threading.Thread(target=query_server.serve_forever, daemon=True)
        thread.start()
        app = None
        try:
            app = create_bridge_app(
                settings=ApiSettings(
                    bridge_shared_secret="bridge-secret",
                    structured_query_base_url=f"http://127.0.0.1:{query_server.server_port}",
                    structured_query_shared_secret="query-secret",
                    structured_query_timeout_seconds=0.75,
                )
            )
            response = app.handle(
                "POST",
                "/internal/bridge/supervisor/answer",
                headers={"x-supervisor-bridge-auth": "bridge-secret"},
                json_body=_bridge_v6_payload_with_handoff(
                    user_goal="最早的班车几点",
                    request_id="req-go-preplanned-transport",
                    trace_id="trace-go-preplanned-transport",
                    effective_capability="campus_services",
                    lane="campus_services",
                    handoff_target="campus-services-agent",
                    payload_kind="transport_schedule_lookup",
                    allowed_tools=["transport_schedule_lookup"],
                    payload={
                        "query_text": "最早的班车几点",
                        "intent": "first_departure",
                        "snapshot_query": {"mode": "current"},
                        "service_time_query": {
                            "date_mode": "tomorrow",
                            "daypart": "morning",
                        },
                    },
                ),
            )
        finally:
            if app is not None:
                app.close()
            query_server.shutdown()
            query_server.server_close()
            thread.join(timeout=1.0)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json_body["target"], "campus-services-agent")
        self.assertEqual(len(query_requests), 1)
        self.assertEqual(query_requests[0]["intent"], "first_departure")
        self.assertEqual(query_requests[0]["service_time_query"]["date_mode"], "tomorrow")

    def test_bridge_answer_wires_configured_notice_query_service(self) -> None:
        query_requests: list[dict[str, object]] = []

        class QueryHandler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                content_length = int(self.headers.get("content-length", "0"))
                query_requests.append(
                    {
                        "path": self.path,
                        "auth": self.headers.get("x-supervisor-query-auth"),
                        "body": json.loads(self.rfile.read(content_length).decode("utf-8")),
                    }
                )
                self.send_response(200)
                self.send_header("content-type", "application/json")
                self.end_headers()
                self.wfile.write(
                    json.dumps(
                        {
                            "query_text": "家具采购",
                            "outcome": "resolved_current",
                            "source_families": ["internal_notice_restricted"],
                            "notice_cards": [
                                {
                                    "notice_id": "355222",
                                    "title": "中央民族大学丰台校区家具采购项目比选公告",
                                    "source_family": "internal_notice_restricted",
                                    "source_url": "https://portal.example.edu/notices/355222",
                                }
                            ],
                            "queried_time_anchor": "2026-04-24T10:30:00+08:00",
                        }
                    ).encode("utf-8")
                )

            def log_message(self, format: str, *args: object) -> None:
                return

        query_server = HTTPServer(("127.0.0.1", 0), QueryHandler)
        thread = threading.Thread(target=query_server.serve_forever, daemon=True)
        thread.start()
        app = None
        try:
            app = create_bridge_app(
                settings=ApiSettings(
                    bridge_shared_secret="bridge-secret",
                    structured_query_base_url=f"http://127.0.0.1:{query_server.server_port}",
                    structured_query_shared_secret="query-secret",
                    structured_query_timeout_seconds=0.75,
                )
            )
            response = app.handle(
                "POST",
                "/internal/bridge/supervisor/answer",
                headers={"x-supervisor-bridge-auth": "bridge-secret"},
                json_body=_bridge_v6_payload_with_handoff(
                    user_goal="找一下家具采购通知",
                    request_id="req-notice-query",
                    trace_id="trace-notice-query",
                    effective_capability="notice",
                    lane="notice",
                    handoff_target="notice-agent",
                    payload_kind="campus_notice_discover",
                    allowed_tools=["campus_notice_discover"],
                    payload={
                        "query_text": "家具采购",
                        "temporal_query": {"mode": "current"},
                        "source_families": ["internal_notice_restricted"],
                    },
                    context={
                        "actor": {
                            "user_id": "student@example.edu",
                        },
                        "authorization": {
                            "principal_id": "principal-001",
                            "entitlement_groups": ["students"],
                            "retrieval_filter": {
                                "entitlement_groups": ["students"],
                                "visibility_level": "restricted",
                                "policy_projection_version": "phase1-authorization-projection-v1",
                            },
                        },
                    },
                ),
            )
        finally:
            if app is not None:
                app.close()
            query_server.shutdown()
            query_server.server_close()
            thread.join(timeout=1.0)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json_body["target"], "notice-agent")
        self.assertEqual(response.json_body["status"], "completed")
        self.assertEqual(len(query_requests), 1)
        self.assertEqual(query_requests[0]["path"], "/internal/query/notices/discover")
        self.assertEqual(query_requests[0]["auth"], "query-secret")
        self.assertEqual(query_requests[0]["body"]["payload"]["query_text"], "家具采购")
        self.assertEqual(
            query_requests[0]["body"]["access_context"]["authorization"]["retrieval_filter"][
                "visibility_level"
            ],
            "restricted",
        )
