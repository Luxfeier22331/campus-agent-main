from __future__ import annotations

from campus_contracts import (
    ClaimSupport,
    CurriculumFollowUpSlots,
    EvidenceBundle,
    KnowledgeScope,
    RagResultDiagnostics,
    RagResultPayload,
    RemoteContentSuspicionSummary,
    RetrievalPlanSummary,
    RetrievalStepActivitySummary,
    SourceTrustSummary,
)
from campus_retrieval_core import RetrievalExecutionResult

from campus_rag_agent.grounding_validation import build_source_trust_summary
from campus_rag_agent.query_planning import (
    CurriculumCourseQueryPlan,
    CurriculumProgramFamilyQueryPlan,
    CurriculumQueryPlan,
    HandbookQueryPlan,
)
from campus_rag_agent.remote_content_hardening import (
    build_remote_content_suspicion_summary,
)
from campus_rag_agent.retrieval_adequacy import (
    RetrievalAdequacyAssessment,
    ambiguous_retrieval_adequacy,
    insufficient_retrieval_adequacy,
)

from .service_common import _normalize_text, _source_label

_CURRICULUM_SESSION_PROGRAM_FAMILIES = (
    "民族实验班",
    "强基计划",
    "第二学士学位",
)
_CURRICULUM_PROGRAM_TITLE_SUFFIXES = (
    "本科第二学士学位人才培养方案",
    "第二学士学位人才培养方案",
    "本科专业人才培养方案",
    "本科专业培养方案",
    "本科人才培养方案",
    "人才培养方案",
)


def _build_rag_result_payload(
    *,
    evidence: EvidenceBundle,
    resolved_scope: KnowledgeScope | None,
    handbook_plan: HandbookQueryPlan | None,
    curriculum_plan: CurriculumQueryPlan | None = None,
    curriculum_course_plan: CurriculumCourseQueryPlan | None = None,
    curriculum_program_family_plan: CurriculumProgramFamilyQueryPlan | None = None,
    no_answer_reason: str = "",
    allow_session_follow_up: bool = False,
    semantic_outcome: str = "",
    retrieval_adequacy: RetrievalAdequacyAssessment | None = None,
    claim_supports: tuple[ClaimSupport, ...] = (),
    unsupported_fields: tuple[str, ...] = (),
    grounding_verdict: str = "",
    grounding_downgraded: bool = False,
    freshness_fail_closed: bool = False,
    remote_content_suspicion_summary: RemoteContentSuspicionSummary | None = None,
    source_trust_summary: SourceTrustSummary | None = None,
    prompt_runtime_state: str = "",
    prompt_runtime_detail: str = "",
    retrieved_evidence: EvidenceBundle | None = None,
    retrieval_execution_result: RetrievalExecutionResult | None = None,
) -> RagResultPayload:
    diagnostics = _build_rag_result_diagnostics(
        evidence=evidence,
        resolved_scope=resolved_scope,
        handbook_plan=handbook_plan,
        curriculum_plan=curriculum_plan,
        curriculum_course_plan=curriculum_course_plan,
        curriculum_program_family_plan=curriculum_program_family_plan,
        no_answer_reason=no_answer_reason,
        allow_session_follow_up=allow_session_follow_up,
        semantic_outcome=semantic_outcome,
        retrieval_adequacy=retrieval_adequacy,
        claim_supports=claim_supports,
        unsupported_fields=unsupported_fields,
        grounding_verdict=grounding_verdict,
        grounding_downgraded=grounding_downgraded,
        freshness_fail_closed=freshness_fail_closed,
        remote_content_suspicion_summary=remote_content_suspicion_summary,
        source_trust_summary=source_trust_summary,
        prompt_runtime_state=prompt_runtime_state,
        prompt_runtime_detail=prompt_runtime_detail,
        retrieved_evidence=retrieved_evidence,
        retrieval_execution_result=retrieval_execution_result,
    )
    return RagResultPayload(
        evidence=evidence,
        diagnostics=diagnostics,
    )


