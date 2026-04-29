from __future__ import annotations

from campus_evals import DimensionResult
from campus_evals.workflow_trace_gate import (
    WORKFLOW_TRACE_GATE_CASES_PATH,
    WorkflowTraceCase,
    WorkflowTraceExpectation,
    attach_workflow_trace_gate,
    evaluate_workflow_trace_case,
    load_workflow_trace_cases,
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
        "direct_vs_delegate_branch": "direct",
        "handoff": {"target": "campus-services-agent", "mode": "structured_runtime"},
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
            {"step_id": "route", "outcome": "direct"},
            {"step_id": "call_tool", "tool_name": "transport_schedule_lookup"},
        ),
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
        "runtime_versions": {"supervisor-api": "test"},
        "policy_artifact_versions": {"intent-policy": "v1"},
    }
    defaults.update(overrides)
    return WorkflowTraceSummary(**defaults)


def _workflow_case(**expectation_overrides) -> WorkflowTraceCase:
    expectation_defaults = {
        "direct_vs_delegate_branch": "direct",
        "selected_target": "campus-services-agent",
        "selected_tools": ("transport_schedule_lookup",),
        "handoff": {"target": "campus-services-agent"},
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
            "workflow-transport-schedule-direct",
            {case.case_id for case in case_set.cases},
        )

    def test_fixture_covers_multi_agent_product_path_denominator(self) -> None:
        case_set = load_workflow_trace_cases()
        case_ids = {case.case_id for case in case_set.cases}

        self.assertTrue(
            {
                "workflow-direct-structured-service-status",
                "workflow-service-guide-direct",
                "workflow-transport-schedule-direct",
                "workflow-notice-discover-direct",
                "workflow-notice-detail-direct",
                "workflow-knowledge-delegate",
                "workflow-curriculum-delegate",
                "workflow-ambiguous-follow-up-clarification",
                "workflow-transactional-service-fail-close",
                "workflow-service-guide-no-result",
            }.issubset(case_ids)
        )
        branches = {case.expectation.direct_vs_delegate_branch for case in case_set.cases}
        self.assertTrue({"direct", "delegate", "clarification", "fail_close"}.issubset(branches))
        self.assertTrue(any(case.expectation.fail_close_expected for case in case_set.cases))

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
