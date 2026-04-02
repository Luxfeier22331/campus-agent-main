from __future__ import annotations

import re
from typing import Callable

from campus_contracts import (
    ErrorInfo,
    EvidenceBundle,
    EvidenceSource,
    RagRequestPayload,
    RagResultDiagnostics,
    RagResultPayload,
    SpecialistRequest,
    SpecialistResponse,
)
from campus_retrieval_core import CorpusQueryDisabledError, RetrievalBackendError, retrieve_sources
from campus_retrieval_core.curriculum_query_resolution import (
    interpret_curriculum_query,
    matching_curriculum_doc_ids,
)
from campus_retrieval_core.evidence_ranking import query_targets_source_title, select_supporting_evidence_sources

from campus_rag_specialist.agent import DEFAULT_MAX_ANSWER_SOURCES, RagSpecialistAgent
from campus_rag_specialist.confidence import derive_confidence
from campus_rag_specialist.intent import build_personalization_hint, frame_rag_intent
from campus_rag_specialist.query_planning import (
    CurriculumCourseQueryPlan,
    CurriculumQueryPlan,
    HandbookQueryPlan,
    plan_curriculum_course_query,
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


def delegate_to_rag_agent(
    request: SpecialistRequest,
    *,
    retriever: Callable[..., object] = retrieve_sources,
) -> SpecialistResponse:
    if request.target != "rag-specialist":
        raise ValueError("delegate_to_rag_agent only accepts target='rag-specialist'")
    if not isinstance(request.payload, RagRequestPayload):
        raise TypeError("rag-specialist requires RagRequestPayload")

    user_goal = request.user_goal.strip()
    intent_frame = frame_rag_intent(request)
    personalization_hint = build_personalization_hint(request)
    handbook_plan = _plan_handbook_query(request, user_goal)
    curriculum_plan = _plan_curriculum_query(request, user_goal)
    curriculum_course_plan = _plan_curriculum_course_query(request, user_goal)
    if intent_frame.response_mode == "clarify" and not _has_resolved_query_plan(
        handbook_plan=handbook_plan,
        curriculum_plan=curriculum_plan,
    ):
        empty_evidence = _build_empty_evidence(request, user_goal)
        return SpecialistResponse(
            target="rag-specialist",
            status="needs_clarification",
            confidence="low",
            follow_up_question=_build_clarification_question(
                user_goal,
                empty_evidence,
                recent_goal=personalization_hint.recent_goal,
            ),
            result=_build_rag_result_payload(
                evidence=empty_evidence,
                handbook_plan=handbook_plan,
                curriculum_plan=curriculum_plan,
                curriculum_course_plan=curriculum_course_plan,
            ),
        )
    if handbook_plan is not None and handbook_plan.status == "needs_clarification":
        empty_evidence = _build_empty_evidence(request, user_goal)
        return SpecialistResponse(
            target="rag-specialist",
            status="needs_clarification",
            confidence="low",
            follow_up_question=_build_clarification_question(
                user_goal,
                empty_evidence,
                recent_goal=personalization_hint.recent_goal,
                clarification_reason=handbook_plan.clarification_reason,
            ),
            result=_build_rag_result_payload(
                evidence=empty_evidence,
                handbook_plan=handbook_plan,
                curriculum_plan=curriculum_plan,
                curriculum_course_plan=curriculum_course_plan,
            ),
        )
    if curriculum_plan is not None and curriculum_plan.status == "needs_clarification":
        empty_evidence = _build_empty_evidence(request, user_goal)
        return SpecialistResponse(
            target="rag-specialist",
            status="needs_clarification",
            confidence="low",
            follow_up_question=_build_clarification_question(
                user_goal,
                empty_evidence,
                recent_goal=personalization_hint.recent_goal,
                clarification_reason=curriculum_plan.clarification_reason,
                clarification_candidates=curriculum_plan.clarification_candidates,
            ),
            result=_build_rag_result_payload(
                evidence=empty_evidence,
                handbook_plan=handbook_plan,
                curriculum_plan=curriculum_plan,
                curriculum_course_plan=curriculum_course_plan,
            ),
        )

    try:
        retrieval_goal = user_goal
        target_document_ids: tuple[str, ...] = ()
        preferred_document_ids: tuple[str, ...] = ()
        retrieval_collection = request.payload.scope.collection
        canonical_course_ids: tuple[str, ...] = ()
        canonical_course_family_ids: tuple[str, ...] = ()
        if request.payload.scope.corpus == "curriculum" and request.payload.scope.collection == "curriculum_plan":
            if curriculum_course_plan is not None:
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
            elif curriculum_plan is not None and curriculum_plan.status in {"resolved", "soft_preference"}:
                retrieval_goal = curriculum_plan.rewritten_query_text
                target_document_ids = curriculum_plan.target_document_ids
                preferred_document_ids = curriculum_plan.preferred_document_ids
            else:
                retrieval_goal = interpret_curriculum_query(user_goal).normalized_query_text
        elif handbook_plan is not None and handbook_plan.status == "resolved":
            retrieval_goal = handbook_plan.rewritten_query_text
            target_document_ids = handbook_plan.target_document_ids
        evidence = retriever(
            retrieval_goal,
            corpus=request.payload.scope.corpus,
            collection=retrieval_collection,
            target_document_ids=target_document_ids,
            preferred_document_ids=preferred_document_ids,
            canonical_course_ids=canonical_course_ids,
            canonical_course_family_ids=canonical_course_family_ids,
            authorized_filter=request.context.authorization.retrieval_filter,
            personalization_hint=personalization_hint,
        )
        evidence = _with_query_text(evidence, user_goal)
    except CorpusQueryDisabledError as exc:
        return SpecialistResponse(
            target="rag-specialist",
            status="error",
            confidence="low",
            result=_build_rag_result_payload(
                evidence=_build_empty_evidence(request, user_goal),
                handbook_plan=handbook_plan,
                curriculum_plan=curriculum_plan,
                curriculum_course_plan=curriculum_course_plan,
            ),
            error=ErrorInfo(code="corpus_not_query_enabled", message=str(exc), retryable=False),
        )
    except RetrievalBackendError as exc:
        return SpecialistResponse(
            target="rag-specialist",
            status="error",
            confidence="low",
            result=_build_rag_result_payload(
                evidence=_build_empty_evidence(request, user_goal),
                handbook_plan=handbook_plan,
                curriculum_plan=curriculum_plan,
                curriculum_course_plan=curriculum_course_plan,
            ),
            error=ErrorInfo(code="retrieval_failed", message=str(exc), retryable=False),
        )
    if not evidence.sources:
        return SpecialistResponse(
            target="rag-specialist",
            status="no_answer",
            answer_text=_build_no_answer_response(
                evidence,
                resolved_policy_title=_resolved_policy_title(handbook_plan),
            ),
            confidence="low",
            result=_build_rag_result_payload(
                evidence=evidence,
                handbook_plan=handbook_plan,
                curriculum_plan=curriculum_plan,
                curriculum_course_plan=curriculum_course_plan,
                no_answer_reason=_resolved_policy_no_answer_reason(handbook_plan),
            ),
        )
    if _should_clarify_with_evidence(user_goal, evidence):
        return SpecialistResponse(
            target="rag-specialist",
            status="needs_clarification",
            confidence="low",
            follow_up_question=_build_clarification_question(
                user_goal,
                evidence,
                recent_goal=personalization_hint.recent_goal,
                clarification_candidates=curriculum_plan.clarification_candidates if curriculum_plan is not None else (),
            ),
            result=_build_rag_result_payload(
                evidence=evidence,
                handbook_plan=handbook_plan,
                curriculum_plan=curriculum_plan,
                curriculum_course_plan=curriculum_course_plan,
            ),
        )

    supporting_evidence = _build_supporting_evidence(evidence)
    if not supporting_evidence.sources:
        return SpecialistResponse(
            target="rag-specialist",
            status="no_answer",
            answer_text=_build_no_answer_response(
                supporting_evidence,
                resolved_policy_title=_resolved_policy_title(handbook_plan),
            ),
            confidence="low",
            result=_build_rag_result_payload(
                evidence=supporting_evidence,
                handbook_plan=handbook_plan,
                curriculum_plan=curriculum_plan,
                curriculum_course_plan=curriculum_course_plan,
                no_answer_reason=_resolved_policy_no_answer_reason(handbook_plan),
            ),
        )

    confidence = derive_confidence(supporting_evidence)
    if confidence == "low":
        return SpecialistResponse(
            target="rag-specialist",
            status="no_answer",
            answer_text=_build_no_answer_response(
                supporting_evidence,
                resolved_policy_title=_resolved_policy_title(handbook_plan),
            ),
            confidence="low",
            result=_build_rag_result_payload(
                evidence=supporting_evidence,
                handbook_plan=handbook_plan,
                curriculum_plan=curriculum_plan,
                curriculum_course_plan=curriculum_course_plan,
                no_answer_reason=_resolved_policy_no_answer_reason(handbook_plan),
            ),
        )

    if curriculum_course_plan is not None:
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
    return SpecialistResponse(
        target="rag-specialist",
        status="completed",
        answer_text=answer_text,
        confidence=confidence,
        result=_build_rag_result_payload(
            evidence=finalized_evidence,
            handbook_plan=handbook_plan,
            curriculum_plan=curriculum_plan,
            curriculum_course_plan=curriculum_course_plan,
        ),
    )


def _build_empty_evidence(request: SpecialistRequest, user_goal: str) -> EvidenceBundle:
    return EvidenceBundle(
        query_text=user_goal,
        corpus=request.payload.scope.corpus,
        collection=request.payload.scope.collection,
    )


def _build_supporting_evidence(evidence: EvidenceBundle) -> EvidenceBundle:
    return EvidenceBundle(
        query_text=evidence.query_text,
        corpus=evidence.corpus,
        collection=evidence.collection,
        sources=select_supporting_evidence_sources(
            query_text=evidence.query_text,
            sources=evidence.sources,
            max_sources=DEFAULT_MAX_ANSWER_SOURCES,
        ),
    )


def _build_no_answer_response(
    evidence: EvidenceBundle,
    *,
    resolved_policy_title: str = "",
) -> str:
    if evidence.corpus == "curriculum" and evidence.collection == "course_facts":
        return "当前未检索到足够依据支持回答这个课程问题，请补充更具体的课程名称、课程类别或修读字段。"
    if evidence.corpus == "curriculum" and evidence.collection == "curriculum_plan":
        return "当前未检索到足够依据支持回答这个培养方案问题，请补充更具体的培养方案名称、学位要求或课程表名称。"
    if resolved_policy_title:
        return (
            f"在《{resolved_policy_title}》中，当前未检索到足够依据支持回答这个问题；"
            "请确认是否有更具体的条款表述。"
        )
    return "当前未检索到足够依据支持回答这个学生手册问题，请确认它是否属于学生手册范围，或补充更具体的制度名称。"


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
    clarification_reason: str = "",
    clarification_candidates: tuple[str, ...] = (),
) -> str:
    if recent_goal:
        return f"按当前记录理解，你最近在咨询{recent_goal}相关事项；请再具体说明你想确认的政策对象。"
    if clarification_reason == "policy_object_missing":
        return "请具体说明你想咨询哪一项评审、评定或测评办法。"
    if clarification_reason == "policy_object_conflict":
        if "奖学金" in user_goal or "scholarship" in user_goal.lower():
            return "请说明你想咨询哪一类奖学金或对应的评审办法。"
        return "请具体说明你想咨询哪一项制度；当前问题可能同时对应多个学生手册制度。"
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


