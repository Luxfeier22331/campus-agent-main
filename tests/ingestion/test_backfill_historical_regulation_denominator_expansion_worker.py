from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from campus_ingestion_worker.backfill_historical_regulation_denominator_expansion import (
    backfill_historical_regulation_denominator_expansion_from_paths,
)


class BackfillHistoricalRegulationDenominatorExpansionWorkerTest(unittest.TestCase):
    def test_worker_writes_chunk_only_evidence_without_embedding_or_release(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            ready_candidates_path = root / "ready.json"
            normalized_bundle_path = root / "bundle.json"
            output_dir = root / "evidence"
            _write_json(
                ready_candidates_path,
                {
                    "records": [
                        {
                            "source_notice_id": "354006",
                            "title": "中央民族大学中华民族共同体学院 2026年“英才计划”硕博连读研究生招生实施细则",
                            "target_collection": "scoped_rules",
                            "status": "ready_for_canonical_chunk_v9",
                        }
                    ]
                },
            )
            _write_json(
                normalized_bundle_path,
                [
                    {
                        "notice_id": 354006,
                        "notice": {
                            "notice_id": 354006,
                            "notice_title": "中央民族大学中华民族共同体学院 2026年“英才计划”硕博连读研究生招生实施细则",
                            "organization_name": "中华民族共同体学院",
                            "notice_release_time": "2025-12-16 11:19",
                            "notice_content": (
                                "<p>中央民族大学中华民族共同体学院 2026年“英才计划”硕博连读研究生招生实施细则</p>"
                                "<p>第一条 为规范硕博连读研究生招生工作，制定本细则。</p>"
                                "<p>第二条 本细则适用于中华民族共同体学院相关学生。</p>"
                            ),
                            "notice_link": None,
                        },
                        "links": [],
                        "notice_attachments": [],
                        "attachments": [],
                    }
                ],
            )

            with (
                patch(
                    "campus_ingestion_worker.backfill_historical_regulation_denominator_expansion."
                    "prepare_scoped_rule_chunks"
                ) as prepare_scoped,
                patch(
                    "campus_ingestion_worker.backfill_historical_regulation_denominator_expansion."
                    "prepare_institutional_regulation_chunks"
                ) as prepare_institutional,
            ):
                prepare_scoped.return_value = _PrepReport(
                    prepared_document_count=1,
                    total_unit_count=3,
                    total_chunk_count=2,
                    passed=True,
                    manifest_path=str(
                        output_dir
                        / "phase-03-chunk-preparation/scoped_rules/chunk-prep-manifest.json"
                    ),
                    validation_summary_path=str(
                        output_dir
                        / "phase-03-chunk-preparation/scoped_rules/validation-summary.json"
                    ),
                    document_reports_path=str(
                        output_dir
                        / "phase-03-chunk-preparation/scoped_rules/document-reports.jsonl"
                    ),
                )
                prepare_institutional.return_value = _PrepReport(
                    prepared_document_count=0,
                    total_unit_count=0,
                    total_chunk_count=0,
                    passed=True,
                    manifest_path="",
                    validation_summary_path="",
                    document_reports_path="",
                )

                report = backfill_historical_regulation_denominator_expansion_from_paths(
                    ready_candidates_path=ready_candidates_path,
                    normalized_bundle_path=normalized_bundle_path,
                    output_dir=output_dir,
                    execute=True,
                    generated_at="2026-05-02T00:00:00+00:00",
                )

            self.assertEqual(
                report["schema_version"],
                "historical-regulation-denominator-expansion-backfill-worker.v1",
            )
            self.assertEqual(report["selected_notice_ids"], ["354006"])
            self.assertEqual(report["materialized_document_count"], 1)
            self.assertEqual(report["chunk_preparation"]["overall_verdict"], "passed")
            self.assertFalse(report["serving_closed"]["embedding_opened"])
            self.assertFalse(report["candidate_store_noop"]["candidate_store_mutated"])
            self.assertTrue(
                (
                    output_dir
                    / "phase-01-body-text-admission"
                    / "regulation-consumer-admission-manifest.json"
                ).exists()
            )
            self.assertTrue(
                (
                    output_dir
                    / "phase-02-canonical-materialization"
                    / "materialization.execute.json"
                ).exists()
            )
            self.assertTrue(
                (
                    output_dir
                    / "phase-03-chunk-preparation"
                    / "chunk-preparation-batch-report.json"
                ).exists()
            )
            self.assertTrue(
                (output_dir / "phase-04-quality-audit" / "final-quality-audit.json").exists()
            )
            object_keys = json.loads(
                (output_dir / "phase-04-quality-audit" / "final-quality-audit.json").read_text(
                    encoding="utf-8"
                )
            )["object_store_key_audit"]
            self.assertEqual(object_keys["failed_key_count"], 0)


class _PrepReport:
    def __init__(
        self,
        *,
        prepared_document_count: int,
        total_unit_count: int,
        total_chunk_count: int,
        passed: bool,
        manifest_path: str,
        validation_summary_path: str,
        document_reports_path: str,
    ) -> None:
        self.prepared_document_count = prepared_document_count
        self.total_unit_count = total_unit_count
        self.total_chunk_count = total_chunk_count
        self.passed = passed
        self.manifest_path = manifest_path
        self.validation_summary_path = validation_summary_path
        self.document_reports_path = document_reports_path


def _write_json(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


if __name__ == "__main__":
    unittest.main()
