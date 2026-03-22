from __future__ import annotations

from dataclasses import asdict
import os
import unittest
from unittest.mock import patch

from campus_contracts import (
    DelegateToRagAgentRequest,
    DelegateToRagAgentResponse,
    ErrorInfo,
    EvidenceBundle,
    TraceContext,
)
from campus_supervisor_api.api import HttpResponse
from campus_supervisor_api.app import create_app
from campus_supervisor_api.settings import ApiSettings


class SupervisorApiTest(unittest.TestCase):
    def test_answer_route_maps_auth_trace_and_response_shape(self) -> None:
        captured_requests: list[DelegateToRagAgentRequest] = []

        def fake_supervisor(request: DelegateToRagAgentRequest) -> DelegateToRagAgentResponse:
            captured_requests.append(request)
            return DelegateToRagAgentResponse(
                status="completed",
                answer_text="The library is open from 08:00 to 22:00.",
                confidence="medium",
                evidence=EvidenceBundle(query_text=request.user_goal, corpus="student_handbook"),
            )

        app = create_app(
            settings=ApiSettings(
                app_name="campus-agent-v2",
                auth_mode="bearer",
                bearer_token="secret-token",
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
                "x-trace-id": "trace-001",
                "x-actor-id": "student-001",
            },
            json_body={
                "user_goal": "library hours",
                "conversation_id": "conv-001",
                "request_id": "req-001",
            },
        )

        self.assertIsInstance(response, HttpResponse)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json_body["trace_id"], "trace-001")
        self.assertEqual(response.json_body["status"], "completed")
        self.assertEqual(captured_requests[0].user_goal, "library hours")
        self.assertEqual(captured_requests[0].conversation_id, "conv-001")
        self.assertEqual(captured_requests[0].request_id, "req-001")
        self.assertEqual(captured_requests[0].trace, TraceContext(trace_id="trace-001"))
        self.assertEqual(captured_requests[0].actor.user_id, "student-001")
        self.assertEqual(captured_requests[0].actor.groups, ("students",))
        self.assertEqual(captured_requests[0].actor.roles, ("student",))
        self.assertEqual(captured_requests[0].actor.campus_scope, "north")

    def test_answer_route_projects_supervisor_response_without_orchestration_logic(self) -> None:
        def fake_supervisor(request: DelegateToRagAgentRequest) -> DelegateToRagAgentResponse:
            return DelegateToRagAgentResponse(
                status="error",
                confidence="low",
                error=ErrorInfo(code="retrieval_failed", message="retrieval backend unavailable", retryable=False),
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
            json_body={"user_goal": "library hours"},
        )

        expected_payload = asdict(
            DelegateToRagAgentResponse(
                status="error",
                confidence="low",
                error=ErrorInfo(code="retrieval_failed", message="retrieval backend unavailable", retryable=False),
            )
        )
        expected_payload["trace_id"] = "trace-001"

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json_body, expected_payload)

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

    def test_health_and_ready_routes_exist(self) -> None:
        app = create_app(settings=ApiSettings(app_name="campus-agent-v2"))

        health = app.handle("GET", "/healthz")
        ready = app.handle("GET", "/readyz")

        self.assertEqual(health.json_body["status"], "ok")
        self.assertEqual(ready.json_body["status"], "ready")
        self.assertEqual(app.name, "campus-agent-v2")
        self.assertEqual(app.runtime.provider, "agno")

    def test_api_settings_from_env_reads_api_boundary_defaults(self) -> None:
        env = {
            "CAMPUS_AGENT_APP_NAME": "campus-agent-test",
            "API_AUTH_MODE": "bearer",
            "API_BEARER_TOKEN": "secret-token",
            "API_DEFAULT_ACTOR_GROUPS": "students,library",
            "API_DEFAULT_ACTOR_ROLES": "student",
            "API_DEFAULT_CAMPUS_SCOPE": "north",
            "AGNO_SUPERVISOR_MODEL": "gpt-supervisor",
            "AGNO_SPECIALIST_MODEL": "gpt-specialist",
            "AUDIT_LOG_PATH": "./var/log/custom-audit.log",
        }

        with patch.dict(os.environ, env, clear=True):
            settings = ApiSettings.from_env()

        self.assertEqual(settings.app_name, "campus-agent-test")
        self.assertEqual(settings.auth_mode, "bearer")
        self.assertEqual(settings.bearer_token, "secret-token")
        self.assertEqual(settings.default_actor_groups, ("students", "library"))
        self.assertEqual(settings.default_actor_roles, ("student",))
        self.assertEqual(settings.default_campus_scope, "north")
        self.assertEqual(settings.agno_supervisor_model, "gpt-supervisor")
        self.assertEqual(settings.agno_specialist_model, "gpt-specialist")
        self.assertEqual(str(settings.audit_log_path), "var/log/custom-audit.log")


if __name__ == "__main__":
    unittest.main()
