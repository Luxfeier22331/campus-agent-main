from __future__ import annotations

import unittest

from campus_contracts import CampusNoticeDiscoverPayload, CapabilityRequest
from campus_notice_capability.notice_get_runtime import run_notice_get_internal_request


class NoticeRuntimeWiringTest(unittest.TestCase):
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
