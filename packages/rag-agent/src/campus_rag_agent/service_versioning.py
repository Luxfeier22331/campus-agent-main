from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from campus_contracts import (
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    SpecialistRequest,
    SpecialistResponse,
)
from campus_ingestion_core import (
    load_runtime_profile,
)
from campus_ingestion_core.corpus_profiles import (
    is_official_web_stable_reference_like_profile,
)
from campus_retrieval_core import RetrievalBackendError, RetrievalExecutionResult
from campus_retrieval_core.evidence_ranking import (
    select_supporting_evidence_sources,
)

from campus_rag_agent.agent import DEFAULT_MAX_ANSWER_SOURCES, RagAgent
from campus_rag_agent.query_planning import (
    CurriculumCourseQueryPlan,
    CurriculumProgramFamilyQueryPlan,
    CurriculumQueryPlan,
    HandbookQueryPlan,
)
from campus_rag_agent.retrieval_adequacy import (
    insufficient_retrieval_adequacy,
    sufficient_retrieval_adequacy,
)

from .service_common import _is_official_web_freshness_sensitive_query
from .service_response_text import (
    _build_version_filter_unresolved_answer,
    _resolved_policy_title,
)


@dataclass(frozen=True, slots=True)
class _VersionAnswerContext:
    mode: str = "current"
    target_version_ids: tuple[str, ...] = ()
    target_revision_track: str = ""
    primary_version_id: str = ""
    comparison_version_id: str = ""
    as_of: str = ""


def _resolve_version_answer_context(
    *,
    request: SpecialistRequest,
    resolved_scope: KnowledgeScope,
    retrieval_collection: str,
    target_document_ids: tuple[str, ...],
    build_document_registry_from_env_fn: Callable[[], Any],
    resolve_version_query_fn: Callable[..., Any],
) -> _VersionAnswerContext | None:
    version_query = request.payload.version_query
    if version_query.mode == "current":
        return _VersionAnswerContext()
    if len(target_document_ids) != 1:
        return None
    try:
        runtime_profile = load_runtime_profile(resolved_scope.corpus, retrieval_collection)
        resolved_version_query = resolve_version_query_fn(
            build_document_registry_from_env_fn(),
            document_id=target_document_ids[0],
            version_query=version_query,
            preferred_revision_tracks=runtime_profile.serving_revision_tracks,
        )
    except Exception as exc:  # pragma: no cover - exercised via caller mapping
        raise RetrievalBackendError("version resolution failed") from exc
    if (
        resolved_version_query.status != "resolved"
        or resolved_version_query.primary_selection is None
        or not resolved_version_query.selected_version_ids
    ):
        return None
    return _VersionAnswerContext(
        mode=version_query.mode,
        target_version_ids=resolved_version_query.selected_version_ids,
        target_revision_track=resolved_version_query.primary_selection.revision_track,
        primary_version_id=resolved_version_query.primary_selection.version_id,
        comparison_version_id=(
            resolved_version_query.comparison_selection.version_id
            if resolved_version_query.comparison_selection is not None
            else ""
        ),
        as_of=version_query.as_of,
    )


