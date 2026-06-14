from __future__ import annotations

import unittest

from campus_contracts import KnowledgeScope
from campus_evals.intent_models import IntentCase
from campus_evals.intent_runner import run_intent_cases
from campus_evals.intent_scenarios import intent_context_follow_up_cases, intent_suite_cases


class IntentEvalRunnerTest(unittest.TestCase):
    def test_run_intent_cases_reports_exact_match_and_confusion(self) -> None:
        report = run_intent_cases(
            (
                IntentCase(
                    case_id="intent-knowledge-scholarship",
                    user_goal="奖学金怎么申请？",
                    requested_capability="knowledge",
                    expected_capability="knowledge",
                    expected_task_kind="knowledge_lookup",
                    expected_launch_state="open",
                    expected_next_action="delegate",
                    expected_scope_class="in_scope",
                    expected_target="knowledge",
                ),
                IntentCase(
                    case_id="intent-notice-candidate",
                    user_goal="民族学本科人才培养方案总学分要求是多少？",
                    requested_capability="knowledge",
                    expected_capability="knowledge",
                    expected_task_kind="knowledge_lookup",
                    expected_launch_state="open",
                    expected_next_action="delegate",
                    expected_scope_class="in_scope",
                    expected_target="knowledge",
                ),
                IntentCase(
                    case_id="intent-place-closed",
                    user_goal="图书馆在哪里",
                    requested_capability="place_lookup",
                    expected_capability="place_lookup",
                    expected_task_kind="place_lookup",
                    expected_launch_state="closed",
                    expected_next_action="out_of_scope",
                    expected_scope_class="out_of_scope",
                    expected_policy_reason="navigation_temporarily_unsupported",
                    expected_target="none",
                ),
            )
        )

        self.assertEqual(report.total, 3)
        self.assertEqual(report.passed, 3)
        self.assertEqual(report.overall_exact_match_rate, 1.0)
        self.assertEqual(report.critical_gate_pass_rate, 1.0)
        self.assertEqual(
            report.confusion["capability"],
            {
                "knowledge->knowledge": 2,
                "place_lookup->place_lookup": 1,
            },
        )

    def test_run_intent_cases_marks_critical_gate_failure(self) -> None:
        report = run_intent_cases(
            (
                IntentCase(
                    case_id="intent-place-closed-mismatch",
                    user_goal="图书馆在哪里",
                    requested_capability="place_lookup",
                    expected_capability="place_lookup",
                    expected_task_kind="place_lookup",
                    expected_launch_state="open",
                    expected_next_action="delegate",
                    expected_scope_class="in_scope",
                    expected_target="knowledge",
                    critical=True,
                ),
            )
        )

        self.assertEqual(report.total, 1)
        self.assertEqual(report.passed, 0)
        self.assertEqual(report.critical_gate_pass_rate, 0.0)
        self.assertEqual(report.results[0].mismatches["launch_state"], "closed != open")

    def test_intent_case_accepts_requested_scope(self) -> None:
        case = IntentCase(
            case_id="intent-explicit-scope",
            user_goal="library hours",
            requested_capability="knowledge",
            requested_scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
            expected_capability="knowledge",
            expected_task_kind="knowledge_lookup",
            expected_launch_state="open",
            expected_next_action="delegate",
            expected_scope_class="in_scope",
            expected_target="knowledge",
        )

        report = run_intent_cases((case,))

        self.assertEqual(report.passed, 1)
        self.assertEqual(report.results[0].observed.scope_reason, "explicit_requested_scope")

    def test_run_intent_cases_reports_context_resolution_metrics(self) -> None:
        report = run_intent_cases(
            intent_context_follow_up_cases(),
            runner="execution-control-go",
        )

        self.assertGreaterEqual(report.total, 3)
        self.assertEqual(report.failed, 0)
        self.assertEqual(report.context_resolution_accuracy, 1.0)
        self.assertIn("context_resolution_state", report.confusion)

    def test_named_intent_suites_are_available(self) -> None:
        self.assertGreater(len(intent_suite_cases("release_gate")), 0)
        self.assertGreater(len(intent_suite_cases("context_follow_up")), 0)
        self.assertGreater(len(intent_suite_cases("version_compat")), 0)
        self.assertGreater(len(intent_suite_cases("synthetic_regression")), 0)
        self.assertGreater(len(intent_suite_cases("synthetic_exploratory")), 0)


if __name__ == "__main__":
    unittest.main()
