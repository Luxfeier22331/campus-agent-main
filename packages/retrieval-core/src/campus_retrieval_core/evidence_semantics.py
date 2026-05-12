from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from campus_contracts import EvidenceSource
from campus_shared.regulation_semantic_registry import canonical_regulation_condition_subject

from campus_retrieval_core.evidence_attributes import evidence_attributes_for_source

EvidenceQueryPolarity = Literal["positive", "negative", "neutral"]
EvidenceQueryAnswerRole = Literal[
    "procedure",
    "restriction",
    "condition",
    "policy_list",
    "neutral",
]

_NEGATIVE_QUERY_CUES = (
    "哪些情况不能",
    "什么情况不能",
    "哪些情形不能",
    "什么情形不能",
    "不能解除",
    "不予解除",
    "不得解除",
    "不可以解除",
    "会被拒",
    "会被拒绝",
    "不予受理",
    "哪些情况不",
    "哪些情形不",
)
_PROCEDURE_QUERY_CUES = ("怎么办", "怎么", "如何", "办理", "申请", "流程", "步骤", "程序")
_NEGATIVE_SOURCE_ROLES = frozenset(
    {
        "exception",
        "exception_rule",
        "prohibition",
        "exclusion",
        "exclusion_rule",
    }
)
_POSITIVE_SOURCE_ROLES = frozenset(
    {
        "category_overview",
        "eligibility_condition",
        "example_evidence",
        "policy_list",
        "procedure_step",
        "condition",
        "table_fact",
    }
)
_PROCEDURE_SOURCE_ROLES = frozenset({"procedure_step"})
_CONDITION_SOURCE_ROLES = frozenset(
    {
        "eligibility_condition",
        "example",
        "example_evidence",
        "exception",
        "exception_rule",
        "table_fact",
        "condition",
    }
)
_CATEGORY_SOURCE_ROLES = frozenset({"category_overview", "policy_list"})
_LIFT_DISCIPLINE_QUERY_CUES = (
    "处分怎么消",
    "消处分",
    "解除处分",
    "处分解除",
    "纪律处分",
    "处分",
)
_REISSUE_QUERY_CUES = ("补办", "补发", "挂失", "遗失", "丢失", "丢了", "补卡", "补证")
_CONDITION_QUERY_CUES = ("条件", "要求", "资格", "能不能", "可以吗", "能否", "是否可以")
_AUDIENCE_SCOPE_QUERY_CUES = (
    "适用于",
    "适用范围",
    "适用对象",
    "适用人群",
    "适用学生",
    "面向",
)
_DISCOVERY_QUERY_CUES = ("有哪些", "都有什么", "有什么", "哪些")
_RANK_THRESHOLD_QUERY_CUES = (
    "没前十",
    "没前10",
    "没进前十",
    "没进前10",
    "不在前十",
    "不在前10",
    "前十之外",
    "前10之外",
    "前十以外",
    "前10以外",
    "超出前十",
    "超出前10",
)
_PAPER_PUBLICATION_QUERY_CUES = ("论文", "发表", "著作", "出版", "专著")
_SCHOLARSHIP_CATEGORY_QUERY_CUES = ("奖学金", "资助", "奖励")
_AMOUNT_OR_QUOTA_QUERY_CUES = ("金额", "名额", "比例", "额度", "多少", "几人", "几名", "多少钱")
_DEADLINE_QUERY_CUES = (
    "时间限制",
    "期限",
    "截止",
    "几天内",
    "多久内",
    "多久",
    "多长时间",
    "多少天",
    "工作日内",
    "时间要求",
)
_MATERIAL_QUERY_CUES = ("什么材料", "哪些材料", "提交材料", "证明材料", "书面申请", "要交什么")
_ATTENDANCE_ABSENCE_QUERY_CUES = ("旷课", "缺勤", "考勤")
_CLASS_HOUR_QUERY_CUES = ("学时", "课时", "节", "多少")


@dataclass(frozen=True, slots=True)
class EvidenceQueryIntent:
    polarity: EvidenceQueryPolarity = "neutral"
    answer_role: EvidenceQueryAnswerRole = "neutral"
    action_type: str = ""
    condition_subject: str = ""
    category_id: str = ""

    @property
    def is_strong(self) -> bool:
        return (
            self.polarity != "neutral"
            or self.answer_role != "neutral"
            or bool(self.action_type)
            or bool(self.condition_subject)
            or bool(self.category_id)
        )


