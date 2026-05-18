from __future__ import annotations

import importlib
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from tests.ingestion.test_collected_notice_regulation_manual_review_admission import (
    _candidate_audit,
    _owner_text_report,
    object_store_with_manual_review_sources,
)
from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry

worker = importlib.import_module(
    "campus_ingestion_worker.promote_collected_notice_regulation_manual_review_batch"
)


class PromoteCollectedNoticeRegulationManualReviewBatchWorkerTests(unittest.TestCase):
    def test_dry_run_writes_phase11_evidence_without_serving_or_registry_writes(self) -> None:
        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            candidate_path = root / "candidate-audit.json"
            owner_text_path = root / "owner-text.json"
            output_dir = root / "phase-11"
            candidate_path.write_text(
                json.dumps(_candidate_audit(), ensure_ascii=False),
                encoding="utf-8",
            )
            owner_text_path.write_text(
                json.dumps(_owner_text_report(), ensure_ascii=False),
                encoding="utf-8",
            )
            registry = InMemoryDocumentRegistry()
            object_store = object_store_with_manual_review_sources()

            report = worker.promote_collected_notice_regulation_manual_review_batch(
                request=worker.ManualReviewRegulationPromotionRequest(
                    candidate_audit_path=candidate_path,
                    owner_text_execution_report_path=owner_text_path,
                    output_dir=output_dir,
                    resolutions={
                        "481": "scoped_rules",
                        "619": "institutional_rules",
                    },
                    execute=False,
                ),
                env=_object_store_env(),
                object_store=object_store,
                document_registry=registry,
                raw_asset_registry=InMemoryRawAssetRegistry(),
            )

            self.assertEqual(report["phase"], worker.PHASE_11_ID)
            self.assertEqual(report["mode"], "dry_run")
            self.assertFalse(report["write_enabled"])
            self.assertEqual(report["selected_notice_ids"], ["481", "619"])
            self.assertEqual(report["materialized_document_count"], 0)
            self.assertFalse(report["query_serving_opened"])
            self.assertFalse(report["rag_release_opened"])
            self.assertEqual(registry.list_by_scope("regulations", "institutional_rules"), ())
            self.assertEqual(registry.list_by_scope("regulations", "scoped_rules"), ())
            self.assertEqual(object_store.puts, [])
            self.assertEqual(
                {
                    "manual-review-resolution-report.json",
                    "manual-review-resolved-admission-manifest.json",
                    "manual-review-resolved-candidate-audit.json",
                    "selected-batch-selection.json",
                    "admission-preflight-report.json",
                    "materialization.execute.json",
                    "serving-closed-assertion.json",
                }.issubset(set(report["files"])),
                True,
            )


def _object_store_env() -> dict[str, str]:
    return {
        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
        "OBJECT_STORE_SECRET_KEY": "minioadmin",
        "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
        "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
        "EMBEDDING_MODEL": "mock-embedding-8d",
    }


if __name__ == "__main__":
    unittest.main()
