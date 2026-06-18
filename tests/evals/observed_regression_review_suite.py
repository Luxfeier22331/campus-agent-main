from __future__ import annotations

import json
import unittest

from campus_evals.observed_regression_review import (
    build_observed_regression_review_outputs,
)
from campus_evals.observed_regression_review import (
    main as observed_regression_review_main,
)

from tests.evals.formal_benchmark_test_support import Path, TemporaryDirectory


def _pending_manifest() -> dict[str, object]:
    return {
        "schema_version": 1,
        "domain": "quality",
        "target_suite": "observed_regression",
        "generated_at": "2026-04-29T09:00:00.000Z",
        "candidates": [
            {
                "case_id": "eval_candidate:negative_feedback:feedback_01",
                "source": {
                    "feedback_id": "feedback_01",
                    "observed_failure_class": "wrong_intent",
                    "sampled_at": "2026-04-29T08:11:00.000Z",
                    "source_request_id": "req_feedback_01",
                    "source_surface": "campus_web",
                    "source_type": "negative_feedback",
                    "trace_id": "trace_feedback_01",
                },
                "review": {
                    "decision": "pending_review",
                    "suggested_labels": ["wrong_intent"],
                },
                "quality_candidate": {
                    "candidateId": "eval_candidate:negative_feedback:feedback_01",
                    "causeClass": "wrong_intent",
                    "summary": "Negative answer feedback for answer: wrong_intent.",
                },
            },
            {
                "case_id": "eval_candidate:operator_badcase:req_02",
                "source": {
                    "observed_failure_class": "unsupported_by_evidence",
                    "sampled_at": "2026-04-29T08:20:00.000Z",
                    "source_request_id": "req_badcase_02",
                    "source_surface": "campus_web",
                    "source_type": "operator_badcase",
                    "trace_id": "trace_badcase_02",
                },
                "review": {"decision": "pending_review"},
                "quality_candidate": {
                    "candidateId": "eval_candidate:operator_badcase:req_02",
                    "causeClass": "unsupported_by_evidence",
                    "summary": "Operator badcase.",
                },
            },
        ],
    }


def _accept_decision() -> dict[str, object]:
    return {
        "case_id": "eval_candidate:negative_feedback:feedback_01",
        "decision": "accept",
        "reviewer": "eval-governance",
        "reviewed_at": "2026-04-29T10:00:00.000Z",
        "reason": "Observed wrong intent should be locked as a regression.",
        "target_suite": "observed_regression",
        "accepted_domain": "intent",
        "accepted_case_id": "intent-observed-wrong-intent-feedback-001",
        "accepted_case": {
            "critical": True,
            "expected_capability": "knowledge",
            "expected_launch_state": "open",
            "expected_next_action": "delegate",
            "expected_policy_reason": "knowledge_query",
            "expected_scope_class": "in_scope",
            "expected_target": "knowledge",
            "expected_task_kind": "knowledge_lookup",
            "requested_capability": "knowledge",
            "tags": ["observed_regression", "feedback", "wrong_intent"],
            "user_goal": "校园卡丢了怎么办",
        },
    }


