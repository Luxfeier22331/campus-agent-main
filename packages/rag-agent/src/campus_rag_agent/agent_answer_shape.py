from __future__ import annotations

import re
from enum import StrEnum

from campus_contracts import EvidenceBundle, EvidenceSource

from .agent_curriculum_terms import _is_curriculum_course_list_query, _is_curriculum_lookup_query
from .agent_shared import _normalize_snippet


class AnswerShape(StrEnum):
    TITLE_LOOKUP = "title_lookup"
    CATEGORY_DISCOVERY_LIST = "category_discovery_list"
    CONDITION_OVERVIEW = "condition_overview"
    DETAIL_CLAUSE = "detail_clause"
    JUDGMENT_CLAUSE = "judgment_clause"
    COURSE_LIST = "course_list"
    FACT_LOOKUP = "fact_lookup"
    GENERAL_SUMMARY = "general_summary"


_CONDITION_QUERY_HINTS = (
    "条件",
    "要求",
    "资格",
    "申请",
    "参评",
    "评选",
    "eligibility",
    "requirement",
)
_OVERVIEW_HINTS = ("什么条件", "哪些条件", "有什么要求", "哪些要求", "需要满足")
_CATEGORY_DISCOVERY_HINTS = ("有哪些", "都有什么", "有什么", "哪些")
_DETAIL_CLAUSE_HINTS = ("怎么要求", "如何要求", "怎么规定", "如何规定")
_JUDGMENT_CLAUSE_HINTS = (
    "能不能",
    "能否",
    "可以吗",
    "可不可以",
    "还能",
    "还可以",
    "是否可以",
    "算不算",
    "算吗",
    "行不行",
)
_FACT_QUERY_HINTS = ("学制", "几年", "总学分", "多少", "什么时候", "几点")
_TITLE_LOOKUP_HINTS = ("想看", "查询", "查看", "培养方案", "规定", "办法")
_ARTICLE_CLAUSE_RE = re.compile(r"第\s*(?:\d+|[一二三四五六七八九十百零两]+)\s*[条款项]")


def infer_answer_shape(*, evidence: EvidenceBundle) -> AnswerShape:
    query = _normalize_snippet(evidence.query_text)
    normalized_query = query.lower()
    if _is_curriculum_course_list_query(query):
        return AnswerShape.COURSE_LIST
    if _is_curriculum_lookup_query(query):
        return AnswerShape.FACT_LOOKUP
    if any(hint in normalized_query for hint in _FACT_QUERY_HINTS):
        return AnswerShape.FACT_LOOKUP
    if _is_regulation_category_discovery_query(
        normalized_query=normalized_query,
        evidence=evidence,
    ):
        return AnswerShape.CATEGORY_DISCOVERY_LIST
    if _is_judgment_clause_query(normalized_query):
        return AnswerShape.JUDGMENT_CLAUSE
    if _is_detail_clause_query(normalized_query) and any(
        hint in normalized_query for hint in _CONDITION_QUERY_HINTS
    ):
        return AnswerShape.DETAIL_CLAUSE
    if _query_targets_source_title(query_text=query, sources=evidence.sources):
        return AnswerShape.TITLE_LOOKUP
    if any(hint in normalized_query for hint in _OVERVIEW_HINTS) or (
        any(hint in normalized_query for hint in _CONDITION_QUERY_HINTS)
        and "第" not in normalized_query
    ):
        return AnswerShape.CONDITION_OVERVIEW
    return AnswerShape.GENERAL_SUMMARY


def _is_regulation_category_discovery_query(
    *,
    normalized_query: str,
    evidence: EvidenceBundle,
) -> bool:
    if evidence.corpus != "regulations":
        return False
    if evidence.collection not in {"student_rules", "institutional_rules"}:
        return False
    if not any(hint in normalized_query for hint in _CATEGORY_DISCOVERY_HINTS):
        return False
    return any(
        source.content_role == "policy_list"
        or source.semantic_role == "category_overview"
        or source.is_answer_bearing
        and (
            "当前已收录依据中" in _normalize_snippet(source.snippet)
            or "相关制度包括" in _normalize_snippet(source.snippet)
        )
        for source in evidence.sources
    )


def _is_detail_clause_query(normalized_query: str) -> bool:
    return bool(_ARTICLE_CLAUSE_RE.search(normalized_query)) or any(
        hint in normalized_query for hint in _DETAIL_CLAUSE_HINTS
    )


def _is_judgment_clause_query(normalized_query: str) -> bool:
    return any(hint in normalized_query for hint in _JUDGMENT_CLAUSE_HINTS)


def answer_shape_support_budget(shape: AnswerShape, default_budget: int) -> int:
    if shape == AnswerShape.CATEGORY_DISCOVERY_LIST:
        return max(default_budget, 8)
    if shape == AnswerShape.CONDITION_OVERVIEW:
        return max(default_budget, 5)
    return default_budget


def _query_targets_source_title(
    *,
    query_text: str,
    sources: tuple[EvidenceSource, ...],
) -> bool:
    normalized_query = _normalize_snippet(query_text)
    if not normalized_query:
        return False
    if not any(hint in normalized_query for hint in _TITLE_LOOKUP_HINTS):
        return False
    for source in sources:
        title = _normalize_snippet(source.source_title)
        if title and title in normalized_query:
            return True
        doc_title = _normalize_snippet(source.doc_id.split(":", 1)[-1])
        if doc_title and doc_title in normalized_query:
            return True
    return False


__all__ = [
    "AnswerShape",
    "answer_shape_support_budget",
    "infer_answer_shape",
]
