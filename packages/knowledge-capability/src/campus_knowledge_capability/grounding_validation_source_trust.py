from __future__ import annotations

from campus_contracts import ClaimSupport, EvidenceBundle, SourceTrustSummary

from .grounding_validation_trust_policy import _is_claim_source_trust_tier_compatible

_SOURCE_TRUST_TIER_ORDER = {"T0": 0, "T1": 1, "T2": 2, "T3": 3}


def build_source_trust_summary(
    *,
    evidence: EvidenceBundle,
    claim_supports: tuple[ClaimSupport, ...] = (),
) -> SourceTrustSummary | None:
    observed_tiers = {
        source.source_trust_tier for source in evidence.sources if source.source_trust_tier
    }
    observed_tiers.update(
        claim.support_source_trust_tier
        for claim in claim_supports
        if claim.support_source_trust_tier
    )
    answer_bearing_tiers = {
        source.source_trust_tier
        for source in evidence.sources
        if source.is_answer_bearing and source.source_trust_tier
    }
    answer_bearing_tiers.update(
        claim.support_source_trust_tier
        for claim in claim_supports
        if claim.supported and claim.support_source_trust_tier
    )

    blocked_claim_types: list[str] = []
    freshness_claim_blocked = False
    authorization_claim_blocked = False
    for claim in claim_supports:
        if claim.claim_type == "authorization_sensitive_claim" and not claim.supported:
            authorization_claim_blocked = True
            blocked_claim_types.append(claim.claim_type)
            continue
        if (
            not claim.supported
            and claim.required_source_trust_tier
            and claim.support_source_trust_tier
            and not _is_claim_source_trust_tier_compatible(
                claim.claim_type,
                support_source_trust_tier=claim.support_source_trust_tier,
            )
        ):
            blocked_claim_types.append(claim.claim_type)
            if claim.claim_type == "freshness_sensitive_status":
                freshness_claim_blocked = True

    if not observed_tiers and not blocked_claim_types and not authorization_claim_blocked:
        return None

    return SourceTrustSummary(
        observed_tiers=_sorted_source_trust_tiers(observed_tiers),
        answer_bearing_tiers=_sorted_source_trust_tiers(answer_bearing_tiers),
        blocked_claim_types=tuple(dict.fromkeys(blocked_claim_types)),
        freshness_claim_blocked=freshness_claim_blocked,
        authorization_claim_blocked=authorization_claim_blocked,
    )


def _sorted_source_trust_tiers(tiers: set[str]) -> tuple[str, ...]:
    return tuple(sorted(tiers, key=lambda tier: _SOURCE_TRUST_TIER_ORDER.get(tier, 99)))


__all__ = ["build_source_trust_summary"]
