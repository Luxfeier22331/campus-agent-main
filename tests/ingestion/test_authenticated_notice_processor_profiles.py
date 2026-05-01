from __future__ import annotations

import unittest

from campus_ingestion_core.authenticated_notice_processor_profiles import (
    AUTHENTICATED_NOTICE_PROCESSOR_PROFILE_SCHEMA_VERSION,
    get_processor_profile,
    select_processor_profile,
)


class AuthenticatedNoticeProcessorProfilesTest(unittest.TestCase):
    def test_schedule_image_notice_uses_ocr_before_multimodal(self) -> None:
        decision = select_processor_profile(
            source_surface="notice",
            sample_id="355867",
            target_family="transport_schedule",
            media_roles=["schedule_table_carrier"],
            title="关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
        )

        self.assertEqual(
            decision["schema_version"], AUTHENTICATED_NOTICE_PROCESSOR_PROFILE_SCHEMA_VERSION
        )
        self.assertEqual(decision["profile_id"], "image_schedule_notice")
        self.assertEqual(decision["processor_order"][0], "ocr_table_extraction")
        self.assertIn("multimodal_enrichment", decision["processor_order"])
        self.assertEqual(decision["multimodal_policy"], "explicit_escalation_only")
        self.assertIn("sample_355867_image_carried_schedule", decision["reason_codes"])

    def test_text_notice_does_not_select_multimodal_first(self) -> None:
        decision = select_processor_profile(
            source_surface="notice",
            sample_id="355881",
            target_family="transport_schedule",
            media_roles=[],
            title="关于开通丰台校区社会实践专车的通知",
            body_has_target_facts=True,
        )

        self.assertEqual(decision["profile_id"], "text_notice")
        self.assertEqual(decision["processor_order"][0], "text_extraction")
        self.assertNotEqual(decision["processor_order"][0], "multimodal_enrichment")

    def test_profiles_carry_retry_and_resource_budgets(self) -> None:
        profile = get_processor_profile("image_schedule_notice")

        self.assertEqual(profile["profile_id"], "image_schedule_notice")
        self.assertIn("ocr_table_extraction", profile["retry_budget_by_processor"])
        self.assertIn("ocr_table_extraction", profile["resource_budget_by_processor"])
        self.assertGreater(
            int(profile["retry_budget_by_processor"]["ocr_table_extraction"]["max_attempts"]),
            0,
        )


if __name__ == "__main__":
    unittest.main()
