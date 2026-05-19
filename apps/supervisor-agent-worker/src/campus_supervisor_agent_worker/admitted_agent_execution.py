from __future__ import annotations

from dataclasses import asdict, dataclass

from campus_contracts import (
    AcademicCalendarLookupResult,
    AgentObservability,
    AgentRequest,
    AgentResponse,
    CampusNoticeChangeSetLookupResult,
    CampusNoticeDiscoverResult,
    ContactDirectoryLookupResult,
    ServiceGuideLookupResult,
    ServiceStatusLookupResult,
    TransportScheduleLookupResult,
)
from campus_services_agent.academic_calendar_adapter import academic_calendar_response
from campus_services_agent.response_builder import (
    contact_directory_response,
    service_guide_response,
    service_status_response,
    transport_schedule_response,
)

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
from campus_supervisor_agent_worker.settings import ApiSettings
from campus_supervisor_agent_worker.tool_execution import (
    ToolExecutionContext,
    ToolExecutionSession,
)
from campus_supervisor_agent_worker.tool_spec_registry import (
    ToolSpec,
    ToolSpecAdmission,
    ToolSpecRegistry,
    ToolSpecRegistryError,
)


@dataclass(frozen=True, slots=True)
class AdmittedAgentExecutionPlan:
    mode: str
    admission: ToolSpecAdmission | None = None
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

    def execute(
        self,
        agent_request: AgentRequest,
        admission: ToolSpecAdmission | None = None,
    ) -> AgentResponse:
        plan = self._plan_from_admission(
            agent_request,
            admission=admission or self._validated_admission(agent_request),
        )
        if plan.mode == "sdk_agent_execution":
            return self._run_preplanned_structured_tool(agent_request, plan=plan)
        if plan.mode == "sdk_model_execution":
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
            admission = self._validated_admission(agent_request)
        except ToolSpecRegistryError as exc:
            return AdmittedAgentExecutionPlan(
                mode="not_admitted",
                failure_class="request_not_admitted",
                message=str(exc),
            )
        return self._plan_from_admission(agent_request, admission=admission)

    def _validated_admission(self, agent_request: AgentRequest) -> ToolSpecAdmission:
        return self._tool_registry.validate_allowed_tools_for_request(agent_request)

    def _plan_from_admission(
        self,
        agent_request: AgentRequest,
        *,
        admission: ToolSpecAdmission,
    ) -> AdmittedAgentExecutionPlan:
        if admission.expected_allowed_tools:
            tool = admission.tool
            if (
                tool.active
                and tool.surface == "structured_handoff"
                and tool.owner_agent == agent_request.target
                and all(
                    admitted_tool is not None
                    and admitted_tool.active
                    and admitted_tool.surface == "structured_handoff"
                    and admitted_tool.owner_agent == agent_request.target
                    and admitted_tool.runtime_posture == "sdk_adapter_admitted"
                    for admitted_tool in (
                        self._tool_registry.tool_by_name(tool_name)
                        for tool_name in admission.expected_allowed_tools
                    )
                )
            ):
                return AdmittedAgentExecutionPlan(
                    mode="sdk_agent_execution",
                    admission=admission,
                    runtime_posture=tool.runtime_posture,
                )

        if not admission.expected_allowed_tools:
            tool = admission.tool
            if (
                tool.active
                and tool.surface == "agent_internal"
                and tool.runtime_posture == "internal_function"
            ):
                return AdmittedAgentExecutionPlan(
                    mode="internal_function",
                    admission=admission,
                    runtime_posture=tool.runtime_posture,
                    internal_function_tool=tool,
                )

        return AdmittedAgentExecutionPlan(
            mode="not_admitted",
            failure_class="request_not_admitted",
            message="domain-agent request is outside the Go-admitted execution boundary",
        )

    def _run_preplanned_structured_tool(
        self,
        agent_request: AgentRequest,
        *,
        plan: AdmittedAgentExecutionPlan,
    ) -> AgentResponse:
        workflow_context_error = self._workflow_context_error_response(agent_request, plan=plan)
        if workflow_context_error is not None:
            return workflow_context_error
        if plan.admission is None:
            return runtime_error_response(
                agent_request,
                "request_not_admitted",
                "structured runtime execution is missing ToolSpec admission",
                bridge_reason="request_not_admitted",
                runtime_posture=self._runtime_posture_for_request(agent_request, plan=plan),
            )
        selected_tool = _single_admitted_tool(agent_request, admission=plan.admission)
        try:
            raw_result = self._tool_execution_session.execute_preplanned_structured_tool(
                _invocation_from_agent_payload(selected_tool, agent_request.payload),
                context=ToolExecutionContext(
                    agent_request=agent_request,
                    admission=plan.admission,
                ),
            )
            return _agent_response_from_preplanned_result(
                agent_request,
                selected_tool=selected_tool,
                raw_result=raw_result,
            )
        except Exception as exc:
            return runtime_error_response(
                agent_request,
                "internal_query_service_failed",
                str(exc) or "preplanned structured tool execution failed",
                retryable=False,
                runtime_posture=self._runtime_posture_for_request(agent_request, plan=plan),
                tool_execution_count=1,
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
        workflow_context_error = self._workflow_context_error_response(agent_request, plan=plan)
        if workflow_context_error is not None:
            return workflow_context_error
        if plan.admission is None:
            return runtime_error_response(
                agent_request,
                "request_not_admitted",
                "structured runtime execution is missing ToolSpec admission",
                bridge_reason="request_not_admitted",
                latency_ms=elapsed_agents_sdk_latency_ms(started_ns),
                runtime_posture=self._runtime_posture_for_request(agent_request, plan=plan),
            )
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
                plan.admission.expected_allowed_tools,
                registry=self._tool_registry,
            )
            profile = instruction_profile_for_request(agent_request)

            def execute_and_record(invocation: OpenAIAgentsToolInvocation):
                raw_result = self._tool_execution_session.execute_sdk_tool(
                    invocation,
                    context=ToolExecutionContext(
                        agent_request=agent_request,
                        admission=plan.admission,
                    ),
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
                retryable=False,
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
        workflow_context_error = self._workflow_context_error_response(agent_request, plan=plan)
        if workflow_context_error is not None:
            return workflow_context_error
        if plan.internal_function_tool is None or plan.admission is None:
            return runtime_error_response(
                agent_request,
                "request_not_admitted",
                "internal function request is missing ToolSpec admission",
                retryable=False,
                runtime_posture=self._runtime_posture_for_request(agent_request, plan=plan),
            )
        try:
            return self._tool_execution_session.execute_internal_function(
                plan.internal_function_tool.name,
                context=ToolExecutionContext(
                    agent_request=agent_request,
                    admission=plan.admission,
                ),
            )
        except Exception as exc:
            return runtime_error_response(
                agent_request,
                "internal_function_failed",
                str(exc) or "Internal function execution failed",
                retryable=False,
                runtime_posture=self._runtime_posture_for_request(agent_request, plan=plan),
            )

    def _workflow_context_error_response(
        self,
        agent_request: AgentRequest,
        *,
        plan: AdmittedAgentExecutionPlan | None = None,
    ) -> AgentResponse | None:
        context = agent_request.workflow_context
        if context.target != agent_request.target:
            return runtime_error_response(
                agent_request,
                "plan_not_admitted",
                "AgentRequest.workflow_context.target must match AgentRequest.target",
                bridge_reason="plan_not_admitted",
                runtime_posture=self._runtime_posture_for_request(agent_request, plan=plan),
            )
        if context.agent_id != agent_request.target:
            return runtime_error_response(
                agent_request,
                "plan_not_admitted",
                "AgentRequest.workflow_context.agent_id must match AgentRequest.target",
                bridge_reason="plan_not_admitted",
                runtime_posture=self._runtime_posture_for_request(agent_request, plan=plan),
            )
        if not context.step_id.strip():
            return runtime_error_response(
                agent_request,
                "plan_not_admitted",
                "AgentRequest.workflow_context.step_id is required",
                bridge_reason="plan_not_admitted",
                runtime_posture=self._runtime_posture_for_request(agent_request, plan=plan),
            )
        if not context.workflow_run_ref.strip():
            return runtime_error_response(
                agent_request,
                "plan_not_admitted",
                "AgentRequest.workflow_context.workflow_run_ref is required",
                bridge_reason="plan_not_admitted",
                runtime_posture=self._runtime_posture_for_request(agent_request, plan=plan),
            )
        return None

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


def _single_admitted_tool(
    agent_request: AgentRequest,
    *,
    admission: ToolSpecAdmission,
) -> str:
    if len(admission.expected_allowed_tools) != 1:
        raise ValueError("preplanned structured execution requires exactly one admitted tool")
    selected_tool = admission.expected_allowed_tools[0]
    if agent_request.allowed_tools != (selected_tool,):
        raise ValueError("AgentRequest.allowed_tools must match the admitted structured tool")
    return selected_tool


def _invocation_from_agent_payload(tool_name: str, payload: object) -> OpenAIAgentsToolInvocation:
    return OpenAIAgentsToolInvocation(
        name=tool_name,
        arguments=asdict(payload),
        call_id=f"go-preplanned:{tool_name}",
    )


def _agent_response_from_preplanned_result(
    agent_request: AgentRequest,
    *,
    selected_tool: str,
    raw_result: object,
) -> AgentResponse:
    if isinstance(raw_result, AgentResponse):
        return raw_result
    if isinstance(raw_result, ServiceStatusLookupResult):
        return _attach_preplanned_projection(
            service_status_response(raw_result),
            selected_tool=selected_tool,
            agent_request=agent_request,
            result=raw_result,
        )
    if isinstance(raw_result, ServiceGuideLookupResult):
        return _attach_preplanned_projection(
            service_guide_response(raw_result),
            selected_tool=selected_tool,
            agent_request=agent_request,
            result=raw_result,
        )
    if isinstance(raw_result, TransportScheduleLookupResult):
        return _attach_preplanned_projection(
            transport_schedule_response(raw_result),
            selected_tool=selected_tool,
            agent_request=agent_request,
            result=raw_result,
        )
    if isinstance(raw_result, ContactDirectoryLookupResult):
        return _attach_preplanned_projection(
            contact_directory_response(raw_result),
            selected_tool=selected_tool,
            agent_request=agent_request,
            result=raw_result,
        )
    if isinstance(raw_result, AcademicCalendarLookupResult):
        return _attach_preplanned_projection(
            academic_calendar_response(raw_result),
            selected_tool=selected_tool,
            agent_request=agent_request,
            result=raw_result,
        )
    if isinstance(raw_result, CampusNoticeDiscoverResult):
        return _notice_discover_response(raw_result, agent_request=agent_request)
    if isinstance(raw_result, CampusNoticeChangeSetLookupResult):
        return _notice_change_set_response(raw_result, agent_request=agent_request)
    raise TypeError(
        f"unsupported preplanned structured result type: {raw_result.__class__.__name__}"
    )


def _attach_preplanned_projection(
    response: AgentResponse,
    *,
    selected_tool: str,
    agent_request: AgentRequest,
    result: object,
) -> AgentResponse:
    observability = response.agent_observability
    if observability is None:
        return response
    safe_details = dict(observability.safe_details)
    safe_details["preplanned_structured_execution"] = _preplanned_execution_projection(
        selected_tool=selected_tool,
        agent_request=agent_request,
        result=result,
    )
    return AgentResponse(
        target=response.target,
        status=response.status,
        answer_text=response.answer_text,
        follow_up_question=response.follow_up_question,
        confidence=response.confidence,
        result=response.result,
        error=response.error,
        agent_observability=AgentObservability(
            selected_tool=observability.selected_tool or selected_tool,
            tool_attempted=observability.tool_attempted,
            tool_outcome=observability.tool_outcome,
            failure_class=observability.failure_class,
            fail_close_reason=observability.fail_close_reason,
            clarification_reason=observability.clarification_reason,
            source_ref_count=observability.source_ref_count,
            result_outcome=observability.result_outcome,
            access_decision=observability.access_decision,
            safe_details=safe_details,
        ),
    )


def _preplanned_execution_projection(
    *,
    selected_tool: str,
    agent_request: AgentRequest,
    result: object,
) -> dict[str, object]:
    return {
        "schema_version": "preplanned-structured-execution-v1",
        "selected_tool": selected_tool,
        "payload_kind": selected_tool,
        "execution_owner": "go_workflow_plan_python_typed_query_adapter",
        "workflow_run_ref": agent_request.workflow_context.workflow_run_ref,
        "step_id": agent_request.workflow_context.step_id,
        "agent_id": agent_request.workflow_context.agent_id,
        "result_type": result.__class__.__name__,
    }


def _notice_discover_response(
    result: CampusNoticeDiscoverResult,
    *,
    agent_request: AgentRequest,
) -> AgentResponse:
    if result.outcome in {"resolved_current", "resolved_historical_reference"}:
        titles = [card.title for card in result.notice_cards[:5]]
        answer_text = "找到相关通知：\n" + "\n".join(f"- {title}" for title in titles)
        return AgentResponse(
            target="notice-agent",
            status="completed",
            answer_text=answer_text,
            confidence="high" if result.outcome == "resolved_current" else "medium",
            result=result,
            agent_observability=_notice_result_observability(
                "campus_notice_discover",
                result,
                agent_request=agent_request,
            ),
        )
    if result.outcome == "clarification_required":
        follow_up = "请明确你要查询的通知范围或时间。"
        return AgentResponse(
            target="notice-agent",
            status="needs_clarification",
            answer_text=follow_up,
            follow_up_question=follow_up,
            confidence="medium",
            result=result,
            agent_observability=_notice_result_observability(
                "campus_notice_discover",
                result,
                agent_request=agent_request,
            ),
        )
    if result.outcome == "temporarily_unverifiable":
        return AgentResponse(
            target="notice-agent",
            status="no_answer",
            answer_text="当前还不能稳定确认相关通知。",
            confidence="low",
            result=result,
            agent_observability=_notice_result_observability(
                "campus_notice_discover",
                result,
                agent_request=agent_request,
            ),
        )
    return AgentResponse(
        target="notice-agent",
        status="no_answer",
        answer_text="当前没有找到相关通知。",
        confidence="low",
        result=result,
        agent_observability=_notice_result_observability(
            "campus_notice_discover",
            result,
            agent_request=agent_request,
        ),
    )


def _notice_change_set_response(
    result: CampusNoticeChangeSetLookupResult,
    *,
    agent_request: AgentRequest,
) -> AgentResponse:
    if result.outcome == "resolved_current" and result.change_set is not None:
        facts = [fact.change_text for fact in result.change_set.facts if fact.change_text]
        answer_text = "；".join(facts) if facts else "已找到相关通知变更。"
        return AgentResponse(
            target="notice-agent",
            status="completed",
            answer_text=answer_text,
            confidence="high",
            result=result,
            agent_observability=_notice_result_observability(
                "campus_notice_change_set_lookup",
                result,
                agent_request=agent_request,
            ),
        )
    if result.outcome == "temporarily_unverifiable":
        return AgentResponse(
            target="notice-agent",
            status="no_answer",
            answer_text="当前还不能稳定确认通知变更。",
            confidence="low",
            result=result,
            agent_observability=_notice_result_observability(
                "campus_notice_change_set_lookup",
                result,
                agent_request=agent_request,
            ),
        )
    return AgentResponse(
        target="notice-agent",
        status="no_answer",
        answer_text="当前没有找到对应通知变更。",
        confidence="low",
        result=result,
        agent_observability=_notice_result_observability(
            "campus_notice_change_set_lookup",
            result,
            agent_request=agent_request,
        ),
    )


def _notice_result_observability(
    selected_tool: str,
    result: object,
    *,
    agent_request: AgentRequest,
) -> AgentObservability:
    outcome = str(getattr(result, "outcome", "") or "")
    failure_class = _notice_failure_class_for_outcome(outcome)
    source_ref_count = _notice_source_ref_count(result)
    safe_details: dict[str, object] = {
        "result_type": result.__class__.__name__,
        "agent_execution_projection": {
            "schema_version": "agent-execution-projection-v1",
            "projection_owner": "notice-agent",
            "selected_tool": selected_tool,
            "payload_kind": selected_tool,
            "tool_selection_reason": "typed_payload_allowed_tool",
        },
        "result_guardrail": {
            "schema_version": "agent-result-guardrail-v1",
            "outcome": _notice_result_guardrail_outcome(outcome, source_ref_count),
            "source_ref_count": source_ref_count,
            "access_decision": "allowed",
            **({"failure_class": failure_class} if failure_class else {}),
        },
    }
    safe_details["preplanned_structured_execution"] = _preplanned_execution_projection(
        selected_tool=selected_tool,
        agent_request=agent_request,
        result=result,
    )
    return AgentObservability(
        selected_tool=selected_tool,
        tool_attempted=True,
        tool_outcome=outcome,
        failure_class=failure_class,
        fail_close_reason=str(getattr(result, "fail_close_reason", "") or ""),
        source_ref_count=source_ref_count,
        result_outcome=outcome,
        access_decision="allowed",
        safe_details=safe_details,
    )


def _notice_result_guardrail_outcome(outcome: str, source_ref_count: int) -> str:
    if outcome in {"resolved_current", "resolved_historical_reference"}:
        return "source_backed" if source_ref_count > 0 else "source_gap"
    if outcome == "clarification_required":
        return "clarification"
    if outcome == "temporarily_unverifiable":
        return "fail_close"
    if outcome == "not_found":
        return "not_found"
    return "unclassified"


def _notice_failure_class_for_outcome(outcome: str) -> str:
    if outcome == "temporarily_unverifiable":
        return "fail_close"
    if outcome == "clarification_required":
        return "clarification"
    if outcome == "not_found":
        return "not_found"
    return ""


def _notice_source_ref_count(result: object) -> int:
    refs: set[str] = set()
    for key in ("source_url", "canonical_url"):
        value = str(getattr(result, key, "") or "").strip()
        if value:
            refs.add(value)
    notice_cards = getattr(result, "notice_cards", ()) or ()
    for card in notice_cards:
        for key in ("source_url", "canonical_url"):
            value = str(getattr(card, key, "") or "").strip()
            if value:
                refs.add(value)
    change_set = getattr(result, "change_set", None)
    for ref in getattr(change_set, "source_refs", ()) or ():
        value = str(getattr(ref, "source_url", "") or "").strip()
        if value:
            refs.add(value)
    return len(refs)


__all__ = [
    "AdmittedAgentExecutionPlan",
    "AdmittedAgentExecutor",
]
