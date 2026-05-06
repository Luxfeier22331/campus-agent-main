from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
import hashlib
import json
from typing import Any

from campus_contracts import (
    AgentObservability,
    AgentRequest,
    AgentResponse,
    ErrorInfo,
)

from campus_supervisor_agent_worker.agents_sdk_instruction_profiles import (
    instruction_profile_for_request,
)
from campus_supervisor_agent_worker.agents_sdk_tool_bridge import (
    AgentsSdkToolBridgeError,
    AgentsSdkToolDescriptor,
    build_agents_sdk_tool_descriptors,
)
from campus_supervisor_agent_worker.agents_sdk_trace_projection import (
    build_agents_sdk_tool_lifecycle_projection,
    build_agents_sdk_trace_projection,
    elapsed_agents_sdk_latency_ms,
    is_unsafe_agents_sdk_projection_key,
    is_unsafe_agents_sdk_projection_value,
    start_agents_sdk_trace_timer,
)
from campus_supervisor_agent_worker.tool_spec_registry import (
    ToolSpecRegistry,
    default_tool_spec_registry,
)

AGENTS_SDK_RUNNER_PROJECTION_SCHEMA_VERSION = "agents-sdk-runner-projection-v1"
AGENTS_SDK_RUNNER_ERROR_SCHEMA_VERSION = "agents-sdk-runner-error-v1"


class AgentsSdkRunnerError(ValueError):
    def __init__(self, failure_class: str, message: str, *, retryable: bool = False) -> None:
        super().__init__(f"{failure_class}: {message}")
        self.failure_class = failure_class
        self.message = message
        self.retryable = retryable


class AgentsSdkRunnerTimeoutError(TimeoutError):
    pass


@dataclass(frozen=True, slots=True)
class AgentsSdkToolCall:
    name: str
    arguments: object = field(default_factory=dict)
    call_id: str = ""


@dataclass(frozen=True, slots=True)
class AgentsSdkToolExecutionRequest:
    name: str
    arguments: dict[str, object] = field(default_factory=dict)
    call_id: str = ""


@dataclass(frozen=True, slots=True)
class AgentsSdkRunResult:
    final_output: object = ""
    tool_calls: tuple[AgentsSdkToolCall, ...] = field(default_factory=tuple)
    model_response_ref: str = ""


@dataclass(frozen=True, slots=True)
class AgentsSdkRunRequest:
    agent_request: AgentRequest
    target: str
    user_goal: str
    request_id: str
    allowed_tools: tuple[str, ...]
    tool_descriptors: tuple[AgentsSdkToolDescriptor, ...]
    instruction_profile_id: str
    instructions: str
    result_usage_mode: str
    surface_execution_mode: str
    context: object
    execute_tool: AgentsSdkToolExecutor | None = None


AgentsSdkRunner = Callable[[AgentsSdkRunRequest], AgentsSdkRunResult]
AgentsSdkToolExecutor = Callable[
    [AgentsSdkToolExecutionRequest],
    Mapping[str, object] | str,
]


@dataclass(frozen=True, slots=True)
class _ToolExecutionRecord:
    request: AgentsSdkToolExecutionRequest
    arguments: dict[str, object]
    argument_keys: tuple[str, ...]
    result_projection: dict[str, object]


@dataclass(frozen=True, slots=True)
class _ValidatedToolArguments:
    arguments: dict[str, object]
    argument_keys: tuple[str, ...]


