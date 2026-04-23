from __future__ import annotations

import unittest

from campus_contracts import SupervisorRequest, SupervisorResponse
from campus_supervisor_api.app import create_bridge_app
from campus_supervisor_api.settings import ApiSettings
from campus_supervisor_core import InvalidSupervisorRequestError


class SupervisorApiBridgeTest(unittest.TestCase):
    def test_bridge_answer_route_accepts_supervisor_request_payload(self) -> None:
        captured_requests: list[SupervisorRequest] = []

        def fake_supervisor(request: SupervisorRequest) -> SupervisorResponse:
            captured_requests.append(request)
            return SupervisorResponse(
                selected_target="rag-agent",
                status="completed",
                answer_text="Projected context reached supervisor.",
                confidence="high",
            )

        app = create_bridge_app(
            settings=ApiSettings(
                app_name="campus-agent-v2",
                bridge_shared_secret="bridge-secret",
            ),
            supervisor_handler=fake_supervisor,
        )

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body={
                "user_goal": "保研政策怎么准备？",
                "conversation_id": "conv-001",
                "request_id": "req-001",
                "trace": {"trace_id": "trace-001"},
                "context": {
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
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_rules",
                },
                "requested_capability": "knowledge",
                "version_query": {
                    "mode": "current",
                },
            },
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.headers["x-supervisor-bridge-kind"],
            "supervisor_response",
        )
        self.assertEqual(response.json_body["status"], "completed")
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(captured_requests[0].trace.trace_id, "trace-001")
        self.assertEqual(captured_requests[0].context.actor.user_id, "student@example.edu")

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
            supervisor_handler=lambda request: (_ for _ in ()).throw(
                InvalidSupervisorRequestError("requested_scope is not allowed for place_lookup requests")
            ),
        )

        response = app.handle(
            "POST",
            "/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            json_body={
                "user_goal": "test",
                "trace": {"trace_id": "trace-001"},
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
        self.assertEqual(
            response.headers["x-supervisor-bridge-kind"],
            "supervisor_error",
        )
        self.assertEqual(response.json_body["error"]["code"], "invalid_supervisor_request")

    def test_bridge_readyz_requires_bridge_auth(self) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
            )
        )

        response = app.handle("GET", "/internal/bridge/readyz")

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json_body["error"]["code"], "unauthorized")
