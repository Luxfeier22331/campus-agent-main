from __future__ import annotations

import importlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

_MODULE_NAME = "campus_ingestion_worker.plan_historical_regulation_chunk_backfill"


class PlanHistoricalRegulationChunkBackfillWorkerTest(unittest.TestCase):
    def test_worker_writes_phase0_evidence_files(self) -> None:
        worker = importlib.import_module(_MODULE_NAME)
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            phase13_path = root / "canonical-backfill-report.json"
            first_path = root / "first/materialization.execute.json"
            manual_path = root / "manual/materialization.execute.json"
            output_dir = root / "phase-00"
            _write_json(phase13_path, {"selected_notice_ids": ["619"]})
            _write_json(first_path, {"materialized_documents": []})
            _write_json(manual_path, {"materialized_documents": []})
            expected = {
                "target_inventory": {"schema_version": "target-inventory.v1"},
                "classification_report": {"schema_version": "classification-report.v1"},
                "canonical_provenance_preflight": {
                    "schema_version": "canonical-provenance-preflight.v1"
                },
                "serving_closed_assertion": {
                    "schema_version": "historical-regulation-serving-closed-assertion.v1"
                },
                "candidate_store_noop_assertion": {
                    "schema_version": "historical-regulation-candidate-store-noop-assertion.v1"
                },
                "chunk_only_execution_plan_md": "# Chunk Plan\n",
            }

            with (
                patch(f"{_MODULE_NAME}.load_worker_env"),
                patch(f"{_MODULE_NAME}.build_document_registry_from_env") as build_registry,
                patch(f"{_MODULE_NAME}.ObjectStoreSettings") as settings_class,
                patch(f"{_MODULE_NAME}.S3ObjectStoreWriter") as writer_class,
                patch(
                    f"{_MODULE_NAME}.build_historical_regulation_chunk_backfill_evidence",
                    return_value=expected,
                ) as build_evidence,
            ):
                settings_class.from_env.return_value.bucket_derived = "campus-rag-derived"
                worker.main(
                    [
                        "--phase13-report-path",
                        str(phase13_path),
                        "--first-batch-materialization-path",
                        str(first_path),
                        "--manual-review-materialization-path",
                        str(manual_path),
                        "--output-dir",
                        str(output_dir),
                    ]
                )

                self.assertTrue((output_dir / "target-inventory.json").exists())
                self.assertTrue((output_dir / "classification-report.json").exists())
                self.assertTrue((output_dir / "canonical-provenance-preflight.json").exists())
                self.assertTrue((output_dir / "serving-closed-assertion.json").exists())
                self.assertTrue((output_dir / "candidate-store-noop-assertion.json").exists())
                self.assertEqual(
                    (output_dir / "chunk-only-execution-plan.md").read_text(),
                    "# Chunk Plan\n",
                )

        build_evidence.assert_called_once()
        build_registry.assert_called_once_with(prefer_operator=True)
        writer_class.assert_called_once_with(settings_class.from_env.return_value)


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    unittest.main()
