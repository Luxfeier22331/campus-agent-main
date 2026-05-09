from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from campus_contracts import AgentObservability, AgentRequest, AgentResponse, ErrorInfo

from campus_supervisor_agent_worker.agents_sdk_trace_projection import (
    build_agents_sdk_tool_lifecycle_projection,
    build_agents_sdk_trace_projection,
    is_unsafe_agents_sdk_projection_key,
    is_unsafe_agents_sdk_projection_value,
)
from campus_supervisor_agent_worker.openai_agents_runtime import (
    OpenAIAgentsRunResult,
    OpenAIAgentsToolCall,
)

OPENAI_AGENTS_RUNTIME_PROJECTION_SCHEMA_VERSION = "openai-agents-runtime-projection-v1"
OPENAI_AGENTS_RUNTIME_ERROR_SCHEMA_VERSION = "openai-agents-runtime-error-v1"


class OpenAIAgentsRuntimeProjectionError(ValueError):
    def __init__(self, failure_class: str, message: str, *, retryable: bool = False) -> None:
        super().__init__(f"{failure_class}: {message}")
        self.failure_class = failure_class
        self.message = message
        self.retryable = retryable


@dataclass(frozen=True, slots=True)
class OpenAIAgentsToolExecutionRecord:
    name: str
    call_id: str
    arguments: dict[str, object]
    argument_keys: tuple[str, ...]
    result_projection: dict[str, object]


def response_from_native_runtime_result(
    request: AgentRequest,
    result: OpenAIAgentsRunResult,
    *,
    descriptors,
    tool_execution_records: tuple[OpenAIAgentsToolExecutionRecord, ...] = (),
    require_tool_execution: bool = False,
    latency_ms: int = 0,
    instruction_profile_id: str = "",
    result_usage_mode: str = "",
    surface_execution_mode: str = "",
) -> AgentResponse:
    descriptor_by_name = {descriptor.name: descriptor for descriptor in descriptors}
    tool_call = _single_tool_call(result.tool_calls)
    descriptor = descriptor_by_name.get(tool_call.name)
    if descriptor is None:
        raise OpenAIAgentsRuntimeProjectionError(
            "sdk_wrong_tool",
            f"OpenAI Agents native runtime called disallowed tool: {tool_call.name}",
        )
    validated_arguments = _validate_tool_arguments(tool_call.arguments, descriptor.parameters)
    if require_tool_execution and not tool_execution_records:
        raise OpenAIAgentsRuntimeProjectionError(
            "sdk_tool_not_executed",
            "OpenAI Agents native runtime did not execute the required repo-owned tool",
        )
    _validate_tool_execution_records(tool_call, validated_arguments, tool_execution_records)
    final_output = _final_output_text(result.final_output)
    runner_projection: dict[str, object] = {
        "schema_version": OPENAI_AGENTS_RUNTIME_PROJECTION_SCHEMA_VERSION,
        "tool_call_count": 1,
        "tool_names": [tool_call.name],
        "model_tool_call_ref": tool_call.call_id,
        "model_response_ref": result.model_response_ref,
        "argument_keys": list(sorted(validated_arguments)),
        "tool_execution_count": len(tool_execution_records),
        "instruction_profile_id": instruction_profile_id,
        "result_usage_mode": result_usage_mode,
        "surface_execution_mode": surface_execution_mode,
    }
    response_result: dict[str, object] | None = None
    if tool_execution_records:
        latest = tool_execution_records[-1].result_projection
        runner_projection["tool_result_projection"] = latest
        response_result = {
            "payload_kind": descriptor.payload_kind,
            "tool_result": latest,
        }
        if descriptor.payload_kind == "transport_schedule_lookup":
            _promote_transport_schedule_fields(response_result, latest)
        if descriptor.payload_kind == "campus_notice_change_set_lookup":
            _promote_notice_change_set_fields(response_result, latest)
    output_projection_ref = _workflow_output_projection_ref(
        request,
        tool_name=tool_call.name,
        records=tool_execution_records,
    )
    _validate_expected_output_artifacts(request.workflow_context, output_projection_ref)
    trace_projection = build_agents_sdk_trace_projection(
        target=request.target,
        selected_tool=tool_call.name,
        runtime_posture=descriptor.runtime_posture,
        tool_call_count=1,
        tool_execution_count=len(tool_execution_records),
        tool_argument_keys=list(sorted(validated_arguments)),
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
                "openai_agents_runtime_projection": runner_projection,
                "agents_sdk_trace_projection": trace_projection,
                "agents_sdk_tool_lifecycle_projection": lifecycle_projection,
            },
        ),
    )


def runtime_error_response(
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
        "schema_version": OPENAI_AGENTS_RUNTIME_ERROR_SCHEMA_VERSION,
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
                "openai_agents_runtime_error": error_projection,
                "agents_sdk_trace_projection": trace_projection,
            },
        ),
    )


def bounded_tool_result_projection(value: Mapping[str, object] | str) -> dict[str, object]:
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


