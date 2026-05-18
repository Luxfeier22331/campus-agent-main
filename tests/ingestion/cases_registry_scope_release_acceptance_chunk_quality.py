from __future__ import annotations

import unittest
from dataclasses import replace

from campus_ingestion_core.index_release_acceptance import evaluate_release_chunk_quality

from tests.ingestion.index_release_acceptance_support import (
    _make_chunk,
    _make_record,
)
from tests.ingestion.registry_scope_release_acceptance_quality_suite import (
    RegistryScopeReleaseAcceptanceQualitySuite,
)


class RegistryScopeReleaseAcceptanceChunkQualityTest(
    RegistryScopeReleaseAcceptanceQualitySuite, unittest.TestCase
):
    def test_evaluate_release_chunk_quality_reports_traceability_and_budget_issues(self) -> None:
        record = _make_record()
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    metadata={
                        "unit_type": "section_text",
                        "final_token_count": 4097,
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                ),
            ),
            max_token_count=2048,
        )

        self.assertEqual(report.status, "failed")
        self.assertEqual(report.chunk_quality_status, "failed")
        self.assertIn("student_rules:handbook:chunk-0001", report.summary["issues_by_chunk_id"])
        self.assertIn(
            "missing_root_unit_id",
            report.summary["issues_by_chunk_id"]["student_rules:handbook:chunk-0001"],
        )
        self.assertIn(
            "token_count_exceeds_budget",
            report.summary["issues_by_chunk_id"]["student_rules:handbook:chunk-0001"],
        )

    def test_evaluate_release_chunk_quality_rejects_semantic_non_evidence_chunks(self) -> None:
        record = _make_record()
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    chunk_id="student_rules:handbook:chunk-attachment-ref",
                    metadata={
                        "unit_type": "attachment_ref",
                        "root_unit_id": "student_rules:handbook:root-attachment",
                        "final_token_count": 8,
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                ),
                replace(
                    _make_chunk(record=record),
                    chunk_id="student_rules:handbook:chunk-heading-only",
                    text="总则",
                    anchor={"section_path": ["总则"]},
                    metadata={
                        "unit_type": "section_text",
                        "root_unit_id": "student_rules:handbook:root-heading",
                        "final_token_count": 2,
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "attachment_ref_not_query_serving_chunk",
            report.summary["issues_by_chunk_id"]["student_rules:handbook:chunk-attachment-ref"],
        )
        self.assertIn(
            "heading_only_chunk",
            report.summary["issues_by_chunk_id"]["student_rules:handbook:chunk-heading-only"],
        )

    def test_evaluate_release_chunk_quality_rejects_context_only_chunk_text(self) -> None:
        record = _make_record()
        report = evaluate_release_chunk_quality(
            chunks=(
                replace(
                    _make_chunk(record=record),
                    chunk_id="student_rules:handbook:chunk-context-only",
                    text="第一章 总则",
                    metadata={
                        "unit_type": "section_text",
                        "root_unit_id": "student_rules:handbook:root-context-only",
                        "display_text": "学生应当按学校规定办理注册手续。",
                        "contextualized_text": True,
                        "header_token_count": 4,
                        "final_token_count": 8,
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                ),
            ),
            max_token_count=512,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "display_text_not_in_chunk_text",
            report.summary["issues_by_chunk_id"]["student_rules:handbook:chunk-context-only"],
        )


if __name__ == "__main__":
    unittest.main()
