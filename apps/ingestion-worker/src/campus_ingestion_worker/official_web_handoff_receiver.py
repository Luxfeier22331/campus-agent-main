from __future__ import annotations

import json
import os
import secrets
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

OFFICIAL_WEB_HANDOFF_RECORD_SCHEMA_VERSION = "official_web_handoff_dispatch.v1"
_EXPECTED_TOP_LEVEL_FIELDS = {
    "artifacts",
    "collectorVersion",
    "configVersion",
    "crawlPolicyVersion",
    "eventId",
    "eventType",
    "finishedAt",
    "hostSet",
    "pageChangeSummary",
    "pageChanges",
    "runId",
    "runIntent",
    "schedulerRunKey",
    "seedSet",
    "siteId",
    "sourceChannel",
    "startedAt",
    "status",
    "summary",
    "triggerType",
}
_RAW_VERSION_REQUIRED_CHANGE_STATUSES = frozenset({"new", "changed"})


@dataclass(frozen=True, slots=True)
class ErrorInfo:
    code: str
    message: str
    retryable: bool = False


@dataclass(frozen=True, slots=True)
class HttpResponse:
    status_code: int
    json_body: dict[str, object]
    headers: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class HttpRoute:
    method: str
    path: str
    handler: Callable[[Mapping[str, str], dict[str, object] | None], HttpResponse]


@dataclass(frozen=True, slots=True)
class OfficialWebHandoffReceiverSettings:
    app_name: str = "campus-ingestion-worker"
    bearer_token: str = ""
    inbox_dir: Path = Path("./var/official-web-handoffs")

    @classmethod
    def from_env(cls) -> OfficialWebHandoffReceiverSettings:
        inbox_dir = os.getenv(
            "INGESTION_WORKER_OFFICIAL_WEB_HANDOFF_INBOX_DIR",
            "./var/official-web-handoffs",
        ).strip()
        return cls(
            app_name=os.getenv("CAMPUS_AGENT_APP_NAME", "campus-ingestion-worker").strip()
            or "campus-ingestion-worker",
            bearer_token=os.getenv("INGESTION_WORKER_OFFICIAL_WEB_HANDOFF_TOKEN", "").strip(),
            inbox_dir=Path(inbox_dir or "./var/official-web-handoffs"),
        )


@dataclass(frozen=True, slots=True)
class OfficialWebHandoffServerSettings:
    host: str = "127.0.0.1"
    port: int = 27041

    @classmethod
    def from_env(cls) -> OfficialWebHandoffServerSettings:
        return cls(
            host=os.getenv("INGESTION_WORKER_HTTP_HOST", "127.0.0.1"),
            port=int(os.getenv("INGESTION_WORKER_HTTP_PORT", "27041")),
        )


@dataclass(slots=True)
class OfficialWebHandoffReceiverApp:
    name: str
    routes: tuple[HttpRoute, ...]

    def handle(
        self,
        method: str,
        path: str,
        *,
        headers: Mapping[str, str] | None = None,
        json_body: dict[str, object] | None = None,
    ) -> HttpResponse:
        normalized_headers = {key.lower(): value for key, value in (headers or {}).items()}
        for route in self.routes:
            if route.method == method.upper() and route.path == path:
                return route.handler(normalized_headers, json_body)
        return error_response(404, ErrorInfo(code="not_found", message="Route not found."))


class OfficialWebHandoffHttpServer(ThreadingHTTPServer):
    def __init__(self, server_address: tuple[str, int], app: OfficialWebHandoffReceiverApp) -> None:
        super().__init__(server_address, _RequestHandler)
        self.app = app


class _RequestHandler(BaseHTTPRequestHandler):
    server: OfficialWebHandoffHttpServer

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
        self.wfile.write(payload)


def create_app(
    *,
    settings: OfficialWebHandoffReceiverSettings | None = None,
) -> OfficialWebHandoffReceiverApp:
    runtime_settings = settings or OfficialWebHandoffReceiverSettings.from_env()
    return OfficialWebHandoffReceiverApp(
        name=runtime_settings.app_name,
        routes=build_routes(runtime_settings),
    )


