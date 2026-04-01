from __future__ import annotations

import re

from campus_contracts import RagResultPayload, SpecialistResponse, SupervisorResponse

from campus_evals.models import CaseResult, DimensionResult, ExecutionResult, GoldenCase

KNOWN_DETERMINISTIC_METRICS = (
    "status_accuracy",
    "expected_doc_hit",
    "forbidden_doc_miss",
    "citation_completeness",
    "source_locator_completeness",
    "answer_accuracy",
    "answer_completeness",
    "procedure_directness",
    "forbidden_claim_free",
    "clarification_accuracy",
    "no_answer_accuracy",
    "approval_required_accuracy",
    "rejection_accuracy",
    "error_path_correctness",
    "fail_closed",
    "trace_path_correctness",
)
_PROCEDURE_GOAL_HINTS = ("怎么办", "如何", "怎么", "办理", "申请", "流程", "补办", "手续")
_PROCEDURE_ACTION_HINTS = ("挂失", "申请", "补办", "办理", "提交", "填写", "备案", "审批", "审核")
_PROCEDURE_LEAD_ACTION_HINTS = ("挂失", "申请", "办理", "提交", "填写", "备案", "审批", "审核")
_PROCEDURE_SIDE_NOTE_HINTS = ("优惠卡", "检测", "充值", "销毁", "转借", "处分", "负责解释", "不良后果")
_NON_PROCEDURE_STRUCTURED_GOAL_HINTS = ("课程地图",)


def evaluate_case(case: GoldenCase, execution: ExecutionResult) -> CaseResult:
    response = _require_supported_response(execution)

    status_result = _grade_status(case, response)
    retrieval_result = _grade_retrieval(case, response)
    answer_result = _grade_answer(case, response)
    trace_result = _grade_trace(case, execution)
    metric_results = _build_metric_results(
        case,
        execution,
        status_result=status_result,
        retrieval_result=retrieval_result,
        answer_result=answer_result,
        trace_result=trace_result,
    )
    passed = all(
        (
            status_result.passed,
            retrieval_result.passed,
            answer_result.passed,
            trace_result.passed,
        )
    ) and all(metric.passed for metric in metric_results.values())
    return CaseResult(
        case_id=case.case_id,
        passed=passed,
        status_result=status_result,
        retrieval_result=retrieval_result,
        answer_result=answer_result,
        trace_result=trace_result,
        metric_results=metric_results,
    )


def _grade_status(case: GoldenCase, response: SpecialistResponse | SupervisorResponse) -> DimensionResult:
    if not case.grader_policy.grade_status:
        return DimensionResult(True, "status grading disabled")
    if response.status != case.expected_status:
        return DimensionResult(False, f"status={response.status}")
    return DimensionResult(True, "ok")


def _grade_retrieval(case: GoldenCase, response: SpecialistResponse | SupervisorResponse) -> DimensionResult:
    if not case.grader_policy.grade_retrieval:
        return DimensionResult(True, "retrieval grading disabled")
    evidence = _extract_rag_evidence(response)
    if evidence is None:
        if not _response_targets_rag(response):
            return DimensionResult(True, "retrieval not applicable")
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


def _grade_answer(case: GoldenCase, response: SpecialistResponse | SupervisorResponse) -> DimensionResult:
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


def _build_metric_results(
    case: GoldenCase,
    execution: ExecutionResult,
    *,
    status_result: DimensionResult,
    retrieval_result: DimensionResult,
    answer_result: DimensionResult,
    trace_result: DimensionResult,
) -> dict[str, DimensionResult]:
    response = _require_supported_response(execution)

    metrics: dict[str, DimensionResult] = {}
    evidence = _extract_rag_evidence(response)
    actual_sources = tuple(evidence.sources) if evidence is not None else ()

    if case.grader_policy.grade_status:
        metrics["status_accuracy"] = status_result
        if case.expected_status == "needs_clarification":
            metrics["clarification_accuracy"] = _grade_clarification_accuracy(response)
        if case.expected_status == "no_answer":
            metrics["no_answer_accuracy"] = _grade_no_answer_accuracy(response)
        if case.expected_status == "approval_required":
            metrics["approval_required_accuracy"] = _grade_approval_required_accuracy(response)
        if case.expected_status == "rejected":
            metrics["rejection_accuracy"] = _grade_rejection_accuracy(response)
        if case.expected_status == "error":
            metrics["error_path_correctness"] = _grade_error_path_correctness(response)

    if case.grader_policy.grade_retrieval:
        if case.expected_sources:
            metrics["expected_doc_hit"] = _grade_expected_doc_hit(case, actual_sources)
        if case.forbidden_sources:
            metrics["forbidden_doc_miss"] = _grade_forbidden_doc_miss(case, actual_sources)
        if case.expected_status == "completed":
            metrics["citation_completeness"] = _grade_citation_completeness(case, response)
            metrics["source_locator_completeness"] = _grade_source_locator_completeness(response)
        if _case_requires_fail_closed(case):
            metrics["fail_closed"] = _grade_fail_closed(response)

    if case.grader_policy.grade_answer:
        if case.expected_status == "completed" or case.required_facts or case.forbidden_claims:
            metrics["answer_accuracy"] = answer_result
        if case.required_facts:
            metrics["answer_completeness"] = _grade_answer_completeness(case, response)
        if case.expected_status == "completed" and _is_procedure_goal(case.user_goal):
            metrics["procedure_directness"] = _grade_procedure_directness(response)
        if case.forbidden_claims:
            metrics["forbidden_claim_free"] = _grade_forbidden_claim_free(case, response)

    if case.grader_policy.grade_trace:
        metrics["trace_path_correctness"] = trace_result

    return metrics


