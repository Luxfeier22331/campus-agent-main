from __future__ import annotations

import json
import tempfile
import time
import unittest
from functools import partial
from pathlib import Path

from campus_contracts import (
    ActorContext,
    EvidenceBundle,
    RagResultPayload,
    SpecialistRequest,
    SpecialistResponse,
    SupervisorResponse,
)
from campus_supervisor_api.app import create_app
from campus_supervisor_api.settings import ApiSettings
from campus_supervisor_core import (
    DisallowedKnowledgeScopeError,
    handle_request,
)


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
    def test_answer_route_writes_success_audit_log(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            audit_path = Path(tempdir) / "audit.log"
            app = create_app(
                settings=ApiSettings(
                    auth_mode="bearer",
                    bearer_token="secret-token",
                    default_actor_id="runtime-bearer-user",
                    audit_log_path=audit_path,
                ),
                supervisor_handler=lambda request: SupervisorResponse(
                    selected_target="rag-agent",
                    status="completed",
                    answer_text="The library is open from 08:00 to 22:00.",
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
                "/api/v1/answer",
                headers={
                    "authorization": "Bearer secret-token",
                    "x-trace-id": "trace-audit-001",
                    "x-actor-id": "student-001",
                },
                json_body={
                    "user_goal": "library hours",
                    "request_id": "req-audit-001",
                    "requested_scope": {
                        "corpus": "regulations",
                        "collection": "student_rules",
                    },
                },
            )

            self.assertEqual(response.status_code, 200)
            lines = _wait_for_audit_lines(audit_path, expected_count=1, app=app)
            self.assertEqual(len(lines), 1)
            payload = json.loads(lines[0])
            self.assertEqual(payload["request_id"], "req-audit-001")
            self.assertEqual(payload["trace_id"], "trace-audit-001")
            self.assertEqual(payload["user_id"], "runtime-bearer-user")
            self.assertEqual(payload["principal_type"], "")
            self.assertEqual(payload["authorization_projection_source"], "")
            self.assertEqual(payload["entitlement_snapshot_id"], "")
            self.assertEqual(
                payload["policy_projection_version"], "phase1-authorization-projection-v1"
            )
            self.assertEqual(payload["personalization_mode"], "generic")
            self.assertEqual(payload["selected_target"], "rag-agent")
            self.assertEqual(payload["status"], "completed")
            self.assertIsNone(payload["error_code"])
            self.assertEqual(payload["evidence_source_count"], 0)
            self.assertFalse(payload["follow_up_emitted"])
            self.assertFalse(payload["fail_closed"])
            self.assertEqual(
                set(payload),
                {
                    "recorded_at",
                    "request_id",
                    "trace_id",
                    "user_id",
                    "principal_type",
                    "authorization_projection_source",
                    "entitlement_snapshot_id",
                    "policy_projection_version",
                    "personalization_mode",
                    "selected_target",
                    "requested_capability",
                    "requested_scope_corpus",
                    "requested_scope_collection",
                    "status",
                    "error_code",
                    "source_doc_ids",
                    "evidence_source_count",
                    "follow_up_emitted",
                    "fail_closed",
                },
            )
            for forbidden_key in (
                "principal_id",
                "roles",
                "groups",
                "campus_scope",
                "context",
                "profile_memory",
                "session",
                "raw_transcript",
            ):
                self.assertNotIn(forbidden_key, payload)

    def test_answer_route_writes_projected_authz_summary_without_sensitive_context(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            audit_path = Path(tempdir) / "audit.log"
            app = create_app(
                settings=ApiSettings(
                    auth_mode="trusted-worker",
                    worker_shared_secret="worker-secret",
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
                "/api/v1/answer",
                headers={
                    "x-worker-origin-auth": "worker-secret",
                    "x-trace-id": "trace-projected-audit-001",
                },
                json_body={
                    "user_goal": "保研政策怎么准备？",
                    "request_id": "req-projected-audit-001",
                    "requested_scope": {
                        "corpus": "regulations",
                        "collection": "student_rules",
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
                },
            )

            self.assertEqual(response.status_code, 200)
            lines = _wait_for_audit_lines(audit_path, expected_count=1, app=app)
            self.assertEqual(len(lines), 1)
            payload = json.loads(lines[0])
            self.assertEqual(payload["request_id"], "req-projected-audit-001")
            self.assertEqual(payload["trace_id"], "trace-projected-audit-001")
            self.assertEqual(payload["user_id"], "student@example.edu")
            self.assertEqual(payload["principal_type"], "student")
            self.assertEqual(payload["authorization_projection_source"], "campus_identity")
            self.assertEqual(payload["entitlement_snapshot_id"], "entitlements-2026-03-29")
            self.assertEqual(
                payload["policy_projection_version"], "phase1-authorization-projection-v1"
            )
            self.assertEqual(payload["personalization_mode"], "user_grounded")
            self.assertEqual(payload["selected_target"], "rag-agent")
            self.assertNotIn("entitlement_groups", payload)
            self.assertNotIn("visibility_scope", payload)
            self.assertNotIn("approval_state", payload)
            self.assertNotIn("profile_memory", payload)
            self.assertNotIn("session", payload)

    def test_answer_route_writes_error_audit_log_for_supervisor_error(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            audit_path = Path(tempdir) / "audit.log"
            app = create_app(
                settings=ApiSettings(
                    auth_mode="bearer",
                    bearer_token="secret-token",
                    default_actor_id="runtime-bearer-user",
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
                "/api/v1/answer",
                headers={"authorization": "Bearer secret-token", "x-trace-id": "trace-audit-err"},
                json_body={
                    "user_goal": "培养方案要求",
                    "request_id": "req-audit-err",
                    "requested_scope": {
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                    },
                },
            )

            self.assertEqual(response.status_code, 403)
            lines = _wait_for_audit_lines(audit_path, expected_count=1, app=app)
            self.assertEqual(len(lines), 1)
            payload = json.loads(lines[0])
            self.assertEqual(payload["request_id"], "req-audit-err")
            self.assertEqual(payload["principal_type"], "")
            self.assertEqual(payload["authorization_projection_source"], "")
            self.assertEqual(payload["entitlement_snapshot_id"], "")
            self.assertEqual(
                payload["policy_projection_version"], "phase1-authorization-projection-v1"
            )
            self.assertEqual(payload["personalization_mode"], "generic")
            self.assertEqual(payload["selected_target"], "rag-agent")
            self.assertEqual(payload["status"], "error")
            self.assertEqual(payload["error_code"], "disallowed_knowledge_scope")
            self.assertEqual(payload["evidence_source_count"], 0)
            self.assertFalse(payload["follow_up_emitted"])
            self.assertTrue(payload["fail_closed"])
            self.assertNotIn("context", payload)
            self.assertNotIn("profile_memory", payload)

    def test_bearer_mode_does_not_promote_legacy_actor_headers_into_specialist_handoff(
        self,
    ) -> None:
        captured_specialist_requests: list[SpecialistRequest] = []

        def fake_rag_specialist(request):
            captured_specialist_requests.append(request)
            return SpecialistResponse(
                target="rag-agent",
                status="completed",
                answer_text="Projected through supervisor.",
                confidence="high",
            )

        app = create_app(
            settings=ApiSettings(
                auth_mode="bearer",
                bearer_token="secret-token",
                default_actor_id="runtime-bearer-user",
                default_actor_roles=("student",),
            ),
            supervisor_handler=partial(
                handle_request,
                specialist_delegates={"rag-agent": fake_rag_specialist},
            ),
        )

        response = app.handle(
            "POST",
            "/api/v1/answer",
            headers={
                "authorization": "Bearer secret-token",
                "x-actor-id": "student-001",
                "x-actor-groups": "students,library",
                "x-campus-scope": "north",
            },
            json_body={
                "user_goal": "library hours",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_rules",
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(captured_specialist_requests[0].actor.user_id, "runtime-bearer-user")
        self.assertEqual(
            captured_specialist_requests[0].actor,
            ActorContext(
                user_id="runtime-bearer-user",
                roles=("student",),
            ),
        )

    def test_audit_write_failure_does_not_fail_answer_and_degrades_readyz(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            audit_path = Path(tempdir)
            app = create_app(
                settings=ApiSettings(
                    auth_mode="bearer",
                    bearer_token="secret-token",
                    default_actor_id="runtime-bearer-user",
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
                "/api/v1/answer",
                headers={
                    "authorization": "Bearer secret-token",
                    "x-trace-id": "trace-audit-failure",
                },
                json_body={
                    "user_goal": "library hours",
                    "request_id": "req-audit-failure",
                    "requested_scope": {
                        "corpus": "regulations",
                        "collection": "student_rules",
                    },
                },
            )
            app.flush_audit(timeout_seconds=1.0)
            ready = app.handle("GET", "/readyz")

            self.assertEqual(response.status_code, 200)
            self.assertEqual(ready.status_code, 503)
            self.assertFalse(ready.json_body["audit_runtime"]["healthy"])
            self.assertIn(
                "failed to write audit log",
                ready.json_body["audit_runtime"]["last_error"],
            )
            app.close()
