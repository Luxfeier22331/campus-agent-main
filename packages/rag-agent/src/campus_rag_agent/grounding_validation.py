from __future__ import annotations

from dataclasses import dataclass

from campus_contracts import ClaimSupport, EvidenceBundle, SourceTrustSummary
from campus_shared import NormalizedProviderGroundingSupport

from campus_rag_agent.grounding_validation_claim_basic import _extract_claims
from campus_rag_agent.grounding_validation_claim_models import ExtractedClaim
from campus_rag_agent.grounding_validation_support import (
    SupportCandidate,
    _build_support_candidates,
    _find_support_candidate,
)

_SOURCE_TRUST_TIER_ORDER = {"T0": 0, "T1": 1, "T2": 2, "T3": 3}
_CURRICULUM_T0_CLAIM_TYPES = frozenset(
    {
        "quantity_or_credit_or_score_requirement",
        "semester_or_grade_or_term_placement",
        "audience_or_major_or_program_or_class_family",
        "offering_unit_or_owning_school",
    }
)
_HANDBOOK_T1_CLAIM_TYPES = frozenset(
    {
        "procedure_step",
        "material_requirement",
        "eligibility_requirement",
        "time_or_deadline",
    }
)


@dataclass(frozen=True, slots=True)
class GroundingValidationResult:
    verdict: str
    unsupported_fields: tuple[str, ...] = ()
    claim_supports: tuple[ClaimSupport, ...] = ()
    source_trust_summary: SourceTrustSummary | None = None


def validate_prompt_answer_grounding(
    *,
    answer_text: str,
    evidence: EvidenceBundle,
    provider_grounding_supports: object
    | tuple[NormalizedProviderGroundingSupport, ...]
    | None = None,
) -> GroundingValidationResult:
    support_candidates = _build_support_candidates(
        evidence,
        provider_grounding_supports=provider_grounding_supports,
    )
    extracted_claims = _extract_claims(answer_text)
    claim_supports = tuple(
        _build_claim_support(claim, support_candidates=support_candidates)
        for claim in extracted_claims
    )

    unsupported_fields: list[str] = []
    if not support_candidates:
        unsupported_fields.append("citation_missing")
    unsupported_fields.extend(
        claim.unsupported_summary_field
        for claim, claim_support in zip(extracted_claims, claim_supports, strict=False)
        if not claim_support.supported
    )
    deduped_unsupported_fields = tuple(dict.fromkeys(unsupported_fields))
    verdict = "grounded" if not deduped_unsupported_fields else "unsupported"
    source_trust_summary = build_source_trust_summary(
        evidence=evidence,
        claim_supports=claim_supports,
    )
    return GroundingValidationResult(
        verdict=verdict,
        unsupported_fields=deduped_unsupported_fields,
        claim_supports=claim_supports,
        source_trust_summary=source_trust_summary,
    )


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


def _required_source_trust_tier_for_claim_type(claim_type: str) -> str:
    if claim_type == "freshness_sensitive_status":
        return "T3"
    if claim_type in _CURRICULUM_T0_CLAIM_TYPES:
        return "T0"
    if claim_type in _HANDBOOK_T1_CLAIM_TYPES:
        return "T1"
    return ""


def _is_claim_source_trust_tier_compatible(
    claim_type: str,
    *,
    support_source_trust_tier: str,
) -> bool:
    if not support_source_trust_tier:
        return False
    if claim_type == "authorization_sensitive_claim":
        return False
    if claim_type == "freshness_sensitive_status":
        return support_source_trust_tier == "T3"
    if claim_type in _CURRICULUM_T0_CLAIM_TYPES:
        return support_source_trust_tier == "T0"
    if claim_type in _HANDBOOK_T1_CLAIM_TYPES:
        return support_source_trust_tier in {"T0", "T1"}
    return True


def _sorted_source_trust_tiers(tiers: set[str]) -> tuple[str, ...]:
    return tuple(sorted(tiers, key=lambda tier: _SOURCE_TRUST_TIER_ORDER.get(tier, 99)))


__all__ = [
    "GroundingValidationResult",
    "validate_prompt_answer_grounding",
]
