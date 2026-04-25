from __future__ import annotations

import unittest

from campus_contracts import AgentRequest, CampusNoticeDiscoverPayload
from campus_notice_agent.service import delegate_to_notice_agent


class NoticeRuntimeWiringTest(unittest.TestCase):
    def test_delegate_requires_explicit_query_service_after_go_runtime_migration(self) -> None:
        response = delegate_to_notice_agent(
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
        self.assertEqual(response.error.code, "internal_query_service_unavailable")


if __name__ == "__main__":
    unittest.main()
