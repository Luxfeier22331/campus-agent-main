from __future__ import annotations

import json
import unittest

from campus_evals.intent_models import IntentCase
from campus_evals.intent_scenarios import intent_suite_cases
from campus_evals.intent_synthetic import (
    load_intent_synthetic_exploratory_cases,
    load_intent_synthetic_regression_cases,
)

from tests.evals.formal_benchmark_test_support import Path, TemporaryDirectory


def _synthetic_payload() -> dict[str, object]:
    return {
        "schema_version": 1,
        "synthetic_set_version": "intent-synthetic-v1",
        "generator_version": "template-matrix-v1",
        "cases": [
            {
                "case_id": "synthetic-knowledge-scholarship-001",
                "review_status": "accepted_regression",
                "label_source": "human_policy_matrix",
                "axis": {
                    "capability": "knowledge",
                    "context_mode": "none",
                    "next_action": "delegate",
                    "query_style": "colloquial",
                },
                "intent_case": {
                    "expected_capability": "knowledge",
                    "expected_launch_state": "open",
                    "expected_next_action": "delegate",
                    "expected_scope_class": "in_scope",
                    "expected_target": "knowledge",
                    "expected_task_kind": "knowledge_lookup",
                    "requested_capability": "knowledge",
                    "tags": ["synthetic", "knowledge", "accepted_regression"],
                    "user_goal": "国奖条件是啥",
                },
            },
            {
                "case_id": "synthetic-notice-exploratory-001",
                "review_status": "exploratory_candidate",
                "label_source": "human_policy_matrix",
                "axis": {
                    "capability": "notice",
                    "context_mode": "none",
                    "next_action": "delegate",
                    "query_style": "abbreviated",
                },
                "intent_case": {
                    "expected_capability": "notice",
                    "expected_launch_state": "open",
                    "expected_next_action": "delegate",
                    "expected_scope_class": "in_scope",
                    "expected_scope_reason": "structured_runtime_candidate_signal",
                    "expected_target": "notice",
                    "expected_task_kind": "notice_lookup",
                    "requested_capability": "knowledge",
                    "tags": ["synthetic", "notice", "exploratory_candidate"],
                    "user_goal": "春假公告",
                },
            },
        ],
    }


