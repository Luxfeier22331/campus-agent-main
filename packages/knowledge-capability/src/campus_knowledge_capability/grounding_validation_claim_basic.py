from __future__ import annotations

from .grounding_validation_claim_models import ExtractedClaim
from .grounding_validation_claim_normalization import (
    _expand_audience_claim,
    _normalize_offering_unit_claim,
)
from .grounding_validation_claim_patterns import (
    _AUDIENCE_CUE_TOKENS,
    _AUDIENCE_MAJOR_GROUP_RE,
    _AUDIENCE_POPULATION_RE,
    _CLAUSE_SPLIT_RE,
    _DEGREE_OR_CREDENTIAL_RE,
    _OFFERING_UNIT_NAME_RE,
    _OFFERING_UNIT_PREFIX_CUES,
    _OFFERING_UNIT_SUFFIX_CUES,
    _QUANTITY_CLAIM_RE,
    _QUOTED_TITLE_RE,
    _SEMESTER_OR_TERM_RE,
    _TIME_CLAIM_RE,
)
from .grounding_validation_claim_requirements import _extract_requirement_claims
from .grounding_validation_claim_sensitive import (
    _extract_authorization_sensitive_claims,
    _extract_freshness_sensitive_status_claims,
)
from .grounding_validation_text import (
    _normalize_matching_text,
    _normalize_text,
    _sanitize_answer_text,
)

_UNCERTAINTY_CUES = ("不能稳定确认", "无法确认", "不能确认", "尚不能确认", "还不能确认")


def _extract_claims(answer_text: str) -> tuple[ExtractedClaim, ...]:
    claims: list[ExtractedClaim] = []
    extractors = (
        _extract_title_claims,
        _extract_time_claims,
        _extract_quantity_claims,
        _extract_semester_or_term_claims,
        _extract_degree_or_credential_claims,
        _extract_offering_unit_claims,
        _extract_audience_claims,
        _extract_requirement_claims,
        _extract_freshness_sensitive_status_claims,
        _extract_authorization_sensitive_claims,
    )
    for extractor in extractors:
        claims.extend(extractor(answer_text))

    deduped: list[ExtractedClaim] = []
    seen: set[tuple[str, str]] = set()
    for claim in claims:
        normalized_claim = _normalize_matching_text(claim.claim_text)
        if not normalized_claim:
            continue
        key = (claim.claim_type, normalized_claim)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(claim)
    return tuple(deduped)


def _extract_title_claims(answer_text: str) -> tuple[ExtractedClaim, ...]:
    claims = tuple(
        ExtractedClaim(
            claim_type="title_or_entity_identity",
            claim_text=match.group(1).strip(),
            unsupported_summary_field="title_claims",
        )
        for match in _QUOTED_TITLE_RE.finditer(answer_text)
        if match.group(1).strip()
    )
    if any(
        claim.claim_text.endswith("申请表") or claim.claim_text.endswith("报名表")
        for claim in claims
    ):
        return tuple(
            claim
            for claim in claims
            if not (claim.claim_text.endswith("申请表") or claim.claim_text.endswith("报名表"))
        )
    return claims


def _extract_time_claims(answer_text: str) -> tuple[ExtractedClaim, ...]:
    sanitized = _sanitize_answer_text(answer_text)
    return tuple(
        ExtractedClaim(
            claim_type="time_or_deadline",
            claim_text=match.group(1).strip(),
            unsupported_summary_field="time_claims",
        )
        for match in _TIME_CLAIM_RE.finditer(sanitized)
        if match.group(1).strip()
    )


def _extract_quantity_claims(answer_text: str) -> tuple[ExtractedClaim, ...]:
    sanitized = _sanitize_answer_text(answer_text)
    return tuple(
        ExtractedClaim(
            claim_type="quantity_or_credit_or_score_requirement",
            claim_text=match.group(1).strip(),
            unsupported_summary_field="quantity_or_credit_or_score_requirement_claims",
        )
        for match in _QUANTITY_CLAIM_RE.finditer(sanitized)
        if match.group(1).strip()
    )


