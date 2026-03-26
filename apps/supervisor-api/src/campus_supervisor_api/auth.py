from __future__ import annotations

from dataclasses import dataclass
import secrets
from typing import Mapping

from campus_contracts import ActorContext

from campus_supervisor_api.settings import ApiSettings


@dataclass(frozen=True, slots=True)
class ApiAuthError(Exception):
    code: str
    message: str
    status_code: int = 401


def map_actor_context(headers: Mapping[str, str], settings: ApiSettings) -> ActorContext:
    if settings.auth_mode == "bearer":
        return _map_bearer_actor_context(headers, settings)
    if settings.auth_mode == "trusted-worker":
        return _map_trusted_worker_actor_context(headers, settings)
    raise ApiAuthError(code="unsupported_auth_mode", message="Unsupported auth mode.")


def _map_bearer_actor_context(headers: Mapping[str, str], settings: ApiSettings) -> ActorContext:
    token = _extract_bearer_token(headers.get("authorization", ""))
    if settings.bearer_token and token != settings.bearer_token:
        raise ApiAuthError(code="unauthorized", message="Invalid bearer token.")
    if not token:
        raise ApiAuthError(code="unauthorized", message="Missing bearer token.")

    return ActorContext(
        user_id=headers.get("x-actor-id", "api-user"),
        roles=_split_header_list(headers.get("x-actor-roles")) or settings.default_actor_roles,
        groups=_split_header_list(headers.get("x-actor-groups")) or settings.default_actor_groups,
        campus_scope=headers.get("x-campus-scope", settings.default_campus_scope),
    )


def _map_trusted_worker_actor_context(headers: Mapping[str, str], settings: ApiSettings) -> ActorContext:
    worker_secret = headers.get("x-worker-origin-auth", "")
    if not settings.worker_shared_secret:
        raise ApiAuthError(
            code="unauthorized",
            message="Trusted worker auth is not configured.",
        )
    if not worker_secret:
        raise ApiAuthError(code="unauthorized", message="Missing worker origin auth.")
    if not secrets.compare_digest(worker_secret, settings.worker_shared_secret):
        raise ApiAuthError(code="unauthorized", message="Invalid worker origin auth.")

    return ActorContext(
        user_id=settings.worker_actor_id,
        roles=settings.default_actor_roles,
        groups=settings.default_actor_groups,
        campus_scope=settings.default_campus_scope,
    )


def _extract_bearer_token(header_value: str) -> str:
    scheme, _, token = header_value.partition(" ")
    if scheme.lower() != "bearer":
        return ""
    return token.strip()


def _split_header_list(value: str | None) -> tuple[str, ...]:
    if not value:
        return ()
    return tuple(part.strip() for part in value.split(",") if part.strip())