def _grade_expected_doc_hit(
    case: GoldenCase,
    actual_sources,
) -> DimensionResult:
    for source_ref in case.expected_sources:
        if not any(_matches_source_ref(source_ref, source) for source in actual_sources):
            return DimensionResult(
                False,
                "missing expected source="
                f"{(source_ref.doc_id, source_ref.version_id, source_ref.chunk_id)}",
            )
    return DimensionResult(True, "ok")


def _grade_forbidden_doc_miss(
    case: GoldenCase,
    actual_sources,
) -> DimensionResult:
    for source_ref in case.forbidden_sources:
        if any(_matches_source_ref(source_ref, source) for source in actual_sources):
            return DimensionResult(
                False,
                "forbidden source present="
                f"{(source_ref.doc_id, source_ref.version_id, source_ref.chunk_id)}",
            )
    return DimensionResult(True, "ok")


def _grade_citation_completeness(
    case: GoldenCase,
    response: SpecialistResponse | SupervisorResponse,
) -> DimensionResult:
    evidence = _extract_rag_evidence(response)
    if evidence is None:
        return DimensionResult(False, "response missing rag evidence payload")
    if not evidence.sources:
        return DimensionResult(False, "completed response missing evidence sources")
    if case.expected_sources:
        expected_hit = _grade_expected_doc_hit(case, tuple(evidence.sources))
        if not expected_hit.passed:
            return expected_hit
    return DimensionResult(True, "ok")


def _grade_source_locator_completeness(response: SpecialistResponse | SupervisorResponse) -> DimensionResult:
    evidence = _extract_rag_evidence(response)
    if evidence is None:
        return DimensionResult(False, "response missing rag evidence payload")
    if not evidence.sources:
        return DimensionResult(False, "completed response missing evidence sources")
    for source in evidence.sources:
        if not source.doc_id or not source.version_id or not source.chunk_id:
            return DimensionResult(False, "source locator is incomplete")
    return DimensionResult(True, "ok")


def _grade_answer_completeness(
    case: GoldenCase,
    response: SpecialistResponse | SupervisorResponse,
) -> DimensionResult:
    normalized_answer = _normalize_text(response.answer_text)
    for fact in case.required_facts:
        if _normalize_text(fact) not in normalized_answer:
            return DimensionResult(False, f"missing required fact={fact}")
    return DimensionResult(True, "ok")


def _grade_forbidden_claim_free(
    case: GoldenCase,
    response: SpecialistResponse | SupervisorResponse,
) -> DimensionResult:
    normalized_answer = _normalize_text(response.answer_text)
    for claim in case.forbidden_claims:
        if _normalize_text(claim) in normalized_answer:
            return DimensionResult(False, f"forbidden claim present={claim}")
    return DimensionResult(True, "ok")


def _grade_procedure_directness(response: SpecialistResponse | SupervisorResponse) -> DimensionResult:
    normalized_answer = _normalize_text(response.answer_text)
    if not normalized_answer:
        return DimensionResult(False, "answer_text is empty")
    first_segment = re.split(r"[；。]", normalized_answer, maxsplit=1)[0]
    if not any(_normalize_text(token) in first_segment for token in _PROCEDURE_LEAD_ACTION_HINTS):
        return DimensionResult(False, "first segment does not lead with an action")
    if any(_normalize_text(token) in first_segment for token in _PROCEDURE_SIDE_NOTE_HINTS):
        return DimensionResult(False, "first segment is dominated by a side note")
    action_positions = [
        normalized_answer.find(_normalize_text(token))
        for token in _PROCEDURE_ACTION_HINTS
        if _normalize_text(token) in normalized_answer
    ]
    side_note_positions = [
        normalized_answer.find(_normalize_text(token))
        for token in _PROCEDURE_SIDE_NOTE_HINTS
        if _normalize_text(token) in normalized_answer
    ]
    if side_note_positions and action_positions and min(side_note_positions) < min(action_positions):
        return DimensionResult(False, "side note appears before procedural action")
    return DimensionResult(True, "ok")


