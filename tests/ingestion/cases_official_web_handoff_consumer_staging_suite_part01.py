# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.official_web_handoff_consumer_staging_suite_support import *


class OfficialWebHandoffConsumerStagingTestPart01(unittest.TestCase):
    def test_legacy_excluded_run_blocks_selected_write_even_with_approved_review(
        self,
    ) -> None:
        candidate_key = "owcand_legacy_excluded_contact"

        review = build_consumer_candidate_review_report(
            replay_report={
                "site_id": "campus_public",
                "crawl_run_id": "owrun_legacy_excluded",
                "documents": [],
                "consumer_candidate_pages": [
                    {
                        "candidate_key": candidate_key,
                        "consumer_family": "contact_directory_candidate",
                        "materialization_policy": "candidate_only",
                        "selected_write_target": "campus_services/contact_directory",
                        "review_policy": "selected_write_requires_review",
                        "title": "联系我们",
                        "normalized_canonical_url": "https://www.example.edu/contact",
                        "matched_evidence": ["phone", "location"],
                        "raw_asset_id": "owasset_contact",
                        "raw_version_id": "owver_contact",
                        "typed_candidate_schema_version": "contact_directory_candidate.v1",
                        "typed_candidate": {
                            "display_name": "办公室",
                            "phone": "010-68933381",
                        },
                        "quality_gate": {"decision": "pass"},
                    }
                ],
            },
            consumer_review_manifest={
                "schema_version": "official_web_selected_write_review_manifest.v1",
                "site_id": "campus_public",
                "run_id": "owrun_legacy_excluded",
                "verdicts": [
                    {
                        "candidate_key": candidate_key,
                        "verdict": "approved",
                    }
                ],
            },
            run_admission_decision={
                "decision": "legacy_contract_excluded",
                "reasonCode": "pre_target_workset_contract",
                "runId": "owrun_legacy_excluded",
                "siteId": "campus_public",
            },
        )

        self.assertEqual(review["selectedWrite"]["decision"], "blocked")
        self.assertEqual(review["selectedWrite"]["reason"], "run_admission_decision_excluded")
        self.assertEqual(review["counts"]["selected_write_ready_count"], 0)
        self.assertFalse(review["candidates"][0]["ready_for_selected_write"])
        self.assertEqual(
            review["candidates"][0]["blocked_reason"],
            "run_admission_decision_excluded",
        )

    def test_consumer_candidate_review_reports_target_inventory_field_status(
        self,
    ) -> None:
        candidate_key = "owcand_service_guide_fields"

        review = build_consumer_candidate_review_report(
            replay_report={
                "site_id": "muc_public",
                "crawl_run_id": "owrun_field_review",
                "documents": [],
                "consumer_candidate_pages": [
                    {
                        "candidate_key": candidate_key,
                        "consumer_family": "service_guide_candidate",
                        "materialization_policy": "candidate_only",
                        "selected_write_target": "campus_services/service_guide",
                        "review_policy": "selected_write_requires_review",
                        "title": "依申请公开工作流程",
                        "normalized_canonical_url": "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                        "matched_evidence": ["service_process", "service_material"],
                        "raw_asset_id": "owasset_service",
                        "raw_version_id": "owver_service",
                        "target_id": "campus-services-service-guide",
                        "target_job_id": "owtarget_muc_public_service",
                        "typed_candidate_schema_version": "official_web_service_guide_candidate.v1",
                        "typed_candidate": {
                            "service_name": "依申请公开工作流程",
                            "process_steps": ["1. 申请人提交信息公开申请。"],
                            "materials": ["申请表"],
                            "entry_points": [],
                            "contacts": {"phones": [], "emails": [], "locations": []},
                            "source_url": "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                        },
                        "quality_gate": {"decision": "pass"},
                    }
                ],
            },
            target_inventory_manifest={
                "schema_version": "official_web_target_inventory.v1",
                "site_id": "muc_public",
                "inventory_version": "test_target_inventory_v1",
                "entries": [
                    {
                        "inventory_id": "muc-information-disclosure-application-process",
                        "admission_target_id": "campus-services-service-guide",
                        "source_urls": ["https://xxgk.muc.edu.cn/info/1007/1113.htm"],
                        "required_fields": [
                            "service_name",
                            "process_steps",
                            "source_url",
                            "source_version_evidence",
                        ],
                        "optional_fields": [
                            "service_entry",
                            "required_materials",
                            "responsible_office",
                            "phone",
                            "location",
                            "office_hours",
                        ],
                        "optional_evidence": [
                            "service_entry",
                            "service_material",
                            "phone",
                            "location",
                            "office_hours",
                        ],
                        "required_evidence": ["service_process"],
                    }
                ],
            },
        )

        candidate = review["candidates"][0]
        self.assertEqual(
            candidate["inventory_id"],
            "muc-information-disclosure-application-process",
        )
        self.assertEqual(
            candidate["field_status"],
            {
                "service_name": "present",
                "process_steps": "present",
                "service_process": "present",
                "service_entry": "source_not_provided",
                "service_material": "present",
                "required_materials": "present",
                "responsible_office": "source_not_provided",
                "phone": "source_not_provided",
                "location": "source_not_provided",
                "office_hours": "source_not_provided",
                "source_url": "present",
                "source_version_evidence": "present",
            },
        )
        self.assertEqual(
            review["targetFieldReviews"],
            [
                {
                    "canonicalVerification": False,
                    "jobId": "owtarget_muc_public_service",
                    "runId": "owrun_field_review",
                    "sourceHandoffId": None,
                    "status": "ready_for_selected_write",
                    "summary": {
                        "schemaVersion": "official_web_target_field_review.v1",
                        "candidateKey": candidate_key,
                        "consumerFamily": "service_guide_candidate",
                        "fieldStatus": candidate["field_status"],
                        "inventoryId": "muc-information-disclosure-application-process",
                        "normalizedCanonicalUrl": "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                        "optionalEvidence": [
                            "service_entry",
                            "service_material",
                            "phone",
                            "location",
                            "office_hours",
                        ],
                        "optionalFields": [
                            "service_entry",
                            "required_materials",
                            "responsible_office",
                            "phone",
                            "location",
                            "office_hours",
                            "service_material",
                        ],
                        "readyForSelectedWrite": True,
                        "requiredFields": [
                            "service_name",
                            "process_steps",
                            "source_url",
                            "source_version_evidence",
                            "service_process",
                        ],
                        "requiredEvidence": ["service_process"],
                        "reviewVerdict": "pending_review",
                        "selectedWriteTarget": "campus_services/service_guide",
                        "sourceRef": {
                            "source_channel": "official_web",
                            "raw_asset_id": "owasset_service",
                            "raw_version_id": "owver_service",
                            "normalized_canonical_url": "https://xxgk.muc.edu.cn/info/1007/1113.htm",
                        },
                        "targetId": "campus-services-service-guide",
                    },
                }
            ],
        )

    def test_machine_field_review_marks_complete_candidate_ready_without_manual_approval(
        self,
    ) -> None:
        candidate_key = "owcand_machine_ready_contact"

        review = build_consumer_candidate_review_report(
            replay_report={
                "site_id": "muc_public",
                "crawl_run_id": "owrun_machine_ready",
                "documents": [],
                "consumer_candidate_pages": [
                    {
                        "candidate_key": candidate_key,
                        "consumer_family": "contact_directory_candidate",
                        "materialization_policy": "candidate_only",
                        "selected_write_target": "campus_services/contact_directory",
                        "review_policy": "selected_write_requires_review",
                        "title": "联系我们",
                        "normalized_canonical_url": "https://www.muc.edu.cn/",
                        "matched_evidence": ["phone", "location"],
                        "raw_asset_id": "owasset_contact",
                        "raw_version_id": "owver_contact",
                        "target_id": "campus-services-contact-directory",
                        "target_job_id": "owtarget_muc_public_contact",
                        "typed_candidate_schema_version": "official_web_contact_directory_candidate.v1",
                        "typed_candidate": {
                            "display_name": "中央民族大学",
                            "phones": ["010-68932442"],
                            "emails": [],
                            "locations": ["北京市海淀区中关村南大街27号"],
                            "office_hours": [],
                            "source_url": "https://www.muc.edu.cn/",
                        },
                        "quality_gate": {"decision": "pass"},
                    }
                ],
            },
            target_inventory_manifest={
                "schema_version": "official_web_target_inventory.v1",
                "site_id": "muc_public",
                "inventory_version": "test_target_inventory_v2",
                "entries": [
                    {
                        "inventory_id": "muc-main-homepage-contact",
                        "admission_target_id": "campus-services-contact-directory",
                        "source_urls": ["https://www.muc.edu.cn/"],
                        "required_fields": [
                            "organization_name",
                            "phone",
                            "source_url",
                            "source_version_evidence",
                        ],
                        "optional_fields": ["email", "location", "office_hours"],
                        "optional_evidence": ["email", "location", "office_hours"],
                        "required_evidence": ["phone"],
                    }
                ],
            },
        )

        self.assertEqual(review["selectedWrite"]["decision"], "dry_run_ready")
        self.assertEqual(review["selectedWrite"]["reason"], "machine_field_review_passed")
        self.assertEqual(review["counts"]["selected_write_ready_count"], 1)
        self.assertEqual(review["counts"]["selected_write_pending_count"], 0)
        self.assertEqual(review["candidates"][0]["review_verdict"], "pending_review")
        self.assertTrue(review["candidates"][0]["ready_for_selected_write"])
        self.assertEqual(
            review["candidates"][0]["field_status"],
            {
                "organization_name": "present",
                "phone": "present",
                "source_url": "present",
                "source_version_evidence": "present",
                "email": "source_not_provided",
                "location": "present",
                "office_hours": "source_not_provided",
            },
        )
        self.assertEqual(
            review["targetFieldReviews"][0]["status"],
            "ready_for_selected_write",
        )

    def test_machine_field_review_marks_academic_calendar_candidate_ready(self) -> None:
        candidate_key = "owcand_academic_calendar_ready"

        review = build_consumer_candidate_review_report(
            replay_report={
                "site_id": "muc_public",
                "crawl_run_id": "owrun_calendar_ready",
                "documents": [],
                "consumer_candidate_pages": [
                    {
                        "candidate_key": candidate_key,
                        "consumer_family": "academic_calendar_candidate",
                        "materialization_policy": "candidate_only",
                        "selected_write_target": "calendar/academic_calendar",
                        "review_policy": "selected_write_requires_review",
                        "title": "中央民族大学校历",
                        "normalized_canonical_url": "https://www.muc.edu.cn/ggfw/mdxl.htm",
                        "matched_evidence": ["calendar_arrangement"],
                        "raw_asset_id": "owasset_calendar",
                        "raw_version_id": "owver_calendar",
                        "target_id": "official-web-academic-calendar",
                        "target_job_id": "owtarget_muc_public_calendar",
                        "typed_candidate_schema_version": "official_web_academic_calendar_candidate.v1",
                        "typed_candidate": {
                            "academic_year_label": "2025-2026学年",
                            "term_label": "春季学期",
                            "date_range": "2026-05-09 至 2026-05-09",
                            "calendar_arrangement": "2026-05-09 执行周一课表。",
                            "holiday_name": "",
                            "week_index": 10,
                            "class_day_pattern": "执行周一课表",
                            "records": [
                                {
                                    "academic_year_label": "2025-2026学年",
                                    "term_label": "春季学期",
                                    "start_date": "2026-05-09",
                                    "end_date": "2026-05-09",
                                    "week_index": 10,
                                    "day_kind": "makeup_class_day",
                                    "class_day_pattern": "执行周一课表",
                                    "is_makeup_class": True,
                                    "holiday_name": "",
                                }
                            ],
                            "source_url": "https://www.muc.edu.cn/ggfw/mdxl.htm",
                            "source_title": "中央民族大学校历",
                        },
                        "quality_gate": {"decision": "pass"},
                    }
                ],
            },
            target_inventory_manifest={
                "schema_version": "official_web_target_inventory.v1",
                "site_id": "muc_public",
                "inventory_version": "test_target_inventory_calendar_v1",
                "entries": [
                    {
                        "inventory_id": "muc-public-academic-calendar",
                        "admission_target_id": "official-web-academic-calendar",
                        "source_urls": ["https://www.muc.edu.cn/ggfw/mdxl.htm"],
                        "required_fields": [
                            "academic_year_label",
                            "term_label",
                            "date_range",
                            "calendar_arrangement",
                            "source_url",
                            "source_version_evidence",
                        ],
                        "optional_fields": ["holiday_name", "week_index", "class_day_pattern"],
                        "optional_evidence": [],
                        "required_evidence": ["calendar_arrangement"],
                    }
                ],
            },
        )

        self.assertEqual(review["selectedWrite"]["decision"], "dry_run_ready")
        self.assertTrue(review["candidates"][0]["ready_for_selected_write"])
        self.assertEqual(
            review["candidates"][0]["field_status"],
            {
                "academic_year_label": "present",
                "term_label": "present",
                "date_range": "present",
                "calendar_arrangement": "present",
                "source_url": "present",
                "source_version_evidence": "present",
                "holiday_name": "source_not_provided",
                "week_index": "present",
                "class_day_pattern": "present",
            },
        )
        self.assertEqual(
            review["targetFieldReviews"][0]["summary"]["selectedWriteTarget"],
            "calendar/academic_calendar",
        )

    def test_machine_field_review_reports_partial_dry_run_ready_for_mixed_selected_write_batch(
        self,
    ) -> None:
        review = build_consumer_candidate_review_report(
            replay_report={
                "site_id": "muc_public",
                "crawl_run_id": "owrun_mixed_selected_write",
                "documents": [],
                "consumer_candidate_pages": [
                    {
                        "candidate_key": "owcand_contact_ready",
                        "consumer_family": "contact_directory_candidate",
                        "materialization_policy": "candidate_only",
                        "selected_write_target": "campus_services/contact_directory",
                        "review_policy": "selected_write_requires_review",
                        "title": "联系我们",
                        "normalized_canonical_url": "https://www.muc.edu.cn/",
                        "matched_evidence": ["phone", "location"],
                        "raw_asset_id": "owasset_contact_ready",
                        "raw_version_id": "owver_contact_ready",
                        "target_id": "campus-services-contact-directory",
                        "target_job_id": "owtarget_muc_public_contact",
                        "typed_candidate_schema_version": "official_web_contact_directory_candidate.v1",
                        "typed_candidate": {
                            "display_name": "中央民族大学",
                            "phones": ["010-68932442"],
                            "locations": ["北京市海淀区中关村南大街27号"],
                            "source_url": "https://www.muc.edu.cn/",
                        },
                        "quality_gate": {"decision": "pass"},
                    },
                    {
                        "candidate_key": "owcand_contact_blocked",
                        "consumer_family": "contact_directory_candidate",
                        "materialization_policy": "candidate_only",
                        "selected_write_target": "campus_services/contact_directory",
                        "review_policy": "selected_write_requires_review",
                        "title": "无电话联系方式",
                        "normalized_canonical_url": "https://www.muc.edu.cn/no-phone",
                        "matched_evidence": ["location"],
                        "raw_asset_id": "owasset_contact_blocked",
                        "raw_version_id": "owver_contact_blocked",
                        "target_id": "campus-services-contact-directory",
                        "target_job_id": "owtarget_muc_public_contact_blocked",
                        "typed_candidate_schema_version": "official_web_contact_directory_candidate.v1",
                        "typed_candidate": {
                            "display_name": "中央民族大学",
                            "locations": ["北京市海淀区中关村南大街27号"],
                            "source_url": "https://www.muc.edu.cn/no-phone",
                        },
                        "quality_gate": {"decision": "pass"},
                    },
                ],
            },
            target_inventory_manifest={
                "schema_version": "official_web_target_inventory.v1",
                "site_id": "muc_public",
                "inventory_version": "test_target_inventory_v5",
                "entries": [
                    {
                        "inventory_id": "muc-main-homepage-contact",
                        "admission_target_id": "campus-services-contact-directory",
                        "source_urls": ["https://www.muc.edu.cn/"],
                        "required_fields": [
                            "organization_name",
                            "phone",
                            "source_url",
                            "source_version_evidence",
                        ],
                        "optional_fields": ["location"],
                        "optional_evidence": ["location"],
                        "required_evidence": ["phone"],
                    },
                    {
                        "inventory_id": "muc-no-phone-contact",
                        "admission_target_id": "campus-services-contact-directory",
                        "source_urls": ["https://www.muc.edu.cn/no-phone"],
                        "required_fields": [
                            "organization_name",
                            "phone",
                            "source_url",
                            "source_version_evidence",
                        ],
                        "optional_fields": ["location"],
                        "optional_evidence": ["location"],
                        "required_evidence": ["phone"],
                    },
                ],
            },
        )

        self.assertEqual(review["selectedWrite"]["decision"], "partial_dry_run_ready")
        self.assertEqual(
            review["selectedWrite"]["reason"],
            "machine_field_review_partially_passed",
        )
        self.assertEqual(review["selectedWrite"]["ready_record_count"], 1)
        self.assertEqual(review["selectedWrite"]["blocked_record_count"], 1)
        self.assertEqual(
            [record["candidate_key"] for record in review["selectedWrite"]["preview_records"]],
            ["owcand_contact_ready"],
        )
        self.assertEqual(
            [review_record["status"] for review_record in review["targetFieldReviews"]],
            ["ready_for_selected_write", "blocked_fields"],
        )

    def test_machine_field_review_marks_campus_card_service_ready_with_optional_gaps(
        self,
    ) -> None:
        candidate_key = "owcand_campus_card_service"

        review = build_consumer_candidate_review_report(
            replay_report={
                "site_id": "muc_public",
                "crawl_run_id": "owrun_campus_card_service",
                "documents": [],
                "consumer_candidate_pages": [
                    {
                        "candidate_key": candidate_key,
                        "consumer_family": "service_guide_candidate",
                        "materialization_policy": "candidate_only",
                        "selected_write_target": "campus_services/service_guide",
                        "review_policy": "selected_write_requires_review",
                        "title": "学生校园卡服务",
                        "normalized_canonical_url": "https://met.muc.edu.cn/info/1027/1127.htm",
                        "matched_evidence": [
                            "service_process",
                            "service_entry",
                            "service_material",
                            "phone",
                            "location",
                        ],
                        "raw_asset_id": "owasset_campus_card",
                        "raw_version_id": "owver_campus_card",
                        "target_id": "campus-services-service-guide",
                        "target_job_id": "owtarget_muc_public_service",
                        "typed_candidate_schema_version": "official_web_service_guide_candidate.v1",
                        "typed_candidate": {
                            "service_name": "学生校园卡服务",
                            "process_steps": [
                                "校园卡丢失后，请立即通过圈存机或民大通APP挂失。",
                                "校园卡损坏或丢失后，先将卡挂失，再到自助补卡机补卡。",
                            ],
                            "materials": ["有效证件"],
                            "responsible_office": [],
                            "entry_points": ["民大通APP", "圈存机", "自助补卡机"],
                            "contacts": {
                                "phones": ["010-68933381", "010-83878225"],
                                "emails": [],
                                "locations": ["海淀校区中慧楼2层", "丰台校区智慧中心一层"],
                                "office_hours": [],
                            },
                            "source_url": "https://met.muc.edu.cn/info/1027/1127.htm",
                        },
                        "quality_gate": {"decision": "pass"},
                    }
                ],
            },
            target_inventory_manifest={
                "schema_version": "official_web_target_inventory.v1",
                "site_id": "muc_public",
                "inventory_version": "test_target_inventory_v3",
                "entries": [
                    {
                        "inventory_id": "muc-it-student-campus-card-service-guide",
                        "admission_target_id": "campus-services-service-guide",
                        "source_urls": ["https://met.muc.edu.cn/info/1027/1127.htm"],
                        "required_fields": [
                            "service_name",
                            "process_steps",
                            "source_url",
                            "source_version_evidence",
                        ],
                        "optional_fields": [
                            "service_entry",
                            "required_materials",
                            "responsible_office",
                            "phone",
                            "location",
                            "office_hours",
                        ],
                        "optional_evidence": [
                            "service_entry",
                            "service_material",
                            "phone",
                            "location",
                            "office_hours",
                        ],
                        "required_evidence": ["service_process"],
                    }
                ],
            },
        )

        self.assertEqual(review["selectedWrite"]["decision"], "dry_run_ready")
        self.assertEqual(review["selectedWrite"]["reason"], "machine_field_review_passed")
        self.assertEqual(review["counts"]["selected_write_ready_count"], 1)
        self.assertEqual(
            review["candidates"][0]["field_status"],
            {
                "service_name": "present",
                "process_steps": "present",
                "service_process": "present",
                "service_entry": "present",
                "service_material": "present",
                "required_materials": "present",
                "responsible_office": "source_not_provided",
                "phone": "present",
                "location": "present",
                "office_hours": "source_not_provided",
                "source_url": "present",
                "source_version_evidence": "present",
            },
        )
        self.assertEqual(
            review["targetFieldReviews"][0]["summary"]["inventoryId"],
            "muc-it-student-campus-card-service-guide",
        )


if __name__ == "__main__":
    unittest.main()