def run_agents_sdk_runner_shell(
    request: AgentRequest,
    *,
    runner: AgentsSdkRunner,
    enabled: bool,
    tool_registry: ToolSpecRegistry | None = None,
    execute_tool: AgentsSdkToolExecutor | None = None,
    require_tool_execution: bool = False,
) -> AgentResponse:
    started_ns = start_agents_sdk_trace_timer()
    if not enabled:
        return _runtime_error_response(
            request,
            "runtime_disabled",
            "Agents SDK runner shell is disabled",
            latency_ms=elapsed_agents_sdk_latency_ms(started_ns),
        )
    registry = tool_registry or default_tool_spec_registry()
    execution_recorder: _ToolExecutionRecorder | None = None
    tool_descriptors: tuple[AgentsSdkToolDescriptor, ...] = ()
    instruction_profile = instruction_profile_for_request(request)
    try:
        tool_descriptors = build_agents_sdk_tool_descriptors(
            request.allowed_tools,
            registry=registry,
        )
        _validate_request_matches_tool_descriptors(request, tool_descriptors)
        execution_recorder = _ToolExecutionRecorder(
            execute_tool,
            tool_descriptors=tool_descriptors,
            tool_registry=registry,
        )
        result = runner(
            AgentsSdkRunRequest(
                agent_request=request,
                target=request.target,
                user_goal=request.user_goal,
                request_id=request.request_id,
                allowed_tools=request.allowed_tools,
                tool_descriptors=tool_descriptors,
                instruction_profile_id=instruction_profile.profile_id,
                instructions=instruction_profile.instructions,
                result_usage_mode=instruction_profile.result_usage_mode,
                surface_execution_mode=instruction_profile.surface_execution_mode,
                context=request.context,
                execute_tool=execution_recorder.execute if execute_tool is not None else None,
            )
        )
        return _response_from_runner_result(
            request,
            result,
            tool_descriptors=tool_descriptors,
            tool_registry=registry,
            tool_execution_records=execution_recorder.records,
            require_tool_execution=require_tool_execution,
            latency_ms=elapsed_agents_sdk_latency_ms(started_ns),
            instruction_profile_id=instruction_profile.profile_id,
            result_usage_mode=instruction_profile.result_usage_mode,
            surface_execution_mode=instruction_profile.surface_execution_mode,
        )
    except AgentsSdkToolBridgeError as exc:
        return _runtime_error_response(
            request,
            "sdk_tool_not_admitted",
            str(exc),
            bridge_reason=exc.reason,
            latency_ms=elapsed_agents_sdk_latency_ms(started_ns),
            runtime_posture=_runtime_posture_for_request(request, registry),
        )
    except AgentsSdkRunnerTimeoutError as exc:
        return _runtime_error_response(
            request,
            "sdk_timeout",
            str(exc) or "Agents SDK runner timed out",
            retryable=True,
            latency_ms=elapsed_agents_sdk_latency_ms(started_ns),
            runtime_posture=_runtime_posture_for_descriptors(tool_descriptors),
            tool_execution_count=_tool_execution_count(execution_recorder),
        )
    except TimeoutError as exc:
        return _runtime_error_response(
            request,
            "sdk_timeout",
            str(exc) or "Agents SDK runner timed out",
            retryable=True,
            latency_ms=elapsed_agents_sdk_latency_ms(started_ns),
            runtime_posture=_runtime_posture_for_descriptors(tool_descriptors),
            tool_execution_count=_tool_execution_count(execution_recorder),
        )
    except AgentsSdkRunnerError as exc:
        return _runtime_error_response(
            request,
            exc.failure_class,
            exc.message,
            retryable=exc.retryable,
            latency_ms=elapsed_agents_sdk_latency_ms(started_ns),
            runtime_posture=_runtime_posture_for_descriptors(tool_descriptors),
            tool_execution_count=_tool_execution_count(execution_recorder),
        )
    except Exception as exc:
        return _runtime_error_response(
            request,
            "sdk_runner_failed",
            f"Agents SDK runner failed: {exc}",
            retryable=True,
            latency_ms=elapsed_agents_sdk_latency_ms(started_ns),
            runtime_posture=_runtime_posture_for_descriptors(tool_descriptors),
            tool_execution_count=_tool_execution_count(execution_recorder),
        )


def _validate_request_matches_tool_descriptors(
    request: AgentRequest,
    tool_descriptors: tuple[AgentsSdkToolDescriptor, ...],
) -> None:
    for descriptor in tool_descriptors:
        if descriptor.owner_agent != request.target:
            raise AgentsSdkRunnerError(
                "request_not_admitted",
                "Agents SDK runner target/tool mismatch: "
                f"target={request.target} tool={descriptor.name} owner={descriptor.owner_agent}",
            )


