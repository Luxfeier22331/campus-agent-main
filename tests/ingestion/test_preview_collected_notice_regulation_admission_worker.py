from __future__ import annotations

import importlib
import json
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.collected_notice_regulation_admission import (
    CollectedNoticeRegulationAdmissionPreview,
)

worker = importlib.import_module(
    "campus_ingestion_worker.preview_collected_notice_regulation_admission"
)


class PreviewCollectedNoticeRegulationAdmissionWorkerTests(unittest.TestCase):
    def test_main_writes_no_write_regulation_evidence_files(self) -> None:
        with TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            output_dir = tmp_path / "phase-06-r1"
            searchable_path = tmp_path / "searchable.json"
            multimodal_path = tmp_path / "multimodal.json"
            queue_trace_path = tmp_path / "queue-trace.json"
            owner_text_report_path = tmp_path / "owner-text-report.json"
            searchable_path.write_text('{"units":[]}\n', encoding="utf-8")
            multimodal_path.write_text('{"candidates":[]}\n', encoding="utf-8")
            queue_trace_path.write_text('{"trace_rows":[]}\n', encoding="utf-8")
            owner_text_report_path.write_text(
                '{"attempt_results":[{"status":"succeeded"}]}\n',
                encoding="utf-8",
            )
            fake_preview = CollectedNoticeRegulationAdmissionPreview(
                admission_manifest={
                    "schema_version": "collected_notice_consumer_admission.v1",
                    "mode": "dry_run",
                    "write_enabled": False,
                    "target": "regulation",
                    "counts": {
                        "entry_count": 3,
                        "downstream_admitted": 1,
                        "needs_multimodal": 1,
                        "search_only": 1,
                    },
                },
                candidate_audit={
                    "schema_version": "collected_notice_regulation_candidate_audit.v1",
                    "candidate_count": 3,
                    "class_counts": {
                        "institutional_rules_candidate": 1,
                        "needs_multimodal": 1,
                        "wrapper_only_searchable": 1,
                    },
                },
                rejected_deferred_source_report={
                    "schema_version": "collected_notice_regulation_rejected_deferred.v1",
                    "entry_count": 2,
                },
                source_to_searchable_trace={
                    "schema_version": "collected_notice_regulation_source_trace.v1",
                    "entry_count": 3,
                },
            )

            with (
                patch(
                    "campus_ingestion_worker.preview_collected_notice_regulation_admission."
                    "load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.preview_collected_notice_regulation_admission."
                    "build_collected_notice_regulation_admission_preview_from_paths",
                    return_value=fake_preview,
                ) as build_preview,
                patch(
                    "campus_ingestion_worker.preview_collected_notice_regulation_admission."
                    "build_runtime_object_store",
                    return_value=object(),
                ),
                redirect_stdout(StringIO()) as stdout,
            ):
                worker.main(
                    [
                        "--searchable-notice-preview-path",
                        str(searchable_path),
                        "--multimodal-candidate-inventory-path",
                        str(multimodal_path),
                        "--queue-consume-trace-path",
                        str(queue_trace_path),
                        "--output-dir",
                        str(output_dir),
                        "--owner-text-execution-report-path",
                        str(owner_text_report_path),
                    ]
                )

            build_preview.assert_called_once()
            self.assertEqual(
                build_preview.call_args.kwargs["owner_text_execution_report_path"],
                owner_text_report_path,
            )
            self.assertEqual(
                {
                    "regulation-consumer-admission-manifest.json",
                    "regulation-candidate-audit.json",
                    "regulation-rejected-deferred-source-report.json",
                    "regulation-source-to-searchable-trace.json",
                },
                {path.name for path in output_dir.glob("*.json")},
            )
            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["mode"], "dry_run")
            self.assertFalse(payload["write_enabled"])
            self.assertEqual(payload["target"], "regulation")
            self.assertEqual(payload["entry_count"], 3)
            self.assertEqual(payload["downstream_admitted"], 1)
            self.assertEqual(payload["rejected_deferred_count"], 2)
            self.assertEqual(payload["candidate_count"], 3)


if __name__ == "__main__":
    unittest.main()
