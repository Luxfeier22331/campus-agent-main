from __future__ import annotations

from dataclasses import dataclass, field
import os
from pathlib import Path

from campus_shared import APP_NAME


def _split_csv(value: str) -> tuple[str, ...]:
    return tuple(part.strip() for part in value.split(",") if part.strip())


@dataclass(frozen=True, slots=True)
class ApiSettings:
    app_name: str = APP_NAME
    auth_mode: str = "bearer"
    bearer_token: str = ""
    worker_shared_secret: str = ""
    worker_actor_id: str = "public-entry-worker"
    runtime_provider: str = ""
    default_actor_groups: tuple[str, ...] = field(default_factory=tuple)
    default_actor_roles: tuple[str, ...] = field(default_factory=tuple)
    default_campus_scope: str | None = None
    audit_log_path: Path = Path("./var/log/audit.log")
    agno_supervisor_model: str = ""
    agno_specialist_model: str = ""

    @classmethod
    def from_env(cls) -> "ApiSettings":
        return cls(
            app_name=os.getenv("CAMPUS_AGENT_APP_NAME", APP_NAME),
            auth_mode=os.getenv("API_AUTH_MODE", "bearer"),
            bearer_token=os.getenv("API_BEARER_TOKEN", ""),
            worker_shared_secret=os.getenv("API_WORKER_SHARED_SECRET", ""),
            worker_actor_id=os.getenv("API_WORKER_ACTOR_ID", "public-entry-worker"),
            runtime_provider=os.getenv("AGENT_RUNTIME_PROVIDER", ""),
            default_actor_groups=_split_csv(os.getenv("API_DEFAULT_ACTOR_GROUPS", "")),
            default_actor_roles=_split_csv(os.getenv("API_DEFAULT_ACTOR_ROLES", "")),
            default_campus_scope=os.getenv("API_DEFAULT_CAMPUS_SCOPE") or None,
            audit_log_path=Path(os.getenv("AUDIT_LOG_PATH", "./var/log/audit.log")),
            agno_supervisor_model=os.getenv("AGNO_SUPERVISOR_MODEL", ""),
            agno_specialist_model=os.getenv("AGNO_SPECIALIST_MODEL", ""),
        )
