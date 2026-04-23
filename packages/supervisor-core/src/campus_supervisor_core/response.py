from __future__ import annotations

from campus_contracts import (
    CampusNoticeDiscoverResult,
    CampusNoticeGetResult,
    RagResultDiagnostics,
    RagResultPayload,
    ServiceStatusLookupResult,
    SpecialistResponse,
    SupervisorObservability,
    SupervisorResponse,
    TransportScheduleLookupResult,
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


def source_doc_ids_from_response(
    response: SpecialistResponse | SupervisorResponse,
) -> tuple[str, ...]:
    if not isinstance(response.result, RagResultPayload):
        return ()
    return tuple(source.doc_id for source in response.result.evidence.sources)


def build_supervisor_observability_from_specialist_response(
    response: SpecialistResponse,
) -> SupervisorObservability | None:
    if response.target != "rag-agent":
        return _build_structured_runtime_observability(response)

    result = response.result if isinstance(response.result, RagResultPayload) else None
    diagnostics = result.diagnostics if result is not None else None
    supporting_sources = tuple(result.evidence.sources) if result is not None else ()
    if diagnostics is not None and diagnostics.retrieved_sources:
        retrieved_sources = tuple(diagnostics.retrieved_sources)
    else:
        retrieved_sources = ()
    source_count = len(retrieved_sources)
    retrieval_attempted: bool | None
    if response.status == "completed":
        retrieval_attempted = True
    elif response.status == "no_answer":
        if (
            diagnostics is not None
            and diagnostics.no_answer_reason == "curriculum_course_map_unsupported"
        ):
            retrieval_attempted = False
        else:
            retrieval_attempted = True
    elif response.status == "needs_clarification":
        retrieval_attempted = source_count > 0
    else:
        retrieval_attempted = None

    denied = _is_restricted_access_denied(diagnostics)
    citation_expected = response.status == "completed"
    citation_count = len(supporting_sources) if citation_expected else 0

    return SupervisorObservability(
        retrieval_attempted=retrieval_attempted,
        candidate_count=source_count,
        retrieved_source_count=source_count,
        retrieved_sources=retrieved_sources,
        citation_expected=citation_expected,
        citation_count=citation_count,
        citation_missing=(citation_count == 0) if citation_expected else False,
        refusal_class=(
            response.status if response.status in {"needs_clarification", "no_answer"} else ""
        ),
        semantic_outcome=_semantic_outcome_from_specialist_response(
            response.status,
            diagnostics=diagnostics,
        ),
        scope_class=_scope_class_from_specialist_response(response.target),
        acl_decision="denied" if denied else "allowed",
        fail_closed=bool(denied or _is_freshness_fail_closed(diagnostics)),
        prompt_runtime_state=diagnostics.prompt_runtime_state if diagnostics is not None else "",
        prompt_runtime_detail=diagnostics.prompt_runtime_detail if diagnostics is not None else "",
        resolved_scope_corpus=diagnostics.resolved_scope_corpus
        if diagnostics is not None
        else None,
        resolved_scope_collection=(
            diagnostics.resolved_scope_collection if diagnostics is not None else ""
        ),
        prompt_trace=diagnostics.prompt_trace if diagnostics is not None else None,
    )


def _is_restricted_access_denied(diagnostics: RagResultDiagnostics | None) -> bool:
    return diagnostics is not None and diagnostics.no_answer_reason == "restricted_access_denied"


def _is_freshness_fail_closed(diagnostics: RagResultDiagnostics | None) -> bool:
    return diagnostics is not None and diagnostics.freshness_fail_closed


def _semantic_outcome_from_specialist_response(
    status: str,
    *,
    diagnostics: RagResultDiagnostics | None,
) -> str:
    if diagnostics is not None and diagnostics.semantic_outcome:
        return diagnostics.semantic_outcome
    if status == "completed":
        return "grounded_answer"
    if status == "needs_clarification":
        return "needs_clarification"
    if status != "no_answer":
        return ""
    if _is_restricted_access_denied(diagnostics):
        return "restricted_access_denied"
    return "unsupported_by_evidence"


def _scope_class_from_specialist_response(target: str) -> str:
    if target in {
        "rag-agent",
        "navigation-agent",
        "campus-services-agent",
        "notice-agent",
    }:
        return "in_scope"
    return ""


def _build_structured_runtime_observability(
    response: SpecialistResponse,
) -> SupervisorObservability:
    result = response.result
    tool_business_outcome = getattr(result, "outcome", "") if result is not None else ""
    tool_fail_close_reason = getattr(result, "fail_close_reason", "") if result is not None else ""
    tool_historical_downgrade_reason = (
        getattr(result, "historical_downgrade_reason", "") if result is not None else ""
    )
    candidate_count = _candidate_count_from_tool_result(result)
    return SupervisorObservability(
        retrieval_attempted=False,
        candidate_count=candidate_count,
        retrieved_source_count=0,
        retrieved_sources=(),
        citation_expected=False,
        citation_count=0,
        citation_missing=False,
        refusal_class=(
            response.status if response.status in {"needs_clarification", "no_answer"} else ""
        ),
        semantic_outcome=_structured_runtime_semantic_outcome(response),
        scope_class=_scope_class_from_specialist_response(response.target),
        acl_decision="allowed",
        fail_closed=bool(tool_fail_close_reason),
        selected_tool=_selected_tool_from_result(result),
        tool_business_outcome=tool_business_outcome,
        tool_fail_close_reason=tool_fail_close_reason,
        tool_historical_downgrade_reason=tool_historical_downgrade_reason,
        notice_source_family_summary=_notice_source_family_summary(result),
        temporal_posture=_temporal_posture_from_tool_result(result),
    )


def _candidate_count_from_tool_result(
    result: object,
) -> int:
    if isinstance(result, CampusNoticeDiscoverResult):
        return len(result.notice_cards)
    if isinstance(result, TransportScheduleLookupResult):
        return len(result.candidate_routes)
    return 0


def _structured_runtime_semantic_outcome(response: SpecialistResponse) -> str:
    if response.result is not None and hasattr(response.result, "outcome"):
        return getattr(response.result, "outcome")
    if response.status == "needs_clarification":
        return "needs_clarification"
    if response.status == "no_answer":
        return "temporarily_unverifiable"
    return ""


def _selected_tool_from_result(result: object) -> str:
    if isinstance(result, ServiceStatusLookupResult):
        return "service_status_lookup"
    if isinstance(result, TransportScheduleLookupResult):
        return "transport_schedule_lookup"
    if isinstance(result, CampusNoticeDiscoverResult):
        return "campus_notice_discover"
    if isinstance(result, CampusNoticeGetResult):
        return "campus_notice_get"
    return ""


def _notice_source_family_summary(result: object) -> str:
    if isinstance(result, CampusNoticeGetResult):
        return result.source_family
    if isinstance(result, CampusNoticeDiscoverResult):
        source_families = tuple(
            dict.fromkeys(
                family
                for family in (
                    tuple(result.source_families)
                    or tuple(card.source_family for card in result.notice_cards)
                )
                if family
            )
        )
        return ",".join(source_families)
    return ""


def _temporal_posture_from_tool_result(result: object) -> str:
    if result is None:
        return ""
    if hasattr(result, "outcome") and getattr(result, "outcome") == "resolved_historical_reference":
        return "historical_reference"
    return "current"
