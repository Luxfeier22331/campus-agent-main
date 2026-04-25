from __future__ import annotations

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
    return tuple(claims)


def _extract_procedure_step_claims(clause: str) -> tuple[ExtractedClaim, ...]:
    claims: list[ExtractedClaim] = []
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
    return tuple(claims)


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
