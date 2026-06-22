from __future__ import annotations

import json
import stat
from dataclasses import dataclass
from pathlib import Path
from typing import Any

PROJECTION_SCHEMA_VERSION = "provider_config_projection.v1"
PROJECTION_PATH_ENV_KEYS = (
    "CAMPUS_PROVIDER_CONFIG_SNAPSHOT_PATH",
    "EXECUTION_CONTROL_PROVIDER_CONFIG_SNAPSHOT_PATH",
)


class ProviderProjectionError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ProviderProfileSnapshot:
    api_key: str
    base_url: str
    dimensions: int | None
    kind: str
    model: str
    profile_id: str
    provider: str
    revision: int
    role: str
    timeout_ms: int
    transport: str


@dataclass(frozen=True, slots=True)
class ProviderProjection:
    generated_at: str
    profiles: dict[str, ProviderProfileSnapshot]

    def profile(self, role: str) -> ProviderProfileSnapshot:
        normalized = role.strip()
        profile = self.profiles.get(normalized)
        if profile is None:
            raise ProviderProjectionError(f"provider projection missing active role {normalized}")
        return profile


def provider_projection_path_from_env(env: dict[str, str]) -> Path:
    for key in PROJECTION_PATH_ENV_KEYS:
        value = env.get(key, "").strip()
        if value:
            return Path(value)
    checked = ", ".join(PROJECTION_PATH_ENV_KEYS)
    raise ProviderProjectionError(f"provider projection path is required; checked {checked}")


def load_provider_projection(path: str | Path) -> ProviderProjection:
    resolved = Path(path)
    _require_secure_projection_file(resolved)
    payload = json.loads(resolved.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ProviderProjectionError("provider projection must be a JSON object")
    if payload.get("schema_version") != PROJECTION_SCHEMA_VERSION:
        raise ProviderProjectionError("provider projection schema_version is unsupported")
    raw_profiles = payload.get("profiles")
    if not isinstance(raw_profiles, dict) or not raw_profiles:
        raise ProviderProjectionError("provider projection profiles must be a non-empty object")
    profiles = {
        role: _parse_profile(role, value)
        for role, value in raw_profiles.items()
        if isinstance(role, str)
    }
    return ProviderProjection(
        generated_at=str(payload.get("generated_at") or ""),
        profiles=profiles,
    )


def load_provider_projection_from_env(env: dict[str, str]) -> ProviderProjection:
    return load_provider_projection(provider_projection_path_from_env(env))


def provider_projection_status(
    path: str | Path,
    *,
    required_roles: tuple[str, ...],
) -> dict[str, object]:
    try:
        projection = load_provider_projection(path)
        profiles = {
            role: _public_profile_status(projection.profile(role)) for role in required_roles
        }
    except ProviderProjectionError as exc:
        return {
            "ready": False,
            "error": str(exc),
            "error_code": _projection_error_code(str(exc)),
            "profiles": {},
        }
    return {
        "ready": True,
        "error": None,
        "error_code": None,
        "profiles": profiles,
    }


def _require_secure_projection_file(path: Path) -> None:
    try:
        file_stat = path.stat()
    except FileNotFoundError as exc:
        raise ProviderProjectionError(f"provider projection file does not exist: {path}") from exc
    mode = stat.S_IMODE(file_stat.st_mode)
    if mode != stat.S_IRUSR | stat.S_IWUSR:
        raise ProviderProjectionError("provider projection file permissions must be 0600")
    if not stat.S_ISREG(file_stat.st_mode):
        raise ProviderProjectionError("provider projection path must be a regular file")


def _parse_profile(role: str, value: object) -> ProviderProfileSnapshot:
    if not isinstance(value, dict):
        raise ProviderProjectionError(f"provider projection role {role} must be an object")
    snapshot = ProviderProfileSnapshot(
        api_key=_required_str(value, "api_key", role),
        base_url=_required_str(value, "base_url", role),
        dimensions=_optional_int(value.get("dimensions")),
        kind=_required_str(value, "kind", role),
        model=_required_str(value, "model", role),
        profile_id=_required_str(value, "profile_id", role),
        provider=_required_str(value, "provider", role),
        revision=_required_positive_int(value, "revision", role),
        role=_required_str(value, "role", role),
        timeout_ms=_required_positive_int(value, "timeout_ms", role),
        transport=_required_str(value, "transport", role),
    )
    if snapshot.role != role:
        raise ProviderProjectionError(
            f"provider projection role key {role} does not match profile role {snapshot.role}"
        )
    if snapshot.kind == "embedding" and (snapshot.dimensions is None or snapshot.dimensions <= 0):
        raise ProviderProjectionError(f"provider projection role {role} dimensions is required")
    return snapshot


def _required_str(value: dict[str, Any], key: str, role: str) -> str:
    raw = value.get(key)
    if not isinstance(raw, str) or not raw.strip():
        raise ProviderProjectionError(f"provider projection role {role} {key} is required")
    return raw.strip()


def _required_positive_int(value: dict[str, Any], key: str, role: str) -> int:
    raw = value.get(key)
    if not isinstance(raw, int) or raw <= 0:
        raise ProviderProjectionError(f"provider projection role {role} {key} is required")
    return raw


def _optional_int(value: object) -> int | None:
    if value is None:
        return None
    if not isinstance(value, int):
        raise ProviderProjectionError("provider projection dimensions must be an integer")
    return value


def _public_profile_status(profile: ProviderProfileSnapshot) -> dict[str, object]:
    return {
        "base_url": profile.base_url,
        "dimensions": profile.dimensions,
        "kind": profile.kind,
        "model": profile.model,
        "profile_id": profile.profile_id,
        "provider": profile.provider,
        "revision": profile.revision,
        "role": profile.role,
        "timeout_ms": profile.timeout_ms,
        "transport": profile.transport,
        "secret_configured": bool(profile.api_key),
    }


def _projection_error_code(message: str) -> str:
    if "permissions" in message:
        return "projection_file_permissions"
    if "does not exist" in message:
        return "projection_file_missing"
    return "projection_invalid"
