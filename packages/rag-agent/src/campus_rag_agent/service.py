from __future__ import annotations

from collections.abc import Callable

from campus_contracts import AgentRequest, AgentResponse, ErrorInfo, RagRequestPayload

from campus_rag_agent.confidence import derive_confidence
from campus_rag_agent.prompt_execution import RagPromptExecutor
from campus_rag_agent.remote_content_hardening import apply_remote_content_suspicion_labels

from .service_answer_synthesis import build_grounded_answer_response
from .service_common import _build_empty_evidence
from .service_diagnostics_payload import _build_rag_result_payload
from .service_outcome_context import build_outcome_context
from .service_outcomes import (
    build_empty_retrieval_no_answer_response,
    build_low_confidence_no_answer_response,
    build_no_supporting_evidence_response,
    build_restricted_access_denied_response,
    maybe_build_evidence_clarification_response,
    maybe_build_resolved_policy_clause_fail_closed_response,
)
from .service_pipeline import build_rag_pipeline_context
from .service_preflight import _maybe_return_pre_retrieval_response
from .service_response_text import _resolve_no_answer_semantics
from .service_retrieval import (
    CorpusQueryDisabledError,
    RestrictedDocumentAccessDeniedError,
    RetrievalBackendError,
    build_rag_retrieval_context,
    execute_rag_retrieval_context,
    retrieve_sources,
)
from .service_versioning_evidence import (
    _build_version_aware_supporting_evidence,
    _is_compare_support_incomplete,
)
from .service_versioning_response import (
    _build_compare_support_incomplete_response,
    _build_version_aware_completed_response,
    _build_version_filter_unresolved_response,
)

Retriever = Callable[..., object]


def delegate_to_rag_agent(
    request: AgentRequest,
    *,
    retriever: Retriever = retrieve_sources,
    prompt_executor: RagPromptExecutor | None = None,
) -> AgentResponse:
    if request.target != "rag-agent":
        raise ValueError("delegate_to_rag_agent only accepts target='rag-agent'")
    if not isinstance(request.payload, RagRequestPayload):
        raise TypeError("rag-agent requires RagRequestPayload")
    pipeline = build_rag_pipeline_context(request, prompt_executor=prompt_executor)
    effective_scope = pipeline.effective_scope
    if effective_scope is None:
        return AgentResponse(
            target="rag-agent",
            status="needs_clarification",
            confidence="low",
            follow_up_question="请先说明你想查询的校内知识范围或资料集合。",
        )
    prompt_executor = pipeline.prompt_executor
    user_goal = pipeline.user_goal
    intent_frame = pipeline.intent_frame
    personalization_hint = pipeline.personalization_hint
    effective_user_goal = pipeline.effective_user_goal
    handbook_plan = pipeline.handbook_plan
    curriculum_plan = pipeline.curriculum_plan
    curriculum_course_plan = pipeline.curriculum_course_plan
    curriculum_program_family_plan = pipeline.curriculum_program_family_plan
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

    evidence = _build_empty_evidence(effective_scope, user_goal)
    retrieval_execution_result = None
    try:
        retrieval_context = build_rag_retrieval_context(
            request=request,
            effective_scope=effective_scope,
            user_goal=user_goal,
            effective_user_goal=effective_user_goal,
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
            curriculum_program_family_plan=curriculum_program_family_plan,
        )
        if retrieval_context is None:
            return _build_version_filter_unresolved_response(
                build_rag_result_payload=_build_rag_result_payload,
                build_empty_evidence=_build_empty_evidence,
                request=request,
                resolved_scope=effective_scope,
                user_goal=user_goal,
                handbook_plan=handbook_plan,
                curriculum_plan=curriculum_plan,
                curriculum_course_plan=curriculum_course_plan,
                curriculum_program_family_plan=curriculum_program_family_plan,
            )
        retrieval_result = execute_rag_retrieval_context(
            request=request,
            effective_scope=effective_scope,
            user_goal=user_goal,
            effective_user_goal=effective_user_goal,
            personalization_hint=personalization_hint,
            retriever=retriever,
            retrieval_context=retrieval_context,
        )
        evidence = retrieval_result.evidence
        retrieval_execution_result = retrieval_result.execution_result
    except CorpusQueryDisabledError as exc:
        return AgentResponse(
            target="rag-agent",
            status="error",
            confidence="low",
            result=_build_rag_result_payload(
                evidence=_build_empty_evidence(effective_scope, user_goal),
                retrieved_evidence=evidence,
                retrieval_execution_result=retrieval_execution_result,
                resolved_scope=effective_scope,
                handbook_plan=handbook_plan,
                curriculum_plan=curriculum_plan,
                curriculum_course_plan=curriculum_course_plan,
                curriculum_program_family_plan=curriculum_program_family_plan,
            ),
            error=ErrorInfo(code="corpus_not_query_enabled", message=str(exc), retryable=False),
        )
    except RestrictedDocumentAccessDeniedError:
        return build_restricted_access_denied_response(
            build_outcome_context(
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
            )
        )
    except RetrievalBackendError as exc:
        return AgentResponse(
            target="rag-agent",
            status="error",
            confidence="low",
            result=_build_rag_result_payload(
                evidence=_build_empty_evidence(effective_scope, user_goal),
                retrieved_evidence=evidence,
                retrieval_execution_result=retrieval_execution_result,
                resolved_scope=effective_scope,
                handbook_plan=handbook_plan,
                curriculum_plan=curriculum_plan,
                curriculum_course_plan=curriculum_course_plan,
                curriculum_program_family_plan=curriculum_program_family_plan,
            ),
            error=ErrorInfo(code="retrieval_failed", message=str(exc), retryable=False),
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

    supporting_evidence = _build_version_aware_supporting_evidence(
        evidence,
        version_answer_context=version_answer_context,
        curriculum_plan=curriculum_plan,
        curriculum_course_plan=curriculum_course_plan,
    )
    apply_remote_content_suspicion_labels(supporting_evidence)
    if not supporting_evidence.sources:
        return build_no_supporting_evidence_response(
            outcome_context,
            supporting_evidence=supporting_evidence,
        )

    if _is_compare_support_incomplete(
        supporting_evidence=supporting_evidence,
        version_answer_context=version_answer_context,
    ):
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
        )

    confidence = derive_confidence(supporting_evidence)
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

    if version_answer_context.mode in {"historical", "as_of", "compare"}:
        return _build_version_aware_completed_response(
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
            confidence=confidence,
            version_answer_context=version_answer_context,
        )

    return build_grounded_answer_response(
        request=request,
        resolved_scope=effective_scope,
        user_goal=user_goal,
        evidence=evidence,
        supporting_evidence=supporting_evidence,
        retrieval_execution_result=retrieval_execution_result,
        handbook_plan=handbook_plan,
        curriculum_plan=curriculum_plan,
        curriculum_course_plan=curriculum_course_plan,
        curriculum_program_family_plan=curriculum_program_family_plan,
        confidence=confidence,
        prompt_executor=prompt_executor,
        intent_frame=intent_frame,
    )
