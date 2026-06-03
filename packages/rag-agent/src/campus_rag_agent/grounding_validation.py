from __future__ import annotations

from campus_contracts import EvidenceBundle
from campus_prompt_runtime import NormalizedProviderGroundingSupport

from campus_rag_agent.grounding_validation_claim_basic import _extract_claims
from campus_rag_agent.grounding_validation_result import GroundingValidationResult
from campus_rag_agent.grounding_validation_source_trust import build_source_trust_summary
from campus_rag_agent.grounding_validation_support import _build_support_candidates
from campus_rag_agent.grounding_validation_support_policy import _build_claim_support


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


__all__ = [
    "GroundingValidationResult",
    "build_source_trust_summary",
    "validate_prompt_answer_grounding",
]
