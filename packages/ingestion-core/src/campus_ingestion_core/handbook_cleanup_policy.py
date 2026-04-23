from __future__ import annotations

import re

from campus_ingestion_core.handbook_cleanup_normalize import (
    _normalize_article_label,
    _normalize_body_fragment,
    _split_title_like_heading_body,
    normalize_handbook_article_body_text,
    normalize_handbook_body_text,
)
from campus_ingestion_core.handbook_cleanup_shared import (
    ANCILLARY_NOTE_SUFFIXES,
    APPENDIX_INLINE_TITLE_SUFFIXES,
    APPENDIX_MARKERS,
    ARTICLE_PREFIX_RE,
    ATTACHMENT_INLINE_LABEL_RE,
    ATTACHMENT_TITLE_SUFFIXES,
    CLOSING_SECTION_KEYWORDS,
    DATED_EFFECTIVE_CLAUSE_RE,
    INLINE_ENUMERATED_HEADING_RE,
    INLINE_ENUMERATED_LABEL_RE,
    INLINE_ENUMERATED_PROVISION_RE,
    INLINE_LIST_MARKER_RE,
    LEAF_SECTION_PUNCTUATION_RE,
    LIST_ENTRY_PHONE_RE,
    LIST_ENTRY_TWO_FIELD_RE,
    NAVIGATION_LEAF_FORBIDDEN_FRAGMENTS,
    NAVIGATION_SECTION_KEYWORDS,
    POLICY_DOC_NO_RE,
    POLICY_LEAF_SECTION_RANK,
    RUNNING_HEADER_LINES,
    TERMINAL_PROVISION_KEYWORDS,
)
from campus_ingestion_core.handbook_structure import classify_structural_heading


def _split_article_line(text: str) -> tuple[str | None, str]:
    match = ARTICLE_PREFIX_RE.match(text)
    if match is None:
        return None, ""
    raw_rest = " ".join(_normalize_body_fragment(match.group("rest")).split()).strip()
    rest = normalize_handbook_article_body_text(raw_rest)
    return _normalize_article_label(match.group("label")), rest


def _looks_like_policy_doc_no(text: str) -> bool:
    return bool(POLICY_DOC_NO_RE.match(_normalize_policy_doc_no(text)))


def _normalize_policy_doc_no(text: str) -> str:
    normalized = normalize_handbook_body_text(text)
    normalized = re.sub(r"\s*([\[〔])\s*", r"\1", normalized)
    normalized = re.sub(r"\s*([\]〕])\s*", r"\1", normalized)
    return re.sub(r"(?<=[\]〕])\s+(?=\d)", "", normalized)


