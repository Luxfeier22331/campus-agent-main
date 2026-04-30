from __future__ import annotations

import json
from pathlib import Path
from tempfile import TemporaryDirectory

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

    def test_qrels_coverage_requires_declared_scenario_denominator(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            qrels_path = root / "student.json"
            qrels_path.write_text(
                json.dumps(
                    {
                        "schema_version": 1,
                        "corpus": "regulations",
                        "collection": "student_rules",
                        "baseline": {},
                        "cases": [
                            {
                                "case_id": "policy-title-scholarship",
                                "split": "smoke",
                                "query": "国家奖学金",
                                "expected_sources": [
                                    {"doc_id": "handbook:scholarship", "grade": 2}
                                ],
                            }
                        ],
                        "coverage_scenarios": {
                            "policy_title_exact_match": ["policy-title-scholarship"]
                        },
                    }
                ),
                encoding="utf-8",
            )

            issues = validate_default_query_enabled_qrels_coverage(
                {"regulations/student_rules": qrels_path}
            )

        self.assertIn(
            "regulations/student_rules: missing qrels scenario no_hit",
            issues,
        )
        self.assertIn(
            "regulations/student_rules: missing qrels scenario version_locked",
            issues,
        )


if __name__ == "__main__":
    unittest.main()
