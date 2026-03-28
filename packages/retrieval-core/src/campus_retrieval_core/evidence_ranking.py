from __future__ import annotations

import re
import unicodedata
from typing import Sequence

from campus_contracts import EvidenceSource


_WHITESPACE_RE = re.compile(r"\s+")
_ASCII_TOKEN_RE = re.compile(r"[a-z0-9]{3,}")
_QUERY_FOCUS_TOKENS = (
    "课程地图",
    "教学进程",
    "教学计划",
    "总学分",
    "学制",
    "学位授予",
    "学位",
    "授予",
    "毕业学分",
    "毕业要求",
    "培养目标",
    "课程结构",
    "核心课程",
    "实践教学",
)
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


def prioritize_evidence_sources(
    *,
    query_text: str,
    sources: Sequence[EvidenceSource],
) -> tuple[EvidenceSource, ...]:
    normalized_query = _normalize_text(query_text)
    query_key = _match_key(normalized_query)
    if not query_key:
        return tuple(sources)
    return tuple(
        sorted(
            tuple(sources),
            key=lambda source: _rank_source(
                normalized_query=normalized_query,
                query_key=query_key,
                source=source,
            ),
            reverse=True,
        )
    )


def _rank_source(
    *,
    normalized_query: str,
    query_key: str,
    source: EvidenceSource,
) -> tuple[int, int, int, int, float]:
    title_candidates = _source_title_candidates(source)
    title_keys = tuple(_match_key(candidate) for candidate in title_candidates if candidate)
    exact_title_match = 1 if any(title_key == query_key for title_key in title_keys) else 0
    title_match_length = max((len(title_key) for title_key in title_keys if title_key in query_key), default=0)
    search_key = _match_key(" ".join((*title_candidates, source.snippet)))
    focus_match_count = sum(
        1
        for token in _query_focus_tokens(
            normalized_query=normalized_query,
            query_key=query_key,
            title_keys=title_keys,
        )
        if token in search_key
    )
    lexical_support_count = _query_lexical_support_count(
        normalized_query=normalized_query,
        query_key=query_key,
        search_key=search_key,
    )
    return (
        exact_title_match,
        title_match_length,
        focus_match_count,
        lexical_support_count,
        source.score,
    )


def query_targets_source_title(*, query_text: str, source: EvidenceSource) -> bool:
    query_key = _match_key(query_text)
    if not query_key:
        return False
    return any(
        title_key and title_key in query_key
        for title_key in (_match_key(candidate) for candidate in _source_title_candidates(source))
    )


def _source_title_candidates(source: EvidenceSource) -> tuple[str, ...]:
    candidates: list[str] = []
    doc_label = source.doc_id.split(":", 1)[-1].strip()
    if _looks_like_title(doc_label):
        candidates.append(doc_label)

    snippet = _normalize_text(source.snippet)
    for separator in ("\n", " / ", "。"):
        if separator in snippet:
            prefix = snippet.split(separator, 1)[0].strip()
            if _looks_like_title(prefix):
                candidates.append(prefix)
    return tuple(dict.fromkeys(candidates))


def _query_focus_tokens(
    *,
    normalized_query: str,
    query_key: str,
    title_keys: Sequence[str],
) -> tuple[str, ...]:
    focus_tokens = [token for token in _QUERY_FOCUS_TOKENS if token in normalized_query]
    if focus_tokens:
        return tuple(dict.fromkeys(focus_tokens))

    remainder = query_key
    for title_key in sorted((key for key in title_keys if key in query_key), key=len, reverse=True):
        remainder = query_key.replace(title_key, "", 1)
        break

    derived: list[str] = []
    for token_size in (4, 3, 2):
        for token in _cjk_tokens(remainder, token_size=token_size):
            if token in _LOW_SIGNAL_CJK_TOKENS:
                continue
            derived.append(token)
        if derived:
            break
    return tuple(dict.fromkeys(derived))


def _query_lexical_support_count(
    *,
    normalized_query: str,
    query_key: str,
    search_key: str,
) -> int:
    count = sum(1 for token in _ASCII_TOKEN_RE.findall(normalized_query) if token in search_key)
    for segment in _cjk_segments(query_key):
        if len(segment) >= 4 and segment in search_key:
            count += 2
            continue
        count += sum(1 for token in _cjk_tokens(segment, token_size=3) if token not in _LOW_SIGNAL_CJK_TOKENS and token in search_key)
        count += sum(1 for token in _cjk_tokens(segment, token_size=2) if token not in _LOW_SIGNAL_CJK_TOKENS and token in search_key)
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
