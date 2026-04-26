from __future__ import annotations

import re
import unicodedata

from campus_ingestion_core.handbook_article_structure import (
    is_title_like_heading,
    normalize_article_body_structure,
)
from campus_ingestion_core.handbook_cleanup_article_boundaries import (
    _split_inline_article_boundaries,
)
from campus_ingestion_core.handbook_cleanup_normalize_overlap import (
    _deduplicate_boundary_overlap_lines,
    _find_boundary_overlap,
)
from campus_ingestion_core.handbook_cleanup_ocr_repairs import (
    _repair_known_ocr_phrase_errors,
    _repair_missing_parenthetical_doc_no_closure,
)
from campus_ingestion_core.handbook_cleanup_shared import (
    ARTICLE_PREFIX_RE,
    BODY_SENTENCE_STARTERS,
    CITATION_CONTINUATION_START_CHARS,
    DATE_LINE_RE,
    INLINE_ENUMERATED_LABEL_RE,
    INLINE_LIST_MARKER_RE,
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
    lines: list[str] = []
    for line in normalized.splitlines():
        stripped = line.strip()
        if (
            not stripped
            or _is_running_header_line(stripped)
            or _looks_like_handbook_page_marker(stripped)
        ):
            continue
        lines.extend(_split_inline_article_boundaries(stripped))
    merged_lines = _merge_article_soft_wrapped_lines(lines)
    normalized_article_lines = [_normalize_article_heading_body_glue(line) for line in merged_lines]
    return normalize_article_body_structure("\n".join(normalized_article_lines))


def _normalize_body_fragment(value: str) -> str:
    return unicodedata.normalize("NFKC", value.replace("\r\n", "\n").replace("\r", "\n")).strip()


def _is_running_header_line(text: str) -> bool:
    normalized = " ".join(_normalize_body_fragment(text).split()).strip()
    return normalized in RUNNING_HEADER_LINES


def _looks_like_handbook_page_marker(text: str) -> bool:
    normalized = _normalize_body_fragment(text).lstrip("#").strip()
    return bool(re.fullmatch(r"/\d{1,4}", normalized))


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
    if _looks_like_confirmed_handbook_soft_wrap_continuation(previous, current):
        return True
    if _looks_like_formula_line(previous) or _looks_like_formula_line(current):
        return False
    if _looks_like_fragmented_policy_subject_continuation(previous, current):
        return True
    if _looks_like_fragmented_applicant_subject_continuation(previous, current):
        return True
    if _looks_like_structural_line(current):
        return False
    if _looks_like_citation_continuation(previous, current):
        return True
    if _looks_like_enumerated_clause_continuation(previous, current):
        return True
    if _looks_like_intended_structural_split(previous, current):
        return False
    if _looks_like_heading_note_boundary(previous, current):
        return False
    previous_tail = previous[-1]
    current_head = current[0]
    if previous_tail in SOFT_WRAP_CONTINUATION_CHARS and _is_sentence_char(current_head):
        return True
    return _is_sentence_char(previous_tail) and _is_sentence_char(current_head)


def _should_merge_article_soft_wrap(previous: str, current: str) -> bool:
    normalized_previous = _normalize_body_fragment(previous)
    normalized_current = _normalize_body_fragment(current)
    if not normalized_previous or not normalized_current:
        return False
    if _looks_like_front_matter_line(normalized_previous) or _looks_like_front_matter_line(
        normalized_current
    ):
        return False
    if _looks_like_confirmed_handbook_soft_wrap_continuation(
        normalized_previous, normalized_current
    ):
        return True
    if _looks_like_formula_line(normalized_previous) or _looks_like_formula_line(
        normalized_current
    ):
        return False
    if _looks_like_citation_continuation(normalized_previous, normalized_current):
        return True
    if _looks_like_enumerated_clause_continuation(normalized_previous, normalized_current):
        return True
    if _looks_like_fragmented_policy_subject_continuation(normalized_previous, normalized_current):
        return True
    if _looks_like_fragmented_applicant_subject_continuation(
        normalized_previous, normalized_current
    ):
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
    return len(normalized_previous) > 2


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
    if _looks_like_confirmed_handbook_inline_heading_split(normalized_previous, normalized_current):
        return True
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


def _looks_like_enumerated_clause_continuation(previous: str, current: str) -> bool:
    normalized_previous = _normalize_body_fragment(previous)
    normalized_current = _normalize_body_fragment(current)
    if not normalized_previous or not normalized_current:
        return False
    match = re.match(
        r"^[一二三四五六七八九十百千万〇零两]+、(?P<body>.+)$",
        normalized_previous,
    )
    if match is None:
        return False
    body = match.group("body").strip()
    if body.endswith("选拔") and normalized_current.startswith("确定的工作制度"):
        return True
    return body.endswith("学生名单") and normalized_current.startswith("进行审核汇总")


def _looks_like_fragmented_policy_subject_continuation(previous: str, current: str) -> bool:
    normalized_previous = _normalize_body_fragment(previous)
    normalized_current = _normalize_body_fragment(current)
    return normalized_previous.endswith("拟被处分或者处理") and normalized_current.startswith(
        "学生"
    )


def _looks_like_fragmented_applicant_subject_continuation(previous: str, current: str) -> bool:
    normalized_previous = _normalize_body_fragment(previous)
    normalized_current = _normalize_body_fragment(current)
    return (
        (normalized_previous.endswith("对申请") and normalized_current.startswith("学生进行审核"))
        or (normalized_previous.endswith("的申请") and normalized_current.startswith("学生材料"))
        or (normalized_previous.endswith("申请") and normalized_current.startswith("学生材料"))
    )


def _looks_like_confirmed_handbook_soft_wrap_continuation(previous: str, current: str) -> bool:
    normalized_previous = _normalize_body_fragment(previous)
    normalized_current = _normalize_body_fragment(current)
    confirmed_pairs = (
        ("有要求", "学生申诉处理委员会"),
        ("毕业生从", "校级优秀本科毕业生中"),
        ("本科学生专项奖学金按以下程序", "进行评选:"),
        ("按以下程序", "进行评选:"),
        ("参加勤工助学的工作时间", "原则上每周"),
        ("做好对参加勤工助学", "学生的考勤管理"),
    )
    return any(
        normalized_previous.endswith(previous_tail) and normalized_current.startswith(current_head)
        for previous_tail, current_head in confirmed_pairs
    )


def _looks_like_confirmed_handbook_inline_heading_split(previous: str, current: str) -> bool:
    normalized_previous = _normalize_body_fragment(previous)
    normalized_current = _normalize_body_fragment(current)
    confirmed_pairs = (
        ("临时困难补助", "学生在校学习期间"),
        ("绿色通道", "学校在每学年新生入学时"),
        ("申请受理", "申请国家助学贷款学生需"),
        ("申请审查", "国家助学贷款由"),
    )
    return any(
        normalized_previous.endswith(previous_tail) and normalized_current.startswith(current_head)
        for previous_tail, current_head in confirmed_pairs
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
    return operator_count >= 2


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
        if _looks_like_enumerated_clause_false_heading_split(*semantic_heading):
            return None
        return semantic_heading
    plain_heading = _split_plain_heading_from_body(normalized)
    if plain_heading is not None:
        if _looks_like_enumerated_clause_false_heading_split(*plain_heading):
            return None
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
    if normalized.startswith("分级审定拟定名单"):
        return "分级审定", normalized.removeprefix("分级审定").lstrip()
    repeated_heading = _split_repeated_short_heading_from_body(normalized)
    if repeated_heading is not None:
        return repeated_heading
    semantic_heading = _split_semantic_heading_from_body(normalized)
    if semantic_heading is None:
        return None
    heading, remainder = semantic_heading
    if _looks_like_enumerated_clause_false_heading_split(heading, remainder):
        return None
    if len(heading) >= 5:
        return heading, remainder
    if len(_shared_cjk_prefix(heading, remainder)) >= 4:
        return heading, remainder
    return None


def _looks_like_enumerated_clause_false_heading_split(heading: str, remainder: str) -> bool:
    normalized_heading = _normalize_body_fragment(heading)
    normalized_remainder = _normalize_body_fragment(remainder)
    normalized_heading = re.sub(
        r"^[一二三四五六七八九十百千万〇零两]+、",
        "",
        normalized_heading,
    )
    if normalized_heading.endswith("拟被处分或者处理") and normalized_remainder.startswith("学生"):
        return True
    if normalized_heading.endswith("对申请") and normalized_remainder.startswith("学生进行审核"):
        return True
    if normalized_heading.endswith("的申请") and normalized_remainder.startswith("学生材料"):
        return True
    if normalized_heading.endswith("申请") and normalized_remainder.startswith("学生材料"):
        return True
    if normalized_heading.endswith("主要考核") and normalized_remainder.startswith("申请者"):
        return True
    if normalized_heading.endswith("有要求") and normalized_remainder.startswith(
        "学生申诉处理委员会"
    ):
        return True
    if normalized_heading.endswith(
        "本科学生专项奖学金按以下程序"
    ) and normalized_remainder.startswith("进行评选"):
        return True
    if normalized_heading.endswith("按以下程序") and normalized_remainder.startswith("进行评选"):
        return True
    if normalized_heading.endswith(
        "学生参加勤工助学的工作时间"
    ) and normalized_remainder.startswith("原则上每周"):
        return True
    if normalized_heading.endswith("做好对参加勤工助学") and normalized_remainder.startswith(
        "学生的考勤管理"
    ):
        return True
    if normalized_heading.endswith("毕业生从") and normalized_remainder.startswith(
        "校级优秀本科毕业生中"
    ):
        return True
    if normalized_heading == "实行个人申请、选拔" and normalized_remainder.startswith(
        "确定的工作制度"
    ):
        return True
    return normalized_heading.endswith("学生名单") and normalized_remainder.startswith(
        "进行审核汇总"
    )


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
    for left_char, right_char in zip(left, right, strict=False):
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
    "_has_unclosed_citation_context",
    "_looks_like_handbook_page_marker",
    "_looks_like_title_like_heading_remainder",
    "_normalize_article_label",
    "_normalize_body_fragment",
    "_split_glued_structural_heading",
    "_split_short_heading_from_body",
    "_split_title_like_heading_body",
    "normalize_handbook_article_body_text",
    "normalize_handbook_body_text",
]
