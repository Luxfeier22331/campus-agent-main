# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.evals.workflow_trace_gate_suite_support import *


class WorkflowTraceGateFormalBenchmarkTestPart03(unittest.TestCase):
    def test_gate_wrapper_populates_orchestration_case_results_in_benchmark_artifact(self) -> None:
        cases = (_completed_case(),)
        workflow_case = WorkflowTraceCase(
            case_id="benchmark-completed",
            family="workflow_trace",
            description="student handbook delegate branch",
            expectation=WorkflowTraceExpectation(
                direct_vs_delegate_branch="delegate",
                selected_tool="knowledge_query",
                selected_tools=("knowledge_query",),
                handoff={"target": "knowledge_query"},
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
                    handoff={"target": "knowledge_query"},
                    selected_tool="knowledge_query",
                    selected_tools=("knowledge_query",),
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
        self.assertEqual(result["workflow_trace_summary"]["selected_tool"], "knowledge_query")
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
                selected_tool="knowledge_query",
                selected_tools=("knowledge_query",),
                handoff={"target": "knowledge_query"},
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
                    handoff={"target": "knowledge_query"},
                    selected_tool="knowledge_query",
                    selected_tools=("knowledge_query",),
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


if __name__ == "__main__":
    unittest.main()
