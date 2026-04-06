from __future__ import annotations

from dataclasses import dataclass, replace
import re
import unicodedata
from typing import Sequence

from campus_contracts import EvidenceSource
from campus_ingestion_core.corpus_profiles import is_official_web_stable_reference_like_collection
from campus_retrieval_core.curriculum_query_resolution import (
    filter_curriculum_query_sources,
    query_targets_curriculum_source_title,
)


_WHITESPACE_RE = re.compile(r"\s+")
_ASCII_TOKEN_RE = re.compile(r"[a-z0-9]{3,}")
_TITLE_BRACKETED_SEGMENT_RE = re.compile(r"[（(][^（）()]+[）)]")
_LOW_SIGNAL_CJK_TOKENS = frozenset(
    {
        "中央",
        "民族",
        "大学",
        "本科",
        "人才",
        "培养",
        "方案",
        "要求",
        "多少",
        "几年",
        "怎么",
        "如何",
        "安排",
        "相关",
        "内容",
        "什么",
        "哪些",
        "规定",
        "办法",
        "流程",
    }
)
_QUERY_ASK_CUES = frozenset({"多少", "几年", "怎么", "如何", "安排", "什么", "哪些"})
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
class _SourceRankingFeatures:
    source: EvidenceSource
    title_match_priority: int
    title_overlap_count: int
    title_compactness: int
    detail_support_count: int
    content_support_count: int
    answer_bearing_bonus: int
    content_role_priority: int
    content_kind_priority: int


@dataclass(frozen=True, slots=True)
class _DocumentRankingFeatures:
    doc_id: str
    title_match_priority: int
    title_overlap_count: int
    title_compactness: int
    detail_support_count: int
    content_support_count: int
    answer_bearing_count: int
    content_role_priority: int
    content_kind_priority: int
    best_score: float


