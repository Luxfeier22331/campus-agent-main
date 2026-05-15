from __future__ import annotations

import re
from enum import StrEnum

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_retrieval_core.evidence_attributes import evidence_attributes_for_source

from .agent_curriculum_terms import _is_curriculum_course_list_query, _is_curriculum_lookup_query
from .agent_shared import _normalize_snippet
from .retrieval_intent import RetrievalIntent


class AnswerShape(StrEnum):
    TITLE_LOOKUP = "title_lookup"
    CATEGORY_DISCOVERY_LIST = "category_discovery_list"
    CONDITION_OVERVIEW = "condition_overview"
    DETAIL_CLAUSE = "detail_clause"
    JUDGMENT_CLAUSE = "judgment_clause"
    COURSE_LIST = "course_list"
    FACT_LOOKUP = "fact_lookup"
    GENERAL_SUMMARY = "general_summary"


_FACT_QUERY_HINTS = ("学制", "几年", "总学分", "多少", "什么时候", "几点")
_TITLE_LOOKUP_HINTS = ("想看", "查询", "查看", "培养方案", "规定", "办法")
_DETAIL_QUERY_HINTS = ("怎么要求", "如何要求", "什么要求", "哪条", "哪一条", "第几条")
_JUDGMENT_QUERY_HINTS = ("能不能", "是否可以", "可不可以", "还能", "可以吗", "符合吗")
_MANAGEMENT_SUMMARY_HINTS = ("怎么管理", "如何管理", "管理规定", "怎么处理", "如何处理")

_RETRIEVAL_INTENT_TO_ANSWER_SHAPE = {
    "policy_list": AnswerShape.CATEGORY_DISCOVERY_LIST,
    "policy_object": AnswerShape.TITLE_LOOKUP,
    "specific_clause": AnswerShape.DETAIL_CLAUSE,
    "eligibility_judgment": AnswerShape.JUDGMENT_CLAUSE,
    "procedure_steps": AnswerShape.DETAIL_CLAUSE,
    "condition_table": AnswerShape.CONDITION_OVERVIEW,
    "version_compare": AnswerShape.GENERAL_SUMMARY,
    "curriculum_document": AnswerShape.TITLE_LOOKUP,
    "curriculum_fact": AnswerShape.FACT_LOOKUP,
    "official_reference": AnswerShape.TITLE_LOOKUP,
    "general_fact": AnswerShape.FACT_LOOKUP,
    "clarification": AnswerShape.GENERAL_SUMMARY,
    "unsupported": AnswerShape.GENERAL_SUMMARY,
}


def answer_shape_from_retrieval_intent(retrieval_intent: RetrievalIntent) -> AnswerShape:
    return _RETRIEVAL_INTENT_TO_ANSWER_SHAPE.get(
        retrieval_intent.expected.answer_kind,
        AnswerShape.GENERAL_SUMMARY,
    )


def infer_answer_shape(*, evidence: EvidenceBundle) -> AnswerShape:
    query = _normalize_snippet(evidence.query_text)
    normalized_query = query.lower()
    if _is_curriculum_course_list_query(query):
        return AnswerShape.COURSE_LIST
    if _is_curriculum_lookup_query(query):
        return AnswerShape.FACT_LOOKUP
    if _query_asks_for_governing_document_title(query):
        return AnswerShape.TITLE_LOOKUP
    if any(hint in normalized_query for hint in _FACT_QUERY_HINTS):
        return AnswerShape.FACT_LOOKUP
    if _query_targets_source_title(
        query_text=query,
        sources=evidence.sources,
    ) and not _query_requests_regulation_content(query):
        return AnswerShape.TITLE_LOOKUP
    if _query_requests_management_summary(normalized_query):
        return AnswerShape.GENERAL_SUMMARY
    regulation_shape = _infer_regulation_answer_shape_from_evidence(evidence)
    if regulation_shape is not None:
        if regulation_shape == AnswerShape.DETAIL_CLAUSE and _query_requests_condition_timing(
            normalized_query
        ):
            return AnswerShape.CONDITION_OVERVIEW
        if regulation_shape in {
            AnswerShape.CONDITION_OVERVIEW,
            AnswerShape.DETAIL_CLAUSE,
            AnswerShape.JUDGMENT_CLAUSE,
        } and any(hint in normalized_query for hint in _JUDGMENT_QUERY_HINTS):
            return AnswerShape.JUDGMENT_CLAUSE
        if regulation_shape in {
            AnswerShape.CONDITION_OVERVIEW,
            AnswerShape.JUDGMENT_CLAUSE,
        } and _query_requests_specific_regulation_detail(normalized_query):
            return AnswerShape.DETAIL_CLAUSE
        return regulation_shape
    return AnswerShape.GENERAL_SUMMARY