def _response_from_runner_result(
    request: AgentRequest,
    result: AgentsSdkRunResult,
    *,
    tool_descriptors: tuple[AgentsSdkToolDescriptor, ...],
    tool_registry: ToolSpecRegistry,
    tool_execution_records: tuple[_ToolExecutionRecord, ...] = (),
    require_tool_execution: bool = False,
    latency_ms: int = 0,
    instruction_profile_id: str = "",
    result_usage_mode: str = "",
    surface_execution_mode: str = "",
) -> AgentResponse:
    if not isinstance(result, AgentsSdkRunResult):
        raise AgentsSdkRunnerError(
            "sdk_malformed_result",
            "Agents SDK runner result must be an AgentsSdkRunResult",
        )
    tool_call = _single_tool_call(result.tool_calls)
    descriptor = _descriptor_for_tool_call(tool_call, tool_descriptors)
    validated_arguments = _validate_tool_arguments(
        tool_call,
        descriptor=descriptor,
        tool_registry=tool_registry,
    )
    if require_tool_execution and not tool_execution_records:
        raise AgentsSdkRunnerError(
            "sdk_tool_not_executed",
            "Agents SDK runner did not execute the required repo-owned tool",
        )
    _validate_tool_execution_records(
        tool_call,
        validated_arguments,
        tool_execution_records,
    )
    final_output = _final_output_text(result.final_output)
    runner_projection: dict[str, object] = {
        "schema_version": AGENTS_SDK_RUNNER_PROJECTION_SCHEMA_VERSION,
        "tool_call_count": 1,
        "tool_names": [tool_call.name],
        "model_tool_call_ref": tool_call.call_id,
        "model_response_ref": result.model_response_ref,
        "argument_keys": list(validated_arguments.argument_keys),
        "tool_execution_count": len(tool_execution_records),
        "instruction_profile_id": instruction_profile_id,
        "result_usage_mode": result_usage_mode,
        "surface_execution_mode": surface_execution_mode,
    }
    if tool_execution_records:
        runner_projection["tool_result_projection"] = tool_execution_records[-1].result_projection
    response_result: dict[str, object] | None = None
    if tool_execution_records:
        response_result = {
            "payload_kind": descriptor.payload_kind,
            "tool_result": tool_execution_records[-1].result_projection,
        }
    output_projection_ref = _workflow_output_projection_ref(request, tool_execution_records)
    trace_projection = build_agents_sdk_trace_projection(
        target=request.target,
        selected_tool=tool_call.name,
        runtime_posture=descriptor.runtime_posture,
        tool_call_count=1,
        tool_execution_count=len(tool_execution_records),
        tool_argument_keys=list(validated_arguments.argument_keys),
        tool_outcome="sdk_completed",
        result_outcome="sdk_completed",
        tool_attempted=True,
        latency_ms=latency_ms,
        model_response_ref=result.model_response_ref,
        instruction_profile_id=instruction_profile_id,
        result_usage_mode=result_usage_mode,
        surface_execution_mode=surface_execution_mode,
        workflow_run_ref=request.workflow_context.workflow_run_ref,
        step_id=request.workflow_context.step_id,
        agent_id=request.workflow_context.agent_id,
        step_status="completed",
        terminal_reason="",
        fail_close_reason="",
        input_projection_refs=request.workflow_context.projection_refs,
        output_projection_ref=output_projection_ref,
    )
    lifecycle_projection = build_agents_sdk_tool_lifecycle_projection(
        selected_tool=tool_call.name,
        model_tool_call_ref=tool_call.call_id,
        model_response_ref=result.model_response_ref,
        tool_output_submitted=bool(tool_execution_records),
        tool_execution_owner="repo" if tool_execution_records else "not_executed",
    )
    return AgentResponse(
        target=request.target,
        status="completed",
        answer_text=final_output,
        confidence="medium",
        result=response_result,
        agent_observability=AgentObservability(
            selected_tool=tool_call.name,
            tool_attempted=True,
            tool_outcome="sdk_completed",
            result_outcome="sdk_completed",
            source_ref_count=_tool_execution_source_ref_count(tool_execution_records),
            access_decision="not_evaluated",
            safe_details={
                "agents_sdk_runner_projection": runner_projection,
                "agents_sdk_trace_projection": trace_projection,
                "agents_sdk_tool_lifecycle_projection": lifecycle_projection,
            },
        ),
    )


