from __future__ import annotations

import json
import unittest

import httpx
from campus_shared import PromptRuntimeProviderConfig
from campus_supervisor_agent_worker.provider_function_calling import (
    ProviderFunctionToolAdmissionError,
    ProviderFunctionToolRequest,
    ProviderToolLoopResult,
    ResponsesFunctionToolProvider,
    plan_required_provider_function_call,
    run_required_provider_tool_loop,
)


class ProviderFunctionCallingTest(unittest.TestCase):
    def test_plan_required_call_sends_only_allowed_tool_schemas(self) -> None:
        captured_request: ProviderFunctionToolRequest | None = None

        def provider(request: ProviderFunctionToolRequest) -> dict[str, object]:
            nonlocal captured_request
            captured_request = request
            return _responses_function_call(
                name="campus_notice_discover",
                arguments={"query_text": "春假通知"},
                call_id="call-001",
            )

        call = plan_required_provider_function_call(
            user_goal="找春假通知",
            allowed_tools=("campus_notice_discover",),
            provider=provider,
        )

        self.assertIsNotNone(captured_request)
        assert captured_request is not None
        self.assertEqual(
            [tool["name"] for tool in captured_request.tools],
            ["campus_notice_discover"],
        )
        self.assertEqual(call.name, "campus_notice_discover")
        self.assertEqual(call.arguments, {"query_text": "春假通知"})
        self.assertEqual(call.call_id, "call-001")

    def test_plan_required_call_rejects_hallucinated_tool_name(self) -> None:
        def provider(_request: ProviderFunctionToolRequest) -> dict[str, object]:
            return _responses_function_call(
                name="service_status_lookup",
                arguments={"subject_query": "校车"},
                call_id="call-002",
            )

        with self.assertRaisesRegex(ProviderFunctionToolAdmissionError, "service_status_lookup"):
            plan_required_provider_function_call(
                user_goal="找春假通知",
                allowed_tools=("campus_notice_discover",),
                provider=provider,
            )

    def test_plan_required_call_rejects_internal_notice_get_tool(self) -> None:
        with self.assertRaisesRegex(
            ProviderFunctionToolAdmissionError,
            "missing provider function schema for campus_notice_get",
        ):
            plan_required_provider_function_call(
                user_goal="读取这条通知",
                allowed_tools=("campus_notice_get",),
                provider=lambda _request: _responses_function_call(
                    name="campus_notice_get",
                    arguments={"notice_id": "notice:2026-spring"},
                    call_id="call-internal",
                ),
            )

    def test_plan_required_call_rejects_provider_response_without_function_call(self) -> None:
        def provider(_request: ProviderFunctionToolRequest) -> dict[str, object]:
            return {
                "output": [
                    {
                        "type": "message",
                        "content": [{"type": "output_text", "text": "不需要工具"}],
                    }
                ]
            }

        with self.assertRaisesRegex(ProviderFunctionToolAdmissionError, "required function call"):
            plan_required_provider_function_call(
                user_goal="找春假通知",
                allowed_tools=("campus_notice_discover",),
                provider=provider,
            )

    def test_plan_required_call_rejects_non_object_arguments(self) -> None:
        def provider(_request: ProviderFunctionToolRequest) -> dict[str, object]:
            return {
                "output": [
                    {
                        "type": "function_call",
                        "name": "campus_notice_discover",
                        "arguments": json.dumps(["春假通知"]),
                        "call_id": "call-003",
                    }
                ]
            }

        with self.assertRaisesRegex(ProviderFunctionToolAdmissionError, "arguments"):
            plan_required_provider_function_call(
                user_goal="找春假通知",
                allowed_tools=("campus_notice_discover",),
                provider=provider,
            )

    def test_responses_function_tool_provider_posts_required_tool_request(self) -> None:
        captured_request: httpx.Request | None = None

        def handler(request: httpx.Request) -> httpx.Response:
            nonlocal captured_request
            captured_request = request
            return httpx.Response(
                200,
                json=_responses_function_call(
                    name="campus_notice_discover",
                    arguments={"query_text": "春假通知"},
                    call_id="call-http-001",
                ),
            )

        http_client = httpx.Client(
            transport=httpx.MockTransport(handler),
            base_url="https://provider.example/v1",
        )
        provider = ResponsesFunctionToolProvider(
            provider_config=PromptRuntimeProviderConfig(
                provider="openai-responses",
                api_key="sk-test",
                base_url="https://provider.example/v1",
            ),
            model_name="gpt-test",
            http_client=http_client,
        )

        call = plan_required_provider_function_call(
            user_goal="找春假通知",
            allowed_tools=("campus_notice_discover",),
            provider=provider,
        )

        self.assertIsNotNone(captured_request)
        assert captured_request is not None
        body = json.loads(captured_request.content.decode("utf-8"))
        self.assertEqual(captured_request.url.path, "/v1/responses")
        self.assertEqual(captured_request.headers["authorization"], "Bearer sk-test")
        self.assertEqual(body["model"], "gpt-test")
        self.assertEqual(body["tool_choice"], "required")
        self.assertEqual(body["parallel_tool_calls"], False)
        self.assertEqual([tool["name"] for tool in body["tools"]], ["campus_notice_discover"])
        self.assertEqual(body["input"][0]["role"], "user")
        self.assertEqual(body["input"][0]["content"], "找春假通知")
        self.assertEqual(call.call_id, "call-http-001")

    def test_required_tool_loop_submits_bounded_tool_output_with_call_id_for_final_answer(
        self,
    ) -> None:
        captured_requests: list[ProviderFunctionToolRequest] = []

        def provider(request: ProviderFunctionToolRequest) -> dict[str, object]:
            captured_requests.append(request)
            if len(captured_requests) == 1:
                return _responses_function_call(
                    name="campus_notice_discover",
                    arguments={"query_text": "春假通知"},
                    call_id="call-loop-001",
                    response_id="resp-loop-001",
                )
            return _responses_message("已找到春假安排通知。")

        def execute_tool(_name: str, arguments: dict[str, object]) -> dict[str, object]:
            self.assertEqual(arguments, {"query_text": "春假通知"})
            return {
                "outcome": "resolved_current",
                "title": "2026 年春假安排通知",
                "source_ref_count": 1,
            }

        result = run_required_provider_tool_loop(
            user_goal="找春假通知",
            allowed_tools=("campus_notice_discover",),
            provider=provider,
            execute_tool=execute_tool,
        )

        self.assertIsInstance(result, ProviderToolLoopResult)
        self.assertEqual(result.final_answer_text, "已找到春假安排通知。")
        self.assertEqual(result.tool_call.call_id, "call-loop-001")
        self.assertEqual(result.model_response_ref, "resp-loop-001")
        self.assertEqual(len(captured_requests), 2)
        self.assertEqual(captured_requests[0].tool_choice, "required")
        self.assertEqual(captured_requests[0].parallel_tool_calls, False)
        second_input = captured_requests[1].input_items
        self.assertEqual(second_input[-1]["type"], "function_call_output")
        self.assertEqual(second_input[-1]["call_id"], "call-loop-001")
        self.assertIn("resolved_current", str(second_input[-1]["output"]))
        self.assertEqual(captured_requests[1].tool_choice, "none")


def _responses_function_call(
    *,
    name: str,
    arguments: dict[str, object],
    call_id: str,
    response_id: str = "resp-test",
) -> dict[str, object]:
    return {
        "id": response_id,
        "output": [
            {
                "type": "function_call",
                "name": name,
                "arguments": json.dumps(arguments, ensure_ascii=False),
                "call_id": call_id,
            }
        ],
    }


def _responses_message(text: str) -> dict[str, object]:
    return {
        "id": "resp-final",
        "output": [
            {
                "type": "message",
                "content": [{"type": "output_text", "text": text}],
            }
        ],
    }


if __name__ == "__main__":
    unittest.main()