def _grade_clarification_accuracy(response: SpecialistResponse | SupervisorResponse) -> DimensionResult:
    if response.status != "needs_clarification":
        return DimensionResult(False, f"status={response.status}")
    if not response.follow_up_question.strip():
        return DimensionResult(False, "follow_up_question is empty")
    return DimensionResult(True, "ok")


def _grade_no_answer_accuracy(response: SpecialistResponse | SupervisorResponse) -> DimensionResult:
    if response.status != "no_answer":
        return DimensionResult(False, f"status={response.status}")
    if not response.answer_text.strip() and not response.follow_up_question.strip():
        return DimensionResult(False, "no_answer response should include explicit boundary guidance")
    return DimensionResult(True, "ok")


def _grade_approval_required_accuracy(
    response: SpecialistResponse | SupervisorResponse,
) -> DimensionResult:
    if response.status != "approval_required":
        return DimensionResult(False, f"status={response.status}")
    if _response_targets_rag(response):
        return DimensionResult(False, "approval_required response should not select specialist target")
    if not response.answer_text.strip() and not response.follow_up_question.strip():
        return DimensionResult(False, "approval_required response should include operator guidance")
    return DimensionResult(True, "ok")


def _grade_rejection_accuracy(response: SpecialistResponse | SupervisorResponse) -> DimensionResult:
    if response.status != "rejected":
        return DimensionResult(False, f"status={response.status}")
    if _response_targets_rag(response):
        return DimensionResult(False, "rejected response should not select specialist target")
    if response.error is None:
        return DimensionResult(False, "rejected response missing error payload")
    if not response.error.code.strip():
        return DimensionResult(False, "rejected response missing error code")
    return DimensionResult(True, "ok")


def _grade_error_path_correctness(response: SpecialistResponse | SupervisorResponse) -> DimensionResult:
    if response.status != "error":
        return DimensionResult(False, f"status={response.status}")
    if response.error is None:
        return DimensionResult(False, "error response missing error payload")
    if not response.error.code.strip():
        return DimensionResult(False, "error response missing error code")
    return DimensionResult(True, "ok")


def _case_requires_fail_closed(case: GoldenCase) -> bool:
    if case.trace_expectation is not None and case.trace_expectation.fail_closed_expected is True:
        return True
    return case.expected_status == "no_answer" and not case.expected_sources


def _grade_fail_closed(response: SpecialistResponse | SupervisorResponse) -> DimensionResult:
    evidence = _extract_rag_evidence(response)
    if evidence is None:
        if not _response_targets_rag(response):
            return DimensionResult(True, "retrieval not applicable")
        return DimensionResult(False, "response missing rag evidence payload")
    if evidence.sources:
        return DimensionResult(False, "fail-close response should not contain evidence sources")
    return DimensionResult(True, "ok")


def _normalize_text(value: str) -> str:
    return " ".join(value.casefold().split())


def _is_procedure_goal(user_goal: str) -> bool:
    normalized_goal = _normalize_text(user_goal)
    if any(_normalize_text(token) in normalized_goal for token in _NON_PROCEDURE_STRUCTURED_GOAL_HINTS):
        return False
    return any(_normalize_text(token) in normalized_goal for token in _PROCEDURE_GOAL_HINTS)


def _matches_source_ref(source_ref, source) -> bool:
    if source.doc_id != source_ref.doc_id:
        return False
    if source_ref.version_id is not None and source.version_id != source_ref.version_id:
        return False
    if source_ref.chunk_id is not None and source.chunk_id != source_ref.chunk_id:
        return False
    return True


def _require_supported_response(
    execution: ExecutionResult,
) -> SpecialistResponse | SupervisorResponse:
    response = execution.response
    if not isinstance(response, (SpecialistResponse, SupervisorResponse)):
        raise TypeError("execution.response must be SpecialistResponse or SupervisorResponse")
    return response


def _response_targets_rag(response: SpecialistResponse | SupervisorResponse) -> bool:
    if isinstance(response, SpecialistResponse):
        return response.target == "rag-specialist"
    return response.selected_target == "rag-specialist"


def _extract_rag_evidence(response: SpecialistResponse | SupervisorResponse):
    if not isinstance(response.result, RagResultPayload):
        return None
    return response.result.evidence
