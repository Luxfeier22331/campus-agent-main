from __future__ import annotations

import importlib
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

_MODULE_NAME = "campus_ingestion_worker.prepare_historical_regulation_chunk_backfill"


class PrepareHistoricalRegulationChunkBackfillWorkerTest(unittest.TestCase):
    def test_worker_writes_chunk_only_evidence_files(self) -> None:
        worker = importlib.import_module(_MODULE_NAME)
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            phase0_dir = root / "phase-00"
            output_dir = root / "phase-04"
            _write_json(phase0_dir / "classification-report.json", {"records": []})
            _write_json(phase0_dir / "canonical-provenance-preflight.json", {"records": []})
            expected = {
                "chunk_preparation_batch_report": {
                    "schema_version": "historical-regulation-chunk-preparation-batch.v1",
                    "target_count": 0,
                },
                "serving_closed_assertion": {
                    "schema_version": "historical-regulation-serving-closed-assertion.v1"
                },
                "candidate_store_noop_assertion": {
                    "schema_version": "historical-regulation-candidate-store-noop-assertion.v1"
                },
            }

            with (
                patch(f"{_MODULE_NAME}.load_worker_env"),
                patch(f"{_MODULE_NAME}.build_document_registry_from_env") as build_registry,
                patch(f"{_MODULE_NAME}.ObjectStoreSettings") as settings_class,
                patch(f"{_MODULE_NAME}.S3ObjectStoreWriter") as writer_class,
                patch(
                    f"{_MODULE_NAME}.prepare_historical_regulation_chunk_backfill_chunks",
                    return_value=expected,
                ) as prepare_chunks,
            ):
                settings_class.from_env.return_value.bucket_derived = "campus-rag-derived"
                worker.main(
                    [
                        "--phase0-dir",
                        str(phase0_dir),
                        "--output-dir",
                        str(output_dir),
                    ]
                )

            prepare_chunks.assert_called_once()
            build_registry.assert_called_once_with(prefer_operator=True)
            writer_class.assert_called_once_with(settings_class.from_env.return_value)
            self.assertTrue((output_dir / "chunk-preparation-batch-report.json").exists())
            self.assertTrue((output_dir / "serving-closed-assertion.json").exists())
            self.assertTrue((output_dir / "candidate-store-noop-assertion.json").exists())


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    unittest.main()
