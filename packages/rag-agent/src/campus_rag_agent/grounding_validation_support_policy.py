from __future__ import annotations

from campus_contracts import ClaimSupport

from .grounding_validation_claim_models import ExtractedClaim
from .grounding_validation_support import SupportCandidate, _find_support_candidate
from .grounding_validation_trust_policy import (
    _is_claim_source_trust_tier_compatible,
    _required_source_trust_tier_for_claim_type,
)


def _build_claim_support(
    claim: ExtractedClaim,
    *,
    support_candidates: tuple[SupportCandidate, ...],
) -> ClaimSupport:
    required_source_trust_tier = _required_source_trust_tier_for_claim_type(claim.claim_type)
    candidate = _find_support_candidate(claim.claim_text, support_candidates=support_candidates)
    if claim.claim_type == "authorization_sensitive_claim":
        return ClaimSupport(
            claim_type=claim.claim_type,
            claim_text=claim.claim_text,
            supported=False,
            support_source_doc_id=candidate.support_source_doc_id if candidate is not None else "",
            support_snippet=candidate.support_snippet if candidate is not None else "",
            required_source_trust_tier=required_source_trust_tier,
            support_source_trust_tier=(
                candidate.support_source_trust_tier if candidate is not None else ""
            ),
        )
    if candidate is None:
        return ClaimSupport(
            claim_type=claim.claim_type,
            claim_text=claim.claim_text,
            supported=False,
            required_source_trust_tier=required_source_trust_tier,
        )
    if not _is_claim_source_trust_tier_compatible(
        claim.claim_type,
        support_source_trust_tier=candidate.support_source_trust_tier,
    ):
        return ClaimSupport(
            claim_type=claim.claim_type,
            claim_text=claim.claim_text,
            supported=False,
            support_source_doc_id=candidate.support_source_doc_id,
            support_snippet=candidate.support_snippet,
            required_source_trust_tier=required_source_trust_tier,
            support_source_trust_tier=candidate.support_source_trust_tier,
        )
    return ClaimSupport(
        claim_type=claim.claim_type,
        claim_text=claim.claim_text,
        supported=True,
        support_source_doc_id=candidate.support_source_doc_id,
        support_snippet=candidate.support_snippet,
        required_source_trust_tier=required_source_trust_tier,
        support_source_trust_tier=candidate.support_source_trust_tier,
    )


__all__ = ["_build_claim_support"]
