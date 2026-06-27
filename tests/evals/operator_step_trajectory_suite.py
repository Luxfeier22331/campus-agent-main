from __future__ import annotations

import unittest

from campus_evals.operator_step_trajectory import (
    OPERATOR_STEP_TRAJECTORY_SCHEMA_VERSION,
    build_release_evidence_fixture,
    normalize_operator_step_trajectory,
    trajectory_attribution_for_stage,
)


class OperatorStepTrajectorySuite(unittest.TestCase):
    def test_normalizes_app_api_operator_step_trajectory_export(self) -> None:
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
                    "tool": "knowledge_query",
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
                    "tool": "knowledge_query",
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

    def test_prefers_operator_step_trajectory_over_legacy_summary(self) -> None:
        detail = _operator_request_detail()
        detail["runtimeRun"]["stepTrajectory"] = {
            "attemptCount": 1,
            "resultCount": 1,
            "steps": [
                {
                    "stepId": "wrong.legacy.summary",
                    "stepKind": "diagnostic",
                    "tool": "knowledge_query",
                    "status": "completed",
                    "attemptCount": 1,
                    "resultCount": 1,
                    "queueWaitMs": None,
                    "durationMs": None,
                    "taskQueue": "legacy",
                    "workerId": "legacy",
                    "inputTokens": 0,
                    "outputTokens": 0,
                    "estimatedCostMicrousd": 0,
                }
            ],
        }

        trajectory = normalize_operator_step_trajectory(detail)

        self.assertEqual(
            [step["stepId"] for step in trajectory["steps"]],
            ["retrieval.indexed_lookup", "synthesis"],
        )

    def test_rejects_workflow_summary_as_canonical_source(self) -> None:
        with self.assertRaisesRegex(ValueError, "runtimeRun.operatorStepTrajectory is required"):
            normalize_operator_step_trajectory(
                {
                    "requestId": "req_01HQ",
                    "runtimeRun": {
                        "workflowTraceSummary": {
                            "workflow_mode": "multi_step",
                            "tool_invocations": [],
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
        self.assertEqual(fixture["summary"]["failCloseReasonCounts"], {})
        self.assertEqual(
            fixture["summary"]["replanReasonCounts"],
            {"bounded_replan_after_provider_timeout": 1},
        )
        self.assertEqual(
            fixture["trajectoryRefs"],
            [
                {
                    "stepId": "retrieval.indexed_lookup",
                    "tool": "knowledge_query",
                    "stepKind": "retrieval",
                    "status": "completed",
                    "projectionRefs": ["projection://runs/run_01HQ/retrieval"],
                },
                {
                    "stepId": "synthesis",
                    "tool": "knowledge_query",
                    "stepKind": "synthesis",
                    "status": "completed",
                    "projectionRefs": ["projection://runs/run_01HQ/synthesis"],
                },
            ],
        )

    def test_builds_fail_close_counts_in_local_fixture(self) -> None:
        detail = _operator_request_detail()
        step = detail["runtimeRun"]["operatorStepTrajectory"]["steps"][1]  # type: ignore[index]
        step["failCloseReason"] = "current_state_unverifiable"
        step["replanReason"] = None

        fixture = build_release_evidence_fixture(
            normalize_operator_step_trajectory(detail),
            generated_at="2026-06-11T10:00:00Z",
            source_git_head="git-main",
        )

        self.assertEqual(
            fixture["summary"]["failCloseReasonCounts"],
            {"current_state_unverifiable": 1},
        )
        self.assertEqual(fixture["summary"]["replanReasonCounts"], {})

    def test_attributes_common_diagnostic_stage_aliases(self) -> None:
        trajectory = {
            "schemaVersion": OPERATOR_STEP_TRAJECTORY_SCHEMA_VERSION,
            "requestId": "req_alias",
            "runId": "run_alias",
            "traceId": "trace_alias",
            "conversationId": "conv_alias",
            "steps": [
                _trajectory_step("plan.route", "routing"),
                _trajectory_step("agent.primary", "agent"),
                _trajectory_step("sdk_tool.execute.transport_schedule_lookup.1", "tool"),
                _trajectory_step("retrieval.indexed_lookup", "retrieval"),
                _trajectory_step("retrieval.rerank", "rerank"),
                _trajectory_step("evidence.selection", "selection"),
                _trajectory_step("synthesis", "synthesis"),
                _trajectory_step("grounding.verify", "grounding"),
                _trajectory_step("finalization.write", "finalization"),
                _trajectory_step("plan.replan.1", "replan"),
            ],
        }

        for stage, want_step_id in {
            "routing": "plan.route",
            "route": "plan.route",
            "primary_agent": "agent.primary",
            "agent": "agent.primary",
            "tool": "sdk_tool.execute.transport_schedule_lookup.1",
            "typed_tool": "sdk_tool.execute.transport_schedule_lookup.1",
            "retrieval": "retrieval.indexed_lookup",
            "rerank": "retrieval.rerank",
            "evidence_selection": "evidence.selection",
            "selection": "evidence.selection",
            "synthesis": "synthesis",
            "grounding": "grounding.verify",
            "finalization": "finalization.write",
            "replan": "plan.replan.1",
        }.items():
            with self.subTest(stage=stage):
                attribution = trajectory_attribution_for_stage(
                    trajectory,
                    failure_stage=stage,
                )
                self.assertEqual(attribution["status"], "attributed")
                self.assertEqual(attribution["stepId"], want_step_id)

    def test_attributes_terminal_outcome_stages_to_finalization(self) -> None:
        trajectory = {
            "schemaVersion": OPERATOR_STEP_TRAJECTORY_SCHEMA_VERSION,
            "requestId": "req_terminal",
            "runId": "run_terminal",
            "traceId": "trace_terminal",
            "conversationId": "conv_terminal",
            "steps": [
                _trajectory_step("agent.primary", "agent"),
                _trajectory_step("finalization.write", "finalization"),
            ],
        }

        for stage in ("clarification", "needs_clarification", "rejected", "no_answer"):
            with self.subTest(stage=stage):
                attribution = trajectory_attribution_for_stage(
                    trajectory,
                    failure_stage=stage,
                )
                self.assertEqual(attribution["status"], "attributed")
                self.assertEqual(attribution["stepId"], "finalization.write")


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
            "operatorStepTrajectory": {
                "schemaVersion": "operator_step_trajectory.v1",
                "conversationId": "conv_01HQ",
                "requestId": "req_01HQ",
                "runId": "run_01HQ",
                "traceId": "trace_01HQ",
                "steps": [
                    {
                        "attemptCount": 1,
                        "tool": "knowledge_query",
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
                        "projectionRefs": ["projection://runs/run_01HQ/retrieval"],
                        "providerRequestRef": None,
                        "queueWaitMs": 25,
                        "replanReason": None,
                        "resultCount": 1,
                        "status": "completed",
                        "stepId": "retrieval.indexed_lookup",
                        "stepKind": "retrieval",
                        "taskQueue": "campus-agent.activity.knowledge",
                        "terminalReason": None,
                        "timeoutOutcome": "not_timed_out",
                        "toolName": None,
                        "toolStatus": None,
                        "workerId": "worker-1",
                    },
                    {
                        "attemptCount": 1,
                        "tool": "knowledge_query",
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
                        "projectionRefs": ["projection://runs/run_01HQ/synthesis"],
                        "providerRequestRef": "provider://requests/req_001",
                        "queueWaitMs": 30,
                        "replanReason": "bounded_replan_after_provider_timeout",
                        "resultCount": 1,
                        "status": "completed",
                        "stepId": "synthesis",
                        "stepKind": "synthesis",
                        "taskQueue": "campus-agent.activity.knowledge",
                        "terminalReason": None,
                        "timeoutOutcome": "provider_timeout",
                        "toolName": None,
                        "toolStatus": None,
                        "workerId": "worker-1",
                    },
                ],
            },
        },
    }


def _trajectory_step(step_id: str, step_kind: str) -> dict[str, object]:
    return {
        "stepId": step_id,
        "stepKind": step_kind,
        "tool": "knowledge_query",
        "toolName": None,
        "status": "completed",
        "attemptCount": 1,
        "resultCount": 1,
        "queueWaitMs": None,
        "durationMs": None,
        "taskQueue": "campus-agent.activity.test",
        "workerId": "test:worker:001",
        "projectionRefs": [f"projection://runs/run_alias/{step_id}"],
    }


if __name__ == "__main__":
    unittest.main()