def build_routes(settings: OfficialWebHandoffReceiverSettings) -> tuple[HttpRoute, ...]:
    return (
        HttpRoute("GET", "/healthz", lambda headers, body: healthz(settings)),
        HttpRoute("GET", "/readyz", lambda headers, body: readyz(settings)),
        HttpRoute(
            "POST",
            "/api/official-web/handoffs",
            lambda headers, body: accept_handoff(headers, body, settings),
        ),
    )


def healthz(settings: OfficialWebHandoffReceiverSettings) -> HttpResponse:
    return HttpResponse(
        status_code=200,
        json_body={"status": "ok", "app_name": settings.app_name},
    )


def readyz(settings: OfficialWebHandoffReceiverSettings) -> HttpResponse:
    token_configured = bool(settings.bearer_token)
    inbox_configured = bool(str(settings.inbox_dir).strip())
    ready = token_configured and inbox_configured
    return HttpResponse(
        status_code=200 if ready else 503,
        json_body={
            "status": "ready" if ready else "not_ready",
            "dependencies": {
                "officialWebHandoffToken": "configured" if token_configured else "not_configured",
                "officialWebInbox": "configured" if inbox_configured else "not_configured",
            },
            "inboxDir": str(settings.inbox_dir),
        },
    )


def accept_handoff(
    headers: Mapping[str, str],
    body: dict[str, object] | None,
    settings: OfficialWebHandoffReceiverSettings,
) -> HttpResponse:
    error = _authorize(headers, settings)
    if error is not None:
        return error_response(401, error)

    try:
        payload = validate_handoff_payload(body or {})
        header_event_id = _extract_event_id_header(headers)
        if header_event_id and header_event_id != payload["eventId"]:
            return error_response(
                409,
                ErrorInfo(
                    code="idempotency_conflict",
                    message="x-official-web-event-id does not match payload.eventId.",
                ),
            )
        dispatch_ref, persisted_at = persist_handoff_record(
            payload=payload,
            inbox_dir=settings.inbox_dir,
        )
    except ValueError as exc:
        return error_response(400, ErrorInfo(code="invalid_request", message=str(exc)))
    except FileExistsError as exc:
        return error_response(409, ErrorInfo(code="idempotency_conflict", message=str(exc)))

    return HttpResponse(
        status_code=202,
        json_body={
            "status": "accepted",
            "dispatchRef": dispatch_ref,
            "eventId": payload["eventId"],
            "receivedAt": persisted_at,
        },
    )


def _authorize(
    headers: Mapping[str, str],
    settings: OfficialWebHandoffReceiverSettings,
) -> ErrorInfo | None:
    if not settings.bearer_token:
        return ErrorInfo(
            code="auth_not_configured",
            message="Official web handoff bearer token is not configured.",
        )

    authorization = headers.get("authorization", "")
    scheme, _, token = authorization.partition(" ")
    if scheme.lower() != "bearer" or not token.strip():
        return ErrorInfo(code="unauthorized", message="Missing bearer token.")

    if not secrets.compare_digest(token.strip(), settings.bearer_token):
        return ErrorInfo(code="unauthorized", message="Invalid bearer token.")
    return None


def validate_handoff_payload(payload: dict[str, object]) -> dict[str, object]:
    if not payload:
        raise ValueError("Request body must be a JSON object.")

    for field_name in _EXPECTED_TOP_LEVEL_FIELDS:
        if field_name not in payload:
            raise ValueError(f"Missing required field: {field_name}")

    if payload.get("sourceChannel") != "official_web":
        raise ValueError("sourceChannel must equal 'official_web'.")

    _require_non_empty_text(payload.get("eventId"), "eventId")
    _require_non_empty_text(payload.get("eventType"), "eventType")
    _require_non_empty_text(payload.get("runId"), "runId")
    _require_non_empty_text(payload.get("siteId"), "siteId")
    _require_non_empty_text(payload.get("runIntent"), "runIntent")
    _require_non_empty_text(payload.get("schedulerRunKey"), "schedulerRunKey")
    _require_non_empty_text(payload.get("startedAt"), "startedAt")
    _require_non_empty_text(payload.get("status"), "status")
    _require_non_empty_text(payload.get("triggerType"), "triggerType")
    _require_non_empty_text(payload.get("crawlPolicyVersion"), "crawlPolicyVersion")
    _require_non_empty_text(payload.get("sourceChannel"), "sourceChannel")
    _require_string_list(payload.get("hostSet"), "hostSet")
    _require_string_list(payload.get("seedSet"), "seedSet")
    _require_artifacts(payload.get("artifacts"))
    _require_page_changes(payload.get("pageChanges"))
    _require_count_map(payload.get("pageChangeSummary"), "pageChangeSummary")
    _require_nullable_object(payload.get("summary"), "summary")
    return payload


