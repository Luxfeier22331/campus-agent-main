from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass

from campus_contracts import (
    AcademicCalendarLookupPayload,
    AgentRequest,
    AgentResponse,
    ContactDirectoryLookupPayload,
    ServiceGuideLookupPayload,
    ServiceStatusLookupPayload,
    TransportScheduleLookupPayload,
)
from campus_notice_agent.query_service import NoticeQueryService
from campus_rag_agent.rag_sdk_models import RagSdkRunRequest
from campus_rag_agent.rag_sdk_tools import (
    RagSdkToolError,
    execute_retrieve_evidence_tool,
)
from campus_services_agent.query_service import CampusServicesQueryService

from campus_supervisor_agent_worker.openai_agents_runtime import OpenAIAgentsToolInvocation
from campus_supervisor_agent_worker.tool_spec_registry import (
    ToolSpec,
    ToolSpecRegistry,
    ToolSpecRegistryError,
    default_tool_spec_registry,
)

ToolResult = Mapping[str, object] | AgentResponse | str
ToolHandler = Callable[[OpenAIAgentsToolInvocation, "ToolExecutionContext"], ToolResult]
InternalFunctionHandler = Callable[["ToolExecutionContext"], AgentResponse]
StructuredDirectHandler = Callable[["ToolExecutionContext"], AgentResponse]


class ToolExecutionError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ToolExecutionContext:
    agent_request: AgentRequest | None = None
    rag_sdk_request: RagSdkRunRequest | None = None


@dataclass(frozen=True, slots=True)
class ToolExecutionRegistry:
    tool_registry: ToolSpecRegistry
    sdk_handlers: dict[str, ToolHandler]
    internal_function_handlers: dict[str, InternalFunctionHandler]
    structured_direct_handlers: dict[str, StructuredDirectHandler]

    def execute(
        self,
        invocation: OpenAIAgentsToolInvocation,
        *,
        context: ToolExecutionContext,
    ) -> ToolResult:
        tool = self._required_tool(invocation.name)
        if tool.runtime_posture == "closed":
            raise ToolExecutionError(f"tool is closed: {tool.name}")
        if tool.runtime_posture == "internal_function":
            raise ToolExecutionError(f"tool is internal_function only: {tool.name}")
        handler = self.sdk_handlers.get(tool.name)
        if handler is None:
            raise ToolExecutionError(f"tool has no registered sdk handler: {tool.name}")
        return handler(invocation, context)

    def execute_internal_function(
        self,
        name: str,
        *,
        context: ToolExecutionContext,
    ) -> AgentResponse:
        tool = self._required_tool(name)
        if tool.runtime_posture != "internal_function":
            raise ToolExecutionError(f"tool is not registered as internal_function: {tool.name}")
        handler = self.internal_function_handlers.get(tool.name)
        if handler is None:
            raise ToolExecutionError(
                f"tool has no registered internal function handler: {tool.name}"
            )
        return handler(context)

    def execute_structured_direct(
        self,
        name: str,
        *,
        context: ToolExecutionContext,
    ) -> AgentResponse:
        tool = self._required_tool(name)
        if tool.runtime_posture not in {"sdk_adapter_admitted", "sdk_internal_admitted"}:
            raise ToolExecutionError(
                f"tool runtime_posture is not direct-executable: {tool.name} ({tool.runtime_posture})"
            )
        handler = self.structured_direct_handlers.get(tool.name)
        if handler is None:
            raise ToolExecutionError(
                f"tool has no registered structured direct handler: {tool.name}"
            )
        return handler(context)

    def _required_tool(self, name: str) -> ToolSpec:
        tool = self.tool_registry.tool_by_name(name)
        if tool is None:
            raise ToolExecutionError(f"unknown tool: {name}")
        return tool


