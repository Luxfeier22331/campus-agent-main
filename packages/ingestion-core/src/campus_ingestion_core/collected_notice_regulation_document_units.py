from __future__ import annotations

import re

_CHINESE_NUMBER = "一二三四五六七八九十百千万0-9"
_CHAPTER_HEADING_RE = re.compile(rf"^第[{_CHINESE_NUMBER}]+章[^\n]*", re.MULTILINE)
_ARTICLE_HEADING_RE = re.compile(rf"^第[{_CHINESE_NUMBER}]+条[^\n]*", re.MULTILINE)
_SECTION_HEADING_RE = re.compile(
    rf"^(?:[{_CHINESE_NUMBER}]+、[^\n]+|（[{_CHINESE_NUMBER}]+）[^\n]+)", re.MULTILINE
)


def structured_regulation_chunks(text: str) -> list[tuple[str, str]]:
    stripped = text.strip()
    if not stripped:
        return []
    chapter_matches = list(_CHAPTER_HEADING_RE.finditer(stripped))
    if chapter_matches:
        return [("chapter", chunk) for chunk in _chunks_from_matches(stripped, chapter_matches)]
    article_matches = list(_ARTICLE_HEADING_RE.finditer(stripped))
    if article_matches:
        return [("article", chunk) for chunk in _chunks_from_matches(stripped, article_matches)]
    section_matches = list(_SECTION_HEADING_RE.finditer(stripped))
    if section_matches:
        return [("article", chunk) for chunk in _chunks_from_matches(stripped, section_matches)]
    chunks = [chunk.strip() for chunk in re.split(r"\n{2,}", stripped) if chunk.strip()]
    return [("regulation_body_unstructured", chunk) for chunk in chunks]


def _chunks_from_matches(text: str, matches: list[re.Match[str]]) -> list[str]:
    chunks: list[str] = []
    prefix = text[: matches[0].start()].strip()
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        chunk = text[match.start() : end].strip()
        if index == 0 and prefix:
            chunk = f"{prefix}\n\n{chunk}"
        chunks.append(chunk)
    return chunks


def preview_text(text: str, *, limit: int) -> str:
    stripped = text.strip()
    if len(stripped) <= limit:
        return stripped
    return stripped[: limit - 1].rstrip() + "…"


__all__ = ["preview_text", "structured_regulation_chunks"]