def _require_non_empty_text(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be a non-empty string.")
    return value.strip()


def _require_optional_text(value: object, field_name: str) -> str | None:
    if value is None:
        return None
    return _require_non_empty_text(value, field_name)


def _require_string_list(value: object, field_name: str) -> list[str]:
    if not isinstance(value, list) or not value:
        raise ValueError(f"{field_name} must be a non-empty array of strings.")
    normalized: list[str] = []
    for item in value:
        normalized.append(_require_non_empty_text(item, f"{field_name}[]"))
    return normalized


def _require_count_map(value: object, field_name: str) -> dict[str, int]:
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} must be an object.")
    normalized: dict[str, int] = {}
    for key, count in value.items():
        if not isinstance(key, str) or not key.strip():
            raise ValueError(f"{field_name} keys must be non-empty strings.")
        if not isinstance(count, int):
            raise ValueError(f"{field_name}.{key} must be an integer.")
        normalized[key] = count
    return normalized


def _require_nullable_object(value: object, field_name: str) -> dict[str, object] | None:
    if value is None:
        return None
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} must be an object or null.")
    return value


def _require_artifacts(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list):
        raise ValueError("artifacts must be an array.")
    artifacts: list[dict[str, object]] = []
    for item in value:
        if not isinstance(item, dict):
            raise ValueError("artifacts[] must be an object.")
        _require_non_empty_text(item.get("artifactType"), "artifacts[].artifactType")
        _require_non_empty_text(item.get("contentSha256"), "artifacts[].contentSha256")
        _require_non_empty_text(item.get("objectKey"), "artifacts[].objectKey")
        record_count = item.get("recordCount")
        if record_count is not None and not isinstance(record_count, int):
            raise ValueError("artifacts[].recordCount must be an integer or null.")
        byte_size = item.get("byteSize")
        if byte_size is not None and not isinstance(byte_size, int):
            raise ValueError("artifacts[].byteSize must be an integer or null.")
        artifacts.append(item)
    return artifacts


def _require_page_changes(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list):
        raise ValueError("pageChanges must be an array.")
    page_changes: list[dict[str, object]] = []
    for item in value:
        if not isinstance(item, dict):
            raise ValueError("pageChanges[] must be an object.")
        change_status = _require_non_empty_text(
            item.get("changeStatus"),
            "pageChanges[].changeStatus",
        )
        _require_non_empty_text(
            item.get("normalizedCanonicalUrl"),
            "pageChanges[].normalizedCanonicalUrl",
        )
        _require_non_empty_text(item.get("observedAt"), "pageChanges[].observedAt")
        _require_non_empty_text(item.get("pageFamily"), "pageChanges[].pageFamily")
        if change_status in _RAW_VERSION_REQUIRED_CHANGE_STATUSES:
            _require_non_empty_text(item.get("rawAssetId"), "pageChanges[].rawAssetId")
            _require_non_empty_text(item.get("rawVersionId"), "pageChanges[].rawVersionId")
        else:
            _require_optional_text(item.get("rawAssetId"), "pageChanges[].rawAssetId")
            _require_optional_text(item.get("rawVersionId"), "pageChanges[].rawVersionId")
        page_changes.append(item)
    return page_changes


