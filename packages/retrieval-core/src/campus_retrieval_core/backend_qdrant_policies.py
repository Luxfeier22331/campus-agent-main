from __future__ import annotations

from collections.abc import Sequence

from campus_contracts import EvidenceSource
from campus_ingestion_core.corpus_profiles import CollectionRuntimeProfile

from campus_retrieval_core.backend_qdrant_filters import _apply_preferred_document_bias
from campus_retrieval_core.backend_qdrant_no_hit_policy import _apply_no_hit_policy
from campus_retrieval_core.backend_qdrant_official_web_policy import (
    _OFFICIAL_WEB_STABLE_REFERENCE_QUERY_TERMS,
    _apply_document_diversity_policy,
    _apply_official_web_low_signal_policy,
    _normalize_low_signal_query,
    _official_web_source_chunk_ordinal,
)
from campus_retrieval_core.backend_qdrant_query import (
    _prefer_curriculum_semester_course_list_sources,
)
from campus_retrieval_core.curriculum_query_resolution import (
    filter_curriculum_query_sources,
    interpret_curriculum_query,
)
from campus_retrieval_core.evidence_ranking import prioritize_evidence_sources
from campus_retrieval_core.evidence_ranking_curriculum import source_chunk_ordinal

__all__ = [
    "_OFFICIAL_WEB_STABLE_REFERENCE_QUERY_TERMS",
    "_apply_document_diversity_policy",
    "_apply_no_hit_policy",
    "_apply_official_web_low_signal_policy",
    "_normalize_low_signal_query",
    "_official_web_source_chunk_ordinal",
    "finalize_retrieval_sources",
]


def finalize_retrieval_sources(
    *,
    profile: CollectionRuntimeProfile,
    query_text: str,
    sources: Sequence[EvidenceSource],
    preferred_document_ids: tuple[str, ...] = (),
) -> tuple[EvidenceSource, ...]:
    finalized_sources = prioritize_evidence_sources(
        query_text=query_text,
        sources=sources,
    )
    finalized_sources = _apply_preferred_document_bias(
        sources=finalized_sources,
        preferred_document_ids=preferred_document_ids,
    )
    finalized_sources = _apply_curriculum_query_scope_policy(
        profile=profile,
        query_text=query_text,
        sources=finalized_sources,
    )
    finalized_sources = _prefer_curriculum_title_overview_sources(
        profile=profile,
        query_text=query_text,
        sources=finalized_sources,
    )
    finalized_sources = _prefer_curriculum_semester_course_list_sources(
        query_text=query_text,
        sources=finalized_sources,
    )
    return _apply_document_diversity_policy(
        profile=profile,
        query_text=query_text,
        sources=finalized_sources,
    )


def _apply_curriculum_query_scope_policy(
    *,
    profile: CollectionRuntimeProfile,
    query_text: str,
    sources: Sequence[EvidenceSource],
) -> tuple[EvidenceSource, ...]:
    if profile.corpus != "curriculum" or profile.collection != "curriculum_plan":
        return tuple(sources)
    scoped_sources, scope_applied = filter_curriculum_query_sources(
        query_text=query_text,
        sources=sources,
    )
    if not scope_applied:
        return tuple(sources)
    return scoped_sources


def _prefer_curriculum_title_overview_sources(
    *,
    profile: CollectionRuntimeProfile,
    query_text: str,
    sources: Sequence[EvidenceSource],
) -> tuple[EvidenceSource, ...]:
    if profile.corpus != "curriculum" or profile.collection != "curriculum_plan":
        return tuple(sources)
    interpretation = interpret_curriculum_query(query_text)
    if interpretation.intent_kind != "generic" or not interpretation.program_compact_key:
        return tuple(sources)
    if _is_curriculum_fact_lookup_query(query_text):
        return tuple(sources)
    overview_sources = tuple(
        source for source in sources if not _is_curriculum_table_source(source)
    )
    if not overview_sources:
        return tuple(sources)
    return (
        *tuple(sorted(overview_sources, key=_curriculum_title_overview_sort_key)),
        *(source for source in sources if source.chunk_id not in {item.chunk_id for item in overview_sources}),
    )


def _curriculum_title_overview_sort_key(source: EvidenceSource) -> tuple[int, int, float]:
    return (
        _curriculum_overview_section_priority(source),
        source_chunk_ordinal(source),
        -source.score,
    )


def _curriculum_overview_section_priority(source: EvidenceSource) -> int:
    section_text = " ".join((*source.structural_path, source.detail_label, source.snippet))
    for priority, cue in enumerate(
        (
            "培养目标",
            "毕业要求",
            "学制",
            "总学分",
            "学位授予",
            "课程设置和修读建议",
        )
    ):
        if cue in section_text:
            return priority
    return 100


def _is_curriculum_table_source(source: EvidenceSource) -> bool:
    return source.content_role == "table_fact" or source.content_kind == "table_unit"


def _is_curriculum_fact_lookup_query(query_text: str) -> bool:
    return any(
        cue in query_text
        for cue in (
            "学制",
            "几年",
            "总学分",
            "多少",
            "学位授予",
            "授予什么",
            "是什么学位",
        )
    )
