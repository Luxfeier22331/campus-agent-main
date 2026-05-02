from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any

from campus_ingestion_core.readable_text_normalization import normalize_readable_text

REGULATION_CANONICAL_NORMALIZER_VERSION = "collected_notice_regulation_canonical_cleaning_v2"

_CHINESE_NUMBER = "一二三四五六七八九十百千万0-9"
_CJK_RE = re.compile(r"[\u3400-\u9fff]")
_CHAPTER_HEADING_RE = re.compile(rf"^第[{_CHINESE_NUMBER}]+章[^\n]*", re.MULTILINE)
_ARTICLE_HEADING_RE = re.compile(rf"^第[{_CHINESE_NUMBER}]+条[^\n]*", re.MULTILINE)
_SECTION_HEADING_RE = re.compile(
    rf"^(?:[{_CHINESE_NUMBER}]+、[^\n]+|（[{_CHINESE_NUMBER}]+）[^\n]+)",
    re.MULTILINE,
)
_STRUCTURE_MARKER_RE = re.compile(
    rf"(第[{_CHINESE_NUMBER}]+[章节条]|[{_CHINESE_NUMBER}]+、|（[{_CHINESE_NUMBER}]+）)"
)
_PAGE_ARTIFACT_LINE_RE = re.compile(r"^\s*(?:[-—－]\s*\d+\s*[-—－]|\d+)\s*$")
_CHAPTER_SPACING_RE = re.compile(rf"(第[{_CHINESE_NUMBER}]+章)(?=\S)")
_ARTICLE_SPACING_RE = re.compile(rf"(第[{_CHINESE_NUMBER}]+条)(?=\S)")
_STRUCTURE_HEADING_LINE_RE = re.compile(
    rf"^(?:第[{_CHINESE_NUMBER}]+[章节条]|[{_CHINESE_NUMBER}]+、|[（(][{_CHINESE_NUMBER}]+[）)])"
)
_IMPRINT_DATE_LINE_RE = re.compile(r"^\d{4}年\d{1,2}月\d{1,2}日(?:印发|发布|公布|施行)?$")
_TERMINAL_PUNCTUATION = frozenset("。！？；;：:）)】]》”’\"'")
_WRAPPER_RESIDUE_TERMS = (
    "》的通知",
    "学校各单位",
    "学校各部门",
    "各单位、各部门",
    "现印发",
    "请遵照执行",
    "特此通知",
)


@dataclass(frozen=True, slots=True)
class RegulationTextNormalizationResult:
    canonical_body: str
    wrapper_removed: bool
    suspicious_prefix: bool
    title_occurrence_count: int
    chapter_count: int
    article_count: int
    page_artifact_count: int
    soft_wrap_repair_count: int
    soft_wrap_residue_count: int
    readability_normalization_count: int
    normalizer_version: str
    quality_verdict: str
    reason_codes: tuple[str, ...]


def normalize_regulation_owner_text(
    *,
    title: str,
    owner_text: str,
) -> RegulationTextNormalizationResult:
    normalized = _normalize_line_endings(owner_text)
    title_occurrence_count = normalized.count(title)
    body_start = _select_body_start(title=title, text=normalized)
    body = normalized[body_start:].strip()
    wrapper_removed = body_start > 0
    page_artifact_count = _count_page_artifacts(body)
    body = _remove_page_artifact_lines(body)
    body = _normalize_heading_spacing(body)
    body = _remove_leading_title(title=title, text=body)
    body, soft_wrap_repair_count = _repair_soft_wraps(body)
    before_readability = body
    body = _normalize_readability_by_line(body)
    readability_normalization_count = int(body != before_readability)
    body = _collapse_blank_lines(body)
    soft_wrap_residue_count = _count_soft_wrap_residue(body)
    mixed_ascii_cjk_artifact_count = _count_mixed_ascii_cjk_artifact_lines(body)
    chapter_count = len(_CHAPTER_HEADING_RE.findall(body))
    article_count = len(_ARTICLE_HEADING_RE.findall(body))
    if article_count == 0:
        article_count = len(_SECTION_HEADING_RE.findall(body))
    suspicious_prefix = _has_suspicious_prefix(body)
    reason_codes: list[str] = []
    if wrapper_removed:
        reason_codes.append("wrapper_removed")
    if page_artifact_count:
        reason_codes.append("page_artifacts_removed")
    if soft_wrap_repair_count:
        reason_codes.append("soft_wrap_repaired")
    if readability_normalization_count:
        reason_codes.append("readable_text_normalized")
    if soft_wrap_residue_count or mixed_ascii_cjk_artifact_count:
        reason_codes.append("soft_wrap_residue")
    if suspicious_prefix:
        reason_codes.append("suspicious_prefix")
    if chapter_count == 0 and article_count == 0:
        reason_codes.append("insufficient_regulation_structure")
    if suspicious_prefix:
        quality_verdict = "failed"
    elif (
        "insufficient_regulation_structure" in reason_codes
        or soft_wrap_residue_count
        or mixed_ascii_cjk_artifact_count
    ):
        quality_verdict = "flagged_manual_review"
    else:
        quality_verdict = "passed"
    return RegulationTextNormalizationResult(
        canonical_body=body,
        wrapper_removed=wrapper_removed,
        suspicious_prefix=suspicious_prefix,
        title_occurrence_count=title_occurrence_count,
        chapter_count=chapter_count,
        article_count=article_count,
        page_artifact_count=page_artifact_count,
        soft_wrap_repair_count=soft_wrap_repair_count,
        soft_wrap_residue_count=soft_wrap_residue_count,
        readability_normalization_count=readability_normalization_count,
        normalizer_version=REGULATION_CANONICAL_NORMALIZER_VERSION,
        quality_verdict=quality_verdict,
        reason_codes=tuple(reason_codes),
    )


