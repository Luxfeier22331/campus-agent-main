from __future__ import annotations

import base64
from dataclasses import asdict
from functools import partial
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from campus_contracts import (
    ErrorInfo,
    EvidenceBundle,
    KnowledgeScope,
    RagResultPayload,
    SpecialistRequest,
    SpecialistResponse,
    SupervisorRequest,
    TraceContext,
)
from campus_supervisor_core import (
    DisallowedKnowledgeScopeError,
    InvalidSupervisorRequestError,
    handle_request,
)
from campus_supervisor_api.api import HttpResponse
from campus_supervisor_api.app import create_app
from campus_supervisor_api.settings import ApiSettings


class SupervisorApiTest(unittest.TestCase):
    def test_answer_route_maps_auth_trace_and_response_shape(self) -> None:
        captured_requests: list[SupervisorRequest] = []

        def fake_supervisor(request: SupervisorRequest) -> SpecialistResponse:
            captured_requests.append(request)
            return SpecialistResponse(
                target="rag-specialist",
                status="completed",
                answer_text="The library is open from 08:00 to 22:00.",
                confidence="medium",
                result=RagResultPayload(
                    evidence=EvidenceBundle(
                        query_text=request.user_goal,
                        corpus="regulations",
                        collection="student_handbook",
                    )
                ),
            )

        app = create_app(
            settings=ApiSettings(
                app_name="campus-agent-v2",
                auth_mode="bearer",
                bearer_token="secret-token",
                default_actor_id="api-bearer-user",
                default_actor_groups=("students",),
                default_actor_roles=("student",),
                default_campus_scope="north",
            ),
            supervisor_handler=fake_supervisor,
        )

        response = app.handle(
            "POST",
            "/api/v1/answer",
            headers={
                "Authorization": "Bearer secret-token",
                "X-Trace-Id": "trace-001",
                "X-Actor-Id": "student-001",
            },
            json_body={
                "user_goal": "library hours",
                "conversation_id": "conv-001",
                "request_id": "req-001",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_handbook",
                },
            },
        )

        self.assertIsInstance(response, HttpResponse)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json_body["trace_id"], "trace-001")
        self.assertEqual(response.json_body["target"], "rag-specialist")
        self.assertEqual(response.json_body["status"], "completed")
        self.assertEqual(
            response.json_body["answer_text"],
            "The library is open from 08:00 to 22:00.",
        )
        self.assertEqual(captured_requests[0].user_goal, "library hours")
        self.assertEqual(captured_requests[0].conversation_id, "conv-001")
        self.assertEqual(captured_requests[0].request_id, "req-001")
        self.assertEqual(captured_requests[0].trace, TraceContext(trace_id="trace-001"))
        self.assertEqual(captured_requests[0].actor.user_id, "api-bearer-user")
        self.assertEqual(captured_requests[0].actor.groups, ("students",))
        self.assertEqual(captured_requests[0].actor.roles, ("student",))
        self.assertEqual(captured_requests[0].actor.campus_scope, "north")
        self.assertEqual(
            captured_requests[0].requested_scope,
            KnowledgeScope(
                corpus="regulations",
                collection="student_handbook",
            ),
        )
        self.assertIsNone(captured_requests[0].requested_capability)
        self.assertIsNone(captured_requests[0].availability_target_id)

    def test_answer_route_maps_explicit_availability_hint_without_constructing_specialist_payload(self) -> None:
        captured_requests: list[SupervisorRequest] = []

        def fake_supervisor(request: SupervisorRequest) -> SpecialistResponse:
            captured_requests.append(request)
            return SpecialistResponse(
                target="availability-specialist",
                status="completed",
                answer_text="Website is reachable.",
                confidence="medium",
            )

        app = create_app(
            settings=ApiSettings(
                auth_mode="bearer",
                bearer_token="secret-token",
            ),
            supervisor_handler=fake_supervisor,
        )

        response = app.handle(
            "POST",
            "/api/v1/answer",
            headers={"authorization": "Bearer secret-token"},
            json_body={
                "user_goal": "Is the website up?",
                "requested_capability": "availability",
                "availability_target_id": "official-homepage",
                "follow_redirects": False,
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(captured_requests[0].requested_capability, "availability")
        self.assertEqual(captured_requests[0].availability_target_id, "official-homepage")
        self.assertFalse(captured_requests[0].follow_redirects)
        self.assertIsNone(captured_requests[0].requested_scope)

    def test_answer_route_projects_supervisor_response_without_orchestration_logic(self) -> None:
        def fake_supervisor(request: SupervisorRequest) -> SpecialistResponse:
            return SpecialistResponse(
                target="rag-specialist",
                status="error",
                confidence="low",
                error=ErrorInfo(
                    code="retrieval_failed",
                    message="retrieval backend unavailable",
                    retryable=False,
                ),
            )

        app = create_app(
            settings=ApiSettings(
                auth_mode="bearer",
                bearer_token="secret-token",
            ),
            supervisor_handler=fake_supervisor,
        )

        response = app.handle(
            "POST",
            "/api/v1/answer",
            headers={"authorization": "Bearer secret-token", "x-trace-id": "trace-001"},
            json_body={
                "user_goal": "library hours",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_handbook",
                },
            },
        )

        expected_payload = asdict(
            SpecialistResponse(
                target="rag-specialist",
                status="error",
                confidence="low",
                error=ErrorInfo(
                    code="retrieval_failed",
                    message="retrieval backend unavailable",
                    retryable=False,
                ),
            )
        )
        expected_payload["trace_id"] = "trace-001"

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json_body, expected_payload)

    def test_create_app_dispatches_normalized_headers_only_through_supervisor_handler(self) -> None:
        captured_requests: list[SupervisorRequest] = []

        def fake_supervisor(request: SupervisorRequest) -> SpecialistResponse:
            captured_requests.append(request)
            return SpecialistResponse(
                target="rag-specialist",
                status="completed",
                answer_text="Projected from supervisor-core.",
                confidence="high",
            )

        app = create_app(
            settings=ApiSettings(
                auth_mode="bearer",
                bearer_token="secret-token",
                default_actor_id="api-bearer-user",
                default_actor_groups=("students",),
                default_actor_roles=("student",),
            ),
            supervisor_handler=fake_supervisor,
        )

        response = app.handle(
            "post",
            "/api/v1/answer",
            headers={
                "AUTHORIZATION": "Bearer secret-token",
                "X-TRACE-ID": "trace-uppercase",
                "X-ACTOR-ID": "student-uppercase",
            },
            json_body={
                "user_goal": "when is registration",
                "request_id": "req-uppercase",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_handbook",
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json_body["trace_id"], "trace-uppercase")
        self.assertEqual(response.json_body["answer_text"], "Projected from supervisor-core.")
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(captured_requests[0].trace, TraceContext(trace_id="trace-uppercase"))
        self.assertEqual(captured_requests[0].actor.user_id, "api-bearer-user")

    def test_bearer_mode_ignores_client_supplied_actor_headers(self) -> None:
        captured_requests: list[SupervisorRequest] = []

        def fake_supervisor(request: SupervisorRequest) -> SpecialistResponse:
            captured_requests.append(request)
            return SpecialistResponse(
                target="rag-specialist",
                status="completed",
                answer_text="Projected from supervisor-core.",
                confidence="high",
            )

        app = create_app(
            settings=ApiSettings(
                auth_mode="bearer",
                bearer_token="secret-token",
                default_actor_id="runtime-bearer-user",
                default_actor_groups=("students",),
                default_actor_roles=("student",),
                default_campus_scope="north",
            ),
            supervisor_handler=fake_supervisor,
        )

        response = app.handle(
            "POST",
            "/api/v1/answer",
            headers={
                "authorization": "Bearer secret-token",
                "x-actor-id": "spoofed-user",
                "x-actor-groups": "spoofed-group",
                "x-actor-roles": "spoofed-role",
                "x-campus-scope": "spoofed-scope",
            },
            json_body={
                "user_goal": "library hours",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_handbook",
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(captured_requests[0].actor.user_id, "runtime-bearer-user")
        self.assertEqual(captured_requests[0].actor.groups, ("students",))
        self.assertEqual(captured_requests[0].actor.roles, ("student",))
        self.assertEqual(captured_requests[0].actor.campus_scope, "north")

    def test_answer_route_rejects_invalid_bearer_token(self) -> None:
        app = create_app(settings=ApiSettings(bearer_token="secret-token"))

        response = app.handle(
            "POST",
            "/api/v1/answer",
            headers={"authorization": "Bearer wrong-token"},
            json_body={"user_goal": "library hours"},
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json_body["error"]["code"], "unauthorized")

    def test_answer_route_writes_success_audit_log(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            audit_path = Path(tempdir) / "audit.log"
            app = create_app(
                settings=ApiSettings(
                    auth_mode="bearer",
                    bearer_token="secret-token",
                    default_actor_id="runtime-bearer-user",
                    default_actor_groups=("students",),
                    audit_log_path=audit_path,
                ),
                supervisor_handler=lambda request: SpecialistResponse(
                    target="rag-specialist",
                    status="completed",
                    answer_text="The library is open from 08:00 to 22:00.",
                    confidence="high",
                    result=RagResultPayload(
                        evidence=EvidenceBundle(
                            query_text=request.user_goal,
                            corpus="regulations",
                            collection="student_handbook",
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
                        "collection": "student_handbook",
                    },
                },
            )

            self.assertEqual(response.status_code, 200)
            lines = audit_path.read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(lines), 1)
            payload = json.loads(lines[0])
            self.assertEqual(payload["request_id"], "req-audit-001")
            self.assertEqual(payload["trace_id"], "trace-audit-001")
            self.assertEqual(payload["user_id"], "runtime-bearer-user")
            self.assertEqual(payload["selected_target"], "rag-specialist")
            self.assertEqual(payload["status"], "completed")
            self.assertIsNone(payload["error_code"])

    def test_answer_route_writes_error_audit_log_for_supervisor_error(self) -> None:
        with tempfile.TemporaryDirectory() as tempdir:
            audit_path = Path(tempdir) / "audit.log"
            app = create_app(
                settings=ApiSettings(
                    auth_mode="bearer",
                    bearer_token="secret-token",
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
            lines = audit_path.read_text(encoding="utf-8").splitlines()
            self.assertEqual(len(lines), 1)
            payload = json.loads(lines[0])
            self.assertEqual(payload["request_id"], "req-audit-err")
            self.assertEqual(payload["selected_target"], "rag-specialist")
            self.assertEqual(payload["status"], "error")
            self.assertEqual(payload["error_code"], "disallowed_knowledge_scope")

    def test_actor_groups_reach_specialist_handoff_for_acl_filtering(self) -> None:
        captured_specialist_requests: list[SpecialistRequest] = []

        def fake_rag_specialist(request):
            captured_specialist_requests.append(request)
            return SpecialistResponse(
                target="rag-specialist",
                status="completed",
                answer_text="Projected through supervisor.",
                confidence="high",
            )

        app = create_app(
            settings=ApiSettings(
                auth_mode="bearer",
                bearer_token="secret-token",
                default_actor_id="runtime-bearer-user",
                default_actor_groups=("students",),
                default_actor_roles=("student",),
                default_campus_scope="north",
            ),
            supervisor_handler=partial(
                handle_request,
                specialist_delegates={"rag-specialist": fake_rag_specialist},
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
                    "collection": "student_handbook",
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(captured_specialist_requests[0].actor.user_id, "runtime-bearer-user")
        self.assertEqual(captured_specialist_requests[0].actor.groups, ("students",))
        self.assertEqual(captured_specialist_requests[0].actor.campus_scope, "north")

    def test_answer_route_accepts_trusted_worker_origin_auth(self) -> None:
        captured_requests: list[SupervisorRequest] = []

        def fake_supervisor(request: SupervisorRequest) -> SpecialistResponse:
            captured_requests.append(request)
            return SpecialistResponse(
                target="rag-specialist",
                status="completed",
                answer_text="Worker path reached supervisor.",
                confidence="high",
            )

        app = create_app(
            settings=ApiSettings(
                auth_mode="trusted-worker",
                worker_shared_secret="worker-secret",
                worker_actor_id="public-entry-worker",
                default_actor_groups=("public-entry",),
                default_actor_roles=("runtime",),
                default_campus_scope="north",
                trusted_jwt_groups_claims=("groups",),
                trusted_jwt_roles_claims=("roles",),
            ),
            supervisor_handler=fake_supervisor,
        )

        response = app.handle(
            "POST",
            "/api/v1/answer",
            headers={
                "x-worker-origin-auth": "worker-secret",
                "x-actor-id": "spoofed-user",
                "x-actor-groups": "spoofed-group",
                "x-actor-roles": "spoofed-role",
                "x-campus-scope": "spoofed-scope",
                "cf-access-jwt-assertion": _make_jwt(
                    {
                        "email": "student@example.edu",
                        "sub": "student-sub-001",
                        "groups": ["students", "library"],
                        "roles": ["member"],
                    }
                ),
            },
            json_body={
                "user_goal": "library hours",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_handbook",
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(captured_requests[0].actor.user_id, "student@example.edu")
        self.assertEqual(captured_requests[0].actor.groups, ("students", "library"))
        self.assertEqual(captured_requests[0].actor.roles, ("member",))
        self.assertEqual(captured_requests[0].actor.campus_scope, "north")

    def test_answer_route_rejects_missing_trusted_worker_secret(self) -> None:
        app = create_app(
            settings=ApiSettings(
                auth_mode="trusted-worker",
                worker_shared_secret="worker-secret",
            )
        )

        response = app.handle(
            "POST",
            "/api/v1/answer",
            headers={},
            json_body={"user_goal": "library hours"},
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json_body["error"]["code"], "unauthorized")

    def test_answer_route_rejects_invalid_trusted_worker_secret(self) -> None:
        app = create_app(
            settings=ApiSettings(
                auth_mode="trusted-worker",
                worker_shared_secret="worker-secret",
            )
        )

        response = app.handle(
            "POST",
            "/api/v1/answer",
            headers={"x-worker-origin-auth": "wrong-secret"},
            json_body={"user_goal": "library hours"},
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json_body["error"]["code"], "unauthorized")

    def test_answer_route_returns_400_for_conflicting_supervisor_inputs(self) -> None:
        app = create_app(
            settings=ApiSettings(
                auth_mode="bearer",
                bearer_token="secret-token",
            ),
            supervisor_handler=lambda request: (_ for _ in ()).throw(
                InvalidSupervisorRequestError(
                    "requested_scope and availability_target_id cannot be combined without an explicit capability"
                )
            ),
        )

        response = app.handle(
            "POST",
            "/api/v1/answer",
            headers={"authorization": "Bearer secret-token"},
            json_body={
                "user_goal": "test",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_handbook",
                },
            },
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_supervisor_request")

    def test_answer_route_returns_403_for_query_disabled_scope(self) -> None:
        app = create_app(
            settings=ApiSettings(
                auth_mode="bearer",
                bearer_token="secret-token",
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
            headers={"authorization": "Bearer secret-token"},
            json_body={
                "user_goal": "test",
                "requested_scope": {
                    "corpus": "curriculum",
                    "collection": "curriculum_plan",
                },
            },
        )

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json_body["error"]["code"], "disallowed_knowledge_scope")

    def test_answer_route_returns_400_for_missing_routing_input(self) -> None:
        app = create_app(
            settings=ApiSettings(
                auth_mode="bearer",
                bearer_token="secret-token",
            ),
        )

        response = app.handle(
            "POST",
            "/api/v1/answer",
            headers={"authorization": "Bearer secret-token"},
            json_body={"user_goal": "test"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "missing_routing_input")

    def test_health_and_ready_routes_exist(self) -> None:
        app = create_app(
            settings=ApiSettings(
                app_name="campus-agent-v2",
                runtime_provider="mock-runtime",
            )
        )

        health = app.handle("GET", "/healthz")
        ready = app.handle("GET", "/readyz")

        self.assertEqual(health.json_body["status"], "ok")
        self.assertEqual(ready.json_body["status"], "ready")
        self.assertEqual(app.name, "campus-agent-v2")
        self.assertEqual(app.runtime.provider, "mock-runtime")
        self.assertEqual(ready.json_body["runtime_provider"], "mock-runtime")

    def test_api_settings_from_env_reads_api_boundary_defaults(self) -> None:
        env = {
            "CAMPUS_AGENT_APP_NAME": "campus-agent-test",
            "API_AUTH_MODE": "trusted-worker",
            "API_BEARER_TOKEN": "secret-token",
            "API_WORKER_SHARED_SECRET": "worker-secret",
            "API_WORKER_ACTOR_ID": "public-entry-worker",
            "API_DEFAULT_ACTOR_ID": "runtime-bearer-user",
            "AGENT_RUNTIME_PROVIDER": "agent-os",
            "API_DEFAULT_ACTOR_GROUPS": "students,library",
            "API_DEFAULT_ACTOR_ROLES": "student",
            "API_DEFAULT_CAMPUS_SCOPE": "north",
            "API_TRUSTED_JWT_USER_ID_CLAIMS": "email,sub",
            "API_TRUSTED_JWT_GROUPS_CLAIMS": "groups,custom_groups",
            "API_TRUSTED_JWT_ROLES_CLAIMS": "roles",
            "AGNO_SUPERVISOR_MODEL": "gpt-supervisor",
            "AGNO_SPECIALIST_MODEL": "gpt-specialist",
            "AUDIT_LOG_PATH": "./var/log/custom-audit.log",
        }

        with patch.dict(os.environ, env, clear=True):
            settings = ApiSettings.from_env()

        self.assertEqual(settings.app_name, "campus-agent-test")
        self.assertEqual(settings.auth_mode, "trusted-worker")
        self.assertEqual(settings.bearer_token, "secret-token")
        self.assertEqual(settings.worker_shared_secret, "worker-secret")
        self.assertEqual(settings.worker_actor_id, "public-entry-worker")
        self.assertEqual(settings.default_actor_id, "runtime-bearer-user")
        self.assertEqual(settings.runtime_provider, "agent-os")
        self.assertEqual(settings.default_actor_groups, ("students", "library"))
        self.assertEqual(settings.default_actor_roles, ("student",))
        self.assertEqual(settings.default_campus_scope, "north")
        self.assertEqual(settings.trusted_jwt_user_id_claims, ("email", "sub"))
        self.assertEqual(settings.trusted_jwt_groups_claims, ("groups", "custom_groups"))
        self.assertEqual(settings.trusted_jwt_roles_claims, ("roles",))
        self.assertEqual(settings.agno_supervisor_model, "gpt-supervisor")
        self.assertEqual(settings.agno_specialist_model, "gpt-specialist")
        self.assertEqual(str(settings.audit_log_path), "var/log/custom-audit.log")


def _make_jwt(payload: dict[str, object]) -> str:
    header = _urlsafe_json({"alg": "none", "typ": "JWT"})
    body = _urlsafe_json(payload)
    return f"{header}.{body}.signature"


def _urlsafe_json(payload: dict[str, object]) -> str:
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=True).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


if __name__ == "__main__":
    unittest.main()
