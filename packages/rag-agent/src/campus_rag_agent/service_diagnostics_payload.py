from __future__ import annotations

from campus_contracts import (
    ClaimSupport,
    EvidenceBundle,
    KnowledgeScope,
    RagEntityResolutionSummary,
    RagPlannerInformationNeed,
    RagProjectionContextSummary,
    RagReplanDecisionSummary,
    RagResultDiagnostics,
    RagResultPayload,
    RemoteContentSuspicionSummary,
    SourceTrustSummary,
)
from campus_retrieval_core import RetrievalExecutionResult

from campus_rag_agent.agentic_depth_diagnostics import (
    build_claim_evidence_graph,
    build_projection_context_summaries,
    build_replan_decision_summary,
)
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
from campus_rag_agent.retrieval_adequacy import RetrievalAdequacyAssessment

from .service_common import _source_label
from .service_diagnostics_adequacy import (
    _retrieval_adequacy_reason,
    _retrieval_adequacy_verdict,
)
from .service_diagnostics_curriculum import (
    _curriculum_resolution_mode,
    _resolve_curriculum_diagnostics_follow_up,
)
from .service_diagnostics_retrieval import _build_retrieval_plan_summary
from .service_stage_diagnostics import build_rag_stage_activity_summaries


def _build_rag_result_payload(
    *,
    evidence: EvidenceBundle,
    resolved_scope: KnowledgeScope | None,
    handbook_plan: HandbookQueryPlan | None,
    curriculum_plan: CurriculumQueryPlan | None = None,
    curriculum_course_plan: CurriculumCourseQueryPlan | None = None,
    curriculum_program_family_plan: CurriculumProgramFamilyQueryPlan | None = None,
    request_id: str = "",
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
    planner_information_needs: tuple[RagPlannerInformationNeed, ...] = (),
    projection_context_summaries: tuple[RagProjectionContextSummary, ...] = (),
    replan_decision_summary: RagReplanDecisionSummary | None = None,
) -> RagResultPayload:
    diagnostics = _build_rag_result_diagnostics(
        evidence=evidence,
        resolved_scope=resolved_scope,
        handbook_plan=handbook_plan,
        curriculum_plan=curriculum_plan,
        curriculum_course_plan=curriculum_course_plan,
        curriculum_program_family_plan=curriculum_program_family_plan,
        request_id=request_id,
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
        planner_information_needs=planner_information_needs,
        projection_context_summaries=projection_context_summaries,
        replan_decision_summary=replan_decision_summary,
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
    request_id: str = "",
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
    planner_information_needs: tuple[RagPlannerInformationNeed, ...] = (),
    projection_context_summaries: tuple[RagProjectionContextSummary, ...] = (),
    replan_decision_summary: RagReplanDecisionSummary | None = None,
) -> RagResultDiagnostics | None:
    raw_retrieved_sources = _resolve_retrieved_sources(
        retrieved_evidence=retrieved_evidence,
        retrieval_execution_result=retrieval_execution_result,
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
            planner_information_needs=planner_information_needs,
            projection_context_summaries=projection_context_summaries,
            entity_resolution_summary=_build_entity_resolution_summary(
                retrieval_collection=(
                    retrieval_execution_result.plan.admitted_scopes[0].collection
                    if retrieval_execution_result is not None
                    and retrieval_execution_result.plan.admitted_scopes
                    else (
                        resolved_scope.collection
                        if resolved_scope is not None
                        else evidence.collection
                    )
                ),
                handbook_plan=handbook_plan,
                curriculum_course_plan=curriculum_course_plan,
                curriculum_program_family_plan=curriculum_program_family_plan,
            ),
            replan_decision_summary=(
                replan_decision_summary
                if replan_decision_summary is not None
                else build_replan_decision_summary(retrieval_execution_result)
            ),
            claim_evidence_graph=build_claim_evidence_graph(
                evidence=evidence,
                claim_supports=claim_supports,
            ),
            stage_activities=build_rag_stage_activity_summaries(
                request_id=request_id,
                evidence=evidence,
                retrieved_evidence=retrieved_evidence,
                retrieval_execution_result=retrieval_execution_result,
                retrieval_adequacy=retrieval_adequacy,
                semantic_outcome=semantic_outcome,
                no_answer_reason=no_answer_reason,
                grounding_verdict=grounding_verdict,
                prompt_runtime_state=prompt_runtime_state,
            ),
            **kwargs,
        )

    base_fields = {
        "resolved_scope_corpus": resolved_scope.corpus if resolved_scope is not None else None,
        "resolved_scope_collection": resolved_scope.collection
        if resolved_scope is not None
        else "",
        "no_answer_reason": no_answer_reason,
        "semantic_outcome": semantic_outcome,
        "retrieval_adequacy_verdict": _retrieval_adequacy_verdict(retrieval_adequacy),
        "retrieval_adequacy_reason": _retrieval_adequacy_reason(retrieval_adequacy),
        "claim_supports": claim_supports,
        "grounding_verdict": grounding_verdict,
        "grounding_downgraded": grounding_downgraded,
        "freshness_fail_closed": freshness_fail_closed,
        "prompt_runtime_state": prompt_runtime_state,
        "prompt_runtime_detail": prompt_runtime_detail,
        "unsupported_fields": unsupported_fields,
    }

    if (
        handbook_plan is None
        and curriculum_plan is None
        and curriculum_course_plan is None
        and curriculum_program_family_plan is None
    ):
        return _diagnostics(**base_fields)
    if curriculum_program_family_plan is not None:
        return _diagnostics(
            **base_fields,
            clarification_reason=curriculum_program_family_plan.clarification_reason,
            retrieved_title_summary=_summarize_retrieved_titles(evidence),
            candidate_title_summary=curriculum_program_family_plan.clarification_candidates,
            resolution_mode=curriculum_program_family_plan.resolution_mode,
            resolved_entity_type="program_family",
            resolved_program_family_id=curriculum_program_family_plan.canonical_program_family_id,
            resolved_program_family_title=curriculum_program_family_plan.canonical_program_family_title,
        )
    if curriculum_course_plan is not None:
        course_fields = {
            **base_fields,
            "unsupported_fields": (curriculum_course_plan.unsupported_fields or unsupported_fields),
        }
        return _diagnostics(
            **course_fields,
            retrieved_title_summary=_summarize_retrieved_titles(evidence),
            resolution_mode=curriculum_course_plan.resolution_mode,
            resolved_entity_type=curriculum_course_plan.entity_type,
            resolved_course_id=curriculum_course_plan.canonical_course_id,
            resolved_course_title=curriculum_course_plan.canonical_course_title,
            resolved_course_family_id=curriculum_course_plan.canonical_course_family_id,
            resolved_course_family_title=curriculum_course_plan.canonical_course_family_title,
            partial_answer=curriculum_course_plan.partial_answer,
        )
    if handbook_plan is not None and handbook_plan.status != "pass_through":
        return _diagnostics(
            **base_fields,
            resolved_policy_document_id=handbook_plan.resolved_policy_document_id,
            resolved_policy_title=handbook_plan.resolved_policy_title,
            rewritten_query=(
                handbook_plan.rewritten_query_text if handbook_plan.status == "resolved" else ""
            ),
            clarification_reason=handbook_plan.clarification_reason,
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
            **base_fields,
            retrieved_title_summary=_summarize_retrieved_titles(evidence),
        )
    session_follow_up = _resolve_curriculum_diagnostics_follow_up(
        curriculum_plan=curriculum_plan,
        allow_session_follow_up=allow_session_follow_up,
    )
    return _diagnostics(
        **base_fields,
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
        retrieved_title_summary=_summarize_retrieved_titles(evidence),
        candidate_title_summary=curriculum_plan.candidate_title_summary,
        resolution_mode=_curriculum_resolution_mode(curriculum_plan),
        used_verified_identity=curriculum_plan.used_verified_identity,
        used_soft_preference=curriculum_plan.used_soft_preference,
        session_program_family=session_follow_up.program_family,
        session_program=session_follow_up.program,
        session_semester=session_follow_up.semester,
    )


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


