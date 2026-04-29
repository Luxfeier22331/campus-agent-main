from __future__ import annotations

import importlib
import json
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

worker = importlib.import_module("campus_ingestion_worker.preview_schedule_image_ocr_mini_batch")


class PreviewScheduleImageOcrMiniBatchWorkerTests(unittest.TestCase):
    def test_main_writes_manifest_outputs(self) -> None:
        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            admission_path = root / "admission.json"
            inventory_path = root / "inventory.json"
            output_dir = root / "out"
            admission_path.write_text('{"entries":[]}\n', encoding="utf-8")
            inventory_path.write_text('{"candidates":[]}\n', encoding="utf-8")
            fake_payload = {
                "execution_manifest": {"schema_version": "manifest", "counts": {}},
                "evidence_inventory": [],
                "gap_report": {"schema_version": "gap"},
            }

            with (
                patch(
                    "campus_ingestion_worker.preview_schedule_image_ocr_mini_batch.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.preview_schedule_image_ocr_mini_batch."
                    "build_schedule_image_ocr_mini_batch_manifest_from_paths",
                    return_value=fake_payload,
                ) as build_manifest,
                redirect_stdout(StringIO()) as stdout,
            ):
                worker.main(
                    [
                        "--consumer-admission-manifest-path",
                        str(admission_path),
                        "--multimodal-candidate-inventory-path",
                        str(inventory_path),
                        "--output-dir",
                        str(output_dir),
                    ]
                )

            build_manifest.assert_called_once()
            self.assertEqual(
                {path.name for path in output_dir.glob("*.json")},
                {
                    "schedule-image-ocr-execution-manifest.json",
                    "schedule-image-ocr-evidence-inventory.json",
                    "schedule-image-ocr-gap-report.json",
                },
            )
            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["mode"], "manifest")
            self.assertFalse(payload["write_enabled"])

    def test_main_writes_post_run_outputs_when_ocr_output_is_supplied(self) -> None:
        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            searchable_path = root / "searchable.json"
            manifest_path = root / "manifest.json"
            ocr_output_dir = root / "ocr"
            output_dir = root / "out"
            searchable_path.write_text('{"units":[]}\n', encoding="utf-8")
            manifest_path.write_text('{"entries":[]}\n', encoding="utf-8")
            fake_payload = {
                "searchable_merge_preview": {"schema_version": "merge"},
                "transport_replay_dry_run": {"extracted_schedule_row_count": 2},
                "transport_stage_report": {"stage_candidate_count": 2},
                "transport_consistency_report": {"verdict": "passed"},
                "post_run_gap_report": {"verdict": "ready_for_transport_replay"},
            }

            with (
                patch(
                    "campus_ingestion_worker.preview_schedule_image_ocr_mini_batch.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.preview_schedule_image_ocr_mini_batch."
                    "build_schedule_image_ocr_mini_batch_post_run_preview_from_paths",
                    return_value=fake_payload,
                ) as build_preview,
                redirect_stdout(StringIO()) as stdout,
            ):
                worker.main(
                    [
                        "--mode",
                        "post-run",
                        "--searchable-notice-preview-path",
                        str(searchable_path),
                        "--execution-manifest-path",
                        str(manifest_path),
                        "--ocr-output-dir",
                        str(ocr_output_dir),
                        "--output-dir",
                        str(output_dir),
                    ]
                )

            build_preview.assert_called_once()
            self.assertEqual(
                {path.name for path in output_dir.glob("*.json")},
                {
                    "schedule-image-ocr-searchable-merge-preview.json",
                    "transport-ocr-replay.dry-run.json",
                    "transport-ocr-stage-report.json",
                    "transport-ocr-consistency-report.json",
                    "schedule-image-ocr-post-run-gap-report.json",
                },
            )
            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["mode"], "post_run")
            self.assertEqual(payload["transport_consistency_verdict"], "passed")


if __name__ == "__main__":
    unittest.main()