class _ToolExecutionRecorder:
    def __init__(
        self,
        executor: AgentsSdkToolExecutor | None,
        *,
        tool_descriptors: tuple[AgentsSdkToolDescriptor, ...],
        tool_registry: ToolSpecRegistry,
    ) -> None:
        self._executor = executor
        self._tool_descriptors = tool_descriptors
        self._tool_registry = tool_registry
        self._records: list[_ToolExecutionRecord] = []

    @property
    def records(self) -> tuple[_ToolExecutionRecord, ...]:
        return tuple(self._records)

    def execute(self, execution: AgentsSdkToolExecutionRequest) -> Mapping[str, object] | str:
        if self._executor is None:
            raise AgentsSdkRunnerError(
                "sdk_tool_not_executed",
                "Agents SDK runner attempted tool execution without a repo-owned executor",
            )
        if self._records:
            raise AgentsSdkRunnerError(
                "sdk_multiple_tool_executions",
                "Agents SDK runner attempted multiple tool executions in a single-call pilot",
            )
        if not isinstance(execution, AgentsSdkToolExecutionRequest):
            raise AgentsSdkRunnerError(
                "sdk_malformed_tool_call",
                "Agents SDK tool execution request must be an AgentsSdkToolExecutionRequest",
            )
        tool_call = AgentsSdkToolCall(
            name=execution.name,
            arguments=execution.arguments,
            call_id=execution.call_id,
        )
        descriptor = _descriptor_for_tool_call(tool_call, self._tool_descriptors)
        validated_arguments = _validate_tool_arguments(
            tool_call,
            descriptor=descriptor,
            tool_registry=self._tool_registry,
        )
        normalized_execution = AgentsSdkToolExecutionRequest(
            name=tool_call.name,
            arguments=dict(validated_arguments.arguments),
            call_id=tool_call.call_id,
        )
        try:
            result = self._executor(normalized_execution)
        except AgentsSdkRunnerError:
            raise
        except Exception as exc:
            raise AgentsSdkRunnerError(
                "sdk_tool_execution_failed",
                f"Agents SDK repo-owned tool execution failed: {exc}",
                retryable=True,
            ) from exc
        self._records.append(
            _ToolExecutionRecord(
                request=normalized_execution,
                arguments=normalized_execution.arguments,
                argument_keys=validated_arguments.argument_keys,
                result_projection=_bounded_tool_result_projection(result),
            )
        )
        return result


def _single_tool_call(tool_calls: tuple[AgentsSdkToolCall, ...]) -> AgentsSdkToolCall:
    if not tool_calls:
        raise AgentsSdkRunnerError(
            "sdk_no_tool_call",
            "Agents SDK runner result did not include a required tool call",
        )
    if len(tool_calls) > 1:
        raise AgentsSdkRunnerError(
            "sdk_multiple_tool_calls",
            "Agents SDK runner result included multiple tool calls",
        )
    tool_call = tool_calls[0]
    if not isinstance(tool_call, AgentsSdkToolCall):
        raise AgentsSdkRunnerError(
            "sdk_malformed_tool_call",
            "Agents SDK runner tool call must be an AgentsSdkToolCall",
        )
    if not tool_call.name.strip():
        raise AgentsSdkRunnerError(
            "sdk_malformed_tool_call",
            "Agents SDK runner tool call name is required",
        )
    return tool_call


def _descriptor_for_tool_call(
    tool_call: AgentsSdkToolCall,
    descriptors: tuple[AgentsSdkToolDescriptor, ...],
) -> AgentsSdkToolDescriptor:
    for descriptor in descriptors:
        if descriptor.name == tool_call.name:
            return descriptor
    raise AgentsSdkRunnerError(
        "sdk_wrong_tool",
        f"Agents SDK runner called disallowed tool: {tool_call.name}",
    )


def _validate_tool_arguments(
    tool_call: AgentsSdkToolCall,
    *,
    descriptor: AgentsSdkToolDescriptor,
    tool_registry: ToolSpecRegistry,
) -> _ValidatedToolArguments:
    if not isinstance(tool_call.arguments, dict):
        raise AgentsSdkRunnerError(
            "sdk_bad_arguments",
            f"Agents SDK tool arguments must be an object: {tool_call.name}",
        )
    arguments = _normalize_tool_arguments(dict(tool_call.arguments), descriptor.parameters)
    _validate_arguments_against_schema(arguments, descriptor.parameters, tool_call.name)
    payload_class = tool_registry.payload_class_for_tool(tool_call.name)
    try:
        payload_class(**arguments)
    except Exception as exc:
        raise AgentsSdkRunnerError(
            "sdk_bad_arguments",
            f"Agents SDK tool arguments do not match {tool_call.name}: {exc}",
        ) from exc
    return _ValidatedToolArguments(
        arguments=arguments,
        argument_keys=tuple(sorted(arguments)),
    )


