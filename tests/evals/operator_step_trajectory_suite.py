from __future__ import annotations

import unittest

from campus_evals.operator_step_trajectory import (
    OPERATOR_STEP_TRAJECTORY_SCHEMA_VERSION,
    build_release_evidence_fixture,
    normalize_operator_step_trajectory,
)


class OperatorStepTrajectorySuite(unittest.TestCase):
    def test_normalizes_app_api_runtime_run_step_trajectory(self) -> None:
        trajectory = normalize_operator_step_trajectory(_operator_request_detail())

        self.assertEqual(trajectory["schemaVersion"], OPERATOR_STEP_TRAJECTORY_SCHEMA_VERSION)
        self.assertEqual(trajectory["requestId"], "req_01HQ")
        self.assertEqual(trajectory["runId"], "run_01HQ")
        self.assertEqual(trajectory["traceId"], "trace_01HQ")
        self.assertEqual(trajectory["conversationId"], "conv_01HQ")
        self.assertEqual(
            trajectory["steps"],
            [
                {
                    "stepId": "retrieval.indexed_lookup",
                    "stepKind": "retrieval",
                    "capability": "knowledge",
                    "toolName": None,
                    "status": "completed",
                    "attemptCount": 1,
                    "resultCount": 1,
                    "queueWaitMs": 25,
                    "durationMs": 100,
                    "taskQueue": "campus-agent.activity.knowledge",
                    "workerId": "worker-1",
                    "modelProvider": None,
                    "modelName": None,
                    "inputTokens": 0,
                    "outputTokens": 0,
                    "estimatedCostMicrousd": 0,
                    "providerRequestRef": None,
                    "failCloseReason": None,
                    "terminalReason": None,
                    "replanReason": None,
                    "cancelOutcome": "not_requested",
                    "timeoutOutcome": "not_timed_out",
                    "lateCompletionOutcome": "not_late",
                    "projectionRefs": ["projection://runs/run_01HQ/retrieval"],
                },
                {
                    "stepId": "synthesis",
                    "stepKind": "synthesis",
                    "capability": "knowledge",
                    "toolName": None,
                    "status": "completed",
                    "attemptCount": 1,
                    "resultCount": 1,
                    "queueWaitMs": 30,
                    "durationMs": 2200,
                    "taskQueue": "campus-agent.activity.knowledge",
                    "workerId": "worker-1",
                    "modelProvider": "openai",
                    "modelName": "gpt-5-mini",
                    "inputTokens": 120,
                    "outputTokens": 42,
                    "estimatedCostMicrousd": 321,
                    "providerRequestRef": "provider://requests/req_001",
                    "failCloseReason": None,
                    "terminalReason": None,
                    "replanReason": "bounded_replan_after_provider_timeout",
                    "cancelOutcome": "not_requested",
                    "timeoutOutcome": "provider_timeout",
                    "lateCompletionOutcome": "ignored_after_timeout",
                    "projectionRefs": ["projection://runs/run_01HQ/synthesis"],
                },
            ],
        )

    def test_rejects_workflow_summary_as_canonical_source(self) -> None:
        with self.assertRaisesRegex(ValueError, "runtimeRun.stepTrajectory is required"):
            normalize_operator_step_trajectory(
                {
                    "requestId": "req_01HQ",
                    "runtimeRun": {
                        "workflowTraceSummary": {
                            "workflow_mode": "multi_step",
                            "capability_invocations": [],
                        }
                    },
                }
            )

    def test_rejects_raw_or_local_artifact_fields(self) -> None:
        detail = _operator_request_detail()
        detail["runtimeRun"]["rawPrompt"] = "hidden prompt"

        with self.assertRaisesRegex(ValueError, "forbidden raw workflow trace key"):
            normalize_operator_step_trajectory(detail)

    def test_builds_release_evidence_shaped_local_fixture(self) -> None:
        fixture = build_release_evidence_fixture(
            normalize_operator_step_trajectory(_operator_request_detail()),
            generated_at="2026-06-11T10:00:00+00:00",
            source_git_head="git-main",
        )

        self.assertEqual(fixture["schemaVersion"], "operator_step_trajectory_release_fixture.v1")
        self.assertEqual(fixture["evidenceMode"], "local_fixture")
        self.assertFalse(fixture["stagingEvidence"])
        self.assertEqual(fixture["sourceGitHead"], "git-main")
        self.assertEqual(fixture["summary"]["stepCount"], 2)
        self.assertEqual(fixture["summary"]["timeoutOutcomeCounts"], {"provider_timeout": 1})
        self.assertEqual(
            fixture["trajectoryRefs"],
            [
                {
                    "stepId": "retrieval.indexed_lookup",
                    "capability": "knowledge",
                    "stepKind": "retrieval",
                    "status": "completed",
                    "projectionRefs": ["projection://runs/run_01HQ/retrieval"],
                },
                {
                    "stepId": "synthesis",
                    "capability": "knowledge",
                    "stepKind": "synthesis",
                    "status": "completed",
                    "projectionRefs": ["projection://runs/run_01HQ/synthesis"],
                },
            ],
        )


def _operator_request_detail() -> dict[str, object]:
    return {
        "requestId": "req_01HQ",
        "runtimeRun": {
            "run": {
                "conversationId": "conv_01HQ",
                "requestId": "req_01HQ",
                "runId": "run_01HQ",
                "status": "completed",
                "terminalReason": None,
                "traceId": "trace_01HQ",
            },
            "stepTrajectory": {
                "attemptCount": 2,
                "resultCount": 2,
                "steps": [
                    {
                        "attemptCount": 1,
                        "capability": "knowledge",
                        "cancelOutcome": "not_requested",
                        "durationMs": 100,
                        "estimatedCostMicrousd": 0,
                        "failCloseReason": None,
                        "inputTokens": 0,
                        "lateCompletionOutcome": "not_late",
                        "latestResultRef": "projection://runs/run_01HQ/retrieval",
                        "modelName": None,
                        "modelProvider": None,
                        "outputTokens": 0,
                        "providerRequestRef": None,
                        "queueWaitMs": 25,
                        "replanReason": None,
                        "resultCount": 1,
                        "status": "completed",
                        "stepId": "retrieval.indexed_lookup",
                        "stepKind": "retrieval",
                        "taskQueue": "campus-agent.activity.knowledge",
                        "timeoutOutcome": "not_timed_out",
                        "workerId": "worker-1",
                    },
                    {
                        "attemptCount": 1,
                        "capability": "knowledge",
                        "cancelOutcome": "not_requested",
                        "durationMs": 2200,
                        "estimatedCostMicrousd": 321,
                        "failCloseReason": None,
                        "inputTokens": 120,
                        "lateCompletionOutcome": "ignored_after_timeout",
                        "latestResultRef": "projection://runs/run_01HQ/synthesis",
                        "modelName": "gpt-5-mini",
                        "modelProvider": "openai",
                        "outputTokens": 42,
                        "providerRequestRef": "provider://requests/req_001",
                        "queueWaitMs": 30,
                        "replanReason": "bounded_replan_after_provider_timeout",
                        "resultCount": 1,
                        "status": "completed",
                        "stepId": "synthesis",
                        "stepKind": "synthesis",
                        "taskQueue": "campus-agent.activity.knowledge",
                        "timeoutOutcome": "provider_timeout",
                        "workerId": "worker-1",
                    },
                ],
            },
        },
    }


if __name__ == "__main__":
    unittest.main()
