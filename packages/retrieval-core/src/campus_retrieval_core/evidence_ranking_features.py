from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass, replace

from campus_contracts import EvidenceSource

from .evidence_ranking_text import (
    focused_query_key,
    match_key,
    query_lexical_support_count,
    source_content_text,
    source_detail_text,
    source_title_keys,
    title_compactness,
    title_match_priority,
)
from .evidence_semantics import infer_evidence_query_intent, semantic_alignment_score
from .query_focus import source_focus_match_score

_NEGATIVE_CONTENT_ROLES = frozenset(
    {
        "appendix",
        "background",
        "closing_provision",
        "navigation",
        "source_attribution",
        "boilerplate",
        "media_caption",
    }
)
_CONTENT_ROLE_PRIORITY = {
    "procedure": 40,
    "requirement": 32,
    "eligibility": 32,
    "time_rule": 32,
    "deadline": 30,
    "table_fact": 28,
    "notice_fact": 26,
    "reference_fact": 24,
    "scope_rule": 0,
    "definition": 0,
    "appendix": -20,
    "background": -24,
    "media_caption": -28,
    "source_attribution": -36,
    "closing_provision": -40,
    "boilerplate": -48,
    "navigation": -32,
}
_CONTENT_KIND_PRIORITY = {
    "article_body": 18,
    "policy_page": 14,
    "section_text": 12,
    "table_unit": 12,
    "table": 10,
    "appendix": -12,
    "form": -6,
    "navigation": -16,
}


@dataclass(frozen=True, slots=True)
class SourceRankingFeatures:
    source: EvidenceSource
    focus_match_score: int
    title_match_priority: int
    title_overlap_count: int
    title_compactness: int
    detail_support_count: int
    content_support_count: int
    answer_bearing_bonus: int
    content_role_priority: int
    content_kind_priority: int
    query_intent_strength: int
    semantic_alignment_score: int


@dataclass(frozen=True, slots=True)
class DocumentRankingFeatures:
    doc_id: str
    focus_match_score: int
    title_match_priority: int
    title_overlap_count: int
    title_compactness: int
    detail_support_count: int
    content_support_count: int
    answer_bearing_count: int
    content_role_priority: int
    content_kind_priority: int
    semantic_alignment_score: int
    best_score: float


def build_ranking_features(
    *,
    query_text: str,
    normalized_query: str,
    query_key: str,
    source: EvidenceSource,
) -> SourceRankingFeatures:
    title_keys = source_title_keys(source)
    focused_key = focused_query_key(query_key=query_key, title_keys=title_keys)
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
    query_intent = infer_evidence_query_intent(query_text)
    return SourceRankingFeatures(
        source=source,
        focus_match_score=source_focus_match_score(query_text=query_text, source=source),
        title_match_priority=title_match_priority(query_key=query_key, title_keys=title_keys),
        title_overlap_count=title_overlap_count,
        title_compactness=title_compactness(query_key=query_key, title_keys=title_keys),
        detail_support_count=query_lexical_support_count(
            normalized_query=normalized_query,
            query_key=focused_key,
            search_key=match_key(source_detail_text(source)),
        ),
        content_support_count=query_lexical_support_count(
            normalized_query=normalized_query,
            query_key=focused_key,
            search_key=match_key(source_content_text(source)),
        ),
        answer_bearing_bonus=1 if source.is_answer_bearing else 0,
        content_role_priority=_CONTENT_ROLE_PRIORITY.get(source.content_role, 0),
        content_kind_priority=_CONTENT_KIND_PRIORITY.get(source.content_kind, 0),
        query_intent_strength=1 if query_intent.is_strong else 0,
        semantic_alignment_score=semantic_alignment_score(query_text=query_text, source=source),
    )


def is_primary_support_candidate(feature: SourceRankingFeatures) -> bool:
    if feature.content_role_priority > 0:
        return True
    if feature.detail_support_count > 0 or feature.content_support_count > 0:
        return True
    return feature.source.is_answer_bearing and feature.title_overlap_count > 0


def is_secondary_support_candidate(feature: SourceRankingFeatures) -> bool:
    if feature.source.content_role in _NEGATIVE_CONTENT_ROLES:
        return False
    if feature.title_match_priority > 0:
        return True
    if feature.title_overlap_count > 0:
        return True
    return feature.detail_support_count > 0 or feature.content_support_count > 0


def build_document_ranking_features(
    features: Sequence[SourceRankingFeatures],
) -> tuple[DocumentRankingFeatures, ...]:
    documents: dict[str, list[SourceRankingFeatures]] = {}
    for feature in features:
        documents.setdefault(feature.source.doc_id, []).append(feature)
    return tuple(
        DocumentRankingFeatures(
            doc_id=doc_id,
            focus_match_score=max(item.focus_match_score for item in doc_features),
            title_match_priority=max(item.title_match_priority for item in doc_features),
            title_overlap_count=max(item.title_overlap_count for item in doc_features),
            title_compactness=max(item.title_compactness for item in doc_features),
            detail_support_count=max(item.detail_support_count for item in doc_features),
            content_support_count=max(item.content_support_count for item in doc_features),
            answer_bearing_count=sum(item.answer_bearing_bonus for item in doc_features),
            content_role_priority=max(item.content_role_priority for item in doc_features),
            content_kind_priority=max(item.content_kind_priority for item in doc_features),
            semantic_alignment_score=max(item.semantic_alignment_score for item in doc_features),
            best_score=max(item.source.score for item in doc_features),
        )
        for doc_id, doc_features in documents.items()
    )


def query_targets_document(
    *, query_key: str, feature: DocumentRankingFeatures, is_short_semantic_query_fn
) -> bool:
    return feature.title_match_priority >= 2 or (
        is_short_semantic_query_fn(query_key) and feature.title_overlap_count >= 2
    )


def source_sort_key(
    feature: SourceRankingFeatures,
) -> tuple[int, int, int, int, int, int, int, int, int, int, float]:
    return (
        feature.focus_match_score,
        feature.query_intent_strength,
        feature.semantic_alignment_score if feature.query_intent_strength else 0,
        feature.title_match_priority,
        feature.title_overlap_count,
        feature.title_compactness,
        1 if feature.content_role_priority >= 0 else 0,
        feature.detail_support_count + feature.content_support_count,
        feature.answer_bearing_bonus,
        feature.content_role_priority,
        feature.content_kind_priority,
        feature.source.score,
    )


def document_sort_key(
    feature: DocumentRankingFeatures,
) -> tuple[int, int, int, int, int, int, int, int, float]:
    return (
        feature.focus_match_score,
        feature.semantic_alignment_score,
        feature.title_match_priority,
        feature.title_overlap_count,
        feature.title_compactness,
        feature.content_role_priority,
        feature.detail_support_count + feature.content_support_count,
        feature.answer_bearing_count,
        feature.content_kind_priority,
        feature.best_score,
    )


def neutralize_title_compactness_for_ambiguous_title_fragment(
    *,
    query_key: str,
    features: tuple[SourceRankingFeatures, ...],
    is_short_title_fragment_query_fn,
) -> tuple[SourceRankingFeatures, ...]:
    if not is_short_title_fragment_query_fn(query_key):
        return features
    if (
        len({feature.source.doc_id for feature in features if feature.title_match_priority >= 2})
        < 2
    ):
        return features
    return tuple(replace(feature, title_compactness=0) for feature in features)