def prioritize_evidence_sources(
    *,
    query_text: str,
    sources: Sequence[EvidenceSource],
) -> tuple[EvidenceSource, ...]:
    normalized_query = _normalize_text(query_text)
    query_key = _match_key(normalized_query)
    if not query_key:
        return tuple(sources)

    ranked = tuple(
        _build_ranking_features(
            query_text=query_text,
            normalized_query=normalized_query,
            query_key=query_key,
            source=source,
        )
        for source in sources
    )
    ranked = _neutralize_title_compactness_for_ambiguous_title_fragment(query_key=query_key, features=ranked)
    return tuple(
        feature.source
        for feature in sorted(
            ranked,
            key=_source_sort_key,
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

    scoped_sources, scope_applied = filter_curriculum_query_sources(
        query_text=query_text,
        sources=sources,
    )
    if scope_applied:
        if not scoped_sources:
            return ()
        sources = scoped_sources

    normalized_query = _normalize_text(query_text)
    query_key = _match_key(normalized_query)
    if not query_key:
        return tuple(sources[:max_sources])

    raw_features = tuple(
        _build_ranking_features(
            query_text=query_text,
            normalized_query=normalized_query,
            query_key=query_key,
            source=source,
        )
        for source in sources
    )
    normalized_features = _neutralize_title_compactness_for_ambiguous_title_fragment(
        query_key=query_key,
        features=raw_features,
    )
    ranked_features = tuple(
        sorted(
            normalized_features,
            key=_source_sort_key,
            reverse=True,
        )
    )
    if not ranked_features:
        return ()

    ranked_documents = tuple(
        sorted(
            _build_document_ranking_features(ranked_features),
            key=_document_sort_key,
            reverse=True,
        )
    )
    locked_doc_id = (
        ranked_documents[0].doc_id
        if ranked_documents and _query_targets_document(query_key=query_key, feature=ranked_documents[0])
        else ""
    )

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
        normalized_snippet = _normalize_text(source.snippet)
        if normalized_snippet and normalized_snippet in seen_snippets:
            continue
        if feature.content_role_priority < 0:
            continue
        if _is_primary_support_candidate(feature):
            primary.append(source)
        elif locked_doc_id and _is_secondary_support_candidate(feature):
            secondary.append(source)
        elif source.doc_id == preferred_doc_id:
            same_doc_secondary.append(source)
        seen_chunks.add(source.chunk_id)
        if normalized_snippet:
            seen_snippets.add(normalized_snippet)

    selected = tuple((*primary, *secondary, *same_doc_secondary))[:max_sources]
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
    normalized_query = _normalize_text(query_text)
    query_key = _match_key(normalized_query)
    if not query_key:
        return False
    explicit_title_key = _match_key(source.source_title)
    if _is_official_web_short_title_match(query_key=query_key, source=source, explicit_title_key=explicit_title_key):
        return True
    title_keys = _source_title_keys(source)
    title_match_priority = _title_match_priority(query_key=query_key, title_keys=title_keys)
    title_overlap_count = max(
        (
            _query_lexical_support_count(
                normalized_query=normalized_query,
                query_key=query_key,
                search_key=title_key,
            )
            for title_key in title_keys
        ),
        default=0,
    )
    semantic_title_coverage = max(
        (_semantic_title_coverage(query_key=query_key, title_key=title_key) for title_key in title_keys),
        default=0.0,
    )
    return (
        title_match_priority >= 2
        or (_is_short_semantic_query(query_key) and title_overlap_count >= 2)
        or (title_overlap_count >= 8 and semantic_title_coverage >= 0.6)
    )


def _is_official_web_short_title_match(
    *,
    query_key: str,
    source: EvidenceSource,
    explicit_title_key: str,
) -> bool:
    if (
        source.source_channel != "official_web"
        or not is_official_web_stable_reference_like_collection(source.collection)
    ):
        return False
    if len(explicit_title_key) < 2 or len(explicit_title_key) > 3:
        return False
    if query_key == explicit_title_key:
        return True
    if not query_key.endswith(explicit_title_key):
        return False
    prefix = query_key[: -len(explicit_title_key)]
    return prefix in {"", "中央民族大学"}


def _build_ranking_features(
    *,
    query_text: str,
    normalized_query: str,
    query_key: str,
    source: EvidenceSource,
) -> _SourceRankingFeatures:
    title_keys = _source_title_keys(source)
    focused_query_key = _focused_query_key(query_key=query_key, title_keys=title_keys)
    title_match_priority = _title_match_priority(query_key=query_key, title_keys=title_keys)
    title_overlap_count = max(
        (_query_lexical_support_count(normalized_query=normalized_query, query_key=query_key, search_key=title_key) for title_key in title_keys),
        default=0,
    )
    detail_support_count = _query_lexical_support_count(
        normalized_query=normalized_query,
        query_key=focused_query_key,
        search_key=_match_key(_source_detail_text(source)),
    )
    content_support_count = _query_lexical_support_count(
        normalized_query=normalized_query,
        query_key=focused_query_key,
        search_key=_match_key(_source_content_text(source)),
    )
    return _SourceRankingFeatures(
        source=source,
        title_match_priority=title_match_priority,
        title_overlap_count=title_overlap_count,
        title_compactness=_title_compactness(query_key=query_key, title_keys=title_keys),
        detail_support_count=detail_support_count,
        content_support_count=content_support_count,
        answer_bearing_bonus=1 if source.is_answer_bearing else 0,
        content_role_priority=_CONTENT_ROLE_PRIORITY.get(source.content_role, 0),
        content_kind_priority=_CONTENT_KIND_PRIORITY.get(source.content_kind, 0),
    )


def _is_primary_support_candidate(feature: _SourceRankingFeatures) -> bool:
    if feature.content_role_priority > 0:
        return True
    if feature.detail_support_count > 0 or feature.content_support_count > 0:
        return True
    return feature.source.is_answer_bearing and feature.title_overlap_count > 0


def _is_secondary_support_candidate(feature: _SourceRankingFeatures) -> bool:
    if feature.source.content_role in _NEGATIVE_CONTENT_ROLES:
        return False
    if feature.title_match_priority > 0:
        return True
    if feature.title_overlap_count > 0:
        return True
    return feature.detail_support_count > 0 or feature.content_support_count > 0


def _build_document_ranking_features(
    features: Sequence[_SourceRankingFeatures],
) -> tuple[_DocumentRankingFeatures, ...]:
    documents: dict[str, list[_SourceRankingFeatures]] = {}
    for feature in features:
        documents.setdefault(feature.source.doc_id, []).append(feature)
    return tuple(
        _DocumentRankingFeatures(
            doc_id=doc_id,
            title_match_priority=max(item.title_match_priority for item in doc_features),
            title_overlap_count=max(item.title_overlap_count for item in doc_features),
            title_compactness=max(item.title_compactness for item in doc_features),
            detail_support_count=max(item.detail_support_count for item in doc_features),
            content_support_count=max(item.content_support_count for item in doc_features),
            answer_bearing_count=sum(item.answer_bearing_bonus for item in doc_features),
            content_role_priority=max(item.content_role_priority for item in doc_features),
            content_kind_priority=max(item.content_kind_priority for item in doc_features),
            best_score=max(item.source.score for item in doc_features),
        )
        for doc_id, doc_features in documents.items()
    )


def _query_targets_document(*, query_key: str, feature: _DocumentRankingFeatures) -> bool:
    return feature.title_match_priority >= 2 or (_is_short_semantic_query(query_key) and feature.title_overlap_count >= 2)


def _source_sort_key(feature: _SourceRankingFeatures) -> tuple[int, int, int, int, int, int, int, float]:
    return (
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


def _document_sort_key(feature: _DocumentRankingFeatures) -> tuple[int, int, int, int, int, int, int, float]:
    return (
        feature.title_match_priority,
        feature.title_overlap_count,
        feature.title_compactness,
        feature.content_role_priority,
        feature.detail_support_count + feature.content_support_count,
        feature.answer_bearing_count,
        feature.content_kind_priority,
        feature.best_score,
    )


def _source_title_keys(source: EvidenceSource) -> tuple[str, ...]:
    return tuple(
        dict.fromkeys(
            title_key
            for title_key in (_match_key(candidate) for candidate in _source_title_candidates(source))
            if title_key
        )
    )


def _source_title_candidates(source: EvidenceSource) -> tuple[str, ...]:
    base_candidates: list[str] = []
    explicit_title = source.source_title.strip()
    if explicit_title:
        base_candidates.append(explicit_title)

    doc_label = source.doc_id.split(":", 1)[-1].strip()
    if _looks_like_title(doc_label):
        base_candidates.append(doc_label)

    for path_item in source.structural_path[:1]:
        if not _should_include_structural_root_as_title_candidate(
            source=source,
            explicit_title=explicit_title,
            path_item=path_item,
        ):
            continue
        if _looks_like_title(path_item):
            base_candidates.append(path_item)

    snippet = _normalize_text(source.snippet)
    for separator in ("\n", " / "):
        if separator in snippet:
            prefix = snippet.split(separator, 1)[0].strip()
            if _looks_like_title(prefix):
                base_candidates.append(prefix)

    candidates: list[str] = []
    for candidate in base_candidates:
        candidates.extend(_title_variants(candidate))
    return tuple(dict.fromkeys(candidates))


def _should_include_structural_root_as_title_candidate(
    *,
    source: EvidenceSource,
    explicit_title: str,
    path_item: str,
) -> bool:
    if (
        source.source_channel == "official_web"
        and is_official_web_stable_reference_like_collection(source.collection)
        and explicit_title
    ):
        return _match_key(explicit_title) == _match_key(path_item)
    return True


def _source_detail_text(source: EvidenceSource) -> str:
    parts = [source.detail_label, *source.structural_path]
    return " ".join(part for part in parts if part.strip())


def _source_content_text(source: EvidenceSource) -> str:
    snippet = _normalize_text(source.snippet)
    for candidate in _source_title_candidates(source):
        normalized_candidate = _normalize_text(candidate)
        if normalized_candidate:
            snippet = snippet.replace(normalized_candidate, " ")
    detail_text = _source_detail_text(source)
    return " ".join(part for part in (detail_text, snippet) if part.strip())


def _title_match_priority(*, query_key: str, title_keys: Sequence[str]) -> int:
    if any(title_key == query_key for title_key in title_keys):
        return 4
    if any(title_key and title_key in query_key for title_key in title_keys):
        return 3
    if any(title_key and query_key in title_key for title_key in title_keys):
        return 2
    return 0


def _focused_query_key(*, query_key: str, title_keys: Sequence[str]) -> str:
    for title_key in sorted((key for key in title_keys if key and key in query_key), key=len, reverse=True):
        remainder = query_key.replace(title_key, "", 1)
        if remainder:
            return remainder
    return query_key


def _title_compactness(*, query_key: str, title_keys: Sequence[str]) -> int:
    if not _is_short_title_fragment_query(query_key):
        return 0
    extra_chars = min(
        (len(title_key) - len(query_key) for title_key in title_keys if title_key and query_key and query_key in title_key),
        default=None,
    )
    if extra_chars is None:
        return 0
    return -max(extra_chars, 0)


def _neutralize_title_compactness_for_ambiguous_title_fragment(
    *,
    query_key: str,
    features: tuple[_SourceRankingFeatures, ...],
) -> tuple[_SourceRankingFeatures, ...]:
    if not _is_short_title_fragment_query(query_key):
        return features
    if len({feature.source.doc_id for feature in features if feature.title_match_priority >= 2}) < 2:
        return features
    return tuple(replace(feature, title_compactness=0) for feature in features)


def _semantic_title_coverage(*, query_key: str, title_key: str) -> float:
    query_tokens = _semantic_query_tokens(query_key)
    if not query_tokens or not title_key:
        return 0.0
    matched_tokens = sum(1 for token in query_tokens if token in title_key)
    return matched_tokens / len(query_tokens)


def _query_lexical_support_count(
    *,
    normalized_query: str,
    query_key: str,
    search_key: str,
) -> int:
    if not search_key:
        return 0
    count = sum(1 for token in _ASCII_TOKEN_RE.findall(normalized_query) if token in search_key)
    for segment in _cjk_segments(query_key):
        if len(segment) >= 4 and segment in search_key:
            count += 2
            continue
        count += sum(
            1
            for token in _cjk_tokens(segment, token_size=3)
            if token not in _LOW_SIGNAL_CJK_TOKENS and token in search_key
        )
        count += sum(
            1
            for token in _cjk_tokens(segment, token_size=2)
            if token not in _LOW_SIGNAL_CJK_TOKENS and token in search_key
        )
    return count


def _looks_like_title(text: str) -> bool:
    normalized = _normalize_text(text)
    if len(normalized) < 4:
        return False
    if any(_is_cjk_char(char) for char in normalized):
        return True
    return len(normalized.split()) >= 3


def _title_variants(text: str) -> tuple[str, ...]:
    normalized_text = _normalize_text(text)
    if not normalized_text:
        return ()
    without_bracketed_segment = _normalize_text(_TITLE_BRACKETED_SEGMENT_RE.sub("", normalized_text))
    return tuple(
        dict.fromkeys(
            candidate
            for candidate in (normalized_text, without_bracketed_segment)
            if candidate and _looks_like_title(candidate)
        )
    )


def _semantic_query_tokens(query_key: str) -> tuple[str, ...]:
    tokens: list[str] = []
    for segment in _cjk_segments(query_key):
        for token_size in (3, 2):
            tokens.extend(
                token
                for token in _cjk_tokens(segment, token_size=token_size)
                if token not in _LOW_SIGNAL_CJK_TOKENS and token not in _QUERY_ASK_CUES
            )
    return tuple(dict.fromkeys(tokens))


def _normalize_text(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", unicodedata.normalize("NFKC", text)).strip().lower()


def _match_key(text: str) -> str:
    return "".join(char for char in _normalize_text(text) if char.isalnum() or _is_cjk_char(char))


def _cjk_segments(text: str) -> tuple[str, ...]:
    segments: list[str] = []
    current: list[str] = []
    for char in text:
        if _is_cjk_char(char):
            current.append(char)
            continue
        if current:
            segments.append("".join(current))
            current = []
    if current:
        segments.append("".join(current))
    return tuple(segments)


def _cjk_tokens(segment: str, *, token_size: int) -> tuple[str, ...]:
    if token_size <= 0 or len(segment) < token_size:
        return ()
    return tuple(
        dict.fromkeys(
            token
            for token in (segment[index : index + token_size] for index in range(len(segment) - token_size + 1))
            if token.strip()
        )
    )


def _is_cjk_char(char: str) -> bool:
    code_point = ord(char)
    return (
        0x3400 <= code_point <= 0x4DBF
        or 0x4E00 <= code_point <= 0x9FFF
        or 0xF900 <= code_point <= 0xFAFF
    )


def _is_short_semantic_query(query_key: str) -> bool:
    return sum(len(segment) for segment in _cjk_segments(query_key)) <= 10


def _is_short_title_fragment_query(query_key: str) -> bool:
    if not _is_short_semantic_query(query_key):
        return False
    cjk_length = sum(len(segment) for segment in _cjk_segments(query_key))
    if cjk_length == 0 or cjk_length > 6:
        return False
    return not any(cue in query_key for cue in _QUERY_ASK_CUES)


__all__ = [
    "prioritize_evidence_sources",
    "query_targets_source_title",
    "select_supporting_evidence_sources",
]