def _build_rag_result_diagnostics(
    *,
    evidence: EvidenceBundle,
    resolved_scope: KnowledgeScope | None,
    handbook_plan: HandbookQueryPlan | None,
    curriculum_plan: CurriculumQueryPlan | None = None,
    curriculum_course_plan: CurriculumCourseQueryPlan | None = None,
    curriculum_program_family_plan: CurriculumProgramFamilyQueryPlan | None = None,
    no_answer_reason: str = "",
    allow_session_follow_up: bool = False,
    semantic_outcome: str = "",
    retrieval_adequacy: RetrievalAdequacyAssessment | None = None,
    claim_supports: tuple[ClaimSupport, ...] = (),
    unsupported_fields: tuple[str, ...] = (),
    grounding_verdict: str = "",
    grounding_downgraded: bool = False,
    freshness_fail_closed: bool = False,
    remote_content_suspicion_summary: RemoteContentSuspicionSummary | None = None,
    source_trust_summary: SourceTrustSummary | None = None,
    prompt_runtime_state: str = "",
    prompt_runtime_detail: str = "",
    retrieved_evidence: EvidenceBundle | None = None,
    retrieval_execution_result: RetrievalExecutionResult | None = None,
) -> RagResultDiagnostics | None:
    raw_retrieved_sources = (
        tuple(retrieved_evidence.sources) if retrieved_evidence is not None else ()
    )
    preserve_retrieved_sources = bool(raw_retrieved_sources)
    if (
        resolved_scope is None
        and handbook_plan is None
        and curriculum_plan is None
        and curriculum_course_plan is None
        and curriculum_program_family_plan is None
        and not preserve_retrieved_sources
    ):
        return None
    retrieved_sources = raw_retrieved_sources if preserve_retrieved_sources else ()

    effective_source_trust_summary = source_trust_summary
    if effective_source_trust_summary is None:
        effective_source_trust_summary = build_source_trust_summary(
            evidence=evidence,
            claim_supports=claim_supports,
        )
    effective_remote_content_suspicion_summary = remote_content_suspicion_summary
    if effective_remote_content_suspicion_summary is None:
        effective_remote_content_suspicion_summary = build_remote_content_suspicion_summary(
            evidence,
        )

    def _diagnostics(**kwargs: object) -> RagResultDiagnostics:
        return RagResultDiagnostics(
            retrieved_sources=retrieved_sources,
            remote_content_suspicion_summary=effective_remote_content_suspicion_summary,
            source_trust_summary=effective_source_trust_summary,
            retrieval_plan_summary=_build_retrieval_plan_summary(retrieval_execution_result),
            **kwargs,
        )

    if (
        handbook_plan is None
        and curriculum_plan is None
        and curriculum_course_plan is None
        and curriculum_program_family_plan is None
    ):
        return _diagnostics(
            resolved_scope_corpus=resolved_scope.corpus if resolved_scope is not None else None,
            resolved_scope_collection=resolved_scope.collection
            if resolved_scope is not None
            else "",
            no_answer_reason=no_answer_reason,
            semantic_outcome=semantic_outcome,
            retrieval_adequacy_verdict=_retrieval_adequacy_verdict(retrieval_adequacy),
            retrieval_adequacy_reason=_retrieval_adequacy_reason(retrieval_adequacy),
            claim_supports=claim_supports,
            grounding_verdict=grounding_verdict,
            grounding_downgraded=grounding_downgraded,
            freshness_fail_closed=freshness_fail_closed,
            prompt_runtime_state=prompt_runtime_state,
            prompt_runtime_detail=prompt_runtime_detail,
            unsupported_fields=unsupported_fields,
        )
    if curriculum_program_family_plan is not None:
        return _diagnostics(
            resolved_scope_corpus=resolved_scope.corpus if resolved_scope is not None else None,
            resolved_scope_collection=resolved_scope.collection
            if resolved_scope is not None
            else "",
            no_answer_reason=no_answer_reason,
            semantic_outcome=semantic_outcome,
            retrieval_adequacy_verdict=_retrieval_adequacy_verdict(retrieval_adequacy),
            retrieval_adequacy_reason=_retrieval_adequacy_reason(retrieval_adequacy),
            claim_supports=claim_supports,
            grounding_verdict=grounding_verdict,
            grounding_downgraded=grounding_downgraded,
            freshness_fail_closed=freshness_fail_closed,
            prompt_runtime_state=prompt_runtime_state,
            prompt_runtime_detail=prompt_runtime_detail,
            unsupported_fields=unsupported_fields,
            clarification_reason=curriculum_program_family_plan.clarification_reason,
            retrieved_title_summary=_summarize_retrieved_titles(evidence),
            candidate_title_summary=curriculum_program_family_plan.clarification_candidates,
            resolution_mode=curriculum_program_family_plan.resolution_mode,
            resolved_entity_type="program_family",
            resolved_program_family_id=curriculum_program_family_plan.canonical_program_family_id,
            resolved_program_family_title=curriculum_program_family_plan.canonical_program_family_title,
        )
    if curriculum_course_plan is not None:
        return _diagnostics(
            resolved_scope_corpus=resolved_scope.corpus if resolved_scope is not None else None,
            resolved_scope_collection=resolved_scope.collection
            if resolved_scope is not None
            else "",
            no_answer_reason=no_answer_reason,
            semantic_outcome=semantic_outcome,
            retrieval_adequacy_verdict=_retrieval_adequacy_verdict(retrieval_adequacy),
            retrieval_adequacy_reason=_retrieval_adequacy_reason(retrieval_adequacy),
            claim_supports=claim_supports,
            grounding_verdict=grounding_verdict,
            grounding_downgraded=grounding_downgraded,
            prompt_runtime_state=prompt_runtime_state,
            prompt_runtime_detail=prompt_runtime_detail,
            freshness_fail_closed=freshness_fail_closed,
            retrieved_title_summary=_summarize_retrieved_titles(evidence),
            resolution_mode=curriculum_course_plan.resolution_mode,
            resolved_entity_type=curriculum_course_plan.entity_type,
            resolved_course_id=curriculum_course_plan.canonical_course_id,
            resolved_course_title=curriculum_course_plan.canonical_course_title,
            resolved_course_family_id=curriculum_course_plan.canonical_course_family_id,
            resolved_course_family_title=curriculum_course_plan.canonical_course_family_title,
            unsupported_fields=(curriculum_course_plan.unsupported_fields or unsupported_fields),
            partial_answer=curriculum_course_plan.partial_answer,
        )
    if handbook_plan is not None and handbook_plan.status != "pass_through":
        return _diagnostics(
            resolved_scope_corpus=resolved_scope.corpus if resolved_scope is not None else None,
            resolved_scope_collection=resolved_scope.collection
            if resolved_scope is not None
            else "",
            resolved_policy_document_id=handbook_plan.resolved_policy_document_id,
            resolved_policy_title=handbook_plan.resolved_policy_title,
            rewritten_query=(
                handbook_plan.rewritten_query_text if handbook_plan.status == "resolved" else ""
            ),
            clarification_reason=handbook_plan.clarification_reason,
            no_answer_reason=no_answer_reason,
            semantic_outcome=semantic_outcome,
            retrieval_adequacy_verdict=_retrieval_adequacy_verdict(retrieval_adequacy),
            retrieval_adequacy_reason=_retrieval_adequacy_reason(retrieval_adequacy),
            claim_supports=claim_supports,
            grounding_verdict=grounding_verdict,
            grounding_downgraded=grounding_downgraded,
            freshness_fail_closed=freshness_fail_closed,
            prompt_runtime_state=prompt_runtime_state,
            prompt_runtime_detail=prompt_runtime_detail,
            unsupported_fields=unsupported_fields,
            retrieved_title_summary=_summarize_retrieved_titles(evidence),
        )
    if curriculum_plan is None or curriculum_plan.status == "pass_through":
        if not (
            no_answer_reason
            or semantic_outcome
            or retrieval_adequacy is not None
            or unsupported_fields
            or grounding_verdict
            or grounding_downgraded
            or freshness_fail_closed
            or preserve_retrieved_sources
        ):
            return None
        return _diagnostics(
            resolved_scope_corpus=resolved_scope.corpus if resolved_scope is not None else None,
            resolved_scope_collection=resolved_scope.collection
            if resolved_scope is not None
            else "",
            no_answer_reason=no_answer_reason,
            semantic_outcome=semantic_outcome,
            retrieval_adequacy_verdict=_retrieval_adequacy_verdict(retrieval_adequacy),
            retrieval_adequacy_reason=_retrieval_adequacy_reason(retrieval_adequacy),
            claim_supports=claim_supports,
            grounding_verdict=grounding_verdict,
            grounding_downgraded=grounding_downgraded,
            freshness_fail_closed=freshness_fail_closed,
            prompt_runtime_state=prompt_runtime_state,
            prompt_runtime_detail=prompt_runtime_detail,
            unsupported_fields=unsupported_fields,
            retrieved_title_summary=_summarize_retrieved_titles(evidence),
        )
    session_follow_up = _resolve_curriculum_diagnostics_follow_up(
        curriculum_plan=curriculum_plan,
        allow_session_follow_up=allow_session_follow_up,
    )
    return _diagnostics(
        resolved_scope_corpus=resolved_scope.corpus if resolved_scope is not None else None,
        resolved_scope_collection=resolved_scope.collection if resolved_scope is not None else "",
        resolved_policy_document_id=(
            curriculum_plan.target_document_ids[0] if curriculum_plan.target_document_ids else ""
        ),
        resolved_policy_title=(
            curriculum_plan.resolved_document_title if curriculum_plan.status == "resolved" else ""
        ),
        rewritten_query=(
            curriculum_plan.rewritten_query_text
            if curriculum_plan.status in {"resolved", "soft_preference"}
            else ""
        ),
        clarification_reason=curriculum_plan.clarification_reason,
        no_answer_reason=no_answer_reason,
        semantic_outcome=semantic_outcome,
        retrieval_adequacy_verdict=_retrieval_adequacy_verdict(retrieval_adequacy),
        retrieval_adequacy_reason=_retrieval_adequacy_reason(retrieval_adequacy),
        claim_supports=claim_supports,
        grounding_verdict=grounding_verdict,
        grounding_downgraded=grounding_downgraded,
        freshness_fail_closed=freshness_fail_closed,
        prompt_runtime_state=prompt_runtime_state,
        prompt_runtime_detail=prompt_runtime_detail,
        unsupported_fields=unsupported_fields,
        retrieved_title_summary=_summarize_retrieved_titles(evidence),
        candidate_title_summary=curriculum_plan.candidate_title_summary,
        resolution_mode=_curriculum_resolution_mode(curriculum_plan),
        used_verified_identity=curriculum_plan.used_verified_identity,
        used_soft_preference=curriculum_plan.used_soft_preference,
        session_program_family=session_follow_up.program_family,
        session_program=session_follow_up.program,
        session_semester=session_follow_up.semester,
    )


