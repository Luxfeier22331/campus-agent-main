from __future__ import annotations

import unittest

from campus_contracts import ExecutionResponse
from campus_evals.models import ExecutionResult, GoldenCase
from campus_evals.ragas_offline_benchmark import (
    DEFAULT_RAGAS_OFFLINE_METRIC_NAMES,
    build_app_api_ragas_executor,
    build_ragas_eval_cases,
    parse_metric_names,
)


class RagasOfflineBenchmarkSuite(unittest.TestCase):
    def test_selects_existing_surface_cases_by_split(self) -> None:
        cases = build_ragas_eval_cases(surface="student_rules", split="smoke")

        self.assertGreater(len(cases), 0)
        self.assertTrue(all(case.split == "smoke" for case in cases))

    def test_defaults_to_reference_free_ragas_metrics(self) -> None:
        self.assertEqual(
            parse_metric_names(None),
            DEFAULT_RAGAS_OFFLINE_METRIC_NAMES,
        )

    def test_wraps_app_api_eval_execution_as_execution_result(self) -> None:
        case = build_ragas_eval_cases(surface="student_rules", split="smoke")[0]
        response = ExecutionResponse(
            selected_capability="knowledge",
            status="completed",
            answer_text="answer",
        )
        client = _FakeAppApiClient(response=response)

        result = build_app_api_ragas_executor(client)(case)

        self.assertIsInstance(result, ExecutionResult)
        self.assertIs(result.response, response)
        self.assertIs(result.observed_trace, client.execution.observed_trace)
        self.assertIs(result.request_correlation, client.execution.request_correlation)
        self.assertEqual(client.received_cases, (case,))


class _FakeAppApiClient:
    def __init__(self, *, response: ExecutionResponse) -> None:
        self.execution = _FakeAppApiExecution(response=response)
        self.received_cases: tuple[GoldenCase, ...] = ()

    def execute_knowledge_request(self, *, case: GoldenCase) -> _FakeAppApiExecution:
        self.received_cases = (*self.received_cases, case)
        return self.execution


class _FakeAppApiExecution:
    def __init__(self, *, response: ExecutionResponse) -> None:
        self.response = response
        self.observed_trace = None
        self.request_correlation = None


if __name__ == "__main__":
    unittest.main()
