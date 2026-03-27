from __future__ import annotations

import base64
from dataclasses import dataclass
import json
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
        user_id=settings.default_actor_id,
        roles=settings.default_actor_roles,
        groups=settings.default_actor_groups,
        campus_scope=settings.default_campus_scope,
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

    jwt_payload = _decode_trusted_jwt_payload(headers.get("cf-access-jwt-assertion", ""))
    user_id = (
        _first_string_claim(jwt_payload, settings.trusted_jwt_user_id_claims)
        or settings.worker_actor_id
    )
    roles = (
        _first_sequence_claim(jwt_payload, settings.trusted_jwt_roles_claims)
        or settings.default_actor_roles
    )
    groups = (
        _first_sequence_claim(jwt_payload, settings.trusted_jwt_groups_claims)
        or settings.default_actor_groups
    )

    return ActorContext(
        user_id=user_id,
        roles=roles,
        groups=groups,
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


def _decode_trusted_jwt_payload(token: str) -> dict[str, object]:
    if not token:
        return {}
    parts = token.split(".")
    if len(parts) != 3:
        return {}
    payload = parts[1]
    payload += "=" * (-len(payload) % 4)
    try:
        decoded = base64.urlsafe_b64decode(payload.encode("ascii"))
        parsed = json.loads(decoded.decode("utf-8"))
    except (ValueError, UnicodeDecodeError, json.JSONDecodeError):
        return {}
    if isinstance(parsed, dict):
        return parsed
    return {}


def _first_string_claim(payload: Mapping[str, object], claim_names: tuple[str, ...]) -> str:
    for claim_name in claim_names:
        value = payload.get(claim_name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _first_sequence_claim(payload: Mapping[str, object], claim_names: tuple[str, ...]) -> tuple[str, ...]:
    for claim_name in claim_names:
        value = payload.get(claim_name)
        if isinstance(value, str) and value.strip():
            return (value.strip(),)
        if isinstance(value, list):
            normalized = tuple(
                item.strip() for item in value if isinstance(item, str) and item.strip()
            )
            if normalized:
                return normalized
    return ()
