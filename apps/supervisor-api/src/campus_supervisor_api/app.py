from __future__ import annotations

from dataclasses import dataclass
from typing import Mapping

from campus_supervisor_core import handle_request

from campus_supervisor_api.api import HttpResponse, HttpRoute, build_routes
from campus_supervisor_api.settings import ApiSettings


@dataclass(frozen=True, slots=True)
class AgentOSRuntime:
    provider: str = "agno"
    supervisor_model: str = ""
    specialist_model: str = ""


@dataclass(slots=True)
class SupervisorApiApp:
    name: str
    runtime: AgentOSRuntime
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
        return HttpResponse(status_code=404, json_body={"error": {"code": "not_found", "message": "Route not found."}})


def create_app(
    *,
    settings: ApiSettings | None = None,
    supervisor_handler=handle_request,
) -> SupervisorApiApp:
    runtime_settings = settings or ApiSettings.from_env()
    return SupervisorApiApp(
        name=runtime_settings.app_name,
        runtime=AgentOSRuntime(
            supervisor_model=runtime_settings.agno_supervisor_model,
            specialist_model=runtime_settings.agno_specialist_model,
        ),
        routes=build_routes(runtime_settings, supervisor_handler=supervisor_handler),
    )
