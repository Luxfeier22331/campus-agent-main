from __future__ import annotations

import json
import os
import asyncio
import threading
import unittest
from unittest.mock import patch

from campus_contracts import SupervisorRequest, SupervisorResponse
from campus_supervisor_api.app import create_app
from campus_supervisor_api.dev_server import (
    DevServerSettings,
    SupervisorApiAsgiApp,
    dispatch_http_request,
)
from campus_supervisor_api.dev_server import main as dev_server_main
from campus_supervisor_api.settings import ApiSettings


class SupervisorApiDevServerTest(unittest.TestCase):
    def test_healthz_returns_200_over_dev_http_dispatch(self) -> None:
        app = create_app(
            settings=ApiSettings(
                app_name="campus-agent-v2",
                auth_mode="bearer",
                bearer_token="secret-token",
            )
        )

        response = dispatch_http_request(
            app,
            method="GET",
            path="/healthz",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json_body,
            {"status": "ok", "app_name": "campus-agent-v2"},
        )

    def test_answer_route_returns_401_when_bearer_is_missing(self) -> None:
        app = create_app(
            settings=ApiSettings(
                auth_mode="bearer",
                bearer_token="secret-token",
            )
        )

        response = dispatch_http_request(
            app,
            method="POST",
            path="/api/v1/answer",
            headers={"content-type": "application/json"},
            raw_body=json.dumps({"user_goal": "library hours"}).encode("utf-8"),
        )

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json_body["error"]["code"], "unauthorized")

    def test_answer_route_enters_create_app_handler_and_returns_completed_payload(self) -> None:
        captured_requests: list[SupervisorRequest] = []

        def fake_supervisor(request: SupervisorRequest) -> SupervisorResponse:
            captured_requests.append(request)
            return SupervisorResponse(
                selected_target="rag-agent",
                status="completed",
                answer_text="The library closes at 22:00.",
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

        response = dispatch_http_request(
            app,
            method="POST",
            path="/api/v1/answer?debug=1",
            headers={
                "content-type": "application/json",
                "authorization": "Bearer secret-token",
                "x-trace-id": "trace-http-1",
            },
            raw_body=json.dumps(
                {
                    "user_goal": "When does the library close?",
                    "conversation_id": "conv-http-1",
                    "request_id": "req-http-1",
                    "requested_scope": {
                        "corpus": "regulations",
                        "collection": "student_rules",
                    },
                }
            ).encode("utf-8"),
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json_body["status"], "completed")
        self.assertEqual(response.json_body["answer_text"], "The library closes at 22:00.")
        self.assertEqual(response.json_body["trace_id"], "trace-http-1")
        self.assertEqual(len(captured_requests), 1)
        self.assertEqual(captured_requests[0].conversation_id, "conv-http-1")
        self.assertEqual(captured_requests[0].request_id, "req-http-1")

    def test_invalid_json_returns_400_before_app_handler(self) -> None:
        app = create_app(
            settings=ApiSettings(
                auth_mode="bearer",
                bearer_token="secret-token",
            )
        )

        response = dispatch_http_request(
            app,
            method="POST",
            path="/api/v1/answer",
            headers={
                "content-type": "application/json",
                "authorization": "Bearer secret-token",
            },
            raw_body=b"{not-json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_json")

    def test_dev_server_settings_read_host_and_port_from_env(self) -> None:
        env = os.environ | {
            "CAMPUS_AGENT_HTTP_HOST": "0.0.0.0",
            "CAMPUS_AGENT_HTTP_PORT": "8765",
        }
        with patch.dict(os.environ, env, clear=True):
            settings = DevServerSettings.from_env()

        self.assertEqual(settings.host, "0.0.0.0")
        self.assertEqual(settings.port, 8765)

    def test_main_loads_repo_env_before_serving(self) -> None:
        with (
            patch("campus_supervisor_api.dev_server.load_repo_env") as load_repo_env,
            patch("campus_supervisor_api.dev_server.serve") as serve,
        ):
            dev_server_main()

        load_repo_env.assert_called_once_with()
        serve.assert_called_once_with()

    def test_asgi_answer_route_returns_503_when_transport_admission_is_saturated(self) -> None:
        started = threading.Event()
        release = threading.Event()

        def slow_supervisor(request: SupervisorRequest) -> SupervisorResponse:
            started.set()
            release.wait(timeout=2.0)
            return SupervisorResponse(
                selected_target="rag-agent",
                status="completed",
                answer_text="ok",
                confidence="high",
            )

        app = create_app(
            settings=ApiSettings(
                auth_mode="bearer",
                bearer_token="secret-token",
                default_actor_id="runtime-bearer-user",
                transport_max_concurrent_answers=1,
                transport_worker_threads=1,
            ),
            supervisor_handler=slow_supervisor,
        )
        asgi_app = SupervisorApiAsgiApp(app)

        async def scenario() -> tuple[dict[str, object], dict[str, object]]:
            first_task = asyncio.create_task(_call_asgi_answer(asgi_app))
            await asyncio.to_thread(started.wait, 2.0)
            second = await _call_asgi_answer(asgi_app)
            release.set()
            first = await first_task
            return first, second

        first, second = asyncio.run(scenario())

        self.assertEqual(first["status"], 200)
        self.assertEqual(second["status"], 503)
        self.assertEqual(second["json_body"]["error"]["code"], "transport_saturated")
        app.close()


async def _call_asgi_answer(asgi_app: SupervisorApiAsgiApp) -> dict[str, object]:
    payload = json.dumps(
        {
            "user_goal": "library hours",
            "request_id": "req-asgi",
            "requested_scope": {
                "corpus": "regulations",
                "collection": "student_rules",
            },
        }
    ).encode("utf-8")
    messages = [
        {
            "type": "http.request",
            "body": payload,
            "more_body": False,
        }
    ]
    sent: list[dict[str, object]] = []

    async def receive() -> dict[str, object]:
        if messages:
            return messages.pop(0)
        return {"type": "http.disconnect"}

    async def send(message: dict[str, object]) -> None:
        sent.append(message)

    await asgi_app(
        {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/answer",
            "query_string": b"",
            "headers": (
                (b"content-type", b"application/json"),
                (b"authorization", b"Bearer secret-token"),
            ),
        },
        receive,
        send,
    )

    response_start = next(message for message in sent if message["type"] == "http.response.start")
    response_body = next(message for message in sent if message["type"] == "http.response.body")
    return {
        "status": response_start["status"],
        "json_body": json.loads(bytes(response_body.get("body", b"")).decode("utf-8")),
    }


if __name__ == "__main__":
    unittest.main()
