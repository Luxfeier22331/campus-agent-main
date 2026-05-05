from __future__ import annotations

from campus_evals import DimensionResult
from campus_evals.workflow_trace_gate import (
    WORKFLOW_TRACE_GATE_CASES_PATH,
    WorkflowTraceCase,
    WorkflowTraceCaseSet,
    WorkflowTraceExpectation,
    attach_workflow_trace_gate,
    evaluate_workflow_trace_case,
    load_process_smoke_workflow_trace_summaries,
    load_workflow_trace_cases,
    validate_workflow_trace_case_set,
)

from tests.evals.formal_benchmark_test_support import (
    HANDBOOK_SCOPE,
    ExecutionResult,
    ObservedTrace,
    Path,
    TemporaryDirectory,
    _completed_case,
    _response,
    _source,
    json,
    run_formal_benchmark,
    unittest,
)


def _trace_summary(**overrides):
    from campus_evals import WorkflowTraceSummary

    defaults = {
        "routing_frame": {"intent": "campus_service_lookup"},
        "context_resolution": {"resolved_scope": "campus_services"},
        "planning_outcome": "direct_structured_tool",
        "workflow_mode": "direct_runtime",
        "direct_vs_delegate_branch": "direct",
        "handoff": {"target": "campus-services-agent", "mode": "structured_runtime"},
        "handoff_chain": (),
        "agent_invocations": (
            {
                "invocation_id": "agent-invocation:campus-services-agent:1",
                "workflow_run_ref": "direct_runtime:campus-services-agent:transport_schedule_lookup",
                "agent_id": "campus-services-agent",
                "status": "completed",
            },
        ),
        "selected_target": "campus-services-agent",
        "selected_tools": ("transport_schedule_lookup",),
        "tool_argument_summary": {
            "service_key": "transport_commute",
            "campus": "fengtai",
            "direction": "haidian_to_fengtai",
        },
        "guardrail_outcomes": {"visibility": "public", "auth": "not_required"},
        "fail_close_reason": "",
        "trace_steps": (
            {
                "step_id": "runtime_policy",
                "span_kind": "runtime_policy",
                "parent_step_id": "",
                "outcome": "direct",
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
            {
                "step_id": "finalization",
                "span_kind": "finalization",
                "parent_step_id": "tool_call",
                "outcome": "completed",
                "result_status": "completed",
            },
        ),
        "tool_call_summaries": (
            {
                "schema_version": "tool-call-summary-v1",
                "tool_call_id": "direct_runtime:campus-services-agent:transport_schedule_lookup:tool_call",
                "workflow_run_ref": "direct_runtime:campus-services-agent:transport_schedule_lookup",
                "step_id": "tool_call",
                "lifecycle_state": "completed",
                "result_projection": "bounded_summary",
                "raw_result_included": False,
                "tool_name": "transport_schedule_lookup",
                "result_status": "completed",
                "business_outcome": "resolved_current",
                "argument_summary": {
                    "service_key": "transport_commute",
                    "campus": "fengtai",
                },
                "source_ids": ["transport_schedule:commute"],
            },
        ),
        "runtime_versions": {"supervisor-api": "test"},
        "policy_artifact_versions": {"intent-policy": "v1"},
    }
    defaults.update(overrides)
    return WorkflowTraceSummary(**defaults)


def _workflow_case(**expectation_overrides) -> WorkflowTraceCase:
    expectation_defaults = {
        "direct_vs_delegate_branch": "direct",
        "workflow_mode": "direct_runtime",
        "selected_target": "campus-services-agent",
        "selected_tools": ("transport_schedule_lookup",),
        "handoff": {"target": "campus-services-agent"},
        "handoff_chain": (),
        "tool_argument_summary": {
            "service_key": "transport_commute",
            "campus": "fengtai",
        },
        "tool_call_summaries": (
            {
                "tool_name": "transport_schedule_lookup",
                "result_status": "completed",
                "argument_summary": {
                    "service_key": "transport_commute",
                    "campus": "fengtai",
                },
                "source_ids": ["transport_schedule:commute"],
            },
        ),
        "expected_tool_order": ("transport_schedule_lookup",),
        "expected_tool_result_statuses": {"transport_schedule_lookup": "completed"},
        "expected_source_ids": ("transport_schedule:commute",),
        "guardrail_outcomes": {"visibility": "public"},
        "fail_close_expected": False,
    }
    expectation_defaults.update(expectation_overrides)
    return WorkflowTraceCase(
        case_id="workflow-transport-schedule",
        family="workflow_trace",
        description="transport schedule direct structured branch",
        expectation=WorkflowTraceExpectation(**expectation_defaults),
    )


class WorkflowTraceGateFixtureTest(unittest.TestCase):
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
                "workflow-notice-discover-sdk",
                "workflow-academic-calendar-sdk",
                "workflow-knowledge-delegate",
                "workflow-notice-knowledge-followthrough-multistep",
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
        self.assertIn(
            "context_projections.multi_step", results.trace_projection_completeness.reason
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


class WorkflowTraceGateEvaluatorTest(unittest.TestCase):
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
            workflow_mode="single_handoff",
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
            workflow_mode="single_handoff",
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

    def test_multi_step_trace_requires_more_than_single_handoff_projection(self) -> None:
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
        single_handoff_projection = _trace_summary(
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

        results = evaluate_workflow_trace_case(multi_step_case, single_handoff_projection)

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
                                "workflow_mode": "single_handoff",
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
                                        "workflow_run_ref": "single_handoff:campus-services-agent:transport_schedule_lookup",
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

    def test_fails_trace_projection_completeness_when_steps_lack_timeline_fields(
        self,
    ) -> None:
        results = evaluate_workflow_trace_case(
            _workflow_case(),
            _trace_summary(trace_steps=({"step_id": "runtime_policy", "outcome": "delegate"},)),
        )

        self.assertFalse(results.trace_projection_completeness.passed)
        self.assertIn("trace_steps.timeline_fields", results.trace_projection_completeness.reason)


class WorkflowTraceGateFormalBenchmarkTest(unittest.TestCase):
    def test_gate_wrapper_populates_orchestration_case_results_in_benchmark_artifact(self) -> None:
        cases = (_completed_case(),)
        workflow_case = WorkflowTraceCase(
            case_id="benchmark-completed",
            family="workflow_trace",
            description="student handbook delegate branch",
            expectation=WorkflowTraceExpectation(
                direct_vs_delegate_branch="delegate",
                selected_target="rag-agent",
                selected_tools=("retrieval.query",),
                handoff={"target": "rag-agent"},
                tool_argument_summary={"collection": "student_rules"},
                guardrail_outcomes={"scope_gate": "pass"},
                fail_close_expected=False,
            ),
        )

        def executor(case):
            return ExecutionResult(
                response=_response(
                    status=case.expected_status,
                    answer_text="图书馆开放时间为 08:00 到 22:00。",
                    sources=(_source("handbook:library"),),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=HANDBOOK_SCOPE,
                    retrieval_called=True,
                ),
                workflow_trace_summary=_trace_summary(
                    routing_frame={"intent": "knowledge_query"},
                    context_resolution={"resolved_scope": "regulations/student_rules"},
                    planning_outcome="delegate",
                    direct_vs_delegate_branch="delegate",
                    handoff={"target": "rag-agent"},
                    selected_target="rag-agent",
                    selected_tools=("retrieval.query",),
                    tool_argument_summary={"collection": "student_rules"},
                    guardrail_outcomes={"scope_gate": "pass"},
                ),
            )

        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "benchmark"

            run_formal_benchmark(
                cases=cases,
                executor=attach_workflow_trace_gate(
                    executor,
                    workflow_trace_cases=(workflow_case,),
                ),
                supplemental_adapters=(),
                output_dir=output_dir,
                reruns=1,
            )

            payload = json.loads(
                (output_dir / "run-01-case-results.json").read_text(encoding="utf-8")
            )

        result = payload["results"][0]
        self.assertEqual(result["workflow_trace_summary"]["selected_target"], "rag-agent")
        self.assertTrue(
            result["orchestration_case_results"]["direct_vs_delegate_branch_correctness"]["passed"]
        )
        self.assertTrue(result["orchestration_case_results"]["tool_argument_precision"]["passed"])
        self.assertNotIn("raw_prompt", json.dumps(result, ensure_ascii=False))

    def test_gate_wrapper_marks_benchmark_case_failed_when_workflow_trace_gate_fails(
        self,
    ) -> None:
        cases = (_completed_case(),)
        workflow_case = WorkflowTraceCase(
            case_id="benchmark-completed",
            family="workflow_trace",
            description="student handbook delegate branch",
            expectation=WorkflowTraceExpectation(
                direct_vs_delegate_branch="delegate",
                selected_target="rag-agent",
                selected_tools=("retrieval.query",),
                handoff={"target": "rag-agent"},
                tool_argument_summary={"collection": "student_rules"},
                guardrail_outcomes={"scope_gate": "pass"},
                fail_close_expected=False,
            ),
        )

        def executor(case):
            return ExecutionResult(
                response=_response(
                    status=case.expected_status,
                    answer_text="图书馆开放时间为 08:00 到 22:00。",
                    sources=(_source("handbook:library"),),
                ),
                observed_trace=ObservedTrace(
                    selected_scope=HANDBOOK_SCOPE,
                    retrieval_called=True,
                ),
                workflow_trace_summary=_trace_summary(
                    routing_frame={"intent": "knowledge_query"},
                    context_resolution={"resolved_scope": "regulations/student_rules"},
                    planning_outcome="delegate",
                    direct_vs_delegate_branch="delegate",
                    handoff={"target": "rag-agent"},
                    selected_target="rag-agent",
                    selected_tools=("retrieval.query",),
                    tool_argument_summary={"collection": "curriculum_plan"},
                    guardrail_outcomes={"scope_gate": "pass"},
                ),
            )

        with TemporaryDirectory() as tmpdir:
            output_dir = Path(tmpdir) / "benchmark"

            run_formal_benchmark(
                cases=cases,
                executor=attach_workflow_trace_gate(
                    executor,
                    workflow_trace_cases=(workflow_case,),
                ),
                supplemental_adapters=(),
                output_dir=output_dir,
                reruns=1,
            )

            payload = json.loads(
                (output_dir / "run-01-case-results.json").read_text(encoding="utf-8")
            )

        result = payload["results"][0]
        self.assertFalse(result["passed"])
        self.assertFalse(result["trace_result"]["passed"])
        self.assertFalse(result["orchestration_case_results"]["tool_argument_precision"]["passed"])
        self.assertIn("workflow_trace_gate_failed", result["trace_result"]["reason"])


class WorkflowTraceGatePublicExportTest(unittest.TestCase):
    def test_public_package_exports_workflow_trace_gate_types(self) -> None:
        import campus_evals

        self.assertIs(campus_evals.WorkflowTraceCase, WorkflowTraceCase)
        self.assertIs(campus_evals.WorkflowTraceExpectation, WorkflowTraceExpectation)
        self.assertTrue(callable(campus_evals.evaluate_workflow_trace_case))
        self.assertIsInstance(
            evaluate_workflow_trace_case(_workflow_case(), _trace_summary()).handoff_correctness,
            DimensionResult,
        )


def _contains_selected_notice_get(value: object) -> bool:
    if isinstance(value, dict):
        if value.get("selected_tool") == "campus_notice_get":
            return True
        return any(_contains_selected_notice_get(nested) for nested in value.values())
    if isinstance(value, tuple | list):
        return any(_contains_selected_notice_get(item) for item in value)
    return False
