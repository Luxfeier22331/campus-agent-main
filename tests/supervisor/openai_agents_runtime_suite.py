from __future__ import annotations

import asyncio
import unittest

from campus_contracts import AgentRequest, CampusNoticeDiscoverPayload
from campus_shared import PromptRuntimeProviderConfig
from campus_supervisor_agent_worker.agents_sdk_instruction_profiles import (
    instruction_profile_for_request,
)
from campus_supervisor_agent_worker.agents_sdk_tool_bridge import (
    build_agents_sdk_tool_descriptors,
)
from campus_supervisor_agent_worker.openai_agents_runtime import (
    OpenAIAgentsNativeRuntime,
    OpenAIAgentsRuntimeError,
    OpenAIAgentsToolInvocation,
)


class OpenAIAgentsNativeRuntimeTest(unittest.TestCase):
    def test_runtime_builds_official_agent_and_disables_sensitive_tracing(self) -> None:
        captures: list[dict[str, object]] = []
        runtime = OpenAIAgentsNativeRuntime(
            provider_config=_provider_config(max_output_tokens=512),
            model_name="gpt-5.4-mini",
            runner=_capturing_runner(
                captures,
                final_output="已找到相关通知。",
                last_response_id="resp-native-001",
            ),
        )
        request = _notice_request()

        result = runtime.run_agent(
            agent_request=request,
            instruction_profile=instruction_profile_for_request(request),
            tool_descriptors=build_agents_sdk_tool_descriptors(request.allowed_tools),
            execute_tool=lambda invocation: {
                "status": "completed",
                "query_text": invocation.arguments["query_text"],
            },
        )

        captured = captures[-1]
        agent = captured["agent"]
        run_config = captured["run_config"]
        self.assertEqual(agent.name, "notice-agent")
        self.assertEqual(agent.model, "gpt-5.4-mini")
        self.assertIn("notice-agent card-search runtime", agent.instructions)
        self.assertEqual([tool.name for tool in agent.tools], ["campus_notice_discover"])
        self.assertEqual(agent.model_settings.tool_choice, "required")
        self.assertFalse(agent.model_settings.parallel_tool_calls)
        self.assertEqual(agent.model_settings.max_tokens, 512)
        self.assertEqual(captured["input_text"], "找春假通知")
        self.assertIs(captured["context"], request.context)
        self.assertEqual(captured["max_turns"], 3)
        self.assertTrue(run_config.tracing_disabled)
        self.assertFalse(run_config.trace_include_sensitive_data)
        self.assertEqual(result.final_output, "已找到相关通知。")
        self.assertEqual(result.model_response_ref, "resp-native-001")

    def test_runtime_does_not_expose_test_capture_state_on_production_instance(self) -> None:
        runtime = OpenAIAgentsNativeRuntime(
            provider_config=_provider_config(),
            model_name="gpt-5.4-mini",
            runner=_capturing_runner(
                [],
                final_output="unused",
                last_response_id="unused",
            ),
        )

        self.assertFalse(hasattr(runtime, "runner_captures"))

    def test_runtime_function_tool_invokes_repo_owned_executor(self) -> None:
        seen_invocations: list[OpenAIAgentsToolInvocation] = []
        request = _notice_request()

        def runner(agent, input_text, *, context, max_turns, run_config):
            _ = input_text, context, max_turns, run_config

            class ToolContext:
                tool_call_id = "call-native-001"

            tool_output = asyncio.run(
                agent.tools[0].on_invoke_tool(
                    ToolContext(),
                    '{"query_text":"春假通知"}',
                )
            )
            self.assertIn("resolved_current", tool_output)
            return _FakeRunResult(
                final_output="已按通知卡片回答。",
                last_response_id="resp-native-tool-001",
            )

        runtime = OpenAIAgentsNativeRuntime(
            provider_config=_provider_config(),
            model_name="gpt-5.4-mini",
            runner=runner,
        )

        result = runtime.run_agent(
            agent_request=request,
            instruction_profile=instruction_profile_for_request(request),
            tool_descriptors=build_agents_sdk_tool_descriptors(request.allowed_tools),
            execute_tool=lambda invocation: _record_invocation(invocation, seen_invocations),
        )

        self.assertEqual(result.final_output, "已按通知卡片回答。")
        self.assertEqual(len(result.tool_calls), 1)
        self.assertEqual(result.tool_calls[0].name, "campus_notice_discover")
        self.assertEqual(result.tool_calls[0].call_id, "call-native-001")
        self.assertEqual(seen_invocations[0].name, "campus_notice_discover")
        self.assertEqual(seen_invocations[0].arguments, {"query_text": "春假通知"})

    def test_runtime_preserves_explicit_runner_tool_calls_when_present(self) -> None:
        request = _notice_request()

        class RunResultWithToolCalls:
            final_output = "已找到相关通知。"
            last_response_id = "resp-explicit-tool-call"
            tool_calls = (
                {
                    "name": "campus_notice_discover",
                    "arguments": {"query_text": "春假通知"},
                    "call_id": "call-explicit-001",
                },
            )

        runtime = OpenAIAgentsNativeRuntime(
            provider_config=_provider_config(),
            model_name="gpt-5.4-mini",
            runner=lambda *args, **kwargs: RunResultWithToolCalls(),
        )

        result = runtime.run_agent(
            agent_request=request,
            instruction_profile=instruction_profile_for_request(request),
            tool_descriptors=build_agents_sdk_tool_descriptors(request.allowed_tools),
            execute_tool=lambda invocation: {
                "status": "completed",
                "query_text": invocation.arguments["query_text"],
            },
        )

        self.assertEqual(len(result.tool_calls), 1)
        self.assertEqual(result.tool_calls[0].name, "campus_notice_discover")
        self.assertEqual(result.tool_calls[0].call_id, "call-explicit-001")
        self.assertEqual(result.tool_calls[0].arguments, {"query_text": "春假通知"})

    def test_runtime_supports_generic_structured_output_runs(self) -> None:
        captures: list[dict[str, object]] = []
        runtime = OpenAIAgentsNativeRuntime(
            provider_config=_provider_config(max_output_tokens=256),
            model_name="gpt-5.4-mini",
            runner=_capturing_runner(
                captures,
                final_output={"answer_text": "本科生可申请国家奖学金。", "confidence": "medium"},
                last_response_id="resp-generic-001",
            ),
        )

        result = runtime.run(
            agent_name="rag-agent-native-runtime",
            instructions="Use only the supplied retrieve_evidence tool.",
            input_text="有哪些本科生可以申请的奖学金",
            context={"request_id": "req-rag-sdk-001"},
            tool_descriptors=build_agents_sdk_tool_descriptors(("retrieve_evidence",)),
            output_type=dict,
            execute_tool=lambda invocation: {
                "status": "completed",
                "query_slot_id": invocation.arguments.get("query_slot_id", ""),
            },
        )

        captured = captures[-1]
        agent = captured["agent"]
        self.assertEqual(agent.name, "rag-agent-native-runtime")
        self.assertEqual(agent.model, "gpt-5.4-mini")
        self.assertIs(agent.output_type, dict)
        self.assertEqual(captured["input_text"], "有哪些本科生可以申请的奖学金")
        self.assertEqual(captured["context"], {"request_id": "req-rag-sdk-001"})
        self.assertEqual(
            result.final_output, {"answer_text": "本科生可申请国家奖学金。", "confidence": "medium"}
        )
        self.assertEqual(result.model_response_ref, "resp-generic-001")

    def test_runtime_rejects_missing_model_name(self) -> None:
        with self.assertRaisesRegex(OpenAIAgentsRuntimeError, "model_name is required") as caught:
            OpenAIAgentsNativeRuntime(
                provider_config=_provider_config(),
                model_name="",
            )

        self.assertEqual(caught.exception.failure_class, "sdk_runtime_not_admitted")

    def test_runtime_rejects_max_turns_that_cannot_execute_tool_and_final_answer(self) -> None:
        with self.assertRaisesRegex(OpenAIAgentsRuntimeError, "max_turns") as caught:
            OpenAIAgentsNativeRuntime(
                provider_config=_provider_config(),
                model_name="gpt-5.4-mini",
                max_turns=1,
            )

        self.assertEqual(caught.exception.failure_class, "sdk_runtime_not_admitted")


