from __future__ import annotations

import hashlib
import re
import unicodedata

from campus_ingestion_core.handbook_article_structure import (
    is_title_like_heading,
    normalize_article_body_structure,
)
from campus_ingestion_core.handbook_cleanup_shared import (
    ARTICLE_PREFIX_RE,
    BODY_SENTENCE_STARTERS,
    CITATION_CONTINUATION_START_CHARS,
    DATE_LINE_RE,
    DOC_NO_PARENTHESES_REPAIR_RE,
    INLINE_ENUMERATED_LABEL_RE,
    INLINE_LIST_MARKER_RE,
    INLINE_OCR_REFERENCE_MARKER_RE,
    LEAF_SECTION_PUNCTUATION_RE,
    NAVIGATION_SECTION_KEYWORDS,
    NOTE_LINE_PREFIXES,
    POLICY_DOC_NO_RE,
    RUNNING_HEADER_LINES,
    SHORT_HEADING_BODY_STARTERS,
    SHORT_HEADING_FORBIDDEN_FRAGMENTS,
    SHORT_HEADING_PREFIX_RE,
    SHORT_HEADING_SEMANTIC_SUFFIXES,
    SHORT_HEADING_WHITELIST,
    SOFT_WRAP_CONTINUATION_CHARS,
    STRUCTURAL_LINE_RE,
    TOP_LEVEL_ENUMERATED_RE,
)


def build_handbook_doc_id(title: str) -> str:
    return "handbook:" + hashlib.sha1(normalize_handbook_title(title).encode("utf-8")).hexdigest()


def build_handbook_version_id(title: str, canonical_body: str) -> str:
    digest_input = (
        f"{normalize_handbook_title(title)}\n\n{normalize_handbook_body_text(canonical_body)}"
    )
    return "v1:" + hashlib.sha1(digest_input.encode("utf-8")).hexdigest()


def normalize_handbook_title(value: str) -> str:
    normalized = " ".join(unicodedata.normalize("NFKC", value).strip().split())
    return re.sub(r"(?<=[\u4e00-\u9fff])\s+(?=[\u4e00-\u9fff])", "", normalized)


def normalize_handbook_body_text(value: str) -> str:
    normalized = _normalize_body_fragment(value)
    lines = [" ".join(line.split()).strip() for line in normalized.split("\n")]
    merged_lines = _merge_broken_body_lines([line for line in lines if line])
    normalized_lines = [
        _repair_known_ocr_phrase_errors(
            _repair_missing_parenthetical_doc_no_closure(_normalize_structural_body_glue(line))
        )
        for line in merged_lines
    ]
    deduplicated = _deduplicate_boundary_overlap_lines(normalized_lines)
    return "\n".join(deduplicated)


def normalize_handbook_article_body_text(value: str) -> str:
    normalized = normalize_handbook_body_text(value)
    lines = [
        line.strip()
        for line in normalized.splitlines()
        if line.strip() and not _is_running_header_line(line)
    ]
    merged_lines = _merge_article_soft_wrapped_lines(lines)
    normalized_article_lines = [_normalize_article_heading_body_glue(line) for line in merged_lines]
    return normalize_article_body_structure("\n".join(normalized_article_lines))


def _normalize_body_fragment(value: str) -> str:
    return unicodedata.normalize("NFKC", value.replace("\r\n", "\n").replace("\r", "\n")).strip()


def _is_running_header_line(text: str) -> bool:
    normalized = " ".join(_normalize_body_fragment(text).split()).strip()
    return normalized in RUNNING_HEADER_LINES


def _merge_broken_body_lines(lines: list[str]) -> list[str]:
    merged: list[str] = []
    for line in lines:
        if merged and _should_merge_broken_line(merged[-1], line):
            merged[-1] = f"{merged[-1]}{line}"
            continue
        merged.append(line)
    return merged


def _merge_article_soft_wrapped_lines(lines: list[str]) -> list[str]:
    merged: list[str] = []
    for line in lines:
        if merged and _should_merge_article_soft_wrap(merged[-1], line):
            merged[-1] = f"{merged[-1]}{line}"
            continue
        merged.append(line)
    return merged


