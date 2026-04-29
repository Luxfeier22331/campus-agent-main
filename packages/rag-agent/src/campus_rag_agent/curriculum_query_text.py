from __future__ import annotations

import re
import unicodedata

_WHITESPACE_RE = re.compile(r"\s+")
_DOC_NOISE = (
    "中央民族大学",
    "本科专业",
    "本科",
    "专业",
    "人才",
    "培养",
    "方案",
    "课程教学计划",
)


def _prepend_title_if_missing(*, normalized_query: str, title: str) -> str:
    if title in normalized_query:
        return normalized_query
    title_key = _compact_title_key(title)
    query_key = _compact_title_key(normalized_query)
    if title_key and title_key in query_key:
        return normalized_query
    return f"{title} {normalized_query}".strip()


def _compact_title_key(text: str) -> str:
    normalized = _normalize_text(text)
    compact = "".join(char for char in normalized if char.isalnum() or _is_cjk_char(char))
    for noise in _DOC_NOISE:
        compact = compact.replace(_compact_text(noise), "")
    return compact


def _compact_text(text: str) -> str:
    normalized = _normalize_text(text)
    return "".join(char for char in normalized if char.isalnum() or _is_cjk_char(char))


def _normalize_text(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", unicodedata.normalize("NFKC", text)).strip().lower()


def _is_cjk_char(char: str) -> bool:
    code_point = ord(char)
    return (
        0x3400 <= code_point <= 0x4DBF
        or 0x4E00 <= code_point <= 0x9FFF
        or 0xF900 <= code_point <= 0xFAFF
    )
