from __future__ import annotations

from campus_contracts import DelegateToRagAgentResponse

from campus_evals.models import CaseResult, DimensionResult, ExecutionResult, GoldenCase


def evaluate_case(case: GoldenCase, execution: ExecutionResult) -> CaseResult:
    response = execution.response
    if not isinstance(response, DelegateToRagAgentResponse):
        raise TypeError("execution.response must be DelegateToRagAgentResponse")

    status_result = _grade_status(case, response)
    retrieval_result = _grade_retrieval(case, response)
    answer_result = _grade_answer(case, response)
    trace_result = _grade_trace(case, execution)
    passed = all(
        (
            status_result.passed,
            retrieval_result.passed,
            answer_result.passed,
            trace_result.passed,
        )
    )
    return CaseResult(
        case_id=case.case_id,
        passed=passed,
        status_result=status_result,
        retrieval_result=retrieval_result,
        answer_result=answer_result,
        trace_result=trace_result,
    )


def _grade_status(case: GoldenCase, response: DelegateToRagAgentResponse) -> DimensionResult:
    if not case.grader_policy.grade_status:
        return DimensionResult(True, "status grading disabled")
    if response.status != case.expected_status:
        return DimensionResult(False, f"status={response.status}")
    return DimensionResult(True, "ok")


def _grade_retrieval(case: GoldenCase, response: DelegateToRagAgentResponse) -> DimensionResult:
    if not case.grader_policy.grade_retrieval:
        return DimensionResult(True, "retrieval grading disabled")
    if response.evidence.corpus != case.expected_evidence_corpus:
        return DimensionResult(False, f"evidence.corpus={response.evidence.corpus}")

    actual_sources = {
        (source.doc_id, source.version_id, source.chunk_id): source for source in response.evidence.sources
    }
    for source_ref in case.expected_sources:
        source_key = (source_ref.doc_id, source_ref.version_id, source_ref.chunk_id)
        if source_key not in actual_sources:
            return DimensionResult(False, f"missing expected source={source_key}")
    for source_ref in case.forbidden_sources:
        source_key = (source_ref.doc_id, source_ref.version_id, source_ref.chunk_id)
        if source_key in actual_sources:
            return DimensionResult(False, f"forbidden source present={source_key}")
    if response.status == "completed":
        if not response.evidence.sources:
            return DimensionResult(False, "completed response missing evidence sources")
        for source in response.evidence.sources:
            if not source.doc_id or not source.version_id or not source.chunk_id:
                return DimensionResult(False, "source locator is incomplete")
    return DimensionResult(True, "ok")


def _grade_answer(case: GoldenCase, response: DelegateToRagAgentResponse) -> DimensionResult:
    if not case.grader_policy.grade_answer:
        return DimensionResult(True, "answer grading disabled")
    normalized_answer = _normalize_text(response.answer_text)
    if response.status == "completed" and not normalized_answer:
        return DimensionResult(False, "answer_text is empty")
    for fact in case.required_facts:
        if _normalize_text(fact) not in normalized_answer:
            return DimensionResult(False, f"missing required fact={fact}")
    for claim in case.forbidden_claims:
        if _normalize_text(claim) in normalized_answer:
            return DimensionResult(False, f"forbidden claim present={claim}")
    return DimensionResult(True, "ok")


def _grade_trace(case: GoldenCase, execution: ExecutionResult) -> DimensionResult:
    if not case.grader_policy.grade_trace:
        return DimensionResult(True, "trace grading disabled")
    if case.trace_expectation is None:
        return DimensionResult(True, "no trace expectation")
    if execution.observed_trace is None:
        return DimensionResult(False, "missing observed trace")

    observed = execution.observed_trace
    expected = case.trace_expectation
    if expected.selected_corpus is not None and observed.selected_corpus != expected.selected_corpus:
        return DimensionResult(False, f"selected_corpus={observed.selected_corpus}")
    if expected.retrieval_called is not None and observed.retrieval_called != expected.retrieval_called:
        return DimensionResult(False, f"retrieval_called={observed.retrieval_called}")
    if (
        expected.clarification_expected is not None
        and observed.clarification_emitted != expected.clarification_expected
    ):
        return DimensionResult(False, f"clarification_emitted={observed.clarification_emitted}")
    if expected.error_expected is not None and observed.error_path != expected.error_expected:
        return DimensionResult(False, f"error_path={observed.error_path}")
    return DimensionResult(True, "ok")


def _normalize_text(value: str) -> str:
    return " ".join(value.casefold().split())
