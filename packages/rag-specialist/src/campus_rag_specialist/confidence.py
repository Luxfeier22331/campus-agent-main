from __future__ import annotations

from campus_contracts import EvidenceBundle
from campus_ingestion_core.corpus_profiles import is_official_web_stable_reference_like_collection
from campus_retrieval_core.evidence_ranking import (
    query_targets_source_title,
    select_supporting_evidence_sources,
)

_POSITIVE_SUPPORT_ROLES = frozenset({"procedure", "requirement", "eligibility", "time_rule", "deadline", "table_fact", "definition"})
_CURATED_FACT_COLLECTIONS = frozenset({"course_facts", "program_family_facts"})


def derive_confidence(evidence: EvidenceBundle) -> str:
    if not evidence.sources:
        return "low"

    supporting_sources = select_supporting_evidence_sources(
        query_text=evidence.query_text,
        sources=evidence.sources,
        max_sources=3,
    )
    top_score = supporting_sources[0].score
    support_count = len(supporting_sources)
    distinct_doc_count = len({source.doc_id for source in supporting_sources})
    distinct_chunk_count = len({source.chunk_id for source in supporting_sources})
    strong_support_count = sum(1 for source in supporting_sources if source.score >= 0.75)
    medium_support_count = sum(1 for source in supporting_sources if source.score >= 0.55)
    primary_doc_id = supporting_sources[0].doc_id
    primary_doc_sources = tuple(source for source in supporting_sources if source.doc_id == primary_doc_id)
    primary_doc_chunk_count = len({source.chunk_id for source in primary_doc_sources})
    primary_doc_positive_support_count = sum(
        1
        for source in primary_doc_sources
        if source.is_answer_bearing or source.content_role in _POSITIVE_SUPPORT_ROLES
    )
    named_doc_id = next(
        (
            source.doc_id
            for source in primary_doc_sources
            if query_targets_source_title(query_text=evidence.query_text, source=source)
        ),
        None,
    )
    named_doc_chunk_count = primary_doc_chunk_count if named_doc_id is not None else 0

    if (
        top_score >= 0.85
        and strong_support_count >= 2
        and distinct_chunk_count >= 2
        and (distinct_doc_count >= 2 or support_count >= 3)
    ):
        return "high"
    if named_doc_id is not None and primary_doc_positive_support_count >= 2 and named_doc_chunk_count >= 2:
        return "high"
    if _is_official_web_title_targeted_single_doc_hit(
        evidence=evidence,
        supporting_sources=supporting_sources,
    ):
        return "medium"
    if named_doc_id is not None and named_doc_chunk_count >= 2:
        return "medium"
    if named_doc_id is not None and primary_doc_positive_support_count >= 1:
        return "medium"
    if primary_doc_positive_support_count >= 1 and primary_doc_chunk_count >= 2:
        return "medium"
    if (
        evidence.collection in _CURATED_FACT_COLLECTIONS
        and supporting_sources[0].is_answer_bearing
        and primary_doc_positive_support_count >= 1
    ):
        return "medium"
    if query_targets_source_title(query_text=evidence.query_text, source=supporting_sources[0]) and top_score >= 0.4:
        return "medium"
    if top_score >= 0.55 and medium_support_count >= 1:
        return "medium"
    return "low"


def _is_official_web_title_targeted_single_doc_hit(
    *,
    evidence: EvidenceBundle,
    supporting_sources: tuple,
) -> bool:
    if (
        evidence.corpus != "official_web"
        or not is_official_web_stable_reference_like_collection(evidence.collection)
    ):
        return False
    if not supporting_sources:
        return False
    top_source = supporting_sources[0]
    if top_source.source_channel != "official_web":
        return False
    if not query_targets_source_title(query_text=evidence.query_text, source=top_source):
        return False
    return len({source.doc_id for source in supporting_sources}) == 1