def _should_merge_broken_line(previous: str, current: str) -> bool:
    if not previous or not current:
        return False
    if previous.lstrip().startswith("#") or current.lstrip().startswith("#"):
        return False
    if previous.endswith(("。", "！", "？", "；", "：", ":")):
        return False
    if _looks_like_front_matter_line(previous) or _looks_like_front_matter_line(current):
        return False
    if _looks_like_structural_line(current):
        return False
    if _looks_like_formula_line(previous) or _looks_like_formula_line(current):
        return False
    if _looks_like_citation_continuation(previous, current):
        return True
    if _looks_like_intended_structural_split(previous, current):
        return False
    if _looks_like_heading_note_boundary(previous, current):
        return False
    previous_tail = previous[-1]
    current_head = current[0]
    if previous_tail in SOFT_WRAP_CONTINUATION_CHARS and _is_sentence_char(current_head):
        return True
    if not (_is_sentence_char(previous_tail) and _is_sentence_char(current_head)):
        return False
    return True


def _should_merge_article_soft_wrap(previous: str, current: str) -> bool:
    normalized_previous = _normalize_body_fragment(previous)
    normalized_current = _normalize_body_fragment(current)
    if not normalized_previous or not normalized_current:
        return False
    if _looks_like_front_matter_line(normalized_previous) or _looks_like_front_matter_line(
        normalized_current
    ):
        return False
    if _looks_like_formula_line(normalized_previous) or _looks_like_formula_line(
        normalized_current
    ):
        return False
    if _looks_like_citation_continuation(normalized_previous, normalized_current):
        return True
    if _looks_like_article_structure_line(normalized_current):
        return False
    if _looks_like_intended_structural_split(normalized_previous, normalized_current):
        return False
    if _looks_like_heading_note_boundary(normalized_previous, normalized_current):
        return False
    if normalized_previous.endswith(("。", "！", "？", "；", "：", ":")):
        return False
    if normalized_previous[-1] in SOFT_WRAP_CONTINUATION_CHARS and _is_sentence_char(
        normalized_current[0]
    ):
        return True
    if not (
        _is_sentence_char(normalized_previous[-1]) and _is_sentence_char(normalized_current[0])
    ):
        return False
    if len(normalized_previous) <= 2:
        return False
    return True


def _looks_like_article_structure_line(text: str) -> bool:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return False
    return bool(
        ARTICLE_PREFIX_RE.match(normalized)
        or TOP_LEVEL_ENUMERATED_RE.match(normalized)
        or INLINE_LIST_MARKER_RE.match(normalized)
    )


def _looks_like_intended_structural_split(previous: str, current: str) -> bool:
    normalized_previous = _heading_fragment_candidate(previous)
    normalized_current = _normalize_body_fragment(current)
    if not normalized_previous or not normalized_current:
        return False
    if len(normalized_current) < 8:
        return False
    if not _is_short_heading_fragment(normalized_previous) and not _is_semantic_heading_fragment(
        normalized_previous
    ):
        return False
    if not _looks_like_semantic_short_heading_fragment(normalized_previous):
        return False
    if normalized_current.startswith(normalized_previous):
        trailing = normalized_current[len(normalized_previous) :].lstrip()
        if trailing and _looks_like_title_like_heading_remainder(trailing):
            return True
    return any(
        normalized_current.startswith(starter)
        for starter in BODY_SENTENCE_STARTERS + SHORT_HEADING_BODY_STARTERS
    )


def _heading_fragment_candidate(text: str) -> str:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return ""
    article_match = ARTICLE_PREFIX_RE.match(normalized)
    if article_match is not None:
        return article_match.group("rest").strip()
    list_match = INLINE_LIST_MARKER_RE.match(normalized)
    if list_match is not None:
        return list_match.group("body").strip()
    return normalized


def _looks_like_heading_note_boundary(previous: str, current: str) -> bool:
    normalized_previous = _normalize_body_fragment(previous)
    normalized_current = _normalize_body_fragment(current)
    if not normalized_previous or not normalized_current:
        return False
    if not normalized_current.startswith(NOTE_LINE_PREFIXES):
        return False
    return _normalize_heading_tail_ocr_error(
        normalized_previous
    ) is not None or is_title_like_heading(normalized_previous)


