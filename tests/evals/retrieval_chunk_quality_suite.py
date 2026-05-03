from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_evals.retrieval_chunk_quality import (
    build_chunk_quality_audit_report,
    evaluate_chunk_quality,
    retrieval_chunk_quality_report_to_dict,
)
from campus_evals.retrieval_chunk_quality_cli import main as chunk_quality_main

from tests.evals.retrieval_benchmark_test_support import unittest


class RetrievalChunkQualityTest(unittest.TestCase):
    def test_chunk_quality_accepts_traceable_chunks_under_budget(self) -> None:
        report = evaluate_chunk_quality(
            chunks=[
                {
                    "document_id": "doc:policy",
                    "version_id": "v1",
                    "chunk_id": "chunk-001",
                    "chunk_order": 1,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "第一条 校园卡遗失后应及时挂失并补办。",
                    "source_uri": "s3://derived/doc",
                    "canonical_url": "https://example.edu/policy",
                    "metadata": {
                        "root_unit_id": "article-1",
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                }
            ],
            max_tokens=64,
        )

        self.assertEqual(report.status, "passed")
        self.assertEqual(report.issue_count, 0)

    def test_chunk_quality_flags_missing_traceability_and_over_budget_text(self) -> None:
        report = evaluate_chunk_quality(
            chunks=[
                {
                    "document_id": "doc:policy",
                    "version_id": "v1",
                    "chunk_id": "chunk-001",
                    "chunk_order": 1,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": " ".join(f"token{i}" for i in range(80)),
                    "metadata": {},
                }
            ],
            max_tokens=32,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn("chunk-001", report.issues_by_chunk_id)
        self.assertIn("missing_source_uri", report.issues_by_chunk_id["chunk-001"])
        self.assertIn("missing_root_unit_id", report.issues_by_chunk_id["chunk-001"])
        self.assertIn("token_count_exceeds_budget", report.issues_by_chunk_id["chunk-001"])

    def test_chunk_quality_flags_semantic_release_gate_issues(self) -> None:
        report = evaluate_chunk_quality(
            chunks=[
                {
                    "document_id": "doc:policy",
                    "version_id": "v1",
                    "chunk_id": "chunk-context-only",
                    "chunk_order": 1,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "第一章 总则",
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "section_text",
                        "root_unit_id": "article-context-only",
                        "display_text": "学生应当按学校规定办理注册手续。",
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                },
                {
                    "document_id": "doc:policy",
                    "version_id": "v1",
                    "chunk_id": "chunk-segment-1",
                    "chunk_order": 2,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "第一段",
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "section_text",
                        "root_unit_id": "article-segmented",
                        "segment_index": 1,
                        "segment_total": 3,
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                },
                {
                    "document_id": "doc:policy",
                    "version_id": "v1",
                    "chunk_id": "chunk-segment-3",
                    "chunk_order": 3,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "第三段",
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "section_text",
                        "root_unit_id": "article-segmented",
                        "segment_index": 3,
                        "segment_total": 3,
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                },
                {
                    "document_id": "doc:policy",
                    "version_id": "v1",
                    "chunk_id": "chunk-table",
                    "chunk_order": 4,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "本科生 | 按学期注册",
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "table_unit",
                        "root_unit_id": "table-1",
                        "table_row_count": 1,
                        "table_row_lines": ["本科生 | 按学期注册"],
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                },
            ],
            max_tokens=64,
        )

        self.assertEqual(report.status, "failed")
        self.assertIn(
            "display_text_not_in_chunk_text",
            report.issues_by_chunk_id["chunk-context-only"],
        )
        self.assertIn("segment_coverage_gap", report.issues_by_chunk_id["chunk-segment-1"])
        self.assertIn("segment_coverage_gap", report.issues_by_chunk_id["chunk-segment-3"])
        self.assertIn("missing_table_context_or_header", report.issues_by_chunk_id["chunk-table"])

    def test_chunk_quality_counts_aggregated_member_segment_lineage_as_covered(
        self,
    ) -> None:
        report = evaluate_chunk_quality(
            chunks=[
                {
                    "document_id": "doc:policy",
                    "version_id": "v1",
                    "chunk_id": "chunk-segment-1-aggregated",
                    "chunk_order": 1,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "第一段",
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "section_text",
                        "root_unit_id": "article-previous",
                        "member_segment_lineage": [
                            {
                                "root_unit_id": "article-segmented",
                                "segment_index": 1,
                                "segment_total": 2,
                            }
                        ],
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                },
                {
                    "document_id": "doc:policy",
                    "version_id": "v1",
                    "chunk_id": "chunk-segment-2",
                    "chunk_order": 2,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "第二段",
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "section_text",
                        "root_unit_id": "article-segmented",
                        "segment_index": 2,
                        "segment_total": 2,
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                },
            ],
            max_tokens=64,
        )

        self.assertEqual(report.status, "passed")
        self.assertEqual(report.issue_count, 0)

    def test_chunk_quality_audit_report_summarizes_issue_and_unit_type_counts(self) -> None:
        report = build_chunk_quality_audit_report(
            chunks=[
                {
                    "document_id": "doc:policy",
                    "version_id": "v1",
                    "chunk_id": "chunk-missing-root",
                    "chunk_order": 1,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "第一章 总则",
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "section_text",
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                },
                {
                    "document_id": "doc:policy",
                    "version_id": "v1",
                    "chunk_id": "chunk-table",
                    "chunk_order": 2,
                    "corpus": "regulations",
                    "collection": "student_rules",
                    "text": "办理地点 | 中慧楼",
                    "source_uri": "s3://derived/doc",
                    "metadata": {
                        "unit_type": "table_unit",
                        "root_unit_id": "table-1",
                        "chunk_policy_version": "student_rules_semantic_v3",
                    },
                },
            ],
            max_tokens=64,
        )
        payload = retrieval_chunk_quality_report_to_dict(report)

        self.assertEqual(payload["status"], "failed")
        self.assertEqual(payload["chunk_count"], 2)
        self.assertEqual(payload["failed_chunk_count"], 2)
        self.assertEqual(payload["counts_by_unit_type"]["section_text"], 1)
        self.assertEqual(payload["counts_by_unit_type"]["table_unit"], 1)
        self.assertEqual(payload["counts_by_issue"]["missing_root_unit_id"], 1)
        self.assertEqual(payload["counts_by_issue"]["missing_table_context_or_header"], 1)

    def test_chunk_quality_cli_writes_json_report(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            chunks_path = root / "chunks.jsonl"
            report_path = root / "chunk-quality.json"
            chunks_path.write_text(
                json.dumps(
                    {
                        "document_id": "doc:policy",
                        "version_id": "v1",
                        "chunk_id": "chunk-001",
                        "chunk_order": 1,
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "text": "第一章 总则",
                        "source_uri": "s3://derived/doc",
                        "metadata": {
                            "unit_type": "section_text",
                            "root_unit_id": "article-1",
                            "chunk_policy_version": "student_rules_semantic_v3",
                        },
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            exit_code = chunk_quality_main(
                [
                    "--chunks",
                    str(chunks_path),
                    "--output",
                    str(report_path),
                    "--max-tokens",
                    "64",
                ]
            )
            payload = json.loads(report_path.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertEqual(payload["status"], "passed")
        self.assertEqual(payload["chunk_count"], 1)

    def test_chunk_quality_cli_returns_nonzero_when_report_failed(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            chunks_path = root / "chunks.jsonl"
            report_path = root / "chunk-quality.json"
            chunks_path.write_text(
                json.dumps(
                    {
                        "document_id": "doc:policy",
                        "version_id": "v1",
                        "chunk_id": "chunk-001",
                        "chunk_order": 1,
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "text": "第一章 总则",
                        "metadata": {},
                    },
                    ensure_ascii=False,
                )
                + "\n",
                encoding="utf-8",
            )

            exit_code = chunk_quality_main(
                [
                    "--chunks",
                    str(chunks_path),
                    "--output",
                    str(report_path),
                    "--max-tokens",
                    "64",
                ]
            )
            payload = json.loads(report_path.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 2)
        self.assertEqual(payload["status"], "failed")


if __name__ == "__main__":
    unittest.main()
