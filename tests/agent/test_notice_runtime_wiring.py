from __future__ import annotations

import unittest

from campus_contracts import AgentRequest, CampusNoticeDiscoverPayload
from campus_notice_agent.notice_get_runtime import run_notice_get_internal_request
from campus_supervisor_agent_worker.agent_delegates import _notice_missing_query_service_delegate


class NoticeRuntimeWiringTest(unittest.TestCase):
    def test_delegate_requires_explicit_query_service_after_go_runtime_migration(self) -> None:
        response = _notice_missing_query_service_delegate(
            AgentRequest(
                target="notice-agent",
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
            AgentRequest(
                target="notice-agent",
                user_goal="读取通知",
                payload=CampusNoticeDiscoverPayload(query_text="not-a-get"),
            )
        )

        self.assertEqual(response.status, "error")
        self.assertEqual(response.error.code, "internal_query_service_unavailable")


if __name__ == "__main__":
    unittest.main()
