from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class RetrievalAdequacyAssessment:
    verdict: str
    reason: str = ""


def sufficient_retrieval_adequacy(reason: str = "sufficient") -> RetrievalAdequacyAssessment:
    normalized_reason = reason.strip() or "sufficient"
    return RetrievalAdequacyAssessment(verdict="sufficient", reason=normalized_reason)


def ambiguous_retrieval_adequacy(reason: str) -> RetrievalAdequacyAssessment:
    normalized_reason = reason.strip() or "multi_candidate_title"
    return RetrievalAdequacyAssessment(verdict="ambiguous", reason=normalized_reason)


def insufficient_retrieval_adequacy(reason: str) -> RetrievalAdequacyAssessment:
    normalized_reason = reason.strip() or "weak_supporting_evidence"
    return RetrievalAdequacyAssessment(verdict="insufficient", reason=normalized_reason)
