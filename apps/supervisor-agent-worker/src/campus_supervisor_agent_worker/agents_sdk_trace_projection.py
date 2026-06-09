from __future__ import annotations

from collections.abc import Mapping, Sequence
from time import monotonic_ns

AGENTS_SDK_TRACE_PROJECTION_SCHEMA_VERSION = "agents-sdk-trace-projection-v1"
AGENTS_SDK_TOOL_LIFECYCLE_PROJECTION_SCHEMA_VERSION = "agents-sdk-tool-lifecycle-projection-v1"
AGENTS_SDK_ADAPTER_LANE = "agents_sdk_domain_capability_adapter"

_UNSAFE_KEY_TOKENS = (
    "rawresponse",
    "rawresponses",
    "rawmodeloutput",
    "rawtranscript",
    "rawprompt",
    "providerrawresponse",
    "sdkrunstate",
    "traceurl",
    "providerresponse",
)
_UNSAFE_VALUE_TOKENS = (
    "platform.openai.com/traces",
    "sdkrunstate",
    "rawmodeloutput",
    "rawresponse",
    "providerresponse",
)
_SDK_REPR_TOKENS = (
    "<agents.",
    "<openai.",
    "runresult(",
    "responseoutput",
)


def start_agents_sdk_trace_timer() -> int:
    return monotonic_ns()


def elapsed_agents_sdk_latency_ms(started_ns: int) -> int:
    elapsed_ns = monotonic_ns() - started_ns
    if elapsed_ns <= 0:
        return 0
    return elapsed_ns // 1_000_000


def build_agents_sdk_trace_projection(
    *,
    target: str,
    selected_tool: str,
    runtime_posture: str,
    tool_call_count: int,
    tool_execution_count: int,
    tool_argument_keys: Sequence[str],
    tool_outcome: str,
    result_outcome: str,
    failure_class: str = "",
    retryable: bool = False,
    tool_attempted: bool = False,
    latency_ms: int = 0,
    model_response_ref: str = "",
    model_name: str = "",
    instruction_profile_id: str = "",
    result_usage_mode: str = "",
    surface_execution_mode: str = "",
    estimated_cost_microusd: int | None = None,
    workflow_run_ref: str = "",
    step_id: str = "",
    capability_id: str = "",
    step_status: str = "",
    terminal_reason: str = "",
    fail_close_reason: str = "",
    input_projection_refs: Sequence[Mapping[str, object]] = (),
    output_projection_ref: Mapping[str, object] | None = None,
) -> dict[str, object]:
    projection: dict[str, object] = {
        "schema_version": AGENTS_SDK_TRACE_PROJECTION_SCHEMA_VERSION,
        "adapter_lane": AGENTS_SDK_ADAPTER_LANE,
        "runtime_posture": runtime_posture,
        "target": target,
        "selected_tool": selected_tool,
        "tool_call_count": max(0, int(tool_call_count)),
        "tool_execution_count": max(0, int(tool_execution_count)),
        "tool_argument_keys": sorted(str(key) for key in tool_argument_keys if str(key).strip()),
        "tool_outcome": tool_outcome,
        "result_outcome": result_outcome,
        "failure_class": failure_class,
        "retryable": bool(retryable),
        "tool_attempted": bool(tool_attempted),
        "latency_ms": max(0, int(latency_ms)),
        "model_response_ref": model_response_ref,
        "model_name": model_name.strip(),
        "instruction_profile_id": instruction_profile_id.strip(),
        "result_usage_mode": result_usage_mode.strip(),
        "surface_execution_mode": surface_execution_mode.strip(),
        "workflow_run_ref": workflow_run_ref.strip(),
        "step_id": step_id.strip(),
        "capability_id": capability_id.strip(),
        "step_status": step_status.strip(),
        "terminal_reason": terminal_reason.strip(),
        "fail_close_reason": fail_close_reason.strip(),
        "input_projection_refs": [
            dict(item) for item in input_projection_refs if isinstance(item, Mapping)
        ],
    }
    if output_projection_ref is not None:
        projection["output_projection_ref"] = dict(output_projection_ref)
    if estimated_cost_microusd is not None:
        projection["estimated_cost_microusd"] = max(0, int(estimated_cost_microusd))
    reject_unsafe_agents_sdk_projection(projection)
    return projection


def build_agents_sdk_tool_lifecycle_projection(
    *,
    selected_tool: str,
    model_tool_call_ref: str,
    model_response_ref: str,
    tool_output_submitted: bool,
    tool_execution_owner: str,
) -> dict[str, object]:
    projection: dict[str, object] = {
        "schema_version": AGENTS_SDK_TOOL_LIFECYCLE_PROJECTION_SCHEMA_VERSION,
        "tool_call_id_source": "repo",
        "selected_tool": selected_tool,
        "model_tool_call_ref": model_tool_call_ref,
        "model_response_ref": model_response_ref,
        "tool_output_submitted": bool(tool_output_submitted),
        "tool_execution_owner": tool_execution_owner,
    }
    reject_unsafe_agents_sdk_projection(projection)
    return projection


def is_unsafe_agents_sdk_projection_key(value: str) -> bool:
    normalized = _normalized_token(value)
    if not normalized:
        return False
    return normalized.startswith("raw") or any(token in normalized for token in _UNSAFE_KEY_TOKENS)


def is_unsafe_agents_sdk_projection_value(value: str) -> bool:
    normalized = _normalized_token(value)
    lowered = value.strip().lower()
    if any(token in normalized for token in _UNSAFE_VALUE_TOKENS):
        return True
    return any(token in lowered for token in _SDK_REPR_TOKENS)


def reject_unsafe_agents_sdk_projection(value: object, *, path: str = "projection") -> None:
    if isinstance(value, Mapping):
        for key, item in value.items():
            raw_key = str(key)
            if is_unsafe_agents_sdk_projection_key(raw_key):
                raise ValueError(f"{path} contains unsafe Agents SDK projection key: {raw_key}")
            reject_unsafe_agents_sdk_projection(item, path=f"{path}.{raw_key}")
        return
    if isinstance(value, tuple | list):
        for index, item in enumerate(value):
            reject_unsafe_agents_sdk_projection(item, path=f"{path}[{index}]")
        return
    if isinstance(value, str) and is_unsafe_agents_sdk_projection_value(value):
        raise ValueError(f"{path} contains unsafe Agents SDK projection value")


def _normalized_token(value: str) -> str:
    return "".join(char for char in value.strip().lower() if char.isalnum())


__all__ = [
    "AGENTS_SDK_ADAPTER_LANE",
    "AGENTS_SDK_TOOL_LIFECYCLE_PROJECTION_SCHEMA_VERSION",
    "AGENTS_SDK_TRACE_PROJECTION_SCHEMA_VERSION",
    "build_agents_sdk_tool_lifecycle_projection",
    "build_agents_sdk_trace_projection",
    "elapsed_agents_sdk_latency_ms",
    "is_unsafe_agents_sdk_projection_key",
    "is_unsafe_agents_sdk_projection_value",
    "reject_unsafe_agents_sdk_projection",
    "start_agents_sdk_trace_timer",
]
