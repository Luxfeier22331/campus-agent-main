from __future__ import annotations

from collections.abc import Mapping
from dataclasses import asdict, dataclass, field, replace
from functools import partial
from threading import BoundedSemaphore, Lock

import httpx
from campus_shared import (
    PromptRuntimeHTTPSettings,
    PromptRuntimeProviderConfig,
    build_prompt_runtime_http_client,
)
from campus_supervisor_core import handle_request

from campus_supervisor_api.api import (
    HttpResponse,
    HttpRoute,
    build_bridge_routes,
    build_routes,
)
from campus_supervisor_api.audit import AsyncJsonlAuditRuntime
from campus_supervisor_api.prompt_executor import (
    ProviderBackedRagPromptExecutor,
    ProviderBackedSupervisorPromptExecutor,
)
from campus_supervisor_api.prompt_stack import PromptRuntimeSettings
from campus_supervisor_api.settings import ApiSettings


@dataclass(frozen=True, slots=True)
class AgentOSRuntime:
    provider: str = ""
    supervisor_model: str = ""
    specialist_model: str = ""
    prompt_runtime: PromptRuntimeSettings = field(default_factory=PromptRuntimeSettings)


@dataclass(slots=True)
class PromptHTTPPoolRuntime:
    settings: PromptRuntimeHTTPSettings
    base_url: str
    client: httpx.Client | None = None

    def status(self, *, admitted: bool) -> dict[str, object]:
        configured = admitted and self.client is not None
        return {
            "healthy": configured,
            "configured": configured,
            "base_url": self.base_url,
            "max_connections": self.settings.max_connections,
            "max_keepalive_connections": self.settings.max_keepalive_connections,
            "keepalive_expiry_seconds": self.settings.keepalive_expiry_seconds,
        }

    def close(self) -> None:
        if self.client is not None:
            self.client.close()


class TransportAdmissionRuntime:
    def __init__(self, *, max_concurrent_answers: int) -> None:
        if max_concurrent_answers <= 0:
            raise ValueError("max_concurrent_answers must be greater than zero")
        self.max_concurrent_answers = max_concurrent_answers
        self._semaphore = BoundedSemaphore(max_concurrent_answers)
        self._lock = Lock()
        self._active_answers = 0
        self._saturated_count = 0

    def try_acquire_answer(self) -> bool:
        if not self._semaphore.acquire(blocking=False):
            with self._lock:
                self._saturated_count += 1
            return False
        with self._lock:
            self._active_answers += 1
        return True

    def release_answer(self) -> None:
        with self._lock:
            self._active_answers = max(0, self._active_answers - 1)
        self._semaphore.release()

    def status(self) -> dict[str, object]:
        with self._lock:
            active_answers = self._active_answers
            saturated_count = self._saturated_count
        return {
            "healthy": active_answers < self.max_concurrent_answers,
            "max_concurrent_answers": self.max_concurrent_answers,
            "active_answers": active_answers,
            "saturated_count": saturated_count,
        }


@dataclass(slots=True)
class SupervisorApiApp:
    name: str
    runtime: AgentOSRuntime
    routes: tuple[HttpRoute, ...]
    prompt_http_pool: PromptHTTPPoolRuntime
    audit_runtime: AsyncJsonlAuditRuntime
    transport_runtime: TransportAdmissionRuntime

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

    def runtime_status(self) -> dict[str, dict[str, object]]:
        return {
            "prompt_http_pool": self.prompt_http_pool.status(
                admitted=self.runtime.prompt_runtime.admitted
            ),
            "audit_runtime": asdict(self.audit_runtime.status()),
            "transport_runtime": self.transport_runtime.status(),
        }

    def flush_audit(self, *, timeout_seconds: float = 1.0) -> bool:
        return self.audit_runtime.flush(timeout_seconds=timeout_seconds)

    def close(self) -> None:
        self.audit_runtime.close()
        self.prompt_http_pool.close()


def create_app(
    *,
    settings: ApiSettings | None = None,
    supervisor_handler=handle_request,
) -> SupervisorApiApp:
    return _create_runtime_app(
        settings=settings,
        supervisor_handler=supervisor_handler,
        route_builder=build_routes,
    )


def create_bridge_app(
    *,
    settings: ApiSettings | None = None,
    supervisor_handler=handle_request,
) -> SupervisorApiApp:
    return _create_runtime_app(
        settings=settings,
        supervisor_handler=supervisor_handler,
        route_builder=build_bridge_routes,
    )


