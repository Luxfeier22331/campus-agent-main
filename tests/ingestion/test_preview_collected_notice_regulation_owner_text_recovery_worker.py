from __future__ import annotations

import importlib
import json
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.collected_notice_regulation_owner_text_recovery_models import (
    CollectedNoticeRegulationOwnerTextRecoveryPreview,
)

worker = importlib.import_module(
    "campus_ingestion_worker.preview_collected_notice_regulation_owner_text_recovery"
)


class PreviewCollectedNoticeRegulationOwnerTextRecoveryWorkerTests(unittest.TestCase):
    def test_main_writes_no_write_owner_text_recovery_evidence_files(self) -> None:
        with TemporaryDirectory() as tmpdir:
            tmp_path = Path(tmpdir)
            output_dir = tmp_path / "phase-06-r1a"
            admission_path = tmp_path / "admission.json"
            multimodal_path = tmp_path / "multimodal.json"
            admission_path.write_text('{"entries":[]}\n', encoding="utf-8")
            multimodal_path.write_text('{"candidates":[]}\n', encoding="utf-8")
            fake_preview = CollectedNoticeRegulationOwnerTextRecoveryPreview(
                batch_manifest={
                    "schema_version": "collected_notice_regulation_owner_text_recovery_batch.v1",
                    "mode": "dry_run",
                    "write_enabled": False,
                    "provider_calls_enabled": False,
                    "object_store_writes_enabled": False,
                    "db_writes_enabled": False,
                    "target": "regulation_owner_text_recovery",
                    "counts": {
                        "in_scope_needs_multimodal_count": 3,
                        "eligible_attempt_count": 2,
                        "selected_attempt_count": 1,
                        "batch_limit_deferred_count": 1,
                        "gap_count": 1,
                    },
                },
                attempt_plan={
                    "schema_version": "collected_notice_regulation_owner_text_attempt_plan.v1",
                    "attempt_count": 1,
                },
                searchable_merge_contract={
                    "schema_version": (
                        "collected_notice_regulation_owner_text_searchable_merge_contract.v1"
                    ),
                    "unit_count": 1,
                },
                readiness_gap_report={
                    "schema_version": (
                        "collected_notice_regulation_owner_text_readiness_gap_report.v1"
                    ),
                    "gap_count": 1,
                    "deferred_count": 1,
                },
            )

            with (
                patch(
                    "campus_ingestion_worker."
                    "preview_collected_notice_regulation_owner_text_recovery.load_worker_env"
                ),
                patch(
                    "campus_ingestion_worker."
                    "preview_collected_notice_regulation_owner_text_recovery."
                    "build_collected_notice_regulation_owner_text_recovery_preview_from_paths",
                    return_value=fake_preview,
                ) as build_preview,
                redirect_stdout(StringIO()) as stdout,
            ):
                worker.main(
                    [
                        "--regulation-admission-manifest-path",
                        str(admission_path),
                        "--multimodal-candidate-inventory-path",
                        str(multimodal_path),
                        "--output-dir",
                        str(output_dir),
                        "--limit",
                        "7",
                    ]
                )

            build_preview.assert_called_once_with(
                regulation_admission_manifest_path=admission_path,
                multimodal_candidate_inventory_path=multimodal_path,
                limit=7,
            )
            self.assertEqual(
                {
                    "regulation-owner-text-recovery-batch-manifest.json",
                    "regulation-owner-text-attempt-plan.json",
                    "regulation-owner-text-searchable-merge-contract.json",
                    "regulation-owner-text-readiness-gap-report.json",
                },
                {path.name for path in output_dir.glob("*.json")},
            )
            payload = json.loads(stdout.getvalue())
            self.assertEqual(payload["mode"], "dry_run")
            self.assertFalse(payload["write_enabled"])
            self.assertFalse(payload["provider_calls_enabled"])
            self.assertEqual(payload["target"], "regulation_owner_text_recovery")
            self.assertEqual(payload["selected_attempt_count"], 1)
            self.assertEqual(payload["gap_count"], 1)
            self.assertEqual(payload["limit"], 7)


if __name__ == "__main__":
    unittest.main()