def _looks_like_citation_continuation(previous: str, current: str) -> bool:
    normalized_previous = _normalize_body_fragment(previous)
    normalized_current = _normalize_body_fragment(current)
    if not normalized_previous or not normalized_current:
        return False
    current_head = normalized_current[0]
    if current_head in CITATION_CONTINUATION_START_CHARS and _has_unclosed_citation_context(
        normalized_previous
    ):
        return True
    return normalized_previous.endswith(("民大校发", "民大学发", "民大党发", "中发", "教高")) and (
        current_head in CITATION_CONTINUATION_START_CHARS or current_head.isdigit()
    )


def _has_unclosed_citation_context(text: str) -> bool:
    pairs = (
        ("(", ")"),
        ("（", "）"),
        ("《", "》"),
        ("[", "]"),
        ("〔", "〕"),
        ("“", "”"),
        ("‘", "’"),
    )
    return any(text.count(left) > text.count(right) for left, right in pairs)


def _looks_like_structural_line(text: str) -> bool:
    normalized = _normalize_body_fragment(text)
    return bool(normalized and STRUCTURAL_LINE_RE.match(normalized))


def _looks_like_front_matter_line(text: str) -> bool:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return False
    return bool(DATE_LINE_RE.match(normalized) or POLICY_DOC_NO_RE.match(normalized))


def _looks_like_formula_line(text: str) -> bool:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return False
    if "\\sum" in normalized or "$" in normalized:
        return True
    if "=" not in normalized:
        return False
    operator_count = sum(
        normalized.count(marker) for marker in ("=", "×", "÷", "/", "+", "-", "<", ">")
    )
    if operator_count >= 2:
        return True
    return False


def _is_sentence_char(value: str) -> bool:
    return (
        value.isalnum()
        or ("\u4e00" <= value <= "\u9fff")
        or value in {"%", ")", "）", "》", "”", "’", "]", "〕"}
    )


def _normalize_structural_body_glue(text: str) -> str:
    normalized = " ".join(_normalize_body_fragment(text).split()).strip()
    if not normalized:
        return ""
    normalized_heading_tail = _normalize_heading_tail_ocr_error(normalized)
    if normalized_heading_tail is not None:
        return normalized_heading_tail
    list_match = INLINE_LIST_MARKER_RE.match(normalized)
    if list_match is None:
        return normalized
    body = list_match.group("body").strip()
    split_body = _split_short_heading_from_body(body)
    if split_body is None:
        return normalized
    return f"{list_match.group('label').strip()} {split_body[0]}\n{split_body[1]}"


def _split_short_heading_from_body(body: str) -> tuple[str, str] | None:
    normalized = _normalize_body_fragment(body)
    if not normalized or "\n" in normalized:
        return None
    repeated_heading = _split_repeated_short_heading_from_body(normalized)
    if repeated_heading is not None:
        return repeated_heading
    for starter in SHORT_HEADING_BODY_STARTERS:
        marker_index = normalized.find(starter)
        if marker_index <= 0:
            continue
        heading = normalized[:marker_index].strip()
        remainder = normalized[marker_index:].strip()
        if len(remainder) < 8:
            continue
        if not _is_short_heading_fragment(heading):
            continue
        if not _looks_like_semantic_short_heading_fragment(heading):
            continue
        overlap = _find_boundary_overlap(heading, remainder)
        if overlap:
            remainder = remainder[len(overlap) :].lstrip()
        return heading, remainder
    return None


