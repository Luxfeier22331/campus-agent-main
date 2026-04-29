from __future__ import annotations

import re
import unicodedata

from campus_ingestion_core.handbook_cleanup_shared import (
    BODY_SENTENCE_STARTERS,
    SHORT_HEADING_SEMANTIC_SUFFIXES,
    SHORT_HEADING_WHITELIST,
)

_INLINE_CHAPTER_BOUNDARY_MARKER_RE = re.compile(
    r"(?P<label>[一二三四五六七八九十百千万〇零两]+、)"
    r"(?P<title>[一-鿿、与及和\-]{2,16})"
)
_INLINE_PARENTHESIZED_ENUM_MARKER_RE = re.compile(
    r"[（(][一二三四五六七八九十百千万〇零两0-9]+[)）]"
)


def _normalize_body_fragment(value: str) -> str:
    return unicodedata.normalize("NFKC", value.replace("\r\n", "\n").replace("\r", "\n")).strip()


def _looks_like_semantic_short_heading_fragment(text: str) -> bool:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return False
    if normalized in SHORT_HEADING_WHITELIST:
        return True
    return any(normalized.endswith(suffix) for suffix in SHORT_HEADING_SEMANTIC_SUFFIXES)


def _split_inline_article_boundaries(text: str) -> list[str]:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return []
    lines = _split_inline_chapter_heading_boundaries(normalized)
    split_lines: list[str] = []
    for line in lines:
        split_lines.extend(_split_dense_parenthesized_enum_boundaries(line))
    return split_lines


def _split_inline_chapter_heading_boundaries(text: str) -> list[str]:
    boundaries: list[int] = []
    for match in _INLINE_CHAPTER_BOUNDARY_MARKER_RE.finditer(text):
        marker_start = match.start("label")
        if marker_start <= 0:
            continue
        prefix = text[:marker_start].rstrip()
        if not prefix.endswith(("。", "！", "？", "；", ";")):
            continue
        if not _starts_with_inline_chapter_heading(text[marker_start:]):
            continue
        boundaries.append(marker_start)
    return _split_text_at_boundaries(text, boundaries)


def _starts_with_inline_chapter_heading(text: str) -> bool:
    normalized = _normalize_body_fragment(text)
    max_heading_length = min(len(normalized), 24)
    for split_index in range(4, max_heading_length + 1):
        heading = normalized[:split_index].strip()
        if not (
            _looks_like_semantic_short_heading_fragment(heading)
            or _looks_like_numbered_inline_chapter_heading(heading)
        ):
            continue
        remainder = normalized[split_index:].strip()
        return not remainder or any(
            remainder.startswith(starter) for starter in BODY_SENTENCE_STARTERS
        )
    return False


def _looks_like_numbered_inline_chapter_heading(text: str) -> bool:
    normalized = _normalize_body_fragment(text)
    return bool(
        re.fullmatch(
            r"[一二三四五六七八九十百千万〇零两]+、[\u4e00-\u9fff、与及和\-]{2,12}",
            normalized,
        )
        and normalized.endswith(
            (
                "管理",
                "项目",
                "职责",
                "程序",
                "计划",
                "要求",
                "办法",
                "说明",
                "标准",
                "条件",
            )
        )
    )


def _split_dense_parenthesized_enum_boundaries(text: str) -> list[str]:
    boundaries: list[int] = []
    for match in _INLINE_PARENTHESIZED_ENUM_MARKER_RE.finditer(text):
        marker_start = match.start()
        if marker_start <= 0:
            continue
        prefix = text[:marker_start].rstrip()
        if not prefix:
            continue
        if prefix.endswith((":", "：", ";", "；", "。", "！", "？", "!", "?")) or (
            _INLINE_PARENTHESIZED_ENUM_MARKER_RE.search(prefix) is not None
        ):
            boundaries.append(marker_start)
    return _split_text_at_boundaries(text, boundaries)


def _split_text_at_boundaries(text: str, boundaries: list[int]) -> list[str]:
    if not boundaries:
        return [text]
    parts: list[str] = []
    cursor = 0
    for boundary in sorted(set(boundaries)):
        part = text[cursor:boundary].strip()
        if part:
            parts.append(part)
        cursor = boundary
    tail = text[cursor:].strip()
    if tail:
        parts.append(tail)
    return parts


__all__ = ["_split_inline_article_boundaries"]