@dataclass(frozen=True, slots=True)
class ToolExecutionSession:
    tool_registry: ToolSpecRegistry
    execution_registry: ToolExecutionRegistry

    def execute_sdk_tool(
        self,
        invocation: OpenAIAgentsToolInvocation,
        *,
        context: ToolExecutionContext,
    ) -> ToolResult:
        if context.agent_request is not None:
            self._validate_agent_request_admits_sdk_tool(
                invocation.name,
                agent_request=context.agent_request,
            )
        tool = self._required_tool(invocation.name)
        if tool.runtime_posture not in {"sdk_adapter_admitted", "sdk_internal_admitted"}:
            raise ToolExecutionError(
                f"tool runtime_posture is not SDK-executable: {tool.name} ({tool.runtime_posture})"
            )
        return self.execution_registry.execute(invocation, context=context)

    def execute_internal_function(
        self,
        name: str,
        *,
        context: ToolExecutionContext,
    ) -> AgentResponse:
        if context.agent_request is not None:
            self._validate_agent_request_admits_internal_function(
                name,
                agent_request=context.agent_request,
            )
        tool = self._required_tool(name)
        if tool.runtime_posture != "internal_function":
            raise ToolExecutionError(
                f"tool runtime_posture is not internal_function: {tool.name} ({tool.runtime_posture})"
            )
        return self.execution_registry.execute_internal_function(name, context=context)

    def execute_structured_direct(
        self,
        name: str,
        *,
        context: ToolExecutionContext,
    ) -> AgentResponse:
        if context.agent_request is not None:
            self._validate_agent_request_admits_sdk_tool(
                name,
                agent_request=context.agent_request,
            )
        tool = self._required_tool(name)
        if tool.runtime_posture not in {"sdk_adapter_admitted", "sdk_internal_admitted"}:
            raise ToolExecutionError(
                f"tool runtime_posture is not direct-executable: {tool.name} ({tool.runtime_posture})"
            )
        return self.execution_registry.execute_structured_direct(name, context=context)

    def _validate_agent_request_admits_sdk_tool(
        self,
        name: str,
        *,
        agent_request: AgentRequest,
    ) -> None:
        if name not in agent_request.allowed_tools:
            raise ToolExecutionError(f"tool is not admitted by current agent_request: {name}")
        self._validate_agent_request_allowed_tools(agent_request)

    def _validate_agent_request_admits_internal_function(
        self,
        name: str,
        *,
        agent_request: AgentRequest,
    ) -> None:
        payload_tool_name = self.tool_registry.payload_kind_for_request(
            agent_request.target,
            agent_request.payload,
        )
        if payload_tool_name != name:
            raise ToolExecutionError(
                f"internal function is not admitted by current agent_request: {name}"
            )
        self._validate_agent_request_allowed_tools(agent_request)

    def _validate_agent_request_allowed_tools(self, agent_request: AgentRequest) -> None:
        try:
            expected_tools = self.tool_registry.expected_allowed_tools_for_request(agent_request)
        except ToolSpecRegistryError as exc:
            raise ToolExecutionError(str(exc)) from exc
        if agent_request.allowed_tools != expected_tools:
            raise ToolExecutionError(
                "agent_request.allowed_tools do not match ToolSpec admission: "
                f"got {agent_request.allowed_tools!r}, want {expected_tools!r}"
            )

    def _required_tool(self, name: str) -> ToolSpec:
        tool = self.tool_registry.tool_by_name(name)
        if tool is None:
            raise ToolExecutionError(f"unknown tool: {name}")
        return tool


def build_default_tool_execution_session(
    *,
    campus_services_query_service: CampusServicesQueryService | None,
    notice_query_service: NoticeQueryService | None,
    tool_registry: ToolSpecRegistry | None = None,
) -> ToolExecutionSession:
    resolved_tool_registry = tool_registry or default_tool_spec_registry()
    execution_registry = build_default_tool_execution_registry(
        campus_services_query_service=campus_services_query_service,
        notice_query_service=notice_query_service,
        tool_registry=resolved_tool_registry,
    )
    return ToolExecutionSession(
        tool_registry=resolved_tool_registry,
        execution_registry=execution_registry,
    )


