from __future__ import annotations

from dataclasses import dataclass

from campus_contracts import (
    CapabilityRequest,
    CapabilityResponse,
    EvidenceBundle,
    KnowledgeScope,
    RagPlannerInformationNeed,
    RagProjectionContextSummary,
)
from campus_retrieval_core import RetrievalPlan

from campus_knowledge_capability.intent import PersonalizationHint, RagIntentFrame
from campus_knowledge_capability.prompt_execution import RagPromptExecutor

from .service_common import _build_empty_evidence
from .service_outcome_context import build_outcome_context
from .service_outcomes import (
    build_corpus_query_disabled_error_response,
    build_restricted_access_denied_response,
    build_retrieval_backend_error_response,
)
from .service_retrieval import (
    CorpusQueryDisabledError,
    RagRetrievalContext,
    RestrictedDocumentAccessDeniedError,
    RetrievalBackendError,
    RetrievalObservationSink,
    Retriever,
    execute_rag_retrieval_context,
)


@dataclass(frozen=True, slots=True)
class RagRetrievalStageResult:
    response: CapabilityResponse | None
    evidence: EvidenceBundle
    retrieval_context: object | None
    retrieval_execution_result: object | None


def execute_rag_retrieval_stage(
    *,
    request: CapabilityRequest,
    effective_scope: KnowledgeScope,
    user_goal: str,
    personalization_hint: PersonalizationHint,
    intent_frame: RagIntentFrame,
    prompt_executor: RagPromptExecutor | None,
    retrieval_context: RagRetrievalContext,
    retrieval_plan: RetrievalPlan,
    handbook_plan,
    curriculum_plan,
    curriculum_course_plan,
    curriculum_program_family_plan,
    retriever: Retriever,
    retrieval_observation_sink: RetrievalObservationSink | None,
    include_retrieval_observation_query_text: bool,
    planner_information_needs: tuple[RagPlannerInformationNeed, ...] = (),
    projection_context_summaries: tuple[RagProjectionContextSummary, ...] = (),
) -> RagRetrievalStageResult:
    evidence = _build_empty_evidence(effective_scope, user_goal)
    retrieval_execution_result = None
    try:
        retrieval_result = execute_rag_retrieval_context(
            request=request,
            personalization_hint=personalization_hint,
            retriever=retriever,
            retrieval_plan=retrieval_plan,
            retrieval_observation_sink=retrieval_observation_sink,
            include_retrieval_observation_query_text=include_retrieval_observation_query_text,
        )
        return RagRetrievalStageResult(
            response=None,
            evidence=retrieval_result.evidence,
            retrieval_context=retrieval_context,
            retrieval_execution_result=retrieval_result.execution_result,
        )
    except CorpusQueryDisabledError as exc:
        response = build_corpus_query_disabled_error_response(
            _outcome_context(
                request=request,
                effective_scope=effective_scope,
                user_goal=user_goal,
                personalization_hint=personalization_hint,
                intent_frame=intent_frame,
                prompt_executor=prompt_executor,
                handbook_plan=handbook_plan,
                curriculum_plan=curriculum_plan,
                curriculum_course_plan=curriculum_course_plan,
                curriculum_program_family_plan=curriculum_program_family_plan,
                evidence=evidence,
                retrieval_execution_result=retrieval_execution_result,
                planner_information_needs=planner_information_needs,
                projection_context_summaries=projection_context_summaries,
            ),
            message=str(exc),
        )
    except RestrictedDocumentAccessDeniedError:
        response = build_restricted_access_denied_response(
            _outcome_context(
                request=request,
                effective_scope=effective_scope,
                user_goal=user_goal,
                personalization_hint=personalization_hint,
                intent_frame=intent_frame,
                prompt_executor=prompt_executor,
                handbook_plan=handbook_plan,
                curriculum_plan=curriculum_plan,
                curriculum_course_plan=curriculum_course_plan,
                curriculum_program_family_plan=curriculum_program_family_plan,
                evidence=evidence,
                retrieval_execution_result=retrieval_execution_result,
                planner_information_needs=planner_information_needs,
                projection_context_summaries=projection_context_summaries,
            )
        )
    except RetrievalBackendError as exc:
        response = build_retrieval_backend_error_response(
            _outcome_context(
                request=request,
                effective_scope=effective_scope,
                user_goal=user_goal,
                personalization_hint=personalization_hint,
                intent_frame=intent_frame,
                prompt_executor=prompt_executor,
                handbook_plan=handbook_plan,
                curriculum_plan=curriculum_plan,
                curriculum_course_plan=curriculum_course_plan,
                curriculum_program_family_plan=curriculum_program_family_plan,
                evidence=evidence,
                retrieval_execution_result=retrieval_execution_result,
                planner_information_needs=planner_information_needs,
                projection_context_summaries=projection_context_summaries,
            ),
            message=str(exc),
        )
    return RagRetrievalStageResult(
        response=response,
        evidence=evidence,
        retrieval_context=retrieval_context,
        retrieval_execution_result=retrieval_execution_result,
    )


def _outcome_context(
    *,
    request: CapabilityRequest,
    effective_scope: KnowledgeScope,
    user_goal: str,
    personalization_hint: PersonalizationHint,
    intent_frame: RagIntentFrame,
    prompt_executor: RagPromptExecutor | None,
    handbook_plan,
    curriculum_plan,
    curriculum_course_plan,
    curriculum_program_family_plan,
    evidence: EvidenceBundle,
    retrieval_execution_result: object | None,
    planner_information_needs=(),
    projection_context_summaries=(),
):
    return build_outcome_context(
        request=request,
        effective_scope=effective_scope,
        user_goal=user_goal,
        personalization_hint=personalization_hint,
        intent_frame=intent_frame,
        prompt_executor=prompt_executor,
        handbook_plan=handbook_plan,
        curriculum_plan=curriculum_plan,
        curriculum_course_plan=curriculum_course_plan,
        curriculum_program_family_plan=curriculum_program_family_plan,
        evidence=evidence,
        retrieval_execution_result=retrieval_execution_result,
        planner_information_needs=planner_information_needs,
        projection_context_summaries=projection_context_summaries,
    )


__all__ = [
    "RagRetrievalStageResult",
    "execute_rag_retrieval_stage",
]
