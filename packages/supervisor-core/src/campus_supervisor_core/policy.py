from __future__ import annotations

from campus_contracts import (
    SpecialistResponse,
    SupervisorResponse,
)

from campus_supervisor_core.response import (
    build_supervisor_observability_from_specialist_response,
)


def finalize_specialist_response(response: SpecialistResponse) -> SupervisorResponse:
    if response.status == "completed":
        return SupervisorResponse(
            selected_target=response.target,
            status="completed",
            answer_text=response.answer_text,
            follow_up_question=response.follow_up_question,
            confidence=response.confidence,
            result=response.result,
            error=response.error,
            observability=build_supervisor_observability_from_specialist_response(response),
        )
    if response.status == "needs_clarification":
        return SupervisorResponse(
            selected_target=response.target,
            status="needs_clarification",
            answer_text=response.answer_text,
            follow_up_question=response.follow_up_question,
            confidence=response.confidence,
            result=response.result,
            error=response.error,
            observability=build_supervisor_observability_from_specialist_response(response),
        )
    if response.status == "no_answer":
        return SupervisorResponse(
            selected_target=response.target,
            status="no_answer",
            answer_text=response.answer_text,
            follow_up_question=response.follow_up_question,
            confidence=response.confidence,
            result=response.result,
            error=response.error,
            observability=build_supervisor_observability_from_specialist_response(response),
        )
    if response.status == "error":
        return SupervisorResponse(
            selected_target=response.target,
            status="error",
            answer_text=response.answer_text,
            follow_up_question=response.follow_up_question,
            confidence=response.confidence,
            result=response.result,
            error=response.error,
            observability=build_supervisor_observability_from_specialist_response(response),
        )
    raise ValueError(f"unsupported delegate status: {response.status}")
