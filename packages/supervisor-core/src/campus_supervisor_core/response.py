from __future__ import annotations

from campus_contracts import RagResultPayload, SpecialistResponse


def assemble_response(response: SpecialistResponse) -> SpecialistResponse:
    if response.status not in {"completed", "needs_clarification", "no_answer", "error"}:
        raise ValueError(f"unsupported delegate status: {response.status}")

    return SpecialistResponse(
        target=response.target,
        status=response.status,
        answer_text=response.answer_text,
        follow_up_question=response.follow_up_question,
        confidence=response.confidence,
        result=response.result,
        error=response.error,
    )


def source_doc_ids_from_response(response: SpecialistResponse) -> tuple[str, ...]:
    if not isinstance(response.result, RagResultPayload):
        return ()
    return tuple(source.doc_id for source in response.result.evidence.sources)
