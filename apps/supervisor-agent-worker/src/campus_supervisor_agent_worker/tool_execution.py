from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass

from campus_contracts import CapabilityRequest, CapabilityResponse
from campus_knowledge_capability.rag_sdk_models import RagSdkRunRequest
from campus_knowledge_capability.rag_sdk_tools import (
    RagSdkToolError,
    execute_retrieve_evidence_tool,
)
from campus_notice_capability.query_service import NoticeQueryService
from campus_services_capability.query_service import CampusServicesQueryService

from campus_supervisor_agent_worker.openai_agents_runtime import OpenAIAgentsToolInvocation
from campus_supervisor_agent_worker.tool_spec_registry import (
    ToolSpec,
    ToolSpecAdmission,
    ToolSpecRegistry,
    ToolSpecRegistryError,
    default_tool_spec_registry,
)

ToolResult = Mapping[str, object] | CapabilityResponse | str
StructuredToolResult = object
ToolHandler = Callable[[OpenAIAgentsToolInvocation, "ToolExecutionContext"], ToolResult]
StructuredToolHandler = Callable[
    [OpenAIAgentsToolInvocation, "ToolExecutionContext"], StructuredToolResult
]
InternalFunctionHandler = Callable[["ToolExecutionContext"], CapabilityResponse]


class ToolExecutionError(ValueError):
    pass


@dataclass(frozen=True, slots=True)
class ToolExecutionContext:
    agent_request: CapabilityRequest | None = None
    rag_sdk_request: RagSdkRunRequest | None = None
    admission: ToolSpecAdmission | None = None


