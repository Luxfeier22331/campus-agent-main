from __future__ import annotations

import asyncio
import json
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from http import HTTPStatus
from urllib.parse import urlsplit

from campus_supervisor_agent_worker.app import SupervisorAgentWorkerApp
from campus_supervisor_agent_worker.bridge_auth import require_bridge_auth
from campus_supervisor_agent_worker.http_types import HttpResponse


class RequestBodyTooLargeError(Exception):
    pass


class SupervisorBridgeAsgiApp:
    def __init__(
        self,
        app: SupervisorAgentWorkerApp,
        *,
        max_workers: int | None = None,
    ) -> None:
        self.app = app
        self._executor = ThreadPoolExecutor(
            max_workers=max_workers or 1,
            thread_name_prefix="campus-supervisor-bridge",
        )

    async def __call__(self, scope, receive, send) -> None:
        scope_type = scope.get("type")
        if scope_type == "lifespan":
            await self._handle_lifespan(receive, send)
            return
        if scope_type != "http":
            await self._send_response(
                send,
                HttpResponse(
                    status_code=HTTPStatus.NOT_FOUND,
                    json_body={"error": {"code": "not_found", "message": "Route not found."}},
                ),
            )
            return

        method = str(scope.get("method", "GET"))
        path = str(scope.get("path", "/"))
        query_string = scope.get("query_string") or b""
        full_path = path
        if query_string:
            full_path = f"{path}?{bytes(query_string).decode('latin-1')}"
        headers = _decode_asgi_headers(scope.get("headers") or ())
        auth_error = _bridge_auth_precheck(self.app, path, headers)
        if auth_error is not None:
            await self._send_response(send, auth_error)
            return
        try:
            raw_body = await self._read_body(receive)
        except RequestBodyTooLargeError:
            await self._send_response(
                send,
                HttpResponse(
                    status_code=HTTPStatus.REQUEST_ENTITY_TOO_LARGE,
                    json_body={
                        "error": {
                            "code": "request_body_too_large",
                            "message": "Request body exceeds supervisor bridge limit.",
                        }
                    },
                ),
            )
            return
        try:
            response = await self._dispatch_in_executor(
                method=method,
                path=full_path,
                headers=headers,
                raw_body=raw_body,
            )
        except Exception:
            response = _unexpected_worker_error_response()
        await self._send_response(send, response)

    async def _dispatch_in_executor(
        self,
        *,
        method: str,
        path: str,
        headers: Mapping[str, str],
        raw_body: bytes | None,
    ) -> HttpResponse:
        return await asyncio.get_running_loop().run_in_executor(
            self._executor,
            lambda: dispatch_http_request(
                self.app,
                method=method,
                path=path,
                headers=headers,
                raw_body=raw_body,
            ),
        )

    async def _handle_lifespan(self, receive, send) -> None:
        while True:
            message = await receive()
            message_type = message.get("type")
            if message_type == "lifespan.startup":
                await send({"type": "lifespan.startup.complete"})
            elif message_type == "lifespan.shutdown":
                await send({"type": "lifespan.shutdown.complete"})
                return

    async def _read_body(self, receive) -> bytes | None:
        chunks: list[bytes] = []
        total_bytes = 0
        while True:
            message = await receive()
            if message.get("type") == "http.disconnect":
                break
            body = message.get("body", b"")
            if body:
                chunk = bytes(body)
                total_bytes += len(chunk)
                if total_bytes > self.app.settings.bridge_request_body_limit_bytes:
                    raise RequestBodyTooLargeError
                chunks.append(chunk)
            if not message.get("more_body", False):
                break
        return b"".join(chunks) if chunks else None

    async def _send_response(self, send, response: HttpResponse) -> None:
        payload = json.dumps(response.json_body).encode("utf-8")
        headers = [
            (b"content-type", b"application/json"),
            (b"content-length", str(len(payload)).encode("ascii")),
        ]
        headers.extend(
            (key.lower().encode("latin-1"), value.encode("latin-1"))
            for key, value in response.headers.items()
        )
        await send(
            {
                "type": "http.response.start",
                "status": int(response.status_code),
                "headers": headers,
            }
        )
        await send({"type": "http.response.body", "body": payload})

    def close(self) -> None:
        self._executor.shutdown(wait=True, cancel_futures=True)


def dispatch_http_request(
    app: SupervisorAgentWorkerApp,
    *,
    method: str,
    path: str,
    headers: Mapping[str, str] | None = None,
    raw_body: bytes | None = None,
) -> HttpResponse:
    json_body, invalid_json = _parse_json_body(method=method, raw_body=raw_body)
    if invalid_json:
        return HttpResponse(
            status_code=HTTPStatus.BAD_REQUEST,
            json_body={
                "error": {
                    "code": "invalid_json",
                    "message": "Request body must be a JSON object.",
                }
            },
        )

    return app.handle(method, urlsplit(path).path, headers=headers, json_body=json_body)


def _unexpected_worker_error_response() -> HttpResponse:
    return HttpResponse(
        status_code=HTTPStatus.INTERNAL_SERVER_ERROR,
        json_body={
            "error": {
                "code": "supervisor_worker_error",
                "message": "Supervisor worker failed while handling the bridge request.",
                "retryable": True,
            }
        },
        headers={"x-supervisor-bridge-kind": "supervisor_error"},
    )


def _bridge_auth_precheck(
    app: SupervisorAgentWorkerApp,
    path: str,
    headers: Mapping[str, str],
) -> HttpResponse | None:
    if not path.startswith("/internal/bridge/"):
        return None
    return require_bridge_auth(headers, app.settings)


def _parse_json_body(
    *, method: str, raw_body: bytes | None
) -> tuple[dict[str, object] | None, bool]:
    if method.upper() != "POST":
        return None, False
    if not raw_body:
        return None, False

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError):
        return None, True

    if not isinstance(payload, dict):
        return None, True
    return payload, False


def _decode_asgi_headers(raw_headers: object) -> dict[str, str]:
    headers: dict[str, str] = {}
    for key, value in raw_headers:
        headers[bytes(key).decode("latin-1").lower()] = bytes(value).decode("latin-1")
    return headers
