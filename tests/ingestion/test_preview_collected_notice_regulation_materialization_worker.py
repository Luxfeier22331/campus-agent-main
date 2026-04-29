from __future__ import annotations

import importlib
import json
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.collected_notice_regulation_materialization_preview import (
    CollectedNoticeRegulationMaterializationPreview,
)

worker = importlib.import_module(
    "campus_ingestion_worker.preview_collected_notice_regulation_materialization"
)


class PreviewCollectedNoticeRegulationMaterializationWorkerTests(unittest.TestCase):
    def test_main_writes_phase_6r2_no_write_evidence_files(self) -> None:
        with TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            admission_path = tmp_path / "admission.json"
            output_dir = tmp_path / "phase-06-r2"
            admission_path.write_text('{"entries":[]}\n', encoding="utf-8")
            fake_preview = CollectedNoticeRegulationMaterializationPreview(
                institutional_rules_materialization={
                    "schema_version": "collected_notice_regulation_materialization_preview.v1",
                    "target_collection": "institutional_rules",
                    "document_count": 1,
                    "documents": [],
                },
                scoped_rules_materialization={
                    "schema_version": "collected_notice_regulation_materialization_preview.v1",
                    "target_collection": "scoped_rules",
                    "document_count": 2,
                    "documents": [],
                },
                duplicate_provenance_aggregation_report={
                    "schema_version": "collected_notice_regulation_duplicate_provenance_report.v1",
                    "duplicate_group_count": 0,
                    "groups": [],
                },
                consistency_report={
                    "schema_version": "collected_notice_regulation_materialization_consistency.v1",
                    "verdict": "passed",
                    "counts": {
                        "downstream_admitted": 3,
                        "institutional_rules_document_count": 1,
                        "scoped_rules_document_count": 2,
                    },
                },
                source_to_target_trace={
                    "schema_version": "collected_notice_regulation_source_to_target_trace.v1",
                    "entry_count": 3,
                    "entries": [],
                },
                normalization_quality_report={
                    "schema_version": "collected_notice_regulation_normalization_quality_report.v1",
                    "verdict": "passed",
                    "document_count": 3,
                    "documents": [],
                },
                before_after_report={
                    "schema_version": "collected_notice_regulation_normalization_before_after.v1",
                    "document_count": 3,
                    "documents": [],
                },
            )

            with (
                patch(
                    "campus_ingestion_worker.preview_collected_notice_regulation_materialization."
                    "load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.preview_collected_notice_regulation_materialization."
                    "build_runtime_object_store",
                    return_value=object(),
                ) as build_store,
                patch(
                    "campus_ingestion_worker.preview_collected_notice_regulation_materialization."
                    "build_collected_notice_regulation_materialization_preview_from_paths",
                    return_value=fake_preview,
                ) as build_preview,
                redirect_stdout(StringIO()) as stdout,
            ):
                worker.main(
                    [
                        "--admission-manifest-path",
                        str(admission_path),
                        "--output-dir",
                        str(output_dir),
                    ]
                )

            build_store.assert_called_once()
            build_preview.assert_called_once()
            self.assertEqual(
                build_preview.call_args.kwargs["admission_manifest_path"],
                admission_path,
            )
            self.assertEqual(
                {
                    "institutional-rules-materialization.normalized.dry-run.json",
                    "scoped-rules-materialization.normalized.dry-run.json",
                    "duplicate-provenance-aggregation-report.json",
                    "regulation-normalization-before-after-report.json",
                    "regulation-normalization-consistency-report.json",
                    "regulation-normalization-quality-report.json",
                    "regulation-source-to-target-trace.json",
                },
                {path.name for path in output_dir.glob("*.json")},
            )
            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["mode"], "dry_run")
            self.assertFalse(payload["write_enabled"])
            self.assertEqual(payload["institutional_rules_document_count"], 1)
            self.assertEqual(payload["scoped_rules_document_count"], 2)
            self.assertEqual(payload["consistency_verdict"], "passed")


if __name__ == "__main__":
    unittest.main()