class IntentSyntheticTest(unittest.TestCase):
    def test_load_intent_synthetic_regression_cases_reads_only_accepted_cases(self) -> None:
        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "intent-synthetic.json"
            path.write_text(json.dumps(_synthetic_payload(), ensure_ascii=False), encoding="utf-8")

            cases = load_intent_synthetic_regression_cases(path)

        self.assertEqual(len(cases), 1)
        self.assertEqual(cases[0].case_id, "synthetic-knowledge-scholarship-001")
        self.assertIn("synthetic_regression", cases[0].tags)
        self.assertIn("query_style:colloquial", cases[0].tags)
        self.assertEqual(cases[0].expected_target, "knowledge")

    def test_load_intent_synthetic_exploratory_cases_reads_only_exploratory_cases(self) -> None:
        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "intent-synthetic.json"
            path.write_text(json.dumps(_synthetic_payload(), ensure_ascii=False), encoding="utf-8")

            cases = load_intent_synthetic_exploratory_cases(path)

        self.assertEqual(len(cases), 1)
        self.assertEqual(cases[0].case_id, "synthetic-notice-exploratory-001")
        self.assertIn("synthetic_exploratory", cases[0].tags)
        self.assertIn("axis_capability:notice", cases[0].tags)

    def test_load_intent_synthetic_cases_rejects_classifier_derived_labels(self) -> None:
        payload = _synthetic_payload()
        payload["cases"][0]["label_source"] = "classifier_observed"

        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "intent-synthetic.json"
            path.write_text(json.dumps(payload), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "label_source must be human_policy_matrix"):
                load_intent_synthetic_regression_cases(path)

    def test_load_intent_synthetic_cases_rejects_duplicate_case_ids(self) -> None:
        payload = _synthetic_payload()
        payload["cases"] = [payload["cases"][0], payload["cases"][0]]

        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "intent-synthetic.json"
            path.write_text(json.dumps(payload), encoding="utf-8")

            with self.assertRaisesRegex(ValueError, "duplicate synthetic case_id"):
                load_intent_synthetic_regression_cases(path)

    def test_load_intent_synthetic_cases_expands_controlled_case_matrices(self) -> None:
        payload = {
            "schema_version": 1,
            "synthetic_set_version": "intent-synthetic-v1",
            "generator_version": "template-matrix-v1",
            "cases": [],
            "case_matrices": [
                {
                    "matrix_id": "synthetic-knowledge-scholarship",
                    "review_status": "accepted_regression",
                    "label_source": "human_policy_matrix",
                    "axis": {
                        "capability": "knowledge",
                        "context_mode": "none",
                        "next_action": "delegate",
                    },
                    "intent_case": {
                        "expected_capability": "knowledge",
                        "expected_launch_state": "open",
                        "expected_next_action": "delegate",
                        "expected_scope_class": "in_scope",
                        "expected_target": "knowledge",
                        "expected_task_kind": "knowledge_lookup",
                        "requested_capability": "knowledge",
                        "tags": ["synthetic", "knowledge"],
                    },
                    "variants": [
                        {
                            "axis": {"query_style": "short"},
                            "case_id": "synthetic-knowledge-scholarship-001",
                            "user_goal": "国奖条件",
                        },
                        {
                            "axis": {"query_style": "colloquial"},
                            "case_id": "synthetic-knowledge-scholarship-002",
                            "intent_case": {"critical": False},
                            "user_goal": "奖学金咋申请",
                        },
                    ],
                }
            ],
        }

        with TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "intent-synthetic.json"
            path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

            cases = load_intent_synthetic_regression_cases(path)

        self.assertEqual(
            [case.case_id for case in cases],
            [
                "synthetic-knowledge-scholarship-001",
                "synthetic-knowledge-scholarship-002",
            ],
        )
        self.assertEqual(cases[1].user_goal, "奖学金咋申请")
        self.assertIn("query_style:colloquial", cases[1].tags)

    def test_named_synthetic_suites_load_repo_fixture(self) -> None:
        regression_cases = intent_suite_cases("synthetic_regression")
        exploratory_cases = intent_suite_cases("synthetic_exploratory")

        self.assertGreaterEqual(len(regression_cases), 100)
        self.assertGreaterEqual(len(exploratory_cases), 18)
        self.assertTrue(all("synthetic_regression" in case.tags for case in regression_cases))
        self.assertTrue(all("synthetic_exploratory" in case.tags for case in exploratory_cases))

    def test_synthetic_selected_notice_cases_do_not_expect_notice_get_allowed_tool(self) -> None:
        regression_cases = intent_suite_cases("synthetic_regression")

        selected_notice_cases = [
            case
            for case in regression_cases
            if case.expected_context_reference_type == "selected_notice"
        ]

        self.assertTrue(selected_notice_cases)
        self.assertTrue(
            all(
                "campus_notice_get" not in case.expected_allowed_tools
                for case in selected_notice_cases
            )
        )

    def test_release_gate_does_not_delegate_non_transport_service_status_to_runtime(self) -> None:
        cases_by_goal: dict[str, list[IntentCase]] = {}
        for case in intent_suite_cases("release_gate"):
            cases_by_goal.setdefault(case.user_goal, []).append(case)

        for user_goal in (
            "卡务中心今天开不开",
            "校医院今天停诊了吗",
            "食堂现在关门了吗",
        ):
            self.assertIn(user_goal, cases_by_goal)
            self.assertTrue(
                all(case.expected_allowed_tools == () for case in cases_by_goal[user_goal])
            )
            self.assertTrue(
                all(case.expected_target != "campus_services" for case in cases_by_goal[user_goal])
            )

        transport_goal = "丰台校区通勤班车在哪里上车"
        self.assertIn(transport_goal, cases_by_goal)
        self.assertTrue(
            any(
                case.expected_capability == "campus_services"
                and case.expected_target == "campus_services"
                and case.expected_allowed_tools == ("transport_schedule_lookup",)
                for case in cases_by_goal[transport_goal]
            )
        )


if __name__ == "__main__":
    unittest.main()