def persist_handoff_record(
    *,
    payload: dict[str, object],
    inbox_dir: Path,
) -> tuple[str, str]:
    inbox_dir.mkdir(parents=True, exist_ok=True)
    event_id = _require_non_empty_text(payload.get("eventId"), "eventId")
    record_path = inbox_dir / f"{_safe_event_id(event_id)}.json"

    dispatch_ref = f"owdispatch_{uuid4().hex}"
    received_at = datetime.now(UTC).isoformat()
    record = {
        "schemaVersion": OFFICIAL_WEB_HANDOFF_RECORD_SCHEMA_VERSION,
        "dispatchRef": dispatch_ref,
        "eventId": event_id,
        "receivedAt": received_at,
        "processingStatus": "pending",
        "processingAttemptCount": 0,
        "processingStartedAt": None,
        "processedAt": None,
        "lastError": None,
        "executionReportPath": None,
        "projectionOutputDir": None,
        "replayInputDir": None,
        "payload": payload,
    }
    try:
        with record_path.open("x", encoding="utf-8") as handle:
            handle.write(json.dumps(record, ensure_ascii=False, indent=2))
        return dispatch_ref, received_at
    except FileExistsError:
        existing = json.loads(record_path.read_text(encoding="utf-8"))
        existing_payload = existing.get("payload")
        if existing_payload != payload:
            raise FileExistsError(
                f"handoff event {event_id} already exists with different payload."
            ) from None
        existing_dispatch_ref = _require_non_empty_text(existing.get("dispatchRef"), "dispatchRef")
        existing_received_at = _require_non_empty_text(existing.get("receivedAt"), "receivedAt")
        return existing_dispatch_ref, existing_received_at


def _safe_event_id(event_id: str) -> str:
    sanitized = "".join(
        character for character in event_id if character.isalnum() or character in {"-", "_"}
    )
    if not sanitized:
        raise ValueError("eventId must contain at least one safe filename character.")
    return sanitized


def _extract_event_id_header(headers: Mapping[str, str]) -> str:
    value = headers.get("x-official-web-event-id", "")
    return value.strip()


def error_response(status_code: int, error: ErrorInfo) -> HttpResponse:
    return HttpResponse(
        status_code=status_code,
        json_body={
            "error": {
                "code": error.code,
                "message": error.message,
                "retryable": error.retryable,
            }
        },
    )


def dispatch_http_request(
    app: OfficialWebHandoffReceiverApp,
    *,
    method: str,
    path: str,
    headers: Mapping[str, str] | None = None,
    raw_body: bytes | None = None,
) -> HttpResponse:
    json_body = _parse_json_body(method=method, raw_body=raw_body)
    if json_body == {"__invalid_json__": True}:
        return error_response(
            HTTPStatus.BAD_REQUEST,
            ErrorInfo(code="invalid_json", message="Request body must be a JSON object."),
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
    settings: OfficialWebHandoffReceiverSettings | None = None,
) -> OfficialWebHandoffHttpServer:
    runtime_settings = settings or OfficialWebHandoffReceiverSettings.from_env()
    server_settings = OfficialWebHandoffServerSettings.from_env()
    resolved_host = host or server_settings.host
    resolved_port = port or server_settings.port
    app = create_app(settings=runtime_settings)
    return OfficialWebHandoffHttpServer((resolved_host, resolved_port), app)


def serve(
    *,
    host: str | None = None,
    port: int | None = None,
    settings: OfficialWebHandoffReceiverSettings | None = None,
) -> None:
    server = create_http_server(
        host=host,
        port=port,
        settings=settings,
    )
    print(
        "campus-ingestion-worker official_web handoff receiver listening on "
        f"http://{server.server_address[0]}:{server.server_address[1]}"
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


def main() -> None:
    from campus_ingestion_worker.env_bootstrap import load_worker_env

    load_worker_env()
    serve()


__all__ = [
    "OFFICIAL_WEB_HANDOFF_RECORD_SCHEMA_VERSION",
    "ErrorInfo",
    "HttpResponse",
    "HttpRoute",
    "OfficialWebHandoffHttpServer",
    "OfficialWebHandoffReceiverApp",
    "OfficialWebHandoffReceiverSettings",
    "OfficialWebHandoffServerSettings",
    "accept_handoff",
    "build_routes",
    "create_app",
    "create_http_server",
    "dispatch_http_request",
    "error_response",
    "healthz",
    "main",
    "persist_handoff_record",
    "readyz",
    "serve",
    "validate_handoff_payload",
]


if __name__ == "__main__":
    main()
