# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.evals.workflow_trace_gate_suite_support import *


class WorkflowTraceGateFixtureTestPart01(unittest.TestCase):
    def test_loads_repo_owned_workflow_trace_gate_fixture_family(self) -> None:
        self.assertTrue(WORKFLOW_TRACE_GATE_CASES_PATH.exists())

        case_set = load_workflow_trace_cases()

        self.assertEqual(case_set.schema_version, 1)
        self.assertEqual(case_set.case_family, "workflow_trace_gate.v1")
        self.assertGreaterEqual(len(case_set.cases), 4)
        self.assertIn(
            "workflow-transport-schedule-sdk",
            {case.case_id for case in case_set.cases},
        )

    def test_fixture_covers_multi_agent_product_path_denominator(self) -> None:
        case_set = load_workflow_trace_cases()
        validate_workflow_trace_case_set(case_set)
        case_ids = {case.case_id for case in case_set.cases}

        self.assertTrue(
            {
                "workflow-service-status-sdk",
                "workflow-service-guide-sdk",
                "workflow-contact-directory-sdk",
                "workflow-transport-schedule-sdk",
                "workflow-transport-notice-override-multistep",
                "workflow-notice-discover-sdk",
                "workflow-academic-calendar-sdk",
                "workflow-knowledge-delegate",
                "workflow-notice-knowledge-followthrough-multistep",
                "workflow-selected-notice-knowledge-followthrough-ineligible",
                "workflow-curriculum-delegate",
                "workflow-ambiguous-follow-up-clarification",
                "workflow-product-scope-fail-close",
                "workflow-transactional-approval-required",
                "workflow-service-guide-no-result",
            }.issubset(case_ids)
        )
        branches = {case.expectation.direct_vs_delegate_branch for case in case_set.cases}
        self.assertTrue(
            {"direct", "delegate", "multi_step", "clarification", "fail_close"}.issubset(branches)
        )
        self.assertTrue(any(case.expectation.fail_close_expected for case in case_set.cases))

    def test_fixture_keeps_notice_get_internal_not_selected_tool(self) -> None:
        case_set = load_workflow_trace_cases()

        for case in case_set.cases:
            self.assertNotIn("campus_notice_get", case.expectation.selected_tools)
            self.assertFalse(
                _contains_selected_notice_get(case.expectation.handoff),
                f"{case.case_id} handoff exposes campus_notice_get as selected_tool",
            )
            self.assertFalse(
                _contains_selected_notice_get(case.expectation.handoff_chain),
                f"{case.case_id} handoff_chain exposes campus_notice_get as selected_tool",
            )
            self.assertFalse(
                _contains_selected_notice_get(case.expectation.tool_argument_summary),
                f"{case.case_id} tool_argument_summary exposes campus_notice_get as selected_tool",
            )

    def test_validation_requires_tool_call_summaries_for_selected_tools(self) -> None:
        case_set = WorkflowTraceCaseSet(
            schema_version=1,
            case_family="workflow_trace_gate.v1",
            cases=(
                WorkflowTraceCase(
                    case_id="workflow-missing-tool-call-summary",
                    family="workflow_trace",
                    description="selected tool without projected call summary",
                    expectation=WorkflowTraceExpectation(
                        direct_vs_delegate_branch="direct",
                        selected_target="campus-services-agent",
                        selected_tools=("service_status_lookup",),
                        handoff={"target": "campus-services-agent"},
                        tool_argument_summary={"payload_kind": "service_status_lookup"},
                        fail_close_expected=False,
                    ),
                ),
            ),
        )

        with self.assertRaisesRegex(ValueError, "tool_call_summaries"):
            validate_workflow_trace_case_set(case_set)

    def test_fixture_rejects_raw_trace_payload_keys(self) -> None:
        with self.assertRaisesRegex(ValueError, "forbidden raw workflow trace key"):
            WorkflowTraceExpectation(
                direct_vs_delegate_branch="direct",
                selected_target="campus-services-agent",
                selected_tools=("service_status_lookup",),
                handoff={"target": "campus-services-agent"},
                tool_argument_summary={"raw_transcript": "do not store"},
            )

    def test_workflow_trace_summary_rejects_nested_raw_trace_payload_keys(self) -> None:
        with self.assertRaisesRegex(ValueError, "forbidden raw workflow trace key"):
            _trace_summary(
                tool_argument_summary={
                    "collection": "student_rules",
                    "debug": {"provider_raw_response": {"choices": []}},
                }
            )

    def test_multi_step_trace_requires_context_projection_summary(self) -> None:
        case = _workflow_case(
            direct_vs_delegate_branch="multi_step",
            workflow_mode="multi_step",
            selected_target="rag-agent",
            selected_tools=("retrieval.query",),
            handoff_chain=(
                {"target": "notice-agent", "payload_kind": "campus_notice_get"},
                {"target": "rag-agent", "payload_kind": "rag_request"},
            ),
            expected_tool_order=("retrieval.query",),
        )
        summary = _trace_summary(
            direct_vs_delegate_branch="multi_step",
            workflow_mode="multi_step",
            selected_target="rag-agent",
            selected_tools=("retrieval.query",),
            handoff_chain=(
                {"target": "notice-agent", "payload_kind": "campus_notice_get"},
                {"target": "rag-agent", "payload_kind": "rag_request"},
            ),
        )

        results = evaluate_workflow_trace_case(case, summary)

        self.assertFalse(results.trace_projection_completeness.passed)
        self.assertIn("agent_invocations", results.trace_projection_completeness.reason)

    def test_trace_projection_requires_answer_artifact_usage_summary(self) -> None:
        summary = _trace_summary(
            answer_artifact_projection_ids=(),
            answer_artifact_kinds=(),
        )

        results = evaluate_workflow_trace_case(_workflow_case(), summary)

        self.assertFalse(results.trace_projection_completeness.passed)
        self.assertIn(
            "answer_artifact_kinds.expected", results.trace_projection_completeness.reason
        )

    def test_delegate_trace_projection_requires_agent_invocations(self) -> None:
        summary = _trace_summary(
            workflow_mode="single_handoff",
            direct_vs_delegate_branch="delegate",
            handoff_chain=({"target": "rag-agent", "selected_tool": "retrieval.query"},),
            selected_target="rag-agent",
            selected_tools=("retrieval.query",),
            tool_call_summaries=(
                {
                    "result_projection": "bounded_summary",
                    "raw_result_included": False,
                    "tool_name": "retrieval.query",
                    "result_status": "completed",
                    "source_ids": ["student_rules:leave-policy"],
                },
            ),
            tool_argument_summary={"collection": "student_rules"},
            agent_invocations=(),
        )

        results = evaluate_workflow_trace_case(_workflow_case(), summary)

        self.assertFalse(results.trace_projection_completeness.passed)
        self.assertIn("agent_invocations", results.trace_projection_completeness.reason)

    def test_delegate_trace_projection_requires_invocation_target_alignment(self) -> None:
        summary = _trace_summary(
            workflow_mode="single_handoff",
            direct_vs_delegate_branch="delegate",
            handoff_chain=({"target": "rag-agent", "selected_tool": "retrieval.query"},),
            selected_target="rag-agent",
            selected_tools=("retrieval.query",),
            tool_call_summaries=(
                {
                    "result_projection": "bounded_summary",
                    "raw_result_included": False,
                    "tool_name": "retrieval.query",
                    "result_status": "completed",
                    "source_ids": ["student_rules:leave-policy"],
                },
            ),
            tool_argument_summary={"collection": "student_rules"},
            agent_invocations=(
                {
                    "invocation_id": "agent-invocation:campus-services-agent:1",
                    "workflow_run_ref": "run-test",
                    "step_id": "handoff:campus-services-agent:transport_schedule_lookup",
                    "agent_id": "campus-services-agent",
                    "status": "completed",
                },
            ),
        )

        results = evaluate_workflow_trace_case(_workflow_case(), summary)

        self.assertFalse(results.trace_projection_completeness.passed)
        self.assertIn(
            "agent_invocations.target_alignment", results.trace_projection_completeness.reason
        )

    def test_multistep_trace_projection_requires_invocation_parent_edge(self) -> None:
        summary = _trace_summary(
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
                    "workflow_run_ref": "run-test",
                    "step_id": "handoff:rag-agent:rag_request",
                    "agent_id": "rag-agent",
                    "status": "completed",
                    "projection_ids": ["proj-notice-001"],
                },
            ),
            tool_call_summaries=(
                {
                    "result_projection": "bounded_summary",
                    "raw_result_included": False,
                    "tool_name": "retrieval.query",
                    "result_status": "completed",
                    "source_ids": ["student_rules:leave-policy"],
                },
            ),
            tool_argument_summary={"collection": "student_rules"},
        )

        results = evaluate_workflow_trace_case(_workflow_case(), summary)

        self.assertFalse(results.trace_projection_completeness.passed)
        self.assertIn("agent_invocations.parent_edge", results.trace_projection_completeness.reason)

    def test_multistep_trace_projection_requires_consumed_projection_ref(self) -> None:
        summary = _trace_summary(
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
                    "projection_ids": (),
                },
            ),
            tool_call_summaries=(
                {
                    "tool_name": "retrieval.query",
                    "result_status": "completed",
                    "source_ids": ["student_rules:leave-policy"],
                },
            ),
            tool_argument_summary={"collection": "student_rules"},
        )

        results = evaluate_workflow_trace_case(_workflow_case(), summary)

        self.assertFalse(results.trace_projection_completeness.passed)
        self.assertIn(
            "agent_invocations.projection_refs", results.trace_projection_completeness.reason
        )

    def test_multistep_trace_projection_requires_expected_projection_kind_sequence(self) -> None:
        case = _workflow_case(
            direct_vs_delegate_branch="multi_step",
            workflow_mode="multi_step",
            selected_target="rag-agent",
            selected_tools=("retrieval.query",),
            handoff_chain=(
                {"target": "notice-agent", "payload_kind": "campus_notice_get"},
                {"target": "rag-agent", "payload_kind": "rag_request"},
            ),
            expected_context_projection_kinds=("notice_context", "evidence_bundle"),
        )
        summary = _trace_summary(
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
                    "status": "needs_clarification",
                    "projection_ids": ["proj-notice-001"],
                },
            ),
            tool_call_summaries=(
                {
                    "tool_name": "retrieval.query",
                    "result_status": "needs_clarification",
                    "source_ids": ["student_rules:leave-policy"],
                },
            ),
            tool_argument_summary={"collection": "student_rules"},
        )

        results = evaluate_workflow_trace_case(case, summary)

        self.assertFalse(results.trace_projection_completeness.passed)
        self.assertIn(
            "context_projections.expected_kinds", results.trace_projection_completeness.reason
        )


if __name__ == "__main__":
    unittest.main()
