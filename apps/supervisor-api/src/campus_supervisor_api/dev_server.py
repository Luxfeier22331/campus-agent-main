from __future__ import annotations

import asyncio
import json
import os
from collections.abc import Mapping
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import urlsplit

from campus_contracts import ErrorInfo
from campus_shared import load_repo_env
from campus_supervisor_core import handle_request

from campus_supervisor_api.api import HttpResponse, error_response
from campus_supervisor_api.app import SupervisorApiApp, create_app
from campus_supervisor_api.settings import ApiSettings


@dataclass(frozen=True, slots=True)
class DevServerSettings:
    host: str = "127.0.0.1"
    port: int = 8000

    @classmethod
    def from_env(cls) -> DevServerSettings:
        return cls(
            host=os.getenv("CAMPUS_AGENT_HTTP_HOST", "127.0.0.1"),
            port=int(os.getenv("CAMPUS_AGENT_HTTP_PORT", "8000")),
        )


class SupervisorApiHttpServer(ThreadingHTTPServer):
    def __init__(self, server_address: tuple[str, int], app: SupervisorApiApp) -> None:
        super().__init__(server_address, _RequestHandler)
        self.app = app


class SupervisorApiAsgiApp:
    def __init__(
        self,
        app: SupervisorApiApp,
        *,
        max_workers: int | None = None,
        admission_paths: tuple[str, ...] | None = None,
    ) -> None:
        self.app = app
        self._admission_paths = frozenset(admission_paths or ("/api/v1/answer",))
        self._executor = ThreadPoolExecutor(
            max_workers=max_workers or 1,
            thread_name_prefix="campus-supervisor-api",
        )

    async def __call__(self, scope, receive, send) -> None:
        scope_type = scope.get("type")
        if scope_type == "lifespan":
            await self._handle_lifespan(receive, send)
            return
        if scope_type != "http":
            await self._send_response(
                send,
                error_response(404, ErrorInfo(code="not_found", message="Route not found.")),
            )
            return

        method = str(scope.get("method", "GET"))
        path = str(scope.get("path", "/"))
        query_string = scope.get("query_string") or b""
        full_path = path
        if query_string:
            full_path = f"{path}?{bytes(query_string).decode('latin-1')}"
        headers = _decode_asgi_headers(scope.get("headers") or ())
        raw_body = await self._read_body(receive)

        if method.upper() == "POST" and path in self._admission_paths:
            if not self.app.transport_runtime.try_acquire_answer():
                await self._send_response(
                    send,
                    error_response(
                        503,
                        ErrorInfo(
                            code="transport_saturated",
                            message="Supervisor execution admission is saturated.",
                            retryable=True,
                        ),
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
            finally:
                self.app.transport_runtime.release_answer()
        else:
            response = await self._dispatch_in_executor(
                method=method,
                path=full_path,
                headers=headers,
                raw_body=raw_body,
            )
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
        while True:
            message = await receive()
            if message.get("type") == "http.disconnect":
                break
            body = message.get("body", b"")
            if body:
                chunks.append(bytes(body))
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


class _RequestHandler(BaseHTTPRequestHandler):
    server: SupervisorApiHttpServer

    def do_GET(self) -> None:
        self._dispatch()

    def do_POST(self) -> None:
        self._dispatch()

    def log_message(self, format: str, *args: object) -> None:
        return

    def _dispatch(self) -> None:
        response = dispatch_http_request(
            self.server.app,
            method=self.command,
            path=self.path,
            headers=self._read_headers(),
            raw_body=self._read_raw_body(),
        )
        self._write_response(response)

    def _read_headers(self) -> dict[str, str]:
        return {key.lower(): value for key, value in self.headers.items()}

    def _read_raw_body(self) -> bytes | None:
        content_length = int(self.headers.get("Content-Length", "0"))
        if content_length <= 0:
            return None
        return self.rfile.read(content_length)

    def _write_response(self, response: HttpResponse) -> None:
        payload = json.dumps(response.json_body).encode("utf-8")
        self.send_response(response.status_code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        for key, value in response.headers.items():
            self.send_header(key, value)
        self.end_headers()
        try:
            self.wfile.write(payload)
        except BrokenPipeError:
            return


def dispatch_http_request(
    app: SupervisorApiApp,
    *,
    method: str,
    path: str,
    headers: Mapping[str, str] | None = None,
    raw_body: bytes | None = None,
) -> HttpResponse:
    json_body = _parse_json_body(method=method, raw_body=raw_body)
    if json_body == {"__invalid_json__": True}:
        return HttpResponse(
            status_code=HTTPStatus.BAD_REQUEST,
            json_body={
                "error": {
                    "code": "invalid_json",
                    "message": "Request body must be a JSON object.",
                }
            },
        )

    return app.handle(
        method,
        urlsplit(path).path,
        headers=headers,
        json_body=json_body,
    )


def _parse_json_body(*, method: str, raw_body: bytes | None) -> dict[str, object] | None:
    if method.upper() != "POST":
        return None
    if not raw_body:
        return None

    try:
        payload = json.loads(raw_body.decode("utf-8"))
    except json.JSONDecodeError:
        return {"__invalid_json__": True}

    if not isinstance(payload, dict):
        return {"__invalid_json__": True}
    return payload


def create_http_server(
    *,
    host: str | None = None,
    port: int | None = None,
    settings: ApiSettings | None = None,
    supervisor_handler=handle_request,
) -> SupervisorApiHttpServer:
    runtime_settings = settings or ApiSettings.from_env()
    server_settings = DevServerSettings.from_env()
    resolved_host = host or server_settings.host
    resolved_port = port or server_settings.port
    app = create_app(settings=runtime_settings, supervisor_handler=supervisor_handler)
    return SupervisorApiHttpServer((resolved_host, resolved_port), app)


def serve(
    *,
    host: str | None = None,
    port: int | None = None,
    settings: ApiSettings | None = None,
    supervisor_handler=handle_request,
) -> None:
    import uvicorn

    runtime_settings = settings or ApiSettings.from_env()
    server_settings = DevServerSettings.from_env()
    resolved_host = host or server_settings.host
    resolved_port = port or server_settings.port
    app = create_app(settings=runtime_settings, supervisor_handler=supervisor_handler)
    asgi_app = SupervisorApiAsgiApp(
        app,
        max_workers=runtime_settings.transport_worker_threads,
    )
    print(
        f"campus-supervisor-api dev server listening on "
        f"http://{resolved_host}:{resolved_port}"
    )
    try:
        uvicorn.run(
            asgi_app,
            host=resolved_host,
            port=resolved_port,
            log_level="info",
            lifespan="on",
        )
    except KeyboardInterrupt:
        pass
    finally:
        asgi_app.close()
        app.close()


def _decode_asgi_headers(raw_headers: object) -> dict[str, str]:
    headers: dict[str, str] = {}
    for key, value in raw_headers:
        headers[bytes(key).decode("latin-1").lower()] = bytes(value).decode("latin-1")
    return headers


def main() -> None:
    load_repo_env()
    serve()


if __name__ == "__main__":
    main()
