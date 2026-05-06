from __future__ import annotations

import html
import re
from dataclasses import dataclass
from typing import Any

from campus_ingestion_core.readable_text_normalization import normalize_readable_text

REGULATION_CANONICAL_NORMALIZER_VERSION = "collected_notice_regulation_canonical_cleaning_v9"

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
_PAGE_ARTIFACT_LINE_RE = re.compile(
    r"^\s*(?:[-—－]\s*\d+\s*(?:[-—－]|[·•])?|\d+)\s*$"
)
_CHAPTER_SPACING_RE = re.compile(rf"(第[{_CHINESE_NUMBER}]+章)(?=\S)")
_ARTICLE_SPACING_RE = re.compile(rf"(第[{_CHINESE_NUMBER}]+条)(?=\S)")
_STRUCTURE_HEADING_LINE_RE = re.compile(
    rf"^(?:第[{_CHINESE_NUMBER}]+[章节条]|[{_CHINESE_NUMBER}]+、|[（(][{_CHINESE_NUMBER}]+[）)])"
)
_IMPRINT_DATE_LINE_RE = re.compile(r"^\d{4}年\d{1,2}月\d{1,2}日(?:印发|发布|公布|施行)?$")
_PUBLICATION_SIGNATURE_SUFFIX_RE = re.compile(
    r"(?:中央民族大学)?[\u3400-\u9fff][^，。；：:\n]{0,29}"
    r"(?:学院|医院|中心|办公室|委员会|工作处|研究生院|教务处)$"
)
_PUBLICATION_IMPRINT_INLINE_RE = re.compile(
    r"(?:附件\s*)?中央民族大学[^。\n]{0,40}办公室\s*\d{4}年\d{1,2}月\d{1,2}日印发$"
)
_HTML_TAG_RE = re.compile(r"<\s*/?\s*[A-Za-z][^>]*>")
_EMAIL_RE = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b")
_DOMAIN_RE = re.compile(r"\b[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+\b")
_UNIT_QUANTITY_RE = re.compile(
    r"(?<![A-Za-z0-9])\d+(?:\.\d+)?(?:G|GB|MB|KB|TB|%)"
    r"(?![A-Za-z])",
    re.IGNORECASE,
)
_ATTACHMENT_HEADING_RE = re.compile(r"^(?:附件|附表)\s*[：:：]?\s*\d*")
_BARE_ATTACHMENT_MARKER_RE = re.compile(r"^(?:附件|附表)\s*[：:：]?\s*(?:[一二三四五六七八九十百千万]|\d+)?[.．、]?$")
_SUPPLEMENTARY_ATTACHMENT_LINE_RE = re.compile(
    r"^(?:附件|附表)\s*[：:：]?\s*(?:[一二三四五六七八九十百千万]|\d+)?(?:[.．、]\s*)?.*$"
)
_REFERENCE_ITEM_RE = re.compile(r"^(?:\[\d+\]|\d+[.、])")
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
_LAYOUT_ARTIFACT_LITERAL_LINES = frozenset(
    {
        "MINZU UNIVERSITY OF CHINA",
        "本科毕业论文（设计）",
    }
)
_LAYOUT_ARTIFACT_FORM_FIELD_RE = re.compile(
    r"^(?:"
    r"姓名|学号|年级|专业|指导教师|指导老师签名|承诺人签名|本人签名|日期|"
    r"签字日期|学\s*院|学院|职称|题目"
    r")[：:]?(?:日期[：:]?)?$"
)
_LAYOUT_ARTIFACT_SUBTITLE_RE = re.compile(r"^[—－-]{1,3}\[[^\]]+\]$")
_LAYOUT_ARTIFACT_DATE_PLACEHOLDER_RE = re.compile(r"^年\s*月\s*日(?:附件\s*\d+)?$")
_FORM_ATTACHMENT_START_RE = re.compile(
    r"^(?:附件\s*[：:]?\s*)?[^。\n]{0,80}(?:申请表|审批表|登记表|汇总表|信息表)\s*$"
)
_FORM_ATTACHMENT_MARKERS = (
    "申请人基本信息",
    "申请人承诺",
    "学院意见",
    "审批意见",
    "姓名 |",
    "身份证号",
    "申请人签字",
    "制表",
)
_SUPPLEMENTARY_ATTACHMENT_TAIL_MARKERS = (
    "一级指标",
    "二级指标",
    "评价指标",
    "评价内容",
    "考评类别",
    "计分事项",
    "查阅材料",
    "参考指标",
    "分数",
    "备注",
    "学院 |",
    "专业 |",
    "年级 |",
    "学号 |",
    "姓名 |",
    "指导教师",
    "本人签名",
    "评阅意见",
    "答辩小组",
    "开题答辩",
    "使用授权书",
    "任务书",
    "封面",
    "诚信承诺书",
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
    layout_artifact_count: int
    html_tag_removed_count: int
    publication_imprint_removed_count: int
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
    layout_artifact_count = _count_layout_artifacts(title=title, text=body)
    body = _remove_layout_artifact_lines(title=title, text=body)
    body, form_attachment_tail_removed_count = _remove_form_attachment_tail(body)
    layout_artifact_count += form_attachment_tail_removed_count
    body, supplementary_attachment_tail_removed_count = _remove_supplementary_attachment_tail(body)
    layout_artifact_count += supplementary_attachment_tail_removed_count
    body, html_tag_removed_count = _flatten_html_markup(body)
    body, flattened_form_tail_removed_count = _remove_form_attachment_tail(body)
    layout_artifact_count += flattened_form_tail_removed_count
    body, flattened_supplementary_attachment_tail_removed_count = _remove_supplementary_attachment_tail(body)
    layout_artifact_count += flattened_supplementary_attachment_tail_removed_count
    body, trailing_bare_attachment_marker_removed_count = _remove_trailing_bare_attachment_marker(
        body
    )
    layout_artifact_count += trailing_bare_attachment_marker_removed_count
    body = _normalize_heading_spacing(body)
    body = _remove_leading_title(title=title, text=body)
    body, soft_wrap_repair_count = _repair_soft_wraps(body)
    before_readability = body
    body = _normalize_readability_by_line(body)
    readability_normalization_count = int(body != before_readability)
    body, publication_imprint_removed_count = _remove_publication_imprint_tail(body)
    body, terminal_office_tail_removed_count = _remove_terminal_office_tail(body)
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
    if layout_artifact_count:
        reason_codes.append("layout_artifacts_removed")
    if html_tag_removed_count:
        reason_codes.append("html_markup_flattened")
    if publication_imprint_removed_count:
        reason_codes.append("publication_imprint_removed")
    if terminal_office_tail_removed_count:
        reason_codes.append("terminal_office_tail_removed")
    if soft_wrap_repair_count:
        reason_codes.append("soft_wrap_repaired")
    if readability_normalization_count:
        reason_codes.append("readable_text_normalized")
    if mixed_ascii_cjk_artifact_count:
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
        layout_artifact_count=layout_artifact_count,
        html_tag_removed_count=html_tag_removed_count,
        publication_imprint_removed_count=publication_imprint_removed_count,
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


def _count_layout_artifacts(*, title: str, text: str) -> int:
    return sum(1 for line in text.splitlines() if _is_layout_artifact_line(title=title, line=line))


def _remove_layout_artifact_lines(*, title: str, text: str) -> str:
    return "\n".join(
        line for line in text.splitlines() if not _is_layout_artifact_line(title=title, line=line)
    ).strip()


def _remove_form_attachment_tail(text: str) -> tuple[str, int]:
    lines = text.splitlines()
    start_index = _find_form_attachment_tail_start(lines)
    if start_index is None:
        return text, 0
    removed_count = len(lines) - start_index
    return "\n".join(lines[:start_index]).strip(), removed_count


def _find_form_attachment_tail_start(lines: list[str]) -> int | None:
    for index, line in enumerate(lines):
        normalized = line.strip()
        if not normalized or _FORM_ATTACHMENT_START_RE.match(normalized) is None:
            continue
        tail_preview = "\n".join(item.strip() for item in lines[index : index + 24])
        marker_count = sum(1 for marker in _FORM_ATTACHMENT_MARKERS if marker in tail_preview)
        if marker_count >= 2:
            return _include_leading_bare_attachment_marker(lines=lines, start_index=index)
    return None


def _include_leading_bare_attachment_marker(*, lines: list[str], start_index: int) -> int:
    previous_index = start_index - 1
    while previous_index >= 0 and not lines[previous_index].strip():
        previous_index -= 1
    if previous_index < 0:
        return start_index
    previous = lines[previous_index].strip()
    if _BARE_ATTACHMENT_MARKER_RE.match(previous) is not None:
        return previous_index
    return start_index


def _remove_supplementary_attachment_tail(text: str) -> tuple[str, int]:
    lines = text.splitlines()
    start_index = _find_supplementary_attachment_tail_start(lines)
    if start_index is None:
        return text, 0
    removed_count = len(lines) - start_index
    return "\n".join(lines[:start_index]).strip(), removed_count


def _remove_trailing_bare_attachment_marker(text: str) -> tuple[str, int]:
    lines = text.splitlines()
    while lines and not lines[-1].strip():
        lines.pop()
    if not lines:
        return text, 0
    if _BARE_ATTACHMENT_MARKER_RE.match(lines[-1].strip()) is None:
        return text, 0
    return "\n".join(lines[:-1]).strip(), 1


def _find_supplementary_attachment_tail_start(lines: list[str]) -> int | None:
    for index, line in enumerate(lines):
        normalized = line.strip()
        if not normalized or _SUPPLEMENTARY_ATTACHMENT_LINE_RE.match(normalized) is None:
            continue
        if _has_formal_structure_after(lines, start=index + 1):
            continue
        tail_lines = [item.strip() for item in lines[index : index + 80] if item.strip()]
        tail_preview = "\n".join(tail_lines)
        marker_count = sum(
            1 for marker in _SUPPLEMENTARY_ATTACHMENT_TAIL_MARKERS if marker in tail_preview
        )
        table_like_line_count = sum(1 for item in tail_lines if "|" in item)
        if marker_count >= 3 or table_like_line_count >= 2:
            return index
    return None


def _has_formal_structure_after(lines: list[str], *, start: int) -> bool:
    for line in lines[start:]:
        normalized = line.strip()
        if not normalized:
            continue
        if (
            re.match(rf"^第[{_CHINESE_NUMBER}]+[章节条]", normalized)
            and "|" not in normalized
        ):
            return True
    return False


def _is_layout_artifact_line(*, title: str, line: str) -> bool:
    normalized = line.strip()
    if not normalized or normalized == title.strip():
        return False
    if normalized in _LAYOUT_ARTIFACT_LITERAL_LINES:
        return True
    if _LAYOUT_ARTIFACT_FORM_FIELD_RE.match(normalized):
        return True
    if _LAYOUT_ARTIFACT_SUBTITLE_RE.match(normalized):
        return True
    return _LAYOUT_ARTIFACT_DATE_PLACEHOLDER_RE.match(normalized) is not None


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
    if _STRUCTURE_HEADING_LINE_RE.match(following):
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


def _flatten_html_markup(text: str) -> tuple[str, int]:
    tag_count = len(_HTML_TAG_RE.findall(text))
    if tag_count == 0:
        return text, 0
    flattened = html.unescape(text)
    flattened = re.sub(r"<\s*br\s*/?\s*>", "\n", flattened, flags=re.IGNORECASE)
    flattened = re.sub(
        r"</\s*t[dh]\s*>\s*<\s*t[dh][^>]*>",
        " | ",
        flattened,
        flags=re.IGNORECASE,
    )
    flattened = re.sub(r"<\s*t[dh][^>]*>", "", flattened, flags=re.IGNORECASE)
    flattened = re.sub(r"</\s*t[dh]\s*>", "", flattened, flags=re.IGNORECASE)
    flattened = re.sub(r"<\s*tr[^>]*>", "\n", flattened, flags=re.IGNORECASE)
    flattened = re.sub(r"</\s*tr\s*>", "\n", flattened, flags=re.IGNORECASE)
    flattened = re.sub(
        r"</?\s*(?:table|thead|tbody|tfoot)[^>]*>",
        "\n",
        flattened,
        flags=re.IGNORECASE,
    )
    flattened = re.sub(r"</?\s*(?:p|div|span|html|body)[^>]*>", "\n", flattened, flags=re.IGNORECASE)
    flattened = _HTML_TAG_RE.sub(" ", flattened)
    lines = [re.sub(r"[ \t]+", " ", line).strip() for line in flattened.splitlines()]
    return "\n".join(line for line in lines if line).strip(), tag_count


def _remove_publication_imprint_tail(text: str) -> tuple[str, int]:
    lines = text.splitlines()
    removed_count = 0
    while lines and not lines[-1].strip():
        lines.pop()
    if not lines:
        return text, 0
    last = lines[-1].strip()
    if _PUBLICATION_IMPRINT_INLINE_RE.search(last):
        lines.pop()
        removed_count += 1
        return "\n".join(lines).strip(), removed_count
    if len(lines) >= 2:
        previous_index = len(lines) - 2
        while previous_index >= 0 and not lines[previous_index].strip():
            previous_index -= 1
        previous = lines[previous_index].strip() if previous_index >= 0 else ""
        following = lines[-1].strip()
        if _looks_like_imprint_boundary(previous=previous, following=following):
            retained_previous = _remove_embedded_imprint_suffix(previous)
            lines = lines[:previous_index]
            if retained_previous:
                lines.append(retained_previous)
            removed_count += len(text.splitlines()) - len(lines)
    return "\n".join(lines).strip(), removed_count


def _remove_terminal_office_tail(text: str) -> tuple[str, int]:
    lines = text.splitlines()
    while lines and not lines[-1].strip():
        lines.pop()
    if len(lines) < 2:
        return text, 0
    tail = lines[-1].strip()
    previous = lines[-2].strip()
    if not _looks_like_terminal_office_tail(previous=previous, tail=tail):
        return text, 0
    return "\n".join(lines[:-1]).strip(), 1


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
    if _looks_like_structural_boundary(previous=previous, following=following):
        return False
    if _STRUCTURE_HEADING_LINE_RE.match(previous) or _STRUCTURE_HEADING_LINE_RE.match(following):
        return False
    if previous.endswith(tuple(_TERMINAL_PUNCTUATION)):
        return False
    return bool(_CJK_RE.search(previous))


def _looks_like_imprint_boundary(*, previous: str, following: str) -> bool:
    return (
        _PUBLICATION_SIGNATURE_SUFFIX_RE.search(previous) is not None
        and _IMPRINT_DATE_LINE_RE.match(following) is not None
    )


def _remove_embedded_imprint_suffix(line: str) -> str:
    match = _PUBLICATION_SIGNATURE_SUFFIX_RE.search(line.strip())
    if match is None:
        return line.strip()
    prefix = line[: match.start()].rstrip()
    return prefix.rstrip("，,；;：:")


def _looks_like_structural_boundary(*, previous: str, following: str) -> bool:
    return (
        _looks_like_html_table_boundary(previous=previous, following=following)
        or _looks_like_attachment_boundary(previous=previous, following=following)
        or _looks_like_reference_boundary(previous=previous, following=following)
        or _looks_like_parenthesized_abbreviation_boundary(previous=previous, following=following)
        or _looks_like_page_or_logo_boundary(previous=previous, following=following)
    )


def _looks_like_html_table_boundary(*, previous: str, following: str) -> bool:
    return previous.startswith("<table") or following.startswith("<table")


def _looks_like_attachment_boundary(*, previous: str, following: str) -> bool:
    return (
        _ATTACHMENT_HEADING_RE.match(previous) is not None
        or _ATTACHMENT_HEADING_RE.match(following) is not None
        or previous.endswith(("附件", "附件1", "附件2", "附件3", "附件4", "附件5"))
    )


def _looks_like_reference_boundary(*, previous: str, following: str) -> bool:
    if _REFERENCE_ITEM_RE.match(previous) and _REFERENCE_ITEM_RE.match(following):
        return True
    return previous.endswith(("示例：", "示例:")) or "文献类型标志" in following


def _looks_like_parenthesized_abbreviation_boundary(*, previous: str, following: str) -> bool:
    return (
        re.search(r"[A-Z]{2,}$", previous) is not None
        and following.startswith(("（", "("))
        and re.search(r"[A-Za-z]{3,}", following) is not None
    )


def _looks_like_page_or_logo_boundary(*, previous: str, following: str) -> bool:
    if following.startswith(("-", "－")):
        return True
    return following in {"MINZU UNIVERSITY OF CHINA"}


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
    if re.search(r"\b[A-Z]{1,8}/[A-Z]?\d{2,}(?:-\d{2,})?\b", line):
        return False
    if _looks_like_legitimate_mixed_ascii_cjk_line(line):
        return False
    return bool(re.search(r"[A-Za-z]\d|\d[A-Za-z]", line))


def _looks_like_legitimate_mixed_ascii_cjk_line(line: str) -> bool:
    return (
        _EMAIL_RE.search(line) is not None
        or _DOMAIN_RE.search(line) is not None
        or _UNIT_QUANTITY_RE.search(line) is not None
        or _looks_like_score_formula_line(line)
        or _looks_like_room_or_address_line(line)
    )


def _looks_like_terminal_office_tail(*, previous: str, tail: str) -> bool:
    if not previous or not tail:
        return False
    if "负责解释" not in previous:
        return False
    if _PUBLICATION_SIGNATURE_SUFFIX_RE.fullmatch(tail) is None:
        return False
    return previous.endswith((f"由{tail}负责解释。", f"由{tail}负责解释"))


def _looks_like_score_formula_line(line: str) -> bool:
    if not any(marker in line for marker in ("公式", "计算", "成绩", "分值", "得分")):
        return False
    if not re.search(r"[=+\-*/％%]", line):
        return False
    return re.search(r"[A-Za-z]\d|\d[A-Za-z]|[A-Za-z]\s*[=+\-*/]", line) is not None


def _looks_like_room_or_address_line(line: str) -> bool:
    if not any(marker in line for marker in ("地址", "地点", "办公", "办公室", "楼", "室")):
        return False
    return re.search(r"\d+(?:层|楼|号)?\d*[A-Za-z]?(?:室|房间)", line) is not None


def _remove_leading_title(*, title: str, text: str) -> str:
    stripped = text.strip()
    if stripped.startswith(title):
        stripped = stripped[len(title) :].strip()
    return stripped


def _collapse_blank_lines(text: str) -> str:
    return re.sub(r"\n{3,}", "\n\n", text.strip())


def _has_suspicious_prefix(text: str) -> bool:
    stripped = text.strip()
    marker = _STRUCTURE_MARKER_RE.search(stripped)
    if marker is not None:
        if marker.start() == 0:
            return False
        prefix = stripped[: marker.start()]
    else:
        prefix = stripped[:240]
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