def _resolve_retrieved_sources(
    *,
    retrieved_evidence: EvidenceBundle | None,
    retrieval_execution_result: RetrievalExecutionResult | None,
) -> tuple:
    if retrieval_execution_result is None:
        return tuple(retrieved_evidence.sources) if retrieved_evidence is not None else ()
    ordered_sources = {}
    for step_result in retrieval_execution_result.step_results:
        for source in step_result.references:
            dedupe_key = source.chunk_id or repr(source)
            ordered_sources.setdefault(dedupe_key, source)
    if ordered_sources:
        return tuple(ordered_sources.values())
    return tuple(retrieved_evidence.sources) if retrieved_evidence is not None else ()


def build_projection_context_summaries_from_request(
    request,
) -> tuple[RagProjectionContextSummary, ...]:
    workflow_context = getattr(request, "workflow_context", None)
    if workflow_context is None:
        return ()
    return build_projection_context_summaries(workflow_context.projection_refs)


def _build_entity_resolution_summary(
    *,
    retrieval_collection: str,
    handbook_plan: HandbookQueryPlan | None,
    curriculum_course_plan: CurriculumCourseQueryPlan | None,
    curriculum_program_family_plan: CurriculumProgramFamilyQueryPlan | None,
) -> RagEntityResolutionSummary | None:
    if curriculum_course_plan is not None:
        if curriculum_course_plan.entity_type == "course":
            return RagEntityResolutionSummary(
                resolution_status="resolved",
                entity_type="course",
                canonical_id=curriculum_course_plan.canonical_course_id,
                canonical_title=curriculum_course_plan.canonical_course_title,
                target_collection=retrieval_collection,
                resolution_source="canonical_alias_governance",
                confidence=0.95,
            )
        return RagEntityResolutionSummary(
            resolution_status="resolved",
            entity_type="course_family",
            canonical_id=curriculum_course_plan.canonical_course_family_id,
            canonical_title=curriculum_course_plan.canonical_course_family_title,
            target_collection=retrieval_collection,
            resolution_source="canonical_alias_governance",
            confidence=0.95,
        )
    if curriculum_program_family_plan is not None:
        status = (
            "resolved"
            if curriculum_program_family_plan.resolution_mode == "resolved_family"
            else "ambiguous"
        )
        return RagEntityResolutionSummary(
            resolution_status=status,
            entity_type="program_family",
            canonical_id=curriculum_program_family_plan.canonical_program_family_id,
            canonical_title=curriculum_program_family_plan.canonical_program_family_title,
            target_collection=retrieval_collection,
            resolution_source="program_family_alias_governance",
            confidence=0.95 if status == "resolved" else 0.0,
            ambiguity_reason=curriculum_program_family_plan.clarification_reason,
        )
    if handbook_plan is not None and handbook_plan.status == "resolved":
        return RagEntityResolutionSummary(
            resolution_status="resolved",
            entity_type="policy_document",
            canonical_id=handbook_plan.resolved_policy_document_id,
            canonical_title=handbook_plan.resolved_policy_title,
            target_collection=retrieval_collection,
            resolution_source="policy_object_alias_governance",
            confidence=0.95,
        )
    if handbook_plan is not None and handbook_plan.status == "needs_clarification":
        return RagEntityResolutionSummary(
            resolution_status="ambiguous",
            entity_type="policy_document",
            target_collection=retrieval_collection,
            resolution_source="policy_object_alias_governance",
            ambiguity_reason=handbook_plan.clarification_reason,
        )
    return None


__all__ = [
    "_build_entity_resolution_summary",
    "_build_rag_result_diagnostics",
    "_build_rag_result_payload",
    "_summarize_retrieved_titles",
    "build_projection_context_summaries_from_request",
]
