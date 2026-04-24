from __future__ import annotations

import json
import tempfile
import time
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
        "user_goal": user_goal,
        "conversation_id": "conv-audit-001",
        "request_id": request_id,
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
    }


def _wait_for_audit_lines(
    audit_path: Path,
    *,
    expected_count: int,
    app: object | None = None,
    timeout_seconds: float = 1.0,
) -> list[str]:
    flush_audit = getattr(app, "flush_audit", None)
    if callable(flush_audit):
        flush_audit(timeout_seconds=timeout_seconds)
    deadline = time.monotonic() + timeout_seconds
    while time.monotonic() <= deadline:
        if audit_path.exists():
            lines = audit_path.read_text(encoding="utf-8").splitlines()
            if len(lines) >= expected_count:
                return lines
        time.sleep(0.01)
    return audit_path.read_text(encoding="utf-8").splitlines() if audit_path.exists() else []


class SupervisorApiAuditTest(unittest.TestCase):
    def test_bridge_answer_writes_projected_authz_summary_without_sensitive_context(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            audit_path = Path(tempdir) / "audit.log"
            app = create_bridge_app(
                settings=ApiSettings(
                    bridge_shared_secret="bridge-secret",
                    audit_log_path=audit_path,
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
            lines = _wait_for_audit_lines(audit_path, expected_count=1, app=app)
            self.assertEqual(len(lines), 1)
            payload = json.loads(lines[0])
            self.assertEqual(payload["request_id"], "req-audit-001")
            self.assertEqual(payload["trace_id"], "trace-audit-001")
            self.assertEqual(payload["user_id"], "student@example.edu")
            self.assertEqual(payload["principal_type"], "student")
            self.assertEqual(payload["authorization_projection_source"], "campus_identity")
            self.assertEqual(payload["entitlement_snapshot_id"], "entitlements-2026-03-29")
            self.assertEqual(
                payload["policy_projection_version"], "phase1-authorization-projection-v1"
            )
            self.assertEqual(payload["personalization_mode"], "user_grounded")
            self.assertEqual(payload["selected_target"], "rag-agent")
            self.assertEqual(payload["status"], "completed")
            self.assertIsNone(payload["error_code"])
            self.assertNotIn("entitlement_groups", payload)
            self.assertNotIn("visibility_scope", payload)
            self.assertNotIn("approval_state", payload)
            self.assertNotIn("profile_memory", payload)
            self.assertNotIn("session", payload)
            app.close()

    def test_bridge_answer_writes_error_audit_log_for_supervisor_error(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            audit_path = Path(tempdir) / "audit.log"
            app = create_bridge_app(
                settings=ApiSettings(
                    bridge_shared_secret="bridge-secret",
                    audit_log_path=audit_path,
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
            lines = _wait_for_audit_lines(audit_path, expected_count=1, app=app)
            self.assertEqual(len(lines), 1)
            payload = json.loads(lines[0])
            self.assertEqual(payload["request_id"], "req-audit-err")
            self.assertEqual(payload["status"], "error")
            self.assertEqual(payload["error_code"], "disallowed_knowledge_scope")
            self.assertTrue(payload["fail_closed"])
            self.assertNotIn("context", payload)
            self.assertNotIn("profile_memory", payload)
            app.close()

    def test_audit_write_failure_does_not_fail_bridge_answer_and_degrades_readyz(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            audit_path = Path(tempdir)
            app = create_bridge_app(
                settings=ApiSettings(
                    bridge_shared_secret="bridge-secret",
                    audit_log_path=audit_path,
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
            app.flush_audit(timeout_seconds=1.0)
            ready = app.handle(
                "GET",
                "/internal/bridge/readyz",
                headers={"x-supervisor-bridge-auth": "bridge-secret"},
            )

            self.assertEqual(response.status_code, 200)
            self.assertEqual(ready.status_code, 503)
            self.assertFalse(ready.json_body["audit_runtime"]["healthy"])
            self.assertIn(
                "failed to write audit log",
                ready.json_body["audit_runtime"]["last_error"],
            )
            app.close()
