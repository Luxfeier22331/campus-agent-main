from __future__ import annotations

import json
import math
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class ProviderProfile:
    api_key: str
    base_url: str | None
    model: str
    timeout_seconds: int


def load_provider_profiles(
    path: Path,
    *,
    required_roles: tuple[str, ...] = (),
) -> dict[str, ProviderProfile]:
    payload = _load_json_object(path)
    unsupported_fields = sorted(set(payload) - {"profiles"})
    if unsupported_fields:
        raise ValueError(
            f"provider config contains unsupported fields: {', '.join(unsupported_fields)}"
        )
    profiles = payload.get("profiles")
    if not isinstance(profiles, dict):
        raise ValueError("provider config profiles must be an object")
    unsupported = sorted(
        set(profiles)
        - {
            "eval_judge_llm",
            "eval_ragas_embedding",
            "eval_ragas_llm",
            "eval_ragas_reranker",
        }
    )
    if unsupported:
        raise ValueError(f"provider config contains unsupported profiles: {', '.join(unsupported)}")
    result = {role: _parse_profile(value, role) for role, value in profiles.items()}
    for role in required_roles:
        if role not in result:
            raise ValueError(f"provider config {role} is required")
    return result


def _parse_profile(value: object, role: str) -> ProviderProfile:
    if not isinstance(value, dict):
        raise ValueError(f"provider config {role} must be an object")
    allowed = {"api_key", "base_url", "model", "timeout_ms"}
    unknown = sorted(set(value) - allowed)
    if unknown:
        raise ValueError(
            f"provider config {role} contains unsupported fields: {', '.join(unknown)}"
        )
    timeout_ms = value.get("timeout_ms")
    if isinstance(timeout_ms, bool) or not isinstance(timeout_ms, int) or timeout_ms <= 0:
        raise ValueError(f"{role}.timeout_ms must be a positive integer")
    return ProviderProfile(
        api_key=_required_str(value.get("api_key"), f"{role}.api_key"),
        base_url=_optional_str(value.get("base_url")),
        model=_required_str(value.get("model"), f"{role}.model"),
        timeout_seconds=max(1, math.ceil(timeout_ms / 1000)),
    )


def _load_json_object(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return payload


def _required_str(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field} is required")
    return value.strip()


def _optional_str(value: object) -> str | None:
    return value.strip() if isinstance(value, str) and value.strip() else None
