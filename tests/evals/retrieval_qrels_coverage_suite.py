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

    def test_qrels_title_lookup_cases_disable_answer_relevancy_by_default(self) -> None:
        from campus_evals.benchmark_fixtures import load_retrieval_qrels_dataset

        dataset = load_retrieval_qrels_dataset(
            Path("packages/evals/fixtures/student_handbook_retrieval_qrels.json")
        )

        case = next(case for case in dataset.cases if case.case_id == "policy-title-scholarship")

        self.assertFalse(case.supplemental_metric_overrides.get("answer_relevancy", True))
        self.assertFalse(case.supplemental_metric_overrides.get("faithfulness", True))
        self.assertTrue(case.supplemental_metric_overrides.get("identity_grounding", False))

    def test_governing_document_lookup_cases_use_identity_grounding_metric(self) -> None:
        from campus_evals.benchmark_fixtures import load_retrieval_qrels_dataset

        dataset = load_retrieval_qrels_dataset(
            Path("packages/evals/fixtures/institutional_rules_retrieval_qrels.json")
        )

        case = next(case for case in dataset.cases if case.case_id == "institutional-three-assists")

        self.assertFalse(case.supplemental_metric_overrides.get("answer_relevancy", True))
        self.assertFalse(case.supplemental_metric_overrides.get("faithfulness", True))
        self.assertTrue(case.supplemental_metric_overrides.get("identity_grounding", False))

    def test_governing_document_execution_cases_use_identity_grounding_metric(self) -> None:
        from campus_evals.benchmark_fixtures import load_retrieval_qrels_dataset

        dataset = load_retrieval_qrels_dataset(
            Path("packages/evals/fixtures/student_handbook_retrieval_qrels.json")
        )

        case = next(
            case for case in dataset.cases if case.case_id == "semantic-student-safety-education"
        )

        self.assertFalse(case.supplemental_metric_overrides.get("answer_relevancy", True))
        self.assertFalse(case.supplemental_metric_overrides.get("faithfulness", True))
        self.assertTrue(case.supplemental_metric_overrides.get("identity_grounding", False))

    def test_threshold_distribution_cases_do_not_use_answer_relevancy_gate(self) -> None:
        from campus_evals.benchmark_fixtures import load_retrieval_qrels_dataset

        dataset = load_retrieval_qrels_dataset(
            Path("packages/evals/fixtures/student_handbook_retrieval_qrels.json")
        )

        case = next(
            case
            for case in dataset.cases
            if case.case_id == "short-fact-attendance-discipline-threshold"
        )

        self.assertFalse(case.supplemental_metric_overrides.get("answer_relevancy", True))

    def test_curriculum_title_cases_use_document_identity_grounding_metric(self) -> None:
        from campus_evals.benchmark_fixtures import load_retrieval_qrels_dataset

        dataset = load_retrieval_qrels_dataset(
            Path("packages/evals/fixtures/curriculum_plan_retrieval_qrels.json")
        )

        case = next(case for case in dataset.cases if case.case_id == "ethnology-plan-title")

        self.assertFalse(case.supplemental_metric_overrides.get("answer_relevancy", True))
        self.assertFalse(case.supplemental_metric_overrides.get("faithfulness", True))
        self.assertTrue(case.supplemental_metric_overrides.get("identity_grounding", False))

    def test_curriculum_teaching_plan_title_cases_use_document_identity_grounding_metric(
        self,
    ) -> None:
        from campus_evals.benchmark_fixtures import load_retrieval_qrels_dataset

        dataset = load_retrieval_qrels_dataset(
            Path("packages/evals/fixtures/curriculum_plan_retrieval_qrels.json")
        )

        case = next(
            case
            for case in dataset.cases
            if case.case_id == "curriculum-title-general-ideological-political"
        )

        self.assertFalse(case.supplemental_metric_overrides.get("answer_relevancy", True))
        self.assertFalse(case.supplemental_metric_overrides.get("faithfulness", True))
        self.assertTrue(case.supplemental_metric_overrides.get("identity_grounding", False))

    def test_curriculum_fixed_phrase_document_identity_cases_use_identity_grounding_metric(
        self,
    ) -> None:
        from campus_evals.benchmark_fixtures import load_retrieval_qrels_dataset

        dataset = load_retrieval_qrels_dataset(
            Path("packages/evals/fixtures/curriculum_plan_retrieval_qrels.json")
        )

        case = next(
            case
            for case in dataset.cases
            if case.case_id == "minority-language-strong-base-fixed-phrase"
        )

        self.assertFalse(case.supplemental_metric_overrides.get("answer_relevancy", True))
        self.assertFalse(case.supplemental_metric_overrides.get("faithfulness", True))
        self.assertTrue(case.supplemental_metric_overrides.get("identity_grounding", False))

    def test_curriculum_document_view_cases_disable_faithfulness_metric(self) -> None:
        from campus_evals.benchmark_fixtures import load_retrieval_qrels_dataset

        dataset = load_retrieval_qrels_dataset(
            Path("packages/evals/fixtures/curriculum_plan_retrieval_qrels.json")
        )

        case = next(
            case for case in dataset.cases if case.case_id == "digital-economy-plan-paraphrase"
        )

        self.assertFalse(case.supplemental_metric_overrides.get("answer_relevancy", True))
        self.assertFalse(case.supplemental_metric_overrides.get("faithfulness", True))
        self.assertFalse(case.supplemental_metric_overrides.get("identity_grounding", False))


if __name__ == "__main__":
    unittest.main()