def _build_retrieval_plan_summary(
    execution_result: RetrievalExecutionResult | None,
) -> RetrievalPlanSummary | None:
    if execution_result is None:
        return None
    return RetrievalPlanSummary(
        plan_id=execution_result.plan.plan_id,
        query_mode=execution_result.plan.query_mode,
        replan_count=execution_result.replan_count,
        terminal_state=_resolve_retrieval_terminal_state(execution_result),
        step_activities=tuple(
            RetrievalStepActivitySummary(
                step_id=activity.step_id,
                step_type=activity.step_type,
                corpus=activity.corpus,
                collection=activity.collection,
                status=activity.status,
                top_k=activity.top_k,
                latency_ms=activity.latency_ms,
                candidate_count=activity.candidate_count,
                reference_count=activity.reference_count,
                failure_kind=activity.failure_kind or "",
            )
            for activity in execution_result.step_activities
        ),
    )


def _resolve_retrieval_terminal_state(
    execution_result: RetrievalExecutionResult,
) -> str:
    statuses = tuple(result.status for result in execution_result.step_results)
    if "failed" in statuses:
        return "failed_closed"
    if "blocked" in statuses:
        return "blocked"
    return "completed"


def _retrieval_adequacy_verdict(
    retrieval_adequacy: RetrievalAdequacyAssessment | None,
) -> str:
    if retrieval_adequacy is None:
        return ""
    return retrieval_adequacy.verdict


