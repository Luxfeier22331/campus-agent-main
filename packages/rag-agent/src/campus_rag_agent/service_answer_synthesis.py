from __future__ import annotations

from campus_contracts import AgentRequest, AgentResponse, EvidenceBundle, KnowledgeScope
from campus_retrieval_core import RetrievalExecutionResult
from campus_shared import PromptRuntimeValidationError, classify_prompt_runtime_failure

from campus_rag_agent.agent import RagAgent
from campus_rag_agent.grounding_validation import validate_prompt_answer_grounding
from campus_rag_agent.intent import RagIntentFrame
from campus_rag_agent.prompt_execution import RagPromptExecutor
from campus_rag_agent.prompt_packets import build_rag_answer_prompt_packet
from campus_rag_agent.remote_content_hardening import (
    apply_remote_content_suspicion_labels,
    build_remote_content_suspicion_summary,
    should_block_remote_content_generation,
)
from campus_rag_agent.retrieval_adequacy import sufficient_retrieval_adequacy

from .service_curriculum import (
    _build_curriculum_course_answer,
    _build_curriculum_program_family_answer,
)
from .service_diagnostics_payload import _build_rag_result_payload
from .service_prompting import (
    _compose_no_answer_response,
    _should_keep_deterministic_completed_answer,
    _with_prompt_trace,
)
from .service_response_text import _build_no_answer_response, _resolved_policy_title


def build_grounded_answer_response(
    *,
    request: AgentRequest,
    resolved_scope: KnowledgeScope,
    user_goal: str,
    evidence: EvidenceBundle,
    supporting_evidence: EvidenceBundle,
    retrieval_execution_result: RetrievalExecutionResult | None,
    handbook_plan,
    curriculum_plan,
    curriculum_course_plan,
    curriculum_program_family_plan,
    confidence: str,
    prompt_executor: RagPromptExecutor | None,
    intent_frame: RagIntentFrame,
) -> AgentResponse:
    should_use_prompt_answer = False
    prompt_trace = None
    prompt_runtime_state = ""
    prompt_runtime_detail = ""
    remote_content_suspicion_summary = None
    grounding = None
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
                resolved_scope=resolved_scope,
                evidence=finalized_evidence,
                no_answer_reason="remote_content_suspicion_blocked",
                fallback_answer=_build_no_answer_response(
                    finalized_evidence,
                    resolved_policy_title=_resolved_policy_title(handbook_plan),
                ),
                prompt_executor=prompt_executor,
                intent_frame=intent_frame,
            )
            return AgentResponse(
                target="rag-agent",
                status="no_answer",
                answer_text=blocked_answer_text,
                confidence="low",
                result=_with_prompt_trace(
                    _build_rag_result_payload(
                        evidence=finalized_evidence,
                        retrieved_evidence=evidence,
                        retrieval_execution_result=retrieval_execution_result,
                        resolved_scope=resolved_scope,
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
                resolved_scope=resolved_scope,
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
                        resolved_scope=resolved_scope,
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
                        resolved_scope=resolved_scope,
                        evidence=finalized_evidence,
                        no_answer_reason="insufficient_grounding",
                        fallback_answer=_build_no_answer_response(
                            finalized_evidence,
                            resolved_policy_title=_resolved_policy_title(handbook_plan),
                        ),
                        prompt_executor=prompt_executor,
                        intent_frame=intent_frame,
                    )
                    return AgentResponse(
                        target="rag-agent",
                        status="no_answer",
                        answer_text=downgraded_answer_text,
                        confidence="low",
                        result=_with_prompt_trace(
                            _build_rag_result_payload(
                                evidence=finalized_evidence,
                                retrieved_evidence=evidence,
                                retrieval_execution_result=retrieval_execution_result,
                                resolved_scope=resolved_scope,
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
    return AgentResponse(
        target="rag-agent",
        status="completed",
        answer_text=answer_text,
        confidence=confidence,
        result=_with_prompt_trace(
            _build_rag_result_payload(
                evidence=finalized_evidence,
                retrieved_evidence=evidence,
                retrieval_execution_result=retrieval_execution_result,
                resolved_scope=resolved_scope,
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
