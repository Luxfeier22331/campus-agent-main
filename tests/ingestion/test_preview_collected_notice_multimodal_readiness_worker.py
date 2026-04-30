from __future__ import annotations

import importlib
import json
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.collected_notice_multimodal_readiness import (
    CollectedNoticeMultimodalReadinessPreview,
)

worker = importlib.import_module(
    "campus_ingestion_worker.preview_collected_notice_multimodal_readiness"
)


class PreviewCollectedNoticeMultimodalReadinessWorkerTests(unittest.TestCase):
    def test_main_writes_phase_five_evidence_files_and_contract(self) -> None:
        with TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            output_dir = tmp_path / "phase-05"
            output_dir.mkdir()
            multimodal_report_path = tmp_path / "invalid-defer.json"
            searchable_preview_path = tmp_path / "searchable.json"
            contract_path = tmp_path / "NOTICE-MULTIMODAL-CONSUMPTION-CONTRACT.md"
            multimodal_report_path.write_text('{"needs_multimodal_units":[]}\n')
            searchable_preview_path.write_text('{"units":[]}\n')
            fake_preview = CollectedNoticeMultimodalReadinessPreview(
                candidate_inventory={
                    "schema_version": "notice_multimodal_candidate_inventory.v1",
                    "mode": "dry_run",
                    "write_enabled": False,
                },
                state_mapping_report={
                    "schema_version": "notice_multimodal_state_mapping.v1",
                    "mode": "dry_run",
                },
                ocr_batch_manifest={
                    "schema_version": "notice_multimodal_ocr_batch_manifest.v1",
                    "mode": "dry_run",
                    "write_enabled": False,
                    "provider_calls_enabled": False,
                },
                ocr_attempt_plan={
                    "schema_version": "notice_multimodal_ocr_attempt_plan.v1",
                    "mode": "dry_run",
                },
                searchable_merge_preview={
                    "schema_version": "notice_multimodal_searchable_merge_preview.v1",
                    "mode": "dry_run",
                },
                gap_report={
                    "schema_version": "notice_multimodal_gap_report.v1",
                    "mode": "dry_run",
                },
            )

            with (
                patch(
                    "campus_ingestion_worker.preview_collected_notice_multimodal_readiness."
                    "load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker.preview_collected_notice_multimodal_readiness."
                    "build_collected_notice_multimodal_readiness_preview_from_paths",
                    return_value=fake_preview,
                ) as build_preview,
                redirect_stdout(StringIO()) as stdout,
            ):
                worker.main(
                    [
                        "--invalid-defer-multimodal-report-path",
                        str(multimodal_report_path),
                        "--searchable-notice-preview-path",
                        str(searchable_preview_path),
                        "--output-dir",
                        str(output_dir),
                        "--contract-path",
                        str(contract_path),
                    ]
                )

            build_preview.assert_called_once()
            expected_json_files = {
                "media-extraction-candidate-inventory.json",
                "multimodal-candidate-inventory.json",
                "multimodal-state-mapping-report.json",
                "ocr-batch-manifest.dry-run.json",
                "ocr-attempt-plan.json",
                "multimodal-searchable-merge-preview.json",
                "multimodal-gap-report.json",
            }
            self.assertEqual(
                {path.name for path in output_dir.glob("*.json")},
                expected_json_files,
            )
            manifest = json.loads((output_dir / "ocr-batch-manifest.dry-run.json").read_text())
            self.assertFalse(manifest["write_enabled"])
            self.assertFalse(manifest["provider_calls_enabled"])
            self.assertTrue(contract_path.exists())
            self.assertIn(
                "notice_multimodal_consumption",
                contract_path.read_text(encoding="utf-8"),
            )
            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["mode"], "dry_run")
            self.assertFalse(payload["write_enabled"])
            self.assertFalse(payload["provider_calls_enabled"])


if __name__ == "__main__":
    unittest.main()
