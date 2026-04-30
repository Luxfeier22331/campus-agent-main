from __future__ import annotations

import importlib
import io
import json
import os
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from tests.ingestion.test_collected_notice_regulation_first_batch_promotion import (
    _candidate_audit,
    _consistency_report,
    _FakeObjectStore,
    _materialization_report,
    _source_ref_objects,
    _target_document,
)
from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry

worker = importlib.import_module(
    "campus_ingestion_worker.promote_collected_notice_regulation_first_batch"
)


class PromoteCollectedNoticeRegulationFirstBatchWorkerTests(unittest.TestCase):
    def test_main_writes_phase09_preflight_evidence_without_execute_by_default(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            input_dir = root / "inputs"
            output_dir = root / "phase09"
            input_dir.mkdir()
            _write_json(input_dir / "candidate-audit.json", _candidate_audit())
            _write_json(input_dir / "consistency.json", _consistency_report())
            _write_json(
                input_dir / "institutional.json",
                _materialization_report(
                    target_collection="institutional_rules",
                    documents=[
                        _target_document(source_notice_id="594", collection="institutional_rules")
                    ],
                ),
            )
            _write_json(
                input_dir / "scoped.json",
                _materialization_report(
                    target_collection="scoped_rules",
                    documents=[_target_document(source_notice_id="620", collection="scoped_rules")],
                ),
            )

            with (
                patch(
                    "campus_ingestion_worker.promote_collected_notice_regulation_first_batch.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.promote_collected_notice_regulation_first_batch.build_runtime_object_store",
                    return_value=_FakeObjectStore(_source_ref_objects()),
                ),
                patch(
                    "campus_ingestion_worker.promote_collected_notice_regulation_first_batch.build_runtime_document_registry",
                    return_value=InMemoryDocumentRegistry(),
                ),
                patch(
                    "campus_ingestion_worker.promote_collected_notice_regulation_first_batch.build_runtime_raw_asset_registry",
                    return_value=InMemoryRawAssetRegistry(),
                ),
                patch.dict(
                    os.environ,
                    {
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
                        "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    },
                ),
                patch("sys.stdout", new_callable=io.StringIO) as stdout,
            ):
                worker.main(
                    [
                        "--candidate-audit-path",
                        str(input_dir / "candidate-audit.json"),
                        "--consistency-report-path",
                        str(input_dir / "consistency.json"),
                        "--institutional-materialization-path",
                        str(input_dir / "institutional.json"),
                        "--scoped-materialization-path",
                        str(input_dir / "scoped.json"),
                        "--output-dir",
                        str(output_dir),
                        "--notice-id",
                        "594",
                        "--notice-id",
                        "620",
                    ]
                )

            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["mode"], "dry_run")
            self.assertFalse(payload["write_enabled"])
            self.assertEqual(payload["selected_notice_ids"], ["594", "620"])
            self.assertTrue(Path(payload["files"]["first-batch-selection.json"]).exists())
            materialization = json.loads(
                Path(payload["files"]["materialization.execute.json"]).read_text(encoding="utf-8")
            )
            self.assertEqual(materialization["materialized_document_count"], 0)


def _write_json(path: Path, payload: object) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    unittest.main()