class _FakeRunResult:
    def __init__(self, *, final_output: object, last_response_id: str) -> None:
        self.final_output = final_output
        self.last_response_id = last_response_id


def _capturing_runner(
    captures: list[dict[str, object]],
    *,
    final_output: object,
    last_response_id: str,
):
    def runner(agent, input_text, *, context, max_turns, run_config):
        captures.append(
            {
                "agent": agent,
                "input_text": input_text,
                "context": context,
                "max_turns": max_turns,
                "run_config": run_config,
            }
        )
        return _FakeRunResult(final_output=final_output, last_response_id=last_response_id)

    return runner


def _record_invocation(
    invocation: OpenAIAgentsToolInvocation,
    seen_invocations: list[OpenAIAgentsToolInvocation],
) -> dict[str, object]:
    seen_invocations.append(invocation)
    return {
        "status": "completed",
        "outcome": "resolved_current",
        "query_text": invocation.arguments["query_text"],
    }


def _notice_request() -> AgentRequest:
    return AgentRequest(
        target="notice-agent",
        user_goal="找春假通知",
        request_id="req-native-sdk-001",
        payload=CampusNoticeDiscoverPayload(query_text="春假通知"),
        allowed_tools=("campus_notice_discover",),
    )


def _provider_config(max_output_tokens: int | None = None) -> PromptRuntimeProviderConfig:
    return PromptRuntimeProviderConfig(
        provider="openai",
        transport="responses",
        api_key="test-key",
        base_url="https://api.openai.com/v1",
        max_output_tokens=max_output_tokens,
    )


if __name__ == "__main__":
    unittest.main()
