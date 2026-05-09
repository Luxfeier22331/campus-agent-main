from __future__ import annotations

from collections.abc import Callable

from campus_contracts import AgentRequest, AgentResponse, RagRequestPayload

from campus_rag_agent.prompt_execution import RagPromptExecutor

from .service_answer_synthesis import (
    _RAG_SDK_RUNNER_NOT_PROVIDED,
    RagSdkRunner,
    build_required_rag_sdk_response,
)
from .service_diagnostics_payload import (
    _build_rag_result_payload,
    build_projection_context_summaries_from_request,
)
from .service_evidence_stage import execute_rag_evidence_selection_stage
from .service_observability import with_rag_agent_observability
from .service_outcome_context import build_outcome_context
from .service_outcomes import (
    build_empty_retrieval_no_answer_response,
    build_low_confidence_no_answer_response,
    build_missing_scope_clarification_response,
    build_no_supporting_evidence_response,
    maybe_build_evidence_clarification_response,
    maybe_build_resolved_policy_clause_fail_closed_response,
)
from .service_pipeline import build_rag_pipeline_context
from .service_planner_stage import execute_rag_planner_stage
from .service_preflight import _maybe_return_pre_retrieval_response
from .service_response_text import _resolve_no_answer_semantics
from .service_retrieval import retrieve_sources
from .service_retrieval_stage import execute_rag_retrieval_stage
from .service_versioning_response import _build_compare_support_incomplete_response
from .workflow_projection_grounding import (
    build_workflow_projection_completed_response,
    mark_workflow_projection_summaries_as_grounding_evidence,
    maybe_build_unscoped_workflow_projection_response,
    maybe_build_workflow_projection_evidence,
)

Retriever = Callable[..., object]
RetrievalObservationSink = Callable[[dict[str, object]], None]

def delegate_to_rag_agent(
    request: AgentRequest,
    *,
    retriever: Retriever = retrieve_sources,
    prompt_executor: RagPromptExecutor | None = None,
    retrieval_observation_sink: RetrievalObservationSink | None = None,
    include_retrieval_observation_query_text: bool = False,
    rag_sdk_runner: RagSdkRunner | None | object = _RAG_SDK_RUNNER_NOT_PROVIDED,
) -> AgentResponse:
    return with_rag_agent_observability(
        _build_rag_agent_response(
            request,
            retriever=retriever,
            prompt_executor=prompt_executor,
            retrieval_observation_sink=retrieval_observation_sink,
            include_retrieval_observation_query_text=include_retrieval_observation_query_text,
            rag_sdk_runner=rag_sdk_runner,
        )
    )