def _retrieval_adequacy_reason(
    retrieval_adequacy: RetrievalAdequacyAssessment | None,
) -> str:
    if retrieval_adequacy is None:
        return ""
    return retrieval_adequacy.reason


def _planned_retrieval_adequacy(
    *,
    handbook_plan: HandbookQueryPlan | None,
    curriculum_plan: CurriculumQueryPlan | None,
    curriculum_program_family_plan: CurriculumProgramFamilyQueryPlan | None,
) -> RetrievalAdequacyAssessment:
    for reason in (
        handbook_plan.clarification_reason if handbook_plan is not None else "",
        (
            curriculum_program_family_plan.clarification_reason
            if curriculum_program_family_plan is not None
            else ""
        ),
        curriculum_plan.clarification_reason if curriculum_plan is not None else "",
    ):
        if reason:
            return ambiguous_retrieval_adequacy(reason)
    return ambiguous_retrieval_adequacy("multi_candidate_title")


def _clarification_retrieval_adequacy(
    *,
    resolved_scope: KnowledgeScope,
    handbook_plan: HandbookQueryPlan | None,
    curriculum_plan: CurriculumQueryPlan | None,
    curriculum_program_family_plan: CurriculumProgramFamilyQueryPlan | None,
    intent_frame,
) -> RetrievalAdequacyAssessment | None:
    if (
        resolved_scope.corpus == "regulations"
        and resolved_scope.collection == "student_rules"
        and intent_frame.ambiguity_reason == "missing_target"
    ):
        return ambiguous_retrieval_adequacy("policy_object_missing")
    if (
        (handbook_plan is None or not handbook_plan.clarification_reason)
        and (
            curriculum_program_family_plan is None
            or not curriculum_program_family_plan.clarification_reason
        )
        and (curriculum_plan is None or not curriculum_plan.clarification_reason)
    ):
        return None
    return _planned_retrieval_adequacy(
        handbook_plan=handbook_plan,
        curriculum_plan=curriculum_plan,
        curriculum_program_family_plan=curriculum_program_family_plan,
    )


