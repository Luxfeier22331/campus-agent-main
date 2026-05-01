from __future__ import annotations

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
from campus_supervisor_agent_worker.provider_tool_runtime_policy import (
    provider_tool_runtime_status,
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
        )

    def discover_notice(self, _query):  # pragma: no cover - adapter must not use discover
        raise AssertionError("closed provider notice runtime must not call discover")


class ProviderToolRuntimeTest(unittest.TestCase):
    def test_notice_get_runtime_requires_explicit_gate(self) -> None:
        provider_called = False

        def provider(_request: ProviderFunctionToolRequest):
            nonlocal provider_called
            provider_called = True
            raise AssertionError("disabled provider runtime must not call provider")

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

    def test_notice_get_runtime_is_closed_even_when_enabled(self) -> None:
        provider_called = False
        query_service = _FakeNoticeGetQueryService()

        def provider(_request: ProviderFunctionToolRequest):
            nonlocal provider_called
            provider_called = True
            raise AssertionError("closed provider runtime must not call provider")

        response = run_notice_get_provider_tool_adapter(
            _notice_get_request(),
            provider=provider,
            query_service=query_service,
            enabled=True,
            finalize_with_provider=True,
        )

        self.assertFalse(provider_called)
        self.assertIsNone(query_service.last_get_query)
        self.assertEqual(response.status, "error")
        self.assertEqual(
            response.error.code if response.error else "", "provider_tool_runtime_failed"
        )
        self.assertIsNotNone(response.agent_observability)
        assert response.agent_observability is not None
        self.assertEqual(response.agent_observability.failure_class, "runtime_closed")
        self.assertEqual(response.agent_observability.selected_tool, "")

    def test_provider_runtime_status_is_closed_for_default_empty_allowed_tools(self) -> None:
        status = provider_tool_runtime_status(
            enabled=True,
            prompt_runtime_admitted=True,
            structured_query_configured=True,
        )

        self.assertFalse(status["admitted"])
        self.assertEqual(status["admission_reason"], "runtime_closed")
        self.assertEqual(status["allowed_tools"], [])
        self.assertFalse(status["schema_available"])
        self.assertEqual(status["runtime_posture"], "closed")

    def test_provider_runtime_status_rejects_stale_notice_get_allowed_tool(self) -> None:
        status = provider_tool_runtime_status(
            enabled=True,
            allowed_tools=("campus_notice_get",),
            prompt_runtime_admitted=True,
            structured_query_configured=True,
        )

        self.assertFalse(status["admitted"])
        self.assertEqual(status["admission_reason"], "unsupported_allowed_tools")
        self.assertEqual(status["allowed_tools"], ["campus_notice_get"])
        self.assertFalse(status["schema_available"])


def _notice_get_request() -> AgentRequest:
    return AgentRequest(
        target="notice-agent",
        user_goal="读取这条通知",
        payload=CampusNoticeGetPayload(notice_id="notice:placeholder"),
        allowed_tools=(),
    )


if __name__ == "__main__":
    unittest.main()