def _looks_like_list_entry(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    if not normalized:
        return False
    if LIST_ENTRY_PHONE_RE.search(normalized):
        return True
    return bool(LIST_ENTRY_TWO_FIELD_RE.match(normalized))


def _looks_like_appendix_heading(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    if not normalized:
        return False
    for marker in APPENDIX_MARKERS:
        if not normalized.startswith(marker):
            continue
        remainder = normalized[len(marker) :]
        if not remainder:
            return True
        leading = remainder[0]
        if leading.isspace() or leading in "0123456789一二三四五六七八九十:：":
            return True
    return False


def _extract_appendix_heading_title(text: str) -> str | None:
    normalized = normalize_handbook_body_text(text)
    if not normalized:
        return None
    for marker in APPENDIX_MARKERS:
        if not normalized.startswith(marker):
            continue
        remainder = normalized[len(marker) :].lstrip()
        if remainder.startswith((":", "：")):
            remainder = remainder[1:].lstrip()
        remainder = normalize_handbook_body_text(remainder)
        if remainder:
            return remainder
    return None


def _looks_like_appendix_marker_only(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    return normalized in {"附件:", "附件：", "附表:", "附表：", "附录:", "附录："}


def _split_appendix_inline_title(text: str) -> tuple[str, str] | None:
    normalized = normalize_handbook_body_text(text)
    if not normalized:
        return None
    for suffix in APPENDIX_INLINE_TITLE_SUFFIXES:
        marker = f"{suffix}兹证明"
        marker_index = normalized.find(marker)
        if marker_index <= 0:
            continue
        title = normalized[: marker_index + len(suffix)].strip()
        body = normalized[marker_index + len(suffix) :].lstrip()
        if not title or not body:
            continue
        return title, body
    split_body = _split_title_like_heading_body(normalized)
    if split_body is None:
        return None
    heading, remainder = split_body
    if not any(heading.endswith(suffix) for suffix in APPENDIX_INLINE_TITLE_SUFFIXES):
        return None
    return heading, remainder


def _split_attachment_title_with_body(text: str) -> tuple[str, str] | None:
    normalized = normalize_handbook_body_text(text)
    if not normalized:
        return None
    attachment_label_match = ATTACHMENT_INLINE_LABEL_RE.match(normalized)
    attachment_label = (
        attachment_label_match.group("label").strip() if attachment_label_match is not None else ""
    )
    attachment_body_source = (
        attachment_label_match.group("body").strip()
        if attachment_label_match is not None
        else normalized
    )
    marker_match = INLINE_LIST_MARKER_RE.match(normalized)
    title_candidate = (
        marker_match.group("body").strip() if marker_match is not None else attachment_body_source
    )
    stripped_title_candidate = _strip_running_header_prefix(title_candidate)
    had_running_header_prefix = stripped_title_candidate != title_candidate
    if (
        had_running_header_prefix
        and not attachment_label
        and not stripped_title_candidate.startswith("《")
    ):
        return None
    title = None
    title_body = ""
    if _looks_like_attachment_title_text(stripped_title_candidate):
        title = stripped_title_candidate
    else:
        leading_title = _extract_leading_attachment_title(stripped_title_candidate)
        if leading_title is not None:
            title, title_body = leading_title
        else:
            for suffix in ATTACHMENT_TITLE_SUFFIXES:
                marker_index = stripped_title_candidate.find(suffix)
                if marker_index < 0:
                    continue
                candidate_title = stripped_title_candidate[: marker_index + len(suffix)].strip()
                if not _looks_like_attachment_title_text(candidate_title):
                    continue
                title = candidate_title
                title_body = stripped_title_candidate[marker_index + len(suffix) :].strip()
                break
    if title is None:
        return None
    if attachment_label:
        title = f"{attachment_label}{title}"
    else:
        title = _normalize_attachment_heading_text(title)
    if not title_body and marker_match is None:
        return title, ""
    if not title_body and marker_match is not None:
        title_body = normalized[marker_match.end() :].strip()
    title_body = _strip_running_header_prefix(title_body)
    if _attachment_title_body(title_body) == _attachment_title_body(title):
        title_body = ""
    return title, title_body


def _extract_leading_attachment_title(text: str) -> tuple[str, str] | None:
    normalized = normalize_handbook_body_text(text)
    if not normalized or not normalized.startswith("《"):
        return None
    closing_index = normalized.find("》")
    if closing_index <= 1:
        return None
    candidate_title = normalized[: closing_index + 1].strip()
    if not _looks_like_attachment_title_text(candidate_title):
        return None
    remainder = normalized[closing_index + 1 :].strip()
    return candidate_title, remainder


def _looks_like_list_section_heading(text: str, next_text: str | None) -> bool:
    normalized = normalize_handbook_body_text(text)
    if not normalized or next_text is None:
        return False
    if _split_article_line(normalized)[0] is not None:
        return False
    if (
        classify_structural_heading(text=normalized, row_type="paragraph", next_text=next_text)
        is not None
    ):
        return False
    if LIST_ENTRY_PHONE_RE.search(normalized):
        return False
    if any(char.isspace() for char in normalized):
        return False
    if len(normalized) > 24:
        return False
    if LEAF_SECTION_PUNCTUATION_RE.search(normalized):
        return False
    return _looks_like_list_entry(next_text)


def _looks_like_navigation_policy_leaf(
    text: str,
    *,
    current_section_nodes: list[tuple[int, str]],
) -> bool:
    normalized = normalize_handbook_body_text(text)
    if not normalized or LEAF_SECTION_PUNCTUATION_RE.search(normalized):
        return False
    match = INLINE_LIST_MARKER_RE.match(normalized)
    if match is None:
        return False
    body = match.group("body").strip()
    if not body or len(body) > 24:
        return False
    if any(keyword in body for keyword in NAVIGATION_LEAF_FORBIDDEN_FRAGMENTS):
        return False
    return any(
        keyword in section_text
        for _, section_text in current_section_nodes
        for keyword in NAVIGATION_SECTION_KEYWORDS
    )


def _looks_like_attachment_title_text(text: str) -> bool:
    normalized = _attachment_title_body(text)
    if not normalized or LEAF_SECTION_PUNCTUATION_RE.search(normalized):
        return False
    if ("《" in normalized or "》" in normalized) and not (
        normalized.startswith("《") and normalized.endswith("》")
    ):
        return False
    candidate = (
        normalized[1:-1].strip()
        if normalized.startswith("《") and normalized.endswith("》")
        else normalized
    )
    if not candidate or len(candidate) > 48:
        return False
    return any(candidate.endswith(suffix) for suffix in ATTACHMENT_TITLE_SUFFIXES)


def _looks_like_ancillary_note_line(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    if not normalized or LEAF_SECTION_PUNCTUATION_RE.search(normalized):
        return False
    return len(normalized) <= 24 and any(
        normalized.endswith(suffix) for suffix in ANCILLARY_NOTE_SUFFIXES
    )


def _normalize_policy_page_body_text(text: str) -> str:
    normalized = normalize_handbook_body_text(text)
    if not normalized:
        return ""
    kept_lines = []
    for line in normalized.splitlines():
        stripped = _strip_running_header_prefix(line)
        if not stripped or _is_running_header_line(stripped):
            continue
        kept_lines.append(stripped)
    return normalize_handbook_body_text("\n".join(kept_lines)) if kept_lines else ""


def _normalize_policy_page_table_context(text: str) -> str | None:
    normalized = _normalize_policy_page_body_text(text)
    if not normalized:
        return None
    parts = [line.strip() for line in normalized.splitlines() if line.strip()]
    if not parts:
        return None
    return "\n".join(parts)


def _is_running_header_line(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    return normalized in RUNNING_HEADER_LINES


def _strip_running_header_prefix(text: str) -> str:
    normalized = normalize_handbook_body_text(text)
    for prefix in RUNNING_HEADER_LINES:
        if normalized.startswith(prefix):
            return normalized[len(prefix) :].strip()
    return normalized


def _is_duplicate_attachment_cover_text(
    *,
    text: str,
    current_section_nodes: list[tuple[int, str]],
) -> bool:
    normalized = _strip_running_header_prefix(text)
    if not normalized or not current_section_nodes:
        return False
    current_leaf = normalize_handbook_body_text(current_section_nodes[-1][1])
    if not current_leaf or not _looks_like_attachment_title_text(current_leaf):
        return False
    current_leaf_body = _attachment_title_body(current_leaf)
    normalized_body = _attachment_title_body(normalized)
    if normalized == current_leaf:
        return True
    if current_leaf_body and normalized == current_leaf_body:
        return True
    if current_leaf_body and normalized_body and normalized_body == current_leaf_body:
        return True
    return False


def _attachment_title_body(text: str) -> str:
    normalized = normalize_handbook_body_text(text)
    if not normalized:
        return ""
    attachment_label_match = ATTACHMENT_INLINE_LABEL_RE.match(normalized)
    if attachment_label_match is not None:
        normalized = attachment_label_match.group("body").strip()
    marker_match = INLINE_LIST_MARKER_RE.match(normalized)
    if marker_match is not None:
        return marker_match.group("body").strip()
    return (
        normalized[1:-1].strip()
        if normalized.startswith("《") and normalized.endswith("》")
        else normalized
    )


def _looks_like_appendix_leaf_section_heading(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    if not normalized or re.search(r"[，,。；;！？!?]", normalized):
        return False
    return bool(re.fullmatch(r"[0-9一二三四五六七八九十百千万〇零两]+[:：]?", normalized))


def _next_policy_leaf_section_rank(current_section_nodes: list[tuple[int, str]]) -> int:
    if not current_section_nodes:
        return POLICY_LEAF_SECTION_RANK
    return max(rank for rank, _ in current_section_nodes) + 1


def _normalize_attachment_heading_text(text: str) -> str:
    normalized = normalize_handbook_body_text(text)
    if normalized.startswith("《") and normalized.endswith("》"):
        inner = normalized[1:-1].strip()
        if inner:
            return inner
    return normalized


def _split_inline_enumerated_provision(text: str) -> tuple[str, str] | None:
    normalized = normalize_handbook_body_text(text)
    if not normalized:
        return None
    if _split_article_line(normalized)[0] is not None:
        return None
    match = INLINE_ENUMERATED_LABEL_RE.match(normalized)
    if match is None or not INLINE_ENUMERATED_PROVISION_RE.match(normalized):
        return None
    return match.group("label"), normalized


def _looks_like_terminal_inline_enumerated_provision(
    text: str,
    current_section_nodes: list[tuple[int, str]],
) -> bool:
    provision = _split_inline_enumerated_provision(text)
    if provision is None:
        return False
    _, normalized = provision
    body = normalized.split("、", 1)[1].strip()
    if not body:
        return False
    in_closing_section = any(
        keyword in section_text
        for _, section_text in current_section_nodes
        for keyword in CLOSING_SECTION_KEYWORDS
    )
    if in_closing_section and len(body) <= 64:
        return True
    return len(body) <= 96 and (
        any(keyword in body for keyword in TERMINAL_PROVISION_KEYWORDS)
        or DATED_EFFECTIVE_CLAUSE_RE.match(body) is not None
    )


def _should_emit_inline_policy_provision(
    text: str,
    *,
    current_section_nodes: list[tuple[int, str]],
    current_policy_page: dict[str, object] | None,
) -> bool:
    if _looks_like_terminal_inline_enumerated_provision(text, current_section_nodes):
        return True
    if current_policy_page is None:
        return False
    provision = _split_inline_enumerated_provision(text)
    if provision is None:
        return False
    _, normalized = provision
    body = normalized.split("、", 1)[1].strip()
    if len(body) > 128:
        return False
    return _policy_page_contains_nested_numbered_items(current_policy_page)


def _policy_page_contains_nested_numbered_items(current_policy_page: dict[str, object]) -> bool:
    parts = current_policy_page.get("parts")
    if not isinstance(parts, list):
        return False
    for part in parts:
        normalized = normalize_handbook_body_text(str(part))
        if re.match(
            r"^(?:[0-9]+[.、]|[（(][一二三四五六七八九十百千万〇零两0-9]+[)）])", normalized
        ):
            return True
    return False


def _looks_like_inline_enumerated_heading(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    if not normalized:
        return False
    if normalized[-1] in "。；！？":
        return False
    return bool(INLINE_ENUMERATED_HEADING_RE.match(normalized))


__all__ = [
    "_extract_appendix_heading_title",
    "_is_duplicate_attachment_cover_text",
    "_looks_like_ancillary_note_line",
    "_looks_like_appendix_heading",
    "_looks_like_appendix_leaf_section_heading",
    "_looks_like_appendix_marker_only",
    "_looks_like_attachment_title_text",
    "_looks_like_inline_enumerated_heading",
    "_looks_like_list_entry",
    "_looks_like_list_section_heading",
    "_looks_like_navigation_policy_leaf",
    "_looks_like_policy_doc_no",
    "_looks_like_terminal_inline_enumerated_provision",
    "_next_policy_leaf_section_rank",
    "_normalize_attachment_heading_text",
    "_normalize_policy_doc_no",
    "_normalize_policy_page_body_text",
    "_normalize_policy_page_table_context",
    "_should_emit_inline_policy_provision",
    "_split_appendix_inline_title",
    "_split_article_line",
    "_split_attachment_title_with_body",
]
