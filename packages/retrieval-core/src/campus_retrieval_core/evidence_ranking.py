from __future__ import annotations

from dataclasses import dataclass
import re
import unicodedata
from typing import Sequence

from campus_contracts import EvidenceSource


_WHITESPACE_RE = re.compile(r"\s+")
_ASCII_TOKEN_RE = re.compile(r"[a-z0-9]{3,}")
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
_NEGATIVE_CONTENT_ROLES = frozenset({"appendix", "background", "closing_provision", "navigation"})
_CONTENT_ROLE_PRIORITY = {
    "procedure": 40,
    "requirement": 32,
    "eligibility": 32,
    "time_rule": 32,
    "deadline": 30,
    "table_fact": 28,
    "scope_rule": 0,
    "definition": 0,
    "appendix": -20,
    "background": -24,
    "closing_provision": -40,
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
    detail_support_count: int
    content_support_count: int
    answer_bearing_bonus: int
    content_role_priority: int
    content_kind_priority: int


def prioritize_evidence_sources(
    *,
    query_text: str,
    sources: Sequence[EvidenceSource],
) -> tuple[EvidenceSource, ...]:
    normalized_query = _normalize_text(query_text)
    query_key = _match_key(normalized_query)
    if not query_key:
        return tuple(sources)

    ranked = (
        _build_ranking_features(
            query_text=query_text,
            normalized_query=normalized_query,
            query_key=query_key,
            source=source,
        )
        for source in sources
    )
    return tuple(
        feature.source
        for feature in sorted(
            ranked,
            key=lambda feature: (
                feature.title_match_priority,
                feature.answer_bearing_bonus,
                feature.content_role_priority,
                feature.detail_support_count,
                feature.content_support_count,
                feature.title_overlap_count,
                feature.content_kind_priority,
                feature.source.score,
            ),
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

    normalized_query = _normalize_text(query_text)
    query_key = _match_key(normalized_query)
    if not query_key:
        return tuple(sources[:max_sources])

    ranked_features = tuple(
        _build_ranking_features(
            query_text=query_text,
            normalized_query=normalized_query,
            query_key=query_key,
            source=source,
        )
        for source in prioritize_evidence_sources(query_text=query_text, sources=sources)
    )
    if not ranked_features:
        return ()

    locked_doc_id = (
        ranked_features[0].source.doc_id
        if query_targets_source_title(query_text=query_text, source=ranked_features[0].source)
        else ""
    )

    primary: list[EvidenceSource] = []
    secondary: list[EvidenceSource] = []
    seen_chunks: set[str] = set()
    seen_snippets: set[str] = set()
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
        seen_chunks.add(source.chunk_id)
        if normalized_snippet:
            seen_snippets.add(normalized_snippet)

    selected = tuple((*primary, *secondary))[:max_sources]
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
    query_key = _match_key(query_text)
    if not query_key:
        return False
    return _title_match_priority(query_key=query_key, title_keys=_source_title_keys(source)) >= 3


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
        detail_support_count=detail_support_count,
        content_support_count=content_support_count,
        answer_bearing_bonus=1 if source.is_answer_bearing else 0,
        content_role_priority=_CONTENT_ROLE_PRIORITY.get(source.content_role, 0),
        content_kind_priority=_CONTENT_KIND_PRIORITY.get(source.content_kind, 0),
    )


def _is_primary_support_candidate(feature: _SourceRankingFeatures) -> bool:
    if feature.source.is_answer_bearing:
        return True
    if feature.content_role_priority > 0:
        return True
    return feature.detail_support_count > 0 or feature.content_support_count > 0


def _is_secondary_support_candidate(feature: _SourceRankingFeatures) -> bool:
    if feature.source.content_role in _NEGATIVE_CONTENT_ROLES:
        return False
    if feature.title_match_priority > 0:
        return True
    return feature.title_overlap_count > 0


def _source_title_keys(source: EvidenceSource) -> tuple[str, ...]:
    return tuple(
        dict.fromkeys(
            title_key
            for title_key in (_match_key(candidate) for candidate in _source_title_candidates(source))
            if title_key
        )
    )


def _source_title_candidates(source: EvidenceSource) -> tuple[str, ...]:
    candidates: list[str] = []
    explicit_title = source.source_title.strip()
    if explicit_title:
        candidates.append(explicit_title)

    doc_label = source.doc_id.split(":", 1)[-1].strip()
    if _looks_like_title(doc_label):
        candidates.append(doc_label)

    for path_item in source.structural_path[:1]:
        if _looks_like_title(path_item):
            candidates.append(path_item)

    snippet = _normalize_text(source.snippet)
    for separator in ("\n", " / "):
        if separator in snippet:
            prefix = snippet.split(separator, 1)[0].strip()
            if _looks_like_title(prefix):
                candidates.append(prefix)
    return tuple(dict.fromkeys(candidates))


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


__all__ = [
    "prioritize_evidence_sources",
    "query_targets_source_title",
    "select_supporting_evidence_sources",
]
