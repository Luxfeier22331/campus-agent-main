from __future__ import annotations

from campus_evals.retrieval_chunk_quality import evaluate_chunk_quality

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


if __name__ == "__main__":
    unittest.main()
