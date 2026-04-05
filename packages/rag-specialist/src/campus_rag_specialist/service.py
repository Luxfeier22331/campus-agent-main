from __future__ import annotations

from dataclasses import replace
import re
from typing import Callable

from campus_contracts import (
    CurriculumFollowUpSlots,
    ErrorInfo,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagRequestPayload,
    RagResultDiagnostics,
    RagResultPayload,
    SpecialistRequest,
    SpecialistResponse,
)
from campus_retrieval_core import CorpusQueryDisabledError, RetrievalBackendError, retrieve_sources
from campus_retrieval_core import RestrictedDocumentAccessDeniedError
from campus_retrieval_core.curriculum_query_resolution import (
    interpret_curriculum_query,
    matching_curriculum_doc_ids,
)
from campus_retrieval_core.evidence_ranking import query_targets_source_title, select_supporting_evidence_sources

from campus_rag_specialist.agent import DEFAULT_MAX_ANSWER_SOURCES, RagSpecialistAgent
from campus_rag_specialist.confidence import derive_confidence
from campus_rag_specialist.intent import build_personalization_hint, frame_rag_intent
from campus_rag_specialist.prompt_execution import RagPromptExecutor
from campus_rag_specialist.prompt_packets import (
    build_rag_answer_prompt_packet,
    build_rag_clarify_prompt_packet,
    build_rag_no_answer_prompt_packet,
)
from campus_rag_specialist.query_planning import (
    CurriculumCourseQueryPlan,
    CurriculumProgramFamilyQueryPlan,
    CurriculumQueryPlan,
    HandbookQueryPlan,
    course_family_member_titles,
    plan_curriculum_course_query,
    plan_curriculum_program_family_query,
    plan_curriculum_query,
    plan_student_handbook_query,
)


Retriever = Callable[..., object]
_GENERIC_AMBIGUOUS_TOPICS = ("奖学金", "scholarship", "学位", "degree", "规定", "办法", "policy", "流程", "procedure")
_GENERIC_TOPIC_QUALIFIERS = {
    "奖学金": ("国家", "励志", "专业", "专项", "社会", "助学金"),
    "scholarship": ("national", "professional", "special", "grant"),
    "学位": ("学士", "硕士", "博士", "本科"),
    "degree": ("bachelor", "master", "doctoral", "phd"),
}
_WHITESPACE_RE = re.compile(r"\s+")
_QUERY_ASK_CUES = frozenset({"多少", "几年", "怎么", "如何", "安排", "什么", "哪些"})
_UNSUPPORTED_HANDBOOK_CLAUSE_CUE_GROUPS = (
    ("本校", "单位", "作者单位", "署名单位"),
    ("几分", "多少分", "加分", "得分", "分值", "第二作者的分", "拿分", "给分"),
)
_COURSE_FAMILY_SCHEDULE_TOP_K = 8
_COURSE_USER_FACING_LEAD = "根据培养方案和课程教学计划"
_CURRICULUM_SESSION_PROGRAM_FAMILIES = (
    "民族实验班",
    "强基计划",
    "第二学士学位",
)
_CURRICULUM_PROGRAM_TITLE_SUFFIXES = (
    "本科第二学士学位人才培养方案",
    "第二学士学位人才培养方案",
    "本科专业人才培养方案",
    "本科专业培养方案",
    "本科人才培养方案",
    "人才培养方案",
)
_CURRICULUM_SCOPE_CUES = (
    "培养方案",
    "课程教学计划",
    "总学分",
    "毕业要求",
    "学期",
    "什么课",
    "哪些课",
    "课表",
)
_CURRICULUM_FOLLOW_UP_PREFIXES = ("那如果是", "如果是", "那如果", "那就", "换成", "还有", "那")
_CURRICULUM_FOLLOW_UP_TRAILING_PARTICLES = "呢呀啊吧嘛的"
_CURRICULUM_FOLLOW_UP_PROGRAM_BLOCKERS = frozenset(
    {
        "培养方案",
        "课程教学计划",
        "第",
        "学期",
        "课程",
        "课表",
        "什么",
        "哪些",
        "多少",
        "几年",
        "怎么",
        "如何",
        "学院",
        "专业要上",
    }
)


