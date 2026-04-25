from __future__ import annotations

from collections.abc import Callable

from campus_contracts import AgentRequest, AgentResponse, ErrorInfo, RagRequestPayload
from campus_ingestion_core import build_document_registry_from_env, resolve_version_query
from campus_retrieval_core import (
    CorpusQueryDisabledError,
    RestrictedDocumentAccessDeniedError,
    RetrievalBackendError,
    retrieve_sources,
)

from campus_rag_agent.confidence import derive_confidence
from campus_rag_agent.intent import build_personalization_hint, frame_rag_intent
from campus_rag_agent.prompt_execution import RagPromptExecutor, wrap_rag_prompt_executor
from campus_rag_agent.remote_content_hardening import apply_remote_content_suspicion_labels
from campus_rag_agent.retrieval_adequacy import (
    ambiguous_retrieval_adequacy,
    insufficient_retrieval_adequacy,
)

from .service_answer_synthesis import build_grounded_answer_response
from .service_common import _build_empty_evidence
from .service_diagnostics import (
    _build_rag_result_payload,
    _empty_evidence_retrieval_adequacy,
)
from .service_preflight import _maybe_return_pre_retrieval_response
from .service_prompting import (
    _build_clarification_question,
    _compose_clarification_response,
    _compose_no_answer_response,
    _retrieval_ambiguity_reason,
    _should_clarify_with_evidence,
    _with_prompt_trace,
)
from .service_response_text import (
    _build_no_answer_response,
    _build_restricted_access_denied_response,
    _resolve_no_answer_semantics,
    _resolved_policy_no_answer_reason,
    _resolved_policy_title,
    _should_fail_closed_resolved_policy_clause,
)
from .service_retrieval import (
    build_rag_retrieval_context,
    execute_rag_retrieval_context,
)
from .service_scope import (
    _plan_curriculum_course_query,
    _plan_curriculum_program_family_query,
    _plan_curriculum_query,
    _plan_handbook_query,
    _resolve_effective_curriculum_user_goal,
    _resolve_request_scope,
)
from .service_versioning import (
    _build_compare_support_incomplete_response,
    _build_version_aware_completed_response,
    _build_version_aware_supporting_evidence,
    _build_version_filter_unresolved_response,
    _is_compare_support_incomplete,
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
    prompt_executor = wrap_rag_prompt_executor(prompt_executor)

    user_goal = request.user_goal.strip()
    intent_frame = frame_rag_intent(request)
    personalization_hint = build_personalization_hint(request)
    effective_scope = _resolve_request_scope(request, user_goal=user_goal)
    if effective_scope is None:
        return AgentResponse(
            target="rag-agent",
            status="needs_clarification",
            confidence="low",
            follow_up_question="请先说明你想查询的校内知识范围或资料集合。",
        )
    effective_user_goal = _resolve_effective_curriculum_user_goal(
        effective_scope,
        user_goal=user_goal,
        curriculum_follow_up=personalization_hint.curriculum_follow_up,
        recent_goal=personalization_hint.recent_goal,
    )
    handbook_plan = _plan_handbook_query(effective_scope, user_goal)
    curriculum_plan = _plan_curriculum_query(request, effective_scope, effective_user_goal)
    curriculum_course_plan = _plan_curriculum_course_query(effective_scope, effective_user_goal)
    curriculum_program_family_plan = _plan_curriculum_program_family_query(
        effective_scope,
        effective_user_goal,
    )
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
            build_document_registry_from_env_fn=build_document_registry_from_env,
            resolve_version_query_fn=resolve_version_query,
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
        empty_evidence = _build_empty_evidence(effective_scope, user_goal)
        return AgentResponse(
            target="rag-agent",
            status="no_answer",
            answer_text=_build_restricted_access_denied_response(request, empty_evidence),
            confidence="low",
            result=_build_rag_result_payload(
                evidence=empty_evidence,
                resolved_scope=effective_scope,
                handbook_plan=handbook_plan,
                curriculum_plan=curriculum_plan,
                curriculum_course_plan=curriculum_course_plan,
                curriculum_program_family_plan=curriculum_program_family_plan,
                no_answer_reason="restricted_access_denied",
                semantic_outcome="restricted_access_denied",
            ),
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
    if not evidence.sources:
        no_answer_reason, semantic_outcome, freshness_fail_closed = _resolve_no_answer_semantics(
            evidence=evidence,
            handbook_plan=handbook_plan,
        )
        (
            answer_text,
            prompt_trace,
            prompt_runtime_state,
            prompt_runtime_detail,
        ) = _compose_no_answer_response(
            request=request,
            resolved_scope=effective_scope,
            evidence=evidence,
            no_answer_reason=no_answer_reason,
            fallback_answer=_build_no_answer_response(
                evidence,
                resolved_policy_title=_resolved_policy_title(handbook_plan),
            ),
            prompt_executor=prompt_executor,
            intent_frame=intent_frame,
        )
        return AgentResponse(
            target="rag-agent",
            status="no_answer",
            answer_text=answer_text,
            confidence="low",
            result=_with_prompt_trace(
                _build_rag_result_payload(
                    evidence=evidence,
                    resolved_scope=effective_scope,
                    handbook_plan=handbook_plan,
                    curriculum_plan=curriculum_plan,
                    curriculum_course_plan=curriculum_course_plan,
                    curriculum_program_family_plan=curriculum_program_family_plan,
                    no_answer_reason=no_answer_reason,
                    semantic_outcome=semantic_outcome,
                    retrieval_adequacy=_empty_evidence_retrieval_adequacy(no_answer_reason),
                    freshness_fail_closed=freshness_fail_closed,
                    prompt_runtime_state=prompt_runtime_state,
                    prompt_runtime_detail=prompt_runtime_detail,
                    retrieval_execution_result=retrieval_execution_result,
                ),
                prompt_trace,
            ),
        )
    if _should_clarify_with_evidence(effective_user_goal, evidence):
        (
            follow_up_question,
            prompt_trace,
            prompt_runtime_state,
            prompt_runtime_detail,
        ) = _compose_clarification_response(
            request=request,
            resolved_scope=effective_scope,
            evidence=evidence,
            fallback_question=_build_clarification_question(
                user_goal,
                evidence,
                recent_goal=personalization_hint.recent_goal,
                confirmed_slot_terms=personalization_hint.confirmed_slot_terms,
                clarification_candidates=curriculum_plan.clarification_candidates
                if curriculum_plan is not None
                else (),
            ),
            prompt_executor=prompt_executor,
            intent_frame=intent_frame,
        )
        return AgentResponse(
            target="rag-agent",
            status="needs_clarification",
            confidence="low",
            follow_up_question=follow_up_question,
            result=_with_prompt_trace(
                _build_rag_result_payload(
                    evidence=evidence,
                    resolved_scope=effective_scope,
                    handbook_plan=handbook_plan,
                    curriculum_plan=curriculum_plan,
                    curriculum_course_plan=curriculum_course_plan,
                    retrieval_adequacy=ambiguous_retrieval_adequacy(
                        _retrieval_ambiguity_reason(effective_user_goal, evidence)
                    ),
                    prompt_runtime_state=prompt_runtime_state,
                    prompt_runtime_detail=prompt_runtime_detail,
                    retrieval_execution_result=retrieval_execution_result,
                ),
                prompt_trace,
            ),
        )

    supporting_evidence = _build_version_aware_supporting_evidence(
        evidence,
        version_answer_context=version_answer_context,
        curriculum_plan=curriculum_plan,
        curriculum_course_plan=curriculum_course_plan,
    )
    apply_remote_content_suspicion_labels(supporting_evidence)
    if not supporting_evidence.sources:
        (
            answer_text,
            prompt_trace,
            prompt_runtime_state,
            prompt_runtime_detail,
        ) = _compose_no_answer_response(
            request=request,
            resolved_scope=effective_scope,
            evidence=supporting_evidence,
            no_answer_reason=_resolved_policy_no_answer_reason(handbook_plan),
            fallback_answer=_build_no_answer_response(
                supporting_evidence,
                resolved_policy_title=_resolved_policy_title(handbook_plan),
            ),
            prompt_executor=prompt_executor,
            intent_frame=intent_frame,
        )
        return AgentResponse(
            target="rag-agent",
            status="no_answer",
            answer_text=answer_text,
            confidence="low",
            result=_with_prompt_trace(
                _build_rag_result_payload(
                    evidence=supporting_evidence,
                    retrieved_evidence=evidence,
                    retrieval_execution_result=retrieval_execution_result,
                    resolved_scope=effective_scope,
                    handbook_plan=handbook_plan,
                    curriculum_plan=curriculum_plan,
                    curriculum_course_plan=curriculum_course_plan,
                    curriculum_program_family_plan=curriculum_program_family_plan,
                    no_answer_reason=_resolved_policy_no_answer_reason(handbook_plan),
                    semantic_outcome="unsupported_by_evidence",
                    retrieval_adequacy=insufficient_retrieval_adequacy("no_supporting_sources"),
                    prompt_runtime_state=prompt_runtime_state,
                    prompt_runtime_detail=prompt_runtime_detail,
                ),
                prompt_trace,
            ),
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
        (
            answer_text,
            prompt_trace,
            prompt_runtime_state,
            prompt_runtime_detail,
        ) = _compose_no_answer_response(
            request=request,
            resolved_scope=effective_scope,
            evidence=supporting_evidence,
            no_answer_reason=_resolved_policy_no_answer_reason(handbook_plan),
            fallback_answer=_build_no_answer_response(
                supporting_evidence,
                resolved_policy_title=_resolved_policy_title(handbook_plan),
            ),
            prompt_executor=prompt_executor,
            intent_frame=intent_frame,
        )
        return AgentResponse(
            target="rag-agent",
            status="no_answer",
            answer_text=answer_text,
            confidence="low",
            result=_with_prompt_trace(
                _build_rag_result_payload(
                    evidence=supporting_evidence,
                    retrieved_evidence=evidence,
                    retrieval_execution_result=retrieval_execution_result,
                    resolved_scope=effective_scope,
                    handbook_plan=handbook_plan,
                    curriculum_plan=curriculum_plan,
                    curriculum_course_plan=curriculum_course_plan,
                    curriculum_program_family_plan=curriculum_program_family_plan,
                    no_answer_reason=_resolved_policy_no_answer_reason(handbook_plan),
                    semantic_outcome="unsupported_by_evidence",
                    retrieval_adequacy=insufficient_retrieval_adequacy("weak_supporting_evidence"),
                    prompt_runtime_state=prompt_runtime_state,
                    prompt_runtime_detail=prompt_runtime_detail,
                ),
                prompt_trace,
            ),
        )
    if _should_fail_closed_resolved_policy_clause(
        user_goal=user_goal,
        evidence=supporting_evidence,
        handbook_plan=handbook_plan,
    ):
        return AgentResponse(
            target="rag-agent",
            status="no_answer",
            answer_text=_build_no_answer_response(
                _build_empty_evidence(effective_scope, user_goal),
                resolved_policy_title=_resolved_policy_title(handbook_plan),
            ),
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
                no_answer_reason=_resolved_policy_no_answer_reason(handbook_plan),
                semantic_outcome="unsupported_by_evidence",
                retrieval_adequacy=insufficient_retrieval_adequacy(
                    "resolved_policy_clause_not_found"
                ),
            ),
        )

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