@dataclass(frozen=True, slots=True)
class ToolExecutionRegistry:
    tool_registry: ToolSpecRegistry
    sdk_handlers: dict[str, ToolHandler]
    structured_handlers: dict[str, StructuredToolHandler]
    internal_function_handlers: dict[str, InternalFunctionHandler]

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

    def execute_structured(
        self,
        invocation: OpenAIAgentsToolInvocation,
        *,
        context: ToolExecutionContext,
    ) -> StructuredToolResult:
        tool = self._required_tool(invocation.name)
        if tool.runtime_posture != "typed_activity_admitted":
            raise ToolExecutionError(
                f"tool is not registered for preplanned structured execution: {tool.name}"
            )
        handler = self.structured_handlers.get(tool.name)
        if handler is None:
            raise ToolExecutionError(
                f"tool has no registered preplanned structured handler: {tool.name}"
            )
        return handler(invocation, context)

    def execute_internal_function(
        self,
        name: str,
        *,
        context: ToolExecutionContext,
    ) -> CapabilityResponse:
        tool = self._required_tool(name)
        if tool.runtime_posture != "internal_function":
            raise ToolExecutionError(f"tool is not registered as internal_function: {tool.name}")
        handler = self.internal_function_handlers.get(tool.name)
        if handler is None:
            raise ToolExecutionError(
                f"tool has no registered internal function handler: {tool.name}"
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
        if context.admission is not None:
            self._validate_context_admits_sdk_tool(invocation.name, context=context)
        elif context.agent_request is not None:
            self._validate_agent_request_admits_sdk_tool(
                invocation.name,
                agent_request=context.agent_request,
            )
        tool = self._required_tool(invocation.name)
        if tool.runtime_posture not in {"typed_activity_admitted", "capability_internal_admitted"}:
            raise ToolExecutionError(
                f"tool runtime_posture is not SDK-executable: {tool.name} ({tool.runtime_posture})"
            )
        return self.execution_registry.execute(invocation, context=context)

    def execute_preplanned_structured_tool(
        self,
        invocation: OpenAIAgentsToolInvocation,
        *,
        context: ToolExecutionContext,
    ) -> StructuredToolResult:
        if context.admission is not None:
            self._validate_context_admits_sdk_tool(invocation.name, context=context)
        elif context.agent_request is not None:
            self._validate_agent_request_admits_sdk_tool(
                invocation.name,
                agent_request=context.agent_request,
            )
        tool = self._required_tool(invocation.name)
        if tool.runtime_posture != "typed_activity_admitted":
            raise ToolExecutionError(
                "tool runtime_posture is not preplanned structured-executable: "
                f"{tool.name} ({tool.runtime_posture})"
            )
        return self.execution_registry.execute_structured(invocation, context=context)

    def execute_internal_function(
        self,
        name: str,
        *,
        context: ToolExecutionContext,
    ) -> CapabilityResponse:
        if context.admission is not None:
            self._validate_context_admits_internal_function(name, context=context)
        elif context.agent_request is not None:
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

    def _validate_context_admits_sdk_tool(
        self,
        name: str,
        *,
        context: ToolExecutionContext,
    ) -> None:
        admission = context.admission
        if admission is None:
            raise ToolExecutionError("tool admission is required for SDK execution")
        if admission.expected_allowed_tools != (name,):
            raise ToolExecutionError(f"tool is not admitted by current execution admission: {name}")
        if context.agent_request is not None and context.agent_request.allowed_tools != (name,):
            raise ToolExecutionError(
                f"agent_request.allowed_tools drifted from current execution admission: {name}"
            )

    def _validate_context_admits_internal_function(
        self,
        name: str,
        *,
        context: ToolExecutionContext,
    ) -> None:
        admission = context.admission
        if admission is None:
            raise ToolExecutionError("tool admission is required for internal function execution")
        if admission.expected_allowed_tools:
            raise ToolExecutionError(
                f"internal function request admitted unexpected allowed_tools: {name}"
            )
        if admission.tool.name != name:
            raise ToolExecutionError(
                f"internal function is not admitted by current execution admission: {name}"
            )
        if context.agent_request is not None and context.agent_request.allowed_tools:
            raise ToolExecutionError(
                f"agent_request.allowed_tools drifted from internal function admission: {name}"
            )

    def _validate_agent_request_admits_sdk_tool(
        self,
        name: str,
        *,
        agent_request: CapabilityRequest,
    ) -> None:
        try:
            expected_allowed_tools = self.tool_registry.expected_allowed_tools_for_request(
                agent_request
            )
        except ToolSpecRegistryError as exc:
            raise ToolExecutionError(str(exc)) from exc
        if agent_request.allowed_tools != expected_allowed_tools:
            raise ToolExecutionError(
                "agent_request.allowed_tools must match ToolSpec admission for "
                f"capability={agent_request.capability} payload={agent_request.payload.__class__.__name__}: "
                f"got {agent_request.allowed_tools!r}, want {expected_allowed_tools!r}"
            )
        if name not in expected_allowed_tools:
            raise ToolExecutionError(f"tool is not admitted by current agent_request: {name}")

    def _validate_agent_request_admits_internal_function(
        self,
        name: str,
        *,
        agent_request: CapabilityRequest,
    ) -> None:
        try:
            admission = self.tool_registry.admission_for_request(agent_request)
        except ToolSpecRegistryError as exc:
            raise ToolExecutionError(str(exc)) from exc
        if admission.tool.name != name:
            raise ToolExecutionError(
                f"internal function is not admitted by current agent_request: {name}"
            )
        if agent_request.allowed_tools != admission.expected_allowed_tools:
            raise ToolExecutionError(
                "agent_request.allowed_tools must match ToolSpec admission for "
                f"capability={agent_request.capability} payload={agent_request.payload.__class__.__name__}: "
                f"got {agent_request.allowed_tools!r}, want {admission.expected_allowed_tools!r}"
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
    structured_handlers: dict[str, StructuredToolHandler] = {}
    internal_function_handlers: dict[str, InternalFunctionHandler] = {}

    def _require_agent_request(context: ToolExecutionContext) -> CapabilityRequest:
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

    def _campus_services_query_access_context(context: ToolExecutionContext):
        from campus_services_capability.query_service import CampusServicesAccessContext

        request = _require_agent_request(context)
        return CampusServicesAccessContext(
            actor=request.actor,
            authorization=request.context.authorization,
        )

    def _notice_query_access_context(context: ToolExecutionContext):
        from campus_notice_capability.query_service import NoticeAccessContext

        request = _require_agent_request(context)
        return NoticeAccessContext(
            actor=request.actor,
            authorization=request.context.authorization,
        )

    from campus_services_capability.query_service import (
        AcademicCalendarQuery,
        ContactDirectoryQuery,
        ServiceGuideQuery,
        ServiceStatusQuery,
        TransportScheduleQuery,
    )
    from campus_services_capability.sdk_tool_executor import execute_campus_services_sdk_tool

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
    structured_handlers["service_status_lookup"] = (
        lambda invocation, context, _service=campus_services_query_service: (
            _service.lookup_service_status(
                ServiceStatusQuery(
                    payload=_require_payload(context, "service_status_lookup"),
                    access_context=_campus_services_query_access_context(context),
                )
            )
            if _service is not None
            else _raise_structured_tool_execution_error(
                _missing_query_service("service_status_lookup")
            )
        )
    )
    structured_handlers["service_guide_lookup"] = (
        lambda invocation, context, _service=campus_services_query_service: (
            _service.lookup_service_guide(
                ServiceGuideQuery(
                    payload=_require_payload(context, "service_guide_lookup"),
                    access_context=_campus_services_query_access_context(context),
                )
            )
            if _service is not None
            else _raise_structured_tool_execution_error(
                _missing_query_service("service_guide_lookup")
            )
        )
    )
    structured_handlers["transport_schedule_lookup"] = (
        lambda invocation, context, _service=campus_services_query_service: (
            _service.lookup_transport_schedule(
                TransportScheduleQuery(
                    payload=_require_payload(context, "transport_schedule_lookup"),
                    access_context=_campus_services_query_access_context(context),
                )
            )
            if _service is not None
            else _raise_structured_tool_execution_error(
                _missing_query_service("transport_schedule_lookup")
            )
        )
    )
    structured_handlers["contact_directory_lookup"] = (
        lambda invocation, context, _service=campus_services_query_service: (
            _service.lookup_contact_directory(
                ContactDirectoryQuery(
                    payload=_require_payload(context, "contact_directory_lookup"),
                    access_context=_campus_services_query_access_context(context),
                )
            )
            if _service is not None
            else _raise_structured_tool_execution_error(
                _missing_query_service("contact_directory_lookup")
            )
        )
    )
    structured_handlers["academic_calendar_lookup"] = (
        lambda invocation, context, _service=campus_services_query_service: (
            _service.lookup_academic_calendar(
                AcademicCalendarQuery(
                    payload=_require_payload(context, "academic_calendar_lookup"),
                    access_context=_campus_services_query_access_context(context),
                )
            )
            if _service is not None
            else _raise_structured_tool_execution_error(
                _missing_query_service("academic_calendar_lookup")
            )
        )
    )

    from campus_notice_capability.notice_get_runtime import run_notice_get_internal_request
    from campus_notice_capability.query_service import (
        NoticeChangeSetLookupQuery,
        NoticeDiscoverQuery,
    )
    from campus_notice_capability.sdk_tool_executor import execute_notice_sdk_tool

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
    structured_handlers["campus_notice_discover"] = (
        lambda invocation, context, _service=notice_query_service: (
            _service.discover_notice(
                NoticeDiscoverQuery(
                    payload=_require_payload(context, "campus_notice_discover"),
                    access_context=_notice_query_access_context(context),
                )
            )
            if _service is not None
            else _raise_structured_tool_execution_error(
                _missing_query_service("campus_notice_discover")
            )
        )
    )
    structured_handlers["campus_notice_change_set_lookup"] = (
        lambda invocation, context, _service=notice_query_service: (
            _service.lookup_notice_change_set(
                NoticeChangeSetLookupQuery(
                    payload=_require_payload(context, "campus_notice_change_set_lookup"),
                    access_context=_notice_query_access_context(context),
                )
            )
            if _service is not None
            else _raise_structured_tool_execution_error(
                _missing_query_service("campus_notice_change_set_lookup")
            )
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
        structured_handlers=structured_handlers,
        internal_function_handlers=internal_function_handlers,
    )
    return ToolExecutionRegistry(
        tool_registry=resolved_tool_registry,
        sdk_handlers=sdk_handlers,
        structured_handlers=structured_handlers,
        internal_function_handlers=internal_function_handlers,
    )


def _raise_tool_execution_error(error: ToolExecutionError) -> ToolResult:
    raise error


def _raise_structured_tool_execution_error(error: ToolExecutionError) -> StructuredToolResult:
    raise error


def _require_payload(context: ToolExecutionContext, tool_name: str):
    request = context.agent_request
    if request is None:
        raise ToolExecutionError("agent_request is required for this tool")
    admission = context.admission
    if admission is not None and admission.tool.name != tool_name:
        raise ToolExecutionError(
            f"agent_request payload is not admitted for current structured tool: {tool_name}"
        )
    return request.payload


def _validate_registry_bindings(
    tool_registry: ToolSpecRegistry,
    *,
    sdk_handlers: dict[str, ToolHandler],
    structured_handlers: dict[str, StructuredToolHandler],
    internal_function_handlers: dict[str, InternalFunctionHandler],
) -> None:
    for tool in tool_registry.tools:
        if tool.runtime_posture == "closed":
            if tool.name in sdk_handlers or tool.name in internal_function_handlers:
                raise ToolExecutionError(f"closed tool must not be registered: {tool.name}")
            continue
        if tool.runtime_posture in {"typed_activity_admitted", "capability_internal_admitted"}:
            if tool.name not in sdk_handlers:
                raise ToolExecutionError(f"sdk tool is missing handler: {tool.name}")
            if (
                tool.runtime_posture == "typed_activity_admitted"
                and tool.name not in structured_handlers
            ):
                raise ToolExecutionError(
                    f"preplanned structured tool is missing handler: {tool.name}"
                )
            if tool.runtime_posture != "typed_activity_admitted" and tool.name in structured_handlers:
                raise ToolExecutionError(
                    f"non-structured sdk tool must not be registered as preplanned: {tool.name}"
                )
            continue
        if tool.runtime_posture == "internal_function":
            if tool.name not in internal_function_handlers:
                raise ToolExecutionError(f"internal function is missing handler: {tool.name}")
            continue
        if tool.name in sdk_handlers or tool.name in internal_function_handlers:
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
