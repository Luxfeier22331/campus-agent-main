from __future__ import annotations

from campus_contracts import (
    RagResultDiagnostics,
    RagResultPayload,
    SpecialistResponse,
    SupervisorObservability,
    SupervisorResponse,
)


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
        observability=response.observability,
    )


def source_doc_ids_from_response(response: SpecialistResponse | SupervisorResponse) -> tuple[str, ...]:
    if not isinstance(response.result, RagResultPayload):
        return ()
    return tuple(source.doc_id for source in response.result.evidence.sources)


def build_supervisor_observability_from_specialist_response(
    response: SpecialistResponse,
) -> SupervisorObservability | None:
    if response.target != "rag-specialist":
        return SupervisorObservability(
            retrieval_attempted=False,
            candidate_count=0,
            retrieved_source_count=0,
            citation_expected=False,
            citation_count=0,
            citation_missing=False,
            acl_decision="allowed",
            fail_closed=False,
        )

    result = response.result if isinstance(response.result, RagResultPayload) else None
    diagnostics = result.diagnostics if result is not None else None
    source_count = len(result.evidence.sources) if result is not None else 0
    retrieval_attempted: bool | None
    if response.status == "completed":
        retrieval_attempted = True
    elif response.status == "no_answer":
        retrieval_attempted = True
    elif response.status == "needs_clarification":
        retrieval_attempted = source_count > 0
    else:
        retrieval_attempted = None

    denied = _is_restricted_access_denied(diagnostics)
    citation_expected = response.status == "completed"

    return SupervisorObservability(
        retrieval_attempted=retrieval_attempted,
        candidate_count=source_count,
        retrieved_source_count=source_count,
        citation_expected=citation_expected,
        citation_count=source_count if citation_expected else 0,
        citation_missing=(source_count == 0) if citation_expected else False,
        refusal_class=(
            response.status
            if response.status in {"needs_clarification", "no_answer"}
            else ""
        ),
        acl_decision="denied" if denied else "allowed",
        fail_closed=True if denied else False,
        resolved_scope_corpus=diagnostics.resolved_scope_corpus if diagnostics is not None else None,
        resolved_scope_collection=(
            diagnostics.resolved_scope_collection if diagnostics is not None else ""
        ),
    )


def _is_restricted_access_denied(diagnostics: RagResultDiagnostics | None) -> bool:
    return (
        diagnostics is not None
        and diagnostics.no_answer_reason == "restricted_access_denied"
    )
