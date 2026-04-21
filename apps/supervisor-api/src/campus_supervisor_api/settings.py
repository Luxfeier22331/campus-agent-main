from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from campus_shared import APP_NAME
from campus_shared.prompt_runtime import DEFAULT_PROMPT_RUNTIME_BASE_URL


def _read_bool(name: str, *, default: bool) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() not in {"0", "false", "no", "off", ""}


def _read_optional_int(name: str) -> int | None:
    value = os.getenv(name)
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    return int(normalized)


@dataclass(frozen=True, slots=True)
class ApiSettings:
    app_name: str = APP_NAME
    auth_mode: str = "bearer"
    bearer_token: str = ""
    worker_shared_secret: str = ""
    default_actor_id: str = ""
    runtime_provider: str = ""
    default_actor_roles: tuple[str, ...] = field(default_factory=tuple)
    audit_log_path: Path = Path("./var/log/audit.log")
    prompt_runtime_model: str = ""
    supervisor_prompt_model: str = ""
    specialist_prompt_model: str = ""
    prompt_runtime_provider: str = ""
    prompt_runtime_transport: str = "responses"
    prompt_runtime_api_key: str = ""
    prompt_runtime_base_url: str = DEFAULT_PROMPT_RUNTIME_BASE_URL
    prompt_runtime_reasoning_effort: str | None = None
    prompt_runtime_max_output_tokens: int | None = None
    prompt_strict_structured_outputs: bool = True

    @classmethod
    def from_env(cls) -> "ApiSettings":
        prompt_runtime_model = (os.getenv("PROMPT_RUNTIME_MODEL", "")).strip()
        return cls(
            app_name=os.getenv("CAMPUS_AGENT_APP_NAME", APP_NAME),
            auth_mode=os.getenv("API_AUTH_MODE", "bearer"),
            bearer_token=os.getenv("API_BEARER_TOKEN", ""),
            worker_shared_secret=os.getenv("API_WORKER_SHARED_SECRET", ""),
            default_actor_id=os.getenv("API_DEFAULT_ACTOR_ID", "").strip(),
            runtime_provider=os.getenv("AGENT_RUNTIME_PROVIDER", ""),
            default_actor_roles=tuple(
                part.strip()
                for part in os.getenv("API_DEFAULT_ACTOR_ROLES", "").split(",")
                if part.strip()
            ),
            audit_log_path=Path(os.getenv("AUDIT_LOG_PATH", "./var/log/audit.log")),
            prompt_runtime_model=prompt_runtime_model,
            supervisor_prompt_model=(
                os.getenv("SUPERVISOR_PROMPT_MODEL", "").strip() or prompt_runtime_model
            ),
            specialist_prompt_model=(
                os.getenv("SPECIALIST_PROMPT_MODEL", "").strip() or prompt_runtime_model
            ),
            prompt_runtime_provider=os.getenv(
                "PROMPT_RUNTIME_PROVIDER",
                os.getenv("AGENT_RUNTIME_PROVIDER", ""),
            ),
            prompt_runtime_transport=os.getenv(
                "PROMPT_RUNTIME_TRANSPORT",
                "responses",
            ).strip()
            or "responses",
            prompt_runtime_api_key=os.getenv(
                "PROMPT_RUNTIME_API_KEY",
                os.getenv("LLM_API_KEY", ""),
            ).strip(),
            prompt_runtime_base_url=os.getenv(
                "PROMPT_RUNTIME_BASE_URL",
                os.getenv("LLM_BASE_URL", DEFAULT_PROMPT_RUNTIME_BASE_URL),
            ).strip()
            or DEFAULT_PROMPT_RUNTIME_BASE_URL,
            prompt_runtime_reasoning_effort=(os.getenv("PROMPT_RUNTIME_REASONING_EFFORT") or None),
            prompt_runtime_max_output_tokens=_read_optional_int("PROMPT_RUNTIME_MAX_OUTPUT_TOKENS"),
            prompt_strict_structured_outputs=_read_bool(
                "PROMPT_STRICT_STRUCTURED_OUTPUTS",
                default=True,
            ),
        )
