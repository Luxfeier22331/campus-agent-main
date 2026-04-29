from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.collected_notice_replay_closeout_acceptance import (
    build_closeout_acceptance_report_from_root,
    closeout_to_output_files,
)


class CollectedNoticeReplayCloseoutAcceptanceTests(unittest.TestCase):
    def test_acceptance_allows_observed_service_status_deferred_items(self) -> None:
        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            _write_fixture_evidence(root)

            report = build_closeout_acceptance_report_from_root(
                workstream_root=root,
                generated_at="2026-04-29T16:00:00+08:00",
            )

        self.assertEqual(report.acceptance_report["verdict"], "passed_with_deferred_items")
        checks = {
            check["check_id"]: check["verdict"]
            for check in report.acceptance_report["acceptance_checks"]
        }
        self.assertEqual(checks["all_valid_captured_notices_searchable"], "passed")
        self.assertEqual(checks["historical_and_live_queue_contract"], "passed")
        self.assertEqual(checks["regulation_offline_preparation_only"], "passed")
        self.assertEqual(checks["transport_schedule_baseline_and_ocr_gate"], "passed")
        self.assertEqual(checks["service_status_downstream_replay"], "passed_with_deferred_items")
        self.assertEqual(
            report.source_to_downstream_trace["service_status"]["blocked_source_notice_ids"],
            ["355283", "355650"],
        )

    def test_output_files_are_phase_7_closeout_artifacts(self) -> None:
        with TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            _write_fixture_evidence(root)
            report = build_closeout_acceptance_report_from_root(
                workstream_root=root,
                generated_at="2026-04-29T16:00:00+08:00",
            )

        self.assertEqual(
            set(closeout_to_output_files(report)),
            {
                "acceptance-summary.json",
                "source-to-queue-to-search-to-downstream-trace.json",
            },
        )


def _write_fixture_evidence(root: Path) -> None:
    _write_json(
        root / "evidence/phase-04-dry-run-reimport-and-universal-search-preview/"
        "searchable-coverage-report.json",
        {
            "verdict": "passed",
            "valid_captured_notice_count": 3,
            "searchable_unit_count": 3,
            "missing_searchable_unit_count": 0,
            "extra_searchable_unit_count": 0,
        },
    )
    _write_json(
        root / "evidence/phase-04-7-historical-captured-inventory-synthetic-enqueue/"
        "enqueue-coverage-report.json",
        {
            "verdict": "passed",
            "source_truth_candidate_count": 3,
            "planned_job_count": 3,
            "write_enabled": False,
        },
    )
    _write_json(
        root / "evidence/phase-04-8-queue-consumer-reimport-path/queue-consume.dry-run.json",
        {
            "write_enabled": False,
            "counts": {
                "projected_count": 3,
                "searchable_unit_count": 3,
                "source_truth_candidate_count": 3,
                "failed_count": 0,
            },
        },
    )
    _write_json(
        root / "evidence/phase-04-8-queue-consumer-reimport-path/"
        "searchable-coverage-after-queue-consume.json",
        {
            "verdict": "passed",
            "searchable_unit_count": 3,
            "missing_searchable_unit_count": 0,
        },
    )
    _write_json(
        root / "evidence/phase-06-r3-regulation-normalization-quality-gate/"
        "regulation-normalization-consistency-report.json",
        {
            "verdict": "passed",
            "write_enabled": False,
            "counts": {"downstream_admitted": 1, "skipped_not_admitted": 2},
        },
    )
    _write_json(
        root / "evidence/phase-06-batched-downstream-replay/batch-transport-schedule/"
        "consistency-report.json",
        {
            "verdict": "passed",
            "source_notice_ids": ["355512"],
            "admitted_source_count": 1,
            "blocked_source_count": 0,
            "stage_candidate_count": 1,
            "current_promotion_enabled": False,
        },
    )
    _write_json(
        root
        / "evidence/phase-06-2-official-transport-baseline-ingest-and-overlay-reclassification/"
        "official-baseline-consistency-report.json",
        {"verdict": "passed", "issues": []},
    )
    _write_json(
        root
        / "evidence/phase-06-2-official-transport-baseline-ingest-and-overlay-reclassification/"
        "official-baseline-canonical-preview.json",
        {
            "counts": {"canonical_row_count": 32},
            "canonical_rows": [{"effective_from": "2026-03-20"}],
        },
    )
    _write_json(
        root / "evidence/phase-06-3-schedule-image-ocr-mini-batch/post-run-preview/"
        "transport-ocr-consistency-report.json",
        {"verdict": "passed", "stage_candidate_count": 32, "issues": []},
    )
    _write_json(
        root / "evidence/phase-06-3-schedule-image-ocr-mini-batch/post-run-preview/"
        "schedule-image-ocr-post-run-gap-report.json",
        {
            "verdict": "requires_review",
            "expected_image_count": 4,
            "observed_image_count": 4,
            "missing_ocr_output_count": 0,
            "rejected_ocr_item_count": 2,
            "write_enabled": False,
        },
    )
    _write_json(
        root / "evidence/phase-06-batched-downstream-replay/batch-service-status/"
        "consistency-report.json",
        {
            "verdict": "blocked",
            "source_notice_ids": ["355283", "355650"],
            "admitted_source_count": 0,
            "blocked_source_count": 2,
            "stage_candidate_count": 0,
            "current_promotion_enabled": False,
        },
    )
    _write_json(
        root / "evidence/phase-06-batched-downstream-replay/batch-service-status/"
        "rejected-deferred-source-report.json",
        {
            "entry_count": 2,
            "entries": [
                {
                    "source_notice_id": "355283",
                    "reason_codes": ["missing_effective_window_or_status_signal"],
                },
                {
                    "source_notice_id": "355650",
                    "reason_codes": ["multimodal_not_ready"],
                },
            ],
        },
    )


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    unittest.main()
