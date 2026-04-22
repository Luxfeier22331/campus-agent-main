from __future__ import annotations

import os
from dataclasses import dataclass

from campus_shared import APP_NAME


@dataclass(frozen=True, slots=True)
class ProtectedPanelSettings:
    app_name: str = f"{APP_NAME}-protected-panel"
    runtime_api_base_url: str = ""
    protection_envelope: str = "required"

    @classmethod
    def from_env(cls) -> ProtectedPanelSettings:
        return cls(
            app_name=os.getenv("PANEL_APP_NAME", f"{APP_NAME}-protected-panel"),
            runtime_api_base_url=os.getenv("PANEL_RUNTIME_API_BASE_URL", ""),
            protection_envelope=os.getenv("PANEL_PROTECTION_ENVELOPE", "required"),
        )
