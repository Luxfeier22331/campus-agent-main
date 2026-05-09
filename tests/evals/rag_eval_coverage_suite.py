from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from campus_evals.rag_eval_coverage import build_rag_eval_coverage_report, main


class RagEvalCoverageSuite(unittest.TestCase):
    def test_rag_eval_coverage_tracks_only_current_rag_consumption_surfaces(self) -> None:
        report = build_rag_eval_coverage_report()

        self.assertEqual(
            tuple(surface.surface_key for surface in report.surfaces),
            (
                "regulations/student_rules",
                "regulations/institutional_rules",
                "curriculum/curriculum_plan",
                "official_web/stable_reference",
            ),
        )
        self.assertTrue(report.minimum_gate_passed, report.gaps)
        self.assertTrue(report.passed, report.gaps)
        self.assertTrue(report.maturity_passed, report.maturity_gaps)
        self.assertEqual(
            report.excluded_surfaces["official_web/fresh_news"],
            "not_current_rag_consumption_surface",
        )

    def test_institutional_rules_surface_records_release_baseline_and_answer_quality(self) -> None:
        report = build_rag_eval_coverage_report()
        by_surface = {surface.surface_key: surface for surface in report.surfaces}
        institutional = by_surface["regulations/institutional_rules"]

        self.assertEqual(institutional.profile_id, "institutional-rules-release-baseline")
        self.assertTrue(institutional.has_release_baseline_gate)
        self.assertTrue(institutional.has_answer_quality_cases)
        self.assertEqual(institutional.answer_quality_case_count, 42)
        self.assertGreaterEqual(institutional.qrels_case_count, 33)
        self.assertGreaterEqual(institutional.golden_qrels_case_count, 42)
        self.assertTrue(institutional.minimum_gate_passed)
        self.assertEqual(institutional.maturity_status, "baseline_ready")
        self.assertEqual(institutional.gaps, ())
        self.assertEqual(institutional.maturity_gaps, ())

    def test_student_rules_and_curriculum_reach_baseline_ready_maturity(
        self,
    ) -> None:
        report = build_rag_eval_coverage_report()
        by_surface = {surface.surface_key: surface for surface in report.surfaces}
        student_rules = by_surface["regulations/student_rules"]
        curriculum_plan = by_surface["curriculum/curriculum_plan"]

        self.assertTrue(report.minimum_gate_passed)
        self.assertTrue(report.passed)
        self.assertTrue(report.maturity_passed)
        self.assertEqual(student_rules.maturity_status, "baseline_ready")
        self.assertEqual(curriculum_plan.maturity_status, "baseline_ready")
        self.assertEqual(student_rules.recommended_target_case_count, 45)
        self.assertEqual(curriculum_plan.recommended_target_case_count, 60)
        self.assertEqual(student_rules.qrels_case_count, 52)
        self.assertEqual(student_rules.release_acceptance_case_count, 25)
        self.assertEqual(student_rules.unique_expected_doc_count, 46)
        self.assertTrue(student_rules.has_answer_quality_cases)
        self.assertGreaterEqual(student_rules.answer_quality_case_count, 5)
        self.assertEqual(student_rules.known_gap_case_count, 4)
        self.assertTrue(student_rules.known_gap_fixture.endswith("rag_known_gap_cases.v1.json"))
        self.assertEqual(curriculum_plan.qrels_case_count, 60)
        self.assertEqual(curriculum_plan.release_acceptance_case_count, 30)
        self.assertEqual(curriculum_plan.unique_expected_doc_count, 49)
        self.assertTrue(curriculum_plan.has_answer_quality_cases)
        self.assertGreaterEqual(curriculum_plan.answer_quality_case_count, 5)
        self.assertEqual(curriculum_plan.known_gap_case_count, 0)
        self.assertEqual(student_rules.maturity_gaps, ())
        self.assertEqual(curriculum_plan.maturity_gaps, ())
        self.assertEqual(report.maturity_gaps, ())

    def test_maturity_backlog_records_manual_authoring_case_types(self) -> None:
        report = build_rag_eval_coverage_report()
        by_surface = {surface.surface_key: surface for surface in report.surfaces}

        self.assertIn(
            "policy_title_exact_match", by_surface["regulations/student_rules"].backlog_case_types
        )
        self.assertIn(
            "program_family_disambiguation",
            by_surface["curriculum/curriculum_plan"].backlog_case_types,
        )
        self.assertTrue(
            by_surface["regulations/student_rules"].maturity_backlog_fixture.endswith(
                "rag_eval_maturity_backlog.v1.json"
            )
        )

    def test_report_fails_when_shared_denominator_registry_contains_non_consumed_rag_surface(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            registry_path = Path(temp_dir) / "registry.json"
            registry_path.write_text(
                """
{
  "schema_version": 1,
  "registry_id": "test",
  "updated_at": "2026-05-04",
  "entries": [
    {
      "surface_id": "student_rules",
      "domain_owner": "regulations/student_rules",
      "capability_family": "rag-agent",
      "admission_state": "admitted",
      "truth_scope": "denominator_expectation",
      "authors_domain_truth": false,
      "eval_families": ["retrieval_qrels"]
    },
    {
      "surface_id": "official_web/fresh_news",
      "domain_owner": "official_web/fresh_news",
      "capability_family": "rag-agent",
      "admission_state": "admitted",
      "truth_scope": "denominator_expectation",
      "authors_domain_truth": false,
      "eval_families": ["retrieval_qrels"]
    }
  ]
}
""".strip()
                + "\n",
                encoding="utf-8",
            )

            report = build_rag_eval_coverage_report(denominator_registry_path=registry_path)

        self.assertFalse(report.passed)
        self.assertIn(
            "rag denominator registry must exactly match current RAG consumption surfaces",
            report.gaps,
        )

    def test_cli_writes_rag_eval_coverage_report_json(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "rag-eval-coverage.json"
            with patch("builtins.print") as mocked_print:
                exit_code = main(["--output", str(output_path), "--json"])

            payload = output_path.read_text(encoding="utf-8")

        self.assertEqual(exit_code, 0)
        self.assertIn('"schema_version": "rag-eval-coverage-report-v2"', payload)
        self.assertIn('"maturity_status": "baseline_ready"', payload)
        self.assertIn('"maturity_passed": true', payload)
        self.assertIn('"official_web/fresh_news": "not_current_rag_consumption_surface"', payload)
        mocked_print.assert_called_once()


if __name__ == "__main__":
    unittest.main()
