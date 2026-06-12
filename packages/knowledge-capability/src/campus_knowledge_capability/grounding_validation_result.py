from __future__ import annotations

from dataclasses import dataclass

from campus_contracts import ClaimSupport, SourceTrustSummary


@dataclass(frozen=True, slots=True)
class GroundingValidationResult:
    verdict: str
    unsupported_fields: tuple[str, ...] = ()
    claim_supports: tuple[ClaimSupport, ...] = ()
    source_trust_summary: SourceTrustSummary | None = None


__all__ = ["GroundingValidationResult"]
