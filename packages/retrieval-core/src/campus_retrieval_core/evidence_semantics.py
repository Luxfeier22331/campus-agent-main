from __future__ import annotations

import re

from campus_contracts import EvidenceSource

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


def semantic_alignment_score(*, query_text: str, source: EvidenceSource) -> int:
    score = 0
    query_action = infer_query_action_type(query_text)
    if query_action and source.action_type == query_action:
        score += 8
    if query_requests_negative_polarity(query_text):
        if source_has_negative_polarity(source):
            score += 36
        if source.semantic_role in _NEGATIVE_SOURCE_ROLES:
            score += 20
        if source.claim_type == "cannot_do":
            score += 18
        if source_has_positive_polarity(source) and source.semantic_role in _POSITIVE_SOURCE_ROLES:
            score -= 8
        return score
    if query_requests_positive_procedure(query_text):
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
    elif source_has_negative_polarity(source):
        score -= 4
    return score


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
    normalized = _normalize_query(query_text)
    if not normalized or query_requests_negative_polarity(query_text):
        return False
    if infer_query_action_type(query_text):
        return True
    return any(cue in normalized for cue in _PROCEDURE_QUERY_CUES)


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
    "infer_query_action_type",
    "query_requests_negative_polarity",
    "query_requests_positive_procedure",
    "semantic_alignment_score",
    "source_conflicts_with_query_polarity",
    "source_has_negative_polarity",
    "source_has_positive_polarity",
]
