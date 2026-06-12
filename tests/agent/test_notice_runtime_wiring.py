from __future__ import annotations

import unittest

from campus_contracts import CampusNoticeDiscoverPayload, CapabilityRequest
from campus_notice_capability.notice_get_runtime import run_notice_get_internal_request
from campus_supervisor_agent_worker.capability_delegates import _build_capability_delegates
from campus_supervisor_agent_worker.settings import ApiSettings


class NoticeRuntimeWiringTest(unittest.TestCase):
    def test_notice_delegate_fails_closed_without_internal_query_service(self) -> None:
        delegates = _build_capability_delegates(
            settings=ApiSettings(agents_sdk_runtime_enabled=True),
            rag_prompt_executor=None,
            campus_services_query_service=None,
            notice_query_service=None,
            openai_agents_runtime=None,
            rag_openai_runtime=None,
        )
        response = delegates["notice"](
            CapabilityRequest(
                capability="notice",
                user_goal="找采购通知",
                payload=CampusNoticeDiscoverPayload(
                    query_text="家具采购",
                    source_families=("internal_notice_restricted",),
                ),
                allowed_tools=("campus_notice_discover",),
            )
        )

        self.assertEqual(response.status, "error")
        self.assertEqual(response.error.code, "agents_sdk_runtime_failed")

    def test_internal_notice_get_runtime_requires_explicit_query_service(self) -> None:
        response = run_notice_get_internal_request(
            CapabilityRequest(
                capability="notice",
                user_goal="读取通知",
                payload=CampusNoticeDiscoverPayload(query_text="not-a-get"),
            )
        )

        self.assertEqual(response.status, "error")
        self.assertEqual(response.error.code, "internal_query_service_unavailable")


if __name__ == "__main__":
    unittest.main()