def _normalize_tool_arguments(
    arguments: dict[str, object],
    parameters: dict[str, Any],
) -> dict[str, object]:
    properties = parameters.get("properties")
    if not isinstance(properties, dict):
        return arguments
    normalized: dict[str, object] = {}
    for key, value in arguments.items():
        property_schema = properties.get(key)
        if value is None and isinstance(property_schema, dict) and _allows_null(property_schema):
            continue
        normalized[key] = value
    return normalized


def _validate_tool_execution_records(
    tool_call: AgentsSdkToolCall,
    validated_arguments: _ValidatedToolArguments,
    records: tuple[_ToolExecutionRecord, ...],
) -> None:
    if len(records) > 1:
        raise AgentsSdkRunnerError(
            "sdk_multiple_tool_executions",
            "Agents SDK runner executed multiple tools in a single-call pilot",
        )
    if not records:
        return
    record = records[0]
    if record.request.name != tool_call.name:
        raise AgentsSdkRunnerError(
            "sdk_tool_execution_mismatch",
            "Agents SDK runner final tool call does not match executed tool",
        )
    if record.request.call_id and tool_call.call_id and record.request.call_id != tool_call.call_id:
        raise AgentsSdkRunnerError(
            "sdk_tool_execution_mismatch",
            "Agents SDK runner final tool call id does not match executed tool",
        )
    if validated_arguments.argument_keys != record.argument_keys:
        raise AgentsSdkRunnerError(
            "sdk_tool_execution_mismatch",
            "Agents SDK runner final tool arguments do not match executed tool",
        )
    if (
        isinstance(tool_call.arguments, dict)
        and dict(validated_arguments.arguments) != record.arguments
    ):
        raise AgentsSdkRunnerError(
            "sdk_tool_execution_mismatch",
            "Agents SDK runner final tool argument values do not match executed tool",
        )


def _bounded_tool_result_projection(value: Mapping[str, object] | str) -> dict[str, object]:
    if isinstance(value, Mapping):
        projection: dict[str, object] = {}
        for raw_key, raw_value in value.items():
            key = str(raw_key).strip()
            if not key or is_unsafe_agents_sdk_projection_key(key):
                continue
            safe_value = _safe_projection_value(raw_value)
            if safe_value is not None:
                projection[key] = safe_value
        return projection
    text = str(value)
    return {
        "result_type": "text",
        "text_length": len(text),
        "text_preview": text[:512],
    }


def _safe_projection_value(value: object) -> object:
    if value is None or isinstance(value, bool | int | float):
        return value
    if isinstance(value, str):
        if is_unsafe_agents_sdk_projection_value(value):
            return None
        return value[:512]
    if isinstance(value, tuple | list):
        items: list[object] = []
        for item in value[:20]:
            if item is None or isinstance(item, bool | int | float):
                items.append(item)
            elif isinstance(item, str):
                if is_unsafe_agents_sdk_projection_value(item):
                    continue
                items.append(item[:512])
            elif isinstance(item, Mapping):
                nested = _bounded_tool_result_projection(item)
                if nested:
                    items.append(nested)
        return items
    if isinstance(value, Mapping):
        nested = _bounded_tool_result_projection(value)
        if nested:
            return nested
    return None


def _validate_arguments_against_schema(
    arguments: dict[str, object],
    parameters: dict[str, Any],
    tool_name: str,
) -> None:
    properties = parameters.get("properties")
    if not isinstance(properties, dict):
        raise AgentsSdkRunnerError(
            "sdk_bad_arguments",
            f"Agents SDK tool schema has no properties: {tool_name}",
        )
    extra_keys = sorted(set(arguments) - set(properties))
    if extra_keys:
        raise AgentsSdkRunnerError(
            "sdk_bad_arguments",
            f"Agents SDK tool arguments include unsupported keys for {tool_name}: {extra_keys}",
        )
    for property_name, property_schema in properties.items():
        if not isinstance(property_schema, dict):
            continue
        if property_name not in arguments:
            if _allows_null(property_schema):
                continue
            raise AgentsSdkRunnerError(
                "sdk_bad_arguments",
                f"Agents SDK tool argument is required for {tool_name}: {property_name}",
            )
        _validate_argument_value(
            arguments[property_name],
            property_schema,
            tool_name=tool_name,
            property_name=property_name,
        )


