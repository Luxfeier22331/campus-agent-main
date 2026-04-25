from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from campus_contracts import EvidenceBundle, RagResultPayload, SupervisorResponse
from campus_supervisor_core import DisallowedKnowledgeScopeError
from campus_supervisor_core_worker.app import create_bridge_app
from campus_supervisor_core_worker.settings import ApiSettings


def _bridge_request_payload(
    *,
    user_goal: str = "library hours",
    request_id: str = "req-audit-001",
    trace_id: str = "trace-audit-001",
) -> dict[str, object]:
    return {
        "bridge_version": "supervisor_bridge_v2",
        "user_goal": user_goal,
        "conversation_id": "conv-audit-001",
        "request_id": request_id,
        "effective_capability": "knowledge",
        "lane": "rag",
        "trace": {"trace_id": trace_id},
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
            "effective_capability": "knowledge",
            "lane": "rag",
            "planning_outcome": "not_preplanned",
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
                supervisor_handler=lambda request: SupervisorResponse(
                    selected_target="rag-agent",
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
            self.assertTrue(app.flush_audit(timeout_seconds=1.0))
            self.assertFalse(audit_path.exists())
            app.close()

    def test_bridge_error_does_not_write_local_python_audit_log(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            audit_path = Path(tempdir) / "audit.log"
            app = create_bridge_app(
                settings=ApiSettings(
                    bridge_shared_secret="bridge-secret",
                ),
                supervisor_handler=lambda request: (_ for _ in ()).throw(
                    DisallowedKnowledgeScopeError(
                        "knowledge scope curriculum/curriculum_plan is not query-enabled"
                    )
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

            self.assertEqual(response.status_code, 403)
            self.assertTrue(app.flush_audit(timeout_seconds=1.0))
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
                    specialist_prompt_model="gpt-specialist",
                ),
                supervisor_handler=lambda request: SupervisorResponse(
                    selected_target="rag-agent",
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
            self.assertTrue(app.flush_audit(timeout_seconds=1.0))
            ready = app.handle(
                "GET",
                "/internal/bridge/readyz",
                headers={"x-supervisor-bridge-auth": "bridge-secret"},
            )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(ready.status_code, 200)
            self.assertNotIn("audit_runtime", ready.json_body)
            app.close()