def _single_tool_call(tool_calls: tuple[OpenAIAgentsToolCall, ...]) -> OpenAIAgentsToolCall:
    if not tool_calls:
        raise OpenAIAgentsRuntimeProjectionError(
            "sdk_no_tool_call",
            "OpenAI Agents native runtime result did not include a required tool call",
        )
    if len(tool_calls) > 1:
        raise OpenAIAgentsRuntimeProjectionError(
            "sdk_multiple_tool_calls",
            "OpenAI Agents native runtime result included multiple tool calls",
        )
    tool_call = tool_calls[0]
    if not tool_call.name.strip():
        raise OpenAIAgentsRuntimeProjectionError(
            "sdk_malformed_tool_call",
            "OpenAI Agents native runtime tool call name is required",
        )
    return tool_call


def _validate_tool_arguments(
    arguments: dict[str, object],
    parameters: dict[str, Any],
) -> dict[str, object]:
    normalized = _normalize_tool_arguments(arguments, parameters)
    _validate_arguments_against_schema(normalized, parameters)
    return normalized


def _normalize_tool_arguments(
    arguments: dict[str, object],
    parameters: dict[str, Any],
) -> dict[str, object]:
    properties = parameters.get("properties")
    if not isinstance(properties, dict):
        return dict(arguments)
    normalized: dict[str, object] = {}
    for key, value in arguments.items():
        property_schema = properties.get(key)
        if value is None and isinstance(property_schema, dict) and _allows_null(property_schema):
            continue
        normalized[key] = value
    return normalized


def _validate_arguments_against_schema(
    arguments: dict[str, object], parameters: dict[str, Any]
) -> None:
    properties = parameters.get("properties")
    if not isinstance(properties, dict):
        raise OpenAIAgentsRuntimeProjectionError(
            "sdk_bad_arguments",
            "OpenAI Agents native runtime tool schema has no properties",
        )
    extra_keys = sorted(set(arguments) - set(properties))
    if extra_keys:
        raise OpenAIAgentsRuntimeProjectionError(
            "sdk_bad_arguments",
            f"OpenAI Agents native runtime tool arguments include unsupported keys: {extra_keys}",
        )
    for property_name, property_schema in properties.items():
        if not isinstance(property_schema, dict):
            continue
        if property_name not in arguments:
            if _allows_null(property_schema):
                continue
            raise OpenAIAgentsRuntimeProjectionError(
                "sdk_bad_arguments",
                f"OpenAI Agents native runtime tool argument is required: {property_name}",
            )
        _validate_argument_value(arguments[property_name], property_schema, property_name)


def _validate_argument_value(value: object, schema: dict[str, Any], property_name: str) -> None:
    if value is None:
        if _allows_null(schema):
            return
        raise OpenAIAgentsRuntimeProjectionError(
            "sdk_bad_arguments",
            f"OpenAI Agents native runtime tool argument cannot be null: {property_name}",
        )
    expected_type = _non_null_type(schema.get("type"))
    if expected_type == "string" and not isinstance(value, str):
        raise _argument_type_error(property_name, "string")
    if expected_type == "integer" and not isinstance(value, int):
        raise _argument_type_error(property_name, "integer")
    if expected_type == "array" and not isinstance(value, list):
        raise _argument_type_error(property_name, "array")
    if expected_type == "object" and not isinstance(value, dict):
        raise _argument_type_error(property_name, "object")
    enum_values = schema.get("enum")
    if isinstance(enum_values, list) and value not in enum_values:
        raise OpenAIAgentsRuntimeProjectionError(
            "sdk_bad_arguments",
            f"OpenAI Agents native runtime tool argument enum mismatch: {property_name}",
        )