def _validate_argument_value(
    value: object,
    schema: dict[str, Any],
    *,
    tool_name: str,
    property_name: str,
) -> None:
    if value is None:
        if _allows_null(schema):
            return
        raise AgentsSdkRunnerError(
            "sdk_bad_arguments",
            f"Agents SDK tool argument cannot be null for {tool_name}: {property_name}",
        )
    expected_type = _non_null_type(schema.get("type"))
    if expected_type == "string" and not isinstance(value, str):
        raise _argument_type_error(tool_name, property_name, "string")
    if expected_type == "integer" and not isinstance(value, int):
        raise _argument_type_error(tool_name, property_name, "integer")
    if expected_type == "array" and not isinstance(value, list):
        raise _argument_type_error(tool_name, property_name, "array")
    if expected_type == "object" and not isinstance(value, dict):
        raise _argument_type_error(tool_name, property_name, "object")
    enum_values = schema.get("enum")
    if isinstance(enum_values, list) and value not in enum_values:
        raise AgentsSdkRunnerError(
            "sdk_bad_arguments",
            f"Agents SDK tool argument enum mismatch for {tool_name}: {property_name}",
        )


def _argument_type_error(
    tool_name: str,
    property_name: str,
    expected_type: str,
) -> AgentsSdkRunnerError:
    return AgentsSdkRunnerError(
        "sdk_bad_arguments",
        "Agents SDK tool argument type mismatch for "
        f"{tool_name}: {property_name} must be {expected_type}",
    )


def _allows_null(schema: dict[str, Any]) -> bool:
    schema_type = schema.get("type")
    return schema_type == "null" or (isinstance(schema_type, list) and "null" in schema_type)


def _non_null_type(schema_type: object) -> str:
    if isinstance(schema_type, str):
        return schema_type
    if isinstance(schema_type, list):
        for item in schema_type:
            if item != "null":
                return str(item)
    return ""


