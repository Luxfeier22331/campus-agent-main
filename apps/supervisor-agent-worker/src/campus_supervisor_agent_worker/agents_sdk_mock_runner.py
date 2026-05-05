from __future__ import annotations

import json
from dataclasses import asdict, is_dataclass

from campus_supervisor_agent_worker.agents_sdk_runner import (
    AgentsSdkRunnerError,
    AgentsSdkRunRequest,
    AgentsSdkRunResult,
    AgentsSdkToolCall,
    AgentsSdkToolExecutionRequest,
)


class MockAgentsSdkRunner:
    """Deterministic local SDK runner for process smoke and contract tests."""

    def __call__(self, request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
        if request.execute_tool is None:
            raise AgentsSdkRunnerError(
                "sdk_tool_not_executed",
                "Mock Agents SDK runner requires a repo-owned tool executor",
            )
        tool_name = _single_allowed_tool(request)
        arguments = _payload_arguments(request.agent_request.payload)
        call_id = f"mock-sdk:{request.request_id}:{tool_name}"
        tool_result = request.execute_tool(
            AgentsSdkToolExecutionRequest(
                name=tool_name,
                arguments=arguments,
                call_id=call_id,
            )
        )
        return AgentsSdkRunResult(
            final_output=_final_output(request, tool_result),
            tool_calls=(
                AgentsSdkToolCall(
                    name=tool_name,
                    arguments=arguments,
                    call_id=call_id,
                ),
            ),
            model_response_ref=f"mock-runtime:{request.request_id}",
        )


def _single_allowed_tool(request: AgentsSdkRunRequest) -> str:
    if len(request.allowed_tools) != 1:
        raise AgentsSdkRunnerError(
            "sdk_bad_arguments",
            "Mock Agents SDK runner requires exactly one allowed tool",
        )
    return request.allowed_tools[0]


def _payload_arguments(payload: object) -> dict[str, object]:
    if is_dataclass(payload):
        return _normalize_arguments(asdict(payload))
    if isinstance(payload, dict):
        return _normalize_arguments(payload)
    raise AgentsSdkRunnerError(
        "sdk_bad_arguments",
        "Mock Agents SDK runner requires a dataclass or dict payload",
    )


def _normalize_arguments(payload: dict[str, object]) -> dict[str, object]:
    return {key: _json_value(value) for key, value in payload.items()}


def _json_value(value: object) -> object:
    if isinstance(value, tuple):
        return [_json_value(item) for item in value]
    if isinstance(value, list):
        return [_json_value(item) for item in value]
    if isinstance(value, dict):
        return {str(key): _json_value(item) for key, item in value.items()}
    return value


def _final_output(
    request: AgentsSdkRunRequest,
    tool_result: object,
) -> str:
    if isinstance(tool_result, dict):
        return (
            "Mock Agents SDK completed "
            f"{request.allowed_tools[0]} for {request.target}: "
            f"{json.dumps(tool_result, ensure_ascii=False, sort_keys=True)}"
        )
    return f"Mock Agents SDK completed {request.allowed_tools[0]}: {tool_result}"


__all__ = ["MockAgentsSdkRunner"]