def semantic_alignment_score(*, query_text: str, source: EvidenceSource) -> int:
    score = 0
    intent = infer_evidence_query_intent(query_text)
    attributes = evidence_attributes_for_source(source)
    source_answer_role = attributes.answer_role
    source_action_type = attributes.action_type
    source_claim_type = attributes.claim_type
    source_condition_subject = canonical_regulation_condition_subject(attributes.condition_subject)
    source_group_subject = canonical_regulation_condition_subject(
        attributes.condition_group_subject
    )
    source_category_id = attributes.category_id
    if intent.action_type and source_action_type == intent.action_type:
        score += 8
    if intent.condition_subject:
        normalized_intent_subject = canonical_regulation_condition_subject(intent.condition_subject)
        if source_condition_subject == normalized_intent_subject:
            score += 34
        elif source_group_subject == normalized_intent_subject:
            score += 22
        elif source_condition_subject or source_group_subject:
            score -= 10
    if intent.category_id:
        if source_category_id == intent.category_id:
            score += 14
        elif source_category_id:
            score -= 4
    if intent.polarity == "negative":
        if source_has_negative_polarity(source):
            score += 36
        if source_answer_role in _NEGATIVE_SOURCE_ROLES:
            score += 20
        if source_claim_type == "cannot_do":
            score += 18
        if source_has_positive_polarity(source) and source_answer_role in _POSITIVE_SOURCE_ROLES:
            score -= 8
        return score
    if intent.answer_role == "policy_list":
        if source_answer_role in _CATEGORY_SOURCE_ROLES:
            score += 48
        if source_answer_role in _PROCEDURE_SOURCE_ROLES:
            score -= 18
        if source_answer_role in _NEGATIVE_SOURCE_ROLES:
            score -= 28
        if source_has_negative_polarity(source):
            score -= 18
        if attributes.category_member_document_ids:
            score += min(12, len(attributes.category_member_document_ids) * 2)
        return score
    if intent.polarity == "positive" and intent.answer_role == "procedure":
        if source_has_negative_polarity(source):
            score -= 42
        if source_answer_role in _NEGATIVE_SOURCE_ROLES:
            score -= 24
        if source_claim_type == "cannot_do":
            score -= 22
        if source_has_positive_polarity(source):
            score += 24
        if source_answer_role in _PROCEDURE_SOURCE_ROLES:
            score += 28
        elif source_answer_role in _POSITIVE_SOURCE_ROLES:
            score += 10
    elif intent.polarity == "positive":
        if source_has_negative_polarity(source):
            score -= 24
        if source_has_positive_polarity(source):
            score += 16
        if intent.answer_role == "condition" and source_answer_role in _CONDITION_SOURCE_ROLES:
            score += 18
        if intent.condition_subject == "rank_threshold":
            if source_answer_role in {"exception", "exception_rule"}:
                score += 24
            if _source_mentions_rank_exception_window(source):
                score += 22
            elif _source_mentions_top_ten_requirement(source):
                score += 4
            if (
                source_group_subject == "rank_threshold"
                and source_answer_role == "example_evidence"
            ):
                score += 12
        if intent.condition_subject == "paper_or_publication":
            if source_answer_role in {"example", "example_evidence"}:
                score += 18
            if _source_mentions_paper_or_publication(source):
                score += 20
    elif source_has_negative_polarity(source):
        score -= 4
    return score


def infer_evidence_query_intent(query_text: str) -> EvidenceQueryIntent:
    normalized = _normalize_query(query_text)
    if not normalized:
        return EvidenceQueryIntent()
    action_type = infer_query_action_type(query_text)
    condition_subject = infer_query_condition_subject(query_text)
    category_id = infer_query_category_id(query_text)
    if query_requests_negative_polarity(query_text):
        return EvidenceQueryIntent(
            polarity="negative",
            answer_role="restriction",
            action_type=action_type,
            condition_subject=condition_subject,
            category_id=category_id,
        )
    if any(cue in normalized for cue in _DISCOVERY_QUERY_CUES):
        return EvidenceQueryIntent(
            polarity="neutral",
            answer_role="policy_list",
            action_type=action_type,
            condition_subject=condition_subject,
            category_id=category_id,
        )
    if condition_subject in {"material_requirement", "deadline", "amount_or_quota"}:
        return EvidenceQueryIntent(
            polarity="positive",
            answer_role="condition",
            action_type=action_type,
            condition_subject=condition_subject,
            category_id=category_id,
        )
    if any(cue in normalized for cue in _PROCEDURE_QUERY_CUES) or action_type:
        return EvidenceQueryIntent(
            polarity="positive",
            answer_role="procedure",
            action_type=action_type,
            condition_subject=condition_subject,
            category_id=category_id,
        )
    if any(cue in normalized for cue in _CONDITION_QUERY_CUES):
        return EvidenceQueryIntent(
            polarity="positive",
            answer_role="condition",
            action_type=action_type,
            condition_subject=condition_subject,
            category_id=category_id,
        )
    if condition_subject:
        return EvidenceQueryIntent(
            polarity="positive",
            answer_role="condition",
            action_type=action_type,
            condition_subject=condition_subject,
            category_id=category_id,
        )
    if action_type:
        return EvidenceQueryIntent(
            polarity="positive",
            answer_role="procedure",
            action_type=action_type,
            condition_subject=condition_subject,
            category_id=category_id,
        )
    return EvidenceQueryIntent()


