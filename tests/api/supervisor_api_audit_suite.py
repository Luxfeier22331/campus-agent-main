from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from campus_contracts import AgentResponse, EvidenceBundle, RagResultPayload
from campus_supervisor_agent_worker.agent_dispatch import MissingAgentDelegateError
from campus_supervisor_agent_worker.app import create_bridge_app
from campus_supervisor_agent_worker.settings import ApiSettings


def _bridge_request_payload(
    *,
    user_goal: str = "library hours",
    request_id: str = "req-audit-001",
    trace_id: str = "trace-audit-001",
) -> dict[str, object]:
    return {
        "bridge_version": "supervisor_bridge_v6",
        "response_contract": "agent_response",
        "user_goal": user_goal,
        "conversation_id": "conv-audit-001",
        "request_id": request_id,
        "effective_capability": "knowledge",
        "lane": "rag",
        "trace": {"trace_id": trace_id},
        "actor": {
            "user_id": "student@example.edu",
            "principal_id": "principal-001",
            "principal_type": "student",
            "roles": ["student"],
            "cohort": "2023",
            "major": "philosophy",
        },
        "context": {
            "actor": {
                "user_id": "student@example.edu",
                "principal_id": "principal-001",
                "principal_type": "student",
                "roles": ["student"],
                "cohort": "2023",
                "major": "philosophy",
            },
            "authorization": {
                "principal_id": "principal-001",
                "projection_source": "campus_identity",
                "entitlement_snapshot_id": "entitlements-2026-03-29",
                "entitlement_groups": ["students", "library"],
                "visibility_scope": "north",
                "applicability_scope": "undergraduate",
                "ownership_scopes": ["conversation:student@example.edu"],
                "approval_state": "not_required",
                "retrieval_filter": {
                    "entitlement_groups": ["students", "library"],
                    "visibility_level": "restricted",
                    "visibility_scope": "north",
                    "policy_projection_version": "phase1-authorization-projection-v1",
                },
            },
            "profile_memory": {
                "items": [
                    {
                        "item_id": "memory-001",
                        "key": "recent_goal",
                        "value": "咨询保研",
                        "source_type": "user_declared",
                        "confidence": "high",
                        "visibility": "user_visible",
                        "last_verified_at": "2026-03-28",
                    }
                ]
            },
            "session": {
                "confirmed_slots": [
                    {"name": "policy_topic", "value": "推免资格", "confirmed": True}
                ],
                "turn_count": 2,
            },
        },
        "requested_scope": {
            "corpus": "regulations",
            "collection": "student_rules",
        },
        "requested_capability": "knowledge",
        "version_query": {"mode": "current"},
        "runtime_decisions": {
            "schema_version": "supervisor-runtime-decisions-v1",
            "effective_capability": "knowledge",
            "lane": "rag",
            "scope_gate": {
                "decision": "in_scope",
                "reason": "explicit_requested_scope",
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
            "tool_policy": {"policy_version": "runtime-policy-v1"},
            "runtime_decision_summary": {
                "schema_version": "runtime-decision-summary-v1",
                "scope_gate_decision": "in_scope",
                "policy_gate_decision": "delegate",
                "context_preflight_state": "not_follow_up",
                "routing_next_action": "delegate",
                "planning_outcome": "preplanned",
            },
            "routing_frame": {
                "capability": "knowledge",
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
                "scope_reason": "explicit_requested_scope",
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
            "handoff": {
                "planning_outcome": "preplanned",
                "target": "rag-agent",
                "allowed_tools": [],
                "agent_request": {
                    "target": "rag-agent",
                    "user_goal": user_goal,
                    "conversation_id": "conv-audit-001",
                    "request_id": request_id,
                    "safety_identifier": None,
                    "trace": {"trace_id": trace_id},
                    "actor": {
                        "user_id": "student@example.edu",
                        "principal_id": "principal-001",
                        "principal_type": "student",
                        "roles": ["student"],
                        "cohort": "2023",
                        "major": "philosophy",
                    },
                    "context": {
                        "actor": {
                            "user_id": "student@example.edu",
                            "principal_id": "principal-001",
                            "principal_type": "student",
                            "roles": ["student"],
                            "cohort": "2023",
                            "major": "philosophy",
                        },
                        "authorization": {
                            "principal_id": "principal-001",
                            "projection_source": "campus_identity",
                            "entitlement_snapshot_id": "entitlements-2026-03-29",
                            "entitlement_groups": ["students", "library"],
                            "visibility_scope": "north",
                            "applicability_scope": "undergraduate",
                            "ownership_scopes": ["conversation:student@example.edu"],
                            "approval_state": "not_required",
                            "retrieval_filter": {
                                "entitlement_groups": ["students", "library"],
                                "visibility_level": "restricted",
                                "visibility_scope": "north",
                                "policy_projection_version": "phase1-authorization-projection-v1",
                            },
                        },
                        "profile_memory": {
                            "items": [
                                {
                                    "item_id": "memory-001",
                                    "key": "recent_goal",
                                    "value": "咨询保研",
                                    "source_type": "user_declared",
                                    "confidence": "high",
                                    "visibility": "user_visible",
                                    "last_verified_at": "2026-03-28",
                                }
                            ]
                        },
                        "session": {
                            "confirmed_slots": [
                                {
                                    "name": "policy_topic",
                                    "value": "推免资格",
                                    "confirmed": True,
                                }
                            ],
                            "turn_count": 2,
                        },
                    },
                    "payload": {
                        "kind": "rag_request",
                        "payload": {
                            "scope": {
                                "corpus": "regulations",
                                "collection": "student_rules",
                            },
                            "version_query": {"mode": "current"},
                        },
                    },
                    "allowed_tools": [],
                    "workflow_context": {
                        "schema_version": "workflow-agent-context-v1",
                        "visibility": "agent_private",
                        "workflow_run_ref": f"workflow:{request_id}",
                        "step_id": "handoff:rag-agent:rag_request",
                        "agent_id": "rag-agent",
                        "target": "rag-agent",
                        "required_projection_kind": "",
                        "expected_output_artifacts": [
                            "evidence_bundle",
                            "grounding_verdict",
                        ],
                        "projection_refs": [],
                    },
                },
            },
            "workflow_plan": {
                "schema_version": "workflow-plan-v1",
                "plan_id": "plan:single_step:rag-agent:rag_request",
                "workflow_mode": "single_step",
                "allowed_agents": ["rag-agent"],
                "steps": [
                    {
                        "step_id": "handoff:rag-agent:rag_request",
                        "step_kind": "handoff",
                        "target": "rag-agent",
                        "payload_kind": "rag_request",
                        "allowed_tools": [],
                        "selected_tool": "",
                    }
                ],
                "edges": [],
                "terminal_policy": {"fail_close_on_invalid_plan": True},
                "resume_policy": {"resume_supported": False},
                "semantic_retry_policy": {"max_replans": 0},
            },
        },
    }


class SupervisorApiAuditTest(unittest.TestCase):
    def test_bridge_answer_does_not_write_local_python_audit_log(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            audit_path = Path(tempdir) / "audit.log"
            app = create_bridge_app(
                settings=ApiSettings(
                    bridge_shared_secret="bridge-secret",
                ),
                agent_handler=lambda request: AgentResponse(
                    target=request.target,
                    status="completed",
                    answer_text="按当前投影处理完成。",
                    confidence="high",
                    result=RagResultPayload(
                        evidence=EvidenceBundle(
                            query_text=request.user_goal,
                            corpus="regulations",
                            collection="student_rules",
                        )
                    ),
                ),
            )

            response = app.handle(
                "POST",
                "/internal/bridge/supervisor/answer",
                headers={"x-supervisor-bridge-auth": "bridge-secret"},
                json_body=_bridge_request_payload(),
            )

            self.assertEqual(response.status_code, 200)
            self.assertFalse(audit_path.exists())
            app.close()

    def test_bridge_error_does_not_write_local_python_audit_log(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            audit_path = Path(tempdir) / "audit.log"
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
                json_body=_bridge_request_payload(
                    user_goal="培养方案要求",
                    request_id="req-audit-err",
                    trace_id="trace-audit-err",
                ),
            )

            self.assertEqual(response.status_code, 500)
            self.assertFalse(audit_path.exists())
            app.close()

    def test_python_audit_path_does_not_degrade_bridge_readyz(self) -> None:
        with tempfile.TemporaryDirectory():
            app = create_bridge_app(
                settings=ApiSettings(
                    bridge_shared_secret="bridge-secret",
                    runtime_provider="openai-responses",
                    prompt_runtime_provider="openai-responses",
                    prompt_runtime_api_key="test-key",
                    supervisor_prompt_model="gpt-supervisor",
                    agent_prompt_model="gpt-agent",
                ),
                agent_handler=lambda request: AgentResponse(
                    target=request.target,
                    status="completed",
                    answer_text="The library is open from 08:00 to 22:00.",
                    confidence="high",
                ),
            )

            response = app.handle(
                "POST",
                "/internal/bridge/supervisor/answer",
                headers={"x-supervisor-bridge-auth": "bridge-secret"},
                json_body=_bridge_request_payload(
                    request_id="req-audit-failure",
                    trace_id="trace-audit-failure",
                ),
            )
            ready = app.handle(
                "GET",
                "/internal/bridge/readyz",
                headers={"x-supervisor-bridge-auth": "bridge-secret"},
            )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(ready.status_code, 200)
            self.assertNotIn("audit_runtime", ready.json_body)
            app.close()