def build_regulation_document_units(
    *,
    target_document_id: str,
    title: str,
    canonical_body: str,
) -> list[dict[str, Any]]:
    chunks = _structured_chunks(canonical_body)
    if not chunks:
        chunks = [("regulation_body_fallback", canonical_body.strip())]
    return [
        {
            "unit_id": f"{target_document_id}#unit-{index:04d}",
            "unit_index": index,
            "title": title if index == 1 else None,
            "unit_type": unit_type,
            "text_preview": _preview_text(text, limit=500),
            "char_count": len(text),
        }
        for index, (unit_type, text) in enumerate(chunks, start=1)
        if text.strip()
    ]


def _select_body_start(*, title: str, text: str) -> int:
    title_positions = [match.start() for match in re.finditer(re.escape(title), text)]
    standalone_positions = [
        position
        for position in title_positions
        if not _is_quoted_title(title=title, text=text, position=position)
        and _line_at(text=text, position=position).strip() == title
    ]
    for position in standalone_positions:
        if _has_structure_after(text=text, position=position + len(title)):
            return position
    non_wrapper_positions = [
        position
        for position in title_positions
        if not _is_quoted_title(title=title, text=text, position=position)
        and not _is_wrapper_line(text=text, position=position)
    ]
    for position in non_wrapper_positions:
        if _has_structure_after(text=text, position=position + len(title)):
            return position
    marker = _STRUCTURE_MARKER_RE.search(text)
    if marker is not None:
        return marker.start()
    if standalone_positions:
        return standalone_positions[-1]
    if non_wrapper_positions:
        return non_wrapper_positions[-1]
    return 0


def _has_structure_after(*, text: str, position: int) -> bool:
    return _STRUCTURE_MARKER_RE.search(text[position : position + 1200]) is not None


def _is_quoted_title(*, title: str, text: str, position: int) -> bool:
    before = text[position - 1] if position > 0 else ""
    after_index = position + len(title)
    after = text[after_index] if after_index < len(text) else ""
    return before == "《" and after == "》"


def _is_wrapper_line(*, text: str, position: int) -> bool:
    line = _line_at(text=text, position=position).strip()
    if line == "":
        return False
    has_notice_word = "通知" in line
    has_wrapper_verb = any(term in line for term in ("关于", "印发", "发布", "修订"))
    return has_notice_word and has_wrapper_verb


def _line_at(*, text: str, position: int) -> str:
    start = text.rfind("\n", 0, position) + 1
    end = text.find("\n", position)
    if end < 0:
        end = len(text)
    return text[start:end]