def source_conflicts_with_query_polarity(
    *,
    query_text: str,
    source: EvidenceSource,
) -> bool:
    attributes = evidence_attributes_for_source(source)
    source_answer_role = attributes.answer_role
    source_claim_type = attributes.claim_type
    return query_requests_positive_procedure(query_text) and (
        source_has_negative_polarity(source)
        or source_answer_role in _NEGATIVE_SOURCE_ROLES
        or source_claim_type == "cannot_do"
        or _contains_negative_source_cue(source.snippet)
    )


def query_requests_positive_procedure(query_text: str) -> bool:
    intent = infer_evidence_query_intent(query_text)
    return intent.polarity == "positive" and intent.answer_role == "procedure"


def query_requests_negative_polarity(query_text: str) -> bool:
    normalized = _normalize_query(query_text)
    if not normalized:
        return False
    if any(cue in normalized for cue in _NEGATIVE_QUERY_CUES):
        return True
    return bool(re.search(r"(哪些|什么).{0,8}(情况|情形).{0,8}(不能|不得|不予)", normalized))


def infer_query_action_type(query_text: str) -> str:
    normalized = _normalize_query(query_text)
    if any(cue in normalized for cue in _LIFT_DISCIPLINE_QUERY_CUES):
        return "lift_discipline"
    if any(cue in normalized for cue in _REISSUE_QUERY_CUES):
        return "reissue"
    return ""


def infer_query_condition_subject(query_text: str) -> str:
    normalized = _normalize_query(query_text)
    if any(cue in normalized for cue in _AUDIENCE_SCOPE_QUERY_CUES):
        return "audience_scope"
    if any(cue in normalized for cue in _LIFT_DISCIPLINE_QUERY_CUES) and any(
        cue in normalized for cue in _PROCEDURE_QUERY_CUES
    ):
        return "application_procedure"
    if any(cue in normalized for cue in _MATERIAL_QUERY_CUES):
        return "material_requirement"
    if any(cue in normalized for cue in _ATTENDANCE_ABSENCE_QUERY_CUES) and any(
        cue in normalized for cue in _CLASS_HOUR_QUERY_CUES
    ):
        return "attendance_absence_threshold"
    if any(cue in normalized for cue in _DEADLINE_QUERY_CUES):
        return "deadline"
    if any(cue in normalized for cue in _AMOUNT_OR_QUOTA_QUERY_CUES):
        return "amount_or_quota"
    if any(cue in normalized for cue in _RANK_THRESHOLD_QUERY_CUES):
        return "rank_threshold"
    if any(cue in normalized for cue in _PAPER_PUBLICATION_QUERY_CUES):
        return "paper_or_publication"
    return ""


def infer_query_category_id(query_text: str) -> str:
    normalized = _normalize_query(query_text)
    if any(cue in normalized for cue in _SCHOLARSHIP_CATEGORY_QUERY_CUES):
        return "scholarship"
    return ""


def source_has_negative_polarity(source: EvidenceSource) -> bool:
    attributes = evidence_attributes_for_source(source)
    return (
        attributes.polarity == "negative"
        or attributes.answer_role in _NEGATIVE_SOURCE_ROLES
        or _contains_negative_source_cue(source.snippet)
    )


def source_has_positive_polarity(source: EvidenceSource) -> bool:
    attributes = evidence_attributes_for_source(source)
    if attributes.polarity == "positive":
        return True
    return not source_has_negative_polarity(source) and source.is_answer_bearing


def _contains_negative_source_cue(value: str) -> bool:
    normalized = _normalize_query(value)
    return any(
        cue in normalized for cue in ("不予", "不能", "不得", "严禁", "禁止", "取消", "不予受理")
    )


def _source_mentions_rank_exception_window(source: EvidenceSource) -> bool:
    normalized = _normalize_query(_source_semantic_text(source))
    return ("超出前10" in normalized or "超出前十" in normalized) and (
        "前30" in normalized or "前三十" in normalized
    )


def _source_mentions_top_ten_requirement(source: EvidenceSource) -> bool:
    normalized = _normalize_query(_source_semantic_text(source))
    return "前10" in normalized or "前十" in normalized


def _source_mentions_paper_or_publication(source: EvidenceSource) -> bool:
    normalized = _normalize_query(_source_semantic_text(source))
    return any(cue in normalized for cue in _PAPER_PUBLICATION_QUERY_CUES)


def _source_semantic_text(source: EvidenceSource) -> str:
    return " ".join(
        fragment
        for fragment in (
            source.source_title,
            source.detail_label,
            source.snippet,
        )
        if fragment
    )


def _normalize_query(value: str) -> str:
    return re.sub(r"\s+", "", value.strip().lower())


__all__ = [
    "EvidenceQueryIntent",
    "infer_evidence_query_intent",
    "infer_query_action_type",
    "infer_query_category_id",
    "infer_query_condition_subject",
    "query_requests_negative_polarity",
    "query_requests_positive_procedure",
    "semantic_alignment_score",
    "source_conflicts_with_query_polarity",
    "source_has_negative_polarity",
    "source_has_positive_polarity",
]
