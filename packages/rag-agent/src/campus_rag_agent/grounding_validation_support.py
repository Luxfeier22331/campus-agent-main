from __future__ import annotations

import re
from dataclasses import dataclass

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_shared import (
    NormalizedProviderGroundingSupport,
    normalize_provider_grounding_supports,
)

from campus_rag_agent.grounding_validation_text import _normalize_matching_text
from campus_rag_agent.remote_content_hardening import (
    assess_provider_grounding_support_suspicion,
    ensure_remote_content_suspicion_labels,
)


@dataclass(frozen=True, slots=True)
class SupportCandidate:
    support_source_doc_id: str
    support_snippet: str
    haystack: str
    support_source_trust_tier: str


def _build_support_candidates(
    evidence: EvidenceBundle,
    *,
    provider_grounding_supports: object | tuple[NormalizedProviderGroundingSupport, ...] | None,
) -> tuple[SupportCandidate, ...]:
    candidates: list[SupportCandidate] = []
    for source in evidence.sources:
        candidates.extend(_build_source_support_candidates(source))
    default_provider_support_source_trust_tier = _default_source_trust_tier_for_bundle(evidence)
    for support in _normalize_optional_provider_supports(provider_grounding_supports):
        snippet = support.support_snippet.strip() or support.claim_text.strip()
        if assess_provider_grounding_support_suspicion(
            claim_text=support.claim_text,
            support_snippet=snippet,
        ).is_suspicious:
            continue
        haystack = _normalize_matching_text(f"{support.claim_text} {snippet}")
        if not haystack:
            continue
        candidates.append(
            SupportCandidate(
                support_source_doc_id=support.support_source_doc_id,
                support_snippet=snippet,
                haystack=haystack,
                support_source_trust_tier=default_provider_support_source_trust_tier,
            )
        )
    return tuple(_dedupe_support_candidates(candidates))


def _build_source_support_candidates(source: EvidenceSource) -> tuple[SupportCandidate, ...]:
    if ensure_remote_content_suspicion_labels(source):
        return ()
    snippets = [
        source.source_title.strip(),
        source.detail_label.strip(),
        *(item.strip() for item in source.structural_path if item.strip()),
        source.snippet.strip(),
    ]
    candidates: list[SupportCandidate] = []
    for snippet in snippets:
        haystack = _normalize_matching_text(snippet)
        if not haystack:
            continue
        candidates.append(
            SupportCandidate(
                support_source_doc_id=source.doc_id,
                support_snippet=snippet,
                haystack=haystack,
                support_source_trust_tier=source.source_trust_tier,
            )
        )
    combined_text = " ".join(snippet for snippet in snippets if snippet)
    combined_haystack = _normalize_matching_text(combined_text)
    if combined_haystack:
        candidates.append(
            SupportCandidate(
                support_source_doc_id=source.doc_id,
                support_snippet=source.snippet.strip() or source.source_title.strip(),
                haystack=combined_haystack,
                support_source_trust_tier=source.source_trust_tier,
            )
        )
    return tuple(_dedupe_support_candidates(candidates))


def _dedupe_support_candidates(
    candidates: list[SupportCandidate],
) -> tuple[SupportCandidate, ...]:
    deduped: list[SupportCandidate] = []
    seen: set[tuple[str, str, str, str]] = set()
    for candidate in candidates:
        key = (
            candidate.support_source_doc_id,
            candidate.support_snippet,
            candidate.haystack,
            candidate.support_source_trust_tier,
        )
        if key in seen:
            continue
        seen.add(key)
        deduped.append(candidate)
    return tuple(deduped)


def _normalize_optional_provider_supports(
    payload: object | tuple[NormalizedProviderGroundingSupport, ...] | None,
) -> tuple[NormalizedProviderGroundingSupport, ...]:
    if payload is None:
        return ()
    if isinstance(payload, tuple) and all(
        isinstance(item, NormalizedProviderGroundingSupport) for item in payload
    ):
        return payload
    return normalize_provider_grounding_supports(payload)


def _default_source_trust_tier_for_bundle(evidence: EvidenceBundle) -> str:
    if evidence.sources:
        return evidence.sources[0].source_trust_tier
    if evidence.collection in {
        "curriculum_plan",
        "program_semester_facts",
        "program_family_facts",
        "course_facts",
    }:
        return "T0"
    if evidence.collection == "student_rules":
        return "T1"
    if evidence.collection == "stable_reference":
        return "T2"
    if evidence.collection == "fresh_news":
        return "T3"
    if evidence.corpus == "official_web":
        return "T2"
    return "T1"


def _find_support_candidate(
    claim_text: str,
    *,
    support_candidates: tuple[SupportCandidate, ...],
) -> SupportCandidate | None:
    normalized_claim = _normalize_matching_text(claim_text)
    if not normalized_claim:
        return None
    for candidate in support_candidates:
        if normalized_claim in candidate.haystack:
            return candidate
    alias_pattern = _build_material_alias_pattern(
        claim_text,
        normalized_claim=normalized_claim,
    )
    if alias_pattern is None:
        return None
    for candidate in support_candidates:
        if alias_pattern.search(candidate.haystack):
            return candidate
    return None


def _build_material_alias_pattern(
    claim_text: str,
    *,
    normalized_claim: str,
) -> re.Pattern[str] | None:
    if not claim_text.strip().endswith("申请表") or not normalized_claim.endswith("申请表"):
        return None
    prefix = normalized_claim[: -len("申请表")].strip()
    if not prefix:
        return None
    return re.compile(f"{re.escape(prefix)}[\\u4e00-\\u9fffA-Za-z0-9]{{0,12}}申请表")
