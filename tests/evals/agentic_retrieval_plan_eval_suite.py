from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_evals.agentic_retrieval_plan_eval import (
    AGENTIC_RETRIEVAL_PLAN_CASES_PATH,
    AgenticRetrievalPlanObservation,
    evaluate_agentic_retrieval_plan_cases,
    load_agentic_retrieval_plan_cases,
)


class AgenticRetrievalPlanEvalTest(unittest.TestCase):
    def test_loads_agentic_retrieval_plan_fixture(self) -> None:
        case_set = load_agentic_retrieval_plan_cases()

        self.assertTrue(AGENTIC_RETRIEVAL_PLAN_CASES_PATH.exists())
        self.assertEqual(case_set.schema_version, 1)
        self.assertEqual(case_set.case_family, "agentic_retrieval_plan.v1")
        case_ids = {case.case_id for case in case_set.cases}
        self.assertIn("agentic-current-policy-freshness-branch", case_ids)
        self.assertIn("agentic-live-branch-fail-close", case_ids)

    def test_evaluates_plan_freshness_evidence_and_answer_separately(self) -> None:
        case_set = load_agentic_retrieval_plan_cases()
        observations = {
            case.case_id: AgenticRetrievalPlanObservation(
                case_id=case.case_id,
                decomposition=case.expected.decomposition,
                step_plan=case.expected.step_plan,
                freshness_branch=case.expected.freshness_branch,
                live_branch_outcome=case.expected.live_branch_outcome,
                fail_close_reason=case.expected.fail_close_reason,
                supporting_evidence_ids=case.expected.supporting_evidence_ids,
                final_answer_status=case.expected.final_answer_status,
            )
            for case in case_set.cases
        }

        report = evaluate_agentic_retrieval_plan_cases(case_set.cases, observations)

        self.assertTrue(report.passed)
        self.assertEqual(report.passed_count, len(case_set.cases))

    def test_report_distinguishes_plan_evidence_freshness_and_answer_failures(self) -> None:
        case_set = load_agentic_retrieval_plan_cases()
        current_case = next(
            case
            for case in case_set.cases
            if case.case_id == "agentic-current-policy-freshness-branch"
        )
        live_case = next(
            case for case in case_set.cases if case.case_id == "agentic-live-branch-fail-close"
        )

        report = evaluate_agentic_retrieval_plan_cases(
            (current_case, live_case),
            {
                current_case.case_id: AgenticRetrievalPlanObservation(
                    case_id=current_case.case_id,
                    decomposition=("wrong",),
                    step_plan=current_case.expected.step_plan,
                    freshness_branch="historical",
                    live_branch_outcome=current_case.expected.live_branch_outcome,
                    supporting_evidence_ids=("wrong-evidence",),
                    final_answer_status="completed",
                ),
                live_case.case_id: AgenticRetrievalPlanObservation(
                    case_id=live_case.case_id,
                    decomposition=live_case.expected.decomposition,
                    step_plan=live_case.expected.step_plan,
                    freshness_branch=live_case.expected.freshness_branch,
                    live_branch_outcome="completed",
                    fail_close_reason="",
                    supporting_evidence_ids=live_case.expected.supporting_evidence_ids,
                    final_answer_status="completed",
                ),
            },
        )

        self.assertFalse(report.passed)
        results = {result.case_id: result for result in report.results}
        self.assertEqual(
            results["agentic-current-policy-freshness-branch"].failure_classes,
            ("plan_error", "freshness_branch_error", "evidence_error"),
        )
        self.assertEqual(
            results["agentic-live-branch-fail-close"].failure_classes,
            ("live_branch_fail_close_error", "final_answer_error"),
        )

    def test_report_writes_machine_readable_artifact(self) -> None:
        case_set = load_agentic_retrieval_plan_cases()
        observations = {
            case.case_id: AgenticRetrievalPlanObservation(
                case_id=case.case_id,
                decomposition=case.expected.decomposition,
                step_plan=case.expected.step_plan,
                freshness_branch=case.expected.freshness_branch,
                live_branch_outcome=case.expected.live_branch_outcome,
                fail_close_reason=case.expected.fail_close_reason,
                supporting_evidence_ids=case.expected.supporting_evidence_ids,
                final_answer_status=case.expected.final_answer_status,
            )
            for case in case_set.cases
        }

        with TemporaryDirectory() as tmpdir:
            output_path = Path(tmpdir) / "agentic-retrieval-plan-eval.json"
            report = evaluate_agentic_retrieval_plan_cases(
                case_set.cases,
                observations,
                output_path=output_path,
            )
            payload = json.loads(output_path.read_text(encoding="utf-8"))

        self.assertTrue(report.passed)
        self.assertEqual(payload["schema_version"], 1)
        self.assertEqual(payload["case_family"], "agentic_retrieval_plan.v1")


if __name__ == "__main__":
    unittest.main()
