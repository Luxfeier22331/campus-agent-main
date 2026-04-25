from __future__ import annotations

import secrets
from collections.abc import Mapping
from dataclasses import asdict

from campus_contracts import ErrorInfo

from campus_supervisor_agent_worker.http_types import HttpResponse
from campus_supervisor_agent_worker.settings import ApiSettings


def error_response(status_code: int, error: ErrorInfo) -> HttpResponse:
    return HttpResponse(status_code=status_code, json_body={"error": asdict(error)})


def require_bridge_auth(headers: Mapping[str, str], settings: ApiSettings) -> HttpResponse | None:
    shared_secret = settings.bridge_shared_secret.strip()
    if not shared_secret:
        return error_response(
            500,
            ErrorInfo(
                code="bridge_auth_not_configured",
                message="Supervisor bridge auth is not configured.",
            ),
        )

    presented = headers.get("x-supervisor-bridge-auth", "")
    if not presented:
        return error_response(
            401,
            ErrorInfo(code="unauthorized", message="Missing supervisor bridge auth."),
        )
    if not secrets.compare_digest(presented, shared_secret):
        return error_response(
            401,
            ErrorInfo(code="unauthorized", message="Invalid supervisor bridge auth."),
        )
    return None