def _build_rag_agent_response(
    request: AgentRequest,
    *,
    retriever: Retriever = retrieve_sources,
    prompt_executor: RagPromptExecutor | None = None,
    retrieval_observation_sink: RetrievalObservationSink | None = None,
    include_retrieval_observation_query_text: bool = False,
    rag_sdk_runner: RagSdkRunner | None | object = _RAG_SDK_RUNNER_NOT_PROVIDED,
) -> AgentResponse:
    if request.target != "rag-agent":
        raise ValueError("delegate_to_rag_agent only accepts target='rag-agent'")
    if not isinstance(request.payload, RagRequestPayload):
        raise TypeError("rag-agent requires RagRequestPayload")
    pipeline = build_rag_pipeline_context(request, prompt_executor=prompt_executor)
    effective_scope = pipeline.effective_scope
    if effective_scope is None:
        workflow_projection_response = maybe_build_unscoped_workflow_projection_response(
            request=request,
            build_rag_result_payload=_build_rag_result_payload,
        )
        if workflow_projection_response is not None:
            return workflow_projection_response
        return build_missing_scope_clarification_response()
    prompt_executor = pipeline.prompt_executor
    user_goal = pipeline.user_goal
    intent_frame = pipeline.intent_frame
    personalization_hint = pipeline.personalization_hint
    effective_user_goal = pipeline.effective_user_goal
    handbook_plan = pipeline.handbook_plan
    institutional_rules_plan = pipeline.institutional_rules_plan
    curriculum_plan = pipeline.curriculum_plan
    curriculum_course_plan = pipeline.curriculum_course_plan
    curriculum_program_family_plan = pipeline.curriculum_program_family_plan
    retrieval_intent = pipeline.retrieval_intent
    pre_retrieval_response = _maybe_return_pre_retrieval_response(
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
    )
    if pre_retrieval_response is not None:
        return pre_retrieval_response

    planner_stage = execute_rag_planner_stage(
        request=request,
        effective_scope=effective_scope,
        user_goal=user_goal,
        effective_user_goal=effective_user_goal,
        handbook_plan=handbook_plan,
        institutional_rules_plan=institutional_rules_plan,
        curriculum_plan=curriculum_plan,
        curriculum_course_plan=curriculum_course_plan,
        curriculum_program_family_plan=curriculum_program_family_plan,
        retrieval_intent=retrieval_intent,
    )
    if planner_stage.response is not None:
        return planner_stage.response
    retrieval_context = planner_stage.retrieval_context
    retrieval_plan = planner_stage.retrieval_plan
    if retrieval_context is None or retrieval_plan is None:
        raise RuntimeError("planner stage completed without retrieval context or plan")
    planner_information_needs = planner_stage.information_needs
    projection_context_summaries = build_projection_context_summaries_from_request(request)

    retrieval_stage = execute_rag_retrieval_stage(
        request=request,
        effective_scope=effective_scope,
        user_goal=user_goal,
        effective_user_goal=effective_user_goal,
        personalization_hint=personalization_hint,
        intent_frame=intent_frame,
        prompt_executor=prompt_executor,
        retrieval_context=retrieval_context,
        retrieval_plan=retrieval_plan,
        handbook_plan=handbook_plan,
        curriculum_plan=curriculum_plan,
        curriculum_course_plan=curriculum_course_plan,
        curriculum_program_family_plan=curriculum_program_family_plan,
        retriever=retriever,
        retrieval_observation_sink=retrieval_observation_sink,
        include_retrieval_observation_query_text=include_retrieval_observation_query_text,
        planner_information_needs=planner_information_needs,
        projection_context_summaries=projection_context_summaries,
    )
    if retrieval_stage.response is not None:
        return retrieval_stage.response
    evidence = retrieval_stage.evidence
    retrieval_execution_result = retrieval_stage.retrieval_execution_result
    projection_evidence = maybe_build_workflow_projection_evidence(
        request=request,
        scope=effective_scope,
        existing_evidence=evidence,
    )
    if projection_evidence is not None:
        evidence = projection_evidence
        retrieval_execution_result = None
        projection_context_summaries = mark_workflow_projection_summaries_as_grounding_evidence(
            projection_context_summaries,
            evidence,
        )

    version_answer_context = retrieval_context.version_answer_context
    outcome_context = build_outcome_context(
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
    if not evidence.sources:
        no_answer_reason, semantic_outcome, freshness_fail_closed = _resolve_no_answer_semantics(
            evidence=evidence,
            handbook_plan=handbook_plan,
        )
        return build_empty_retrieval_no_answer_response(
            outcome_context,
            evidence=evidence,
            no_answer_reason=no_answer_reason,
            semantic_outcome=semantic_outcome,
            freshness_fail_closed=freshness_fail_closed,
        )
    clarification_response = maybe_build_evidence_clarification_response(
        outcome_context,
        effective_user_goal=effective_user_goal,
        evidence=evidence,
    )
    if clarification_response is not None:
        return clarification_response

    evidence_selection_stage = execute_rag_evidence_selection_stage(
        retrieved_evidence=evidence,
        version_answer_context=version_answer_context,
        handbook_plan=handbook_plan,
        curriculum_plan=curriculum_plan,
        curriculum_course_plan=curriculum_course_plan,
        retrieval_execution_result=retrieval_execution_result,
    )
    if evidence_selection_stage.response is not None:
        return evidence_selection_stage.response
    supporting_evidence = evidence_selection_stage.supporting_evidence
    if not supporting_evidence.sources:
        return build_no_supporting_evidence_response(
            outcome_context,
            supporting_evidence=supporting_evidence,
        )

    if evidence_selection_stage.compare_support_incomplete:
        return _build_compare_support_incomplete_response(
            build_rag_result_payload=_build_rag_result_payload,
            resolved_scope=effective_scope,
            user_goal=user_goal,
            evidence=supporting_evidence,
            retrieved_evidence=evidence,
            retrieval_execution_result=retrieval_execution_result,
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
            request_id=request.request_id,
            planner_information_needs=planner_information_needs,
            projection_context_summaries=projection_context_summaries,
        )

    confidence = evidence_selection_stage.confidence
    if confidence == "low":
        if projection_evidence is not None:
            confidence = "medium"
        else:
            return build_low_confidence_no_answer_response(
                outcome_context,
                supporting_evidence=supporting_evidence,
            )
    if projection_evidence is not None:
        return build_workflow_projection_completed_response(
            request=request,
            projection_evidence=projection_evidence,
            retrieved_evidence=evidence,
            retrieval_execution_result=retrieval_execution_result,
            resolved_scope=effective_scope,
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
            confidence=confidence,
            build_rag_result_payload=_build_rag_result_payload,
            planner_information_needs=planner_information_needs,
            projection_context_summaries=projection_context_summaries,
        )
    if confidence == "low":
        return build_low_confidence_no_answer_response(
            outcome_context,
            supporting_evidence=supporting_evidence,
        )
    fail_closed_response = maybe_build_resolved_policy_clause_fail_closed_response(
        outcome_context,
        supporting_evidence=supporting_evidence,
    )
    if fail_closed_response is not None:
        return fail_closed_response

    return build_required_rag_sdk_response(
        request=request,
        resolved_scope=effective_scope,
        user_goal=user_goal,
        supporting_evidence=supporting_evidence,
        retrieved_evidence=evidence,
        retrieval_plan=retrieval_plan,
        retrieval_execution_result=retrieval_execution_result,
        handbook_plan=handbook_plan,
        curriculum_plan=curriculum_plan,
        curriculum_course_plan=curriculum_course_plan,
        curriculum_program_family_plan=curriculum_program_family_plan,
        confidence=confidence,
        intent_frame=intent_frame,
        runner=rag_sdk_runner,
        planner_information_needs=planner_information_needs,
        projection_context_summaries=projection_context_summaries,
        retrieval_intent=retrieval_intent,
    )
