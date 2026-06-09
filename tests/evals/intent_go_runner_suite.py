from __future__ import annotations

import unittest

from campus_evals.intent_go_runner import run_intent_cases_with_go
from campus_evals.intent_models import IntentCase


class IntentGoRunnerTest(unittest.TestCase):
    def test_go_runner_evaluates_cases_through_execution_control_runtime_policy(self) -> None:
        report = run_intent_cases_with_go(
            (
                IntentCase(
                    case_id="intent-go-knowledge-001",
                    user_goal="奖学金怎么申请？",
                    requested_capability="knowledge",
                    expected_capability="knowledge",
                    expected_task_kind="knowledge_lookup",
                    expected_launch_state="open",
                    expected_next_action="delegate",
                    expected_scope_class="in_scope",
                ),
                IntentCase(
                    case_id="intent-go-place-closed-001",
                    user_goal="图书馆在哪里",
                    requested_capability="place_lookup",
                    expected_capability="place_lookup",
                    expected_task_kind="place_lookup",
                    expected_launch_state="closed",
                    expected_next_action="out_of_scope",
                    expected_scope_class="out_of_scope",
                    expected_policy_reason="navigation_temporarily_unsupported",
                    expected_target="none",
                    critical=True,
                ),
            )
        )

        self.assertEqual(report.failed, 0)
        self.assertEqual(report.results[0].observed.classifier_version, "go-runtime-policy-v2")
        self.assertEqual(report.results[0].observed.planning_outcome, "preplanned")
        self.assertEqual(report.results[1].observed.terminal_status, "no_answer")


if __name__ == "__main__":
    unittest.main()
