from __future__ import annotations

import importlib
import json
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_ingestion_core.collected_notice_media_extraction_closeout import (
    apply_media_extraction_closeout_result_manifests,
    build_owner_text_media_extraction_closeout_result_manifest,
    build_schedule_image_ocr_media_extraction_closeout_result_manifest,
)


class CollectedNoticeMediaExtractionCloseoutTests(unittest.TestCase):
    def test_apply_result_manifest_terminalizes_blocking_candidates(self) -> None:
        closeout = apply_media_extraction_closeout_result_manifests(
            candidate_inventory=_candidate_inventory(),
            result_manifests=[
                {
                    "schema_version": "notice_media_extraction_closeout_result_manifest.v1",
                    "results": [
                        {
                            "candidate_id": "candidate:schedule",
                            "status": "completed",
                            "media_text_status": "completed",
                            "reason_codes": ["ocr_output_admitted"],
                        },
                        {
                            "candidate_id": "candidate:terminal-failure",
                            "status": "failed_terminal",
                            "media_text_status": "failed_terminal",
                            "reason_codes": ["attempts_exhausted"],
                        },
                        {
                            "candidate_id": "candidate:orphan",
                            "status": "completed",
                            "media_text_status": "completed",
                        },
                    ],
                }
            ],
            generated_at="2026-04-30T12:00:00+08:00",
        )

        inventory = closeout["candidate_inventory"]
        by_id = {row["candidate_id"]: row for row in inventory["candidates"]}
        self.assertEqual(by_id["candidate:schedule"]["status"], "completed")
        self.assertFalse(by_id["candidate:schedule"]["target_blocking"])
        self.assertEqual(by_id["candidate:terminal-failure"]["status"], "failed_terminal")
        self.assertFalse(by_id["candidate:terminal-failure"]["target_blocking"])
        self.assertEqual(by_id["candidate:still-pending"]["status"], "pending")
        self.assertTrue(by_id["candidate:still-pending"]["target_blocking"])
        self.assertEqual(inventory["counts_by_status"]["completed"], 1)
        self.assertEqual(inventory["counts_by_status"]["failed_terminal"], 1)
        self.assertEqual(inventory["counts_by_status"]["pending"], 1)
        self.assertEqual(closeout["closeout_report"]["orphan_result_count"], 1)
        self.assertEqual(closeout["closeout_report"]["terminalized_candidate_count"], 2)
        self.assertEqual(closeout["closeout_report"]["nonterminal_blocking_count"], 1)

    def test_schedule_image_ocr_result_manifest_maps_post_run_outputs(self) -> None:
        manifest = build_schedule_image_ocr_media_extraction_closeout_result_manifest(
            execution_manifest={
                "entries": [
                    {
                        "candidate_id": "candidate:admitted",
                        "source_notice_id": "355867",
                        "image_index": 1,
                        "normalized_output_refs": {"plain_text": {"key": "text-a"}},
                    },
                    {
                        "candidate_id": "candidate:missing",
                        "source_notice_id": "355867",
                        "image_index": 2,
                    },
                    {
                        "candidate_id": "candidate:rejected",
                        "source_notice_id": "355881",
                        "image_index": 1,
                    },
                ]
            },
            post_run_preview={
                "post_run_gap_report": {
                    "missing_ocr_outputs": [{"source_notice_id": "355867", "image_index": 2}],
                    "rejected_ocr_items": [
                        {
                            "notice_id": "355881",
                            "image_index": 1,
                            "admission_reason": "no_schedule_table",
                        }
                    ],
                }
            },
            generated_at="2026-04-30T12:00:00+08:00",
        )

        by_id = {row["candidate_id"]: row for row in manifest["results"]}
        self.assertEqual(by_id["candidate:admitted"]["status"], "completed")
        self.assertEqual(by_id["candidate:missing"]["status"], "pending")
        self.assertEqual(by_id["candidate:rejected"]["status"], "manual_review")
        self.assertIn("ocr_admission_rejected", by_id["candidate:rejected"]["reason_codes"])

    def test_owner_text_result_manifest_maps_execution_report(self) -> None:
        manifest = build_owner_text_media_extraction_closeout_result_manifest(
            execution_report={
                "attempt_results": [
                    {
                        "candidate_id": "candidate:owner-ready",
                        "status": "succeeded",
                        "owner_text_status": "ready",
                        "written_refs": {"plain_text": {"key": "owner.txt"}},
                    },
                    {
                        "candidate_id": "candidate:owner-failed",
                        "status": "failed",
                        "owner_text_status": "not_ready",
                        "error": "provider timeout",
                    },
                    {
                        "candidate_id": "candidate:owner-planned",
                        "status": "planned",
                        "owner_text_status": "not_run",
                    },
                ]
            },
            generated_at="2026-04-30T12:00:00+08:00",
        )

        by_id = {row["candidate_id"]: row for row in manifest["results"]}
        self.assertEqual(by_id["candidate:owner-ready"]["status"], "completed")
        self.assertEqual(by_id["candidate:owner-failed"]["status"], "failed_retryable")
        self.assertEqual(by_id["candidate:owner-planned"]["status"], "pending")

    def test_closeout_preserves_result_manifest_provenance_on_candidates(self) -> None:
        closeout = apply_media_extraction_closeout_result_manifests(
            candidate_inventory=_candidate_inventory(),
            result_manifests=[
                {
                    "schema_version": "notice_media_extraction_closeout_result_manifest.v1",
                    "source_kind": "schedule_image_ocr_post_run_preview",
                    "generated_at": "2026-04-30T12:00:00+08:00",
                    "generated_by": "test.result.builder",
                    "results": [
                        {
                            "candidate_id": "candidate:schedule",
                            "status": "completed",
                            "media_text_status": "completed",
                            "attempt_id": "candidate:schedule:attempt:1",
                            "attempt_number": 1,
                        }
                    ],
                }
            ],
            generated_at="2026-04-30T12:01:00+08:00",
        )

        candidate = {
            row["candidate_id"]: row for row in closeout["candidate_inventory"]["candidates"]
        }["candidate:schedule"]
        self.assertEqual(
            candidate["closeout"]["result_schema_version"],
            "notice_media_extraction_closeout_result_manifest.v1",
        )
        self.assertEqual(
            candidate["closeout"]["result_source_kind"],
            "schedule_image_ocr_post_run_preview",
        )
        self.assertEqual(candidate["closeout"]["result_generated_by"], "test.result.builder")
        self.assertEqual(candidate["closeout"]["attempt_id"], "candidate:schedule:attempt:1")
        self.assertEqual(candidate["closeout"]["attempt_number"], 1)

    def test_closeout_rejects_legacy_candidate_missing_target_blocking(self) -> None:
        inventory = _candidate_inventory()
        del inventory["candidates"][0]["target_blocking"]  # type: ignore[index]

        with self.assertRaisesRegex(ValueError, "target_blocking"):
            apply_media_extraction_closeout_result_manifests(
                candidate_inventory=inventory,
                result_manifests=[],
                generated_at="2026-04-30T12:00:00+08:00",
            )

    def test_closeout_rejects_legacy_failed_status_in_candidate_inventory(self) -> None:
        inventory = _candidate_inventory()
        inventory["candidates"][0]["status"] = "failed"  # type: ignore[index]
        inventory["candidates"][0]["media_text_status"] = "failed"  # type: ignore[index]

        with self.assertRaisesRegex(ValueError, "unsupported value: failed"):
            apply_media_extraction_closeout_result_manifests(
                candidate_inventory=inventory,
                result_manifests=[],
                generated_at="2026-04-30T12:00:00+08:00",
            )

    def test_closeout_rejects_legacy_failed_status_in_result_manifest(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported value: failed"):
            apply_media_extraction_closeout_result_manifests(
                candidate_inventory=_candidate_inventory(),
                result_manifests=[
                    {
                        "schema_version": "notice_media_extraction_closeout_result_manifest.v1",
                        "results": [
                            {
                                "candidate_id": "candidate:schedule",
                                "status": "failed",
                            }
                        ],
                    }
                ],
                generated_at="2026-04-30T12:00:00+08:00",
            )

    def test_closeout_rejects_duplicate_result_candidate_ids(self) -> None:
        with self.assertRaisesRegex(ValueError, "duplicate result candidate_id"):
            apply_media_extraction_closeout_result_manifests(
                candidate_inventory=_candidate_inventory(),
                result_manifests=[
                    {
                        "schema_version": "notice_media_extraction_closeout_result_manifest.v1",
                        "results": [
                            {
                                "candidate_id": "candidate:schedule",
                                "status": "completed",
                            },
                            {
                                "candidate_id": "candidate:schedule",
                                "status": "failed_retryable",
                            },
                        ],
                    }
                ],
                generated_at="2026-04-30T12:00:00+08:00",
            )


class PreviewCollectedNoticeMediaExtractionCloseoutWorkerTests(unittest.TestCase):
    def test_main_writes_closeout_inventory_and_report(self) -> None:
        worker = importlib.import_module(
            "campus_ingestion_worker.preview_collected_notice_media_extraction_closeout"
        )
        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            inventory_path = root / "media-extraction-candidate-inventory.json"
            result_path = root / "result-manifest.json"
            output_dir = root / "out"
            inventory_path.write_text(json.dumps(_candidate_inventory()), encoding="utf-8")
            result_path.write_text(
                json.dumps(
                    {
                        "schema_version": "notice_media_extraction_closeout_result_manifest.v1",
                        "results": [
                            {
                                "candidate_id": "candidate:schedule",
                                "status": "completed",
                                "media_text_status": "completed",
                            }
                        ],
                    }
                ),
                encoding="utf-8",
            )

            with (
                patch(
                    "campus_ingestion_worker.preview_collected_notice_media_extraction_closeout."
                    "load_worker_env"
                ),
                redirect_stdout(StringIO()) as stdout,
            ):
                worker.main(
                    [
                        "--candidate-inventory-path",
                        str(inventory_path),
                        "--result-manifest-path",
                        str(result_path),
                        "--output-dir",
                        str(output_dir),
                    ]
                )

            summary = json.loads(stdout.getvalue())
            self.assertFalse(summary["write_enabled"])
            self.assertEqual(summary["updated_candidate_count"], 1)
            self.assertEqual(
                {path.name for path in output_dir.glob("*.json")},
                {
                    "media-extraction-candidate-inventory.closeout.json",
                    "media-extraction-closeout-report.json",
                },
            )
            closeout_inventory = json.loads(
                (output_dir / "media-extraction-candidate-inventory.closeout.json").read_text(
                    encoding="utf-8"
                )
            )
            self.assertEqual(closeout_inventory["counts_by_status"]["completed"], 1)


def _candidate_inventory() -> dict[str, object]:
    return {
        "schema_version": "notice_media_extraction_candidate_inventory.v1",
        "legacy_schema_version": "notice_multimodal_candidate_inventory.v1",
        "generated_at": "2026-04-30T00:00:00+08:00",
        "generated_by": "test",
        "mode": "dry_run",
        "write_enabled": False,
        "candidate_count": 3,
        "counts_by_status": {"pending": 3},
        "candidates": [
            _candidate("candidate:schedule", "schedule_image_ocr"),
            _candidate("candidate:terminal-failure", "released_file_text_extraction"),
            _candidate("candidate:still-pending", "pdf_ocr_text_extraction"),
        ],
    }


def _candidate(candidate_id: str, processing_family: str) -> dict[str, object]:
    return {
        "candidate_id": candidate_id,
        "unit_id": f"unit:{candidate_id}",
        "source_notice_id": "355867",
        "media_kind": "image" if processing_family == "schedule_image_ocr" else "pdf",
        "media_role": "target_fact_source",
        "processing_family": processing_family,
        "target_blocking": True,
        "status": "pending",
        "media_text_status": "pending",
        "reason_codes": ["pending_media_text_extraction"],
        "source_object_ref": {"bucket": "campus-rag-source", "key": f"{candidate_id}.bin"},
        "normalized_output_refs": {"plain_text": {"key": f"{candidate_id}.txt"}},
    }


if __name__ == "__main__":
    unittest.main()
