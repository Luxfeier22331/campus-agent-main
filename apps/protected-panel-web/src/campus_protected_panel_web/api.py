from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import asdict, dataclass, field

from campus_protected_panel_web.settings import ProtectedPanelSettings


@dataclass(frozen=True, slots=True)
class ErrorInfo:
    code: str
    message: str


@dataclass(frozen=True, slots=True)
class HttpResponse:
    status_code: int
    json_body: dict[str, object]
    headers: dict[str, str] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class HttpRoute:
    method: str
    path: str
    handler: Callable[[Mapping[str, str], dict[str, object] | None], HttpResponse]


def build_routes(settings: ProtectedPanelSettings) -> tuple[HttpRoute, ...]:
    return (
        HttpRoute("GET", "/healthz", lambda headers, body: healthz(settings)),
        HttpRoute("GET", "/readyz", lambda headers, body: readyz(settings)),
        HttpRoute("GET", "/", lambda headers, body: fail_closed_root(settings)),
    )


def healthz(settings: ProtectedPanelSettings) -> HttpResponse:
    return HttpResponse(
        status_code=200,
        json_body={
            "status": "ok",
            "app_name": settings.app_name,
            "surface": "protected-panel-web",
        },
    )


def readyz(settings: ProtectedPanelSettings) -> HttpResponse:
    return HttpResponse(
        status_code=200,
        json_body={
            "status": "ready",
            "runtime_api_base_url": settings.runtime_api_base_url,
            "protection_envelope": settings.protection_envelope,
        },
    )


def fail_closed_root(settings: ProtectedPanelSettings) -> HttpResponse:
    return HttpResponse(
        status_code=403,
        json_body={
            "error": asdict(
                ErrorInfo(
                    code="protected_surface_required",
                    message=(
                        "Protected panel stays fail-closed until an outer protected "
                        "access envelope and panel-facing runtime API inventory are configured."
                    ),
                )
            ),
            "runtime_api_base_url": settings.runtime_api_base_url,
        },
    )
