from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Literal

from campus_contracts import EvidenceSource

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
_NEGATIVE_SOURCE_ROLES = frozenset({"exception", "prohibition", "exclusion"})
_POSITIVE_SOURCE_ROLES = frozenset({"procedure_step", "condition"})
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
_DISCOVERY_QUERY_CUES = ("有哪些", "都有什么", "有什么", "哪些")


@dataclass(frozen=True, slots=True)
class EvidenceQueryIntent:
    polarity: EvidenceQueryPolarity = "neutral"
    answer_role: EvidenceQueryAnswerRole = "neutral"
    action_type: str = ""

    @property
    def is_strong(self) -> bool:
        return self.polarity != "neutral" or self.answer_role != "neutral" or bool(self.action_type)


def semantic_alignment_score(*, query_text: str, source: EvidenceSource) -> int:
    score = 0
    intent = infer_evidence_query_intent(query_text)
    if intent.action_type and source.action_type == intent.action_type:
        score += 8
    if intent.polarity == "negative":
        if source_has_negative_polarity(source):
            score += 36
        if source.semantic_role in _NEGATIVE_SOURCE_ROLES:
            score += 20
        if source.claim_type == "cannot_do":
            score += 18
        if source_has_positive_polarity(source) and source.semantic_role in _POSITIVE_SOURCE_ROLES:
            score -= 8
        return score
    if intent.polarity == "positive" and intent.answer_role == "procedure":
        if source_has_negative_polarity(source):
            score -= 42
        if source.semantic_role in _NEGATIVE_SOURCE_ROLES:
            score -= 24
        if source.claim_type == "cannot_do":
            score -= 22
        if source_has_positive_polarity(source):
            score += 24
        if source.semantic_role in _POSITIVE_SOURCE_ROLES:
            score += 16
    elif intent.polarity == "positive":
        if source_has_negative_polarity(source):
            score -= 24
        if source_has_positive_polarity(source):
            score += 16
    elif source_has_negative_polarity(source):
        score -= 4
    return score


def infer_evidence_query_intent(query_text: str) -> EvidenceQueryIntent:
    normalized = _normalize_query(query_text)
    if not normalized:
        return EvidenceQueryIntent()
    action_type = infer_query_action_type(query_text)
    if query_requests_negative_polarity(query_text):
        return EvidenceQueryIntent(
            polarity="negative",
            answer_role="restriction",
            action_type=action_type,
        )
    if any(cue in normalized for cue in _PROCEDURE_QUERY_CUES) or action_type:
        return EvidenceQueryIntent(
            polarity="positive",
            answer_role="procedure",
            action_type=action_type,
        )
    if any(cue in normalized for cue in _DISCOVERY_QUERY_CUES):
        return EvidenceQueryIntent(
            polarity="neutral",
            answer_role="policy_list",
            action_type=action_type,
        )
    if any(cue in normalized for cue in _CONDITION_QUERY_CUES):
        return EvidenceQueryIntent(
            polarity="positive",
            answer_role="condition",
            action_type=action_type,
        )
    if action_type:
        return EvidenceQueryIntent(
            polarity="positive",
            answer_role="procedure",
            action_type=action_type,
        )
    return EvidenceQueryIntent()


def source_conflicts_with_query_polarity(
    *,
    query_text: str,
    source: EvidenceSource,
) -> bool:
    return query_requests_positive_procedure(query_text) and (
        source_has_negative_polarity(source)
        or source.semantic_role in _NEGATIVE_SOURCE_ROLES
        or source.claim_type == "cannot_do"
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


def source_has_negative_polarity(source: EvidenceSource) -> bool:
    return source.polarity == "negative" or _contains_negative_source_cue(source.snippet)


def source_has_positive_polarity(source: EvidenceSource) -> bool:
    if source.polarity == "positive":
        return True
    return not source_has_negative_polarity(source) and source.is_answer_bearing


def _contains_negative_source_cue(value: str) -> bool:
    normalized = _normalize_query(value)
    return any(
        cue in normalized for cue in ("不予", "不能", "不得", "严禁", "禁止", "取消", "不予受理")
    )


def _normalize_query(value: str) -> str:
    return re.sub(r"\s+", "", value.strip().lower())


__all__ = [
    "EvidenceQueryIntent",
    "infer_evidence_query_intent",
    "infer_query_action_type",
    "query_requests_negative_polarity",
    "query_requests_positive_procedure",
    "semantic_alignment_score",
    "source_conflicts_with_query_polarity",
    "source_has_negative_polarity",
    "source_has_positive_polarity",
]
