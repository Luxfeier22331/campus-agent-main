from __future__ import annotations

from dataclasses import replace

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_retrieval_core.evidence_ranking import (
    select_supporting_evidence_sources,
)

from campus_rag_agent.agent import DEFAULT_MAX_ANSWER_SOURCES
from campus_rag_agent.query_planning import (
    CurriculumCourseQueryPlan,
    CurriculumQueryPlan,
)

from .service_versioning_context import _VersionAnswerContext


def _build_version_aware_supporting_evidence(
    evidence: EvidenceBundle,
    *,
    version_answer_context: _VersionAnswerContext,
    curriculum_plan: CurriculumQueryPlan | None = None,
    curriculum_course_plan: CurriculumCourseQueryPlan | None = None,
) -> EvidenceBundle:
    if version_answer_context.mode != "compare":
        return _build_supporting_evidence(
            evidence,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
        )
    return _build_compare_supporting_evidence(
        evidence,
        version_answer_context=version_answer_context,
    )


def _build_compare_supporting_evidence(
    evidence: EvidenceBundle,
    *,
    version_answer_context: _VersionAnswerContext,
) -> EvidenceBundle:
    primary_sources = tuple(
        source
        for source in evidence.sources
        if source.version_id == version_answer_context.primary_version_id
    )
    comparison_sources = tuple(
        source
        for source in evidence.sources
        if source.version_id == version_answer_context.comparison_version_id
    )
    selected_primary_sources = select_supporting_evidence_sources(
        query_text=evidence.query_text,
        sources=primary_sources,
        max_sources=2,
    )
    selected_comparison_sources = select_supporting_evidence_sources(
        query_text=evidence.query_text,
        sources=comparison_sources,
        max_sources=2,
    )
    ordered_sources: dict[str, EvidenceSource] = {}
    for source in (
        *(
            _with_compare_version_side(source, version_side="primary")
            for source in selected_primary_sources
        ),
        *(
            _with_compare_version_side(source, version_side="comparison")
            for source in selected_comparison_sources
        ),
    ):
        ordered_sources.setdefault(source.chunk_id, source)
    return EvidenceBundle(
        query_text=evidence.query_text,
        corpus=evidence.corpus,
        collection=evidence.collection,
        sources=tuple(ordered_sources.values()),
    )


def _with_compare_version_side(source: EvidenceSource, *, version_side: str) -> EvidenceSource:
    return replace(
        source,
        anchor={
            **source.anchor,
            "retrieval_version_side": version_side,
        },
    )


def _is_compare_support_incomplete(
    *,
    supporting_evidence: EvidenceBundle,
    version_answer_context: _VersionAnswerContext,
) -> bool:
    if version_answer_context.mode != "compare":
        return False
    if (
        not version_answer_context.primary_version_id
        or not version_answer_context.comparison_version_id
    ):
        return True
    primary_present = any(
        source.version_id == version_answer_context.primary_version_id
        for source in supporting_evidence.sources
    )
    comparison_present = any(
        source.version_id == version_answer_context.comparison_version_id
        for source in supporting_evidence.sources
    )
    return not (primary_present and comparison_present)


def _build_supporting_evidence(
    evidence: EvidenceBundle,
    *,
    curriculum_plan: CurriculumQueryPlan | None = None,
    curriculum_course_plan: CurriculumCourseQueryPlan | None = None,
) -> EvidenceBundle:
    max_sources = DEFAULT_MAX_ANSWER_SOURCES
    if (
        curriculum_course_plan is not None
        and curriculum_course_plan.entity_type == "course_family"
        and curriculum_course_plan.fact_intent == "schedule"
    ):
        max_sources = 8
    elif curriculum_plan is not None and curriculum_plan.intent_kind == "curriculum_lookup":
        max_sources = max(DEFAULT_MAX_ANSWER_SOURCES, 4)
    return EvidenceBundle(
        query_text=evidence.query_text,
        corpus=evidence.corpus,
        collection=evidence.collection,
        sources=select_supporting_evidence_sources(
            query_text=evidence.query_text,
            sources=evidence.sources,
            max_sources=max_sources,
        ),
    )


__all__ = [
    "_build_compare_supporting_evidence",
    "_build_supporting_evidence",
    "_build_version_aware_supporting_evidence",
    "_is_compare_support_incomplete",
]