def _extract_semester_or_term_claims(answer_text: str) -> tuple[ExtractedClaim, ...]:
    sanitized = _sanitize_answer_text(answer_text)
    return tuple(
        ExtractedClaim(
            claim_type="semester_or_grade_or_term_placement",
            claim_text=match.group(1).strip(),
            unsupported_summary_field="semester_or_grade_or_term_placement_claims",
        )
        for match in _SEMESTER_OR_TERM_RE.finditer(sanitized)
        if match.group(1).strip()
    )


def _extract_degree_or_credential_claims(answer_text: str) -> tuple[ExtractedClaim, ...]:
    sanitized = _sanitize_answer_text(answer_text)
    return tuple(
        ExtractedClaim(
            claim_type="degree_or_credential",
            claim_text=match.group(1).strip(),
            unsupported_summary_field="table_fact_claims",
        )
        for match in _DEGREE_OR_CREDENTIAL_RE.finditer(sanitized)
        if match.group(1).strip()
    )


def _extract_offering_unit_claims(answer_text: str) -> tuple[ExtractedClaim, ...]:
    claims: list[ExtractedClaim] = []
    sanitized = _sanitize_answer_text(answer_text)
    for clause in _CLAUSE_SPLIT_RE.split(sanitized):
        normalized_clause = _normalize_text(clause)
        if not normalized_clause:
            continue
        if any(cue in normalized_clause for cue in _UNCERTAINTY_CUES):
            continue
        for match in _OFFERING_UNIT_NAME_RE.finditer(normalized_clause):
            claim_text = _normalize_offering_unit_claim(match.group(1))
            if not claim_text:
                continue
            prefix = normalized_clause[max(0, match.start(1) - 12) : match.start(1)]
            suffix = normalized_clause[match.end(1) : match.end(1) + 12]
            if not (
                any(cue in prefix for cue in _OFFERING_UNIT_PREFIX_CUES)
                or any(cue in suffix for cue in _OFFERING_UNIT_SUFFIX_CUES)
            ):
                continue
            claims.append(
                ExtractedClaim(
                    claim_type="offering_unit_or_owning_school",
                    claim_text=claim_text,
                    unsupported_summary_field="offering_unit_claims",
                )
            )
    return tuple(claims)


def _extract_audience_claims(answer_text: str) -> tuple[ExtractedClaim, ...]:
    claims: list[ExtractedClaim] = []
    sanitized = _sanitize_answer_text(answer_text)
    for clause in _CLAUSE_SPLIT_RE.split(sanitized):
        normalized_clause = _normalize_text(clause)
        if not normalized_clause:
            continue
        if not any(token in normalized_clause for token in _AUDIENCE_CUE_TOKENS):
            continue
        for match in _AUDIENCE_MAJOR_GROUP_RE.finditer(normalized_clause):
            raw_group = match.group(1).strip("，,；;：:。 ")
            if not raw_group.endswith("专业"):
                continue
            for claim_text in _expand_audience_claim(raw_group):
                claims.append(
                    ExtractedClaim(
                        claim_type="audience_or_major_or_program_or_class_family",
                        claim_text=claim_text,
                        unsupported_summary_field="audience_claims",
                    )
                )
        for match in _AUDIENCE_POPULATION_RE.finditer(normalized_clause):
            claim_text = match.group(1).strip("，,；;：:。 ")
            if not claim_text:
                continue
            claims.append(
                ExtractedClaim(
                    claim_type="audience_or_major_or_program_or_class_family",
                    claim_text=claim_text,
                    unsupported_summary_field="audience_claims",
                )
            )
    return tuple(claims)


__all__ = [
    "_extract_audience_claims",
    "_extract_claims",
    "_extract_degree_or_credential_claims",
    "_extract_offering_unit_claims",
    "_extract_quantity_claims",
    "_extract_semester_or_term_claims",
    "_extract_time_claims",
    "_extract_title_claims",
]
