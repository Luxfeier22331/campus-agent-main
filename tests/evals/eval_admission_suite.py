from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from campus_evals.eval_admission import (
    build_intent_candidate_review_manifest,
)
from campus_evals.eval_admission import (
    main as eval_admission_main,
)

from tests.evals.formal_benchmark_test_support import Path, TemporaryDirectory


class EvalAdmissionTest(unittest.TestCase):
    def test_build_intent_candidate_review_manifest_keeps_candidates_pending(self) -> None:
        manifest = build_intent_candidate_review_manifest(
            [
                {
                    "case_id": "mined-req-001",
                    "critical": True,
                    "expected_capability": "place_lookup",
                    "expected_launch_state": "closed",
                    "expected_next_action": "out_of_scope",
                    "expected_policy_reason": "navigation_temporarily_unsupported",
                    "expected_scope_class": "out_of_scope",
                    "expected_target": "none",
                    "expected_task_kind": "place_lookup",
                    "tags": ["mined", "closed"],
                    "user_goal": "图书馆在哪里",
                }
            ],
            generated_at="2026-04-25T01:00:00.000Z",
            source="intent_case_miner",
            target_suite="observed_regression",
        )

        self.assertEqual(manifest["schema_version"], 1)
        self.assertEqual(manifest["domain"], "intent")
        self.assertEqual(manifest["target_suite"], "observed_regression")
        self.assertEqual(manifest["candidates"][0]["review"]["decision"], "pending_review")
        self.assertEqual(manifest["candidates"][0]["source"]["source_type"], "intent_case_miner")

    def test_eval_admission_cli_writes_review_manifest_without_accepting_truth(self) -> None:
        candidate = {
            "case_id": "mined-req-001",
            "critical": True,
            "expected_capability": "place_lookup",
            "expected_launch_state": "closed",
            "expected_next_action": "out_of_scope",
            "expected_policy_reason": "navigation_temporarily_unsupported",
            "expected_scope_class": "out_of_scope",
            "expected_target": "none",
            "expected_task_kind": "place_lookup",
            "tags": ["mined", "closed"],
            "user_goal": "图书馆在哪里",
        }

        with TemporaryDirectory() as tmpdir:
            input_path = Path(tmpdir) / "intent-candidates.jsonl"
            output_path = Path(tmpdir) / "review-manifest.json"
            input_path.write_text(
                json.dumps(candidate, ensure_ascii=False) + "\n", encoding="utf-8"
            )

            with patch("campus_evals.eval_admission._utc_now_iso") as now_mock:
                now_mock.return_value = "2026-04-25T01:00:00.000Z"
                exit_code = eval_admission_main(
                    [
                        "intent-candidates",
                        "--input",
                        str(input_path),
                        "--output",
                        str(output_path),
                    ]
                )

            payload = json.loads(output_path.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertEqual(payload["generated_at"], "2026-04-25T01:00:00.000Z")
        self.assertEqual(payload["candidates"][0]["review"]["decision"], "pending_review")
        self.assertNotIn("accepted_at", payload["candidates"][0]["review"])


if __name__ == "__main__":
    unittest.main()
