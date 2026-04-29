from __future__ import annotations

import importlib
import json
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.collected_notice_downstream_pilot import (
    CollectedNoticeDownstreamPilotPreview,
)

worker = importlib.import_module(
    "campus_ingestion_worker.preview_collected_notice_downstream_pilot"
)


class PreviewCollectedNoticeDownstreamPilotWorkerTests(unittest.TestCase):
    def test_main_writes_pilot_evidence_files(self) -> None:
        with TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            output_dir = tmp_path / "pilot"
            searchable_path = tmp_path / "searchable.json"
            multimodal_path = tmp_path / "multimodal.json"
            searchable_path.write_text('{"units":[]}\n', encoding="utf-8")
            multimodal_path.write_text('{"candidates":[]}\n', encoding="utf-8")
            fake_preview = CollectedNoticeDownstreamPilotPreview(
                admission_manifest={
                    "schema_version": "collected_notice_consumer_admission.v1",
                    "mode": "dry_run",
                    "write_enabled": False,
                    "counts": {"downstream_admitted": 1},
                },
                replay_dry_run={
                    "schema_version": "collected_notice_downstream_replay_dry_run.v1",
                    "mode": "dry_run",
                    "write_enabled": False,
                    "extracted_schedule_row_count": 1,
                },
                stage_report={
                    "schema_version": "collected_notice_downstream_stage_report.v1",
                    "mode": "dry_run",
                    "write_enabled": False,
                    "current_promotion_enabled": False,
                    "stage_candidate_count": 1,
                },
                consistency_report={
                    "schema_version": "collected_notice_downstream_consistency_report.v1",
                    "mode": "dry_run",
                    "verdict": "passed",
                },
                source_to_searchable_downstream_trace={
                    "schema_version": "collected_notice_downstream_trace.v1",
                    "mode": "dry_run",
                },
                rejected_deferred_source_report={
                    "schema_version": "collected_notice_rejected_deferred_sources.v1",
                    "mode": "dry_run",
                    "entry_count": 0,
                },
            )

            with (
                patch(
                    "campus_ingestion_worker.preview_collected_notice_downstream_pilot."
                    "load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.preview_collected_notice_downstream_pilot."
                    "build_transport_schedule_single_notice_pilot_preview_from_paths",
                    return_value=fake_preview,
                ) as build_preview,
                redirect_stdout(StringIO()) as stdout,
            ):
                worker.main(
                    [
                        "--searchable-notice-preview-path",
                        str(searchable_path),
                        "--multimodal-candidate-inventory-path",
                        str(multimodal_path),
                        "--source-notice-id",
                        "355512",
                        "--output-dir",
                        str(output_dir),
                    ]
                )

            build_preview.assert_called_once()
            self.assertEqual(
                {path.name for path in output_dir.glob("*.json")},
                {
                    "consumer-admission-manifest.json",
                    "replay.dry-run.json",
                    "stage-report.json",
                    "consistency-report.json",
                    "source-to-searchable-downstream-trace.json",
                    "rejected-deferred-source-report.json",
                },
            )
            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["mode"], "dry_run")
            self.assertFalse(payload["write_enabled"])
            self.assertFalse(payload["current_promotion_enabled"])
            self.assertEqual(payload["target"], "transport_schedule")

    def test_main_writes_batch_evidence_files(self) -> None:
        with TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            output_dir = tmp_path / "batch"
            searchable_path = tmp_path / "searchable.json"
            multimodal_path = tmp_path / "multimodal.json"
            searchable_path.write_text('{"units":[]}\n', encoding="utf-8")
            multimodal_path.write_text('{"candidates":[]}\n', encoding="utf-8")
            fake_preview = CollectedNoticeDownstreamPilotPreview(
                admission_manifest={
                    "schema_version": "collected_notice_consumer_admission.v1",
                    "mode": "dry_run",
                    "write_enabled": False,
                    "transport_baseline": {
                        "status": "available",
                        "effective_date": "2026-03-01",
                    },
                    "counts": {"downstream_admitted": 1, "entry_count": 4},
                },
                replay_dry_run={
                    "schema_version": "collected_notice_downstream_replay_dry_run.v1",
                    "mode": "dry_run",
                    "write_enabled": False,
                    "source_notice_ids": ["355122", "355512", "355867", "355881"],
                    "extracted_schedule_row_count": 1,
                },
                stage_report={
                    "schema_version": "collected_notice_downstream_stage_report.v1",
                    "mode": "dry_run",
                    "write_enabled": False,
                    "current_promotion_enabled": False,
                    "stage_candidate_count": 1,
                },
                consistency_report={
                    "schema_version": "collected_notice_downstream_consistency_report.v1",
                    "mode": "dry_run",
                    "verdict": "passed",
                },
                source_to_searchable_downstream_trace={
                    "schema_version": "collected_notice_downstream_trace.v1",
                    "mode": "dry_run",
                },
                rejected_deferred_source_report={
                    "schema_version": "collected_notice_rejected_deferred_sources.v1",
                    "mode": "dry_run",
                    "entry_count": 3,
                },
            )

            with (
                patch(
                    "campus_ingestion_worker.preview_collected_notice_downstream_pilot."
                    "load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.preview_collected_notice_downstream_pilot."
                    "build_transport_schedule_batch_preview_from_paths",
                    return_value=fake_preview,
                ) as build_preview,
                redirect_stdout(StringIO()) as stdout,
            ):
                worker.main(
                    [
                        "--mode",
                        "batch",
                        "--searchable-notice-preview-path",
                        str(searchable_path),
                        "--multimodal-candidate-inventory-path",
                        str(multimodal_path),
                        "--output-dir",
                        str(output_dir),
                        "--transport-baseline-effective-date",
                        "2026-03-01",
                    ]
                )

            build_preview.assert_called_once()
            self.assertEqual(
                build_preview.call_args.kwargs["transport_baseline_effective_date"],
                "2026-03-01",
            )
            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["selection_mode"], "batch")
            self.assertEqual(payload["transport_baseline_status"], "available")
            self.assertEqual(payload["transport_baseline_effective_date"], "2026-03-01")
            self.assertNotIn("source_notice_id", payload)
            self.assertEqual(payload["source_notice_ids"], ["355122", "355512", "355867", "355881"])
            self.assertEqual(payload["entry_count"], 4)
            self.assertEqual(payload["rejected_deferred_count"], 3)
            self.assertFalse(payload["write_enabled"])
            self.assertFalse(payload["current_promotion_enabled"])


if __name__ == "__main__":
    unittest.main()
