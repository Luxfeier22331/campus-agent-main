from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from typing import TYPE_CHECKING, Any

from campus_supervisor_agent_worker.agents_sdk_tool_bridge import AgentsSdkToolDescriptor

if TYPE_CHECKING:
    from campus_supervisor_agent_worker.openai_agents_runtime import (
        OpenAIAgentsToolExecutor,
    )

ToolCallRecorder = Callable[[Any], None]


def build_agents_sdk_function_tool(
    descriptor: AgentsSdkToolDescriptor,
    *,
    execute_tool: OpenAIAgentsToolExecutor | None,
    record_tool_call: ToolCallRecorder | None = None,
):
    from agents import FunctionTool

    async def invoke_tool(context: object, raw_arguments: str) -> str:
        arguments = parse_agents_sdk_tool_arguments(raw_arguments)
        call_id = str(getattr(context, "tool_call_id", "") or "")
        if record_tool_call is not None:
            from campus_supervisor_agent_worker.openai_agents_runtime import OpenAIAgentsToolCall

            record_tool_call(
                OpenAIAgentsToolCall(
                    name=descriptor.name,
                    arguments=arguments,
                    call_id=call_id,
                )
            )
        if execute_tool is None:
            from campus_supervisor_agent_worker.openai_agents_runtime import (
                OpenAIAgentsRuntimeError,
            )

            raise OpenAIAgentsRuntimeError(
                "sdk_tool_not_executed",
                "OpenAI Agents native runtime requires a repo-owned tool executor",
            )
        from campus_supervisor_agent_worker.openai_agents_runtime import OpenAIAgentsToolInvocation

        result = execute_tool(
            OpenAIAgentsToolInvocation(
                name=descriptor.name,
                arguments=arguments,
                call_id=call_id,
            )
        )
        return agents_sdk_tool_output_string(result)

    return FunctionTool(
        name=descriptor.name,
        description=descriptor.description,
        params_json_schema=descriptor.parameters,
        on_invoke_tool=invoke_tool,
        strict_json_schema=descriptor.function_schema_strict,
        timeout_seconds=agents_sdk_tool_timeout_seconds(descriptor.runtime_policy),
        timeout_behavior="raise_exception",
    )


def parse_agents_sdk_tool_arguments(raw_arguments: str) -> dict[str, object]:
    try:
        parsed = json.loads(raw_arguments or "{}")
    except json.JSONDecodeError as exc:
        from campus_supervisor_agent_worker.openai_agents_runtime import (
            OpenAIAgentsRuntimeError,
        )

        raise OpenAIAgentsRuntimeError(
            "sdk_bad_arguments",
            "OpenAI Agents tool arguments must be valid JSON",
        ) from exc
    if not isinstance(parsed, dict):
        from campus_supervisor_agent_worker.openai_agents_runtime import (
            OpenAIAgentsRuntimeError,
        )

        raise OpenAIAgentsRuntimeError(
            "sdk_bad_arguments",
            "OpenAI Agents tool arguments must be a JSON object",
        )
    return dict(parsed)


def agents_sdk_tool_output_string(value: Mapping[str, object] | str) -> str:
    if isinstance(value, str):
        return value
    return json.dumps(dict(value), ensure_ascii=False, sort_keys=True)


def agents_sdk_tool_timeout_seconds(runtime_policy: Mapping[str, object]) -> float | None:
    value = runtime_policy.get("timeout_seconds")
    if isinstance(value, int | float) and value > 0:
        return float(value)
    return None


__all__ = [
    "agents_sdk_tool_output_string",
    "agents_sdk_tool_timeout_seconds",
    "build_agents_sdk_function_tool",
    "parse_agents_sdk_tool_arguments",
]
