from __future__ import annotations

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


__all__ = [
    "_is_claim_source_trust_tier_compatible",
    "_required_source_trust_tier_for_claim_type",
]
