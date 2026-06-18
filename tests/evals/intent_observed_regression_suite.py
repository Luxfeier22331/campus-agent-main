from __future__ import annotations

import json
import unittest

from campus_evals.intent_observed_regression import (
    load_intent_observed_regression_cases,
)
from campus_evals.intent_scenarios import intent_suite_cases

from tests.evals.formal_benchmark_test_support import Path, TemporaryDirectory


def _accepted_case_payload(
    case_id: str = "intent-observed-navigation-closed-001",
) -> dict[str, object]:
    return {
        "schema_version": 1,
        "cases": [
            {
                "case_id": case_id,
                "domain": "intent",
                "source": {
                    "badcase_id": "qbad_observed_navigation_001",
                    "expected_fix_reason": "Navigation remains closed until map rollout.",
                    "observed_failure_class": "unexpected_handoff_target",
                    "sampled_at": "2026-04-25T00:00:00.000Z",
                    "source_request_id": "req_observed_navigation_001",
                    "source_surface": "campus_web",
                    "trace_id": "trace_observed_navigation_001",
                },
                "review": {
                    "decision": "accepted",
                    "reason": "Navigation remains closed until map rollout.",
                    "reviewed_at": "2026-04-25T00:05:00.000Z",
                    "reviewer": "eval-governance",
                    "target_suite": "observed_regression",
                },
                "intent_case": {
                    "critical": True,
                    "expected_capability": "place_lookup",
                    "expected_launch_state": "closed",
                    "expected_next_action": "out_of_scope",
                    "expected_policy_reason": "navigation_temporarily_unsupported",
                    "expected_scope_class": "out_of_scope",
                    "expected_target": "none",
                    "expected_task_kind": "place_lookup",
                    "tags": ["observed_regression", "navigation", "closed"],
                    "user_goal": "图书馆在哪里",
                },
            }
        ],
    }


class IntentObservedRegressionTest(unittest.TestCase):
    def test_load_intent_observed_regression_cases_reads_accepted_fixture(self) -> None:
        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "intent-observed-regression.json"
            path.write_text(
                json.dumps(_accepted_case_payload(), ensure_ascii=False),
                encoding="utf-8",
            )

            cases = load_intent_observed_regression_cases(path)

        self.assertEqual(len(cases), 1)
        self.assertEqual(cases[0].case_id, "intent-observed-navigation-closed-001")
        self.assertEqual(cases[0].expected_launch_state, "closed")
        self.assertEqual(cases[0].expected_policy_reason, "navigation_temporarily_unsupported")
        self.assertIn("observed_regression", cases[0].tags)

    def test_load_intent_observed_regression_cases_rejects_duplicate_case_ids(self) -> None:
        payload = _accepted_case_payload()
        payload["cases"] = [payload["cases"][0], payload["cases"][0]]

        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "intent-observed-regression.json"
            path.write_text(json.dumps(payload), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "duplicate observed regression case_id"):
                load_intent_observed_regression_cases(path)

    def test_load_intent_observed_regression_cases_requires_source_correlation(self) -> None:
        payload = _accepted_case_payload()
        payload["cases"][0]["source"]["source_request_id"] = ""

        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "intent-observed-regression.json"
            path.write_text(json.dumps(payload), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "source.source_request_id is required"):
                load_intent_observed_regression_cases(path)

    def test_named_observed_regression_suite_loads_repo_fixture(self) -> None:
        cases = intent_suite_cases("observed_regression")

        self.assertGreater(len(cases), 0)
        self.assertTrue(all("observed_regression" in case.tags for case in cases))


if __name__ == "__main__":
    unittest.main()