def _plan_handbook_query(
    request: SpecialistRequest,
    user_goal: str,
) -> HandbookQueryPlan | None:
    if request.payload.scope.corpus != "regulations" or request.payload.scope.collection != "student_handbook":
        return None
    return plan_student_handbook_query(user_goal)


def _plan_curriculum_query(
    request: SpecialistRequest,
    user_goal: str,
) -> CurriculumQueryPlan | None:
    if request.payload.scope.corpus != "curriculum" or request.payload.scope.collection != "curriculum_plan":
        return None
    return plan_curriculum_query(
        user_goal,
        verified_major=request.context.actor.major,
    )


def _plan_curriculum_course_query(
    request: SpecialistRequest,
    user_goal: str,
) -> CurriculumCourseQueryPlan | None:
    if request.payload.scope.corpus != "curriculum" or request.payload.scope.collection != "curriculum_plan":
        return None
    return plan_curriculum_course_query(user_goal)


def _has_resolved_query_plan(
    *,
    handbook_plan: HandbookQueryPlan | None,
    curriculum_plan: CurriculumQueryPlan | None,
) -> bool:
    if handbook_plan is not None and handbook_plan.status == "resolved":
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


def _build_rag_result_payload(
    *,
    evidence: EvidenceBundle,
    handbook_plan: HandbookQueryPlan | None,
    curriculum_plan: CurriculumQueryPlan | None = None,
    curriculum_course_plan: CurriculumCourseQueryPlan | None = None,
    no_answer_reason: str = "",
) -> RagResultPayload:
    diagnostics = _build_rag_result_diagnostics(
        evidence=evidence,
        handbook_plan=handbook_plan,
        curriculum_plan=curriculum_plan,
        curriculum_course_plan=curriculum_course_plan,
        no_answer_reason=no_answer_reason,
    )
    return RagResultPayload(
        evidence=evidence,
        diagnostics=diagnostics,
    )


