from __future__ import annotations

import re
from collections.abc import Mapping, Sequence

_ARTICLE_LABEL_RE = re.compile(r"^(?P<label>第[一二三四五六七八九十百千万〇零两0-9]+条)")
_CHAPTER_HEADING_RE = re.compile(r"^第[一二三四五六七八九十百千万〇零两0-9]+[章节][^。；]*$")
_TOP_LEVEL_HEADING_RE = re.compile(r"^[一二三四五六七八九十百千万〇零两0-9]+、[^。；]{1,60}$")
_SUBSECTION_HEADING_RE = re.compile(
    r"^[（(][一二三四五六七八九十百千万〇零两0-9]+[)）][、.]?[^。；]{0,60}$"
)
_GENERATED_AT_LIKE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:")
_STRUCTURAL_MARKER_RE = re.compile(
    r"(^|\n)\s*(第[一二三四五六七八九十百千万〇零两0-9]+[章节条]|"
    r"[一二三四五六七八九十百千万〇零两0-9]+、)"
)

REGULATION_TITLE_ROLES = frozenset({"regulation_title", "scoped_rule_title"})
REGULATION_BODY_ROLES = frozenset({"regulation_body", "scoped_rule_body"})


def is_regulation_title_role(value: object) -> bool:
    return str(value or "").strip() in REGULATION_TITLE_ROLES


def is_regulation_body_role(value: object) -> bool:
    return str(value or "").strip() in REGULATION_BODY_ROLES


def should_skip_regulation_structural_unit(*, text: str, metadata: Mapping[str, object]) -> bool:
    if not is_regulation_body_role(metadata.get("content_role")):
        return False
    if metadata.get("is_answer_bearing") is False:
        return True
    return looks_like_structural_heading(text)


def looks_like_structural_heading(text: str) -> bool:
    normalized = _strip_markdown_heading(text)
    if not normalized:
        return False
    article_match = _ARTICLE_LABEL_RE.match(normalized)
    if article_match is not None:
        article_body = normalized[article_match.end() :].strip()
        return not article_body
    return any(
        pattern.match(normalized)
        for pattern in (_CHAPTER_HEADING_RE, _TOP_LEVEL_HEADING_RE, _SUBSECTION_HEADING_RE)
    )


def section_path_contains_body_text(
    *,
    section_path: Sequence[object],
    display_text: str,
) -> bool:
    normalized_display = _compact_text(display_text)
    if not normalized_display:
        return False
    for item in section_path:
        normalized_item = str(item or "").strip()
        if not _looks_like_body_text(normalized_item):
            continue
        compact_item = _compact_text(normalized_item)
        if compact_item and (
            compact_item == normalized_display
            or compact_item in normalized_display
            or normalized_display in compact_item
        ):
            return True
    return False


def header_duplicates_display_text(*, chunk_text: str, display_text: str) -> bool:
    normalized_display = display_text.strip()
    if not normalized_display:
        return False
    lines = [line.strip() for line in chunk_text.splitlines() if line.strip()]
    if len(lines) < 2:
        return False
    header_text = "\n".join(lines[:-1])
    compact_display = _compact_text(normalized_display)
    compact_header = _compact_text(header_text)
    return bool(compact_display and compact_display in compact_header)


def title_text_is_duplicated(*, chunk_text: str, display_text: str) -> bool:
    normalized_display = display_text.strip()
    if not normalized_display:
        return False
    lines = [line.strip() for line in chunk_text.splitlines() if line.strip()]
    return sum(1 for line in lines if line == normalized_display) > 1


def header_token_ratio_at_least(
    *,
    metadata: Mapping[str, object],
    threshold: float,
) -> bool:
    try:
        header_tokens = int(metadata.get("header_token_count") or 0)
        display_tokens = int(metadata.get("display_token_count") or 0)
        final_tokens = int(metadata.get("final_token_count") or 0)
    except (TypeError, ValueError):
        return False
    denominator = final_tokens or header_tokens + display_tokens
    if denominator <= 0:
        return False
    return header_tokens / denominator >= threshold


def page_anchor_is_fabricated(anchor: Mapping[str, object], metadata: Mapping[str, object]) -> bool:
    if anchor.get("page_start") != 1 or anchor.get("page_end") != 1:
        return False
    return not (metadata.get("source_page_start") or metadata.get("source_page_end"))


def source_notice_release_time_is_generated_at(value: object) -> bool:
    normalized = str(value or "").strip()
    if not normalized or normalized == "unknown":
        return True
    return bool(_GENERATED_AT_LIKE_RE.match(normalized))


def token_guardrail_indicates_coarse_unit(metadata: Mapping[str, object]) -> bool:
    if str(metadata.get("split_reason") or "").strip() != "token_guardrail":
        return False
    display_text = str(metadata.get("display_text") or "")
    if not display_text.strip():
        return False
    marker_count = len(_STRUCTURAL_MARKER_RE.findall(display_text))
    if marker_count < 2:
        return False
    return not (metadata.get("article_label") or metadata.get("provision_label"))


def _looks_like_body_text(text: str) -> bool:
    normalized = text.strip()
    if len(normalized) < 12:
        return False
    article_match = _ARTICLE_LABEL_RE.match(normalized)
    if article_match is not None and normalized[article_match.end() :].strip():
        return True
    return any(marker in normalized for marker in ("。", "；", "，", "制定", "根据", "适用"))


def _strip_markdown_heading(text: str) -> str:
    return re.sub(r"^\s*#+\s*", "", text.strip())


def _compact_text(text: str) -> str:
    return re.sub(r"\s+", "", text.strip())


__all__ = [
    "REGULATION_BODY_ROLES",
    "REGULATION_TITLE_ROLES",
    "header_duplicates_display_text",
    "header_token_ratio_at_least",
    "is_regulation_body_role",
    "is_regulation_title_role",
    "looks_like_structural_heading",
    "page_anchor_is_fabricated",
    "section_path_contains_body_text",
    "should_skip_regulation_structural_unit",
    "source_notice_release_time_is_generated_at",
    "title_text_is_duplicated",
    "token_guardrail_indicates_coarse_unit",
]