def _empty_evidence_retrieval_adequacy(no_answer_reason: str):
    if no_answer_reason == "resolved_policy_clause_not_found":
        return insufficient_retrieval_adequacy("resolved_policy_clause_not_found")
    if no_answer_reason == "freshness_fail_close":
        return insufficient_retrieval_adequacy("freshness_fail_close")
    if no_answer_reason == "version_filter_unresolved":
        return insufficient_retrieval_adequacy("version_filter_unresolved")
    return insufficient_retrieval_adequacy("no_supporting_sources")


def _curriculum_resolution_mode(plan: CurriculumQueryPlan) -> str:
    if plan.status == "resolved":
        return "resolved_single"
    if plan.status == "soft_preference":
        return "soft_preference"
    if plan.status == "needs_clarification":
        return "needs_clarification"
    if plan.status == "unsupported":
        return "unsupported"
    return ""


def _resolve_curriculum_diagnostics_follow_up(
    *,
    curriculum_plan: CurriculumQueryPlan,
    allow_session_follow_up: bool,
) -> CurriculumFollowUpSlots:
    if not allow_session_follow_up or curriculum_plan.status != "resolved":
        return CurriculumFollowUpSlots()
    program_family = _derive_curriculum_session_program_family(
        curriculum_plan.resolved_document_title
    )
    semester = _derive_curriculum_session_semester(curriculum_plan.rewritten_query_text)
    program = _derive_curriculum_session_program(
        document_title=curriculum_plan.resolved_document_title,
        program_family=program_family,
    )
    if not program_family or not program or not semester:
        return CurriculumFollowUpSlots()
    return CurriculumFollowUpSlots(
        program_family=program_family,
        program=program,
        semester=semester,
    )


def _derive_curriculum_session_program_family(document_title: str) -> str:
    normalized_title = _normalize_text(document_title)
    for family in _CURRICULUM_SESSION_PROGRAM_FAMILIES:
        if _normalize_text(family) in normalized_title:
            return family
    return ""


def _derive_curriculum_session_program(
    *,
    document_title: str,
    program_family: str,
) -> str:
    core_title = _strip_curriculum_program_title(document_title)
    if not core_title:
        return ""
    if program_family and f"（{program_family}）" in core_title:
        return core_title.replace(f"（{program_family}）", program_family).strip()
    if program_family and f"({program_family})" in core_title:
        return core_title.replace(f"({program_family})", program_family).strip()
    if program_family and program_family not in core_title:
        return f"{core_title}{program_family}".strip()
    return core_title


def _strip_curriculum_program_title(document_title: str) -> str:
    title = document_title.strip()
    for suffix in _CURRICULUM_PROGRAM_TITLE_SUFFIXES:
        if title.endswith(suffix):
            return title[: -len(suffix)].strip()
    return title


def _derive_curriculum_session_semester(rewritten_query: str) -> str:
    from campus_retrieval_core.curriculum_query_resolution import interpret_curriculum_query

    interpretation = interpret_curriculum_query(rewritten_query)
    if interpretation.semester_labels:
        return interpretation.semester_labels[0]
    return ""


def _summarize_retrieved_titles(evidence: EvidenceBundle) -> tuple[str, ...]:
    titles: list[str] = []
    for source in evidence.sources:
        title = (
            source.source_title.strip()
            or (source.structural_path[0].strip() if source.structural_path else "")
            or _source_label(source)
        )
        if not title or title in titles:
            continue
        titles.append(title)
        if len(titles) >= 3:
            break
    return tuple(titles)