def _infer_regulation_answer_shape_from_evidence(
    evidence: EvidenceBundle,
) -> AnswerShape | None:
    if evidence.corpus != "regulations":
        return None
    if evidence.collection not in {"student_rules", "institutional_rules"}:
        return None
    answer_bearing_sources = tuple(
        source for source in evidence.sources if source.is_answer_bearing
    )
    if not answer_bearing_sources:
        return None
    if any(_is_category_overview_source(source) for source in answer_bearing_sources):
        return AnswerShape.CATEGORY_DISCOVERY_LIST
    if any(_is_procedure_source(source) for source in answer_bearing_sources):
        return AnswerShape.DETAIL_CLAUSE
    if any(_is_condition_answer_source(source) for source in answer_bearing_sources):
        if any(_is_condition_overview_role(source) for source in answer_bearing_sources):
            return AnswerShape.CONDITION_OVERVIEW
        subjects = {
            subject
            for source in answer_bearing_sources
            for subject in (
                evidence_attributes_for_source(source).condition_subject,
                evidence_attributes_for_source(source).condition_group_subject,
            )
            if subject
        }
        if len(subjects) > 1 or len(answer_bearing_sources) > 1:
            return AnswerShape.CONDITION_OVERVIEW
        return AnswerShape.JUDGMENT_CLAUSE
    if any(_has_clause_focus(source) for source in answer_bearing_sources):
        return AnswerShape.DETAIL_CLAUSE
    return AnswerShape.GENERAL_SUMMARY


def _query_requests_specific_regulation_detail(query_text: str) -> bool:
    if any(hint in query_text for hint in _DETAIL_QUERY_HINTS):
        return True
    return re.search(r"第[一二三四五六七八九十百千万0-9]+条", query_text) is not None


def _is_category_overview_source(source: EvidenceSource) -> bool:
    attributes = evidence_attributes_for_source(source)
    return (
        attributes.answer_role == "category_overview"
        or attributes.semantic_role == "category_overview"
        or source.content_role == "policy_list"
    )


def _has_clause_focus(source: EvidenceSource) -> bool:
    attributes = evidence_attributes_for_source(source)
    return bool(source.detail_label or attributes.article_no or attributes.clause_no)


def _is_procedure_source(source: EvidenceSource) -> bool:
    attributes = evidence_attributes_for_source(source)
    return attributes.answer_role == "procedure_step" or source.content_role == "procedure"


def _is_condition_answer_source(source: EvidenceSource) -> bool:
    return evidence_attributes_for_source(source).answer_role in {
        "eligibility_condition",
        "exception_rule",
        "exclusion_rule",
        "example_evidence",
        "material_requirement",
        "time_constraint",
        "table_fact",
    }


def _is_condition_overview_role(source: EvidenceSource) -> bool:
    return evidence_attributes_for_source(source).answer_role in {
        "material_requirement",
        "time_constraint",
        "table_fact",
    }


def answer_shape_support_budget(shape: AnswerShape, default_budget: int) -> int:
    if shape == AnswerShape.TITLE_LOOKUP:
        return 1
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


def _query_asks_for_governing_document_title(query_text: str) -> bool:
    return any(
        cue in query_text
        for cue in (
            "哪份管理办法",
            "哪份办法",
            "哪个管理办法",
            "哪个办法",
            "依据哪份",
            "依据哪个",
        )
    )


def _query_requests_regulation_content(query_text: str) -> bool:
    normalized = _normalize_snippet(query_text)
    if not normalized:
        return False
    if any(hint in normalized for hint in (*_DETAIL_QUERY_HINTS, *_JUDGMENT_QUERY_HINTS)):
        return True
    return any(
        cue in normalized
        for cue in (
            "第",
            "条",
            "款",
            "条件",
            "要求",
            "资格",
            "材料",
            "流程",
            "步骤",
            "程序",
            "申请",
            "办理",
        )
    )


def _query_requests_management_summary(query_text: str) -> bool:
    if not any(hint in query_text for hint in _MANAGEMENT_SUMMARY_HINTS):
        return False
    return not any(
        cue in query_text
        for cue in (
            "条件",
            "要求",
            "资格",
            "材料",
            "流程",
            "步骤",
            "程序",
            "申请",
            "办理",
            "能不能",
            "是否可以",
            "第",
            "条",
            "款",
        )
    )


def _query_requests_condition_timing(query_text: str) -> bool:
    return any(cue in query_text for cue in ("多久", "多长时间", "什么时候", "何时"))


__all__ = [
    "AnswerShape",
    "answer_shape_from_retrieval_intent",
    "answer_shape_support_budget",
    "infer_answer_shape",
]
