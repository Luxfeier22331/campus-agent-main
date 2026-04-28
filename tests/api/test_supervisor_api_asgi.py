from __future__ import annotations

import asyncio
import unittest

from campus_supervisor_agent_worker.app import create_bridge_app
from campus_supervisor_agent_worker.asgi import SupervisorBridgeAsgiApp, dispatch_http_request
from campus_supervisor_agent_worker.settings import ApiSettings


class SupervisorApiAsgiTest(unittest.TestCase):
    def test_dispatch_rejects_invalid_json_before_bridge_handler(self) -> None:
        app = create_bridge_app(settings=ApiSettings(bridge_shared_secret="bridge-secret"))

        response = dispatch_http_request(
            app,
            method="POST",
            path="/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            raw_body=b"not-json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_json")
        app.close()

    def test_dispatch_does_not_treat_valid_json_object_as_invalid_json_sentinel(self) -> None:
        app = create_bridge_app(settings=ApiSettings(bridge_shared_secret="bridge-secret"))

        response = dispatch_http_request(
            app,
            method="POST",
            path="/internal/bridge/supervisor/answer",
            headers={"x-supervisor-bridge-auth": "bridge-secret"},
            raw_body=b'{"__invalid_json__": true}',
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json_body["error"]["code"], "invalid_request")
        app.close()

    def test_asgi_bridge_app_routes_internal_health_without_transport_admission(self) -> None:
        app = create_bridge_app(settings=ApiSettings(bridge_shared_secret="bridge-secret"))
        asgi_app = SupervisorBridgeAsgiApp(app)

        async def receive() -> dict[str, object]:
            return {"type": "http.request", "body": b"", "more_body": False}

        sent: list[dict[str, object]] = []

        async def send(message: dict[str, object]) -> None:
            sent.append(message)

        asyncio.run(
            asgi_app(
                {
                    "type": "http",
                    "method": "GET",
                    "path": "/internal/bridge/healthz",
                    "headers": [(b"x-supervisor-bridge-auth", b"bridge-secret")],
                },
                receive,
                send,
            )
        )

        self.assertEqual(sent[0]["status"], 200)
        asgi_app.close()
        app.close()

    def test_asgi_bridge_app_rejects_unauthorized_bridge_request_before_reading_body(
        self,
    ) -> None:
        app = create_bridge_app(settings=ApiSettings(bridge_shared_secret="bridge-secret"))
        asgi_app = SupervisorBridgeAsgiApp(app)

        async def receive() -> dict[str, object]:
            raise AssertionError("unauthorized bridge request body should not be read")

        sent: list[dict[str, object]] = []

        async def send(message: dict[str, object]) -> None:
            sent.append(message)

        asyncio.run(
            asgi_app(
                {
                    "type": "http",
                    "method": "POST",
                    "path": "/internal/bridge/supervisor/answer",
                    "headers": [],
                },
                receive,
                send,
            )
        )

        self.assertEqual(sent[0]["status"], 401)
        asgi_app.close()
        app.close()

    def test_asgi_bridge_app_rejects_authorized_body_over_limit(self) -> None:
        app = create_bridge_app(
            settings=ApiSettings(
                bridge_shared_secret="bridge-secret",
                bridge_request_body_limit_bytes=8,
            )
        )
        asgi_app = SupervisorBridgeAsgiApp(app)
        chunks = [
            {"type": "http.request", "body": b'{"too":', "more_body": True},
            {"type": "http.request", "body": b'"large"}', "more_body": False},
        ]

        async def receive() -> dict[str, object]:
            return chunks.pop(0)

        sent: list[dict[str, object]] = []

        async def send(message: dict[str, object]) -> None:
            sent.append(message)

        asyncio.run(
            asgi_app(
                {
                    "type": "http",
                    "method": "POST",
                    "path": "/internal/bridge/supervisor/answer",
                    "headers": [(b"x-supervisor-bridge-auth", b"bridge-secret")],
                },
                receive,
                send,
            )
        )

        self.assertEqual(sent[0]["status"], 413)
        asgi_app.close()
        app.close()


if __name__ == "__main__":
    unittest.main()
