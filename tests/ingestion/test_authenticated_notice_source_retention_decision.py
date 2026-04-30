from __future__ import annotations

import unittest

from campus_ingestion_core.authenticated_notice_source_retention_decision import (
    build_authenticated_notice_source_retention_decision,
)


class AuthenticatedNoticeSourceRetentionDecisionTest(unittest.TestCase):
    def test_notice_level_query_only_keeps_all_attachments_metadata_only(
        self,
    ) -> None:
        decision = build_authenticated_notice_source_retention_decision(
            notice_capture_route="notice_level_query_only",
            attachment_refs=(
                {"attachment_ref_id": "qr", "mime_type": "image/png"},
                {"attachment_ref_id": "guide", "mime_type": "application/zip"},
                {
                    "attachment_ref_id": "summary",
                    "mime_type": "application/vnd.ms-excel",
                },
            ),
        )

        self.assertEqual(decision.notice_capture_route, "notice_level_query_only")
        self.assertEqual(decision.required_source_object_count, 0)
        self.assertEqual(decision.metadata_only_attachment_ref_count, 3)
        self.assertEqual(
            decision.attachment_capture_policy_counts,
            {"metadata_only": 3},
        )
        for attachment in decision.attachment_decisions:
            with self.subTest(attachment_ref_id=attachment.attachment_ref_id):
                self.assertEqual(attachment.attachment_capture_policy, "metadata_only")
                self.assertEqual(attachment.attachment_capture_state, "metadata_recorded")
                self.assertEqual(attachment.retention_class, "metadata_only")
                self.assertFalse(attachment.byte_fetch_required)
                self.assertFalse(attachment.required_source_object)

    def test_service_fact_with_text_complete_keeps_supplemental_image_metadata_only(
        self,
    ) -> None:
        decision = build_authenticated_notice_source_retention_decision(
            notice_capture_route="candidate_service_fact",
            attachment_refs=({"attachment_ref_id": "location-image", "mime_type": "image/png"},),
        )

        attachment = decision.attachment_decisions[0]
        self.assertEqual(attachment.attachment_capture_policy, "metadata_only")
        self.assertEqual(attachment.retention_class, "metadata_only")
        self.assertFalse(attachment.required_source_object)
        self.assertIn("service_fact_text_complete", attachment.reason_codes)

    def test_service_fact_missing_fact_attachment_fetches_to_quarantine_only(
        self,
    ) -> None:
        decision = build_authenticated_notice_source_retention_decision(
            notice_capture_route="candidate_service_fact",
            attachment_refs=(
                {"attachment_ref_id": "schedule-table", "mime_type": "image/png"},
                {"attachment_ref_id": "supplemental-map", "mime_type": "image/png"},
            ),
            missing_fact_attachment_ref_ids=("schedule-table",),
        )

        attachments = {
            attachment.attachment_ref_id: attachment for attachment in decision.attachment_decisions
        }
        self.assertEqual(
            attachments["schedule-table"].attachment_capture_policy,
            "fetch_to_quarantine",
        )
        self.assertEqual(
            attachments["schedule-table"].retention_class,
            "quarantine_candidate",
        )
        self.assertTrue(attachments["schedule-table"].byte_fetch_required)
        self.assertFalse(attachments["schedule-table"].required_source_object)
        self.assertEqual(
            attachments["supplemental-map"].attachment_capture_policy,
            "metadata_only",
        )
        self.assertEqual(decision.required_source_object_count, 0)
        self.assertEqual(decision.quarantine_attachment_ref_count, 1)

    def test_candidate_document_owner_without_admission_keeps_owner_like_ref_metadata_only(
        self,
    ) -> None:
        decision = build_authenticated_notice_source_retention_decision(
            notice_capture_route="candidate_document_owner",
            attachment_refs=(
                {"attachment_ref_id": "finance-manual", "mime_type": "application/pdf"},
            ),
        )

        attachment = decision.attachment_decisions[0]
        self.assertEqual(attachment.attachment_capture_policy, "metadata_only")
        self.assertEqual(attachment.retention_class, "metadata_only")
        self.assertFalse(attachment.byte_fetch_required)
        self.assertFalse(attachment.required_source_object)
        self.assertIn("owner_not_admitted", attachment.reason_codes)

    def test_candidate_document_owner_required_source_truth_marks_required_object(
        self,
    ) -> None:
        decision = build_authenticated_notice_source_retention_decision(
            notice_capture_route="candidate_document_owner",
            attachment_refs=(
                {
                    "attachment_ref_id": "released-file",
                    "mime_type": "application/pdf",
                },
            ),
            source_truth_required_attachment_ref_ids=("released-file",),
        )

        attachment = decision.attachment_decisions[0]
        self.assertEqual(
            attachment.attachment_capture_policy,
            "fetch_required_for_source_truth",
        )
        self.assertEqual(attachment.retention_class, "permanent_source_truth")
        self.assertTrue(attachment.byte_fetch_required)
        self.assertTrue(attachment.required_source_object)
        self.assertEqual(decision.required_source_object_count, 1)

    def test_capture_only_no_adoption_keeps_attachment_metadata_only(self) -> None:
        decision = build_authenticated_notice_source_retention_decision(
            notice_capture_route="capture_only_no_adoption",
            attachment_refs=({"attachment_ref_id": "legacy-file", "mime_type": "application/pdf"},),
        )

        attachment = decision.attachment_decisions[0]
        self.assertEqual(attachment.attachment_capture_policy, "metadata_only")
        self.assertEqual(attachment.attachment_capture_state, "metadata_recorded")
        self.assertEqual(attachment.retention_class, "metadata_only")
        self.assertFalse(attachment.byte_fetch_required)
        self.assertFalse(attachment.required_source_object)
        self.assertIn("capture_only_no_adoption", attachment.reason_codes)


if __name__ == "__main__":
    unittest.main()