def _split_repeated_short_heading_from_body(body: str) -> tuple[str, str] | None:
    normalized = _normalize_body_fragment(body)
    if not normalized or "\n" in normalized:
        return None
    max_heading_length = min(len(normalized) // 2, 12)
    for heading_length in range(3, max_heading_length + 1):
        heading = normalized[:heading_length].strip()
        if not _is_short_heading_fragment(heading) and not _is_semantic_heading_fragment(heading):
            continue
        if not normalized.startswith(f"{heading}{heading}"):
            continue
        remainder = normalized[heading_length:].lstrip()
        trailing = remainder[len(heading) :].lstrip()
        if not trailing or not _looks_like_title_like_heading_remainder(trailing):
            continue
        return heading, trailing
    return None


def _normalize_article_heading_body_glue(text: str) -> str:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return ""
    article_match = ARTICLE_PREFIX_RE.match(normalized)
    if article_match is not None:
        article_label = _normalize_article_label(article_match.group("label"))
        article_rest = " ".join(
            _normalize_body_fragment(article_match.group("rest")).split()
        ).strip()
        split_body = _split_title_like_heading_body(article_rest)
        if split_body is None:
            return normalized
        return f"{article_label} {split_body[0]}\n{split_body[1]}"
    list_match = INLINE_LIST_MARKER_RE.match(normalized)
    if list_match is not None:
        list_label = list_match.group("label").strip()
        list_rest = " ".join(_normalize_body_fragment(list_match.group("body")).split()).strip()
        split_body = _split_extended_inline_list_heading_body(list_rest)
        if split_body is None:
            return normalized
        return f"{list_label} {split_body[0]}\n{split_body[1]}"
    split_body = _split_title_like_heading_body(normalized)
    if split_body is None:
        return normalized
    return f"{split_body[0]}\n{split_body[1]}"


def _split_glued_structural_heading(text: str) -> tuple[str, str] | None:
    normalized = normalize_handbook_body_text(text)
    match = INLINE_ENUMERATED_LABEL_RE.match(normalized)
    if match is None:
        return None
    split_body = _split_title_like_heading_body(match.group("body").strip())
    if split_body is None:
        return None
    heading = f"{match.group('label').strip()}、{split_body[0]}"
    remainder = split_body[1].strip()
    if not heading or not remainder:
        return None
    return heading, remainder


def _split_title_like_heading_body(text: str) -> tuple[str, str] | None:
    normalized = _normalize_body_fragment(text)
    if not normalized or "\n" in normalized:
        return None
    repeated_heading = _split_repeated_short_heading_from_body(normalized)
    if repeated_heading is not None:
        return repeated_heading
    semantic_heading = _split_semantic_heading_from_body(normalized)
    if semantic_heading is not None:
        return semantic_heading
    plain_heading = _split_plain_heading_from_body(normalized)
    if plain_heading is not None:
        return plain_heading
    marker_re = re.compile(
        r"(?P<marker>(?:[0-9]+[.、]|[（(][一二三四五六七八九十百千万〇零两0-9]+[)）]))"
    )
    for match in marker_re.finditer(normalized):
        heading = normalized[: match.start("marker")].strip()
        remainder = normalized[match.start("marker") :].lstrip()
        if not heading or not remainder:
            continue
        if not _is_short_heading_fragment(heading) and not _is_semantic_heading_fragment(heading):
            continue
        return heading, remainder
    max_heading_length = min(len(normalized) - 1, 24)
    for split_index in range(2, max_heading_length + 1):
        heading = normalized[:split_index].strip()
        remainder = normalized[split_index:].lstrip()
        if not heading or not remainder:
            continue
        if not _is_short_heading_fragment(heading) and not _is_semantic_heading_fragment(heading):
            continue
        overlap = _shared_cjk_prefix(heading, remainder)
        if len(overlap) < max(2, len(heading) // 2):
            continue
        remainder_after_overlap = remainder[len(overlap) :].lstrip()
        if not _looks_like_title_like_heading_overlap_remainder(remainder_after_overlap):
            continue
        return heading, remainder
    return None


def _split_plain_heading_from_body(text: str) -> tuple[str, str] | None:
    normalized = _normalize_body_fragment(text)
    if not normalized or "\n" in normalized:
        return None
    for starter in BODY_SENTENCE_STARTERS:
        marker_index = normalized.find(starter)
        if marker_index <= 0:
            continue
        heading = normalized[:marker_index].strip()
        remainder = normalized[marker_index:].strip()
        if len(remainder) < 8:
            continue
        if len(heading) < 4 and heading not in SHORT_HEADING_WHITELIST:
            continue
        if not _is_short_heading_fragment(heading) and not _is_semantic_heading_fragment(heading):
            continue
        if not _looks_like_semantic_short_heading_fragment(heading):
            continue
        overlap = _find_boundary_overlap(heading, remainder)
        if overlap:
            remainder = remainder[len(overlap) :].lstrip()
        return heading, remainder
    return None


def _split_semantic_heading_from_body(text: str) -> tuple[str, str] | None:
    normalized = _normalize_body_fragment(text)
    if not normalized or "\n" in normalized:
        return None
    if _looks_like_navigation_section_heading_candidate(normalized):
        return None
    max_heading_length = min(len(normalized) - 1, 24)
    for split_index in range(3, max_heading_length + 1):
        heading = normalized[:split_index].strip()
        remainder = normalized[split_index:].lstrip()
        if not heading or not remainder:
            continue
        if not _is_semantic_heading_fragment(heading):
            continue
        if _looks_like_title_like_heading_remainder(remainder):
            return heading, remainder
        overlap = _shared_cjk_prefix(heading, remainder)
        if len(overlap) < max(4, min(8, len(heading) // 2)):
            continue
        remainder_after_overlap = remainder[len(overlap) :].lstrip()
        if _looks_like_title_like_heading_overlap_remainder(remainder_after_overlap):
            return heading, remainder
    return None


def _split_extended_inline_list_heading_body(text: str) -> tuple[str, str] | None:
    normalized = _normalize_body_fragment(text)
    if not normalized or "\n" in normalized:
        return None
    repeated_heading = _split_repeated_short_heading_from_body(normalized)
    if repeated_heading is not None:
        return repeated_heading
    semantic_heading = _split_semantic_heading_from_body(normalized)
    if semantic_heading is None:
        return None
    heading, remainder = semantic_heading
    if len(heading) >= 5:
        return heading, remainder
    if len(_shared_cjk_prefix(heading, remainder)) >= 4:
        return heading, remainder
    return None


def _looks_like_navigation_section_heading_candidate(text: str) -> bool:
    normalized = _normalize_body_fragment(text)
    if not normalized or LEAF_SECTION_PUNCTUATION_RE.search(normalized):
        return False
    inline_list_match = INLINE_LIST_MARKER_RE.match(normalized)
    body = inline_list_match.group("body").strip() if inline_list_match else normalized
    if not body:
        return False
    return any(body.endswith(keyword) for keyword in NAVIGATION_SECTION_KEYWORDS)


def _looks_like_title_like_heading_remainder(text: str) -> bool:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return False
    if INLINE_LIST_MARKER_RE.match(normalized):
        return True
    if len(normalized) < 4:
        return False
    return any(normalized.startswith(starter) for starter in BODY_SENTENCE_STARTERS)


def _looks_like_title_like_heading_overlap_remainder(text: str) -> bool:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return False
    if _looks_like_title_like_heading_remainder(normalized):
        return True
    return normalized.startswith("的") and len(normalized) >= 4


def _shared_cjk_prefix(left: str, right: str) -> str:
    shared_chars: list[str] = []
    for left_char, right_char in zip(left, right):
        if left_char != right_char:
            break
        if not re.fullmatch(r"[\u4e00-\u9fff]", left_char):
            break
        shared_chars.append(left_char)
    return "".join(shared_chars)


def _is_short_heading_fragment(text: str) -> bool:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return False
    if normalized in SHORT_HEADING_WHITELIST:
        return True
    if len(normalized) < 3:
        return False
    if any(fragment in normalized for fragment in SHORT_HEADING_FORBIDDEN_FRAGMENTS):
        return False
    if normalized.endswith(("的", "地", "得", "了", "时", "后", "前", "和", "及")):
        return False
    return bool(SHORT_HEADING_PREFIX_RE.fullmatch(normalized))


def _is_semantic_heading_fragment(text: str) -> bool:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return False
    if normalized in SHORT_HEADING_WHITELIST:
        return True
    if len(normalized) < 3 or len(normalized) > 24:
        return False
    if normalized.endswith(("的", "地", "得", "了", "时", "后", "前", "和", "及")):
        return False
    if not re.fullmatch(r"[\u4e00-\u9fff、与及和\-]{3,24}", normalized):
        return False
    if any(fragment in normalized for fragment in SHORT_HEADING_FORBIDDEN_FRAGMENTS):
        return _looks_like_semantic_short_heading_fragment(normalized)
    return _looks_like_semantic_short_heading_fragment(normalized)


def _looks_like_semantic_short_heading_fragment(text: str) -> bool:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return False
    if normalized in SHORT_HEADING_WHITELIST:
        return True
    return any(normalized.endswith(suffix) for suffix in SHORT_HEADING_SEMANTIC_SUFFIXES)


def _deduplicate_boundary_overlap_lines(lines: list[str]) -> list[str]:
    deduplicated: list[str] = []
    for line in lines:
        if not deduplicated:
            deduplicated.append(line)
            continue
        previous = deduplicated[-1]
        deduplicated[-1] = _deduplicate_adjacent_overlap(previous, line)
    return deduplicated


def _deduplicate_adjacent_overlap(previous: str, current: str) -> str:
    if not previous or not current:
        return previous + ("\n" + current if current else "")
    previous_line = previous.rsplit("\n", 1)[-1].strip()
    current_line = current.split("\n", 1)[0].strip()
    if previous_line and current_line:
        overlap = _find_boundary_overlap(previous_line, current_line)
        if overlap:
            current = current[len(overlap) :].lstrip()
    return f"{previous}\n{current}" if current else previous


def _find_boundary_overlap(previous: str, current: str) -> str:
    max_overlap = min(len(previous), len(current), 8)
    for overlap_length in range(max_overlap, 1, -1):
        suffix = previous[-overlap_length:]
        prefix = current[:overlap_length]
        if suffix != prefix:
            continue
        if not re.fullmatch(r"[\u4e00-\u9fff]{2,8}", suffix):
            continue
        if (
            len(previous) == overlap_length
            and len(current) > overlap_length
            and current[overlap_length : overlap_length + 1] in {"申", "需"}
        ):
            continue
        return suffix
    return ""


def _normalize_heading_tail_ocr_error(text: str) -> str | None:
    normalized = " ".join(_normalize_body_fragment(text).split()).strip()
    for prefix in NOTE_LINE_PREFIXES:
        marker = f"准{prefix}"
        marker_index = normalized.find(marker)
        if marker_index <= 0:
            continue
        heading = normalized[: marker_index + 1].strip()
        remainder = normalized[marker_index + 1 :].strip()
        repaired_heading = _strip_repeated_heading_tail_char(heading)
        if repaired_heading == heading or not is_title_like_heading(repaired_heading):
            continue
        return f"{repaired_heading}\n{remainder}"
    return None


def _repair_missing_parenthetical_doc_no_closure(text: str) -> str:
    repaired_lines: list[str] = []
    for raw_line in _normalize_body_fragment(text).splitlines():
        normalized = " ".join(raw_line.split()).strip()
        if not normalized or not _has_unclosed_citation_context(normalized):
            repaired_lines.append(normalized)
            continue
        repaired = normalized
        while True:
            match = DOC_NO_PARENTHESES_REPAIR_RE.search(repaired)
            if match is None:
                break
            closing = ")" if match.group("open") == "(" else "）"
            repaired = (
                f"{repaired[: match.start('suffix')]}{closing}{repaired[match.start('suffix') :]}"
            )
            if not _has_unclosed_citation_context(repaired):
                break
        repaired_lines.append(repaired)
    return "\n".join(line for line in repaired_lines if line)


def _repair_known_ocr_phrase_errors(text: str) -> str:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return ""
    normalized = _strip_inline_ocr_reference_markers(normalized)
    normalized = normalized.replace("允许使用永恒的所有电器", "允许使用的所有电器")
    normalized = normalized.replace("私自将违规电器带入室内着", "私自将违规电器带入室内者")
    normalized = normalized.replace("一法追究法律责任", "依法追究法律责任")
    normalized = normalized.replace("志愿志愿服务", "志愿服务")
    normalized = normalized.replace("助学服务中心中心", "助学服务中心")
    return normalized


def _strip_inline_ocr_reference_markers(text: str) -> str:
    normalized = _normalize_body_fragment(text)
    if not normalized:
        return ""
    return INLINE_OCR_REFERENCE_MARKER_RE.sub("", normalized)


def _strip_repeated_heading_tail_char(text: str) -> str:
    normalized = _normalize_body_fragment(text)
    if len(normalized) < 2:
        return normalized
    if normalized[-1] != normalized[-2]:
        return normalized
    return normalized[:-1].strip()


def _normalize_article_label(value: str) -> str:
    normalized = normalize_handbook_body_text(value)
    return re.sub(r"\s+", "", normalized)


__all__ = [
    "ARTICLE_PREFIX_RE",
    "SHORT_HEADING_BODY_STARTERS",
    "SHORT_HEADING_WHITELIST",
    "_find_boundary_overlap",
    "_has_unclosed_citation_context",
    "_looks_like_title_like_heading_remainder",
    "_normalize_article_label",
    "_split_glued_structural_heading",
    "_split_short_heading_from_body",
    "_split_title_like_heading_body",
    "build_handbook_doc_id",
    "build_handbook_version_id",
    "normalize_handbook_article_body_text",
    "normalize_handbook_body_text",
    "normalize_handbook_title",
]
