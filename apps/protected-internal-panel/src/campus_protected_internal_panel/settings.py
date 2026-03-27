from __future__ import annotations

from dataclasses import dataclass
import os

from campus_shared import APP_NAME


@dataclass(frozen=True, slots=True)
class ProtectedPanelSettings:
    app_name: str = f"{APP_NAME}-protected-panel"
    runtime_api_base_url: str = ""
    protected_hostname: str = ""
    protection_envelope: str = "required"

    @classmethod
    def from_env(cls) -> "ProtectedPanelSettings":
        return cls(
            app_name=os.getenv("PANEL_APP_NAME", f"{APP_NAME}-protected-panel"),
            runtime_api_base_url=os.getenv("PANEL_RUNTIME_API_BASE_URL", ""),
            protected_hostname=os.getenv("PANEL_PROTECTED_HOSTNAME", ""),
            protection_envelope=os.getenv("PANEL_PROTECTION_ENVELOPE", "required"),
        )
