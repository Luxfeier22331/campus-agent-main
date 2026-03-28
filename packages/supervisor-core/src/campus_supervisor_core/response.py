from __future__ import annotations

from campus_contracts import RagResultPayload, SpecialistResponse, SupervisorResponse


def assemble_response(response: SupervisorResponse) -> SupervisorResponse:
    if response.status not in {
        "completed",
        "needs_clarification",
        "no_answer",
        "error",
        "rejected",
        "approval_required",
    }:
        raise ValueError(f"unsupported supervisor status: {response.status}")

    return SupervisorResponse(
        selected_target=response.selected_target,
        status=response.status,
        answer_text=response.answer_text,
        follow_up_question=response.follow_up_question,
        confidence=response.confidence,
        result=response.result,
        error=response.error,
    )


def source_doc_ids_from_response(response: SpecialistResponse | SupervisorResponse) -> tuple[str, ...]:
    if not isinstance(response.result, RagResultPayload):
        return ()
    return tuple(source.doc_id for source in response.result.evidence.sources)
