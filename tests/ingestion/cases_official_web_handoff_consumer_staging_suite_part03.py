# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.ingestion.official_web_handoff_consumer_staging_suite_support import *


class OfficialWebHandoffConsumerStagingTestPart03(unittest.TestCase):
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


if __name__ == "__main__":
    unittest.main()
