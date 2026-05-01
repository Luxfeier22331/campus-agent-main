from __future__ import annotations

import json
from collections.abc import Mapping

from campus_shared import PromptRuntimeProviderConfig

from campus_supervisor_agent_worker.agents_sdk_runner import (
    AgentsSdkRunnerError,
    AgentsSdkRunRequest,
    AgentsSdkRunResult,
    AgentsSdkToolCall,
    AgentsSdkToolExecutionRequest,
)

_DEFAULT_INSTRUCTIONS = """
You are a bounded campus domain-agent adapter.
Use only the supplied repo-owned function tool.
After the tool result is available, answer the user from that tool result only.
Do not invent source data, do not call any unavailable tool, and keep the final answer concise.
""".strip()


class OpenAIAgentsSdkRunner:
    def __init__(
        self,
        *,
        provider_config: PromptRuntimeProviderConfig,
        model_name: str,
        instructions: str = _DEFAULT_INSTRUCTIONS,
        max_turns: int = 3,
    ) -> None:
        self._provider_config = provider_config
        self._model_name = model_name.strip()
        self._instructions = instructions.strip() or _DEFAULT_INSTRUCTIONS
        self._max_turns = max_turns
        if not self._model_name:
            raise AgentsSdkRunnerError(
                "sdk_runtime_not_admitted",
                "Agents SDK runner model_name is required",
            )
        if self._max_turns <= 1:
            raise AgentsSdkRunnerError(
                "sdk_runtime_not_admitted",
                "Agents SDK runner max_turns must allow a tool call and final answer",
            )

    def __call__(self, request: AgentsSdkRunRequest) -> AgentsSdkRunResult:
        if request.execute_tool is None:
            raise AgentsSdkRunnerError(
                "sdk_tool_not_executed",
                "Agents SDK runner requires a repo-owned tool executor",
            )

        from agents import Agent, ModelSettings, RunConfig, Runner
        from agents.models.openai_provider import OpenAIProvider

        executed_tool_calls: list[AgentsSdkToolCall] = []
        tools = [
            self._function_tool(
                descriptor,
                request=request,
                executed_tool_calls=executed_tool_calls,
            )
            for descriptor in request.tool_descriptors
        ]
        agent = Agent(
            name=request.target,
            instructions=self._instructions,
            tools=tools,
            model=self._model_name,
            model_settings=ModelSettings(
                tool_choice="required",
                parallel_tool_calls=False,
                max_tokens=self._provider_config.max_output_tokens,
            ),
        )
        result = Runner.run_sync(
            agent,
            request.user_goal,
            context=request.context,
            max_turns=self._max_turns,
            run_config=RunConfig(
                model_provider=OpenAIProvider(
                    api_key=self._provider_config.api_key,
                    base_url=self._provider_config.base_url,
                    use_responses=True,
                ),
                tracing_disabled=True,
            ),
        )
        return AgentsSdkRunResult(
            final_output=getattr(result, "final_output", ""),
            tool_calls=tuple(executed_tool_calls),
            model_response_ref=str(getattr(result, "last_response_id", "") or ""),
        )

    def _function_tool(
        self,
        descriptor,
        *,
        request: AgentsSdkRunRequest,
        executed_tool_calls: list[AgentsSdkToolCall],
    ):
        from agents import FunctionTool

        async def invoke_tool(context, raw_arguments: str) -> str:
            arguments = _parse_tool_arguments(raw_arguments)
            call_id = str(getattr(context, "tool_call_id", "") or "")
            executed_tool_calls.append(
                AgentsSdkToolCall(
                    name=descriptor.name,
                    arguments=arguments,
                    call_id=call_id,
                )
            )
            assert request.execute_tool is not None
            result = request.execute_tool(
                AgentsSdkToolExecutionRequest(
                    name=descriptor.name,
                    arguments=arguments,
                    call_id=call_id,
                )
            )
            return _tool_output_string(result)

        return FunctionTool(
            name=descriptor.name,
            description=descriptor.description,
            params_json_schema=descriptor.parameters,
            on_invoke_tool=invoke_tool,
            strict_json_schema=descriptor.function_schema_strict,
            timeout_seconds=_tool_timeout_seconds(descriptor.runtime_policy),
            timeout_behavior="raise_exception",
        )


def _parse_tool_arguments(raw_arguments: str) -> dict[str, object]:
    try:
        parsed = json.loads(raw_arguments or "{}")
    except json.JSONDecodeError as exc:
        raise AgentsSdkRunnerError(
            "sdk_bad_arguments",
            "Agents SDK tool arguments must be valid JSON",
        ) from exc
    if not isinstance(parsed, dict):
        raise AgentsSdkRunnerError(
            "sdk_bad_arguments",
            "Agents SDK tool arguments must be a JSON object",
        )
    return dict(parsed)


def _tool_output_string(value: Mapping[str, object] | str) -> str:
    if isinstance(value, str):
        return value
    return json.dumps(dict(value), ensure_ascii=False, sort_keys=True)


def _tool_timeout_seconds(runtime_policy: Mapping[str, object]) -> float | None:
    value = runtime_policy.get("timeout_seconds")
    if isinstance(value, int | float) and value > 0:
        return float(value)
    return None


__all__ = ["OpenAIAgentsSdkRunner"]