def _argument_type_error(
    property_name: str, expected_type: str
) -> OpenAIAgentsRuntimeProjectionError:
    return OpenAIAgentsRuntimeProjectionError(
        "sdk_bad_arguments",
        "OpenAI Agents native runtime tool argument type mismatch for "
        f"{property_name}: must be {expected_type}",
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


def _validate_tool_execution_records(
    tool_call: OpenAIAgentsToolCall,
    validated_arguments: dict[str, object],
    records: tuple[OpenAIAgentsToolExecutionRecord, ...],
) -> None:
    if len(records) > 1:
        raise OpenAIAgentsRuntimeProjectionError(
            "sdk_multiple_tool_executions",
            "OpenAI Agents native runtime executed multiple tools in a single-call run",
        )
    if not records:
        return
    record = records[0]
    if record.name != tool_call.name:
        raise OpenAIAgentsRuntimeProjectionError(
            "sdk_tool_execution_mismatch",
            "OpenAI Agents native runtime final tool call does not match executed tool",
        )
    if record.call_id and tool_call.call_id and record.call_id != tool_call.call_id:
        raise OpenAIAgentsRuntimeProjectionError(
            "sdk_tool_execution_mismatch",
            "OpenAI Agents native runtime final tool call id does not match executed tool",
        )
    if dict(validated_arguments) != record.arguments:
        raise OpenAIAgentsRuntimeProjectionError(
            "sdk_tool_execution_mismatch",
            "OpenAI Agents native runtime final tool argument values do not match executed tool",
        )


def _final_output_text(value: object) -> str:
    if not isinstance(value, str) or not value.strip():
        raise OpenAIAgentsRuntimeProjectionError(
            "sdk_malformed_final_output",
            "OpenAI Agents native runtime final output must be non-empty text",
        )
    return value.strip()


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
                nested = bounded_tool_result_projection(item)
                if nested:
                    items.append(nested)
        return items
    if isinstance(value, Mapping):
        nested = bounded_tool_result_projection(value)
        if nested:
            return nested
    return None


def _tool_execution_source_ref_count(records: tuple[OpenAIAgentsToolExecutionRecord, ...]) -> int:
    if not records:
        return 0
    count = records[-1].result_projection.get("source_ref_count")
    if isinstance(count, int) and count >= 0:
        return count
    return 0


def _promote_transport_schedule_fields(
    response_result: dict[str, object],
    tool_result: Mapping[str, object],
) -> None:
    for key in (
        "outcome",
        "query_text",
        "intent",
        "resolved_route",
        "service_status",
        "queried_time_anchor",
        "requested_service_date",
        "selected_departure",
        "departure_options",
        "service_window",
        "timetable_entries",
        "schedule_snapshot",
        "service_date",
        "source_refs",
        "source_ref_count",
        "related_notice_refs",
        "operational_notice",
        "operational_notices",
        "change_notice",
    ):
        value = tool_result.get(key)
        if value is not None:
            response_result[key] = value


def _promote_notice_change_set_fields(
    response_result: dict[str, object],
    tool_result: Mapping[str, object],
) -> None:
    for key in (
        "outcome",
        "query_text",
        "change_set",
        "change_set_id",
        "target_family",
        "change_kind",
        "answer_eligible",
        "admission_state",
        "fact_count",
        "change_texts",
        "source_refs",
        "source_ref_count",
    ):
        value = tool_result.get(key)
        if value is not None:
            response_result[key] = value


def _workflow_output_projection_ref(
    request: AgentRequest,
    *,
    tool_name: str,
    records: tuple[OpenAIAgentsToolExecutionRecord, ...],
) -> dict[str, object] | None:
    if not records:
        return None
    latest = records[-1].result_projection
    return _projection_for_tool_result(request.workflow_context.step_id, tool_name, latest)


def _validate_expected_output_artifacts(
    workflow_context,
    output_projection_ref: dict[str, object] | None,
) -> None:
    expected_artifacts = tuple(workflow_context.expected_output_artifacts)
    if not expected_artifacts:
        return
    produced_kind = ""
    if isinstance(output_projection_ref, Mapping):
        produced_kind = str(output_projection_ref.get("projection_kind") or "").strip()
    missing = [
        artifact_kind for artifact_kind in expected_artifacts if artifact_kind != produced_kind
    ]
    if missing:
        raise OpenAIAgentsRuntimeProjectionError(
            "sdk_artifact_incomplete",
            "OpenAI Agents native runtime did not produce required output artifacts: "
            + ", ".join(missing),
        )


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
    if tool_name == "campus_notice_change_set_lookup":
        change_set = tool_result.get("change_set")
        if not isinstance(change_set, Mapping):
            return None
        payload: dict[str, object] = {
            "change_set_id": str(change_set.get("change_set_id") or "").strip(),
            "target_family": str(change_set.get("target_family") or "").strip(),
            "change_kind": str(change_set.get("change_kind") or "").strip(),
            "service_date": "",
            "summary": "",
        }
        query_scope = change_set.get("query_scope")
        if isinstance(query_scope, Mapping):
            payload["service_date"] = str(query_scope.get("service_date") or "").strip()
            route_labels = [
                str(item).strip()
                for item in query_scope.get("route_labels", [])
                if str(item).strip()
            ]
            if route_labels:
                payload["route_labels"] = route_labels
        facts = change_set.get("facts")
        if isinstance(facts, list):
            fact_summaries = []
            for item in facts:
                if not isinstance(item, Mapping):
                    continue
                summary = str(item.get("change_text") or "").strip()
                if summary:
                    fact_summaries.append(summary)
            if fact_summaries:
                payload["fact_summaries"] = fact_summaries
                payload["summary"] = "；".join(fact_summaries)[:1600]
        source_refs = change_set.get("source_refs")
        if isinstance(source_refs, list):
            normalized_refs = []
            for item in source_refs:
                if not isinstance(item, Mapping):
                    continue
                source_url = str(item.get("source_url") or "").strip()
                if source_url:
                    normalized_refs.append(source_url)
            if normalized_refs:
                payload["source_refs"] = normalized_refs
        if not any(_has_projection_value(value) for value in payload.values()):
            return None
        return _safe_projection_ref(source_step_id, "notice_change_set", payload)
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
    "OPENAI_AGENTS_RUNTIME_ERROR_SCHEMA_VERSION",
    "OPENAI_AGENTS_RUNTIME_PROJECTION_SCHEMA_VERSION",
    "OpenAIAgentsRuntimeProjectionError",
    "OpenAIAgentsToolExecutionRecord",
    "bounded_tool_result_projection",
    "response_from_native_runtime_result",
    "runtime_error_response",
]
