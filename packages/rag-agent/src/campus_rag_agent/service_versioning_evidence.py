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
    HandbookQueryPlan,
)

from .service_versioning_context import _VersionAnswerContext


def _build_version_aware_supporting_evidence(
    evidence: EvidenceBundle,
    *,
    version_answer_context: _VersionAnswerContext,
    handbook_plan: HandbookQueryPlan | None = None,
    curriculum_plan: CurriculumQueryPlan | None = None,
    curriculum_course_plan: CurriculumCourseQueryPlan | None = None,
) -> EvidenceBundle:
    if version_answer_context.mode != "compare":
        return _build_supporting_evidence(
            evidence,
            handbook_plan=handbook_plan,
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
    handbook_plan: HandbookQueryPlan | None = None,
    curriculum_plan: CurriculumQueryPlan | None = None,
    curriculum_course_plan: CurriculumCourseQueryPlan | None = None,
) -> EvidenceBundle:
    max_sources = DEFAULT_MAX_ANSWER_SOURCES
    if handbook_plan is not None and handbook_plan.task_kind == "category_discovery":
        max_sources = max(DEFAULT_MAX_ANSWER_SOURCES, len(handbook_plan.preferred_document_ids), 8)
        return EvidenceBundle(
            query_text=evidence.query_text,
            corpus=evidence.corpus,
            collection=evidence.collection,
            sources=_select_category_discovery_support_sources(
                evidence=evidence,
                member_document_ids=handbook_plan.preferred_document_ids,
                max_sources=max_sources,
            ),
        )
    elif (
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


def _select_category_discovery_support_sources(
    *,
    evidence: EvidenceBundle,
    member_document_ids: tuple[str, ...],
    max_sources: int,
) -> tuple[EvidenceSource, ...]:
    if max_sources <= 0:
        return ()
    sources_by_doc_id: dict[str, list[EvidenceSource]] = {}
    for source in evidence.sources:
        sources_by_doc_id.setdefault(source.doc_id, []).append(source)

    selected: list[EvidenceSource] = []
    seen_doc_ids: set[str] = set()
    for document_id in member_document_ids:
        source = _best_category_source(sources_by_doc_id.get(document_id, ()))
        if source is None or source.doc_id in seen_doc_ids:
            continue
        selected.append(source)
        seen_doc_ids.add(source.doc_id)
        if len(selected) >= max_sources:
            return tuple(selected)
    return tuple(selected)


def _best_category_source(sources: tuple[EvidenceSource, ...] | list[EvidenceSource]):
    if not sources:
        return None
    return max(
        sources,
        key=_category_source_sort_key,
    )


def _category_source_sort_key(source: EvidenceSource) -> tuple[int, int, int, float]:
    return (
        _category_source_answer_role_priority(source),
        _category_source_role_priority(source),
        _category_source_text_priority(source),
        1 if source.is_answer_bearing else 0,
        source.score,
    )


def _category_source_answer_role_priority(source: EvidenceSource) -> int:
    answer_role = str(source.anchor.get("answer_role") or source.semantic_role or "").strip()
    if answer_role == "category_overview":
        return 4
    if answer_role == "eligibility_intro":
        return 2
    if answer_role in {"eligibility_condition", "example_evidence", "exception_rule"}:
        return 1
    if answer_role in {"procedure_step", "exclusion_rule"}:
        return 0
    return 1


def _category_source_role_priority(source: EvidenceSource) -> int:
    role = source.content_role.strip()
    if role in {"definition", "overview", "summary", "audience", "scope_rule"}:
        return 4
    if role in {"primary_content", "eligibility"}:
        return 3
    if role in {"procedure", "requirement", "time_rule", "deadline"}:
        return 1
    return 2


def _category_source_text_priority(source: EvidenceSource) -> int:
    text = " ".join(
        part
        for part in (
            source.detail_label,
            *source.structural_path,
            source.snippet,
        )
        if part
    )
    if any(cue in text for cue in ("奖励对象", "奖励资助对象", "评选对象", "适用范围", "总则")):
        return 3
    if any(cue in text for cue in ("不得", "不能", "不得同时", "不予", "取消")):
        return 0
    if any(cue in text for cue in ("申请", "评审程序", "评选条件", "同时申请")):
        return 1
    return 2


__all__ = [
    "_build_compare_supporting_evidence",
    "_build_supporting_evidence",
    "_build_version_aware_supporting_evidence",
    "_is_compare_support_incomplete",
]
