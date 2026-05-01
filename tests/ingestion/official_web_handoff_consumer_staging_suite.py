from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_worker.official_web_handoff_consumer_reporting import (
    build_consumer_candidate_review_report,
)

from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry

from .official_web_handoff_consumer_test_support import (
    DocumentRegistryRecord,
    FakeExecutionStatusReporter,
    FakeReplayObjectStore,
    ImportReport,
    OfficialWebHandoffConsumeResult,
    OfficialWebHandoffConsumerSettings,
    OfficialWebProjectionChunkingAuditReport,
    OfficialWebProjectionReplayReport,
    OfficialWebProjectionValidationReport,
    RawAssetRecord,
    _bundle_key,
    _bundle_payload,
    _declarations_payload,
    _handoff_record,
    _standard_bundle_objects,
    _write_json,
    consume_handoff_record,
)


def _expected_candidate_key(
    *,
    consumer_family: str,
    normalized_canonical_url: str,
    raw_version_id: str,
    selected_write_target: str,
) -> str:
    digest = hashlib.sha256(
        json.dumps(
            {
                "consumer_family": consumer_family,
                "normalized_canonical_url": normalized_canonical_url,
                "raw_version_id": raw_version_id,
                "selected_write_target": selected_write_target,
            },
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()[:24]
    return f"owcand_{digest}"


class OfficialWebHandoffConsumerStagingTest(unittest.TestCase):
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
                "reasonCode": "legacy_broad_crawl_contract",
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

    def test_consume_handoff_record_marks_approved_typed_candidate_selected_write_dry_run_ready(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inbox_dir = root / "inbox"
            execution_root_dir = root / "executions"
            record_path = inbox_dir / "owevt_completed_reviewed_candidate.json"
            declarations_path = root / "projection-declarations.json"
            review_manifest_path = root / "consumer-review-manifest.json"
            _write_json(declarations_path, _declarations_payload())

            consumer_matches = [
                {
                    "consumerFamily": "contact_directory_candidate",
                    "ownerSurface": "contact_directory_lookup",
                    "ownerAgentOrRuntime": "campus-services-agent",
                    "materializationPolicy": "candidate_only",
                    "selectedWriteTarget": "campus_services/contact_directory",
                    "reviewPolicy": "selected_write_requires_review",
                    "matchedEvidence": ["phone", "location"],
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
            candidate_key = _expected_candidate_key(
                consumer_family="contact_directory_candidate",
                normalized_canonical_url="https://www.example.edu/contact",
                raw_version_id="owver_contact_reviewed",
                selected_write_target="campus_services/contact_directory",
            )
            _write_json(
                review_manifest_path,
                {
                    "schema_version": "official_web_selected_write_review_manifest.v1",
                    "site_id": "campus_public",
                    "run_id": "owrun_projection_reviewed_candidate",
                    "verdicts": [
                        {
                            "candidate_key": candidate_key,
                            "verdict": "approved",
                            "reviewed_by": "ops@example.com",
                            "reviewed_at": "2026-05-01T10:00:00+00:00",
                            "notes": "source-backed contact directory candidate",
                        }
                    ],
                },
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
                    paragraph_text="办公地点：中慧楼二层，联系电话：010-68933381。",
                    consumer_matches=consumer_matches,
                )
            )
            document_registry = InMemoryDocumentRegistry()
            raw_asset_registry = InMemoryRawAssetRegistry()

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
                consumer_review_manifest_path=review_manifest_path,
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
            self.assertEqual(review["candidates"][0]["review_verdict"], "approved")
            self.assertTrue(review["candidates"][0]["ready_for_selected_write"])
            self.assertEqual(
                review["candidates"][0]["admission_action"],
                "selected_write_ready",
            )
            self.assertEqual(
                review["selectedWrite"]["preview_records"][0]["target_collection"],
                "contact_directory",
            )
            self.assertIsNone(execution_report["import"])
            self.assertEqual(execution_report["promotion"]["decision"], "staged")

    def test_consume_handoff_record_promotes_when_projection_contains_mixed_promotable_and_audit_only_documents(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inbox_dir = root / "inbox"
            execution_root_dir = root / "executions"
            record_path = inbox_dir / "owevt_completed_mixed_truth.json"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())

            bundle = _bundle_payload()
            _write_json(
                record_path,
                _handoff_record(
                    event_id="owevt_completed_mixed_truth",
                    run_id="owrun_projection_001",
                    site_id="campus_public",
                ),
            )
            object_store = FakeReplayObjectStore(_standard_bundle_objects(bundle=bundle))

            with (
                patch(
                    "campus_ingestion_worker.official_web_handoff_consumer.replay_official_web_source_truth_local",
                    return_value=OfficialWebProjectionReplayReport(
                        schema_version="official_web_projection_replay_report.v1",
                        site_id="campus_public",
                        crawl_run_id="owrun_projection_001",
                        output_dir=str(execution_root_dir / "input"),
                        projection_output_dir=str(execution_root_dir / "projection"),
                        generated_at="2026-04-03T00:00:00+00:00",
                        counts={"pages_seen": 2, "emitted_documents": 2, "manual_review_pages": 0},
                        documents=[
                            {
                                "document_id": "official_web:muc_public:article_detail:promotable",
                                "version_id": "owdocver:promotable",
                                "title": "新闻详情",
                                "declaration_id": "article-detail-primary",
                                "page_family": "article_detail",
                                "projection_family": "content_document",
                                "document_kind": "article",
                                "target_corpus": "official_web",
                                "target_collection": "muc_public_pages",
                                "normalized_canonical_url": "https://www.example.edu/news/1",
                                "raw_asset_id": "owasset_article_001",
                                "raw_version_id": "owver_article_001",
                                "unit_count": 1,
                                "canonical_markdown_path": str(root / "promotable.md"),
                                "document_units_path": str(root / "promotable.jsonl"),
                                "serving_intent": "promotable",
                                "promotion_block_reason": None,
                            },
                            {
                                "document_id": "official_web:muc_public:listing_page:audit-only",
                                "version_id": "owdocver:audit-only",
                                "title": "新闻网",
                                "declaration_id": "listing-page-primary",
                                "page_family": "listing_page",
                                "projection_family": "content_document",
                                "document_kind": "listing",
                                "target_corpus": "official_web",
                                "target_collection": "muc_public_pages",
                                "normalized_canonical_url": "https://www.example.edu/news/",
                                "raw_asset_id": "owasset_listing_001",
                                "raw_version_id": "owver_listing_001",
                                "unit_count": 1,
                                "canonical_markdown_path": str(root / "audit-only.md"),
                                "document_units_path": str(root / "audit-only.jsonl"),
                                "serving_intent": "audit_only",
                                "promotion_block_reason": "listing_page_audit_only",
                            },
                        ],
                        manual_review_pages=[],
                    ),
                ),
                patch(
                    "campus_ingestion_worker.official_web_handoff_consumer.validate_official_web_projection_output",
                    return_value=OfficialWebProjectionValidationReport(
                        schema_version="official_web_projection_validation_report.v1",
                        valid=True,
                        projection_output_dir=str(execution_root_dir / "projection"),
                        issues=[],
                        counts={"documents": 2, "errors": 0, "warnings": 0},
                    ),
                ),
                patch(
                    "campus_ingestion_worker.official_web_handoff_consumer.audit_official_web_projection_chunking",
                    return_value=OfficialWebProjectionChunkingAuditReport(
                        schema_version="official_web_projection_chunking_audit.v1",
                        projection_output_dir=str(execution_root_dir / "projection"),
                        passed=True,
                        document_count=2,
                        total_units=2,
                        total_chunks=2,
                        issue_counts={},
                        documents=(),
                    ),
                ),
                patch(
                    "campus_ingestion_worker.official_web_handoff_consumer._persist_projection_output",
                    return_value=ImportReport(
                        import_mode="official_web_source_truth_replay",
                        success_count=1,
                        skipped_count=1,
                        failed_count=0,
                        raw_uploaded_count=1,
                        raw_reused_count=0,
                        document_ids=("official_web:muc_public:article_detail:promotable",),
                        unresolved_source_pdfs=(),
                        errors=(),
                        report_path=str(root / "import-report.json"),
                        created_document_ids=("official_web:muc_public:article_detail:promotable",),
                        skipped_document_ids=("official_web:muc_public:listing_page:audit-only",),
                    ),
                ) as persist_projection_output,
            ):
                result = consume_handoff_record(
                    record_path=record_path,
                    settings=OfficialWebHandoffConsumerSettings(
                        inbox_dir=inbox_dir,
                        execution_root_dir=execution_root_dir,
                        source_bucket="campus-rag-source",
                        promote_import=True,
                        minimum_promote_pages=1,
                        minimum_seed_coverage_ratio=0.0,
                        minimum_host_coverage_ratio=0.0,
                    ),
                    object_store=object_store,
                    declarations_path=declarations_path,
                    document_registry=InMemoryDocumentRegistry(),
                    raw_asset_registry=InMemoryRawAssetRegistry(),
                    derived_object_store=object_store,
                )

            self.assertEqual(result.status, "promoted")
            persist_projection_output.assert_called_once()
            execution_report = json.loads(
                Path(result.execution_report_path or "").read_text(encoding="utf-8")
            )
            self.assertEqual(execution_report["promotion"]["decision"], "promoted")
            self.assertTrue(execution_report["promotion"]["eligible"])
            self.assertEqual(
                execution_report["coverage"]["documentServingIntentCounts"],
                {"promotable": 1, "audit_only": 1},
            )
            self.assertEqual(execution_report["import"]["success_count"], 1)
            self.assertEqual(execution_report["import"]["skipped_count"], 1)

    def test_consume_handoff_record_promotes_registry_outputs_when_explicitly_enabled(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inbox_dir = root / "inbox"
            execution_root_dir = root / "executions"
            record_path = inbox_dir / "owevt_completed_success.json"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())

            bundle = _bundle_payload()
            bundle_key = _bundle_key()
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

            result = consume_handoff_record(
                record_path=record_path,
                settings=OfficialWebHandoffConsumerSettings(
                    inbox_dir=inbox_dir,
                    execution_root_dir=execution_root_dir,
                    source_bucket="campus-rag-source",
                    promote_import=True,
                    minimum_promote_pages=1,
                ),
                object_store=object_store,
                derived_object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                declarations_path=declarations_path,
            )

            self.assertIsInstance(result, OfficialWebHandoffConsumeResult)
            self.assertEqual(result.status, "promoted")
            self.assertEqual(result.attempt_count, 1)
            self.assertTrue(Path(result.execution_report_path or "").exists())
            self.assertTrue(Path(result.projection_output_dir or "").exists())
            self.assertTrue(Path(result.replay_input_dir or "").exists())
            self.assertEqual(object_store.requests[0], ("campus-rag-source", bundle_key))

            persisted = json.loads(record_path.read_text(encoding="utf-8"))
            self.assertEqual(persisted["processingStatus"], "promoted")
            self.assertEqual(persisted["processingAttemptCount"], 1)
            self.assertIsNone(persisted["lastError"])
            self.assertEqual(persisted["projectionOutputDir"], result.projection_output_dir)
            self.assertEqual(persisted["executionReportPath"], result.execution_report_path)

            execution_report = json.loads(
                Path(result.execution_report_path or "").read_text(encoding="utf-8")
            )
            self.assertEqual(execution_report["status"], "promoted")
            self.assertEqual(execution_report["bundleObjectKey"], bundle_key)
            self.assertTrue(execution_report["validation"]["valid"])
            self.assertEqual(execution_report["import"]["success_count"], 1)
            self.assertEqual(execution_report["promotion"]["decision"], "promoted")

            raw_records = raw_asset_registry.list_by_scope("official_web", "muc_public_pages")
            self.assertEqual(len(raw_records), 1)
            self.assertIsInstance(raw_records[0], RawAssetRecord)
            self.assertEqual(
                raw_records[0].object_key,
                "official_web/owasset_article_001/undated/owver_article_001/capture/response.html",
            )

            documents = document_registry.list_by_scope("official_web", "muc_public_pages")
            self.assertEqual(len(documents), 1)
            self.assertIsInstance(documents[0], DocumentRegistryRecord)
            self.assertEqual(documents[0].source_channel, "official_web")
            self.assertTrue(documents[0].is_current)
            self.assertIsNotNone(documents[0].canonical_markdown_object_key)
            self.assertIsNotNone(documents[0].document_units_object_key)
