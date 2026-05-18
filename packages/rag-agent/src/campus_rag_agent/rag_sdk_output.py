from __future__ import annotations

from dataclasses import dataclass, field

from campus_contracts import ClaimSupport

from campus_rag_agent.rag_sdk_models import RagSdkEvidenceAnchor, RagSdkEvidenceProjection


@dataclass(frozen=True, slots=True)
class RagSdkClaim:
    claim_id: str
    text: str
    claim_type: str = "fact"


@dataclass(frozen=True, slots=True)
class RagSdkListItem:
    text: str
    source_ids: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class RagSdkClaimSupport:
    claim_id: str
    anchors: tuple[RagSdkEvidenceAnchor, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class RagSdkListItemSupport:
    item_text: str
    anchors: tuple[RagSdkEvidenceAnchor, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class RagSdkAnswerOutput:
    answer_text: str
    answer_kind: str
    semantic_outcome: str
    confidence: str
    cited_source_ids: tuple[str, ...] = field(default_factory=tuple)
    answer_items: tuple[RagSdkListItem, ...] = field(default_factory=tuple)
    claims: tuple[RagSdkClaim, ...] = field(default_factory=tuple)
    claim_supports: tuple[RagSdkClaimSupport, ...] = field(default_factory=tuple)
    item_supports: tuple[RagSdkListItemSupport, ...] = field(default_factory=tuple)
    evidence_anchors: tuple[RagSdkEvidenceAnchor, ...] = field(default_factory=tuple)
    coverage_note: str = ""
    limitations: tuple[str, ...] = field(default_factory=tuple)
    unsupported_reason: str = ""
    needs_clarification: bool = False
    follow_up_question: str = ""


@dataclass(frozen=True, slots=True)
class RagSdkOutputValidationResult:
    accepted: bool
    failure_reason: str = ""
    claim_supports: tuple[ClaimSupport, ...] = field(default_factory=tuple)


def validate_rag_sdk_answer_output(
    output: RagSdkAnswerOutput,
    *,
    evidence: RagSdkEvidenceProjection,
) -> RagSdkOutputValidationResult:
    source_ids = evidence.source_ids
    cited_source_ids = tuple(_non_empty(output.cited_source_ids))
    if any(source_id not in source_ids for source_id in cited_source_ids):
        return _reject("citation_not_in_evidence")
    if output.semantic_outcome == "grounded_answer" and not cited_source_ids:
        return _reject("citation_missing")

    anchor_result = _validate_anchors(
        (*output.evidence_anchors, *_support_anchors(output)),
        evidence=evidence,
    )
    if anchor_result is not None:
        return anchor_result

    support_by_claim = {support.claim_id: support for support in output.claim_supports}
    for claim in output.claims:
        support = support_by_claim.get(claim.claim_id)
        if support is None:
            return _reject("claim_support_missing")
        if not support.anchors:
            return _reject("claim_anchor_missing")
        if any(not anchor.has_span_support for anchor in support.anchors):
            return _reject("claim_anchor_missing_span")

    if output.answer_items:
        support_by_item = {support.item_text: support for support in output.item_supports}
        for item in output.answer_items:
            if any(source_id not in source_ids for source_id in item.source_ids):
                return _reject("list_item_source_not_in_evidence")
            support = support_by_item.get(item.text)
            if support is None or not support.anchors:
                return _reject("list_item_support_missing")
            if any(not anchor.has_span_support for anchor in support.anchors):
                return _reject("list_item_anchor_missing_span")

    return RagSdkOutputValidationResult(
        accepted=True,
        claim_supports=_claim_supports(output),
    )


def _validate_anchors(
    anchors: tuple[RagSdkEvidenceAnchor, ...],
    *,
    evidence: RagSdkEvidenceProjection,
) -> RagSdkOutputValidationResult | None:
    for anchor in anchors:
        if anchor.source_id not in evidence.source_ids:
            return _reject("anchor_source_not_in_evidence")
        if anchor.chunk_id and anchor.chunk_id not in evidence.chunk_ids:
            return _reject("anchor_chunk_not_in_evidence")
    return None


def _support_anchors(output: RagSdkAnswerOutput) -> tuple[RagSdkEvidenceAnchor, ...]:
    anchors: list[RagSdkEvidenceAnchor] = []
    for support in output.claim_supports:
        anchors.extend(support.anchors)
    for support in output.item_supports:
        anchors.extend(support.anchors)
    return tuple(anchors)


def _claim_supports(output: RagSdkAnswerOutput) -> tuple[ClaimSupport, ...]:
    supports_by_claim = {support.claim_id: support for support in output.claim_supports}
    result: list[ClaimSupport] = []
    for claim in output.claims:
        support = supports_by_claim.get(claim.claim_id)
        anchor = support.anchors[0] if support and support.anchors else None
        result.append(
            ClaimSupport(
                claim_type=claim.claim_type,
                claim_text=claim.text,
                supported=anchor is not None,
                support_source_doc_id=anchor.source_id if anchor is not None else "",
                support_snippet=anchor.excerpt if anchor is not None else "",
            )
        )
    return tuple(result)


def _non_empty(values: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(value.strip() for value in values if value.strip())


def _reject(reason: str) -> RagSdkOutputValidationResult:
    return RagSdkOutputValidationResult(accepted=False, failure_reason=reason)


__all__ = [
    "RagSdkAnswerOutput",
    "RagSdkClaim",
    "RagSdkClaimSupport",
    "RagSdkListItem",
    "RagSdkListItemSupport",
    "RagSdkOutputValidationResult",
    "validate_rag_sdk_answer_output",
]
