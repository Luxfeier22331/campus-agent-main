from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from campus_protected_panel_web.api import HttpResponse, HttpRoute, build_routes
from campus_protected_panel_web.settings import ProtectedPanelSettings


@dataclass(slots=True)
class ProtectedPanelApp:
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
        return HttpResponse(
            status_code=404,
            json_body={"error": {"code": "not_found", "message": "Route not found."}},
        )


def create_app(*, settings: ProtectedPanelSettings | None = None) -> ProtectedPanelApp:
    runtime_settings = settings or ProtectedPanelSettings.from_env()
    return ProtectedPanelApp(
        name=runtime_settings.app_name,
        routes=build_routes(runtime_settings),
    )
