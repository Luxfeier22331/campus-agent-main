from __future__ import annotations

from collections.abc import Sequence

from campus_contracts import EvidenceSource

from campus_retrieval_core.curriculum_query_resolution import (
    filter_curriculum_query_sources,
    interpret_curriculum_query,
    query_targets_curriculum_source_title,
)
from campus_retrieval_core.query_focus import (
    query_has_focus_constraints,
    source_covers_query_focus,
)

from .evidence_ranking_curriculum import select_curriculum_lookup_support_sources
from .evidence_ranking_features import (
    build_document_ranking_features,
    build_ranking_features,
    document_sort_key,
    is_primary_support_candidate,
    is_secondary_support_candidate,
    neutralize_title_compactness_for_ambiguous_title_fragment,
    query_targets_document,
    source_sort_key,
)
from .evidence_ranking_text import (
    is_official_web_short_title_match,
    is_short_semantic_query,
    is_short_title_fragment_query,
    match_key,
    normalize_text,
    query_lexical_support_count,
    semantic_title_coverage,
    source_title_keys,
    title_match_priority,
)


def prioritize_evidence_sources(
    *,
    query_text: str,
    sources: Sequence[EvidenceSource],
) -> tuple[EvidenceSource, ...]:
    normalized_query = normalize_text(query_text)
    query_key = match_key(normalized_query)
    if not query_key:
        return tuple(sources)

    ranked = tuple(
        build_ranking_features(
            query_text=query_text,
            normalized_query=normalized_query,
            query_key=query_key,
            source=source,
        )
        for source in sources
    )
    ranked = neutralize_title_compactness_for_ambiguous_title_fragment(
        query_key=query_key,
        features=ranked,
        is_short_title_fragment_query_fn=is_short_title_fragment_query,
    )
    return tuple(
        feature.source
        for feature in sorted(
            ranked,
            key=source_sort_key,
            reverse=True,
        )
    )


def select_supporting_evidence_sources(
    *,
    query_text: str,
    sources: Sequence[EvidenceSource],
    max_sources: int,
) -> tuple[EvidenceSource, ...]:
    if max_sources <= 0:
        return ()

    interpretation = interpret_curriculum_query(query_text)
    if interpretation.curriculum_lookup_target == "course_map":
        return ()

    scoped_sources, scope_applied = filter_curriculum_query_sources(
        query_text=query_text,
        sources=sources,
    )
    if scope_applied:
        if not scoped_sources:
            return ()
        sources = scoped_sources

    normalized_query = normalize_text(query_text)
    query_key = match_key(normalized_query)
    if not query_key:
        return tuple(sources[:max_sources])

    raw_features = tuple(
        build_ranking_features(
            query_text=query_text,
            normalized_query=normalized_query,
            query_key=query_key,
            source=source,
        )
        for source in sources
    )
    normalized_features = neutralize_title_compactness_for_ambiguous_title_fragment(
        query_key=query_key,
        features=raw_features,
        is_short_title_fragment_query_fn=is_short_title_fragment_query,
    )
    ranked_features = tuple(
        sorted(
            normalized_features,
            key=source_sort_key,
            reverse=True,
        )
    )
    if not ranked_features:
        return ()

    if query_has_focus_constraints(query_text):
        focus_aligned_sources = tuple(
            feature.source
            for feature in ranked_features
            if source_covers_query_focus(query_text=query_text, source=feature.source)
        )
        if focus_aligned_sources:
            ranked_features = tuple(
                feature for feature in ranked_features if feature.source in focus_aligned_sources
            )
        else:
            return ()

    ranked_documents = tuple(
        sorted(
            build_document_ranking_features(ranked_features),
            key=document_sort_key,
            reverse=True,
        )
    )
    locked_doc_id = (
        ranked_documents[0].doc_id
        if ranked_documents
        and query_targets_document(
            query_key=query_key,
            feature=ranked_documents[0],
            is_short_semantic_query_fn=is_short_semantic_query,
        )
        else ""
    )
    curriculum_lookup_selected = select_curriculum_lookup_support_sources(
        query_text=query_text,
        ranked_features=ranked_features,
        locked_doc_id=locked_doc_id,
        max_sources=max_sources,
    )
    if curriculum_lookup_selected:
        return curriculum_lookup_selected

    primary: list[EvidenceSource] = []
    secondary: list[EvidenceSource] = []
    same_doc_secondary: list[EvidenceSource] = []
    seen_chunks: set[str] = set()
    seen_snippets: set[str] = set()
    preferred_doc_id = locked_doc_id or ranked_features[0].source.doc_id
    for feature in ranked_features:
        source = feature.source
        if locked_doc_id and source.doc_id != locked_doc_id:
            continue
        if source.chunk_id in seen_chunks:
            continue
        normalized_snippet = normalize_text(source.snippet)
        if normalized_snippet and normalized_snippet in seen_snippets:
            continue
        if feature.content_role_priority < 0:
            continue
        if is_primary_support_candidate(feature):
            primary.append(source)
        elif locked_doc_id and is_secondary_support_candidate(feature):
            secondary.append(source)
        elif source.doc_id == preferred_doc_id:
            same_doc_secondary.append(source)
        seen_chunks.add(source.chunk_id)
        if normalized_snippet:
            seen_snippets.add(normalized_snippet)

    selected = (*primary, *secondary, *same_doc_secondary)[:max_sources]
    if selected:
        return selected

    fallback_source = next(
        (
            feature.source
            for feature in ranked_features
            if not locked_doc_id or feature.source.doc_id == locked_doc_id
        ),
        ranked_features[0].source,
    )
    return (fallback_source,)


def query_targets_source_title(*, query_text: str, source: EvidenceSource) -> bool:
    if query_targets_curriculum_source_title(query_text=query_text, source=source):
        return True
    normalized_query = normalize_text(query_text)
    query_key = match_key(normalized_query)
    if not query_key:
        return False
    explicit_title_key = match_key(source.source_title)
    if is_official_web_short_title_match(
        query_key=query_key, source=source, explicit_title_key=explicit_title_key
    ):
        return True
    title_keys = source_title_keys(source)
    title_match = title_match_priority(query_key=query_key, title_keys=title_keys)
    title_overlap_count = max(
        (
            query_lexical_support_count(
                normalized_query=normalized_query,
                query_key=query_key,
                search_key=title_key,
            )
            for title_key in title_keys
        ),
        default=0,
    )
    semantic_coverage = max(
        (
            semantic_title_coverage(query_key=query_key, title_key=title_key)
            for title_key in title_keys
        ),
        default=0.0,
    )
    return (
        title_match >= 2
        or (is_short_semantic_query(query_key) and title_overlap_count >= 2)
        or (title_overlap_count >= 8 and semantic_coverage >= 0.6)
    )


__all__ = [
    "prioritize_evidence_sources",
    "query_targets_source_title",
    "select_supporting_evidence_sources",
]
