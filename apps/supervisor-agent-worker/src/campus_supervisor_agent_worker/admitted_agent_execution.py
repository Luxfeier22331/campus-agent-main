from __future__ import annotations

from dataclasses import dataclass

from campus_contracts import AgentRequest, AgentResponse

from campus_supervisor_agent_worker.agents_sdk_instruction_profiles import (
    instruction_profile_for_request,
)
from campus_supervisor_agent_worker.agents_sdk_tool_bridge import (
    AgentsSdkToolBridgeError,
    build_agents_sdk_tool_descriptors,
)
from campus_supervisor_agent_worker.agents_sdk_trace_projection import (
    elapsed_agents_sdk_latency_ms,
    start_agents_sdk_trace_timer,
)
from campus_supervisor_agent_worker.openai_agents_runtime import (
    OpenAIAgentsNativeRuntime,
    OpenAIAgentsRuntimeError,
    OpenAIAgentsToolInvocation,
)
from campus_supervisor_agent_worker.openai_agents_runtime_projection import (
    OpenAIAgentsRuntimeProjectionError,
    OpenAIAgentsToolExecutionRecord,
    bounded_tool_result_projection,
    response_from_native_runtime_result,
    runtime_error_response,
)
from campus_supervisor_agent_worker.openai_agents_workflow_plan import (
    OpenAIAgentsWorkflowPlanError,
    validate_agent_request_against_workflow_plan,
)
from campus_supervisor_agent_worker.settings import ApiSettings
from campus_supervisor_agent_worker.tool_execution import (
    ToolExecutionContext,
    ToolExecutionSession,
)
from campus_supervisor_agent_worker.tool_spec_registry import (
    ToolSpec,
    ToolSpecRegistry,
    ToolSpecRegistryError,
)


@dataclass(frozen=True, slots=True)
class AdmittedAgentExecutionPlan:
    mode: str
    runtime_posture: str = ""
    internal_function_tool: ToolSpec | None = None
    failure_class: str = ""
    message: str = ""


