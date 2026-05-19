# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.official_web_handoff_consumer_staging_suite_support import *


class OfficialWebHandoffConsumerStagingTestPart01(unittest.TestCase):
    def test_selected_write_candidate_with_complete_inventory_builds_preview_record(
        self,
    ) -> None:
        candidate_key = "owcand_contact_ready"
        review = build_consumer_candidate_review_report(
            replay_report={
                "site_id": "muc_public",
                "crawl_run_id": "owrun_contact_ready",
                "documents": [],
                "consumer_candidate_pages": [
                    {
                        "candidate_key": candidate_key,
                        "consumer_family": "contact_directory_candidate",
                        "materialization_policy": "candidate_only",
                        "selected_write_target": "campus_services/contact_directory",
                        "review_policy": "selected_write_requires_review",
                        "title": "联系我们",
                        "normalized_canonical_url": "https://www.muc.edu.cn/contact",
                        "matched_evidence": ["phone", "email", "location", "office_hours"],
                        "raw_asset_id": "owasset_contact",
                        "raw_version_id": "owver_contact",
                        "target_id": "campus-services-contact-directory",
                        "target_job_id": "owtarget_contact_ready",
                        "typed_candidate_schema_version": (
                            "official_web_contact_directory_candidate.v1"
                        ),
                        "typed_candidate": {
                            "organization_name": "中央民族大学",
                            "phones": ["010-68932442"],
                            "emails": ["webmaster@muc.edu.cn"],
                            "locations": ["北京市海淀区中关村南大街27号"],
                            "office_hours": ["周一至周五 8:00-17:00"],
                            "source_url": "https://www.muc.edu.cn/contact",
                            "source_version_evidence": "owver_contact",
                        },
                        "quality_gate": {"decision": "pass"},
                    }
                ],
            },
            target_inventory_manifest={
                "schema_version": "official_web_target_inventory.v1",
                "site_id": "muc_public",
                "inventory_version": "test_target_inventory_ready",
                "entries": [
                    {
                        "inventory_id": "muc-main-contact",
                        "admission_target_id": "campus-services-contact-directory",
                        "target_label": "学校联系方式",
                        "source_urls": ["https://www.muc.edu.cn/contact"],
                        "required_fields": [
                            "organization_name",
                            "phone",
                            "email",
                            "location",
                            "office_hours",
                            "source_url",
                            "source_version_evidence",
                        ],
                        "required_evidence": [
                            "phone",
                            "email",
                            "location",
                            "office_hours",
                        ],
                    }
                ],
            },
        )

        self.assertEqual(review["selectedWrite"]["decision"], "dry_run_ready")
        self.assertEqual(review["counts"]["selected_write_ready_count"], 1)
        self.assertTrue(review["candidates"][0]["ready_for_selected_write"])
        self.assertIsNone(review["candidates"][0]["blocked_reason"])
        self.assertEqual(
            review["selectedWrite"]["preview_records"][0]["target_collection"],
            "contact_directory",
        )
        self.assertEqual(
            review["selectedWrite"]["preview_records"][0]["inventory_id"],
            "muc-main-contact",
        )

    def test_review_manifest_rejection_blocks_selected_write_preview(self) -> None:
        candidate_key = "owcand_contact_rejected"
        review = build_consumer_candidate_review_report(
            replay_report={
                "site_id": "muc_public",
                "crawl_run_id": "owrun_contact_rejected",
                "documents": [],
                "consumer_candidate_pages": [
                    {
                        "candidate_key": candidate_key,
                        "consumer_family": "contact_directory_candidate",
                        "materialization_policy": "candidate_only",
                        "selected_write_target": "campus_services/contact_directory",
                        "review_policy": "selected_write_requires_review",
                        "title": "联系我们",
                        "normalized_canonical_url": "https://www.muc.edu.cn/contact",
                        "matched_evidence": ["phone", "email", "location", "office_hours"],
                        "raw_asset_id": "owasset_contact",
                        "raw_version_id": "owver_contact",
                        "target_id": "campus-services-contact-directory",
                        "target_job_id": "owtarget_contact_rejected",
                        "typed_candidate_schema_version": (
                            "official_web_contact_directory_candidate.v1"
                        ),
                        "typed_candidate": {
                            "organization_name": "中央民族大学",
                            "phones": ["010-68932442"],
                            "emails": ["webmaster@muc.edu.cn"],
                            "locations": ["北京市海淀区中关村南大街27号"],
                            "office_hours": ["周一至周五 8:00-17:00"],
                            "source_url": "https://www.muc.edu.cn/contact",
                            "source_version_evidence": "owver_contact",
                        },
                        "quality_gate": {"decision": "pass"},
                    }
                ],
            },
            consumer_review_manifest={
                "schema_version": "official_web_selected_write_review_manifest.v1",
                "site_id": "muc_public",
                "run_id": "owrun_contact_rejected",
                "verdicts": [
                    {
                        "candidate_key": candidate_key,
                        "verdict": "rejected",
                        "reviewer": "operator",
                    }
                ],
            },
            target_inventory_manifest={
                "schema_version": "official_web_target_inventory.v1",
                "site_id": "muc_public",
                "inventory_version": "test_target_inventory_rejected",
                "entries": [
                    {
                        "inventory_id": "muc-main-contact",
                        "admission_target_id": "campus-services-contact-directory",
                        "source_urls": ["https://www.muc.edu.cn/contact"],
                        "required_fields": [
                            "organization_name",
                            "phone",
                            "email",
                            "location",
                            "office_hours",
                            "source_url",
                            "source_version_evidence",
                        ],
                        "required_evidence": [
                            "phone",
                            "email",
                            "location",
                            "office_hours",
                        ],
                    }
                ],
            },
        )

        self.assertEqual(review["selectedWrite"]["decision"], "no_ready_records")
        self.assertEqual(review["selectedWrite"]["reason"], "all_candidates_rejected")
        self.assertEqual(review["counts"]["selected_write_rejected_count"], 1)
        self.assertEqual(review["candidates"][0]["admission_action"], "selected_write_rejected")
        self.assertFalse(review["candidates"][0]["ready_for_selected_write"])
        self.assertEqual(review["selectedWrite"]["preview_records"], [])


if __name__ == "__main__":
    unittest.main()
