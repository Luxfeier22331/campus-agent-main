from __future__ import annotations

import re

from .grounding_validation_claim_models import ExtractedClaim
from .grounding_validation_claim_normalization import (
    _normalize_material_claim,
    _normalize_procedure_claim,
)
from .grounding_validation_claim_patterns import (
    _CLAUSE_SPLIT_RE,
    _ELIGIBILITY_CLAIM_PATTERNS,
    _LOW_SIGNAL_REQUIREMENT_PHRASES,
    _MATERIAL_ACTION_RE,
    _MATERIAL_DIRECT_RE,
    _MATERIAL_LIST_RE,
    _PROCEDURE_CLAIM_PATTERNS,
)
from .grounding_validation_text import _normalize_text, _sanitize_answer_text


def _extract_requirement_claims(answer_text: str) -> tuple[ExtractedClaim, ...]:
    claims: list[ExtractedClaim] = []
    sanitized = _sanitize_answer_text(answer_text)
    for clause in _CLAUSE_SPLIT_RE.split(sanitized):
        normalized_clause = _normalize_text(clause)
        if not normalized_clause:
            continue
        claims.extend(_extract_material_requirement_claims(normalized_clause))
        claims.extend(_extract_procedure_step_claims(normalized_clause))
        claims.extend(_extract_eligibility_requirement_claims(normalized_clause))
    return tuple(claims)


def _extract_material_requirement_claims(clause: str) -> tuple[ExtractedClaim, ...]:
    if _is_missing_information_clause(clause):
        return ()
    if any(token in clause for token in ("审核", "审批", "备案", "挂失", "办理")) and not any(
        token in clause for token in ("材料", "申请表", "书面申请", "证明", "证件", "原件", "复印件")
    ):
        return ()
    claims: list[ExtractedClaim] = []
    for match in _MATERIAL_DIRECT_RE.finditer(clause):
        claim_text = _normalize_material_claim(match.group(1))
        if not claim_text:
            continue
        claims.append(
            ExtractedClaim(
                claim_type="material_requirement",
                claim_text=claim_text,
                unsupported_summary_field="requirement_claims",
            )
        )
    for match in _MATERIAL_ACTION_RE.finditer(clause):
        claim_text = _normalize_material_claim(match.group(1))
        if not claim_text:
            continue
        claims.append(
            ExtractedClaim(
                claim_type="material_requirement",
                claim_text=claim_text,
                unsupported_summary_field="requirement_claims",
            )
        )
    for match in _MATERIAL_LIST_RE.finditer(clause):
        for item in _split_material_list(match.group(1)):
            claim_text = _normalize_material_claim(item)
            if not claim_text or claim_text in _LOW_SIGNAL_REQUIREMENT_PHRASES:
                continue
            claims.append(
                ExtractedClaim(
                    claim_type="material_requirement",
                    claim_text=claim_text,
                    unsupported_summary_field="requirement_claims",
                )
            )
    return tuple(claims)


def _extract_procedure_step_claims(clause: str) -> tuple[ExtractedClaim, ...]:
    claims: list[ExtractedClaim] = []
    if _is_missing_information_clause(clause):
        return ()
    if not any(
        token in clause
        for token in (
            "办理",
            "审核",
            "审批",
            "备案",
            "盖章",
            "挂失",
            "报到",
            "选课",
            "缴费",
            "注册",
        )
    ):
        return ()
    for pattern in _PROCEDURE_CLAIM_PATTERNS:
        for match in pattern.finditer(clause):
            claim_text = _normalize_procedure_claim(match.group(1))
            if not claim_text or claim_text in _LOW_SIGNAL_REQUIREMENT_PHRASES:
                continue
            claims.append(
                ExtractedClaim(
                    claim_type="procedure_step",
                    claim_text=claim_text,
                    unsupported_summary_field="requirement_claims",
                )
            )
    return tuple(
        claim
        for claim in claims
        if claim.claim_text not in {"审批", "审核"}
        or any(token in clause for token in ("先", "再", "后", "及时", "应", "到"))
    )


def _extract_eligibility_requirement_claims(clause: str) -> tuple[ExtractedClaim, ...]:
    claims: list[ExtractedClaim] = []
    for pattern in _ELIGIBILITY_CLAIM_PATTERNS:
        for match in pattern.finditer(clause):
            claim_text = match.group(1).strip("，,；;：:。 ")
            if not claim_text:
                continue
            claims.append(
                ExtractedClaim(
                    claim_type="eligibility_requirement",
                    claim_text=claim_text,
                    unsupported_summary_field="requirement_claims",
                )
            )
    return tuple(claims)


__all__ = [
    "_extract_eligibility_requirement_claims",
    "_extract_material_requirement_claims",
    "_extract_procedure_step_claims",
    "_extract_requirement_claims",
]


def _split_material_list(raw_materials: str) -> tuple[str, ...]:
    normalized = raw_materials.strip("，,；;：:。 ")
    normalized = _trim_material_list_before_procedure(normalized)
    parts = [
        part.strip("，,；;：:。 ")
        for part in re.split(r"(?:、|，|,|/|以及|及|和)", normalized)
        if part.strip("，,；;：:。 ")
    ]
    if len(parts) <= 1:
        return (normalized,) if normalized else ()
    return tuple(dict.fromkeys(parts))


def _trim_material_list_before_procedure(normalized: str) -> str:
    for marker in ("并到", "再到", "然后到", "后到", "并由", "再由", "然后由"):
        if marker in normalized:
            return normalized.split(marker, 1)[0].strip("，,；;：:。 ")
    return normalized


def _is_missing_information_clause(clause: str) -> bool:
    return any(
        marker in clause
        for marker in (
            "未提供",
            "没有提供",
            "未说明",
            "没有说明",
            "未给出",
            "没有给出",
            "未包含",
            "没有包含",
        )
    )
