from __future__ import annotations

from campus_contracts import EvidenceBundle


def derive_confidence(evidence: EvidenceBundle) -> str:
    if not evidence.sources:
        return "low"

    supporting_sources = evidence.sources[:3]
    top_score = supporting_sources[0].score
    support_count = len(supporting_sources)
    distinct_doc_count = len({source.doc_id for source in supporting_sources})
    distinct_chunk_count = len({source.chunk_id for source in supporting_sources})
    strong_support_count = sum(1 for source in supporting_sources if source.score >= 0.75)
    medium_support_count = sum(1 for source in supporting_sources if source.score >= 0.55)

    if (
        top_score >= 0.85
        and strong_support_count >= 2
        and distinct_chunk_count >= 2
        and (distinct_doc_count >= 2 or support_count >= 3)
    ):
        return "high"
    if top_score >= 0.55 and medium_support_count >= 1:
        return "medium"
    return "low"
