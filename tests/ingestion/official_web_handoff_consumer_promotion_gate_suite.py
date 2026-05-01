from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core import ObjectStoreSettings
from campus_ingestion_core.campusrag_ingestion_reporting import ImportReport
from campus_ingestion_worker import official_web_handoff_consumer_runtime as consumer_runtime

from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry

from .official_web_handoff_consumer_test_support import (
    FakeExecutionStatusReporter,
    FakeReplayObjectStore,
    OfficialWebHandoffConsumerSettings,
    OfficialWebProjectionChunkingAuditReport,
    OfficialWebProjectionReplayReport,
    OfficialWebProjectionValidationReport,
    _bundle_payload,
    _declarations_payload,
    _handoff_record,
    _standard_bundle_objects,
    _write_json,
    consume_handoff_record,
)


class OfficialWebHandoffConsumerPromotionGateTest(unittest.TestCase):
    def test_persist_projection_output_refreshes_each_promotable_target_scope(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            projection_output_dir = root / "projection-output"
            replay_input_dir = root / "replay-input"
            work_dir = root / "work"
            projection_output_dir.mkdir(parents=True)
            replay_input_dir.mkdir(parents=True)
            _write_json(
                projection_output_dir / "projection-report.json",
                {
                    "schemaVersion": "official_web_projection_replay_report.v1",
                    "siteId": "campus_public",
                    "crawlRunId": "owrun_projection_001",
                    "documents": [
                        {
                            "document_id": "official_web:muc_public_pages:article_detail:doc-1",
                            "serving_intent": "promotable",
                            "target_collection": "muc_public_pages",
                            "target_corpus": "official_web",
                        },
                        {
                            "document_id": "official_web:stable_reference:article_detail:doc-2",
                            "serving_intent": "promotable",
                            "target_collection": "stable_reference",
                            "target_corpus": "official_web",
                        },
                        {
                            "document_id": "official_web:news_archive:listing_page:audit-only",
                            "serving_intent": "audit_only",
                            "target_collection": "news_archive",
                            "target_corpus": "official_web",
                        },
                    ],
                },
            )
            calls: list[tuple[str, str] | None] = []

            def fake_import_projection_output(**kwargs):
                scope_refresh = kwargs["scope_refresh"]
                calls.append(scope_refresh)
                assert scope_refresh is not None
                collection = scope_refresh[1]
                return ImportReport(
                    import_mode="official_web_source_truth_replay",
                    success_count=1,
                    skipped_count=0,
                    failed_count=0,
                    raw_uploaded_count=1,
                    raw_reused_count=0,
                    document_ids=(f"official_web:{collection}:article_detail:doc",),
                    unresolved_source_pdfs=(),
                    errors=(),
                    report_path=str(root / f"{collection}-import-report.json"),
                    created_document_ids=(f"official_web:{collection}:article_detail:doc",),
                )

            with patch(
                "campus_ingestion_worker.official_web_handoff_consumer_runtime.import_projection_output",
                side_effect=fake_import_projection_output,
            ):
                report = consumer_runtime.persist_projection_output(
                    work_dir=work_dir,
                    projection_output_dir=projection_output_dir,
                    replay_input_dir=replay_input_dir,
                    bundle_payload={"pages": [{}]},
                    source_object_store=object(),
                    derived_object_store=object(),
                    document_registry=InMemoryDocumentRegistry(),
                    raw_asset_registry=InMemoryRawAssetRegistry(),
                    object_store_settings=ObjectStoreSettings(
                        endpoint="http://localhost:9000",
                        access_key="minio",
                        secret_key="minio-secret",
                    ),
                )

            self.assertEqual(
                calls,
                [
                    ("official_web", "muc_public_pages"),
                    ("official_web", "stable_reference"),
                ],
            )
            self.assertEqual(report.success_count, 2)
            self.assertEqual(report.raw_uploaded_count, 2)
            self.assertEqual(report.skipped_count, 0)
            self.assertEqual(
                report.document_ids,
                (
                    "official_web:muc_public_pages:article_detail:doc",
                    "official_web:stable_reference:article_detail:doc",
                ),
            )

    def test_consume_handoff_record_blocks_promote_when_projection_documents_are_audit_only(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inbox_dir = root / "inbox"
            execution_root_dir = root / "executions"
            record_path = inbox_dir / "owevt_completed_audit_only.json"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())

            bundle = _bundle_payload()
            _write_json(
                record_path,
                _handoff_record(
                    event_id="owevt_completed_audit_only",
                    run_id="owrun_projection_001",
                    site_id="campus_public",
                ),
            )
            object_store = FakeReplayObjectStore(_standard_bundle_objects(bundle=bundle))
            document_registry = InMemoryDocumentRegistry()
            raw_asset_registry = InMemoryRawAssetRegistry()

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
                        counts={"pages_seen": 1, "emitted_documents": 1, "manual_review_pages": 0},
                        documents=[
                            {
                                "document_id": "official_web:muc_public:article_detail:test-audit-only",
                                "version_id": "owdocver:test-audit-only",
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
                                "canonical_markdown_path": str(root / "placeholder.md"),
                                "document_units_path": str(root / "placeholder.jsonl"),
                                "serving_intent": "audit_only",
                                "promotion_block_reason": "manual_review_pending",
                            }
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
                        counts={"documents": 1, "errors": 0, "warnings": 0},
                    ),
                ),
                patch(
                    "campus_ingestion_worker.official_web_handoff_consumer.audit_official_web_projection_chunking",
                    return_value=OfficialWebProjectionChunkingAuditReport(
                        schema_version="official_web_projection_chunking_audit.v1",
                        projection_output_dir=str(execution_root_dir / "projection"),
                        passed=True,
                        document_count=1,
                        total_units=1,
                        total_chunks=1,
                        issue_counts={},
                        documents=(),
                    ),
                ),
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
                    document_registry=document_registry,
                    raw_asset_registry=raw_asset_registry,
                    derived_object_store=object_store,
                )

            self.assertEqual(result.status, "staged")
            execution_report = json.loads(
                Path(result.execution_report_path or "").read_text(encoding="utf-8")
            )
            blocked_codes = {
                item["code"] for item in execution_report["promotion"]["blockedChecks"]
            }
            self.assertIn("promotable_documents_present", blocked_codes)
            self.assertEqual(execution_report["status"], "staged")
            self.assertIsNone(execution_report["import"])
            self.assertTrue(execution_report["validation"]["valid"])
            self.assertIsNotNone(execution_report["chunkAudit"])
            self.assertEqual(execution_report["promotion"]["decision"], "blocked")
            self.assertFalse(execution_report["promotion"]["eligible"])

    def test_consume_handoff_record_blocks_promote_when_projection_documents_have_unknown_serving_intent(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inbox_dir = root / "inbox"
            execution_root_dir = root / "executions"
            record_path = inbox_dir / "owevt_completed_unknown_intent.json"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())

            bundle = _bundle_payload()
            _write_json(
                record_path,
                _handoff_record(
                    event_id="owevt_completed_unknown_intent",
                    run_id="owrun_projection_001",
                    site_id="campus_public",
                ),
            )
            object_store = FakeReplayObjectStore(_standard_bundle_objects(bundle=bundle))
            document_registry = InMemoryDocumentRegistry()
            raw_asset_registry = InMemoryRawAssetRegistry()

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
                        counts={"pages_seen": 1, "emitted_documents": 1, "manual_review_pages": 0},
                        documents=[
                            {
                                "document_id": "official_web:muc_public:article_detail:test-unknown-intent",
                                "version_id": "owdocver:test-unknown-intent",
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
                                "canonical_markdown_path": str(root / "placeholder.md"),
                                "document_units_path": str(root / "placeholder.jsonl"),
                            }
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
                        counts={"documents": 1, "errors": 0, "warnings": 0},
                    ),
                ),
                patch(
                    "campus_ingestion_worker.official_web_handoff_consumer.audit_official_web_projection_chunking",
                    return_value=OfficialWebProjectionChunkingAuditReport(
                        schema_version="official_web_projection_chunking_audit.v1",
                        projection_output_dir=str(execution_root_dir / "projection"),
                        passed=True,
                        document_count=1,
                        total_units=1,
                        total_chunks=1,
                        issue_counts={},
                        documents=(),
                    ),
                ),
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
                    document_registry=document_registry,
                    raw_asset_registry=raw_asset_registry,
                    derived_object_store=object_store,
                )

            self.assertEqual(result.status, "staged")
            execution_report = json.loads(
                Path(result.execution_report_path or "").read_text(encoding="utf-8")
            )
            blocked_codes = {
                item["code"] for item in execution_report["promotion"]["blockedChecks"]
            }
            self.assertIn("recognized_serving_intent", blocked_codes)
            self.assertEqual(
                execution_report["coverage"]["documentServingIntentCounts"]["unknown"], 1
            )
            self.assertEqual(execution_report["promotion"]["decision"], "blocked")
            self.assertFalse(execution_report["promotion"]["eligible"])

    def test_consume_handoff_record_blocks_promote_when_target_workset_lineage_is_missing(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inbox_dir = root / "inbox"
            execution_root_dir = root / "executions"
            record_path = inbox_dir / "owevt_completed_missing_target_lineage.json"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())

            bundle = _bundle_payload()
            bundle["collectionMode"] = "target-workset"
            _write_json(
                record_path,
                _handoff_record(
                    event_id="owevt_completed_missing_target_lineage",
                    run_id="owrun_projection_001",
                    site_id="campus_public",
                ),
            )
            object_store = FakeReplayObjectStore(_standard_bundle_objects(bundle=bundle))
            document_registry = InMemoryDocumentRegistry()
            raw_asset_registry = InMemoryRawAssetRegistry()

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
                        counts={
                            "pages_seen": 1,
                            "emitted_documents": 1,
                            "manual_review_pages": 0,
                            "target_lineage_issue_pages": 1,
                        },
                        documents=[
                            {
                                "document_id": "official_web:muc_public:article_detail:test-missing-lineage",
                                "version_id": "owdocver:test-missing-lineage",
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
                                "canonical_markdown_path": str(root / "placeholder.md"),
                                "document_units_path": str(root / "placeholder.jsonl"),
                                "serving_intent": "promotable",
                                "promotion_block_reason": None,
                            }
                        ],
                        manual_review_pages=[],
                        target_family_counts={},
                        target_materialization_policy_counts={},
                        target_lineage_issues=[
                            {
                                "code": "missing_target_lineage",
                                "raw_asset_id": "owasset_article_001",
                                "raw_version_id": "owver_article_001",
                                "normalized_canonical_url": "https://www.example.edu/news/1",
                            }
                        ],
                    ),
                ),
                patch(
                    "campus_ingestion_worker.official_web_handoff_consumer.validate_official_web_projection_output",
                    return_value=OfficialWebProjectionValidationReport(
                        schema_version="official_web_projection_validation_report.v1",
                        valid=True,
                        projection_output_dir=str(execution_root_dir / "projection"),
                        issues=[],
                        counts={"documents": 1, "errors": 0, "warnings": 0},
                    ),
                ),
                patch(
                    "campus_ingestion_worker.official_web_handoff_consumer.audit_official_web_projection_chunking",
                    return_value=OfficialWebProjectionChunkingAuditReport(
                        schema_version="official_web_projection_chunking_audit.v1",
                        projection_output_dir=str(execution_root_dir / "projection"),
                        passed=True,
                        document_count=1,
                        total_units=1,
                        total_chunks=1,
                        issue_counts={},
                        documents=(),
                    ),
                ),
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
                    document_registry=document_registry,
                    raw_asset_registry=raw_asset_registry,
                    derived_object_store=object_store,
                )

            self.assertEqual(result.status, "staged")
            execution_report = json.loads(
                Path(result.execution_report_path or "").read_text(encoding="utf-8")
            )
            blocked_codes = {
                item["code"] for item in execution_report["promotion"]["blockedChecks"]
            }
            self.assertIn("target_lineage_valid", blocked_codes)
            self.assertEqual(execution_report["promotion"]["decision"], "blocked")
            self.assertFalse(execution_report["promotion"]["eligible"])

    def test_consume_handoff_record_keeps_low_coverage_batch_staged_when_promote_requested(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            inbox_dir = root / "inbox"
            execution_root_dir = root / "executions"
            record_path = inbox_dir / "owevt_completed_low_coverage.json"
            declarations_path = root / "projection-declarations.json"
            _write_json(declarations_path, _declarations_payload())

            bundle = _bundle_payload()
            _write_json(
                record_path,
                _handoff_record(
                    event_id="owevt_completed_low_coverage",
                    run_id="owrun_projection_001",
                    site_id="campus_public",
                    host_set=["www.example.edu", "news.example.edu"],
                    seed_set=[
                        "https://www.example.edu/",
                        "https://www.example.edu/news/",
                        "https://news.example.edu/",
                        "https://news.example.edu/list/",
                    ],
                    pages_normalized=1,
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
                    promote_import=True,
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
                tuple(document_registry.list_by_scope("official_web", "muc_public_pages")), ()
            )
            self.assertEqual(
                tuple(raw_asset_registry.list_by_scope("official_web", "muc_public_pages")), ()
            )
            self.assertEqual(
                [call["payload"]["status"] for call in reporter.calls], ["running", "staged"]
            )
            self.assertEqual(reporter.calls[-1]["payload"]["errorCode"], "promotion_blocked")

            execution_report = json.loads(
                Path(result.execution_report_path or "").read_text(encoding="utf-8")
            )
            self.assertEqual(execution_report["status"], "staged")
            self.assertIsNone(execution_report["import"])
            self.assertEqual(execution_report["promotion"]["decision"], "blocked")
            self.assertFalse(execution_report["promotion"]["eligible"])
            blocked_codes = {
                item["code"] for item in execution_report["promotion"]["blockedChecks"]
            }
            self.assertIn("minimum_promote_pages", blocked_codes)
            self.assertIn("seed_coverage_ratio", blocked_codes)