def delegate_to_rag_agent(
    request: SpecialistRequest,
    *,
    retriever: Callable[..., object] = retrieve_sources,
    prompt_executor: RagPromptExecutor | None = None,
) -> SpecialistResponse:
    if request.target != "rag-specialist":
        raise ValueError("delegate_to_rag_agent only accepts target='rag-specialist'")
    if not isinstance(request.payload, RagRequestPayload):
        raise TypeError("rag-specialist requires RagRequestPayload")

    user_goal = request.user_goal.strip()
    intent_frame = frame_rag_intent(request)
    personalization_hint = build_personalization_hint(request)
    effective_scope = _resolve_request_scope(request, user_goal=user_goal)
    if effective_scope is None:
        return SpecialistResponse(
            target="rag-specialist",
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
    if intent_frame.response_mode == "clarify" and not _has_resolved_query_plan(
        handbook_plan=handbook_plan,
        curriculum_plan=curriculum_plan,
        curriculum_program_family_plan=curriculum_program_family_plan,
    ):
        empty_evidence = _build_empty_evidence(effective_scope, user_goal)
        follow_up_question, prompt_trace = _compose_clarification_response(
            request=request,
            resolved_scope=effective_scope,
            evidence=empty_evidence,
            fallback_question=_build_clarification_question(
                user_goal,
                empty_evidence,
                recent_goal=personalization_hint.recent_goal,
                confirmed_slot_terms=personalization_hint.confirmed_slot_terms,
            ),
            prompt_executor=prompt_executor,
            intent_frame=intent_frame,
        )
        return SpecialistResponse(
            target="rag-specialist",
            status="needs_clarification",
            confidence="low",
            follow_up_question=follow_up_question,
            result=_with_prompt_trace(
                _build_rag_result_payload(
                    evidence=empty_evidence,
                    resolved_scope=effective_scope,
                    handbook_plan=handbook_plan,
                    curriculum_plan=curriculum_plan,
                    curriculum_course_plan=curriculum_course_plan,
                    curriculum_program_family_plan=curriculum_program_family_plan,
                ),
                prompt_trace,
            ),
        )
    if handbook_plan is not None and handbook_plan.status == "needs_clarification":
        empty_evidence = _build_empty_evidence(effective_scope, user_goal)
        follow_up_question, prompt_trace = _compose_clarification_response(
            request=request,
            resolved_scope=effective_scope,
            evidence=empty_evidence,
            fallback_question=_build_clarification_question(
                user_goal,
                empty_evidence,
                recent_goal=personalization_hint.recent_goal,
                confirmed_slot_terms=personalization_hint.confirmed_slot_terms,
                clarification_reason=handbook_plan.clarification_reason,
            ),
            prompt_executor=prompt_executor,
            intent_frame=intent_frame,
        )
        return SpecialistResponse(
            target="rag-specialist",
            status="needs_clarification",
            confidence="low",
            follow_up_question=follow_up_question,
            result=_with_prompt_trace(
                _build_rag_result_payload(
                    evidence=empty_evidence,
                    resolved_scope=effective_scope,
                    handbook_plan=handbook_plan,
                    curriculum_plan=curriculum_plan,
                    curriculum_course_plan=curriculum_course_plan,
                    curriculum_program_family_plan=curriculum_program_family_plan,
                ),
                prompt_trace,
            ),
        )
    if (
        curriculum_program_family_plan is not None
        and curriculum_program_family_plan.resolution_mode == "needs_clarification"
    ):
        empty_evidence = _build_empty_evidence(effective_scope, user_goal)
        follow_up_question, prompt_trace = _compose_clarification_response(
            request=request,
            resolved_scope=effective_scope,
            evidence=empty_evidence,
            fallback_question=_build_clarification_question(
                user_goal,
                empty_evidence,
                recent_goal=personalization_hint.recent_goal,
                confirmed_slot_terms=personalization_hint.confirmed_slot_terms,
                clarification_reason=curriculum_program_family_plan.clarification_reason,
                clarification_candidates=curriculum_program_family_plan.clarification_candidates,
            ),
            prompt_executor=prompt_executor,
            intent_frame=intent_frame,
        )
        return SpecialistResponse(
            target="rag-specialist",
            status="needs_clarification",
            confidence="low",
            follow_up_question=follow_up_question,
            result=_with_prompt_trace(
                _build_rag_result_payload(
                    evidence=empty_evidence,
                    resolved_scope=effective_scope,
                    handbook_plan=handbook_plan,
                    curriculum_plan=curriculum_plan,
                    curriculum_course_plan=curriculum_course_plan,
                    curriculum_program_family_plan=curriculum_program_family_plan,
                ),
                prompt_trace,
            ),
        )
    if (
        curriculum_program_family_plan is None
        and curriculum_plan is not None
        and curriculum_plan.status == "needs_clarification"
    ):
        empty_evidence = _build_empty_evidence(effective_scope, user_goal)
        follow_up_question, prompt_trace = _compose_clarification_response(
            request=request,
            resolved_scope=effective_scope,
            evidence=empty_evidence,
            fallback_question=_build_clarification_question(
                user_goal,
                empty_evidence,
                recent_goal=personalization_hint.recent_goal,
                confirmed_slot_terms=personalization_hint.confirmed_slot_terms,
                clarification_reason=curriculum_plan.clarification_reason,
                clarification_candidates=curriculum_plan.clarification_candidates,
            ),
            prompt_executor=prompt_executor,
            intent_frame=intent_frame,
        )
        return SpecialistResponse(
            target="rag-specialist",
            status="needs_clarification",
            confidence="low",
            follow_up_question=follow_up_question,
            result=_with_prompt_trace(
                _build_rag_result_payload(
                    evidence=empty_evidence,
                    resolved_scope=effective_scope,
                    handbook_plan=handbook_plan,
                    curriculum_plan=curriculum_plan,
                    curriculum_course_plan=curriculum_course_plan,
                    curriculum_program_family_plan=curriculum_program_family_plan,
                ),
                prompt_trace,
            ),
        )

    try:
        retrieval_goal = user_goal
        target_document_ids: tuple[str, ...] = ()
        preferred_document_ids: tuple[str, ...] = ()
        retrieval_collection = effective_scope.collection
        canonical_course_ids: tuple[str, ...] = ()
        canonical_course_family_ids: tuple[str, ...] = ()
        canonical_program_family_ids: tuple[str, ...] = ()
        retrieval_top_k: int | None = None
        if effective_scope.corpus == "curriculum" and effective_scope.collection == "curriculum_plan":
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
            elif curriculum_plan is not None and curriculum_plan.status in {"resolved", "soft_preference"}:
                retrieval_goal = curriculum_plan.rewritten_query_text
                target_document_ids = curriculum_plan.target_document_ids
                preferred_document_ids = curriculum_plan.preferred_document_ids
            else:
                retrieval_goal = interpret_curriculum_query(effective_user_goal).normalized_query_text
        elif handbook_plan is not None and handbook_plan.status == "resolved":
            retrieval_goal = handbook_plan.rewritten_query_text
            target_document_ids = handbook_plan.target_document_ids
        evidence = retriever(
            retrieval_goal,
            corpus=effective_scope.corpus,
            collection=retrieval_collection,
            target_document_ids=target_document_ids,
            preferred_document_ids=preferred_document_ids,
            canonical_course_ids=canonical_course_ids,
            canonical_course_family_ids=canonical_course_family_ids,
            canonical_program_family_ids=canonical_program_family_ids,
            authorized_filter=request.context.authorization.retrieval_filter,
            personalization_hint=personalization_hint,
            top_k=retrieval_top_k,
        )
        evidence = _with_query_text(
            evidence,
            effective_user_goal
            if effective_scope.corpus == "curriculum" and effective_scope.collection == "curriculum_plan"
            else user_goal,
        )
    except CorpusQueryDisabledError as exc:
        return SpecialistResponse(
            target="rag-specialist",
            status="error",
            confidence="low",
            result=_build_rag_result_payload(
                evidence=_build_empty_evidence(effective_scope, user_goal),
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
            target="rag-specialist",
            status="no_answer",
            answer_text=_build_restricted_access_denied_response(request, empty_evidence),
            confidence="low",
            result=RagResultPayload(
                evidence=empty_evidence,
                diagnostics=RagResultDiagnostics(
                    no_answer_reason="restricted_access_denied",
                    resolved_scope_corpus=effective_scope.corpus,
                    resolved_scope_collection=effective_scope.collection,
                ),
            ),
        )
    except RetrievalBackendError as exc:
        return SpecialistResponse(
            target="rag-specialist",
            status="error",
            confidence="low",
            result=_build_rag_result_payload(
                evidence=_build_empty_evidence(effective_scope, user_goal),
                resolved_scope=effective_scope,
                handbook_plan=handbook_plan,
                curriculum_plan=curriculum_plan,
                curriculum_course_plan=curriculum_course_plan,
            ),
            error=ErrorInfo(code="retrieval_failed", message=str(exc), retryable=False),
        )
    if not evidence.sources:
        answer_text, prompt_trace = _compose_no_answer_response(
            request=request,
            resolved_scope=effective_scope,
            evidence=evidence,
            no_answer_reason=_resolved_policy_no_answer_reason(handbook_plan),
            fallback_answer=_build_no_answer_response(
                evidence,
                resolved_policy_title=_resolved_policy_title(handbook_plan),
            ),
            prompt_executor=prompt_executor,
            intent_frame=intent_frame,
        )
        return SpecialistResponse(
            target="rag-specialist",
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
                    no_answer_reason=_resolved_policy_no_answer_reason(handbook_plan),
                ),
                prompt_trace,
            ),
        )
    if _should_clarify_with_evidence(effective_user_goal, evidence):
        follow_up_question, prompt_trace = _compose_clarification_response(
            request=request,
            resolved_scope=effective_scope,
            evidence=evidence,
            fallback_question=_build_clarification_question(
                user_goal,
                evidence,
                recent_goal=personalization_hint.recent_goal,
                confirmed_slot_terms=personalization_hint.confirmed_slot_terms,
                clarification_candidates=curriculum_plan.clarification_candidates if curriculum_plan is not None else (),
            ),
            prompt_executor=prompt_executor,
            intent_frame=intent_frame,
        )
        return SpecialistResponse(
            target="rag-specialist",
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
                ),
                prompt_trace,
            ),
        )

    supporting_evidence = _build_supporting_evidence(
        evidence,
        curriculum_course_plan=curriculum_course_plan,
    )
    if not supporting_evidence.sources:
        answer_text, prompt_trace = _compose_no_answer_response(
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
            target="rag-specialist",
            status="no_answer",
            answer_text=answer_text,
            confidence="low",
            result=_with_prompt_trace(
                _build_rag_result_payload(
                    evidence=supporting_evidence,
                    resolved_scope=effective_scope,
                    handbook_plan=handbook_plan,
                    curriculum_plan=curriculum_plan,
                    curriculum_course_plan=curriculum_course_plan,
                    curriculum_program_family_plan=curriculum_program_family_plan,
                    no_answer_reason=_resolved_policy_no_answer_reason(handbook_plan),
                ),
                prompt_trace,
            ),
        )

    confidence = derive_confidence(supporting_evidence)
    if confidence == "low":
        answer_text, prompt_trace = _compose_no_answer_response(
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
            target="rag-specialist",
            status="no_answer",
            answer_text=answer_text,
            confidence="low",
            result=_with_prompt_trace(
                _build_rag_result_payload(
                    evidence=supporting_evidence,
                    resolved_scope=effective_scope,
                    handbook_plan=handbook_plan,
                    curriculum_plan=curriculum_plan,
                    curriculum_course_plan=curriculum_course_plan,
                    curriculum_program_family_plan=curriculum_program_family_plan,
                    no_answer_reason=_resolved_policy_no_answer_reason(handbook_plan),
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
            target="rag-specialist",
            status="no_answer",
            answer_text=_build_no_answer_response(
                _build_empty_evidence(effective_scope, user_goal),
                resolved_policy_title=_resolved_policy_title(handbook_plan),
            ),
            confidence="low",
            result=_build_rag_result_payload(
                evidence=_build_empty_evidence(effective_scope, user_goal),
                resolved_scope=effective_scope,
                handbook_plan=handbook_plan,
                curriculum_plan=curriculum_plan,
                curriculum_course_plan=curriculum_course_plan,
                curriculum_program_family_plan=curriculum_program_family_plan,
                no_answer_reason=_resolved_policy_no_answer_reason(handbook_plan),
            ),
        )

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
        agent = RagSpecialistAgent()
        answer_draft = agent.build_answer(supporting_evidence)
        finalized_evidence = EvidenceBundle(
            query_text=supporting_evidence.query_text,
            corpus=supporting_evidence.corpus,
            collection=supporting_evidence.collection,
            sources=answer_draft.supporting_sources,
        )
        answer_text = answer_draft.answer_text
        prompt_trace = None
        if prompt_executor is not None:
            execution = prompt_executor.compose_answer(
                build_rag_answer_prompt_packet(
                    request,
                    resolved_scope=effective_scope,
                    evidence=finalized_evidence,
                    intent_frame=intent_frame,
                )
            )
            answer_text = execution.output.answer_text
            prompt_trace = execution.prompt_trace
    return SpecialistResponse(
        target="rag-specialist",
        status="completed",
        answer_text=answer_text,
        confidence=confidence,
        result=_with_prompt_trace(
            _build_rag_result_payload(
                evidence=finalized_evidence,
                resolved_scope=effective_scope,
                handbook_plan=handbook_plan,
                curriculum_plan=curriculum_plan,
                curriculum_course_plan=curriculum_course_plan,
                curriculum_program_family_plan=curriculum_program_family_plan,
                allow_session_follow_up=True,
            ),
            prompt_trace if curriculum_program_family_plan is None and curriculum_course_plan is None else None,
        ),
    )


def _resolve_request_scope(
    request: SpecialistRequest,
    *,
    user_goal: str,
) -> KnowledgeScope | None:
    if request.payload.scope is not None:
        return request.payload.scope

    handbook_plan = plan_student_handbook_query(user_goal)
    curriculum_plan = plan_curriculum_query(
        user_goal,
        verified_major=request.context.actor.major,
    )
    curriculum_course_plan = plan_curriculum_course_query(user_goal)
    curriculum_program_family_plan = plan_curriculum_program_family_query(user_goal)

    has_curriculum_signal = _has_curriculum_scope_signal(
        user_goal=user_goal,
        curriculum_plan=curriculum_plan,
        curriculum_course_plan=curriculum_course_plan,
        curriculum_program_family_plan=curriculum_program_family_plan,
    )
    has_handbook_signal = handbook_plan.status != "pass_through"

    if has_curriculum_signal and not has_handbook_signal:
        return KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
    if has_handbook_signal and not has_curriculum_signal:
        return KnowledgeScope(corpus="regulations", collection="student_handbook")
    if has_curriculum_signal and has_handbook_signal:
        if handbook_plan.status == "resolved":
            return KnowledgeScope(corpus="regulations", collection="student_handbook")
        return KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
    return None


def _has_curriculum_scope_signal(
    *,
    user_goal: str,
    curriculum_plan: CurriculumQueryPlan,
    curriculum_course_plan: CurriculumCourseQueryPlan | None,
    curriculum_program_family_plan: CurriculumProgramFamilyQueryPlan | None,
) -> bool:
    if curriculum_course_plan is not None or curriculum_program_family_plan is not None:
        return True
    if curriculum_plan.status != "pass_through":
        return True
    normalized_goal = _normalize_text(user_goal)
    return any(cue in normalized_goal for cue in _CURRICULUM_SCOPE_CUES)


def _resolve_effective_curriculum_user_goal(
    scope: KnowledgeScope,
    *,
    user_goal: str,
    curriculum_follow_up: CurriculumFollowUpSlots,
    recent_goal: str,
) -> str:
    if scope.corpus != "curriculum" or scope.collection != "curriculum_plan":
        return user_goal
    rewritten_goal = _rewrite_curriculum_follow_up_goal(
        user_goal=user_goal,
        curriculum_follow_up=curriculum_follow_up,
    )
    if rewritten_goal:
        return rewritten_goal
    if not recent_goal.strip():
        return user_goal
    rewritten_goal = _rewrite_curriculum_follow_up_goal_from_recent_goal(
        user_goal=user_goal,
        recent_goal=recent_goal,
    )
    return rewritten_goal or user_goal


def _rewrite_curriculum_follow_up_goal(
    *,
    user_goal: str,
    curriculum_follow_up: CurriculumFollowUpSlots,
) -> str:
    current_interpretation = interpret_curriculum_query(user_goal)
    if current_interpretation.program_query_fragment:
        return ""

    if current_interpretation.semester_labels:
        if curriculum_follow_up.program:
            return f"{curriculum_follow_up.program}培养方案里{current_interpretation.semester_labels[0]}有什么课"
        return ""

    follow_up_program_fragment = _extract_curriculum_follow_up_program_fragment(
        current_interpretation.normalized_query_text,
    )
    if not follow_up_program_fragment or not curriculum_follow_up.program_family:
        return ""
    resolved_program = f"{follow_up_program_fragment}{curriculum_follow_up.program_family}"
    if curriculum_follow_up.semester:
        return f"{resolved_program}培养方案里{curriculum_follow_up.semester}有什么课"
    return f"{resolved_program}培养方案"


def _rewrite_curriculum_follow_up_goal_from_recent_goal(*, user_goal: str, recent_goal: str) -> str:
    recent_interpretation = interpret_curriculum_query(recent_goal)
    if not recent_interpretation.program_query_fragment:
        return ""

    current_interpretation = interpret_curriculum_query(user_goal)
    if current_interpretation.program_query_fragment:
        return ""

    if current_interpretation.semester_labels:
        return _rewrite_curriculum_follow_up_semester_goal(
            recent_goal=recent_interpretation.normalized_query_text,
            recent_program_fragment=recent_interpretation.program_query_fragment,
            recent_semester_labels=recent_interpretation.semester_labels,
            current_semester_label=current_interpretation.semester_labels[0],
            recent_intent_kind=recent_interpretation.intent_kind,
        )

    follow_up_program_fragment = _extract_curriculum_follow_up_program_fragment(
        current_interpretation.normalized_query_text,
    )
    if not follow_up_program_fragment:
        return ""
    return recent_interpretation.normalized_query_text.replace(
        recent_interpretation.program_query_fragment,
        f"{follow_up_program_fragment}{recent_interpretation.program_query_fragment}",
        1,
    )


def _rewrite_curriculum_follow_up_semester_goal(
    *,
    recent_goal: str,
    recent_program_fragment: str,
    recent_semester_labels: tuple[str, ...],
    current_semester_label: str,
    recent_intent_kind: str,
) -> str:
    if recent_semester_labels:
        return recent_goal.replace(recent_semester_labels[0], current_semester_label, 1)
    if recent_intent_kind == "course_list":
        return f"{recent_program_fragment}里{current_semester_label}有什么课"
    return f"{recent_program_fragment} {current_semester_label}".strip()


def _extract_curriculum_follow_up_program_fragment(normalized_query: str) -> str:
    compact_query = _normalize_text(normalized_query)
    if not compact_query:
        return ""
    for prefix in _CURRICULUM_FOLLOW_UP_PREFIXES:
        if compact_query.startswith(prefix):
            compact_query = compact_query[len(prefix):].strip()
            break
    compact_query = compact_query.strip("，,。！？?!.；;：: ")
    while compact_query and compact_query[-1] in _CURRICULUM_FOLLOW_UP_TRAILING_PARTICLES:
        compact_query = compact_query[:-1].strip()
    if not compact_query:
        return ""
    if any(blocker in compact_query for blocker in _CURRICULUM_FOLLOW_UP_PROGRAM_BLOCKERS):
        return ""
    return compact_query


def _build_empty_evidence(scope: KnowledgeScope, user_goal: str) -> EvidenceBundle:
    return EvidenceBundle(
        query_text=user_goal,
        corpus=scope.corpus,
        collection=scope.collection,
    )


def _build_supporting_evidence(
    evidence: EvidenceBundle,
    *,
    curriculum_course_plan: CurriculumCourseQueryPlan | None = None,
) -> EvidenceBundle:
    max_sources = DEFAULT_MAX_ANSWER_SOURCES
    if (
        curriculum_course_plan is not None
        and curriculum_course_plan.entity_type == "course_family"
        and curriculum_course_plan.fact_intent == "schedule"
    ):
        max_sources = _COURSE_FAMILY_SCHEDULE_TOP_K
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


def _compose_clarification_response(
    *,
    request: SpecialistRequest,
    resolved_scope: KnowledgeScope,
    evidence: EvidenceBundle,
    fallback_question: str,
    prompt_executor: RagPromptExecutor | None,
    intent_frame: RagIntentFrame,
) -> tuple[str, object | None]:
    if prompt_executor is None:
        return fallback_question, None
    execution = prompt_executor.compose_clarify(
        build_rag_clarify_prompt_packet(
            request,
            intent_frame=intent_frame,
            resolved_scope=resolved_scope,
        )
    )
    return execution.output.follow_up_question, execution.prompt_trace


def _compose_no_answer_response(
    *,
    request: SpecialistRequest,
    resolved_scope: KnowledgeScope,
    evidence: EvidenceBundle,
    no_answer_reason: str,
    fallback_answer: str,
    prompt_executor: RagPromptExecutor | None,
    intent_frame: RagIntentFrame,
) -> tuple[str, object | None]:
    if prompt_executor is None:
        return fallback_answer, None
    execution = prompt_executor.compose_no_answer(
        build_rag_no_answer_prompt_packet(
            request,
            resolved_scope=resolved_scope,
            evidence=evidence,
            no_answer_reason=no_answer_reason,
            intent_frame=intent_frame,
        )
    )
    return execution.output.answer_text, execution.prompt_trace


def _with_prompt_trace(
    payload: RagResultPayload,
    prompt_trace: object | None,
) -> RagResultPayload:
    if prompt_trace is None:
        return payload
    diagnostics = payload.diagnostics
    if diagnostics is None:
        diagnostics = RagResultDiagnostics(prompt_trace=prompt_trace)
    else:
        diagnostics = replace(diagnostics, prompt_trace=prompt_trace)
    return RagResultPayload(
        evidence=payload.evidence,
        diagnostics=diagnostics,
    )


def _build_no_answer_response(
    evidence: EvidenceBundle,
    *,
    resolved_policy_title: str = "",
) -> str:
    if evidence.corpus == "curriculum" and evidence.collection == "course_facts":
        return "当前未检索到足够依据支持回答这个课程问题，请补充更具体的课程名称、课程类别或修读字段。"
    if evidence.corpus == "curriculum" and evidence.collection == "program_family_facts":
        return "我还不能稳定确认你想问的是哪一类项目班；你可以直接说民族班、基地班，或者补充更具体的班型。"
    if evidence.corpus == "curriculum" and evidence.collection == "curriculum_plan":
        return "当前未检索到足够依据支持回答这个培养方案问题，请补充更具体的培养方案名称、学位要求或课程表名称。"
    if resolved_policy_title:
        return (
            f"在《{resolved_policy_title}》中，当前未检索到足够依据支持回答这个问题；"
            "请确认是否有更具体的条款表述。"
        )
    return "当前未检索到足够依据支持回答这个学生手册问题，请确认它是否属于学生手册范围，或补充更具体的制度名称。"


def _build_restricted_access_denied_response(
    request: SpecialistRequest,
    evidence: EvidenceBundle,
) -> str:
    principal_type = (
        request.context.actor.principal_type.strip()
        or request.actor.principal_type.strip()
    )
    if principal_type == "operator":
        return "当前请求命中了受限内容，但当前 operator 投影无权读取；请检查最小授权投影。"
    if principal_type == "service":
        return "当前 service principal 无权访问该受限内容。"
    if principal_type in {"campus_member", "student", "staff", "faculty"}:
        return "当前身份无权访问该受限内容；如需继续，请确认校内身份与授权范围。"
    return _build_no_answer_response(evidence)


def _with_query_text(evidence: EvidenceBundle, query_text: str) -> EvidenceBundle:
    return EvidenceBundle(
        query_text=query_text,
        corpus=evidence.corpus,
        collection=evidence.collection,
        sources=evidence.sources,
    )


def _should_clarify_with_evidence(user_goal: str, evidence: EvidenceBundle) -> bool:
    if len(evidence.sources) < 2:
        return False
    if evidence.corpus == "curriculum" and evidence.collection == "curriculum_plan":
        interpretation = interpret_curriculum_query(user_goal)
        if interpretation.program_compact_key:
            matching_doc_ids = matching_curriculum_doc_ids(
                query_text=user_goal,
                sources=evidence.sources,
            )
            if len(matching_doc_ids) > 1:
                return True
            if len(matching_doc_ids) == 1:
                return False
    title_targeting_sources = tuple(
        source for source in evidence.sources if query_targets_source_title(query_text=user_goal, source=source)
    )
    if _is_ambiguous_title_fragment_goal(user_goal, title_targeting_sources):
        return True
    if title_targeting_sources:
        return False

    first_source = evidence.sources[0]
    second_source = next(
        (source for source in evidence.sources[1:] if source.doc_id != first_source.doc_id),
        None,
    )
    if second_source is None:
        return False

    normalized_goal = _normalize_text(user_goal).lower()
    if not any(topic in normalized_goal for topic in _GENERIC_AMBIGUOUS_TOPICS):
        return False

    first_label = _source_label(first_source).lower()
    second_label = _source_label(second_source).lower()
    if (first_label and first_label in normalized_goal) or (second_label and second_label in normalized_goal):
        return False

    return abs(first_source.score - second_source.score) <= 0.12


def _is_ambiguous_title_fragment_goal(user_goal: str, sources: tuple[EvidenceSource, ...]) -> bool:
    distinct_source_map: dict[str, EvidenceSource] = {}
    for source in sources:
        distinct_source_map.setdefault(source.doc_id, source)
    distinct_sources = tuple(distinct_source_map.values())
    if len(distinct_sources) < 2:
        return False

    query_key = _match_key(user_goal)
    if not _is_short_title_fragment(query_key):
        return False
    if any(_source_title_matches_exact_query(query_key, source) for source in distinct_sources):
        return False
    return True


def _build_clarification_question(
    user_goal: str,
    evidence: EvidenceBundle,
    *,
    recent_goal: str = "",
    confirmed_slot_terms: tuple[str, ...] = (),
    clarification_reason: str = "",
    clarification_candidates: tuple[str, ...] = (),
) -> str:
    if recent_goal:
        return f"按当前记录理解，你最近在咨询{recent_goal}相关事项；请再具体说明你想确认的政策对象。"
    slot_subject = _clarification_slot_subject(user_goal, confirmed_slot_terms)
    if slot_subject and not clarification_reason:
        return f"按当前对话上下文理解，你现在想确认{slot_subject}相关事项；请再具体说明你想确认的政策对象。"
    if clarification_reason == "policy_object_missing":
        return "请具体说明你想咨询哪一项评审、评定或测评办法。"
    if clarification_reason == "policy_object_conflict":
        if "奖学金" in user_goal or "scholarship" in user_goal.lower():
            return "请说明你想咨询哪一类奖学金或对应的评审办法。"
        return "请具体说明你想咨询哪一项制度；当前问题可能同时对应多个学生手册制度。"
    if clarification_reason.startswith("program_family:"):
        if clarification_candidates:
            return f"你想问哪一种？比如：{'、'.join(clarification_candidates)}。"
        return "你想问哪一种项目班？请再说具体一点。"
    if evidence.corpus == "curriculum" and evidence.collection == "curriculum_plan":
        if clarification_candidates:
            return (
                "请具体说明你想咨询哪一份培养方案。"
                f" 当前更相关的候选包括：{'、'.join(clarification_candidates)}。"
            )
        if clarification_reason == "curriculum_program_family_alias":
            return "请具体说明你想咨询哪一份培养方案；当前问题仍可能对应多个项目班或实验班培养方案。"
        interpretation = interpret_curriculum_query(user_goal)
        if interpretation.program_compact_key:
            return f"请具体说明你想咨询哪一份培养方案；“{user_goal}”当前仍可能对应多个培养方案。"
    if evidence.sources:
        labels: list[str] = []
        for source in evidence.sources:
            label = _source_label(source)
            if label and label not in labels:
                labels.append(label)
            if len(labels) >= 3:
                break
        if labels:
            return f"请说明你想咨询哪一项内容。当前相关结果包括：{'、'.join(labels)}。"
    if "奖学金" in user_goal or "scholarship" in user_goal.lower():
        return "请说明你想咨询哪一类奖学金或对应的评审办法。"
    if evidence.corpus == "curriculum" and evidence.collection == "curriculum_plan":
        return "请具体说明你想咨询哪一份培养方案、哪一类学位要求，或哪一张课程/教学进程表。"
    return "请具体说明你想咨询学生手册中的哪一项制度、流程或表格。"


def _source_label(source: EvidenceSource) -> str:
    snippet = _normalize_text(source.snippet)
    for separator in (" | ", " / "):
        if separator in snippet:
            return snippet.split(separator, 1)[0].strip()
    return snippet.split("。", 1)[0].strip()


def _normalize_text(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", text).strip()


def _clarification_slot_subject(user_goal: str, confirmed_slot_terms: tuple[str, ...]) -> str:
    for slot_term in confirmed_slot_terms:
        normalized_slot_term = _normalize_text(slot_term)
        if not normalized_slot_term:
            continue
        if normalized_slot_term in _normalize_text(user_goal):
            continue
        return normalized_slot_term
    return ""


def _plan_handbook_query(
    scope: KnowledgeScope,
    user_goal: str,
) -> HandbookQueryPlan | None:
    if scope.corpus != "regulations" or scope.collection != "student_handbook":
        return None
    return plan_student_handbook_query(user_goal)


def _plan_curriculum_query(
    request: SpecialistRequest,
    scope: KnowledgeScope,
    user_goal: str,
) -> CurriculumQueryPlan | None:
    if scope.corpus != "curriculum" or scope.collection != "curriculum_plan":
        return None
    return plan_curriculum_query(
        user_goal,
        verified_major=request.context.actor.major,
    )


def _plan_curriculum_course_query(
    scope: KnowledgeScope,
    user_goal: str,
) -> CurriculumCourseQueryPlan | None:
    if scope.corpus != "curriculum" or scope.collection != "curriculum_plan":
        return None
    return plan_curriculum_course_query(user_goal)


def _plan_curriculum_program_family_query(
    scope: KnowledgeScope,
    user_goal: str,
) -> CurriculumProgramFamilyQueryPlan | None:
    if scope.corpus != "curriculum" or scope.collection != "curriculum_plan":
        return None
    return plan_curriculum_program_family_query(user_goal)


def _has_resolved_query_plan(
    *,
    handbook_plan: HandbookQueryPlan | None,
    curriculum_plan: CurriculumQueryPlan | None,
    curriculum_program_family_plan: CurriculumProgramFamilyQueryPlan | None,
) -> bool:
    if handbook_plan is not None and handbook_plan.status == "resolved":
        return True
    if (
        curriculum_program_family_plan is not None
        and curriculum_program_family_plan.resolution_mode == "resolved_family"
    ):
        return True
    return curriculum_plan is not None and curriculum_plan.status == "resolved"


def _resolved_policy_title(handbook_plan: HandbookQueryPlan | None) -> str:
    if handbook_plan is None or handbook_plan.status != "resolved":
        return ""
    return handbook_plan.resolved_policy_title


def _resolved_policy_no_answer_reason(handbook_plan: HandbookQueryPlan | None) -> str:
    if handbook_plan is None or handbook_plan.status != "resolved":
        return ""
    return "resolved_policy_clause_not_found"


def _should_fail_closed_resolved_policy_clause(
    *,
    user_goal: str,
    evidence: EvidenceBundle,
    handbook_plan: HandbookQueryPlan | None,
) -> bool:
    if handbook_plan is None or handbook_plan.status != "resolved":
        return False
    if not evidence.sources:
        return False
    normalized_goal = _normalize_text(user_goal).lower()
    normalized_support = _normalize_text(
        " ".join(
            " ".join(
                fragment
                for fragment in (
                    source.source_title,
                    source.detail_label,
                    source.snippet,
                )
                if fragment
            )
            for source in evidence.sources
        )
    ).lower()
    matched_group_count = 0
    for cue_group in _UNSUPPORTED_HANDBOOK_CLAUSE_CUE_GROUPS:
        if not any(cue in normalized_goal for cue in cue_group):
            continue
        matched_group_count += 1
        if any(cue in normalized_support for cue in cue_group):
            continue
        return True
    return matched_group_count >= 2


def _build_rag_result_payload(
    *,
    evidence: EvidenceBundle,
    resolved_scope: KnowledgeScope | None,
    handbook_plan: HandbookQueryPlan | None,
    curriculum_plan: CurriculumQueryPlan | None = None,
    curriculum_course_plan: CurriculumCourseQueryPlan | None = None,
    curriculum_program_family_plan: CurriculumProgramFamilyQueryPlan | None = None,
    no_answer_reason: str = "",
    allow_session_follow_up: bool = False,
) -> RagResultPayload:
    diagnostics = _build_rag_result_diagnostics(
        evidence=evidence,
        resolved_scope=resolved_scope,
        handbook_plan=handbook_plan,
        curriculum_plan=curriculum_plan,
        curriculum_course_plan=curriculum_course_plan,
        curriculum_program_family_plan=curriculum_program_family_plan,
        no_answer_reason=no_answer_reason,
        allow_session_follow_up=allow_session_follow_up,
    )
    return RagResultPayload(
        evidence=evidence,
        diagnostics=diagnostics,
    )


def _build_rag_result_diagnostics(
    *,
    evidence: EvidenceBundle,
    resolved_scope: KnowledgeScope | None,
    handbook_plan: HandbookQueryPlan | None,
    curriculum_plan: CurriculumQueryPlan | None = None,
    curriculum_course_plan: CurriculumCourseQueryPlan | None = None,
    curriculum_program_family_plan: CurriculumProgramFamilyQueryPlan | None = None,
    no_answer_reason: str = "",
    allow_session_follow_up: bool = False,
) -> RagResultDiagnostics | None:
    if (
        resolved_scope is None
        and handbook_plan is None
        and curriculum_plan is None
        and curriculum_course_plan is None
        and curriculum_program_family_plan is None
    ):
        return None
    if (
        handbook_plan is None
        and curriculum_plan is None
        and curriculum_course_plan is None
        and curriculum_program_family_plan is None
    ):
        return RagResultDiagnostics(
            resolved_scope_corpus=resolved_scope.corpus if resolved_scope is not None else None,
            resolved_scope_collection=resolved_scope.collection if resolved_scope is not None else "",
        )
    if curriculum_program_family_plan is not None:
        return RagResultDiagnostics(
            resolved_scope_corpus=resolved_scope.corpus if resolved_scope is not None else None,
            resolved_scope_collection=resolved_scope.collection if resolved_scope is not None else "",
            no_answer_reason=no_answer_reason,
            clarification_reason=curriculum_program_family_plan.clarification_reason,
            retrieved_title_summary=_summarize_retrieved_titles(evidence),
            candidate_title_summary=curriculum_program_family_plan.clarification_candidates,
            resolution_mode=curriculum_program_family_plan.resolution_mode,
            resolved_entity_type="program_family",
            resolved_program_family_id=curriculum_program_family_plan.canonical_program_family_id,
            resolved_program_family_title=curriculum_program_family_plan.canonical_program_family_title,
        )
    if curriculum_course_plan is not None:
        return RagResultDiagnostics(
            resolved_scope_corpus=resolved_scope.corpus if resolved_scope is not None else None,
            resolved_scope_collection=resolved_scope.collection if resolved_scope is not None else "",
            no_answer_reason=no_answer_reason,
            retrieved_title_summary=_summarize_retrieved_titles(evidence),
            resolution_mode=curriculum_course_plan.resolution_mode,
            resolved_entity_type=curriculum_course_plan.entity_type,
            resolved_course_id=curriculum_course_plan.canonical_course_id,
            resolved_course_title=curriculum_course_plan.canonical_course_title,
            resolved_course_family_id=curriculum_course_plan.canonical_course_family_id,
            resolved_course_family_title=curriculum_course_plan.canonical_course_family_title,
            unsupported_fields=curriculum_course_plan.unsupported_fields,
            partial_answer=curriculum_course_plan.partial_answer,
        )
    if handbook_plan is not None and handbook_plan.status != "pass_through":
        return RagResultDiagnostics(
            resolved_scope_corpus=resolved_scope.corpus if resolved_scope is not None else None,
            resolved_scope_collection=resolved_scope.collection if resolved_scope is not None else "",
            resolved_policy_document_id=handbook_plan.resolved_policy_document_id,
            resolved_policy_title=handbook_plan.resolved_policy_title,
            rewritten_query=(
                handbook_plan.rewritten_query_text if handbook_plan.status == "resolved" else ""
            ),
            clarification_reason=handbook_plan.clarification_reason,
            no_answer_reason=no_answer_reason,
            retrieved_title_summary=_summarize_retrieved_titles(evidence),
        )
    if curriculum_plan is None or curriculum_plan.status == "pass_through":
        return None
    session_follow_up = _resolve_curriculum_diagnostics_follow_up(
        curriculum_plan=curriculum_plan,
        allow_session_follow_up=allow_session_follow_up,
    )
    return RagResultDiagnostics(
        resolved_scope_corpus=resolved_scope.corpus if resolved_scope is not None else None,
        resolved_scope_collection=resolved_scope.collection if resolved_scope is not None else "",
        resolved_policy_document_id=(
            curriculum_plan.target_document_ids[0] if curriculum_plan.target_document_ids else ""
        ),
        resolved_policy_title=(
            curriculum_plan.resolved_document_title if curriculum_plan.status == "resolved" else ""
        ),
        rewritten_query=(
            curriculum_plan.rewritten_query_text
            if curriculum_plan.status in {"resolved", "soft_preference"}
            else ""
        ),
        clarification_reason=curriculum_plan.clarification_reason,
        no_answer_reason=no_answer_reason,
        retrieved_title_summary=_summarize_retrieved_titles(evidence),
        candidate_title_summary=curriculum_plan.candidate_title_summary,
        resolution_mode=_curriculum_resolution_mode(curriculum_plan),
        used_verified_identity=curriculum_plan.used_verified_identity,
        used_soft_preference=curriculum_plan.used_soft_preference,
        session_program_family=session_follow_up.program_family,
        session_program=session_follow_up.program,
        session_semester=session_follow_up.semester,
    )


def _curriculum_resolution_mode(plan: CurriculumQueryPlan) -> str:
    if plan.status == "resolved":
        return "resolved_single"
    if plan.status == "soft_preference":
        return "soft_preference"
    if plan.status == "needs_clarification":
        return "needs_clarification"
    return ""


def _resolve_curriculum_diagnostics_follow_up(
    *,
    curriculum_plan: CurriculumQueryPlan,
    allow_session_follow_up: bool,
) -> CurriculumFollowUpSlots:
    if not allow_session_follow_up or curriculum_plan.status != "resolved":
        return CurriculumFollowUpSlots()
    program_family = _derive_curriculum_session_program_family(curriculum_plan.resolved_document_title)
    semester = _derive_curriculum_session_semester(curriculum_plan.rewritten_query_text)
    program = _derive_curriculum_session_program(
        document_title=curriculum_plan.resolved_document_title,
        program_family=program_family,
    )
    if not program_family or not program or not semester:
        return CurriculumFollowUpSlots()
    return CurriculumFollowUpSlots(
        program_family=program_family,
        program=program,
        semester=semester,
    )


def _derive_curriculum_session_program_family(document_title: str) -> str:
    normalized_title = _normalize_text(document_title)
    for family in _CURRICULUM_SESSION_PROGRAM_FAMILIES:
        if _normalize_text(family) in normalized_title:
            return family
    return ""


def _derive_curriculum_session_program(
    *,
    document_title: str,
    program_family: str,
) -> str:
    core_title = _strip_curriculum_program_title(document_title)
    if not core_title:
        return ""
    if program_family and f"（{program_family}）" in core_title:
        return core_title.replace(f"（{program_family}）", program_family).strip()
    if program_family and f"({program_family})" in core_title:
        return core_title.replace(f"({program_family})", program_family).strip()
    if program_family and program_family not in core_title:
        return f"{core_title}{program_family}".strip()
    return core_title


def _strip_curriculum_program_title(document_title: str) -> str:
    title = document_title.strip()
    for suffix in _CURRICULUM_PROGRAM_TITLE_SUFFIXES:
        if title.endswith(suffix):
            return title[: -len(suffix)].strip()
    return title


def _derive_curriculum_session_semester(rewritten_query: str) -> str:
    interpretation = interpret_curriculum_query(rewritten_query)
    if interpretation.semester_labels:
        return interpretation.semester_labels[0]
    return ""


def _build_curriculum_course_answer(
    *,
    evidence: EvidenceBundle,
    plan: CurriculumCourseQueryPlan,
) -> str:
    if plan.fact_intent == "schedule":
        return _build_curriculum_course_schedule_answer(evidence=evidence, plan=plan)
    snippets = [
        source.snippet.strip().rstrip("。")
        for source in evidence.sources
        if source.snippet.strip()
    ]
    unique_snippets: list[str] = []
    for snippet in snippets:
        if snippet not in unique_snippets:
            unique_snippets.append(snippet)
    body = "；".join(unique_snippets[:3])
    if plan.entity_type == "course":
        lead = f"{_COURSE_USER_FACING_LEAD}，{plan.canonical_course_title}{'：' if body else '。'}"
    else:
        lead = f"{_COURSE_USER_FACING_LEAD}，{plan.canonical_course_family_title}{'：' if body else '。'}"
    answer = f"{lead}{body}" if body else lead
    if plan.partial_answer and "offering_unit" in plan.unsupported_fields:
        return _append_course_partial_answer_suffix(
            answer=answer,
            unsupported_fields=plan.unsupported_fields,
        )
    return answer if answer.endswith("。") else f"{answer}。"


def _build_curriculum_course_schedule_answer(
    *,
    evidence: EvidenceBundle,
    plan: CurriculumCourseQueryPlan,
) -> str:
    snippets = [
        source.snippet.strip().rstrip("。")
        for source in evidence.sources
        if source.snippet.strip()
    ]
    unique_snippets: list[str] = []
    for snippet in snippets:
        if snippet not in unique_snippets:
            unique_snippets.append(snippet)

    if plan.entity_type == "course":
        if unique_snippets:
            answer = f"{_COURSE_USER_FACING_LEAD}，{unique_snippets[0]}。"
            if plan.partial_answer:
                return _append_course_partial_answer_suffix(
                    answer=answer,
                    unsupported_fields=plan.unsupported_fields,
                )
            return answer
        answer = f"当前还不能稳定确认{plan.canonical_course_title}的开设学期。"
        if plan.partial_answer:
            return _append_course_partial_answer_suffix(
                answer=answer,
                unsupported_fields=plan.unsupported_fields,
            )
        return answer

    schedule_by_course: dict[str, str] = {}
    for snippet in unique_snippets:
        if "开设学期：" not in snippet:
            continue
        course_title, semester_text = snippet.split("开设学期：", 1)
        course_title = course_title.strip("：: ")
        semester_text = semester_text.strip()
        if not course_title or not semester_text:
            continue
        schedule_by_course.setdefault(course_title, semester_text)
    schedule_lines = _order_course_family_schedule_lines(
        plan=plan,
        schedule_by_course=schedule_by_course,
    )
    if schedule_lines:
        canonical_titles = course_family_member_titles(plan.canonical_course_family_id)
        is_complete_family_schedule = bool(canonical_titles) and len(schedule_lines) >= len(canonical_titles)
        if is_complete_family_schedule:
            answer = (
                f"{_COURSE_USER_FACING_LEAD}，{plan.canonical_course_family_title}各课程开设学期如下："
                f"{'；'.join(schedule_lines)}。"
            )
        else:
            answer = (
                f"{_COURSE_USER_FACING_LEAD}，{plan.canonical_course_family_title}目前能确认的有："
                f"{'；'.join(schedule_lines)}。"
            )
        if plan.partial_answer:
            return _append_course_partial_answer_suffix(
                answer=answer,
                unsupported_fields=plan.unsupported_fields,
            )
        return answer
    answer = f"当前还不能稳定确认{plan.canonical_course_family_title}的开设学期安排。"
    if plan.partial_answer:
        return _append_course_partial_answer_suffix(
            answer=answer,
            unsupported_fields=plan.unsupported_fields,
        )
    return answer


def _order_course_family_schedule_lines(
    *,
    plan: CurriculumCourseQueryPlan,
    schedule_by_course: dict[str, str],
) -> list[str]:
    ordered_lines: list[str] = []
    canonical_titles = course_family_member_titles(plan.canonical_course_family_id)
    for title in canonical_titles:
        semester_text = schedule_by_course.pop(title, "")
        if semester_text:
            ordered_lines.append(f"{title}：{semester_text}")
    for title, semester_text in schedule_by_course.items():
        ordered_lines.append(f"{title}：{semester_text}")
    return ordered_lines


def _append_course_partial_answer_suffix(*, answer: str, unsupported_fields: tuple[str, ...]) -> str:
    normalized_answer = answer if answer.endswith("。") else f"{answer}。"
    if "offering_unit" not in unsupported_fields:
        return normalized_answer
    suffix = "当前还不能稳定确认开课学院。"
    trimmed = normalized_answer.rstrip("。")
    return f"{trimmed}；{suffix}"


def _build_curriculum_program_family_answer(
    *,
    evidence: EvidenceBundle,
    plan: CurriculumProgramFamilyQueryPlan,
) -> str:
    snippets = [
        source.snippet.strip()
        for source in evidence.sources
        if source.snippet.strip()
    ]
    for snippet in snippets:
        if plan.canonical_program_family_title and plan.canonical_program_family_title in snippet:
            return snippet if snippet.endswith("。") else f"{snippet}。"
    if snippets:
        snippet = snippets[0]
        return snippet if snippet.endswith("。") else f"{snippet}。"
    return f"我还不能稳定确认{plan.canonical_program_family_title}对应的项目班信息。"


def _summarize_retrieved_titles(evidence: EvidenceBundle) -> tuple[str, ...]:
    titles: list[str] = []
    for source in evidence.sources:
        title = (
            source.source_title.strip()
            or (source.structural_path[0].strip() if source.structural_path else "")
            or _source_label(source)
        )
        if not title or title in titles:
            continue
        titles.append(title)
        if len(titles) >= 3:
            break
    return tuple(titles)


def _match_key(text: str) -> str:
    return "".join(char for char in _normalize_text(text).lower() if char.isalnum() or _is_cjk_char(char))


def _is_short_title_fragment(query_key: str) -> bool:
    if not query_key or any(cue in query_key for cue in _QUERY_ASK_CUES):
        return False
    cjk_length = sum(1 for char in query_key if _is_cjk_char(char))
    return 0 < cjk_length <= 8


def _source_title_matches_exact_query(query_key: str, source: EvidenceSource) -> bool:
    return any(_match_key(candidate) == query_key for candidate in _source_title_candidates(source))


def _source_title_candidates(source: EvidenceSource) -> tuple[str, ...]:
    candidates = [source.source_title.strip(), source.doc_id.split(":", 1)[-1].strip()]
    if source.structural_path:
        candidates.append(source.structural_path[0].strip())
    return tuple(candidate for candidate in dict.fromkeys(candidates) if candidate)


def _is_cjk_char(char: str) -> bool:
    code_point = ord(char)
    return (
        0x3400 <= code_point <= 0x4DBF
        or 0x4E00 <= code_point <= 0x9FFF
        or 0xF900 <= code_point <= 0xFAFF
    )
