from __future__ import annotations

import json
import os
from dataclasses import dataclass
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Mapping
from urllib.parse import urlsplit

from campus_shared import load_repo_env
from campus_supervisor_core import handle_request

from campus_supervisor_api.api import HttpResponse
from campus_supervisor_api.app import SupervisorApiApp, create_app
from campus_supervisor_api.settings import ApiSettings


@dataclass(frozen=True, slots=True)
class DevServerSettings:
    host: str = "127.0.0.1"
    port: int = 8000

    @classmethod
    def from_env(cls) -> "DevServerSettings":
        return cls(
            host=os.getenv("CAMPUS_AGENT_HTTP_HOST", "127.0.0.1"),
            port=int(os.getenv("CAMPUS_AGENT_HTTP_PORT", "8000")),
        )


class SupervisorApiHttpServer(ThreadingHTTPServer):
    def __init__(self, server_address: tuple[str, int], app: SupervisorApiApp) -> None:
        super().__init__(server_address, _RequestHandler)
        self.app = app


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
    server = create_http_server(
        host=host,
        port=port,
        settings=settings,
        supervisor_handler=supervisor_handler,
    )
    print(
        f"campus-supervisor-api dev server listening on "
        f"http://{server.server_address[0]}:{server.server_address[1]}"
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def main() -> None:
    load_repo_env()
    serve()


if __name__ == "__main__":
    main()
