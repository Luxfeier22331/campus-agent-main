from __future__ import annotations

from campus_contracts import EvidenceBundle


def derive_confidence(evidence: EvidenceBundle) -> str:
    if not evidence.sources:
        return "low"

    top_score = evidence.sources[0].score
    source_count = len(evidence.sources)

    if source_count >= 2 and top_score >= 0.85:
        return "high"
    if top_score >= 0.55:
        return "medium"
    return "low"
