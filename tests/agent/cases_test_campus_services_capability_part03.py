# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.agent.test_campus_services_capability_support import *


class CampusServicesAgentTestPart03(unittest.TestCase):
    def test_capability_response_explains_field_not_provided_by_source(self) -> None:
        response = service_guide_response(
            ServiceGuideLookupResult(
                service_query="公费医疗报销联系电话是多少",
                guide_focus="contact",
                outcome="temporarily_unverifiable",
                fail_close_reason="field_not_provided_by_source",
                field_status={"contact": "source_not_provided"},
            )
        )

        self.assertIn("当前来源未提供联系方式", response.answer_text)
        self.assertEqual(
            response.capability_observability.safe_details["field_status"],
            {"contact": "source_not_provided"},
        )

    def test_capability_response_explains_entry_url_not_provided_by_source(self) -> None:
        response = service_guide_response(
            ServiceGuideLookupResult(
                service_query="校历链接是什么",
                guide_focus="entry",
                outcome="temporarily_unverifiable",
                fail_close_reason="field_not_provided_by_source",
                field_status={"service_entry": "source_not_provided"},
            )
        )

        self.assertIn("入口链接", response.answer_text)
        self.assertNotIn("办理指南", response.answer_text)


if __name__ == "__main__":
    unittest.main()
