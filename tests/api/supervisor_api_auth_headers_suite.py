from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    SupervisorRequest,
    SupervisorResponse,
    TraceContext,
)
from campus_supervisor_api.app import create_app
from campus_supervisor_api.settings import ApiSettings


class SupervisorApiAuthHeadersTest(unittest.TestCase):
    def test_create_app_dispatches_normalized_headers_only_through_supervisor_handler(self) -> None:
        captured_requests: list[SupervisorRequest] = []

        def fake_supervisor(request: SupervisorRequest) -> SupervisorResponse:
            captured_requests.append(request)
            return SupervisorResponse(
                selected_target="rag-agent",
                status="completed",
                answer_text="Projected from supervisor-core.",
                confidence="high",
            )

        app = create_app(
            settings=ApiSettings(
                auth_mode="bearer",
                bearer_token="secret-token",
                default_actor_id="api-bearer-user",
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
                    "collection": "student_rules",
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

        def fake_supervisor(request: SupervisorRequest) -> SupervisorResponse:
            captured_requests.append(request)
            return SupervisorResponse(
                selected_target="rag-agent",
                status="completed",
                answer_text="Projected from supervisor-core.",
                confidence="high",
            )

        app = create_app(
            settings=ApiSettings(
                auth_mode="bearer",
                bearer_token="secret-token",
                default_actor_id="runtime-bearer-user",
                default_actor_roles=("student",),
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
                    "collection": "student_rules",
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(captured_requests[0].actor.user_id, "runtime-bearer-user")
        self.assertEqual(
            captured_requests[0].actor,
            ActorContext(
                user_id="runtime-bearer-user",
                roles=("student",),
            ),
        )

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
