from __future__ import annotations

import json
import unittest

from campus_contracts import (
    AgentRequest,
    CampusNoticeGetPayload,
    CampusNoticeGetResult,
)
from campus_notice_agent.query_service import NoticeGetQuery
from campus_supervisor_agent_worker.provider_function_calling import (
    ProviderFunctionToolRequest,
)
from campus_supervisor_agent_worker.provider_tool_runtime import (
    run_notice_get_provider_tool_adapter,
)


class _FakeNoticeGetQueryService:
    def __init__(self) -> None:
        self.last_get_query: NoticeGetQuery | None = None

    def get_notice(self, query: NoticeGetQuery) -> CampusNoticeGetResult:
        self.last_get_query = query
        return CampusNoticeGetResult(
            notice_id=query.payload.notice_id,
            outcome="resolved_current",
            title="2026 年春假安排通知",
            source_family="official_web_public_notice",
            source_url="https://campus.example/notices/spring-holiday",
            canonical_url="https://campus.example/notices/spring-holiday",
            normalized_body="春假时间为 5 月 1 日至 5 月 5 日。",
        )

    def discover_notice(self, _query):  # pragma: no cover - adapter must not use discover
        raise AssertionError("provider-native notice get runtime must not call discover")


class ProviderToolRuntimeTest(unittest.TestCase):
    def test_notice_get_runtime_requires_explicit_gate(self) -> None:
        provider_called = False

        def provider(_request: ProviderFunctionToolRequest):
            nonlocal provider_called
            provider_called = True
            return _responses_function_call(
                name="campus_notice_get",
                arguments={},
                call_id="call-disabled",
            )

        response = run_notice_get_provider_tool_adapter(
            _notice_get_request(),
            provider=provider,
            query_service=_FakeNoticeGetQueryService(),
            enabled=False,
        )

        self.assertFalse(provider_called)
        self.assertEqual(response.status, "error")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.failure_class, "runtime_disabled")

    def test_notice_get_runtime_exposes_only_go_allowed_tool_schema(self) -> None:
        captured_request: ProviderFunctionToolRequest | None = None

        def provider(request: ProviderFunctionToolRequest):
            nonlocal captured_request
            captured_request = request
            return _responses_function_call(
                name="campus_notice_get",
                arguments={
                    "notice_id": "notice:2026-spring-holiday",
                    "source_family": "official_web_public_notice",
                },
                call_id="call-notice-get",
            )

        query_service = _FakeNoticeGetQueryService()
        response = run_notice_get_provider_tool_adapter(
            _notice_get_request(),
            provider=provider,
            query_service=query_service,
            enabled=True,
        )

        self.assertEqual(response.status, "completed")
        self.assertIsNotNone(captured_request)
        assert captured_request is not None
        self.assertEqual(
            [tool["name"] for tool in captured_request.tools],
            ["campus_notice_get"],
        )
        self.assertIsNotNone(query_service.last_get_query)
        assert query_service.last_get_query is not None
        self.assertEqual(
            query_service.last_get_query.payload,
            CampusNoticeGetPayload(
                notice_id="notice:2026-spring-holiday",
                source_family="official_web_public_notice",
            ),
        )
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        safe_details = response.agent_observability.safe_details
        provider_projection = safe_details["provider_tool_call_projection"]
        self.assertEqual(provider_projection["tool_call_id_source"], "repo")
        self.assertEqual(provider_projection["model_tool_call_ref"], "call-notice-get")

    def test_notice_get_runtime_can_finalize_answer_with_provider_tool_output(self) -> None:
        captured_requests: list[ProviderFunctionToolRequest] = []

        def provider(request: ProviderFunctionToolRequest):
            captured_requests.append(request)
            if len(captured_requests) == 1:
                return _responses_function_call(
                    name="campus_notice_get",
                    arguments={"notice_id": "notice:2026-spring-holiday"},
                    call_id="call-finalize",
                    response_id="resp-tool",
                )
            return _responses_message("春假安排是 5 月 1 日至 5 月 5 日。")

        response = run_notice_get_provider_tool_adapter(
            _notice_get_request(),
            provider=provider,
            query_service=_FakeNoticeGetQueryService(),
            enabled=True,
            finalize_with_provider=True,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.answer_text, "春假安排是 5 月 1 日至 5 月 5 日。")
        self.assertEqual(len(captured_requests), 2)
        self.assertEqual(captured_requests[1].input_items[-1]["call_id"], "call-finalize")

    def test_notice_get_runtime_rejects_provider_hallucinated_tool(self) -> None:
        def provider(_request: ProviderFunctionToolRequest):
            return _responses_function_call(
                name="campus_notice_discover",
                arguments={"query_text": "春假"},
                call_id="call-wrong-tool",
            )

        response = run_notice_get_provider_tool_adapter(
            _notice_get_request(),
            provider=provider,
            query_service=_FakeNoticeGetQueryService(),
            enabled=True,
        )

        self.assertEqual(response.status, "error")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.failure_class, "provider_wrong_tool")

    def test_notice_get_runtime_rejects_provider_response_without_required_call(self) -> None:
        def provider(_request: ProviderFunctionToolRequest):
            return {
                "output": [{"type": "message", "content": [{"type": "output_text", "text": "x"}]}]
            }

        response = run_notice_get_provider_tool_adapter(
            _notice_get_request(),
            provider=provider,
            query_service=_FakeNoticeGetQueryService(),
            enabled=True,
        )

        self.assertEqual(response.status, "error")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.failure_class, "provider_no_tool_call")

    def test_notice_get_runtime_rejects_invalid_provider_arguments(self) -> None:
        def provider(_request: ProviderFunctionToolRequest):
            return _responses_function_call(
                name="campus_notice_get",
                arguments={"notice_id": ""},
                call_id="call-bad-args",
            )

        response = run_notice_get_provider_tool_adapter(
            _notice_get_request(),
            provider=provider,
            query_service=_FakeNoticeGetQueryService(),
            enabled=True,
        )

        self.assertEqual(response.status, "error")
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.failure_class, "provider_bad_arguments")


def _notice_get_request() -> AgentRequest:
    return AgentRequest(
        target="notice-agent",
        user_goal="读取这条通知",
        payload=CampusNoticeGetPayload(notice_id="notice:placeholder"),
        allowed_tools=("campus_notice_get",),
    )


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
        ]
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