def build_default_tool_execution_registry(
    *,
    campus_services_query_service: CampusServicesQueryService | None,
    notice_query_service: NoticeQueryService | None,
    tool_registry: ToolSpecRegistry | None = None,
) -> ToolExecutionRegistry:
    resolved_tool_registry = tool_registry or default_tool_spec_registry()
    sdk_handlers: dict[str, ToolHandler] = {}
    internal_function_handlers: dict[str, InternalFunctionHandler] = {}
    structured_direct_handlers: dict[str, StructuredDirectHandler] = {}

    def _require_agent_request(context: ToolExecutionContext) -> AgentRequest:
        if context.agent_request is None:
            raise ToolExecutionError("agent_request is required for this tool")
        return context.agent_request

    def _require_rag_sdk_request(context: ToolExecutionContext) -> RagSdkRunRequest:
        if context.rag_sdk_request is None:
            raise ToolExecutionError("rag_sdk_request is required for this tool")
        return context.rag_sdk_request

    def _missing_query_service(tool_name: str) -> ToolExecutionError:
        return ToolExecutionError(
            f"query_service_unavailable: structured tool requires an internal query service: {tool_name}"
        )

    from campus_services_agent.academic_calendar_adapter import academic_calendar_response
    from campus_services_agent.observability import query_service_failed
    from campus_services_agent.query_service import (
        AcademicCalendarQuery,
        CampusServicesAccessContext,
        ContactDirectoryQuery,
        ServiceGuideQuery,
        ServiceStatusQuery,
        TransportScheduleQuery,
    )
    from campus_services_agent.response_builder import (
        contact_directory_response,
        service_guide_response,
        service_status_response,
        transport_schedule_response,
    )
    from campus_services_agent.sdk_tool_executor import execute_campus_services_sdk_tool

    for tool_name in (
        "service_status_lookup",
        "service_guide_lookup",
        "transport_schedule_lookup",
        "contact_directory_lookup",
        "academic_calendar_lookup",
    ):
        sdk_handlers[tool_name] = (
            lambda invocation, context, _service=campus_services_query_service, _tool_name=tool_name: (
                execute_campus_services_sdk_tool(
                    invocation,
                    agent_request=_require_agent_request(context),
                    query_service=_service,
                )
                if _service is not None
                else _raise_tool_execution_error(_missing_query_service(_tool_name))
            )
        )

    def _require_campus_services_agent_request(context: ToolExecutionContext) -> AgentRequest:
        request = _require_agent_request(context)
        if request.target != "campus-services-agent":
            raise ToolExecutionError(
                "structured direct campus-services execution requires campus-services-agent"
            )
        return request

    def _campus_services_access_context(request: AgentRequest) -> CampusServicesAccessContext:
        return CampusServicesAccessContext(
            actor=request.actor,
            authorization=request.context.authorization,
        )

    def _structured_direct_service_status(context: ToolExecutionContext) -> AgentResponse:
        request = _require_campus_services_agent_request(context)
        payload = request.payload
        if not isinstance(payload, ServiceStatusLookupPayload):
            raise ToolExecutionError("service_status_lookup requires ServiceStatusLookupPayload")
        if campus_services_query_service is None:
            return query_service_failed(
                "service_status_lookup",
                "internal query service is unavailable for service_status_lookup",
            )
        try:
            result = campus_services_query_service.lookup_service_status(
                ServiceStatusQuery(
                    payload=payload,
                    access_context=_campus_services_access_context(request),
                )
            )
        except Exception as exc:
            return query_service_failed("service_status_lookup", str(exc))
        return service_status_response(result)

    def _structured_direct_service_guide(context: ToolExecutionContext) -> AgentResponse:
        request = _require_campus_services_agent_request(context)
        payload = request.payload
        if not isinstance(payload, ServiceGuideLookupPayload):
            raise ToolExecutionError("service_guide_lookup requires ServiceGuideLookupPayload")
        if campus_services_query_service is None:
            return query_service_failed(
                "service_guide_lookup",
                "internal query service is unavailable for service_guide_lookup",
            )
        try:
            result = campus_services_query_service.lookup_service_guide(
                ServiceGuideQuery(
                    payload=payload,
                    access_context=_campus_services_access_context(request),
                )
            )
        except Exception as exc:
            return query_service_failed("service_guide_lookup", str(exc))
        return service_guide_response(result)

    def _structured_direct_transport_schedule(context: ToolExecutionContext) -> AgentResponse:
        request = _require_campus_services_agent_request(context)
        payload = request.payload
        if not isinstance(payload, TransportScheduleLookupPayload):
            raise ToolExecutionError(
                "transport_schedule_lookup requires TransportScheduleLookupPayload"
            )
        if campus_services_query_service is None:
            return query_service_failed(
                "transport_schedule_lookup",
                "internal query service is unavailable for transport_schedule_lookup",
            )
        try:
            result = campus_services_query_service.lookup_transport_schedule(
                TransportScheduleQuery(
                    payload=payload,
                    access_context=_campus_services_access_context(request),
                )
            )
        except Exception as exc:
            return query_service_failed("transport_schedule_lookup", str(exc))
        return transport_schedule_response(result)

    def _structured_direct_contact_directory(context: ToolExecutionContext) -> AgentResponse:
        request = _require_campus_services_agent_request(context)
        payload = request.payload
        if not isinstance(payload, ContactDirectoryLookupPayload):
            raise ToolExecutionError(
                "contact_directory_lookup requires ContactDirectoryLookupPayload"
            )
        if campus_services_query_service is None:
            return query_service_failed(
                "contact_directory_lookup",
                "internal query service is unavailable for contact_directory_lookup",
            )
        try:
            result = campus_services_query_service.lookup_contact_directory(
                ContactDirectoryQuery(
                    payload=payload,
                    access_context=_campus_services_access_context(request),
                )
            )
        except Exception as exc:
            return query_service_failed("contact_directory_lookup", str(exc))
        return contact_directory_response(result)

    def _structured_direct_academic_calendar(context: ToolExecutionContext) -> AgentResponse:
        request = _require_campus_services_agent_request(context)
        payload = request.payload
        if not isinstance(payload, AcademicCalendarLookupPayload):
            raise ToolExecutionError(
                "academic_calendar_lookup requires AcademicCalendarLookupPayload"
            )
        if campus_services_query_service is None:
            return query_service_failed(
                "academic_calendar_lookup",
                "internal query service is unavailable for academic_calendar_lookup",
            )
        try:
            result = campus_services_query_service.lookup_academic_calendar(
                AcademicCalendarQuery(
                    payload=payload,
                    access_context=_campus_services_access_context(request),
                )
            )
        except Exception as exc:
            return query_service_failed("academic_calendar_lookup", str(exc))
        return academic_calendar_response(result)

    structured_direct_handlers.update(
        {
            "service_status_lookup": _structured_direct_service_status,
            "service_guide_lookup": _structured_direct_service_guide,
            "transport_schedule_lookup": _structured_direct_transport_schedule,
            "contact_directory_lookup": _structured_direct_contact_directory,
            "academic_calendar_lookup": _structured_direct_academic_calendar,
        }
    )

    from campus_notice_agent.notice_get_runtime import run_notice_get_internal_request
    from campus_notice_agent.sdk_tool_executor import execute_notice_sdk_tool

    for tool_name in (
        "campus_notice_discover",
        "campus_notice_change_set_lookup",
    ):
        sdk_handlers[tool_name] = (
            lambda invocation, context, _service=notice_query_service, _tool_name=tool_name: (
                execute_notice_sdk_tool(
                    invocation,
                    agent_request=_require_agent_request(context),
                    query_service=_service,
                )
                if _service is not None
                else _raise_tool_execution_error(_missing_query_service(_tool_name))
            )
        )
    internal_function_handlers["campus_notice_get"] = (
        lambda context, _service=notice_query_service: run_notice_get_internal_request(
            _require_agent_request(context),
            query_service=_service,
        )
    )

    def _execute_retrieve_evidence(
        invocation: OpenAIAgentsToolInvocation,
        context: ToolExecutionContext,
    ) -> ToolResult:
        request = _require_rag_sdk_request(context)
        try:
            return execute_retrieve_evidence_tool(
                request,
                arguments=dict(invocation.arguments),
            )
        except RagSdkToolError as exc:
            raise ToolExecutionError(str(exc)) from exc

    sdk_handlers["retrieve_evidence"] = _execute_retrieve_evidence

    _validate_registry_bindings(
        resolved_tool_registry,
        sdk_handlers=sdk_handlers,
        internal_function_handlers=internal_function_handlers,
        structured_direct_handlers=structured_direct_handlers,
    )
    return ToolExecutionRegistry(
        tool_registry=resolved_tool_registry,
        sdk_handlers=sdk_handlers,
        internal_function_handlers=internal_function_handlers,
        structured_direct_handlers=structured_direct_handlers,
    )


