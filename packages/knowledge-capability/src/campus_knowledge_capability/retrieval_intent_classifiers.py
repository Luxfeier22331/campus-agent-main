from __future__ import annotations

import unicodedata

from campus_ingestion_core.curriculum_program_semester_facts_projection import (
    build_curriculum_program_semester_fact_document_id,
)
from campus_retrieval_core.curriculum_query_resolution import interpret_curriculum_query


def _specific_policy_intent_kind(plan) -> str:
    query = f"{plan.rewritten_query_text} {plan.focused_query_text}"
    if _looks_like_policy_object_identity_query(plan):
        return "policy_object_lookup"
    if plan.focus_article_nos or plan.focus_clause_nos or plan.focus_detail_labels:
        return "specific_clause_lookup"
    if _looks_like_fixed_condition_table_query(query):
        return "condition_table"
    if plan.query_condition_subject in {
        "discipline_relief_condition",
        "discipline_relief_exclusion",
    }:
        return "condition_table"
    if _looks_like_judgment_query(query):
        return "eligibility_judgment"
    if plan.query_condition_subject in _CONDITION_TABLE_DOMINANT_SUBJECTS:
        return "condition_table"
    if _looks_like_discipline_relief_operation_query(query):
        return "procedure_steps"
    if plan.query_condition_subject == "application_procedure":
        return "procedure_steps"
    if plan.query_action_type and _looks_like_procedure_query(query):
        return "procedure_steps"
    if _looks_like_condition_query(query):
        return "condition_table"
    if plan.query_action_type:
        return "procedure_steps"
    if _looks_like_procedure_query(query):
        return "procedure_steps"
    return "policy_object_lookup"


def _looks_like_policy_object_identity_query(plan) -> bool:
    normalized_query = _compact_text(getattr(plan, "rewritten_query_text", ""))
    normalized_title = _compact_text(
        getattr(plan, "resolved_policy_title", "")
        or " ".join(getattr(plan, "target_document_titles", ()) or ())
    )
    if normalized_title and normalized_query == normalized_title:
        return True
    return _looks_like_governing_document_query(normalized_query)


def _looks_like_governing_document_query(compact_query: str) -> bool:
    return any(
        cue in compact_query
        for cue in (
            "按哪个规定",
            "按哪个办法",
            "依据哪个规定",
            "依据哪个办法",
            "执行哪个规定",
            "执行哪个办法",
            "哪个规定执行",
            "哪个办法执行",
        )
    )


_CONDITION_TABLE_DOMINANT_SUBJECTS = frozenset(
    {
        "amount_or_quota",
        "attendance_absence_threshold",
        "deadline",
        "discipline_relief_condition",
        "discipline_relief_exclusion",
        "dormitory_or_accommodation",
        "material_requirement",
        "paper_or_publication",
        "rank_threshold",
    }
)


def _institutional_specific_policy_intent_kind(plan) -> str:
    if plan.target_document_titles and not plan.target_document_ids:
        return "policy_object_lookup"
    if plan.target_document_titles and _institutional_title_only_query(plan):
        return "policy_object_lookup"
    if plan.focus_article_nos or plan.focus_clause_nos or plan.focus_detail_labels:
        return "specific_clause_lookup"
    kind = _specific_policy_intent_kind(plan)
    if kind == "specific_clause_lookup":
        return "policy_object_lookup"
    return kind


def _institutional_title_only_query(plan) -> bool:
    normalized_queries = {
        _compact_text(value)
        for value in (
            getattr(plan, "normalized_query", ""),
            getattr(plan, "focused_query_text", ""),
        )
        if _compact_text(value)
    }
    for title in plan.target_document_titles:
        normalized_title = _compact_text(title)
        if normalized_title and normalized_title in normalized_queries:
            return True
    return False


def _looks_like_procedure_query(query_text: str) -> bool:
    return any(
        token in query_text
        for token in ("流程", "步骤", "怎么办", "办理", "申请", "挂失", "补办", "申诉")
    )


def _looks_like_judgment_query(query_text: str) -> bool:
    return any(
        token in query_text
        for token in (
            "能不能",
            "能拿",
            "能得",
            "能评",
            "能否",
            "不看",
            "可以吗",
            "可不可以",
            "还能",
            "是否可以",
            "算不算",
            "适用于",
        )
    )


def _looks_like_condition_query(query_text: str) -> bool:
    return any(token in query_text for token in ("条件", "要求", "资格", "参评", "评选"))


def _looks_like_fixed_condition_table_query(query_text: str) -> bool:
    compact_query = _compact_text(query_text)
    return any(
        token in compact_query
        for token in (
            "电器使用管理",
            "宿舍电器管理",
            "加强学生宿舍电器使用管理",
        )
    )


def _looks_like_discipline_relief_operation_query(query_text: str) -> bool:
    if not any(
        token in query_text for token in ("处分怎么消", "消处分", "处分怎么解除", "怎么解除处分")
    ):
        return False
    return not any(token in query_text for token in ("多久", "多长时间", "什么时候", "何时"))


def _looks_like_curriculum_fact_query(query_text: str) -> bool:
    return any(
        token in query_text
        for token in (
            "总学分",
            "学制",
            "几年",
            "授予学位",
            "学位授予",
            "多少学分",
        )
    )


def _curriculum_semester_fact_target_document_ids(plan) -> tuple[str, ...]:
    if getattr(plan, "status", "") != "resolved":
        return ()
    if getattr(plan, "intent_kind", "") != "course_list":
        return ()
    if len(getattr(plan, "target_document_ids", ()) or ()) != 1:
        return ()
    interpretation = interpret_curriculum_query(getattr(plan, "rewritten_query_text", ""))
    if interpretation.intent_kind != "course_list" or len(interpretation.semester_labels) != 1:
        return ()
    return (
        build_curriculum_program_semester_fact_document_id(
            plan.target_document_ids[0],
            interpretation.semester_labels[0],
        ),
    )


def _compact_text(value: str) -> str:
    return "".join(unicodedata.normalize("NFKC", str(value or "")).split()).lower()


__all__ = [
    "_curriculum_semester_fact_target_document_ids",
    "_institutional_specific_policy_intent_kind",
    "_looks_like_curriculum_fact_query",
    "_specific_policy_intent_kind",
]
