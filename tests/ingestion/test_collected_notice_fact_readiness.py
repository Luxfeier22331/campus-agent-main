from __future__ import annotations

import unittest

from campus_ingestion_core.collected_notice_fact_readiness import (
    FACT_READINESS_BLOCKED_BY_REQUIRED_MEDIA,
    FACT_READINESS_READY_FROM_TEXT,
    TARGET_ADMISSION_NEEDS_MULTIMODAL,
    TARGET_ADMISSION_STAGE_READY,
    build_transport_schedule_fact_readiness,
)


class CollectedNoticeFactReadinessTests(unittest.TestCase):
    def test_transport_schedule_body_rows_make_target_ready_despite_pending_supplemental_image(
        self,
    ) -> None:
        readiness = build_transport_schedule_fact_readiness(
            unit={
                "unit_id": "searchable:notice:muc_internal_portal:355881",
                "source_notice_id": "355881",
                "title": "关于开通丰台校区社会实践专车的通知",
                "multimodal_status": "pending",
            },
            multimodal_candidate_inventory={
                "candidates": [
                    {
                        "unit_id": "searchable:notice:muc_internal_portal:355881",
                        "status": "pending",
                        "media_kind": "image",
                    }
                ]
            },
            text_schedule_row_count=7,
        )

        self.assertEqual(readiness["fact_readiness_state"], FACT_READINESS_READY_FROM_TEXT)
        self.assertEqual(readiness["target_admission_state"], TARGET_ADMISSION_STAGE_READY)
        self.assertIn("body_facts_complete", readiness["reason_codes"])
        self.assertIn("supplemental_media_pending", readiness["reason_codes"])
        self.assertFalse(readiness["blocking_media"])

    def test_transport_schedule_missing_rows_with_pending_schedule_image_requires_multimodal(
        self,
    ) -> None:
        readiness = build_transport_schedule_fact_readiness(
            unit={
                "unit_id": "searchable:notice:muc_internal_portal:355867",
                "source_notice_id": "355867",
                "title": "关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
                "multimodal_status": "pending",
            },
            multimodal_candidate_inventory={
                "candidates": [
                    {
                        "unit_id": "searchable:notice:muc_internal_portal:355867",
                        "status": "pending",
                        "media_kind": "image",
                        "processing_family": "schedule_image_ocr",
                    }
                ]
            },
            text_schedule_row_count=0,
        )

        self.assertEqual(
            readiness["fact_readiness_state"],
            FACT_READINESS_BLOCKED_BY_REQUIRED_MEDIA,
        )
        self.assertEqual(
            readiness["target_admission_state"],
            TARGET_ADMISSION_NEEDS_MULTIMODAL,
        )
        self.assertIn("required_media_pending", readiness["reason_codes"])
        self.assertTrue(readiness["blocking_media"])

    def test_media_text_status_and_candidate_target_blocking_drive_readiness(self) -> None:
        readiness = build_transport_schedule_fact_readiness(
            unit={
                "unit_id": "searchable:notice:muc_internal_portal:355867",
                "source_notice_id": "355867",
                "title": "关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
                "media_text_status": "pending",
                "multimodal_status": "not_required",
            },
            multimodal_candidate_inventory={
                "candidates": [
                    {
                        "unit_id": "searchable:notice:muc_internal_portal:355867",
                        "status": "pending",
                        "media_kind": "image",
                        "media_role": "schedule_table_carrier",
                        "processing_family": "schedule_image_ocr",
                        "target_blocking": True,
                    }
                ]
            },
            text_schedule_row_count=0,
        )

        self.assertEqual(
            readiness["fact_readiness_state"],
            FACT_READINESS_BLOCKED_BY_REQUIRED_MEDIA,
        )
        self.assertEqual(
            readiness["target_admission_state"],
            TARGET_ADMISSION_NEEDS_MULTIMODAL,
        )
        self.assertEqual(readiness["blocking_media"][0]["media_role"], "schedule_table_carrier")

    def test_candidate_target_blocking_overrides_media_role_inference(self) -> None:
        readiness = build_transport_schedule_fact_readiness(
            unit={
                "unit_id": "searchable:notice:muc_internal_portal:355867",
                "source_notice_id": "355867",
                "title": "关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
                "media_text_status": "pending",
                "multimodal_status": "not_required",
            },
            multimodal_candidate_inventory={
                "candidates": [
                    {
                        "unit_id": "searchable:notice:muc_internal_portal:355867",
                        "status": "pending",
                        "media_kind": "image",
                        "media_role": "schedule_table_carrier",
                        "processing_family": "schedule_image_ocr",
                        "target_blocking": True,
                    }
                ]
            },
            text_schedule_row_count=0,
        )

        self.assertEqual(
            readiness["target_admission_state"],
            TARGET_ADMISSION_NEEDS_MULTIMODAL,
        )
        self.assertEqual(readiness["media_states"][0]["media_role"], "schedule_table_carrier")
        self.assertTrue(readiness["media_states"][0]["target_blocking"])

    def test_unit_pending_without_target_blocking_candidate_does_not_require_multimodal(
        self,
    ) -> None:
        readiness = build_transport_schedule_fact_readiness(
            unit={
                "unit_id": "searchable:notice:muc_internal_portal:legacy",
                "source_notice_id": "legacy",
                "title": "旧版兼容 pending 状态",
                "media_text_status": "pending",
                "multimodal_status": "pending",
            },
            multimodal_candidate_inventory={"candidates": []},
            text_schedule_row_count=0,
        )

        self.assertEqual(readiness["fact_readiness_state"], "missing")
        self.assertEqual(readiness["target_admission_state"], "defer")
        self.assertEqual(readiness["media_states"], [])
        self.assertEqual(readiness["blocking_media"], [])

    def test_target_blocking_manual_review_requires_manual_review_not_multimodal(self) -> None:
        readiness = build_transport_schedule_fact_readiness(
            unit={
                "unit_id": "searchable:notice:muc_internal_portal:355867",
                "source_notice_id": "355867",
                "title": "关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
                "media_text_status": "manual_review",
                "multimodal_status": "manual_review",
            },
            multimodal_candidate_inventory={
                "candidates": [
                    {
                        "unit_id": "searchable:notice:muc_internal_portal:355867",
                        "status": "manual_review",
                        "media_kind": "image",
                        "media_role": "schedule_table_carrier",
                        "target_blocking": True,
                    }
                ]
            },
            text_schedule_row_count=0,
        )

        self.assertEqual(readiness["fact_readiness_state"], "review_required")
        self.assertEqual(readiness["target_admission_state"], "manual_review")
        self.assertEqual(readiness["blocking_media"][0]["media_state"], "manual_review")

    def test_non_boolean_candidate_target_blocking_fails_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "target_blocking must be a boolean"):
            build_transport_schedule_fact_readiness(
                unit={
                    "unit_id": "searchable:notice:muc_internal_portal:355867",
                    "source_notice_id": "355867",
                    "title": "关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
                },
                multimodal_candidate_inventory={
                    "candidates": [
                        {
                            "unit_id": "searchable:notice:muc_internal_portal:355867",
                            "status": "pending",
                            "media_kind": "image",
                            "media_role": "schedule_table_carrier",
                            "target_blocking": "false",
                        }
                    ]
                },
                text_schedule_row_count=0,
            )


if __name__ == "__main__":
    unittest.main()