def _create_runtime_app(
    *,
    settings: ApiSettings | None = None,
    supervisor_handler=handle_request,
    route_builder,
) -> SupervisorApiApp:
    runtime_settings = settings or ApiSettings.from_env()
    (
        prompt_runtime,
        prompt_http_pool,
        supervisor_prompt_executor,
        rag_prompt_executor,
    ) = _build_prompt_runtime_assets(runtime_settings)
    audit_runtime = AsyncJsonlAuditRuntime(
        runtime_settings.audit_log_path,
        queue_capacity=runtime_settings.audit_queue_capacity,
    )
    transport_runtime = TransportAdmissionRuntime(
        max_concurrent_answers=runtime_settings.transport_max_concurrent_answers
    )
    bound_supervisor_handler = supervisor_handler
    if (
        supervisor_handler is handle_request
        and supervisor_prompt_executor is not None
        and rag_prompt_executor is not None
    ):
        bound_supervisor_handler = partial(
            handle_request,
            supervisor_prompt_executor=supervisor_prompt_executor,
            rag_prompt_executor=rag_prompt_executor,
        )
    routes = route_builder(
        runtime_settings,
        supervisor_handler=bound_supervisor_handler,
        audit_sink=audit_runtime.submit,
        prompt_runtime=prompt_runtime,
        runtime_status_provider=lambda: {
            "prompt_http_pool": prompt_http_pool.status(admitted=prompt_runtime.admitted),
            "audit_runtime": asdict(audit_runtime.status()),
            "transport_runtime": transport_runtime.status(),
        },
    )
    return SupervisorApiApp(
        name=runtime_settings.app_name,
        runtime=AgentOSRuntime(
            provider=runtime_settings.runtime_provider,
            supervisor_model=runtime_settings.supervisor_prompt_model,
            specialist_model=runtime_settings.specialist_prompt_model,
            prompt_runtime=prompt_runtime,
        ),
        routes=routes,
        prompt_http_pool=prompt_http_pool,
        audit_runtime=audit_runtime,
        transport_runtime=transport_runtime,
    )


def _build_prompt_runtime_assets(
    settings: ApiSettings,
) -> tuple[
    PromptRuntimeSettings,
    PromptHTTPPoolRuntime,
    ProviderBackedSupervisorPromptExecutor | None,
    ProviderBackedRagPromptExecutor | None,
]:
    provider = settings.prompt_runtime_provider or settings.runtime_provider
    http_settings = PromptRuntimeHTTPSettings(
        connect_timeout_seconds=settings.prompt_runtime_connect_timeout_seconds,
        read_timeout_seconds=settings.prompt_runtime_read_timeout_seconds,
        write_timeout_seconds=settings.prompt_runtime_write_timeout_seconds,
        pool_timeout_seconds=settings.prompt_runtime_pool_timeout_seconds,
        max_connections=settings.prompt_runtime_max_connections,
        max_keepalive_connections=settings.prompt_runtime_max_keepalive_connections,
        keepalive_expiry_seconds=settings.prompt_runtime_keepalive_expiry_seconds,
    )
    prompt_http_pool = PromptHTTPPoolRuntime(
        settings=http_settings,
        base_url=settings.prompt_runtime_base_url,
    )
    prompt_runtime = PromptRuntimeSettings(
        provider=provider,
        transport=settings.prompt_runtime_transport,
        supervisor_prompt_model=settings.supervisor_prompt_model,
        specialist_prompt_model=settings.specialist_prompt_model,
        strict_structured_outputs=settings.prompt_strict_structured_outputs,
    )
    if not provider:
        return (
            replace(prompt_runtime, admission_reason="provider_not_configured"),
            prompt_http_pool,
            None,
            None,
        )
    if not settings.prompt_strict_structured_outputs:
        return (
            replace(
                prompt_runtime,
                admission_reason="strict_structured_outputs_disabled",
            ),
            prompt_http_pool,
            None,
            None,
        )
    if not settings.supervisor_prompt_model.strip() or not settings.specialist_prompt_model.strip():
        return (
            replace(prompt_runtime, admission_reason="prompt_models_not_configured"),
            prompt_http_pool,
            None,
            None,
        )
    if not settings.prompt_runtime_api_key.strip():
        return (
            replace(prompt_runtime, admission_reason="api_key_not_configured"),
            prompt_http_pool,
            None,
            None,
        )
    try:
        provider_config = PromptRuntimeProviderConfig(
            provider=provider,
            transport=settings.prompt_runtime_transport,  # type: ignore[arg-type]
            api_key=settings.prompt_runtime_api_key,
            base_url=settings.prompt_runtime_base_url,
            reasoning_effort=settings.prompt_runtime_reasoning_effort,
            max_output_tokens=settings.prompt_runtime_max_output_tokens,
            http_settings=http_settings,
        )
    except ValueError as exc:
        return (
            replace(prompt_runtime, admission_reason=str(exc)),
            prompt_http_pool,
            None,
            None,
        )
    prompt_http_pool.client = build_prompt_runtime_http_client(provider_config)
    return (
        replace(prompt_runtime, admitted=True),
        prompt_http_pool,
        ProviderBackedSupervisorPromptExecutor(
            provider_config=provider_config,
            model_name=settings.supervisor_prompt_model,
            http_client=prompt_http_pool.client,
        ),
        ProviderBackedRagPromptExecutor(
            provider_config=provider_config,
            model_name=settings.specialist_prompt_model,
            http_client=prompt_http_pool.client,
        ),
    )