def _build_rag_result_diagnostics(
    *,
    evidence: EvidenceBundle,
    handbook_plan: HandbookQueryPlan | None,
    curriculum_plan: CurriculumQueryPlan | None = None,
    curriculum_course_plan: CurriculumCourseQueryPlan | None = None,
    no_answer_reason: str = "",
) -> RagResultDiagnostics | None:
    if handbook_plan is None and curriculum_plan is None and curriculum_course_plan is None:
        return None
    if curriculum_course_plan is not None:
        return RagResultDiagnostics(
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
    return RagResultDiagnostics(
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
    )


def _build_curriculum_course_answer(
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
    body = "；".join(unique_snippets[:3])
    if plan.entity_type == "course":
        lead = f"根据当前已采集的课程事实，{plan.canonical_course_title}{'：' if body else '。'}"
    else:
        lead = f"根据当前已采集的课程事实，{plan.canonical_course_family_title}{'：' if body else '。'}"
    answer = f"{lead}{body}" if body else lead
    if plan.partial_answer and "offering_unit" in plan.unsupported_fields:
        suffix = "当前还不能稳定确认开课学院。"
        if "所有本预科学生" in answer:
            return f"{answer}；{suffix}"
        return f"{answer}{suffix}"
    return answer if answer.endswith("。") else f"{answer}。"


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
