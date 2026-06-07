# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.evals.workflow_trace_gate_suite_support import *


class WorkflowTraceGateEvaluatorTestPart02(unittest.TestCase):
    def test_evaluates_all_workflow_trace_dimensions_as_passed(self) -> None:
        results = evaluate_workflow_trace_case(_workflow_case(), _trace_summary())

        self.assertTrue(results.direct_vs_delegate_branch_correctness.passed)
        self.assertTrue(results.handoff_correctness.passed)
        self.assertTrue(results.tool_argument_precision.passed)
        self.assertTrue(results.guardrail_correctness.passed)
        self.assertTrue(results.fail_close_correctness.passed)
        self.assertTrue(results.trace_projection_completeness.passed)
        self.assertTrue(results.tool_order_correctness.passed)
        self.assertTrue(results.tool_result_status_correctness.passed)
        self.assertTrue(results.evidence_source_selection.passed)

    def test_validates_current_workflow_mode_and_handoff_chain_shape(self) -> None:
        delegate_case = _workflow_case(
            direct_vs_delegate_branch="delegate",
            workflow_mode="single_step",
            selected_target="rag-agent",
            selected_tools=("retrieval.query",),
            handoff={"target": "rag-agent"},
            handoff_chain=({"target": "rag-agent", "selected_tool": "retrieval.query"},),
            tool_argument_summary={"collection": "student_rules"},
            tool_call_summaries=(
                {
                    "result_projection": "bounded_summary",
                    "raw_result_included": False,
                    "tool_name": "retrieval.query",
                    "result_status": "completed",
                    "source_ids": ["student_rules:leave-policy"],
                },
            ),
            expected_source_ids=("student_rules:leave-policy",),
        )
        delegate_summary = _trace_summary(
            workflow_mode="single_step",
            direct_vs_delegate_branch="delegate",
            selected_target="rag-agent",
            selected_tools=("retrieval.query",),
            handoff={"target": "rag-agent"},
            handoff_chain=({"target": "rag-agent", "selected_tool": "retrieval.query"},),
            agent_invocations=(
                {
                    "invocation_id": "agent-invocation:rag-agent:1",
                    "workflow_run_ref": "run-test",
                    "step_id": "handoff:rag-agent:rag_request",
                    "agent_id": "rag-agent",
                    "status": "completed",
                },
            ),
            tool_argument_summary={"collection": "student_rules"},
            tool_call_summaries=(
                {
                    "result_projection": "bounded_summary",
                    "raw_result_included": False,
                    "tool_name": "retrieval.query",
                    "result_status": "completed",
                    "source_ids": ["student_rules:leave-policy"],
                },
            ),
        )

        delegate_results = evaluate_workflow_trace_case(delegate_case, delegate_summary)
        self.assertTrue(delegate_results.handoff_correctness.passed)
        self.assertTrue(delegate_results.trace_projection_completeness.passed)

        terminal_results = evaluate_workflow_trace_case(
            _workflow_case(
                direct_vs_delegate_branch="fail_close",
                workflow_mode="terminal",
                selected_target="none",
                selected_tools=(),
                handoff={},
                handoff_chain=(),
                tool_argument_summary={},
                tool_call_summaries=(),
                fail_close_expected=True,
                fail_close_reason="transactional_action_not_supported",
            ),
            _trace_summary(
                workflow_mode="terminal",
                direct_vs_delegate_branch="fail_close",
                selected_target="none",
                selected_tools=(),
                handoff={},
                handoff_chain=(),
                tool_argument_summary={},
                tool_call_summaries=(),
                fail_close_reason="transactional_action_not_supported",
            ),
        )
        self.assertTrue(terminal_results.handoff_correctness.passed)
        self.assertTrue(terminal_results.trace_projection_completeness.passed)

    def test_multi_step_trace_requires_more_than_single_step_projection(self) -> None:
        multi_step_case = _workflow_case(
            direct_vs_delegate_branch="delegate",
            workflow_mode="multi_step",
            selected_target="rag-agent",
            selected_tools=("retrieval.query",),
            handoff={"target": "rag-agent"},
            handoff_chain=(
                {"target": "rag-agent", "selected_tool": "retrieval.query"},
                {"target": "notice-agent", "payload_kind": "campus_notice_get"},
            ),
            tool_argument_summary={"collection": "student_rules"},
            tool_call_summaries=(
                {
                    "tool_name": "retrieval.query",
                    "result_status": "completed",
                    "source_ids": ["student_rules:leave-policy"],
                },
            ),
        )
        single_step_projection = _trace_summary(
            workflow_mode="multi_step",
            direct_vs_delegate_branch="delegate",
            selected_target="rag-agent",
            selected_tools=("retrieval.query",),
            handoff={"target": "rag-agent"},
            handoff_chain=({"target": "rag-agent", "selected_tool": "retrieval.query"},),
            tool_argument_summary={"collection": "student_rules"},
            tool_call_summaries=(
                {
                    "tool_name": "retrieval.query",
                    "result_status": "completed",
                    "source_ids": ["student_rules:leave-policy"],
                },
            ),
        )

        results = evaluate_workflow_trace_case(multi_step_case, single_step_projection)

        self.assertFalse(results.trace_projection_completeness.passed)
        self.assertIn("handoff_chain.multi_step", results.trace_projection_completeness.reason)

    def test_fails_wrong_branch_target_tools_arguments_guardrails_and_fail_close(self) -> None:
        results = evaluate_workflow_trace_case(
            _workflow_case(fail_close_expected=True, fail_close_reason="policy_unavailable"),
            _trace_summary(
                direct_vs_delegate_branch="delegate",
                handoff={"target": "rag-agent"},
                selected_target="rag-agent",
                selected_tools=("retrieval.query",),
                tool_argument_summary={"collection": "student_rules"},
                guardrail_outcomes={"visibility": "restricted"},
                fail_close_reason="",
            ),
        )

        self.assertFalse(results.direct_vs_delegate_branch_correctness.passed)
        self.assertFalse(results.handoff_correctness.passed)
        self.assertFalse(results.tool_argument_precision.passed)
        self.assertFalse(results.guardrail_correctness.passed)
        self.assertFalse(results.fail_close_correctness.passed)

    def test_fails_tool_order_result_status_and_source_selection_mismatches(self) -> None:
        results = evaluate_workflow_trace_case(
            _workflow_case(
                selected_tools=("service_status_lookup", "transport_schedule_lookup"),
                expected_tool_order=("service_status_lookup", "transport_schedule_lookup"),
                expected_tool_result_statuses={
                    "service_status_lookup": "completed",
                    "transport_schedule_lookup": "completed",
                },
                expected_source_ids=("service_status:campus_card",),
            ),
            _trace_summary(
                selected_tools=("transport_schedule_lookup", "service_status_lookup"),
                tool_call_summaries=(
                    {
                        "tool_name": "transport_schedule_lookup",
                        "result_status": "completed",
                        "source_ids": ["transport_schedule:commute"],
                    },
                    {
                        "tool_name": "service_status_lookup",
                        "result_status": "projection_missing",
                        "source_ids": [],
                    },
                ),
            ),
        )

        self.assertFalse(results.tool_order_correctness.passed)
        self.assertFalse(results.tool_result_status_correctness.passed)
        self.assertFalse(results.evidence_source_selection.passed)
        self.assertIn("tool_order", results.tool_order_correctness.reason)
        self.assertIn("result_status", results.tool_result_status_correctness.reason)
        self.assertIn("source_ids", results.evidence_source_selection.reason)

    def test_fails_selected_target_mismatch_even_when_handoff_payload_matches(self) -> None:
        results = evaluate_workflow_trace_case(
            _workflow_case(),
            _trace_summary(selected_target="rag-agent"),
        )

        self.assertFalse(results.handoff_correctness.passed)
        self.assertIn("selected_target", results.handoff_correctness.reason)

    def test_fails_selected_tools_mismatch_even_when_arguments_match(self) -> None:
        results = evaluate_workflow_trace_case(
            _workflow_case(),
            _trace_summary(selected_tools=("service_status_lookup",)),
        )

        self.assertFalse(results.tool_argument_precision.passed)
        self.assertIn("selected_tools", results.tool_argument_precision.reason)

    def test_fails_trace_projection_completeness_when_runtime_summary_is_missing(self) -> None:
        results = evaluate_workflow_trace_case(_workflow_case(), None)

        self.assertFalse(results.trace_projection_completeness.passed)
        self.assertIn("workflow_trace_summary", results.trace_projection_completeness.reason)

    def test_fails_trace_projection_completeness_when_selected_tools_lack_call_summaries(
        self,
    ) -> None:
        results = evaluate_workflow_trace_case(
            _workflow_case(),
            _trace_summary(tool_call_summaries=()),
        )

        self.assertFalse(results.trace_projection_completeness.passed)
        self.assertIn("tool_call_summaries", results.trace_projection_completeness.reason)

    def test_fails_trace_projection_completeness_when_tool_summary_is_not_bounded(self) -> None:
        results = evaluate_workflow_trace_case(
            _workflow_case(),
            _trace_summary(
                tool_call_summaries=(
                    {
                        "tool_name": "transport_schedule_lookup",
                        "result_status": "completed",
                        "result_projection": "raw_result",
                        "raw_result_included": True,
                        "source_ids": ["transport_schedule:commute"],
                    },
                )
            ),
        )

        self.assertFalse(results.trace_projection_completeness.passed)
        self.assertIn("tool_call_summaries.bounded", results.trace_projection_completeness.reason)

    def test_fails_trace_projection_completeness_when_tool_summary_lacks_source_or_fail_close(
        self,
    ) -> None:
        results = evaluate_workflow_trace_case(
            _workflow_case(),
            _trace_summary(
                tool_call_summaries=(
                    {
                        "tool_name": "transport_schedule_lookup",
                        "result_status": "completed",
                        "result_projection": "bounded_summary",
                        "raw_result_included": False,
                        "source_ids": [],
                    },
                )
            ),
        )

        self.assertFalse(results.trace_projection_completeness.passed)
        self.assertIn(
            "tool_call_summaries.provenance", results.trace_projection_completeness.reason
        )

    def test_fails_trace_projection_completeness_when_tool_fail_close_lacks_reason(self) -> None:
        results = evaluate_workflow_trace_case(
            _workflow_case(),
            _trace_summary(
                tool_call_summaries=(
                    {
                        "tool_name": "transport_schedule_lookup",
                        "result_status": "temporarily_unverifiable",
                        "result_projection": "bounded_summary",
                        "raw_result_included": False,
                        "source_ids": [],
                    },
                )
            ),
        )

        self.assertFalse(results.trace_projection_completeness.passed)
        self.assertIn(
            "tool_call_summaries.fail_close_reason",
            results.trace_projection_completeness.reason,
        )

    def test_fails_trace_projection_completeness_when_context_projection_summary_is_raw(
        self,
    ) -> None:
        results = evaluate_workflow_trace_case(
            _workflow_case(),
            _trace_summary(
                direct_vs_delegate_branch="multi_step",
                workflow_mode="multi_step",
                selected_target="rag-agent",
                selected_tools=("retrieval.query",),
                handoff_chain=(
                    {"target": "notice-agent", "payload_kind": "campus_notice_get"},
                    {"target": "rag-agent", "payload_kind": "rag_request"},
                ),
                context_projections=(
                    {
                        "projection_id": "proj-notice-001",
                        "source_step_id": "handoff:notice-agent:campus_notice_get",
                        "projection_kind": "notice_context",
                        "content_hash": "sha256:test",
                        "payload": {
                            "body_excerpt": "workflow trace summary must not expose payload"
                        },
                        "safety": {"max_chars": 1600, "fields_present": ["title"]},
                    },
                ),
                agent_invocations=(
                    {
                        "invocation_id": "agent-invocation:notice-agent:campus_notice_get",
                        "workflow_run_ref": "run-test",
                        "step_id": "handoff:notice-agent:campus_notice_get",
                        "agent_id": "notice-agent",
                        "status": "completed",
                    },
                    {
                        "invocation_id": "agent-invocation:rag-agent:rag_request",
                        "parent_invocation_id": "agent-invocation:notice-agent:campus_notice_get",
                        "workflow_run_ref": "run-test",
                        "step_id": "handoff:rag-agent:rag_request",
                        "agent_id": "rag-agent",
                        "status": "completed",
                        "projection_ids": ["proj-notice-001"],
                    },
                ),
            ),
        )

        self.assertFalse(results.trace_projection_completeness.passed)
        self.assertIn(
            "context_projections.raw_payload", results.trace_projection_completeness.reason
        )

    def test_loads_workflow_trace_summary_from_process_smoke_artifact(self) -> None:
        with TemporaryDirectory() as temp_dir:
            report_path = Path(temp_dir) / "process-smoke-summary.json"
            report_path.write_text(
                json.dumps(
                    {
                        "schema_version": "supervisor_runtime_process_smoke.v1",
                        "profile": "transport_schedule_sdk_opened",
                        "passed": True,
                        "answer": {
                            "workflow_trace_summary": {
                                "routing_frame": {"scope_gate_decision": "allow"},
                                "context_resolution": {"state": "ok"},
                                "planning_outcome": "preplanned",
                                "direct_vs_delegate_branch": "delegate",
                                "workflow_mode": "single_step",
                                "handoff": {"target": "campus-services-agent"},
                                "handoff_chain": [
                                    {
                                        "target": "campus-services-agent",
                                        "selected_tool": "transport_schedule_lookup",
                                    }
                                ],
                                "selected_target": "campus-services-agent",
                                "selected_tools": ["transport_schedule_lookup"],
                                "tool_argument_summary": {
                                    "payload_kind": "transport_schedule_lookup"
                                },
                                "trace_steps": [
                                    {
                                        "step_id": "runtime_policy",
                                        "span_kind": "runtime_policy",
                                        "parent_step_id": "",
                                        "outcome": "delegate",
                                    },
                                    {
                                        "step_id": "tool_call",
                                        "span_kind": "tool_call",
                                        "parent_step_id": "runtime_policy",
                                        "tool_name": "transport_schedule_lookup",
                                        "outcome": "completed",
                                        "result_status": "completed",
                                        "retry_count": 0,
                                    },
                                ],
                                "agent_invocations": [
                                    {
                                        "invocation_id": "agent-invocation:campus-services-agent:1",
                                        "workflow_run_ref": "single_step:campus-services-agent:transport_schedule_lookup",
                                        "step_id": "handoff:campus-services-agent:transport_schedule_lookup",
                                        "agent_id": "campus-services-agent",
                                        "status": "completed",
                                    }
                                ],
                                "tool_call_summaries": [
                                    {
                                        "result_projection": "bounded_summary",
                                        "raw_result_included": False,
                                        "tool_name": "transport_schedule_lookup",
                                        "result_status": "completed",
                                        "source_ids": ["smoke:transport-schedule"],
                                    }
                                ],
                                "guardrail_outcomes": {"scope_gate": "allow"},
                                "fail_close_reason": "",
                                "runtime_versions": {"workflow_trace_summary": "test"},
                                "policy_artifact_versions": {"intent_policy": "test"},
                            }
                        },
                    }
                ),
                encoding="utf-8",
            )

            summaries = load_process_smoke_workflow_trace_summaries(
                (report_path,),
                profile_case_ids={
                    "transport_schedule_sdk_opened": "workflow-transport-schedule-sdk",
                },
            )

        self.assertIn("workflow-transport-schedule-sdk", summaries)
        self.assertEqual(
            summaries["workflow-transport-schedule-sdk"].selected_tools,
            ("transport_schedule_lookup",),
        )

    def test_transport_notice_override_fixture_declares_notice_change_set_answer_artifacts(
        self,
    ) -> None:
        case_set = load_workflow_trace_cases()
        case = next(
            item
            for item in case_set.cases
            if item.case_id == "workflow-transport-notice-override-multistep"
        )

        self.assertEqual(case.expectation.direct_vs_delegate_branch, "multi_step")
        self.assertEqual(case.expectation.workflow_mode, "multi_step")
        self.assertEqual(case.expectation.selected_target, "rag-agent")
        self.assertEqual(
            case.expectation.selected_tools,
            (
                "transport_schedule_lookup",
                "campus_notice_change_set_lookup",
                "retrieval.query",
            ),
        )
        self.assertEqual(
            case.expectation.expected_tool_order,
            (
                "transport_schedule_lookup",
                "campus_notice_change_set_lookup",
                "retrieval.query",
            ),
        )
        self.assertEqual(
            case.expectation.expected_context_projection_kinds,
            (
                "schedule_baseline",
                "notice_change_set",
                "evidence_bundle",
                "grounding_verdict",
            ),
        )
        self.assertEqual(
            case.expectation.expected_answer_artifact_kinds,
            (
                "schedule_baseline",
                "notice_change_set",
                "evidence_bundle",
            ),
        )

    def test_fails_trace_projection_completeness_when_steps_lack_timeline_fields(
        self,
    ) -> None:
        results = evaluate_workflow_trace_case(
            _workflow_case(),
            _trace_summary(trace_steps=({"step_id": "runtime_policy", "outcome": "delegate"},)),
        )

        self.assertFalse(results.trace_projection_completeness.passed)
        self.assertIn("trace_steps.timeline_fields", results.trace_projection_completeness.reason)


if __name__ == "__main__":
    unittest.main()
