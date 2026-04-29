from __future__ import annotations

import re
import unicodedata
from collections.abc import Sequence

from campus_contracts import EvidenceSource
from campus_ingestion_core.corpus_profiles import CollectionRuntimeProfile

from campus_retrieval_core.curriculum_query_resolution import (
    interpret_curriculum_query,
    matching_curriculum_doc_ids,
)

_ASCII_QUERY_TOKEN_RE = re.compile(r"[a-z0-9]{3,}")
_WEAK_CJK_QUERY_TOKENS = frozenset(
    {
        "办理",
        "校内",
        "学校",
        "学生",
        "规定",
        "办法",
        "管理",
        "申请",
        "条件",
        "流程",
        "程序",
        "手续",
        "处理",
        "服务",
        "问题",
    }
)
_LOW_SIGNAL_CJK_PHRASES = (
    "本科第二学士学位人才培养方案",
    "本科专业第二学位人才培养方案",
    "本科第二学位人才培养方案",
    "第二学士学位人才培养方案",
    "第二学位人才培养方案",
    "本科人才培养方案",
    "人才培养方案",
    "课程教学计划",
    "教学计划",
    "课程地图",
)


def _apply_no_hit_policy(
    *,
    profile: CollectionRuntimeProfile,
    query_text: str,
    sources: tuple[EvidenceSource, ...],
) -> tuple[EvidenceSource, ...]:
    if not sources:
        return ()
    if profile.no_hit_min_top_score is None or profile.no_hit_min_score_gap is None:
        return sources
    top_source = sources[0]
    if top_source.score >= profile.no_hit_min_top_score:
        return sources
    runner_up_score = sources[1].score if len(sources) > 1 else top_source.score
    if (top_source.score - runner_up_score) >= profile.no_hit_min_score_gap:
        return sources
    if _has_query_lexical_support(
        query_text=query_text,
        snippets=tuple(source.snippet for source in sources),
    ):
        return sources
    if _has_unique_curriculum_doc_match(query_text=query_text, sources=sources):
        return sources
    return ()


def _has_query_lexical_support(*, query_text: str, snippets: str | Sequence[str]) -> bool:
    normalized_query = unicodedata.normalize("NFKC", query_text).lower()
    normalized_snippets = _normalize_snippets(snippets)
    if not normalized_query or not normalized_snippets:
        return False
    for token in _ASCII_QUERY_TOKEN_RE.findall(normalized_query):
        if any(token in normalized_snippet for normalized_snippet in normalized_snippets):
            return True
    for segment in _query_support_segments(normalized_query):
        if _segment_has_strong_lexical_support(
            segment=segment, normalized_snippets=normalized_snippets
        ):
            return True
    return False


def _has_unique_curriculum_doc_match(
    *,
    query_text: str,
    sources: Sequence[EvidenceSource],
) -> bool:
    interpretation = interpret_curriculum_query(query_text)
    if not interpretation.program_compact_key:
        return False
    return len(matching_curriculum_doc_ids(query_text=query_text, sources=sources)) == 1


def _normalize_snippets(snippets: str | Sequence[str]) -> tuple[str, ...]:
    values = (snippets,) if isinstance(snippets, str) else tuple(snippets)
    return tuple(
        normalized
        for normalized in (unicodedata.normalize("NFKC", value).lower() for value in values)
        if normalized
    )


def _segment_has_strong_lexical_support(
    *, segment: str, normalized_snippets: Sequence[str]
) -> bool:
    if len(segment) >= 4 and any(segment in snippet for snippet in normalized_snippets):
        return True
    trigrams = tuple(
        token
        for token in _cjk_query_tokens(segment, token_size=3)
        if token not in _WEAK_CJK_QUERY_TOKENS
    )
    if any(token in snippet for token in trigrams for snippet in normalized_snippets):
        return True
    matched_bigrams = {
        token
        for token in _cjk_query_tokens(segment, token_size=2)
        if token not in _WEAK_CJK_QUERY_TOKENS
        if any(token in snippet for snippet in normalized_snippets)
    }
    return len(matched_bigrams) >= 2


def _query_support_segments(normalized_query: str) -> tuple[str, ...]:
    stripped_query = normalized_query
    for phrase in _LOW_SIGNAL_CJK_PHRASES:
        stripped_query = stripped_query.replace(phrase, " ")
    stripped_segments = _cjk_segments(stripped_query)
    return stripped_segments or _cjk_segments(normalized_query)


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


def _cjk_query_tokens(segment: str, *, token_size: int) -> tuple[str, ...]:
    if token_size <= 0 or len(segment) < token_size:
        return ()
    return tuple(
        dict.fromkeys(
            token
            for token in (
                segment[index : index + token_size]
                for index in range(len(segment) - token_size + 1)
            )
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
