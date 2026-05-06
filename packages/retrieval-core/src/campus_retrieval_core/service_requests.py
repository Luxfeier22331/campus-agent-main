from __future__ import annotations

from campus_contracts import AuthorizedRetrievalFilter, PersonalizationHint

from campus_retrieval_core.models import (
    RetrievalPlan,
    RetrievalPlanBudget,
    RetrievalRequest,
    RetrievalScope,
    RetrievalSelector,
    RetrievalSourceTrustPolicy,
    RetrievalStep,
    RetrievalStepBudget,
)

_COLLECTION_MINIMUM_SOURCE_TRUST_TIER = {
    "curriculum_plan": "T0",
    "program_semester_facts": "T0",
    "program_family_facts": "T0",
    "course_facts": "T0",
    "student_rules": "T1",
    "stable_reference": "T2",
    "fresh_news": "T3",
}


def build_single_step_plan(request: RetrievalRequest) -> RetrievalPlan:
    return RetrievalPlan(
        plan_id=f"{request.corpus}:{request.collection}:single-step",
        query_mode="current",
        admitted_scopes=(RetrievalScope(corpus=request.corpus, collection=request.collection),),
        version_query=None,
        source_trust_policy=RetrievalSourceTrustPolicy(
            minimum_tier=default_minimum_source_trust_tier_for_collection(request.collection),
        ),
        budget=RetrievalPlanBudget(max_steps=1, max_replans=0, max_live_lookups=0),
        steps=(
            RetrievalStep(
                step_id="indexed-lookup",
                step_type="indexed_lookup",
                scope=RetrievalScope(corpus=request.corpus, collection=request.collection),
                query_text=request.query_text,
                selector=RetrievalSelector(
                    target_document_ids=request.target_document_ids,
                    target_version_ids=request.target_version_ids,
                    target_revision_track=request.target_revision_track,
                    preferred_document_ids=request.preferred_document_ids,
                    focus_detail_labels=request.focus_detail_labels,
                    focus_article_nos=request.focus_article_nos,
                    focus_clause_nos=request.focus_clause_nos,
                    focus_terms=request.focus_terms,
                    canonical_course_ids=request.canonical_course_ids,
                    canonical_course_family_ids=request.canonical_course_family_ids,
                    canonical_program_family_ids=request.canonical_program_family_ids,
                ),
                budget=RetrievalStepBudget(top_k=request.top_k),
                expected_output="candidate_set",
            ),
        ),
    )


def build_retrieval_request_from_step(
    step: RetrievalStep,
    *,
    authorized_filter: AuthorizedRetrievalFilter | None,
    personalization_hint: PersonalizationHint | None,
) -> RetrievalRequest:
    return RetrievalRequest(
        query_text=step.query_text,
        corpus=step.scope.corpus,
        collection=step.scope.collection,
        target_document_ids=step.selector.target_document_ids,
        target_version_ids=step.selector.target_version_ids,
        target_revision_track=step.selector.target_revision_track,
        preferred_document_ids=step.selector.preferred_document_ids,
        focus_detail_labels=step.selector.focus_detail_labels,
        focus_article_nos=step.selector.focus_article_nos,
        focus_clause_nos=step.selector.focus_clause_nos,
        focus_terms=step.selector.focus_terms,
        canonical_course_ids=step.selector.canonical_course_ids,
        canonical_course_family_ids=step.selector.canonical_course_family_ids,
        canonical_program_family_ids=step.selector.canonical_program_family_ids,
        authorized_filter=authorized_filter,
        personalization_hint=personalization_hint,
        top_k=step.budget.top_k,
        timeout_ms=step.budget.timeout_ms,
    )


def default_minimum_source_trust_tier_for_collection(collection: str) -> str:
    return _COLLECTION_MINIMUM_SOURCE_TRUST_TIER.get(collection.strip(), "T1")


__all__ = [
    "build_retrieval_request_from_step",
    "build_single_step_plan",
    "default_minimum_source_trust_tier_for_collection",
]
