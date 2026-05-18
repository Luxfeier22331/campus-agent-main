from __future__ import annotations

import re
from collections.abc import Mapping, Sequence

_ARTICLE_LABEL_RE = re.compile(r"^(?P<label>第[一二三四五六七八九十百千万〇零两0-9]+条)")
_CHAPTER_HEADING_RE = re.compile(r"^第[一二三四五六七八九十百千万〇零两0-9]+[章节][^。；]*$")
_TOP_LEVEL_HEADING_RE = re.compile(r"^[一二三四五六七八九十百千万〇零两0-9]+、[^。；]{1,60}$")
_SUBSECTION_HEADING_RE = re.compile(
    r"^[（(][一二三四五六七八九十百千万〇零两0-9]+[)）][、.]?[^。；]{0,60}$"
)
_SUBSECTION_LABEL_RE = re.compile(r"^[（(][一二三四五六七八九十百千万〇零两0-9]+[)）][、.]?")
_HTML_TAG_RE = re.compile(r"<\s*/?\s*[A-Za-z][^>]*>")
_PUBLICATION_IMPRINT_RE = re.compile(
    r"^(?:中央民族大学[^\n。；：:]{0,40}(?:办公室|学院|研究院|中心)|"
    r"\d{4}年\d{1,2}月\d{1,2}日(?:印发|发布)?)$",
    re.MULTILINE,
)
_FORM_ATTACHMENT_HEADING_RE = re.compile(
    r"^(?:附(?:件|表)\s*\d*\s*)?[^。\n]{0,80}(?:申请表|审批表|登记表|汇总表|信息表)\s*$"
)
_SUPPLEMENTARY_ATTACHMENT_LINE_RE = re.compile(
    r"^(?:附(?:件|表))\s*[：:：]?\s*(?:[一二三四五六七八九十百千万〇零两]|\d+)?(?:[.．、]\s*)?.*$"
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
_SUPPLEMENTARY_ATTACHMENT_MARKERS = (
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
_GENERATED_AT_LIKE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:")
_STRUCTURAL_MARKER_RE = re.compile(
    r"(^|\n)\s*(第[一二三四五六七八九十百千万〇零两0-9]+[章节条]|"
    r"[一二三四五六七八九十百千万〇零两0-9]+、)"
)
_ENUMERATED_ITEM_LABEL_RE = re.compile(
    r"(^|\n)\s*((?:\d+[.．、])|(?:[（(]\d+[)）])|"
    r"(?:[（(][一二三四五六七八九十百千万〇零两]+[)）][、.]?))"
)
_MEANINGFUL_OVERLAP_LINE_MIN_CHARS = 18

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
    if contains_publication_imprint(text):
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
        if compact_item:
            return True
    return False


def contains_html_tag(text: str) -> bool:
    return _HTML_TAG_RE.search(text) is not None


def contains_publication_imprint(text: str) -> bool:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    return any(_PUBLICATION_IMPRINT_RE.match(line) is not None for line in lines)


def contains_form_tail_marker(text: str) -> bool:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for index, line in enumerate(lines):
        if _FORM_ATTACHMENT_HEADING_RE.match(line) is None:
            if _SUPPLEMENTARY_ATTACHMENT_LINE_RE.match(line) is None:
                continue
            tail_preview = "\n".join(lines[index : index + 40])
            marker_count = sum(
                1 for marker in _SUPPLEMENTARY_ATTACHMENT_MARKERS if marker in tail_preview
            )
            table_like_line_count = sum(1 for item in lines[index : index + 40] if "|" in item)
            if marker_count >= 3 or table_like_line_count >= 2:
                return True
            continue
        tail_preview = "\n".join(lines[index : index + 24])
        marker_count = sum(1 for marker in _FORM_ATTACHMENT_MARKERS if marker in tail_preview)
        if marker_count >= 2:
            return True
    return False


def section_path_contains_body_like_item(section_path: Sequence[object]) -> bool:
    return any(_looks_like_body_text(str(item or "").strip()) for item in section_path)


def section_path_depth_exceeds(section_path: Sequence[object], *, max_depth: int) -> bool:
    return len([item for item in section_path if str(item or "").strip()]) > max_depth


def section_path_has_long_segment(section_path: Sequence[object], *, max_chars: int) -> bool:
    return any(len(str(item or "").strip()) > max_chars for item in section_path)


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


def header_dominance_is_blocking_quality_gap(
    *,
    metadata: Mapping[str, object],
    threshold: float,
) -> bool:
    if not header_token_ratio_at_least(metadata=metadata, threshold=threshold):
        return False
    display_text = str(metadata.get("display_text") or "").strip()
    return not _is_short_answer_fragment(display_text)


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


def chunk_has_coarse_provision_label(metadata: Mapping[str, object]) -> bool:
    display_text = str(metadata.get("display_text") or "")
    labels = _enumerated_item_labels(display_text)
    if len(labels) < 2:
        return False
    provision_label = str(metadata.get("provision_label") or "").strip()
    if not provision_label:
        return True
    return "-" not in provision_label


def adjacent_chunks_have_meaningful_overlap(
    left_metadata: Mapping[str, object],
    right_metadata: Mapping[str, object],
) -> bool:
    return bool(
        _meaningful_display_lines(left_metadata) & _meaningful_display_lines(right_metadata)
    )


def _looks_like_body_text(text: str) -> bool:
    normalized = text.strip()
    if len(normalized) < 12:
        return False
    article_match = _ARTICLE_LABEL_RE.match(normalized)
    if article_match is not None:
        article_body = normalized[article_match.end() :].strip()
        if not article_body:
            return False
        if any(marker in article_body for marker in ("。", "；", ";", "：", ":")):
            return True
        if len(article_body) <= 32 and not _contains_body_sentence_marker(article_body):
            return False
        return (
            len(article_body) > 32
            or article_body.startswith(("为", "根据", "本办法"))
            or _contains_body_sentence_marker(article_body)
        )
    subsection_match = _SUBSECTION_LABEL_RE.match(normalized)
    if subsection_match is not None:
        body = normalized[subsection_match.end() :].strip()
        if not body:
            return False
        if any(marker in body for marker in ("。", "；", ";")):
            return True
        if body.endswith(("：", ":")) and _contains_body_sentence_marker(body):
            return True
        if len(body) > 28 and _contains_body_sentence_marker(body):
            return True
        return len(body) > 45
    if looks_like_structural_heading(normalized):
        return False
    if any(marker in normalized for marker in ("。", "；", ";")):
        return True
    return len(normalized) > 45 and _contains_body_sentence_marker(normalized)


def _contains_body_sentence_marker(text: str) -> bool:
    return any(
        marker in text
        for marker in (
            "制定",
            "根据",
            "适用",
            "应",
            "须",
            "需",
            "由",
            "负责",
            "按照",
            "不得",
            "可以",
            "给予",
            "认定",
            "下列",
            "违反",
            "遵守",
        )
    )


def _is_short_answer_fragment(text: str) -> bool:
    normalized = text.strip()
    if not normalized:
        return False
    if len(normalized) > 28:
        return False
    return (
        _SUBSECTION_LABEL_RE.match(normalized) is not None
        or normalized.endswith(("；", ";"))
        or _looks_like_short_academic_subject(normalized)
        or _looks_like_short_field_answer(normalized)
    )


def _looks_like_short_academic_subject(text: str) -> bool:
    if len(text) < 2 or len(text) > 16:
        return False
    if any(punctuation in text for punctuation in "，。；：,.，;:/\\()（）[]【】"):
        return False
    return text.endswith(("学", "专业", "方向"))


def _looks_like_short_field_answer(text: str) -> bool:
    if "：" not in text and ":" not in text:
        return False
    field_name, value = re.split(r"[：:]", text, maxsplit=1)
    normalized_field = field_name.strip()
    normalized_value = value.strip()
    if normalized_field not in {"招生专业", "选拔对象", "招生方向"}:
        return False
    return _looks_like_short_academic_subject(normalized_value)


def _strip_markdown_heading(text: str) -> str:
    return re.sub(r"^\s*#+\s*", "", text.strip())


def _compact_text(text: str) -> str:
    return re.sub(r"\s+", "", text.strip())


def _enumerated_item_labels(text: str) -> list[str]:
    labels: list[str] = []
    for match in _ENUMERATED_ITEM_LABEL_RE.finditer(text):
        label = match.group(2).strip()
        if label and (not labels or labels[-1] != label):
            labels.append(label)
    return labels


def _meaningful_display_lines(metadata: Mapping[str, object]) -> set[str]:
    display_text = str(metadata.get("display_text") or "")
    return {
        compact
        for compact in (_compact_overlap_line(line) for line in display_text.splitlines())
        if len(compact) >= _MEANINGFUL_OVERLAP_LINE_MIN_CHARS
    }


def _compact_overlap_line(text: str) -> str:
    return _compact_text(text).strip("，。；;:：、")


__all__ = [
    "REGULATION_BODY_ROLES",
    "REGULATION_TITLE_ROLES",
    "adjacent_chunks_have_meaningful_overlap",
    "chunk_has_coarse_provision_label",
    "contains_form_tail_marker",
    "contains_html_tag",
    "contains_publication_imprint",
    "header_dominance_is_blocking_quality_gap",
    "header_duplicates_display_text",
    "header_token_ratio_at_least",
    "is_regulation_body_role",
    "is_regulation_title_role",
    "looks_like_structural_heading",
    "page_anchor_is_fabricated",
    "section_path_contains_body_like_item",
    "section_path_contains_body_text",
    "section_path_depth_exceeds",
    "section_path_has_long_segment",
    "should_skip_regulation_structural_unit",
    "source_notice_release_time_is_generated_at",
    "title_text_is_duplicated",
    "token_guardrail_indicates_coarse_unit",
]
