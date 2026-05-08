from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field

from campus_contracts import AgentRequest
from campus_shared import PromptRuntimeProviderConfig

from campus_supervisor_agent_worker.agents_sdk_instruction_profiles import (
    AgentsSdkInstructionProfile,
)
from campus_supervisor_agent_worker.agents_sdk_tool_bridge import AgentsSdkToolDescriptor


class OpenAIAgentsRuntimeError(ValueError):
    def __init__(self, failure_class: str, message: str, *, retryable: bool = False) -> None:
        super().__init__(f"{failure_class}: {message}")
        self.failure_class = failure_class
        self.message = message
        self.retryable = retryable


@dataclass(frozen=True, slots=True)
class OpenAIAgentsToolInvocation:
    name: str
    arguments: dict[str, object] = field(default_factory=dict)
    call_id: str = ""


@dataclass(frozen=True, slots=True)
class OpenAIAgentsToolCall:
    name: str
    arguments: dict[str, object] = field(default_factory=dict)
    call_id: str = ""


@dataclass(frozen=True, slots=True)
class OpenAIAgentsRunResult:
    final_output: object = ""
    tool_calls: tuple[OpenAIAgentsToolCall, ...] = field(default_factory=tuple)
    model_response_ref: str = ""


OpenAIAgentsToolExecutor = Callable[
    [OpenAIAgentsToolInvocation],
    Mapping[str, object] | str,
]
OpenAIAgentsRunner = Callable[..., object]


class OpenAIAgentsNativeRuntime:
    def __init__(
        self,
        *,
        provider_config: PromptRuntimeProviderConfig,
        model_name: str,
        max_turns: int = 3,
        runner: OpenAIAgentsRunner | None = None,
    ) -> None:
        self._provider_config = provider_config
        self._model_name = model_name.strip()
        self._max_turns = max_turns
        self._runner = runner
        if not self._model_name:
            raise OpenAIAgentsRuntimeError(
                "sdk_runtime_not_admitted",
                "OpenAI Agents native runtime model_name is required",
            )
        if self._max_turns <= 1:
            raise OpenAIAgentsRuntimeError(
                "sdk_runtime_not_admitted",
                "OpenAI Agents native runtime max_turns must allow a tool call and final answer",
            )

    def run_agent(
        self,
        *,
        agent_request: AgentRequest,
        instruction_profile: AgentsSdkInstructionProfile,
        tool_descriptors: tuple[AgentsSdkToolDescriptor, ...],
        execute_tool: OpenAIAgentsToolExecutor | None = None,
    ) -> OpenAIAgentsRunResult:
        from agents import Agent, ModelSettings, RunConfig, Runner
        from agents.models.openai_provider import OpenAIProvider

        recorded_tool_calls: list[OpenAIAgentsToolCall] = []
        tools = tuple(
            self._function_tool(
                descriptor,
                execute_tool=execute_tool,
                recorded_tool_calls=recorded_tool_calls,
            )
            for descriptor in tool_descriptors
        )
        agent = Agent(
            name=agent_request.target,
            instructions=instruction_profile.instructions.strip(),
            tools=list(tools),
            model=self._model_name,
            model_settings=ModelSettings(
                tool_choice="required" if tools else None,
                parallel_tool_calls=False if tools else None,
                max_tokens=self._provider_config.max_output_tokens,
            ),
        )
        run_config = RunConfig(
            model_provider=OpenAIProvider(
                api_key=self._provider_config.api_key,
                base_url=self._provider_config.base_url,
                use_responses=True,
            ),
            tracing_disabled=True,
            trace_include_sensitive_data=False,
        )
        result = self._run_sync(
            Runner,
            agent,
            agent_request.user_goal,
            context=agent_request.context,
            max_turns=self._max_turns,
            run_config=run_config,
        )
        return OpenAIAgentsRunResult(
            final_output=getattr(result, "final_output", ""),
            tool_calls=tuple(recorded_tool_calls),
            model_response_ref=str(getattr(result, "last_response_id", "") or ""),
        )

    def _run_sync(
        self,
        runner_cls,
        agent,
        input_text: str,
        *,
        context: object,
        max_turns: int,
        run_config,
    ) -> object:
        runner = self._runner or runner_cls.run_sync
        result = runner(
            agent,
            input_text,
            context=context,
            max_turns=max_turns,
            run_config=run_config,
        )
        return result

    def _function_tool(
        self,
        descriptor: AgentsSdkToolDescriptor,
        *,
        execute_tool: OpenAIAgentsToolExecutor | None,
        recorded_tool_calls: list[OpenAIAgentsToolCall],
    ):
        from agents import FunctionTool

        async def invoke_tool(context: object, raw_arguments: str) -> str:
            arguments = _parse_tool_arguments(raw_arguments)
            call_id = str(getattr(context, "tool_call_id", "") or "")
            recorded_tool_calls.append(
                OpenAIAgentsToolCall(
                    name=descriptor.name,
                    arguments=arguments,
                    call_id=call_id,
                )
            )
            if execute_tool is None:
                raise OpenAIAgentsRuntimeError(
                    "sdk_tool_not_executed",
                    "OpenAI Agents native runtime requires a repo-owned tool executor",
                )
            result = execute_tool(
                OpenAIAgentsToolInvocation(
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
        raise OpenAIAgentsRuntimeError(
            "sdk_bad_arguments",
            "OpenAI Agents tool arguments must be valid JSON",
        ) from exc
    if not isinstance(parsed, dict):
        raise OpenAIAgentsRuntimeError(
            "sdk_bad_arguments",
            "OpenAI Agents tool arguments must be a JSON object",
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


__all__ = [
    "OpenAIAgentsNativeRuntime",
    "OpenAIAgentsRunResult",
    "OpenAIAgentsRuntimeError",
    "OpenAIAgentsToolCall",
    "OpenAIAgentsToolExecutor",
    "OpenAIAgentsToolInvocation",
]
