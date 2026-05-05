from __future__ import annotations

from campus_contracts import EvidenceBundle, EvidenceSource, KnowledgeScope
from campus_retrieval_core.curriculum_query_resolution import (
    interpret_curriculum_query,
    matching_curriculum_doc_ids,
)
from campus_retrieval_core.evidence_ranking import query_targets_source_title

from campus_rag_agent.intent import RagIntentFrame

from .service_common import (
    _is_short_title_fragment,
    _match_key,
    _normalize_text,
    _source_label,
    _source_title_matches_exact_query,
)

_GENERIC_AMBIGUOUS_TOPICS = (
    "奖学金",
    "scholarship",
    "学位",
    "degree",
    "规定",
    "办法",
    "policy",
    "流程",
    "procedure",
)
_HANDBOOK_TIME_QUERY_TERMS = (
    "时间",
    "几点",
    "多久",
    "哪天",
    "什么时候",
    "hours",
    "照明",
    "熄灯",
    "亮灯",
)


def _should_keep_deterministic_completed_answer(
    *,
    resolved_scope: KnowledgeScope,
    intent_frame: RagIntentFrame,
    user_goal: str,
    evidence: EvidenceBundle,
) -> bool:
    if resolved_scope.corpus == "curriculum":
        return True
    if resolved_scope.corpus != "regulations" or resolved_scope.collection != "student_rules":
        return False
    if intent_frame.question_kind in {"procedure", "materials", "deadline"}:
        return True
    normalized_goal = _normalize_text(user_goal).lower()
    if any(term in normalized_goal for term in _HANDBOOK_TIME_QUERY_TERMS):
        return True
    return _is_handbook_exact_title_lookup(user_goal=user_goal, evidence=evidence)


def _should_clarify_with_evidence(user_goal: str, evidence: EvidenceBundle) -> bool:
    return bool(_retrieval_ambiguity_reason(user_goal, evidence))


def _retrieval_ambiguity_reason(user_goal: str, evidence: EvidenceBundle) -> str:
    if len(evidence.sources) < 2:
        return ""
    if evidence.corpus == "curriculum" and evidence.collection == "curriculum_plan":
        interpretation = interpret_curriculum_query(user_goal)
        if interpretation.program_compact_key:
            matching_doc_ids = matching_curriculum_doc_ids(
                query_text=user_goal,
                sources=evidence.sources,
            )
            if len(matching_doc_ids) > 1:
                return "multi_candidate_title"
            if len(matching_doc_ids) == 1:
                return ""
    title_targeting_sources = tuple(
        source
        for source in evidence.sources
        if query_targets_source_title(query_text=user_goal, source=source)
    )
    if _is_ambiguous_title_fragment_goal(user_goal, title_targeting_sources):
        return "multi_candidate_title"
    if title_targeting_sources:
        return ""

    first_source = evidence.sources[0]
    second_source = next(
        (source for source in evidence.sources[1:] if source.doc_id != first_source.doc_id),
        None,
    )
    if second_source is None:
        return ""

    normalized_goal = _normalize_text(user_goal).lower()
    if not any(topic in normalized_goal for topic in _GENERIC_AMBIGUOUS_TOPICS):
        return ""

    first_label = _source_label(first_source).lower()
    second_label = _source_label(second_source).lower()
    if (first_label and first_label in normalized_goal) or (
        second_label and second_label in normalized_goal
    ):
        return ""

    if abs(first_source.score - second_source.score) <= 0.12:
        return "multi_candidate_title"
    return ""


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
    return not any(
        _source_title_matches_exact_query(query_key, source) for source in distinct_sources
    )


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
        return (
            f"按当前记录理解，你最近在咨询{recent_goal}相关事项；请再具体说明你想确认的政策对象。"
        )
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
        if clarification_reason == "curriculum_program_family_alias":
            context_question = _build_curriculum_program_family_alias_question(
                user_goal=user_goal,
                confirmed_slot_terms=confirmed_slot_terms,
                clarification_candidates=clarification_candidates,
            )
            if context_question:
                return context_question
        if clarification_candidates:
            return (
                "请具体说明你想咨询哪一份培养方案。"
                f" 当前更相关的候选包括：{'、'.join(clarification_candidates)}。"
            )
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


def _build_curriculum_program_family_alias_question(
    *,
    user_goal: str,
    confirmed_slot_terms: tuple[str, ...],
    clarification_candidates: tuple[str, ...],
) -> str:
    normalized_goal = _normalize_text(user_goal)
    interpretation = interpret_curriculum_query(normalized_goal)
    family_terms = tuple(
        term for term in ("实验班", "基地班", "民族班", "强基计划") if term in normalized_goal
    )
    semester = interpretation.semester_labels[0] if interpretation.semester_labels else ""
    major = _curriculum_major_context(
        user_goal=normalized_goal,
        confirmed_slot_terms=confirmed_slot_terms,
        clarification_candidates=clarification_candidates,
    )
    context_parts = tuple(
        part for part in (major, family_terms[0] if family_terms else "", semester) if part
    )
    if context_parts:
        return (
            f"你想问{'、'.join(context_parts)}对应的哪一份培养方案？"
            "请补充具体项目班或培养方案名称。"
        )
    if clarification_candidates:
        return (
            "请具体说明你想咨询哪一份培养方案。"
            f" 当前更相关的候选包括：{'、'.join(clarification_candidates)}。"
        )
    return "请具体说明你想咨询哪一份培养方案；当前问题仍可能对应多个项目班或实验班培养方案。"


def _curriculum_major_context(
    *,
    user_goal: str,
    confirmed_slot_terms: tuple[str, ...],
    clarification_candidates: tuple[str, ...],
) -> str:
    for slot_term in confirmed_slot_terms:
        normalized = _normalize_text(slot_term)
        if normalized:
            return normalized
    if "历史学" in user_goal:
        return "历史学"
    for candidate in clarification_candidates:
        if "历史学" in candidate:
            return "历史学"
    return ""


def _clarification_slot_subject(user_goal: str, confirmed_slot_terms: tuple[str, ...]) -> str:
    for slot_term in confirmed_slot_terms:
        normalized_slot_term = _normalize_text(slot_term)
        if not normalized_slot_term:
            continue
        if normalized_slot_term in _normalize_text(user_goal):
            continue
        return normalized_slot_term
    return ""


def _is_handbook_exact_title_lookup(*, user_goal: str, evidence: EvidenceBundle) -> bool:
    query_key = _match_key(user_goal)
    if not query_key or any(
        cue in query_key for cue in ("多少", "几年", "怎么", "如何", "安排", "什么", "哪些")
    ):
        return False
    if len({source.doc_id for source in evidence.sources}) != 1:
        return False
    return any(_source_title_matches_exact_query(query_key, source) for source in evidence.sources)
