from .supervisor_api_bridge_support import *


class SupervisorApiBridgeRuntimeTest(SupervisorApiBridgeBaseTest):
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