def _final_output_text(value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise AgentsSdkRunnerError(
            "sdk_malformed_final_output",
            "Agents SDK runner final output must be non-empty text",
        )
    return value.strip()


def _runtime_error_response(
    request: AgentRequest,
    failure_class: str,
    message: str,
    *,
    retryable: bool = False,
    bridge_reason: str = "",
    latency_ms: int = 0,
    runtime_posture: str = "",
    tool_execution_count: int = 0,
) -> AgentResponse:
    selected_tool = request.allowed_tools[0] if request.allowed_tools else ""
    tool_attempted = failure_class not in {
        "runtime_disabled",
        "request_not_admitted",
        "sdk_tool_not_admitted",
    }
    error_projection: dict[str, object] = {
        "schema_version": AGENTS_SDK_RUNNER_ERROR_SCHEMA_VERSION,
        "failure_class": failure_class,
        "retryable": retryable,
    }
    if bridge_reason:
        error_projection["bridge_reason"] = bridge_reason
    trace_projection = build_agents_sdk_trace_projection(
        target=request.target,
        selected_tool=selected_tool,
        runtime_posture=runtime_posture,
        tool_call_count=0,
        tool_execution_count=tool_execution_count,
        tool_argument_keys=(),
        tool_outcome=failure_class,
        result_outcome=failure_class,
        failure_class=failure_class,
        retryable=retryable,
        tool_attempted=tool_attempted,
        latency_ms=latency_ms,
        model_response_ref="",
        workflow_run_ref=request.workflow_context.workflow_run_ref,
        step_id=request.workflow_context.step_id,
        agent_id=request.workflow_context.agent_id,
        step_status="error",
        terminal_reason=failure_class,
        fail_close_reason=failure_class,
        input_projection_refs=request.workflow_context.projection_refs,
    )
    return AgentResponse(
        target=request.target,
        status="error",
        confidence="low",
        error=ErrorInfo(
            code="agents_sdk_runtime_failed",
            message=message,
            retryable=retryable,
        ),
        agent_observability=AgentObservability(
            selected_tool=selected_tool,
            tool_attempted=tool_attempted,
            tool_outcome=failure_class,
            failure_class=failure_class,
            fail_close_reason=failure_class,
            result_outcome=failure_class,
            source_ref_count=0,
            access_decision="not_evaluated",
            safe_details={
                "agents_sdk_runner_error": error_projection,
                "agents_sdk_trace_projection": trace_projection,
            },
        ),
    )


def _runtime_posture_for_descriptors(
    descriptors: tuple[AgentsSdkToolDescriptor, ...],
) -> str:
    if not descriptors:
        return ""
    return descriptors[0].runtime_posture


def _runtime_posture_for_request(request: AgentRequest, registry: ToolSpecRegistry) -> str:
    if not request.allowed_tools:
        return ""
    tool = registry.tool_by_name(request.allowed_tools[0])
    return tool.runtime_posture if tool is not None else ""


def _tool_execution_count(recorder: _ToolExecutionRecorder | None) -> int:
    return len(recorder.records) if recorder is not None else 0


def _tool_execution_source_ref_count(
    records: tuple[_ToolExecutionRecord, ...],
) -> int:
    if not records:
        return 0
    latest = records[-1].result_projection
    count = latest.get("source_ref_count")
    if isinstance(count, int) and count >= 0:
        return count
    return 0


def _workflow_output_projection_ref(
    request: AgentRequest,
    records: tuple[_ToolExecutionRecord, ...],
) -> dict[str, object] | None:
    if not records:
        return None
    latest = records[-1].result_projection
    projection = _projection_for_tool_result(
        request.workflow_context.step_id,
        request.allowed_tools[0] if request.allowed_tools else "",
        latest,
    )
    return projection


def _projection_for_tool_result(
    source_step_id: str,
    tool_name: str,
    tool_result: Mapping[str, object],
) -> dict[str, object] | None:
    if tool_name == "transport_schedule_lookup":
        resolved_route = tool_result.get("resolved_route")
        if not isinstance(resolved_route, Mapping):
            return None
        route_id = str(resolved_route.get("route_id") or "").strip()
        route_display_name = str(resolved_route.get("display_name") or "").strip()
        service_family = str(resolved_route.get("service_family") or "").strip()
        summary = str(tool_result.get("query_text") or "").strip()
        if not (route_id or route_display_name or service_family or summary):
            return None
        payload: dict[str, object] = {
            "route_id": route_id,
            "route_display_name": route_display_name,
            "service_family": service_family,
            "summary": summary,
        }
        source_refs = tool_result.get("source_refs")
        if isinstance(source_refs, list):
            normalized_refs = [str(item).strip() for item in source_refs if str(item).strip()]
            if normalized_refs:
                payload["source_refs"] = normalized_refs
        return _safe_projection_ref(source_step_id, "schedule_baseline", payload)
    if tool_name == "campus_notice_discover":
        return None
    return None


def _safe_projection_ref(
    source_step_id: str,
    projection_kind: str,
    payload: Mapping[str, object],
) -> dict[str, object]:
    encoded = json.dumps(payload, ensure_ascii=False, separators=(",", ":"), sort_keys=True).encode(
        "utf-8"
    )
    digest = hashlib.sha256(encoded).hexdigest()
    fields_present = sorted(key for key, value in payload.items() if _has_projection_value(value))
    return {
        "projection_id": f"projection:{projection_kind}:{digest[:16]}",
        "source_step_id": source_step_id,
        "projection_kind": projection_kind,
        "content_hash": f"sha256:{digest}",
        "safety": {
            "truncated": False,
            "redacted": False,
            "max_chars": 1600,
            "fields_present": fields_present,
        },
    }


def _has_projection_value(value: object) -> bool:
    if isinstance(value, str):
        return bool(value.strip())
    if isinstance(value, list | tuple | dict):
        return len(value) > 0
    return value is not None


__all__ = [
    "AGENTS_SDK_RUNNER_ERROR_SCHEMA_VERSION",
    "AGENTS_SDK_RUNNER_PROJECTION_SCHEMA_VERSION",
    "AgentsSdkRunRequest",
    "AgentsSdkRunResult",
    "AgentsSdkRunner",
    "AgentsSdkRunnerError",
    "AgentsSdkRunnerTimeoutError",
    "AgentsSdkToolCall",
    "AgentsSdkToolExecutionRequest",
    "AgentsSdkToolExecutor",
    "run_agents_sdk_runner_shell",
]
