# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.official_web_handoff_consumer_staging_suite_support import *


class OfficialWebHandoffConsumerStagingTestPart02(unittest.TestCase):
    def test_machine_field_review_uses_typed_candidate_not_unscoped_evidence_for_optional_fields(
        self,
    ) -> None:
        review = build_consumer_candidate_review_report(
            replay_report={
                "site_id": "muc_public",
                "crawl_run_id": "owrun_campus_card_footer_location",
                "documents": [],
                "consumer_candidate_pages": [
                    {
                        "candidate_key": "owcand_campus_card_footer_location",
                        "consumer_family": "service_guide_candidate",
                        "materialization_policy": "candidate_only",
                        "selected_write_target": "campus_services/service_guide",
                        "review_policy": "selected_write_requires_review",
                        "title": "学生校园卡服务",
                        "normalized_canonical_url": "https://met.muc.edu.cn/info/1027/1127.htm",
                        "matched_evidence": ["service_process", "phone", "location"],
                        "raw_asset_id": "owasset_campus_card",
                        "raw_version_id": "owver_campus_card",
                        "target_id": "campus-services-service-guide",
                        "target_job_id": "owtarget_muc_public_service",
                        "typed_candidate_schema_version": "official_web_service_guide_candidate.v1",
                        "typed_candidate": {
                            "service_name": "学生校园卡服务",
                            "process_steps": ["校园卡丢失后，请通过民大通APP挂失。"],
                            "materials": [],
                            "responsible_office": [],
                            "entry_points": ["民大通APP"],
                            "contacts": {
                                "phones": ["010-68933381"],
                                "emails": [],
                                "locations": [],
                                "office_hours": [],
                            },
                            "source_url": "https://met.muc.edu.cn/info/1027/1127.htm",
                        },
                        "evidence_spans": [
                            {
                                "evidence_type": "location",
                                "row_id": "footer-1",
                                "text": "北京市海淀区中关村南大街27号",
                            }
                        ],
                        "quality_gate": {"decision": "pass"},
                    }
                ],
            },
            target_inventory_manifest={
                "schema_version": "official_web_target_inventory.v1",
                "site_id": "muc_public",
                "inventory_version": "test_target_inventory_v4",
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

        self.assertEqual(
            review["candidates"][0]["field_status"]["location"],
            "source_not_provided",
        )

    def test_selected_write_candidate_without_target_inventory_fails_closed(
        self,
    ) -> None:
        review = build_consumer_candidate_review_report(
            replay_report={
                "site_id": "muc_public",
                "crawl_run_id": "owrun_missing_inventory",
                "documents": [],
                "consumer_candidate_pages": [
                    {
                        "candidate_key": "owcand_missing_inventory",
                        "consumer_family": "contact_directory_candidate",
                        "materialization_policy": "candidate_only",
                        "selected_write_target": "campus_services/contact_directory",
                        "review_policy": "selected_write_requires_review",
                        "title": "联系我们",
                        "normalized_canonical_url": "https://www.muc.edu.cn/",
                        "matched_evidence": ["phone", "email", "location", "office_hours"],
                        "raw_asset_id": "owasset_contact",
                        "raw_version_id": "owver_contact",
                        "target_id": "campus-services-contact-directory",
                        "target_job_id": "owtarget_muc_public_contact",
                        "typed_candidate_schema_version": "official_web_contact_directory_candidate.v1",
                        "typed_candidate": {
                            "display_name": "中央民族大学",
                            "phones": ["010-68932442"],
                            "emails": ["webmaster@muc.edu.cn"],
                            "locations": ["北京市海淀区中关村南大街27号"],
                            "office_hours": ["周一至周五 8:00-17:00"],
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
                "entries": [],
            },
        )

        self.assertEqual(review["selectedWrite"]["decision"], "blocked")
        self.assertEqual(
            review["candidates"][0]["blocked_reason"],
            "target_inventory_required_fields_missing",
        )

    def test_stable_reference_document_reports_target_inventory_field_status(
        self,
    ) -> None:
        review = build_consumer_candidate_review_report(
            replay_report={
                "site_id": "muc_public",
                "crawl_run_id": "owrun_stable_reference_review",
                "documents": [
                    {
                        "document_id": "official_web:muc_public:generic_content_page:school",
                        "version_id": "owdocver_school_intro",
                        "title": "学校简介",
                        "declaration_id": "generic-content-primary",
                        "page_family": "generic_content_page",
                        "projection_family": "content_document",
                        "document_kind": "article",
                        "target_corpus": "official_web",
                        "target_collection": "stable_reference",
                        "normalized_canonical_url": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                        "raw_asset_id": "owasset_school_intro",
                        "raw_version_id": "owver_school_intro",
                        "unit_count": 3,
                        "canonical_markdown_path": "/tmp/school-introduction/canonical.md",
                        "document_units_path": "/tmp/school-introduction/document-units.jsonl",
                        "serving_intent": "promotable",
                        "promotion_block_reason": None,
                        "materialization_policy": "release_gate_required",
                        "selected_write_target": "official_web/stable_reference",
                        "target_id": "official-web-stable-reference",
                        "target_job_id": "owtarget_school_intro",
                        "target_candidate_id": "owcandidate_school_intro",
                    }
                ],
                "consumer_candidate_pages": [],
            },
            target_inventory_manifest={
                "schema_version": "official_web_target_inventory.v1",
                "site_id": "muc_public",
                "inventory_version": "test_target_inventory_v1",
                "entries": [
                    {
                        "inventory_id": "muc-school-introduction-reference",
                        "admission_target_id": "official-web-stable-reference",
                        "source_urls": ["https://www.muc.edu.cn/xxgk1/xxjj.htm"],
                        "required_fields": [
                            "reference_title",
                            "normalized_content_summary",
                            "authoritative_source_url",
                            "release_scope",
                            "source_version_evidence",
                        ],
                    }
                ],
            },
        )

        self.assertEqual(review["status"], "pending_review")
        self.assertEqual(
            review["stableReferenceRelease"],
            {
                "decision": "release_gate_required",
                "candidate_count": 1,
                "serving_alias_update": "not_allowed_in_consumer_denominator_recovery",
            },
        )
        self.assertEqual(
            review["targetFieldReviews"],
            [
                {
                    "canonicalVerification": False,
                    "jobId": "owtarget_school_intro",
                    "runId": "owrun_stable_reference_review",
                    "sourceHandoffId": None,
                    "status": "release_gate_required",
                    "summary": {
                        "schemaVersion": "official_web_target_field_review.v1",
                        "candidateKey": "owdoc:official_web:muc_public:generic_content_page:school:owdocver_school_intro",
                        "consumerFamily": "stable_reference_candidate",
                        "fieldStatus": {
                            "reference_title": "present",
                            "normalized_content_summary": "present",
                            "authoritative_source_url": "present",
                            "release_scope": "present",
                            "source_version_evidence": "present",
                        },
                        "inventoryId": "muc-school-introduction-reference",
                        "normalizedCanonicalUrl": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                        "readyForSelectedWrite": False,
                        "requiredFields": [
                            "reference_title",
                            "normalized_content_summary",
                            "authoritative_source_url",
                            "release_scope",
                            "source_version_evidence",
                        ],
                        "reviewVerdict": "pending_review",
                        "selectedWriteTarget": "official_web/stable_reference",
                        "sourceRef": {
                            "source_channel": "official_web",
                            "raw_asset_id": "owasset_school_intro",
                            "raw_version_id": "owver_school_intro",
                            "normalized_canonical_url": "https://www.muc.edu.cn/xxgk1/xxjj.htm",
                        },
                        "targetId": "official-web-stable-reference",
                    },
                }
            ],
        )

    def test_consume_handoff_record_stages_projection_outputs_without_persisting_registry_by_default(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inbox_dir = root / "inbox"
            execution_root_dir = root / "executions"
            record_path = inbox_dir / "owevt_completed_success.json"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())

            bundle = _bundle_payload()
            _write_json(
                record_path,
                _handoff_record(
                    event_id="owevt_completed_success",
                    run_id="owrun_projection_001",
                    site_id="campus_public",
                ),
            )
            object_store = FakeReplayObjectStore(_standard_bundle_objects(bundle=bundle))
            document_registry = InMemoryDocumentRegistry()
            raw_asset_registry = InMemoryRawAssetRegistry()
            reporter = FakeExecutionStatusReporter()

            result = consume_handoff_record(
                record_path=record_path,
                settings=OfficialWebHandoffConsumerSettings(
                    inbox_dir=inbox_dir,
                    execution_root_dir=execution_root_dir,
                    source_bucket="campus-rag-source",
                ),
                object_store=object_store,
                declarations_path=declarations_path,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                derived_object_store=object_store,
                status_reporter=reporter,
            )

            self.assertEqual(result.status, "staged")
            self.assertEqual(
                len(raw_asset_registry.list_by_scope("official_web", "muc_public_pages")), 0
            )
            self.assertEqual(
                len(document_registry.list_by_scope("official_web", "muc_public_pages")), 0
            )
            self.assertEqual(object_store.put_requests, [])
            self.assertEqual(
                [call["payload"]["status"] for call in reporter.calls], ["running", "staged"]
            )
            json.loads(Path(result.execution_report_path or "").read_text(encoding="utf-8"))

    def test_consume_handoff_record_reports_consumer_candidate_review_before_selected_write(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inbox_dir = root / "inbox"
            execution_root_dir = root / "executions"
            record_path = inbox_dir / "owevt_completed_consumer_candidate.json"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())

            consumer_matches = [
                {
                    "consumerFamily": "contact_directory_candidate",
                    "ownerSurface": "contact_directory_lookup",
                    "ownerAgentOrRuntime": "campus-services-agent",
                    "materializationPolicy": "candidate_only",
                    "selectedWriteTarget": "campus_services/contact_directory",
                    "reviewPolicy": "selected_write_requires_review",
                    "targetCandidateId": "owcand_contact_reviewed",
                    "targetDeclarationVersion": "test_target_inventory_v1",
                    "targetId": "campus-services-contact-directory",
                    "targetJobId": "owtarget_contact_reviewed",
                    "matchedEvidence": ["phone", "location"],
                    "matchedKeywords": ["联系我们"],
                    "matchedPatterns": [],
                }
            ]
            bundle = _bundle_payload(
                run_id="owrun_projection_consumer_candidate",
                raw_asset_id="owasset_contact_candidate",
                raw_version_id="owver_contact_candidate",
                normalized_canonical_url="https://www.example.edu/contact",
                consumer_matches=consumer_matches,
            )
            _write_json(
                record_path,
                _handoff_record(
                    event_id="owevt_completed_consumer_candidate",
                    run_id="owrun_projection_consumer_candidate",
                    site_id="campus_public",
                    pages_normalized=1,
                ),
            )
            object_store = FakeReplayObjectStore(
                _standard_bundle_objects(
                    bundle=bundle,
                    page_title="联系我们",
                    paragraph_text="办公地点：中慧楼二层，联系电话：010-68933381。",
                    consumer_matches=consumer_matches,
                )
            )
            document_registry = InMemoryDocumentRegistry()
            raw_asset_registry = InMemoryRawAssetRegistry()
            reporter = FakeExecutionStatusReporter()

            result = consume_handoff_record(
                record_path=record_path,
                settings=OfficialWebHandoffConsumerSettings(
                    inbox_dir=inbox_dir,
                    execution_root_dir=execution_root_dir,
                    source_bucket="campus-rag-source",
                ),
                object_store=object_store,
                declarations_path=declarations_path,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                derived_object_store=object_store,
                status_reporter=reporter,
            )

            self.assertEqual(result.status, "staged")
            self.assertEqual(
                len(document_registry.list_by_scope("campus_services", "contact_directory")), 0
            )
            self.assertEqual(object_store.put_requests, [])
            execution_report = json.loads(
                Path(result.execution_report_path or "").read_text(encoding="utf-8")
            )
            review = execution_report["consumerCandidateReview"]
            self.assertEqual(review["counts"]["candidate_count"], 1)
            self.assertEqual(
                review["counts"]["by_consumer_family"], {"contact_directory_candidate": 1}
            )
            self.assertEqual(review["selectedWrite"]["decision"], "blocked")
            self.assertEqual(
                review["candidates"][0]["admission_action"],
                "selected_write_review_required",
            )
            self.assertEqual(execution_report["promotion"]["decision"], "staged")

    def test_consume_handoff_record_marks_machine_reviewed_candidate_selected_write_dry_run_ready(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inbox_dir = root / "inbox"
            execution_root_dir = root / "executions"
            record_path = inbox_dir / "owevt_completed_reviewed_candidate.json"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())

            consumer_matches = [
                {
                    "consumerFamily": "contact_directory_candidate",
                    "ownerSurface": "contact_directory_lookup",
                    "ownerAgentOrRuntime": "campus-services-agent",
                    "materializationPolicy": "candidate_only",
                    "selectedWriteTarget": "campus_services/contact_directory",
                    "reviewPolicy": "selected_write_requires_review",
                    "targetCandidateId": "owcand_contact_reviewed",
                    "targetDeclarationVersion": "test_target_inventory_v1",
                    "targetId": "campus-services-contact-directory",
                    "targetJobId": "owtarget_contact_reviewed",
                    "matchedEvidence": ["phone", "email", "location", "office_hours"],
                    "matchedKeywords": ["联系我们"],
                    "matchedPatterns": [],
                }
            ]
            bundle = _bundle_payload(
                run_id="owrun_projection_reviewed_candidate",
                raw_asset_id="owasset_contact_reviewed",
                raw_version_id="owver_contact_reviewed",
                normalized_canonical_url="https://www.example.edu/contact",
                consumer_matches=consumer_matches,
            )
            _write_json(
                record_path,
                _handoff_record(
                    event_id="owevt_completed_reviewed_candidate",
                    run_id="owrun_projection_reviewed_candidate",
                    site_id="campus_public",
                    pages_normalized=1,
                ),
            )
            object_store = FakeReplayObjectStore(
                _standard_bundle_objects(
                    bundle=bundle,
                    page_title="联系我们",
                    paragraph_text=(
                        "办公地点：中慧楼二层，联系电话：010-68933381，"
                        "邮箱：webmaster@example.edu。办公时间：周一至周五 8:00-17:00。"
                    ),
                    consumer_matches=consumer_matches,
                )
            )
            document_registry = InMemoryDocumentRegistry()
            raw_asset_registry = InMemoryRawAssetRegistry()
            release_task_store = InMemoryOfficialWebReleaseTaskStore()

            with patch(
                "campus_ingestion_worker.official_web_handoff_consumer_runtime._read_target_inventory_manifest_if_present",
                return_value={
                    "schema_version": "official_web_target_inventory.v1",
                    "site_id": "campus_public",
                    "inventory_version": "test_target_inventory_v2",
                    "entries": [
                        {
                            "inventory_id": "campus-public-contact",
                            "admission_target_id": "campus-services-contact-directory",
                            "target_label": "校园公共联系方式",
                            "source_urls": ["https://www.example.edu/contact"],
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
            ):
                result = consume_handoff_record(
                    record_path=record_path,
                    settings=OfficialWebHandoffConsumerSettings(
                        inbox_dir=inbox_dir,
                        execution_root_dir=execution_root_dir,
                        source_bucket="campus-rag-source",
                    ),
                    object_store=object_store,
                    declarations_path=declarations_path,
                    document_registry=document_registry,
                    raw_asset_registry=raw_asset_registry,
                    derived_object_store=object_store,
                    release_task_store=release_task_store,
                )

            self.assertEqual(result.status, "staged")
            self.assertEqual(
                len(document_registry.list_by_scope("campus_services", "contact_directory")), 0
            )
            execution_report = json.loads(
                Path(result.execution_report_path or "").read_text(encoding="utf-8")
            )
            review = execution_report["consumerCandidateReview"]
            self.assertEqual(review["selectedWrite"]["decision"], "dry_run_ready")
            self.assertEqual(review["counts"]["selected_write_ready_count"], 1)
            self.assertEqual(review["candidates"][0]["review_verdict"], "pending_review")
            self.assertEqual(review["candidates"][0]["target_label"], "校园公共联系方式")
            self.assertTrue(review["candidates"][0]["ready_for_selected_write"])
            self.assertEqual(
                review["candidates"][0]["admission_action"],
                "selected_write_ready",
            )
            self.assertEqual(
                review["selectedWrite"]["preview_records"][0]["target_collection"],
                "contact_directory",
            )
            self.assertEqual(
                review["selectedWrite"]["preview_records"][0]["field_status"],
                {
                    "organization_name": "present",
                    "phone": "present",
                    "email": "present",
                    "location": "present",
                    "office_hours": "present",
                    "source_url": "present",
                    "source_version_evidence": "present",
                },
            )
            self.assertEqual(
                review["selectedWrite"]["preview_records"][0]["required_fields"],
                [
                    "organization_name",
                    "phone",
                    "email",
                    "location",
                    "office_hours",
                    "source_url",
                    "source_version_evidence",
                ],
            )
            self.assertEqual(
                review["selectedWrite"]["preview_records"][0]["required_evidence"],
                ["phone", "email", "location", "office_hours"],
            )
            self.assertEqual(
                review["selectedWrite"]["preview_records"][0]["inventory_id"],
                "campus-public-contact",
            )
            self.assertEqual(
                review["selectedWrite"]["preview_records"][0]["target_label"],
                "校园公共联系方式",
            )
            tasks = release_task_store.list_tasks()
            self.assertEqual(len(tasks), 1)
            self.assertEqual(tasks[0].status, "queued")
            self.assertEqual(tasks[0].task_type, "official_web_selected_write_contact_directory")
            self.assertEqual(tasks[0].inventory_id, "campus-public-contact")
            self.assertEqual(tasks[0].job_id, "owtarget_contact_reviewed")
            self.assertEqual(tasks[0].run_id, "owrun_projection_reviewed_candidate")
            self.assertEqual(
                tasks[0].selected_write_target,
                "campus_services/contact_directory",
            )
            self.assertEqual(
                tasks[0].input_ref["sourceObjectKeys"],
                [
                    _bundle_key(
                        site_id="campus_public",
                        run_id="owrun_projection_reviewed_candidate",
                    )
                ],
            )
            self.assertEqual(tasks[0].input_ref["targetLabel"], "校园公共联系方式")
            self.assertIsNone(execution_report["import"])
            self.assertEqual(execution_report["promotion"]["decision"], "staged")


if __name__ == "__main__":
    unittest.main()
