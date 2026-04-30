from __future__ import annotations

from campus_evals.benchmark import (
    default_query_enabled_retrieval_qrels_paths,
    validate_default_query_enabled_qrels_coverage,
)

from tests.evals.retrieval_benchmark_test_support import unittest


class RetrievalQrelsCoverageTest(unittest.TestCase):
    def test_default_query_enabled_qrels_meet_coverage_policy(self) -> None:
        issues = validate_default_query_enabled_qrels_coverage(
            default_query_enabled_retrieval_qrels_paths()
        )

        self.assertEqual(issues, ())


if __name__ == "__main__":
    unittest.main()
