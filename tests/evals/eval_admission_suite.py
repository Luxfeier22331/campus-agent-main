from __future__ import annotations

import json
import unittest
from unittest.mock import patch

from campus_evals.eval_admission import (
    build_intent_candidate_review_manifest,
    build_quality_feedback_candidate_review_manifest,
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
                    "expected_fix_reason": "navigation remains closed until map rollout",
                    "observed_failure_class": "unexpected_handoff_target",
                    "sampled_at": "2026-04-25T00:00:00.000Z",
                    "source_request_id": "req_observed_navigation_001",
                    "source_surface": "public_chat_web",
                    "trace_id": "trace_observed_navigation_001",
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
        self.assertEqual(
            manifest["candidates"][0]["source"]["source_request_id"],
            "req_observed_navigation_001",
        )
        self.assertEqual(
            manifest["candidates"][0]["source"]["observed_failure_class"],
            "unexpected_handoff_target",
        )
        self.assertNotIn("source_request_id", manifest["candidates"][0]["intent_case"])

    def test_build_quality_feedback_candidate_review_manifest_wraps_app_api_candidates(
        self,
    ) -> None:
        manifest = build_quality_feedback_candidate_review_manifest(
            [
                {
                    "candidateId": "eval_candidate:negative_feedback:feedback_01",
                    "causeClass": "wrong_intent",
                    "correlation": {
                        "answerKind": "answer",
                        "assistantMessageId": "msg_assistant_01",
                        "citationPosture": "citation_missing",
                        "conversationId": "conv_01",
                        "intent": {
                            "capability": "knowledge",
                            "taskKind": "knowledge_lookup",
                        },
                    },
                    "feedback": {
                        "feedbackId": "feedback_01",
                        "reasonCodes": ["wrong_intent"],
                        "updatedAt": "2026-04-29T08:11:00.000Z",
                        "vote": "unhelpful",
                    },
                    "intake": {
                        "createdAt": "2026-04-29T08:11:00.000Z",
                        "source": "negative_feedback",
                        "status": "pending_review",
                        "suggestedEvalFamily": "intent",
                    },
                    "privacy": {
                        "providerRawResponseIncluded": False,
                        "rawAuthMaterialIncluded": False,
                        "rawTranscriptIncluded": False,
                    },
                    "requestId": "req_feedback_01",
                    "review": {"suggestedLabels": ["wrong_intent"]},
                    "selectedTarget": "rag-agent",
                    "summary": "Negative answer feedback for answer: wrong_intent.",
                    "surface": "public_chat_web",
                    "traceId": "trace_feedback_01",
                }
            ],
            generated_at="2026-04-29T09:00:00.000Z",
            target_suite="feedback_regression",
        )

        self.assertEqual(manifest["domain"], "quality")
        self.assertEqual(manifest["candidates"][0]["review"]["decision"], "pending_review")
        self.assertEqual(manifest["candidates"][0]["source"]["source_type"], "negative_feedback")
        self.assertEqual(
            manifest["candidates"][0]["source"]["source_request_id"], "req_feedback_01"
        )
        self.assertEqual(
            manifest["candidates"][0]["quality_candidate"]["feedback"]["reasonCodes"],
            ["wrong_intent"],
        )
        self.assertNotIn("rawTranscript", json.dumps(manifest))

    def test_build_intent_candidate_review_manifest_requires_observed_source_metadata(
        self,
    ) -> None:
        candidate = {
            "case_id": "mined-req-001",
            "expected_capability": "place_lookup",
            "expected_launch_state": "closed",
            "expected_next_action": "out_of_scope",
            "expected_scope_class": "out_of_scope",
            "expected_target": "none",
            "expected_task_kind": "place_lookup",
            "user_goal": "图书馆在哪里",
        }

        with self.assertRaisesRegex(ValueError, "source_request_id is required"):
            build_intent_candidate_review_manifest(
                [candidate],
                generated_at="2026-04-25T01:00:00.000Z",
                source="intent_case_miner",
                target_suite="observed_regression",
            )

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
            "expected_fix_reason": "navigation remains closed until map rollout",
            "observed_failure_class": "unexpected_handoff_target",
            "sampled_at": "2026-04-25T00:00:00.000Z",
            "source_request_id": "req_observed_navigation_001",
            "source_surface": "public_chat_web",
            "trace_id": "trace_observed_navigation_001",
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

    def test_eval_admission_cli_wraps_operator_quality_candidates(self) -> None:
        candidate = {
            "candidateId": "eval_candidate:req_01HQ:unsupported_by_evidence",
            "causeClass": "unsupported_by_evidence",
            "grade": {
                "graderVersion": "grader@2026-04-03",
                "result": "fail",
                "score": 0.25,
            },
            "intake": {
                "createdAt": "2026-04-03T00:10:00.000Z",
                "source": "operator_badcase",
                "status": "pending_review",
                "suggestedEvalFamily": "grounding",
            },
            "links": {
                "issueFingerprint": "unsupported-by-evidence",
                "issueLink": "https://sentry.example/issues/456",
                "traceLink": "https://sentry.example/traces/trace_01HQ",
            },
            "requestId": "req_01HQ",
            "selectedTarget": "rag-agent",
            "summary": "semanticOutcome=unsupported_by_evidence",
            "surface": "public_chat_web",
            "traceId": "trace_01HQ",
        }

        with TemporaryDirectory() as tmpdir:
            input_path = Path(tmpdir) / "quality-candidates.json"
            output_path = Path(tmpdir) / "quality-review-manifest.json"
            input_path.write_text(
                json.dumps({"candidates": [candidate]}, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )

            with patch("campus_evals.eval_admission._utc_now_iso") as now_mock:
                now_mock.return_value = "2026-04-29T09:00:00.000Z"
                exit_code = eval_admission_main(
                    [
                        "quality-candidates",
                        "--input",
                        str(input_path),
                        "--output",
                        str(output_path),
                        "--target-suite",
                        "observed_regression",
                    ]
                )

            payload = json.loads(output_path.read_text(encoding="utf-8"))

        self.assertEqual(exit_code, 0)
        self.assertEqual(payload["domain"], "quality")
        self.assertEqual(payload["target_suite"], "observed_regression")
        self.assertEqual(payload["candidates"][0]["review"]["decision"], "pending_review")
        self.assertEqual(payload["candidates"][0]["source"]["source_type"], "operator_badcase")
        self.assertEqual(
            payload["candidates"][0]["source"]["sampled_at"],
            "2026-04-03T00:10:00.000Z",
        )
        self.assertNotIn("accepted_at", payload["candidates"][0]["review"])


if __name__ == "__main__":
    unittest.main()
