from __future__ import annotations

from campus_contracts import RagResultPayload, SpecialistResponse

from campus_evals.models import CaseResult, DimensionResult, ExecutionResult, GoldenCase


def evaluate_case(case: GoldenCase, execution: ExecutionResult) -> CaseResult:
    response = execution.response
    if not isinstance(response, SpecialistResponse):
        raise TypeError("execution.response must be SpecialistResponse")

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


def _grade_status(case: GoldenCase, response: SpecialistResponse) -> DimensionResult:
    if not case.grader_policy.grade_status:
        return DimensionResult(True, "status grading disabled")
    if response.status != case.expected_status:
        return DimensionResult(False, f"status={response.status}")
    return DimensionResult(True, "ok")


def _grade_retrieval(case: GoldenCase, response: SpecialistResponse) -> DimensionResult:
    if not case.grader_policy.grade_retrieval:
        return DimensionResult(True, "retrieval grading disabled")
    evidence = _extract_rag_evidence(response)
    if evidence is None:
        return DimensionResult(False, "response missing rag evidence payload")
    if evidence.corpus != case.scope.corpus or evidence.collection != case.scope.collection:
        return DimensionResult(
            False,
            f"evidence.scope={evidence.corpus}/{evidence.collection}",
        )

    actual_sources = tuple(evidence.sources)
    for source_ref in case.expected_sources:
        if not any(_matches_source_ref(source_ref, source) for source in actual_sources):
            return DimensionResult(
                False,
                "missing expected source="
                f"{(source_ref.doc_id, source_ref.version_id, source_ref.chunk_id)}",
            )
    for source_ref in case.forbidden_sources:
        if any(_matches_source_ref(source_ref, source) for source in actual_sources):
            return DimensionResult(
                False,
                "forbidden source present="
                f"{(source_ref.doc_id, source_ref.version_id, source_ref.chunk_id)}",
            )
    if response.status == "completed":
        if not evidence.sources:
            return DimensionResult(False, "completed response missing evidence sources")
        for source in evidence.sources:
            if not source.doc_id or not source.version_id or not source.chunk_id:
                return DimensionResult(False, "source locator is incomplete")
    return DimensionResult(True, "ok")


def _grade_answer(case: GoldenCase, response: SpecialistResponse) -> DimensionResult:
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
    if expected.selected_scope is not None and observed.selected_scope != expected.selected_scope:
        selected_scope = (
            None
            if observed.selected_scope is None
            else f"{observed.selected_scope.corpus}/{observed.selected_scope.collection}"
        )
        return DimensionResult(False, f"selected_scope={selected_scope}")
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


def _matches_source_ref(source_ref, source) -> bool:
    if source.doc_id != source_ref.doc_id:
        return False
    if source_ref.version_id is not None and source.version_id != source_ref.version_id:
        return False
    if source_ref.chunk_id is not None and source.chunk_id != source_ref.chunk_id:
        return False
    return True


def _extract_rag_evidence(response: SpecialistResponse):
    if not isinstance(response.result, RagResultPayload):
        return None
    return response.result.evidence
