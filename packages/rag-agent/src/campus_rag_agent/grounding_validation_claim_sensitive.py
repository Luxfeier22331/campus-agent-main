from __future__ import annotations

from .grounding_validation_claim_models import ExtractedClaim
from .grounding_validation_claim_patterns import (
    _AUTHORIZATION_SENSITIVE_CLAIM_PATTERNS,
    _FRESHNESS_SENSITIVE_STATUS_PATTERNS,
)
from .grounding_validation_text import _sanitize_answer_text


def _extract_freshness_sensitive_status_claims(
    answer_text: str,
) -> tuple[ExtractedClaim, ...]:
    claims: list[ExtractedClaim] = []
    sanitized = _sanitize_answer_text(answer_text)
    for pattern in _FRESHNESS_SENSITIVE_STATUS_PATTERNS:
        for match in pattern.finditer(sanitized):
            claim_text = match.group(1).strip("，,；;：:。 ")
            if not claim_text:
                continue
            claims.append(
                ExtractedClaim(
                    claim_type="freshness_sensitive_status",
                    claim_text=claim_text,
                    unsupported_summary_field="freshness_sensitive_status_claims",
                )
            )
    return tuple(claims)


def _extract_authorization_sensitive_claims(answer_text: str) -> tuple[ExtractedClaim, ...]:
    claims: list[ExtractedClaim] = []
    sanitized = _sanitize_answer_text(answer_text)
    for pattern in _AUTHORIZATION_SENSITIVE_CLAIM_PATTERNS:
        for match in pattern.finditer(sanitized):
            claim_text = match.group(1).strip("，,；;：:。 ")
            if not claim_text:
                continue
            claims.append(
                ExtractedClaim(
                    claim_type="authorization_sensitive_claim",
                    claim_text=claim_text,
                    unsupported_summary_field="authorization_sensitive_claims",
                )
            )
    return tuple(claims)


__all__ = [
    "_extract_authorization_sensitive_claims",
    "_extract_freshness_sensitive_status_claims",
]
