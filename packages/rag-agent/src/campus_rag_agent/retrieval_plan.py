from __future__ import annotations

from campus_contracts import KnowledgeScope, VersionQuery
from campus_retrieval_core import (
    RetrievalPlan,
    RetrievalPlanBudget,
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
DEFAULT_INDEXED_LOOKUP_TIMEOUT_MS = 8000


def build_ordered_retrieval_plan(
    *,
    query_text: str,
    scope: KnowledgeScope,
    retrieval_collection: str,
    query_mode: str,
    target_document_ids: tuple[str, ...] = (),
    target_version_ids: tuple[str, ...] = (),
    target_revision_track: str = "",
    preferred_document_ids: tuple[str, ...] = (),
    focus_detail_labels: tuple[str, ...] = (),
    focus_article_nos: tuple[str, ...] = (),
    focus_clause_nos: tuple[str, ...] = (),
    focus_terms: tuple[str, ...] = (),
    canonical_course_ids: tuple[str, ...] = (),
    canonical_course_family_ids: tuple[str, ...] = (),
    canonical_program_family_ids: tuple[str, ...] = (),
    top_k: int,
    version_query: VersionQuery | None = None,
    primary_version_id: str = "",
    comparison_version_id: str = "",
    need_ids: tuple[str, ...] = (),
    max_replans: int = 1,
    allow_live_source_lookup: bool = False,
    indexed_lookup_timeout_ms: int | None = DEFAULT_INDEXED_LOOKUP_TIMEOUT_MS,
) -> RetrievalPlan:
    admitted_scope = RetrievalScope(corpus=scope.corpus, collection=retrieval_collection)
    base_selector = RetrievalSelector(
        target_document_ids=target_document_ids,
        target_revision_track=target_revision_track,
        preferred_document_ids=preferred_document_ids,
        focus_detail_labels=focus_detail_labels,
        focus_article_nos=focus_article_nos,
        focus_clause_nos=focus_clause_nos,
        focus_terms=focus_terms,
        canonical_course_ids=canonical_course_ids,
        canonical_course_family_ids=canonical_course_family_ids,
        canonical_program_family_ids=canonical_program_family_ids,
    )
    step_budget = RetrievalStepBudget(top_k=top_k, timeout_ms=indexed_lookup_timeout_ms)

    if query_mode == "compare":
        normalized_primary_version_id = primary_version_id.strip()
        normalized_comparison_version_id = comparison_version_id.strip()
        if not normalized_primary_version_id or not normalized_comparison_version_id:
            raise ValueError(
                "compare retrieval plan requires both primary and comparison version ids"
            )
        steps = (
            RetrievalStep(
                step_id="compare-pair-lookup",
                step_type="compare_pair_lookup",
                scope=admitted_scope,
                query_text=query_text,
                need_ids=need_ids,
                selector=RetrievalSelector(
                    target_document_ids=base_selector.target_document_ids,
                    target_version_ids=(
                        normalized_primary_version_id,
                        normalized_comparison_version_id,
                    ),
                    target_revision_track=base_selector.target_revision_track,
                    preferred_document_ids=base_selector.preferred_document_ids,
                    focus_detail_labels=base_selector.focus_detail_labels,
                    focus_article_nos=base_selector.focus_article_nos,
                    focus_clause_nos=base_selector.focus_clause_nos,
                    focus_terms=base_selector.focus_terms,
                    canonical_course_ids=base_selector.canonical_course_ids,
                    canonical_course_family_ids=base_selector.canonical_course_family_ids,
                    canonical_program_family_ids=base_selector.canonical_program_family_ids,
                ),
                budget=step_budget,
                expected_output="compare_inputs",
            ),
        )
    elif query_mode in {"historical", "as_of"}:
        steps = (
            RetrievalStep(
                step_id="historical-version-lookup",
                step_type="historical_version_lookup",
                scope=admitted_scope,
                query_text=query_text,
                need_ids=need_ids,
                selector=RetrievalSelector(
                    target_document_ids=base_selector.target_document_ids,
                    target_version_ids=target_version_ids,
                    target_revision_track=base_selector.target_revision_track,
                    preferred_document_ids=base_selector.preferred_document_ids,
                    focus_detail_labels=base_selector.focus_detail_labels,
                    focus_article_nos=base_selector.focus_article_nos,
                    focus_clause_nos=base_selector.focus_clause_nos,
                    focus_terms=base_selector.focus_terms,
                    canonical_course_ids=base_selector.canonical_course_ids,
                    canonical_course_family_ids=base_selector.canonical_course_family_ids,
                    canonical_program_family_ids=base_selector.canonical_program_family_ids,
                ),
                budget=step_budget,
                expected_output="candidate_set",
            ),
        )
    elif query_mode == "freshness_sensitive":
        steps = (
            RetrievalStep(
                step_id="freshness-gate",
                step_type="freshness_gate",
                scope=admitted_scope,
                query_text=query_text,
                need_ids=need_ids,
                selector=base_selector,
                budget=step_budget,
                expected_output="freshness_decision",
            ),
            RetrievalStep(
                step_id="indexed-lookup",
                step_type="indexed_lookup",
                scope=admitted_scope,
                query_text=query_text,
                need_ids=need_ids,
                depends_on_step_ids=("freshness-gate",),
                selector=RetrievalSelector(
                    target_document_ids=base_selector.target_document_ids,
                    target_version_ids=target_version_ids,
                    target_revision_track=base_selector.target_revision_track,
                    preferred_document_ids=base_selector.preferred_document_ids,
                    canonical_course_ids=base_selector.canonical_course_ids,
                    canonical_course_family_ids=base_selector.canonical_course_family_ids,
                    canonical_program_family_ids=base_selector.canonical_program_family_ids,
                ),
                budget=step_budget,
                expected_output="candidate_set",
            ),
        )
    elif query_mode == "live_assisted":
        steps = (
            RetrievalStep(
                step_id="freshness-gate",
                step_type="freshness_gate",
                scope=admitted_scope,
                query_text=query_text,
                need_ids=need_ids,
                selector=base_selector,
                budget=step_budget,
                expected_output="freshness_decision",
            ),
            RetrievalStep(
                step_id="live-source-lookup",
                step_type="live_source_lookup",
                scope=admitted_scope,
                query_text=query_text,
                need_ids=need_ids,
                depends_on_step_ids=("freshness-gate",),
                selector=base_selector,
                budget=step_budget,
                expected_output="live_candidates",
            ),
        )
    else:
        needs_entity_resolution = bool(
            base_selector.canonical_course_ids
            or base_selector.canonical_course_family_ids
            or base_selector.canonical_program_family_ids
            or base_selector.entity_keys
        )
        entity_step = (
            (
                RetrievalStep(
                    step_id="entity-resolution",
                    step_type="entity_resolution",
                    scope=admitted_scope,
                    query_text=query_text,
                    need_ids=need_ids,
                    selector=RetrievalSelector(
                        target_document_ids=base_selector.target_document_ids,
                        target_version_ids=target_version_ids,
                        target_revision_track=base_selector.target_revision_track,
                        preferred_document_ids=base_selector.preferred_document_ids,
                        focus_detail_labels=base_selector.focus_detail_labels,
                        focus_article_nos=base_selector.focus_article_nos,
                        focus_clause_nos=base_selector.focus_clause_nos,
                        focus_terms=base_selector.focus_terms,
                        canonical_course_ids=base_selector.canonical_course_ids,
                        canonical_course_family_ids=base_selector.canonical_course_family_ids,
                        canonical_program_family_ids=base_selector.canonical_program_family_ids,
                        entity_keys=base_selector.entity_keys,
                    ),
                    budget=step_budget,
                    expected_output="entity_matches",
                ),
            )
            if needs_entity_resolution
            else ()
        )
        steps = (
            *entity_step,
            RetrievalStep(
                step_id="indexed-lookup",
                step_type="indexed_lookup",
                scope=admitted_scope,
                query_text=query_text,
                need_ids=need_ids,
                depends_on_step_ids=("entity-resolution",) if needs_entity_resolution else (),
                selector=RetrievalSelector(
                    target_document_ids=base_selector.target_document_ids,
                    target_version_ids=target_version_ids,
                    target_revision_track=base_selector.target_revision_track,
                    preferred_document_ids=base_selector.preferred_document_ids,
                    focus_detail_labels=base_selector.focus_detail_labels,
                    focus_article_nos=base_selector.focus_article_nos,
                    focus_clause_nos=base_selector.focus_clause_nos,
                    focus_terms=base_selector.focus_terms,
                    canonical_course_ids=base_selector.canonical_course_ids,
                    canonical_course_family_ids=base_selector.canonical_course_family_ids,
                    canonical_program_family_ids=base_selector.canonical_program_family_ids,
                ),
                budget=step_budget,
                expected_output="candidate_set",
            ),
        )

    minimum_source_trust_tier = _default_minimum_source_trust_tier(
        retrieval_collection=retrieval_collection,
        query_mode=query_mode,
    )
    return RetrievalPlan(
        plan_id=f"{scope.corpus}:{retrieval_collection}:{query_mode}",
        query_mode=query_mode,
        admitted_scopes=(admitted_scope,),
        version_query=version_query,
        source_trust_policy=RetrievalSourceTrustPolicy(
            minimum_tier=minimum_source_trust_tier,
            allow_live_source_lookup=allow_live_source_lookup,
            legacy_fallback_mode="target_v3_only",
        ),
        budget=RetrievalPlanBudget(
            max_steps=len(steps) + max_replans,
            max_replans=max_replans,
            max_live_lookups=1 if allow_live_source_lookup else 0,
        ),
        steps=steps,
    )


def _default_minimum_source_trust_tier(
    *,
    retrieval_collection: str,
    query_mode: str,
) -> str:
    if query_mode in {"freshness_sensitive", "live_assisted"}:
        return "T3"
    return _COLLECTION_MINIMUM_SOURCE_TRUST_TIER.get(retrieval_collection.strip(), "T1")
