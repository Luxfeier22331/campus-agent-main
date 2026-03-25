from __future__ import annotations

from dataclasses import dataclass
import re
import unicodedata


ARTICLE_PREFIX_RE = re.compile(
    r"^(?P<label>第\s*[0-9一二三四五六七八九十百千万〇零两]+\s*条)\s*(?P<rest>.*)$"
)
CHAPTER_SECTION_RE = re.compile(
    r"^(?:第[一二三四五六七八九十百千万〇零两]+[章节编]|总则|附则|实施细则|说明).*$"
)
CHAPTER_SECTION_LABEL_RE = re.compile(
    r"^(?P<label>第[一二三四五六七八九十百千万〇零两]+[章节编])\s*(?P<rest>.*)$"
)
PART_HEADING_RE = re.compile(r"^(?P<label>第[一二三四五六七八九十百千万〇零两0-9]+部分)\s*(?P<rest>.*)$")
ENUMERATED_HEADING_RE = re.compile(
    r"^(?P<label>[一二三四五六七八九十百千万〇零两0-9]+、)\s*(?P<rest>.+)$"
)
PAREN_ENUMERATED_HEADING_RE = re.compile(
    r"^(?P<label>[（(][一二三四五六七八九十百千万〇零两0-9]+[)）])\s*(?P<rest>.+)$"
)
SENTENCE_PUNCTUATION_RE = re.compile(r"[。！？；]")
MAX_ENUMERATED_HEADING_LENGTH = 24


@dataclass(frozen=True, slots=True)
class StructuralHeading:
    text: str
    rank: int
    kind: str


def classify_structural_heading(
    *,
    text: str,
    row_type: str,
    next_text: str | None,
) -> StructuralHeading | None:
    normalized = _normalize_text(text)
    if not normalized:
        return None
    if _looks_like_article_line(normalized):
        return None

    chapter_heading = _classify_chapter_heading(normalized)
    if chapter_heading is not None:
        return chapter_heading

    part_heading = _classify_part_heading(normalized)
    if part_heading is not None:
        return part_heading

    allow_implicit = row_type == "heading" or next_text is not None
    if not allow_implicit:
        return None

    enumerated_heading = _classify_enumerated_heading(normalized)
    if enumerated_heading is not None:
        return enumerated_heading
    return None


def _classify_chapter_heading(text: str) -> StructuralHeading | None:
    if not CHAPTER_SECTION_RE.match(text):
        return None
    normalized = _normalize_chapter_heading(text)
    return StructuralHeading(text=normalized, rank=_chapter_heading_rank(normalized), kind="chapter")


def _classify_part_heading(text: str) -> StructuralHeading | None:
    match = PART_HEADING_RE.match(text)
    if match is None:
        return None
    rest = _normalize_text(match.group("rest"))
    normalized = match.group("label") if not rest else f"{match.group('label')} {rest}"
    return StructuralHeading(text=normalized, rank=4, kind="part")


def _classify_enumerated_heading(text: str) -> StructuralHeading | None:
    match = ENUMERATED_HEADING_RE.match(text)
    if match is not None and _looks_like_heading_title(match.group("rest"), full_text=text):
        return StructuralHeading(text=text, rank=5, kind="enumerated")

    match = PAREN_ENUMERATED_HEADING_RE.match(text)
    if match is not None and _looks_like_heading_title(match.group("rest"), full_text=text):
        return StructuralHeading(text=text, rank=6, kind="enumerated_subsection")
    return None


def _normalize_chapter_heading(text: str) -> str:
    match = CHAPTER_SECTION_LABEL_RE.match(text)
    if match is None:
        return text
    rest = _normalize_text(match.group("rest"))
    return match.group("label") if not rest else f"{match.group('label')} {rest}"


def _chapter_heading_rank(text: str) -> int:
    if text.startswith("第") and text.endswith("编"):
        return 1
    if text.startswith("第") and "章" in text[:8]:
        return 2
    if text.startswith("第") and "节" in text[:8]:
        return 3
    return 2


def _looks_like_heading_title(rest: str, *, full_text: str) -> bool:
    normalized_rest = _normalize_text(rest)
    if not normalized_rest:
        return False
    if len(full_text) > MAX_ENUMERATED_HEADING_LENGTH:
        return False
    if SENTENCE_PUNCTUATION_RE.search(full_text):
        return False
    if "，" in full_text:
        return False
    return True


def _looks_like_article_line(text: str) -> bool:
    return ARTICLE_PREFIX_RE.match(text) is not None


def _normalize_text(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value.replace("\r\n", "\n").replace("\r", "\n")).strip()
    lines = [" ".join(line.split()).strip() for line in normalized.split("\n")]
    return "\n".join(line for line in lines if line)


__all__ = ["StructuralHeading", "classify_structural_heading"]