def _build_version_filter_unresolved_response(
    *,
    build_rag_result_payload,
    build_empty_evidence,
    request: SpecialistRequest,
    resolved_scope: KnowledgeScope,
    user_goal: str,
    handbook_plan: HandbookQueryPlan | None,
    curriculum_plan: CurriculumQueryPlan | None,
    curriculum_course_plan: CurriculumCourseQueryPlan | None,
    curriculum_program_family_plan: CurriculumProgramFamilyQueryPlan | None,
) -> SpecialistResponse:
    empty_evidence = build_empty_evidence(resolved_scope, user_goal)
    return SpecialistResponse(
        target="rag-agent",
        status="no_answer",
        answer_text=_build_version_filter_unresolved_answer(
            evidence=empty_evidence,
            resolved_policy_title=_resolved_policy_title(handbook_plan),
        ),
        confidence="low",
        result=build_rag_result_payload(
            evidence=empty_evidence,
            resolved_scope=resolved_scope,
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
            no_answer_reason="version_filter_unresolved",
            semantic_outcome="unsupported_by_evidence",
            retrieval_adequacy=insufficient_retrieval_adequacy("version_filter_unresolved"),
        ),
    )


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
    for source in (*selected_primary_sources, *selected_comparison_sources):
        ordered_sources.setdefault(source.chunk_id, source)
    return EvidenceBundle(
        query_text=evidence.query_text,
        corpus=evidence.corpus,
        collection=evidence.collection,
        sources=tuple(ordered_sources.values()),
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


def _build_compare_support_incomplete_response(
    *,
    build_rag_result_payload,
    resolved_scope: KnowledgeScope,
    user_goal: str,
    evidence: EvidenceBundle,
    retrieved_evidence: EvidenceBundle,
    retrieval_execution_result: RetrievalExecutionResult | None,
    handbook_plan: HandbookQueryPlan | None,
    curriculum_plan: CurriculumQueryPlan | None,
    curriculum_course_plan: CurriculumCourseQueryPlan | None,
    curriculum_program_family_plan: CurriculumProgramFamilyQueryPlan | None,
) -> SpecialistResponse:
    return SpecialistResponse(
        target="rag-agent",
        status="no_answer",
        answer_text="当前还不能稳定比较该制度的旧版与新版，因为双侧证据不完整。",
        confidence="low",
        result=build_rag_result_payload(
            evidence=evidence,
            retrieved_evidence=retrieved_evidence,
            retrieval_execution_result=retrieval_execution_result,
            resolved_scope=resolved_scope,
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
            no_answer_reason="compare_support_incomplete",
            semantic_outcome="unsupported_by_evidence",
            retrieval_adequacy=insufficient_retrieval_adequacy("compare_support_incomplete"),
        ),
    )


def _build_version_aware_completed_response(
    *,
    build_rag_result_payload,
    resolved_scope: KnowledgeScope,
    user_goal: str,
    evidence: EvidenceBundle,
    retrieved_evidence: EvidenceBundle,
    retrieval_execution_result: RetrievalExecutionResult | None,
    handbook_plan: HandbookQueryPlan | None,
    curriculum_plan: CurriculumQueryPlan | None,
    curriculum_course_plan: CurriculumCourseQueryPlan | None,
    curriculum_program_family_plan: CurriculumProgramFamilyQueryPlan | None,
    confidence: str,
    version_answer_context: _VersionAnswerContext,
) -> SpecialistResponse:
    answer_text = _build_version_aware_answer_text(
        evidence=evidence,
        version_answer_context=version_answer_context,
    )
    semantic_outcome = _version_answer_semantic_outcome(version_answer_context.mode)
    return SpecialistResponse(
        target="rag-agent",
        status="completed",
        answer_text=answer_text,
        confidence=confidence,
        result=build_rag_result_payload(
            evidence=evidence,
            retrieved_evidence=retrieved_evidence,
            retrieval_execution_result=retrieval_execution_result,
            resolved_scope=resolved_scope,
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
            semantic_outcome=semantic_outcome,
            retrieval_adequacy=sufficient_retrieval_adequacy(),
            grounding_verdict="grounded",
        ),
    )


def _build_version_aware_answer_text(
    *,
    evidence: EvidenceBundle,
    version_answer_context: _VersionAnswerContext,
) -> str:
    if version_answer_context.mode == "historical":
        base_answer = RagAgent().compose_answer(evidence)
        return f"以下内容基于该制度的历史版本（非现行版本）：{base_answer}"
    if version_answer_context.mode == "as_of":
        base_answer = RagAgent().compose_answer(evidence)
        return (
            f"以下内容基于截至{version_answer_context.as_of}可解析到的版本"
            f"（不代表当前现行规定）：{base_answer}"
        )
    primary_evidence, comparison_evidence = _partition_compare_evidence(
        evidence,
        version_answer_context=version_answer_context,
    )
    primary_answer = RagAgent().compose_answer(primary_evidence)
    comparison_answer = RagAgent().compose_answer(comparison_evidence)
    change_summary = _build_compare_change_summary(
        primary_answer=primary_answer,
        comparison_answer=comparison_answer,
    )
    return (
        "以下内容按两个版本分别说明。"
        f"旧版：{primary_answer} "
        f"新版：{comparison_answer} "
        f"变化点：{change_summary}"
    )


def _partition_compare_evidence(
    evidence: EvidenceBundle,
    *,
    version_answer_context: _VersionAnswerContext,
) -> tuple[EvidenceBundle, EvidenceBundle]:
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
    return (
        EvidenceBundle(
            query_text=evidence.query_text,
            corpus=evidence.corpus,
            collection=evidence.collection,
            sources=primary_sources,
        ),
        EvidenceBundle(
            query_text=evidence.query_text,
            corpus=evidence.corpus,
            collection=evidence.collection,
            sources=comparison_sources,
        ),
    )


def _build_compare_change_summary(
    *,
    primary_answer: str,
    comparison_answer: str,
) -> str:
    if primary_answer.strip() == comparison_answer.strip():
        return "当前检索到的依据未显示与你问题直接相关的变化点。"
    return "旧版与新版在该问题上的表述存在差异，具体请以上述双侧内容为准。"


def _version_answer_semantic_outcome(mode: str) -> str:
    if mode == "historical":
        return "historical_grounded_answer"
    if mode == "as_of":
        return "as_of_grounded_answer"
    if mode == "compare":
        return "compare_grounded_answer"
    return "grounded_answer"


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


def _resolve_retrieval_query_mode(
    *,
    resolved_scope: KnowledgeScope,
    retrieval_collection: str,
    user_goal: str,
    version_mode: str,
) -> str:
    if version_mode != "current":
        return version_mode
    profile = load_runtime_profile(resolved_scope.corpus, retrieval_collection)
    if _is_official_web_freshness_sensitive_query(user_goal) and (
        profile.requires_freshness_gate or is_official_web_stable_reference_like_profile(profile)
    ):
        return "freshness_sensitive"
    return version_mode