class ObservedRegressionReviewWorkflowTest(unittest.TestCase):
    def test_review_outputs_accept_reject_and_accepted_fixture_without_raw_candidate_payload(
        self,
    ) -> None:
        outputs = build_observed_regression_review_outputs(
            _pending_manifest(),
            [
                _accept_decision(),
                {
                    "case_id": "eval_candidate:operator_badcase:req_02",
                    "decision": "reject",
                    "reviewer": "eval-governance",
                    "reviewed_at": "2026-04-29T10:01:00.000Z",
                    "reason": "Not reproducible enough for regression truth.",
                    "target_suite": "observed_regression",
                },
            ],
        )

        reviewed_candidates = outputs.reviewed_manifest["candidates"]
        self.assertEqual(reviewed_candidates[0]["review"]["decision"], "accepted")
        self.assertEqual(reviewed_candidates[1]["review"]["decision"], "rejected")

        accepted_cases = outputs.accepted_fixture["cases"]
        self.assertEqual(len(accepted_cases), 1)
        accepted_case = accepted_cases[0]
        self.assertEqual(accepted_case["case_id"], "intent-observed-wrong-intent-feedback-001")
        self.assertEqual(accepted_case["domain"], "intent")
        self.assertEqual(accepted_case["review"]["decision"], "accepted")
        self.assertEqual(accepted_case["review"]["reviewer"], "eval-governance")
        self.assertEqual(
            accepted_case["source"]["source_request_id"],
            "req_feedback_01",
        )
        self.assertEqual(
            accepted_case["source"]["expected_fix_reason"],
            "Observed wrong intent should be locked as a regression.",
        )
        self.assertIn("intent_case", accepted_case)
        serialized = json.dumps(outputs.accepted_fixture, ensure_ascii=False)
        self.assertNotIn("quality_candidate", serialized)
        self.assertNotIn("rawTranscript", serialized)

    def test_accept_requires_eval_owned_rewritten_case_payload(self) -> None:
        decision = _accept_decision()
        decision.pop("accepted_case")

        with self.assertRaisesRegex(ValueError, "accepted_case is required"):
            build_observed_regression_review_outputs(_pending_manifest(), [decision])

    def test_duplicate_decision_requires_duplicate_of(self) -> None:
        with self.assertRaisesRegex(ValueError, "duplicate_of is required"):
            build_observed_regression_review_outputs(
                _pending_manifest(),
                [
                    {
                        "case_id": "eval_candidate:operator_badcase:req_02",
                        "decision": "duplicate",
                        "reviewer": "eval-governance",
                        "reviewed_at": "2026-04-29T10:01:00.000Z",
                        "reason": "Same issue as existing case.",
                        "target_suite": "observed_regression",
                    }
                ],
            )

    def test_review_rejects_raw_payload_keys_in_accepted_case(self) -> None:
        decision = _accept_decision()
        accepted_case = dict(decision["accepted_case"])
        accepted_case["rawTranscript"] = "do not persist"
        decision["accepted_case"] = accepted_case

        with self.assertRaisesRegex(ValueError, "forbidden raw workflow trace key"):
            build_observed_regression_review_outputs(_pending_manifest(), [decision])

    def test_review_cli_writes_reviewed_manifest_and_accepted_fixture(self) -> None:
        decisions = {
            "schema_version": 1,
            "decisions": [_accept_decision()],
        }
        with TemporaryDirectory() as tmpdir:
            manifest_path = Path(tmpdir) / "pending.json"
            decisions_path = Path(tmpdir) / "decisions.json"
            reviewed_output = Path(tmpdir) / "reviewed.json"
            accepted_output = Path(tmpdir) / "accepted.json"
            manifest_path.write_text(
                json.dumps(_pending_manifest(), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            decisions_path.write_text(
                json.dumps(decisions, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

            exit_code = observed_regression_review_main(
                [
                    "apply",
                    "--manifest",
                    str(manifest_path),
                    "--decisions",
                    str(decisions_path),
                    "--reviewed-output",
                    str(reviewed_output),
                    "--accepted-output",
                    str(accepted_output),
                ]
            )

            reviewed = json.loads(reviewed_output.read_text(encoding="utf-8"))
            accepted = json.loads(accepted_output.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertEqual(reviewed["candidates"][0]["review"]["decision"], "accepted")
        self.assertEqual(len(accepted["cases"]), 1)


class EvalAdmissionRawPayloadGuardTest(unittest.TestCase):
    def test_quality_candidate_admission_rejects_raw_payload_keys(self) -> None:
        from campus_evals.eval_admission import build_quality_feedback_candidate_review_manifest

        candidate = {
            "candidateId": "eval_candidate:negative_feedback:feedback_01",
            "causeClass": "wrong_intent",
            "intake": {
                "createdAt": "2026-04-29T08:11:00.000Z",
                "source": "negative_feedback",
                "status": "pending_review",
                "suggestedEvalFamily": "intent",
            },
            "rawTranscript": "do not store",
            "requestId": "req_feedback_01",
            "surface": "campus_web",
            "traceId": "trace_feedback_01",
        }

        with self.assertRaisesRegex(ValueError, "forbidden raw workflow trace key"):
            build_quality_feedback_candidate_review_manifest(
                [candidate],
                generated_at="2026-04-29T09:00:00.000Z",
                target_suite="observed_regression",
            )


class ObservedRegressionReviewPublicExportTest(unittest.TestCase):
    def test_public_package_exports_review_workflow(self) -> None:
        import campus_evals

        self.assertTrue(callable(campus_evals.build_observed_regression_review_outputs))
        self.assertTrue(callable(campus_evals.load_observed_regression_review_decisions))


if __name__ == "__main__":
    unittest.main()
