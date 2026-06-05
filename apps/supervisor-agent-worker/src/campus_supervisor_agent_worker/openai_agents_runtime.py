from __future__ import annotations

from collections.abc import Callable, Mapping
from dataclasses import dataclass, field

from campus_contracts import AgentRequest
from campus_prompt_runtime import PromptRuntimeProviderConfig

from campus_supervisor_agent_worker.agents_sdk_function_tools import (
    build_agents_sdk_function_tool,
)
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
        return self.run(
            agent_name=agent_request.target,
            instructions=instruction_profile.instructions,
            input_text=agent_request.user_goal,
            context=agent_request.context,
            tool_descriptors=tool_descriptors,
            execute_tool=execute_tool,
        )

    def run(
        self,
        *,
        agent_name: str,
        instructions: str,
        input_text: str,
        context: object,
        tool_descriptors: tuple[AgentsSdkToolDescriptor, ...],
        execute_tool: OpenAIAgentsToolExecutor | None = None,
        output_type: object | None = None,
    ) -> OpenAIAgentsRunResult:
        from agents import Agent, ModelSettings, RunConfig, Runner
        from agents.models.openai_provider import OpenAIProvider

        recorded_tool_calls: list[OpenAIAgentsToolCall] = []
        tools = tuple(
            build_agents_sdk_function_tool(
                descriptor,
                execute_tool=execute_tool,
                record_tool_call=recorded_tool_calls.append,
            )
            for descriptor in tool_descriptors
        )
        agent = Agent(
            name=agent_name,
            instructions=instructions.strip(),
            tools=list(tools),
            model=self._model_name,
            model_settings=ModelSettings(
                tool_choice="required" if tools else None,
                parallel_tool_calls=False if tools else None,
                max_tokens=self._provider_config.max_output_tokens,
            ),
            output_type=output_type,
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
            input_text,
            context=context,
            max_turns=self._max_turns,
            run_config=run_config,
        )
        return OpenAIAgentsRunResult(
            final_output=getattr(result, "final_output", ""),
            tool_calls=_coerce_result_tool_calls(result) or tuple(recorded_tool_calls),
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
        return runner(
            agent,
            input_text,
            context=context,
            max_turns=max_turns,
            run_config=run_config,
        )


def _coerce_result_tool_calls(result: object) -> tuple[OpenAIAgentsToolCall, ...]:
    raw_calls = getattr(result, "tool_calls", ())
    if raw_calls is None:
        return ()
    if not isinstance(raw_calls, tuple | list):
        return ()
    calls: list[OpenAIAgentsToolCall] = []
    for raw_call in raw_calls:
        call = _coerce_result_tool_call(raw_call)
        if call is not None:
            calls.append(call)
    return tuple(calls)


def _coerce_result_tool_call(value: object) -> OpenAIAgentsToolCall | None:
    if isinstance(value, OpenAIAgentsToolCall):
        return value
    if isinstance(value, Mapping):
        name = str(value.get("name") or "").strip()
        if not name:
            return None
        arguments = value.get("arguments")
        return OpenAIAgentsToolCall(
            name=name,
            arguments=dict(arguments) if isinstance(arguments, Mapping) else {},
            call_id=str(value.get("call_id") or ""),
        )
    name = str(getattr(value, "name", "") or "").strip()
    if not name:
        return None
    arguments = getattr(value, "arguments", {})
    return OpenAIAgentsToolCall(
        name=name,
        arguments=dict(arguments) if isinstance(arguments, Mapping) else {},
        call_id=str(getattr(value, "call_id", "") or ""),
    )


__all__ = [
    "OpenAIAgentsNativeRuntime",
    "OpenAIAgentsRunResult",
    "OpenAIAgentsRuntimeError",
    "OpenAIAgentsToolCall",
    "OpenAIAgentsToolExecutor",
    "OpenAIAgentsToolInvocation",
]
