from __future__ import annotations

import unittest

from campus_ingestion_core.authenticated_notice_attachment_fetch_request_manifest import (
    build_authenticated_notice_attachment_fetch_request_manifest,
)


class AuthenticatedNoticeAttachmentFetchRequestManifestTest(unittest.TestCase):
    def test_metadata_only_attachment_refs_are_omitted(self) -> None:
        manifest = build_authenticated_notice_attachment_fetch_request_manifest(
            notice_manifest={
                "site_id": "muc_internal_portal",
                "notice_id": "355929",
                "raw_asset_id": "asset:authenticated-notice:muc_internal_portal:355929",
                "raw_version_id": "sha256:notice-version",
            },
            attachment_refs=(
                {
                    "attachment_ref_id": "attachment-0001",
                    "attachment_capture_policy": "metadata_only",
                    "source_url": "https://portal.example.edu/download?id=qr",
                    "required_source_object": False,
                },
            ),
        )

        self.assertEqual(
            manifest["schema_version"],
            "authenticated_notice_attachment_fetch_request_manifest_v1",
        )
        self.assertEqual(manifest["fetch_request_count"], 0)
        self.assertEqual(manifest["required_source_object_count"], 0)
        self.assertEqual(manifest["requests"], [])

    def test_includes_only_fetch_required_attachment_refs(self) -> None:
        manifest = build_authenticated_notice_attachment_fetch_request_manifest(
            notice_manifest={
                "site_id": "muc_internal_portal",
                "notice_id": "355867",
                "raw_asset_id": "asset:authenticated-notice:muc_internal_portal:355867",
                "raw_version_id": "sha256:schedule-version",
            },
            attachment_refs=(
                {
                    "attachment_ref_id": "attachment-0001",
                    "attachment_capture_policy": "metadata_only",
                    "source_url": "https://portal.example.edu/download?id=supplemental",
                    "required_source_object": False,
                },
                {
                    "attachment_ref_id": "attachment-0002",
                    "attachment_capture_policy": "fetch_to_quarantine",
                    "source_url": "https://portal.example.edu/download?id=schedule-image",
                    "retention_class": "quarantine_candidate",
                    "required_source_object": False,
                    "byte_fetch_required_reason": "service_fact_missing_required_fact",
                },
                {
                    "attachment_ref_id": "attachment-0003",
                    "attachment_capture_policy": "fetch_required_for_source_truth",
                    "source_url": "https://portal.example.edu/download?id=owner-pdf",
                    "retention_class": "permanent_source_truth",
                    "required_source_object": True,
                    "source_object_role": "notice_attachment_source_bytes",
                    "byte_fetch_required_reason": "source_truth_required_attachment",
                },
                {
                    "attachment_ref_id": "attachment-0004",
                    "attachment_capture_policy": "fetch_required_for_admitted_owner",
                    "source_url": "https://portal.example.edu/download?id=admitted-owner",
                    "retention_class": "admitted_source_bytes",
                    "required_source_object": True,
                    "source_object_role": "notice_attachment_source_bytes",
                    "promotion_owner": "regulations/institutional_rules",
                    "promotion_decision_id": "decision-1",
                    "byte_fetch_required_reason": "downstream_owner_admitted",
                },
            ),
        )

        self.assertEqual(manifest["fetch_request_count"], 3)
        self.assertEqual(manifest["required_source_object_count"], 2)
        self.assertEqual(
            [row["attachment_ref_id"] for row in manifest["requests"]],
            ["attachment-0002", "attachment-0003", "attachment-0004"],
        )
        self.assertEqual(
            [row["attachment_capture_policy"] for row in manifest["requests"]],
            [
                "fetch_to_quarantine",
                "fetch_required_for_source_truth",
                "fetch_required_for_admitted_owner",
            ],
        )
        self.assertFalse(manifest["requests"][0]["required_source_object"])
        self.assertTrue(manifest["requests"][1]["required_source_object"])
        self.assertEqual(
            manifest["requests"][2]["promotion_owner"],
            "regulations/institutional_rules",
        )
        self.assertEqual(
            manifest["requests"][2]["collector_admission"],
            {
                "noticeId": "355867",
                "attachmentRefId": "attachment-0004",
                "attachmentCapturePolicy": "fetch_required_for_admitted_owner",
            },
        )

    def test_omits_fetch_policy_refs_when_bytes_are_already_uploaded(self) -> None:
        manifest = build_authenticated_notice_attachment_fetch_request_manifest(
            notice_manifest={
                "site_id": "muc_internal_portal",
                "notice_id": "355867",
                "raw_asset_id": "asset:authenticated-notice:muc_internal_portal:355867",
                "raw_version_id": "sha256:schedule-version",
            },
            attachment_refs=(
                {
                    "attachment_ref_id": "attachment-0001",
                    "attachment_capture_policy": "fetch_to_quarantine",
                    "attachment_capture_state": "uploaded_quarantine",
                    "source_url": "https://portal.example.edu/download?id=schedule-image",
                    "object_key": "authenticated_notice_portal/attachment-a/capture/table.png",
                    "content_sha256": "a" * 64,
                    "retention_class": "quarantine_candidate",
                    "required_source_object": False,
                    "byte_fetch_required": False,
                    "byte_fetch_required_reason": "service_fact_missing_required_fact",
                },
            ),
        )

        self.assertEqual(manifest["fetch_request_count"], 0)
        self.assertEqual(manifest["required_source_object_count"], 0)
        self.assertEqual(manifest["requests"], [])


if __name__ == "__main__":
    unittest.main()
