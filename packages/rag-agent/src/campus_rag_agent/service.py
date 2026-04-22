from __future__ import annotations

from collections.abc import Callable

from campus_contracts import (
    ErrorInfo,
    EvidenceBundle,
    RagRequestPayload,
    SpecialistRequest,
    SpecialistResponse,
)
from campus_ingestion_core import (
    build_document_registry_from_env,
    load_runtime_profile,
    resolve_version_query,
)
from campus_retrieval_core import (
    CorpusQueryDisabledError,
    RestrictedDocumentAccessDeniedError,
    RetrievalBackendError,
    RetrievalExecutionResult,
    execute_retrieval_plan,
    retrieve_sources,
)
from campus_retrieval_core.curriculum_query_resolution import interpret_curriculum_query
from campus_shared import PromptRuntimeValidationError, classify_prompt_runtime_failure

from campus_rag_agent.agent import RagAgent
from campus_rag_agent.confidence import derive_confidence
from campus_rag_agent.grounding_validation import validate_prompt_answer_grounding
from campus_rag_agent.intent import build_personalization_hint, frame_rag_intent
from campus_rag_agent.prompt_execution import RagPromptExecutor, wrap_rag_prompt_executor
from campus_rag_agent.prompt_packets import build_rag_answer_prompt_packet
from campus_rag_agent.remote_content_hardening import (
    apply_remote_content_suspicion_labels,
    build_remote_content_suspicion_summary,
    should_block_remote_content_generation,
)
from campus_rag_agent.retrieval_adequacy import (
    ambiguous_retrieval_adequacy,
    insufficient_retrieval_adequacy,
    sufficient_retrieval_adequacy,
)
from campus_rag_agent.retrieval_plan import build_ordered_retrieval_plan

from .service_common import (
    _build_empty_evidence,
    _execute_retrieval_request_with_legacy_retriever,
    _with_query_text,
)
from .service_curriculum import (
    _build_curriculum_course_answer,
    _build_curriculum_program_family_answer,
    _resolve_curriculum_course_fact_target_document_ids,
)
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
    _should_keep_deterministic_completed_answer,
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
from .service_scope import (
    _plan_curriculum_course_query,
    _plan_curriculum_program_family_query,
    _plan_curriculum_query,
    _plan_handbook_query,
    _resolve_curriculum_program_semester_fact_target_document_ids,
    _resolve_effective_curriculum_user_goal,
    _resolve_request_scope,
    _should_use_curriculum_program_semester_facts,
)
from .service_versioning import (
    _build_compare_support_incomplete_response,
    _build_version_aware_completed_response,
    _build_version_aware_supporting_evidence,
    _build_version_filter_unresolved_response,
    _is_compare_support_incomplete,
    _resolve_retrieval_query_mode,
    _resolve_version_answer_context,
    _VersionAnswerContext,
)

Retriever = Callable[..., object]
_COURSE_FAMILY_SCHEDULE_TOP_K = 8