def _normalize_line_endings(text: str) -> str:
    lines = [line.strip() for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    return "\n".join(lines).strip()


def _count_page_artifacts(text: str) -> int:
    return sum(1 for line in text.splitlines() if _PAGE_ARTIFACT_LINE_RE.match(line))


def _remove_page_artifact_lines(text: str) -> str:
    return "\n".join(
        line for line in text.splitlines() if not _PAGE_ARTIFACT_LINE_RE.match(line)
    ).strip()


def _normalize_heading_spacing(text: str) -> str:
    text = _CHAPTER_SPACING_RE.sub(r"\1 ", text)
    return _ARTICLE_SPACING_RE.sub(r"\1 ", text)


def _repair_soft_wraps(text: str) -> tuple[str, int]:
    lines = text.splitlines()
    repaired: list[str] = []
    repair_count = 0
    index = 0
    while index < len(lines):
        line = lines[index]
        if line == "" and repaired:
            next_index = _next_non_blank_line_index(lines, start=index + 1)
            if next_index is not None and _should_merge_soft_wrap(
                repaired[-1], lines[next_index]
            ):
                repaired[-1] = f"{repaired[-1].rstrip()}{lines[next_index].lstrip()}"
                repair_count += 1
                index = next_index + 1
                continue
        if (
            line
            and repaired
            and repaired[-1] == ""
            and len(repaired) >= 2
            and _should_merge_soft_wrap(repaired[-2], line)
        ):
            repaired[-2] = f"{repaired[-2].rstrip()}{line.lstrip()}"
            repaired.pop()
            repair_count += 1
            index += 1
            continue
        repaired.append(line)
        index += 1
    return "\n".join(repaired).strip(), repair_count


def _next_non_blank_line_index(lines: list[str], *, start: int) -> int | None:
    for index in range(start, len(lines)):
        if lines[index].strip():
            return index
    return None


def _should_merge_soft_wrap(previous: str, following: str) -> bool:
    previous = previous.strip()
    following = following.strip()
    if not previous or not following:
        return False
    if _is_heading_only_line(following):
        return False
    if _is_heading_only_line(previous):
        return False
    if previous.endswith(tuple(_TERMINAL_PUNCTUATION)):
        return False
    if not _CJK_RE.search(previous):
        return False
    return bool(_CJK_RE.match(following))


def _normalize_readability_by_line(text: str) -> str:
    return "\n".join(normalize_readable_text(line) for line in text.splitlines())


def _is_heading_only_line(line: str) -> bool:
    stripped = line.strip()
    if not _STRUCTURE_HEADING_LINE_RE.match(stripped):
        return False
    if any(punctuation in stripped for punctuation in "，。；：,.，;:"):
        return False
    return len(stripped) <= 18


def _count_soft_wrap_residue(text: str) -> int:
    lines = text.splitlines()
    residue_count = 0
    for index, line in enumerate(lines):
        if line.strip() or index == 0 or index + 1 >= len(lines):
            continue
        if _has_soft_wrap_residue(lines[index - 1], lines[index + 1]):
            residue_count += 1
    return residue_count


def _has_soft_wrap_residue(previous: str, following: str) -> bool:
    previous = previous.strip()
    following = following.strip()
    if not previous or not following:
        return False
    if _looks_like_imprint_boundary(previous=previous, following=following):
        return False
    if _STRUCTURE_HEADING_LINE_RE.match(previous) or _STRUCTURE_HEADING_LINE_RE.match(following):
        return False
    if previous.endswith(tuple(_TERMINAL_PUNCTUATION)):
        return False
    return bool(_CJK_RE.search(previous))


def _looks_like_imprint_boundary(*, previous: str, following: str) -> bool:
    return (
        "办公室" in previous
        or previous.endswith(("委员会", "工作处", "研究生院", "教务处"))
    ) and _IMPRINT_DATE_LINE_RE.match(following) is not None


def _count_mixed_ascii_cjk_artifact_lines(text: str) -> int:
    return sum(
        1
        for line in text.splitlines()
        if _looks_like_mixed_ascii_cjk_artifact(line.strip())
    )


def _looks_like_mixed_ascii_cjk_artifact(line: str) -> bool:
    if not line or len(line) > 80:
        return False
    if not _CJK_RE.search(line):
        return False
    if _STRUCTURE_HEADING_LINE_RE.match(line):
        return False
    return bool(re.search(r"[A-Za-z]\d|\d[A-Za-z]", line))


def _remove_leading_title(*, title: str, text: str) -> str:
    stripped = text.strip()
    if stripped.startswith(title):
        stripped = stripped[len(title) :].strip()
    return stripped


def _collapse_blank_lines(text: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", text.strip())


def _has_suspicious_prefix(text: str) -> bool:
    prefix = text.strip()[:240]
    return any(term in prefix for term in _WRAPPER_RESIDUE_TERMS)


def _structured_chunks(text: str) -> list[tuple[str, str]]:
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
    return [("regulation_body_fallback", chunk) for chunk in chunks]


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


def _preview_text(text: str, *, limit: int) -> str:
    stripped = text.strip()
    if len(stripped) <= limit:
        return stripped
    return stripped[: limit - 1].rstrip() + "…"


__all__ = [
    "REGULATION_CANONICAL_NORMALIZER_VERSION",
    "RegulationTextNormalizationResult",
    "build_regulation_document_units",
    "normalize_regulation_owner_text",
]
