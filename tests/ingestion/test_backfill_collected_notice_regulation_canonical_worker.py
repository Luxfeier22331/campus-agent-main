from __future__ import annotations

import importlib
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from tests.ingestion.test_collected_notice_regulation_canonical_backfill import (
    _historical_first_batch_candidate_audit,
    _historical_source_objects,
    _object_store_env,
)
from tests.ingestion.test_collected_notice_regulation_canonical_backfill import (
    _first_batch_admission_manifest,
    _FakeObjectStore,
)
from tests.ingestion.test_collected_notice_regulation_manual_review_admission import (
    _candidate_audit as _manual_review_candidate_audit,
    _owner_text_report,
)
from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry

worker = importlib.import_module(
    "campus_ingestion_worker.backfill_collected_notice_regulation_canonical"
)


class BackfillCollectedNoticeRegulationCanonicalWorkerTests(unittest.TestCase):
    def test_worker_writes_phase13_evidence_without_opening_rag_release(self) -> None:
        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            input_dir = root / "inputs"
            output_dir = root / "phase-13"
            input_dir.mkdir()
            first_candidate_path = input_dir / "first-candidate-audit.json"
            first_manifest_path = input_dir / "first-admission-manifest.json"
            manual_candidate_path = input_dir / "manual-candidate-audit.json"
            owner_text_path = input_dir / "owner-text-report.json"
            _write_json(first_candidate_path, _historical_first_batch_candidate_audit())
            _write_json(first_manifest_path, _first_batch_admission_manifest(("594", "620")))
            _write_json(manual_candidate_path, _manual_review_candidate_audit())
            _write_json(owner_text_path, _owner_text_report())

            report = worker.backfill_collected_notice_regulation_canonical_from_paths(
                request=worker.CollectedNoticeRegulationCanonicalBackfillWorkerRequest(
                    first_batch_candidate_audit_path=first_candidate_path,
                    first_batch_admission_manifest_path=first_manifest_path,
                    manual_review_candidate_audit_path=manual_candidate_path,
                    manual_review_owner_text_execution_report_path=owner_text_path,
                    output_dir=output_dir,
                    first_batch_notice_ids=("594", "620"),
                    manual_review_resolutions={
                        "481": "scoped_rules",
                        "619": "institutional_rules",
                    },
                    execute=False,
                ),
                env=_object_store_env(),
                object_store=_FakeObjectStore(_historical_source_objects()),
                document_registry=InMemoryDocumentRegistry(),
                raw_asset_registry=InMemoryRawAssetRegistry(),
            )

            self.assertEqual(report["phase"], worker.PHASE_13_ID)
            self.assertEqual(report["mode"], "dry_run")
            self.assertFalse(report["write_enabled"])
            self.assertFalse(report["query_serving_opened"])
            self.assertFalse(report["rag_release_opened"])
            self.assertEqual(report["selected_notice_ids"], ["481", "594", "619", "620"])
            self.assertTrue(Path(report["files"]["canonical-backfill-report.json"]).exists())
            self.assertTrue(Path(report["files"]["first-batch/materialization.execute.json"]).exists())
            self.assertTrue(Path(report["files"]["manual-review/materialization.execute.json"]).exists())
            persisted = json.loads(
                Path(report["files"]["canonical-backfill-report.json"]).read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(persisted["normalization_quality"]["verdict"], "passed")


def _write_json(path: Path, payload: object) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    unittest.main()