def delegate_to_rag_agent(
    request: SpecialistRequest,
    *,
    retriever: Retriever = retrieve_sources,
    prompt_executor: RagPromptExecutor | None = None,
) -> SpecialistResponse:
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
        return SpecialistResponse(
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
    retrieval_execution_result: RetrievalExecutionResult | None = None
    try:
        retrieval_goal = user_goal
        target_document_ids: tuple[str, ...] = ()
        preferred_document_ids: tuple[str, ...] = ()
        retrieval_collection = effective_scope.collection
        canonical_course_ids: tuple[str, ...] = ()
        canonical_course_family_ids: tuple[str, ...] = ()
        canonical_program_family_ids: tuple[str, ...] = ()
        retrieval_top_k: int | None = None
        version_answer_context = _VersionAnswerContext()
        if (
            effective_scope.corpus == "curriculum"
            and effective_scope.collection == "curriculum_plan"
        ):
            if (
                curriculum_program_family_plan is not None
                and curriculum_program_family_plan.resolution_mode == "resolved_family"
            ):
                retrieval_collection = curriculum_program_family_plan.internal_collection
                canonical_program_family_ids = (
                    curriculum_program_family_plan.canonical_program_family_id,
                )
            elif curriculum_course_plan is not None:
                retrieval_collection = curriculum_course_plan.internal_collection
                target_document_ids = _resolve_curriculum_course_fact_target_document_ids(
                    curriculum_course_plan
                )
                canonical_course_ids = (
                    (curriculum_course_plan.canonical_course_id,)
                    if curriculum_course_plan.canonical_course_id
                    else ()
                )
                canonical_course_family_ids = (
                    (curriculum_course_plan.canonical_course_family_id,)
                    if (
                        curriculum_course_plan.entity_type == "course_family"
                        and curriculum_course_plan.canonical_course_family_id
                    )
                    else ()
                )
                if (
                    curriculum_course_plan.entity_type == "course_family"
                    and curriculum_course_plan.fact_intent == "schedule"
                ):
                    retrieval_top_k = _COURSE_FAMILY_SCHEDULE_TOP_K
            elif _should_use_curriculum_program_semester_facts(
                curriculum_plan=curriculum_plan,
                user_goal=effective_user_goal,
            ):
                retrieval_collection = "program_semester_facts"
                retrieval_goal = curriculum_plan.rewritten_query_text
                target_document_ids = _resolve_curriculum_program_semester_fact_target_document_ids(
                    curriculum_plan=curriculum_plan,
                    user_goal=effective_user_goal,
                )
            elif curriculum_plan is not None and curriculum_plan.status in {
                "resolved",
                "soft_preference",
            }:
                retrieval_goal = curriculum_plan.rewritten_query_text
                target_document_ids = curriculum_plan.target_document_ids
                preferred_document_ids = curriculum_plan.preferred_document_ids
            else:
                retrieval_goal = interpret_curriculum_query(
                    effective_user_goal
                ).normalized_query_text
        elif handbook_plan is not None and handbook_plan.status == "resolved":
            retrieval_goal = handbook_plan.rewritten_query_text
            target_document_ids = handbook_plan.target_document_ids
        version_answer_context = _resolve_version_answer_context(
            request=request,
            resolved_scope=effective_scope,
            retrieval_collection=retrieval_collection,
            target_document_ids=target_document_ids,
            build_document_registry_from_env_fn=build_document_registry_from_env,
            resolve_version_query_fn=resolve_version_query,
        )
        if version_answer_context is None:
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
        runtime_profile = load_runtime_profile(effective_scope.corpus, retrieval_collection)
        retrieval_query_mode = _resolve_retrieval_query_mode(
            resolved_scope=effective_scope,
            retrieval_collection=retrieval_collection,
            user_goal=user_goal,
            version_mode=version_answer_context.mode,
        )
        retrieval_plan = build_ordered_retrieval_plan(
            query_text=retrieval_goal,
            scope=effective_scope,
            retrieval_collection=retrieval_collection,
            query_mode=retrieval_query_mode,
            target_document_ids=target_document_ids,
            target_version_ids=version_answer_context.target_version_ids,
            target_revision_track=version_answer_context.target_revision_track,
            preferred_document_ids=preferred_document_ids,
            canonical_course_ids=canonical_course_ids,
            canonical_course_family_ids=canonical_course_family_ids,
            canonical_program_family_ids=canonical_program_family_ids,
            top_k=retrieval_top_k or runtime_profile.retrieval_top_k,
            version_query=request.payload.version_query,
            primary_version_id=version_answer_context.primary_version_id,
            comparison_version_id=version_answer_context.comparison_version_id,
            allow_live_source_lookup=runtime_profile.live_search_fallback_allowed,
        )
        retrieval_execution_result = execute_retrieval_plan(
            retrieval_plan,
            authorized_filter=request.context.authorization.retrieval_filter,
            personalization_hint=personalization_hint,
            retrieve_step=lambda retrieval_request: (
                _execute_retrieval_request_with_legacy_retriever(
                    retriever,
                    retrieval_request,
                )
            ),
        )
        evidence = retrieval_execution_result.merged_evidence
        evidence = _with_query_text(
            evidence,
            effective_user_goal
            if effective_scope.corpus == "curriculum"
            and effective_scope.collection == "curriculum_plan"
            else user_goal,
        )
        apply_remote_content_suspicion_labels(evidence)
    except CorpusQueryDisabledError as exc:
        return SpecialistResponse(
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
        return SpecialistResponse(
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
        return SpecialistResponse(
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
        return SpecialistResponse(
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
        return SpecialistResponse(
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
        return SpecialistResponse(
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
        return SpecialistResponse(
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
        return SpecialistResponse(
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

    should_use_prompt_answer = False
    prompt_trace = None
    prompt_runtime_state = ""
    prompt_runtime_detail = ""
    remote_content_suspicion_summary = None
    if curriculum_program_family_plan is not None:
        answer_text = _build_curriculum_program_family_answer(
            evidence=supporting_evidence,
            plan=curriculum_program_family_plan,
        )
        finalized_evidence = supporting_evidence
    elif curriculum_course_plan is not None:
        answer_text = _build_curriculum_course_answer(
            evidence=supporting_evidence,
            plan=curriculum_course_plan,
        )
        finalized_evidence = supporting_evidence
    else:
        agent = RagAgent()
        answer_draft = agent.build_answer(supporting_evidence)
        finalized_evidence = EvidenceBundle(
            query_text=supporting_evidence.query_text,
            corpus=supporting_evidence.corpus,
            collection=supporting_evidence.collection,
            sources=answer_draft.supporting_sources,
        )
        apply_remote_content_suspicion_labels(finalized_evidence)
        remote_content_generation_blocked = should_block_remote_content_generation(
            finalized_evidence
        )
        remote_content_suspicion_summary = build_remote_content_suspicion_summary(
            finalized_evidence,
            generation_blocked=remote_content_generation_blocked,
        )
        if remote_content_generation_blocked:
            (
                blocked_answer_text,
                blocked_prompt_trace,
                blocked_prompt_runtime_state,
                blocked_prompt_runtime_detail,
            ) = _compose_no_answer_response(
                request=request,
                resolved_scope=effective_scope,
                evidence=finalized_evidence,
                no_answer_reason="remote_content_suspicion_blocked",
                fallback_answer=_build_no_answer_response(
                    finalized_evidence,
                    resolved_policy_title=_resolved_policy_title(handbook_plan),
                ),
                prompt_executor=prompt_executor,
                intent_frame=intent_frame,
            )
            return SpecialistResponse(
                target="rag-agent",
                status="no_answer",
                answer_text=blocked_answer_text,
                confidence="low",
                result=_with_prompt_trace(
                    _build_rag_result_payload(
                        evidence=finalized_evidence,
                        retrieved_evidence=evidence,
                        retrieval_execution_result=retrieval_execution_result,
                        resolved_scope=effective_scope,
                        handbook_plan=handbook_plan,
                        curriculum_plan=curriculum_plan,
                        curriculum_course_plan=curriculum_course_plan,
                        curriculum_program_family_plan=curriculum_program_family_plan,
                        no_answer_reason="remote_content_suspicion_blocked",
                        semantic_outcome="unsupported_by_evidence",
                        retrieval_adequacy=sufficient_retrieval_adequacy(),
                        remote_content_suspicion_summary=remote_content_suspicion_summary,
                        prompt_runtime_state=blocked_prompt_runtime_state,
                        prompt_runtime_detail=blocked_prompt_runtime_detail,
                    ),
                    blocked_prompt_trace,
                ),
            )
        answer_text = answer_draft.answer_text
        should_attempt_prompt_answer = (
            prompt_executor is not None
            and not _should_keep_deterministic_completed_answer(
                resolved_scope=effective_scope,
                intent_frame=intent_frame,
                user_goal=user_goal,
                evidence=finalized_evidence,
            )
        )
        if should_attempt_prompt_answer:
            try:
                execution = prompt_executor.compose_answer(
                    build_rag_answer_prompt_packet(
                        request,
                        resolved_scope=effective_scope,
                        evidence=finalized_evidence,
                        intent_frame=intent_frame,
                    )
                )
            except PromptRuntimeValidationError as exc:
                prompt_runtime_state, prompt_runtime_detail = classify_prompt_runtime_failure(exc)
                execution = None
            if execution is not None:
                should_use_prompt_answer = True
                answer_text = execution.output.answer_text
                prompt_trace = execution.prompt_trace
                grounding = validate_prompt_answer_grounding(
                    answer_text=answer_text,
                    evidence=finalized_evidence,
                    provider_grounding_supports=execution.provider_grounding_supports,
                )
                if grounding.verdict != "grounded":
                    (
                        downgraded_answer_text,
                        downgraded_prompt_trace,
                        downgraded_prompt_runtime_state,
                        downgraded_prompt_runtime_detail,
                    ) = _compose_no_answer_response(
                        request=request,
                        resolved_scope=effective_scope,
                        evidence=finalized_evidence,
                        no_answer_reason="insufficient_grounding",
                        fallback_answer=_build_no_answer_response(
                            finalized_evidence,
                            resolved_policy_title=_resolved_policy_title(handbook_plan),
                        ),
                        prompt_executor=prompt_executor,
                        intent_frame=intent_frame,
                    )
                    return SpecialistResponse(
                        target="rag-agent",
                        status="no_answer",
                        answer_text=downgraded_answer_text,
                        confidence="low",
                        result=_with_prompt_trace(
                            _build_rag_result_payload(
                                evidence=finalized_evidence,
                                retrieved_evidence=evidence,
                                retrieval_execution_result=retrieval_execution_result,
                                resolved_scope=effective_scope,
                                handbook_plan=handbook_plan,
                                curriculum_plan=curriculum_plan,
                                curriculum_course_plan=curriculum_course_plan,
                                curriculum_program_family_plan=curriculum_program_family_plan,
                                no_answer_reason="insufficient_grounding",
                                semantic_outcome="unsupported_by_evidence",
                                retrieval_adequacy=sufficient_retrieval_adequacy(),
                                claim_supports=grounding.claim_supports,
                                unsupported_fields=grounding.unsupported_fields,
                                grounding_verdict=grounding.verdict,
                                grounding_downgraded=True,
                                remote_content_suspicion_summary=remote_content_suspicion_summary,
                                source_trust_summary=grounding.source_trust_summary,
                                prompt_runtime_state=downgraded_prompt_runtime_state,
                                prompt_runtime_detail=downgraded_prompt_runtime_detail,
                            ),
                            downgraded_prompt_trace,
                        ),
                    )
    return SpecialistResponse(
        target="rag-agent",
        status="completed",
        answer_text=answer_text,
        confidence=confidence,
        result=_with_prompt_trace(
            _build_rag_result_payload(
                evidence=finalized_evidence,
                retrieved_evidence=evidence,
                retrieval_execution_result=retrieval_execution_result,
                resolved_scope=effective_scope,
                handbook_plan=handbook_plan,
                curriculum_plan=curriculum_plan,
                curriculum_course_plan=curriculum_course_plan,
                curriculum_program_family_plan=curriculum_program_family_plan,
                allow_session_follow_up=True,
                semantic_outcome="grounded_answer",
                retrieval_adequacy=sufficient_retrieval_adequacy(),
                claim_supports=grounding.claim_supports if should_use_prompt_answer else (),
                grounding_verdict="grounded",
                remote_content_suspicion_summary=remote_content_suspicion_summary,
                source_trust_summary=(
                    grounding.source_trust_summary if should_use_prompt_answer else None
                ),
                prompt_runtime_state=prompt_runtime_state,
                prompt_runtime_detail=prompt_runtime_detail,
            ),
            (
                prompt_trace
                if should_use_prompt_answer
                and curriculum_program_family_plan is None
                and curriculum_course_plan is None
                else None
            ),
        ),
    )