def _raise_tool_execution_error(error: ToolExecutionError) -> ToolResult:
    raise error


def _validate_registry_bindings(
    tool_registry: ToolSpecRegistry,
    *,
    sdk_handlers: dict[str, ToolHandler],
    internal_function_handlers: dict[str, InternalFunctionHandler],
    structured_direct_handlers: dict[str, StructuredDirectHandler],
) -> None:
    for tool in tool_registry.tools:
        if tool.runtime_posture == "closed":
            if (
                tool.name in sdk_handlers
                or tool.name in internal_function_handlers
                or tool.name in structured_direct_handlers
            ):
                raise ToolExecutionError(f"closed tool must not be registered: {tool.name}")
            continue
        if tool.runtime_posture in {"sdk_adapter_admitted", "sdk_internal_admitted"}:
            if tool.name not in sdk_handlers:
                raise ToolExecutionError(f"sdk tool is missing handler: {tool.name}")
            continue
        if tool.runtime_posture == "internal_function":
            if tool.name not in internal_function_handlers:
                raise ToolExecutionError(f"internal function is missing handler: {tool.name}")
            continue
        if (
            tool.name in sdk_handlers
            or tool.name in internal_function_handlers
            or tool.name in structured_direct_handlers
        ):
            raise ToolExecutionError(
                f"non-executable runtime posture must not be registered: {tool.name}"
            )


__all__ = [
    "ToolExecutionContext",
    "ToolExecutionError",
    "ToolExecutionRegistry",
    "ToolExecutionSession",
    "build_default_tool_execution_registry",
    "build_default_tool_execution_session",
]