class AdmittedAgentExecutor:
    def __init__(
        self,
        *,
        settings: ApiSettings,
        runtime: OpenAIAgentsNativeRuntime | None,
        tool_execution_session: ToolExecutionSession,
        tool_registry: ToolSpecRegistry,
    ) -> None:
        self._settings = settings
        self._runtime = runtime
        self._tool_execution_session = tool_execution_session
        self._tool_registry = tool_registry

    def execute(self, agent_request: AgentRequest) -> AgentResponse:
        plan = self.plan(agent_request)
        if plan.mode == "sdk_agent_execution":
            return self._run_structured_native_runtime(agent_request, plan=plan)
        if plan.mode == "internal_function":
            return self._run_internal_function(agent_request, plan=plan)
        return runtime_error_response(
            agent_request,
            plan.failure_class or "request_not_admitted",
            plan.message or "domain-agent request is outside the Go-admitted execution boundary",
            bridge_reason=plan.failure_class or "request_not_admitted",
            runtime_posture=plan.runtime_posture,
        )

    def plan(self, agent_request: AgentRequest) -> AdmittedAgentExecutionPlan:
        try:
            payload_kind = self._tool_registry.payload_kind_for_request(
                agent_request.target,
                agent_request.payload,
            )
            expected_tools = self._tool_registry.expected_allowed_tools_for_request(agent_request)
        except ToolSpecRegistryError as exc:
            return AdmittedAgentExecutionPlan(
                mode="not_admitted",
                failure_class="request_not_admitted",
                message=str(exc),
            )

        if agent_request.allowed_tools != expected_tools:
            return AdmittedAgentExecutionPlan(
                mode="not_admitted",
                failure_class="request_not_admitted",
                message=(
                    "AgentRequest.allowed_tools must exactly match ToolSpec admission: "
                    f"got {agent_request.allowed_tools!r}, want {expected_tools!r}"
                ),
            )

        if expected_tools:
            tool = self._tool_registry.tool_by_name(expected_tools[0])
            if (
                tool is not None
                and tool.active
                and tool.surface == "structured_handoff"
                and tool.owner_agent == agent_request.target
                and all(
                    admitted_tool is not None
                    and admitted_tool.active
                    and admitted_tool.surface == "structured_handoff"
                    and admitted_tool.owner_agent == agent_request.target
                    and admitted_tool.runtime_posture == "sdk_adapter_admitted"
                    for admitted_tool in (
                        self._tool_registry.tool_by_name(tool_name) for tool_name in expected_tools
                    )
                )
            ):
                return AdmittedAgentExecutionPlan(
                    mode="sdk_agent_execution",
                    runtime_posture=tool.runtime_posture,
                )

        if not expected_tools:
            tool = self._tool_registry.tool_by_name(payload_kind)
            if (
                tool is not None
                and tool.active
                and tool.surface == "agent_internal"
                and tool.runtime_posture == "internal_function"
            ):
                return AdmittedAgentExecutionPlan(
                    mode="internal_function",
                    runtime_posture=tool.runtime_posture,
                    internal_function_tool=tool,
                )

        return AdmittedAgentExecutionPlan(
            mode="not_admitted",
            failure_class="request_not_admitted",
            message="domain-agent request is outside the Go-admitted execution boundary",
        )

    def _run_structured_native_runtime(
        self,
        agent_request: AgentRequest,
        *,
        plan: AdmittedAgentExecutionPlan,
    ) -> AgentResponse:
        started_ns = start_agents_sdk_trace_timer()
        tool_execution_records: list[OpenAIAgentsToolExecutionRecord] = []
        if not self._settings.agents_sdk_runtime_enabled:
            return runtime_error_response(
                agent_request,
                "runtime_disabled",
                "OpenAI Agents native runtime is disabled",
                latency_ms=elapsed_agents_sdk_latency_ms(started_ns),
            )
        workflow_step = self._validated_workflow_step(agent_request)
        if isinstance(workflow_step, AgentResponse):
            return workflow_step
        if self._runtime is None:
            return runtime_error_response(
                agent_request,
                "runtime_unavailable",
                "OpenAI Agents native runtime is unavailable for an SDK-admitted structured tool",
                bridge_reason="runner_unavailable",
                latency_ms=elapsed_agents_sdk_latency_ms(started_ns),
                runtime_posture=self._runtime_posture_for_request(agent_request, plan=plan),
            )
        try:
            descriptors = build_agents_sdk_tool_descriptors(
                agent_request.allowed_tools,
                registry=self._tool_registry,
            )
            profile = instruction_profile_for_request(agent_request)

            def execute_and_record(invocation: OpenAIAgentsToolInvocation):
                raw_result = self._tool_execution_session.execute_sdk_tool(
                    invocation,
                    context=ToolExecutionContext(agent_request=agent_request),
                )
                bounded_result = bounded_tool_result_projection(raw_result)
                tool_execution_records.append(
                    OpenAIAgentsToolExecutionRecord(
                        name=invocation.name,
                        call_id=invocation.call_id,
                        arguments=dict(invocation.arguments),
                        argument_keys=tuple(sorted(invocation.arguments)),
                        result_projection=bounded_result,
                    )
                )
                return raw_result

            result = self._runtime.run_agent(
                agent_request=agent_request,
                instruction_profile=profile,
                tool_descriptors=descriptors,
                execute_tool=execute_and_record,
            )
            return response_from_native_runtime_result(
                agent_request,
                result,
                descriptors=descriptors,
                tool_execution_records=tuple(tool_execution_records),
                require_tool_execution=True,
                latency_ms=elapsed_agents_sdk_latency_ms(started_ns),
                instruction_profile_id=profile.profile_id,
                result_usage_mode=profile.result_usage_mode,
                surface_execution_mode=profile.surface_execution_mode,
            )
        except AgentsSdkToolBridgeError as exc:
            return runtime_error_response(
                agent_request,
                "sdk_tool_not_admitted",
                str(exc),
                bridge_reason=exc.reason,
                latency_ms=elapsed_agents_sdk_latency_ms(started_ns),
                runtime_posture=self._runtime_posture_for_request(agent_request, plan=plan),
            )
        except (OpenAIAgentsRuntimeError, OpenAIAgentsRuntimeProjectionError) as exc:
            return runtime_error_response(
                agent_request,
                exc.failure_class,
                exc.message,
                retryable=exc.retryable,
                latency_ms=elapsed_agents_sdk_latency_ms(started_ns),
                runtime_posture=self._runtime_posture_for_request(agent_request, plan=plan),
                tool_execution_count=len(tool_execution_records),
            )
        except TimeoutError as exc:
            return runtime_error_response(
                agent_request,
                "sdk_timeout",
                str(exc) or "OpenAI Agents native runtime timed out",
                retryable=True,
                latency_ms=elapsed_agents_sdk_latency_ms(started_ns),
                runtime_posture=self._runtime_posture_for_request(agent_request, plan=plan),
                tool_execution_count=len(tool_execution_records),
            )
        except Exception as exc:
            return runtime_error_response(
                agent_request,
                "sdk_runner_failed",
                f"OpenAI Agents native runtime failed: {exc}",
                retryable=True,
                latency_ms=elapsed_agents_sdk_latency_ms(started_ns),
                runtime_posture=self._runtime_posture_for_request(agent_request, plan=plan),
                tool_execution_count=len(tool_execution_records),
            )

    def _run_internal_function(
        self,
        agent_request: AgentRequest,
        *,
        plan: AdmittedAgentExecutionPlan,
    ) -> AgentResponse:
        workflow_step = self._validated_workflow_step(agent_request)
        if isinstance(workflow_step, AgentResponse):
            return workflow_step
        if plan.internal_function_tool is None:
            return runtime_error_response(
                agent_request,
                "request_not_admitted",
                "internal function request is missing ToolSpec admission",
                retryable=False,
            )
        try:
            return self._tool_execution_session.execute_internal_function(
                plan.internal_function_tool.name,
                context=ToolExecutionContext(agent_request=agent_request),
            )
        except Exception as exc:
            return runtime_error_response(
                agent_request,
                "internal_function_failed",
                str(exc) or "Internal function execution failed",
                retryable=False,
                runtime_posture=self._runtime_posture_for_request(agent_request, plan=plan),
            )

    def _validated_workflow_step(
        self,
        agent_request: AgentRequest,
    ):
        try:
            return validate_agent_request_against_workflow_plan(
                agent_request,
                tool_registry=self._tool_registry,
            )
        except OpenAIAgentsWorkflowPlanError as exc:
            return runtime_error_response(
                agent_request,
                exc.failure_class,
                exc.message,
                bridge_reason=exc.failure_class,
                runtime_posture=self._runtime_posture_for_request(agent_request),
            )

    def _runtime_posture_for_request(
        self,
        agent_request: AgentRequest,
        *,
        plan: AdmittedAgentExecutionPlan | None = None,
    ) -> str:
        if plan is not None and plan.runtime_posture:
            return plan.runtime_posture
        if agent_request.allowed_tools:
            tool = self._tool_registry.tool_by_name(agent_request.allowed_tools[0])
            return tool.runtime_posture if tool is not None else ""
        try:
            tool_name = self._tool_registry.payload_kind_for_request(
                agent_request.target,
                agent_request.payload,
            )
        except ToolSpecRegistryError:
            return ""
        tool = self._tool_registry.tool_by_name(tool_name)
        return tool.runtime_posture if tool is not None else ""


__all__ = [
    "AdmittedAgentExecutionPlan",
    "AdmittedAgentExecutor",
]
