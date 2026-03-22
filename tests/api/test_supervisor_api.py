from __future__ import annotations

import unittest

from campus_contracts import DelegateToRagAgentRequest, DelegateToRagAgentResponse, EvidenceBundle, TraceContext
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
        self.assertEqual(captured_requests[0].trace, TraceContext(trace_id="trace-001"))
        self.assertEqual(captured_requests[0].actor.user_id, "student-001")
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

    def test_health_and_ready_routes_exist(self) -> None:
        app = create_app(settings=ApiSettings(app_name="campus-agent-v2"))

        health = app.handle("GET", "/healthz")
        ready = app.handle("GET", "/readyz")

        self.assertEqual(health.json_body["status"], "ok")
        self.assertEqual(ready.json_body["status"], "ready")
        self.assertEqual(app.name, "campus-agent-v2")
        self.assertEqual(app.runtime.provider, "agno")


if __name__ == "__main__":
    unittest.main()
