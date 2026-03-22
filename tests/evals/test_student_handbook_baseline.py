from __future__ import annotations

import unittest

from campus_contracts import DelegateToRagAgentResponse, EvidenceBundle
from campus_evals.expectations import StudentHandbookExpectation
from campus_evals.runner import run_student_handbook_baseline
from campus_evals.scenarios import high_frequency_scenarios


class StudentHandbookBaselineTest(unittest.TestCase):
    def test_high_frequency_scenarios_cover_phase1_queries(self) -> None:
        goals = tuple(scenario.request.user_goal for scenario in high_frequency_scenarios())

        self.assertEqual(
            goals,
            (
                "library hours",
                "scholarship eligibility",
                "graduation credits",
                "registrar transcript",
                "add/drop",
                "leave of absence",
            ),
        )

    def test_runner_reports_per_scenario_outcomes(self) -> None:
        def fake_answerer(user_goal: str) -> DelegateToRagAgentResponse:
            return DelegateToRagAgentResponse(
                status="completed",
                answer_text=f"Answer for {user_goal}",
                confidence="medium",
                evidence=EvidenceBundle(query_text=user_goal, corpus="student_handbook"),
            )

        report = run_student_handbook_baseline(answerer=fake_answerer)

        self.assertEqual(report.total, 6)
        self.assertEqual(report.passed, 6)
        self.assertEqual(report.failed, 0)
        self.assertTrue(all(item.passed for item in report.results))

    def test_expectation_requires_completed_response_with_non_empty_answer(self) -> None:
        expectation = StudentHandbookExpectation(user_goal="library hours")

        passed = expectation.evaluate(
            DelegateToRagAgentResponse(
                status="completed",
                answer_text="The library is open from 08:00 to 22:00.",
                confidence="high",
                evidence=EvidenceBundle(query_text="library hours", corpus="student_handbook"),
            )
        )
        failed = expectation.evaluate(
            DelegateToRagAgentResponse(
                status="no_answer",
                confidence="low",
                evidence=EvidenceBundle(query_text="library hours", corpus="student_handbook"),
            )
        )

        self.assertTrue(passed.passed)
        self.assertFalse(failed.passed)
        self.assertIn("status", failed.reason)


if __name__ == "__main__":
    unittest.main()
