from __future__ import annotations

from campus_contracts import (
    AgentResponse,
    EvidenceBundle,
    KnowledgeScope,
    RagPlannerInformationNeed,
    RagProjectionContextSummary,
)
from campus_retrieval_core import RetrievalExecutionResult

from campus_rag_agent.agent import RagAgent
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
from campus_rag_agent.retrieval_intent import RetrievalIntent

from .service_response_text import (
    _build_version_filter_unresolved_answer,
    _resolved_policy_title,
)
from .service_versioning_context import _VersionAnswerContext


def _build_version_filter_unresolved_response(
    *,
    build_rag_result_payload,
    build_empty_evidence,
    request,
    resolved_scope: KnowledgeScope,
    user_goal: str,
    handbook_plan: HandbookQueryPlan | None,
    curriculum_plan: CurriculumQueryPlan | None,
    curriculum_course_plan: CurriculumCourseQueryPlan | None,
    curriculum_program_family_plan: CurriculumProgramFamilyQueryPlan | None,
) -> AgentResponse:
    empty_evidence = build_empty_evidence(resolved_scope, user_goal)
    return AgentResponse(
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
            request_id=request.request_id,
            no_answer_reason="version_filter_unresolved",
            semantic_outcome="unsupported_by_evidence",
            retrieval_adequacy=insufficient_retrieval_adequacy("version_filter_unresolved"),
        ),
    )


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
    request_id: str = "",
    planner_information_needs: tuple[RagPlannerInformationNeed, ...] = (),
    projection_context_summaries: tuple[RagProjectionContextSummary, ...] = (),
) -> AgentResponse:
    return AgentResponse(
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
            request_id=request_id,
            no_answer_reason="compare_support_incomplete",
            semantic_outcome="unsupported_by_evidence",
            retrieval_adequacy=insufficient_retrieval_adequacy("compare_support_incomplete"),
            planner_information_needs=planner_information_needs,
            projection_context_summaries=projection_context_summaries,
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
    request_id: str = "",
    planner_information_needs: tuple[RagPlannerInformationNeed, ...] = (),
    projection_context_summaries: tuple[RagProjectionContextSummary, ...] = (),
    retrieval_intent: RetrievalIntent | None = None,
) -> AgentResponse:
    answer_text = _build_version_aware_answer_text(
        user_goal=user_goal,
        evidence=evidence,
        version_answer_context=version_answer_context,
        retrieval_intent=retrieval_intent,
    )
    semantic_outcome = _version_answer_semantic_outcome(version_answer_context.mode)
    return AgentResponse(
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
            request_id=request_id,
            semantic_outcome=semantic_outcome,
            retrieval_adequacy=sufficient_retrieval_adequacy(),
            grounding_verdict="grounded",
            planner_information_needs=planner_information_needs,
            projection_context_summaries=projection_context_summaries,
        ),
    )


def _build_version_aware_answer_text(
    *,
    user_goal: str = "",
    evidence: EvidenceBundle,
    version_answer_context: _VersionAnswerContext,
    retrieval_intent: RetrievalIntent | None = None,
) -> str:
    if version_answer_context.mode == "historical":
        base_answer = RagAgent().compose_answer(
            evidence,
            query_text=user_goal,
            retrieval_intent=retrieval_intent,
        )
        return f"以下内容基于该制度的历史版本（非现行版本）：{base_answer}"
    if version_answer_context.mode == "as_of":
        base_answer = RagAgent().compose_answer(
            evidence,
            query_text=user_goal,
            retrieval_intent=retrieval_intent,
        )
        return (
            f"以下内容基于截至{version_answer_context.as_of}可解析到的版本"
            f"（不代表当前现行规定）：{base_answer}"
        )
    primary_evidence, comparison_evidence = _partition_compare_evidence(
        evidence,
        version_answer_context=version_answer_context,
    )
    primary_answer = RagAgent().compose_answer(
        primary_evidence,
        query_text=user_goal,
        retrieval_intent=retrieval_intent,
    )
    comparison_answer = RagAgent().compose_answer(
        comparison_evidence,
        query_text=user_goal,
        retrieval_intent=retrieval_intent,
    )
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


__all__ = [
    "_build_compare_change_summary",
    "_build_compare_support_incomplete_response",
    "_build_version_aware_answer_text",
    "_build_version_aware_completed_response",
    "_build_version_filter_unresolved_response",
    "_partition_compare_evidence",
    "_version_answer_semantic_outcome",
]
