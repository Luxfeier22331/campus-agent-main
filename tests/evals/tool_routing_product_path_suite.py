from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from campus_evals.tool_routing_product_path import (
    ToolRoutingObservation,
    evaluate_tool_routing_cases,
    load_tool_routing_cases,
    run_tool_routing_product_path_profile,
)


class ToolRoutingProductPathSuite(unittest.TestCase):
    def test_fixture_uses_natural_language_goals_not_embedded_expected_arguments(self) -> None:
        case_set = load_tool_routing_cases()

        self.assertGreaterEqual(len(case_set.cases), 3)
        for case in case_set.cases:
            self.assertNotIn("expected_arguments", case.user_goal)
            self.assertNotIn(case.expected_tool, case.user_goal)

    def test_evaluator_distinguishes_routing_and_argument_errors(self) -> None:
        case_set = load_tool_routing_cases()
        first_case = case_set.cases[0]
        second_case = case_set.cases[1]
        observations = {
            first_case.case_id: ToolRoutingObservation(
                case_id=first_case.case_id,
                selected_tool="wrong_tool",
                terminal_outcome=first_case.expected_terminal_outcome,
                argument_summary=dict(first_case.expected_arguments),
                response_contract=dict(first_case.expected_response_contract),
            ),
            second_case.case_id: ToolRoutingObservation(
                case_id=second_case.case_id,
                selected_tool=second_case.expected_tool,
                terminal_outcome=second_case.expected_terminal_outcome,
                argument_summary={},
                response_contract=dict(second_case.expected_response_contract),
            ),
        }

        report = evaluate_tool_routing_cases(case_set.cases, observations)

        results = {result.case_id: result for result in report.results}
        self.assertEqual(results[first_case.case_id].failure_class, "routing_error")
        self.assertEqual(results[second_case.case_id].failure_class, "argument_extraction_error")

    def test_profile_writes_eval_profile_gate_artifact(self) -> None:
        case_set = load_tool_routing_cases()
        observations = {
            case.case_id: {
                "selected_tool": case.expected_tool,
                "terminal_outcome": case.expected_terminal_outcome,
                "argument_summary": case.expected_arguments,
                "response_contract": case.expected_response_contract,
            }
            for case in case_set.cases
        }

        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            observations_path = root / "observations.json"
            observations_path.write_text(
                json.dumps({"observations": observations}, ensure_ascii=False),
                encoding="utf-8",
            )
            report = run_tool_routing_product_path_profile(
                output_dir=root / "out",
                observations_path=observations_path,
                git_head_resolver=lambda: "abc123",
            )
            payload = json.loads(report.output_path.read_text(encoding="utf-8"))

        self.assertTrue(report.passed)
        self.assertEqual(payload["schema_version"], "eval_profile_gate.v1")
        self.assertEqual(payload["profile_id"], "tool_routing_product_path")
        self.assertTrue(payload["summary"]["metrics_missing"])


if __name__ == "__main__":
    unittest.main()
