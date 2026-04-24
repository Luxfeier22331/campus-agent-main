from __future__ import annotations

import json
import re
from collections.abc import Iterable
from hashlib import sha1

from .course_map import _build_course_map_section_block
from .shared import (
    _MARKDOWN_DECIMAL_LABEL_RE,
    _MARKDOWN_LIST_PREFIX_WITH_BREAK_RE,
    _MARKDOWN_LIST_PREFIX_WITHOUT_SPACE_RE,
    _MARKDOWN_ORDERED_LIST_RE,
    _MARKDOWN_UNORDERED_LIST_RE,
    CURRICULUM_DOC_SLUG_OVERRIDES,
    CourseMapDocEmbed,
    CurriculumDoc,
    _json_string,
    _normalize_text,
    _wrap_markdown_plain_text,
    _wrap_markdown_text_lines,
)
from .storage import _list_object_keys, _read_text_object

_HTML_TABLE_ROW_RE = re.compile(r"<tr\b[^>]*>.*?</tr>", re.IGNORECASE | re.DOTALL)
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_MARKDOWN_HEADING_BLOCK_RE = re.compile(r"^(#{1,6})\s+(.+)$")
_CURRICULUM_METADATA_LINE_RE = re.compile(r"^(?:学制|学分|总学分|学位授予|授予学位)[:：].{1,120}$")


def _build_curriculum_plan_index() -> str:
    return "\n".join(
        [
            "---",
            "title: 培养方案目录",
            "description: 当前公开 curriculum_plan 阅读面的培养方案目录。",
            "---",
            "",
            "当前目录展示培养方案公开阅读面使用的文档产物与导航结构。",
            "",
            "当前文档站与学生手册共享同一套左侧导航；你可以直接在侧边栏切换到学生手册。",
            "",
        ]
    )


def _discover_curriculum_docs(client) -> tuple[CurriculumDoc, ...]:
    keys = _list_object_keys(client, prefix="curriculum/documents/curriculum_plan/")
    docs: list[CurriculumDoc] = []
    seen_slugs: set[str] = set()
    for key in keys:
        if not key.endswith("/document-units.jsonl"):
            continue
        jsonl_text = _read_text_object(client=client, key=key)
        doc_id = _resolve_curriculum_doc_id(jsonl_text, key=key)
        title = _resolve_curriculum_doc_title(jsonl_text, key=key)
        slug = _build_curriculum_doc_slug(doc_id=doc_id, title=title)
        if slug in seen_slugs:
            slug = f"{slug}-{sha1(doc_id.encode('utf-8')).hexdigest()[:10]}"
        if slug in seen_slugs:
            raise ValueError(f"duplicate curriculum slug discovered: {slug}")
        seen_slugs.add(slug)
        docs.append(CurriculumDoc(slug=slug, title=title, key=key))
    return tuple(sorted(docs, key=lambda item: _sort_curriculum_title(item.title)))


def _resolve_curriculum_doc_id(jsonl_text: str, *, key: str) -> str:
    for row in _iter_rows(jsonl_text):
        doc_id = str(row.get("doc_id") or "").strip()
        if doc_id:
            return doc_id
    raise ValueError(f"doc_id is required in curriculum document-units: {key}")


def _resolve_curriculum_doc_title(jsonl_text: str, *, key: str) -> str:
    doc_id = ""
    for row in _iter_rows(jsonl_text):
        if not doc_id:
            doc_id = str(row.get("doc_id") or "").strip()
        if str(row.get("row_type") or "") == "heading":
            heading_text = _normalize_text(row.get("clean_text"))
            if heading_text:
                return heading_text
    if doc_id.startswith("curriculum:"):
        return doc_id.split(":", 1)[1].strip()
    raise ValueError(f"unable to resolve curriculum title from: {key}")


def _build_curriculum_doc_slug(*, doc_id: str, title: str) -> str:
    override = CURRICULUM_DOC_SLUG_OVERRIDES.get(doc_id)
    if override:
        return override
    slug = re.sub(r"[_\W]+", "-", title, flags=re.UNICODE).strip("-")
    if slug:
        return slug
    return f"curriculum-plan-{sha1(doc_id.encode('utf-8')).hexdigest()[:10]}"


def _sort_curriculum_title(title: str) -> tuple[int, str]:
    return (0 if "本科人才培养方案" in title else 1, title)


def _build_curriculum_markdown(
    *,
    title: str,
    jsonl_text: str,
    slug: str | None = None,
    course_map_embed: CourseMapDocEmbed | None = None,
) -> str:
    del slug
    lines: list[str] = ["---", f"title: {_json_string(title)}", "---", ""]
    if course_map_embed is not None:
        lines.extend(
            [
                f'import CourseMapSection from "{course_map_embed.component_import_path}";',
                (
                    f"import {course_map_embed.data_import_name} "
                    f'from "{course_map_embed.data_import_path}";'
                ),
                "",
            ]
        )
    blocks: list[tuple[str, str]] = []
    in_course_map_section = False
    inserted_course_map_section = False
    last_heading_level: int | None = None

    for row in _coalesce_curriculum_table_continuations(tuple(_iter_rows(jsonl_text))):
        row_type = str(row.get("row_type") or "")
        if row_type in {"heading", "paragraph", "table_caption"}:
            text = _repair_known_curriculum_docs_text_artifacts(
                title=title,
                text=_normalize_curriculum_body_text(row.get("clean_text")),
            )
        else:
            text = _normalize_text(row.get("clean_text"))

        if row_type == "page_number":
            continue
        if in_course_map_section:
            if row_type == "heading" and _is_curriculum_course_map_section_boundary_row(
                text=text,
                row=row,
            ):
                in_course_map_section = False
            else:
                continue
        if row_type == "heading":
            if _is_curriculum_course_map_heading(text):
                section_hint = _normalize_text(row.get("section_hint"))
                if course_map_embed is not None:
                    heading_text = _normalize_curriculum_heading_text(text)
                    blocks.append(("block", f"## {heading_text}"))
                    blocks.append(("block", _build_course_map_section_block(course_map_embed)))
                    inserted_course_map_section = True
                in_course_map_section = course_map_embed is not None or section_hint in {
                    "section",
                    "chapter",
                }
                last_heading_level = 2
                continue
            if text == title and not blocks:
                continue
            last_heading_level = _append_curriculum_heading(
                blocks,
                text=text,
                source_level=row.get("heading_level"),
                last_heading_level=last_heading_level,
            )
            continue
        if row_type == "table_caption" and text:
            last_heading_level = _append_curriculum_caption_block(
                blocks,
                text=_wrap_markdown_plain_text(text),
                last_heading_level=last_heading_level,
            )
            continue
        if row_type == "table":
            html = _repair_known_curriculum_docs_table_html(
                title=title,
                html=_normalize_text(row.get("html")) or text,
            )
            if html:
                for block_type, block_text in _convert_table_html_to_markdown_blocks(html):
                    if block_type == "section_label":
                        last_heading_level = _append_curriculum_caption_block(
                            blocks,
                            text=block_text,
                            last_heading_level=last_heading_level,
                        )
                        continue
                    blocks.append(("block", block_text))
            continue
        if row_type != "paragraph" or not text:
            continue
        if blocks and blocks[-1][0] == "paragraph" and _should_merge_paragraph(blocks[-1][1], text):
            blocks[-1] = ("paragraph", blocks[-1][1] + text)
        else:
            blocks.append(("paragraph", text))

    _dedupe_curriculum_heading_blocks(blocks)

    for _, block_text in blocks:
        lines.extend(_render_markdown_block_lines(block_text))
        lines.append("")
    if course_map_embed is not None and not inserted_course_map_section:
        raise ValueError(f"missing 课程地图 section while published blocks exist for {title}")
    return "\n".join(lines).rstrip() + "\n"


def _repair_known_curriculum_docs_text_artifacts(*, title: str, text: str) -> str:
    if not text:
        return text
    if title != "少数民族预科教育人才培养方案":
        return text
    repaired = text.replace("大学体育、心理健康主干课程:", "大学体育、心理健康。主干课程:")
    repaired = repaired.replace("大学英语基础课程:", "大学英语。基础课程:")
    repaired = repaired.replace(
        "大学体育、心理健康。主干课程:大学语文、实用写作、高等数学、大学英语",
        "大学体育、心理健康。主干课程:大学语文、实用写作、高等数学、大学英语。",
    )
    return re.sub(
        r"理科班增设普通化学和大学物理(?![。；])",
        "理科班增设普通化学和大学物理。",
        repaired,
    )


def _repair_known_curriculum_docs_table_html(*, title: str, html: str) -> str:
    if not html:
        return html
    if title == "少数民族预科教育人才培养方案":
        html = html.replace(
            '<table><tr><td rowspan="2" colspan="2">类别</td><td rowspan="2">学时</td><td colspan="2">各学期周学时分配计划</td></tr>'
            '<tr><td>第一学期</td><td>第二学期</td></tr><tr><td rowspan="2">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr>'
            '<tr><td>主干课</td><td>468</td><td>14</td><td>12</td></tr><tr><td colspan="2">限选课</td><td>144</td><td>4</td><td>4</td></tr>'
            '<tr><td colspan="2">合计</td><td>828</td><td>26</td><td>20</td></tr><tr><td>第一学期</td><td>第二学期</td></tr>'
            '<tr><td rowspan="3">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr><tr><td>主干课</td><td>540</td><td>16</td><td>14</td></tr>'
            '<tr><td>基础课</td><td>144</td><td>4</td><td>4</td></tr><tr><td colspan="2">限选课</td><td>144</td><td>4</td><td>4</td></tr>'
            '<tr><td colspan="2">合计</td><td>1044</td><td>32</td><td>26</td></tr></table>',
            '<table><tr><td colspan="5">文科班</td></tr><tr><td rowspan="2" colspan="2">类别</td><td rowspan="2">学时</td><td colspan="2">各学期周学时分配计划</td></tr>'
            '<tr><td>第一学期</td><td>第二学期</td></tr><tr><td rowspan="2">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr>'
            '<tr><td>主干课</td><td>468</td><td>14</td><td>12</td></tr><tr><td colspan="2">限选课</td><td>144</td><td>4</td><td>4</td></tr>'
            '<tr><td colspan="2">合计</td><td>828</td><td>26</td><td>20</td></tr><tr><td colspan="5">理科班</td></tr><tr><td rowspan="2" colspan="2">类别</td><td rowspan="2">学时</td><td colspan="2">各学期周学时分配计划</td></tr>'
            '<tr><td>第一学期</td><td>第二学期</td></tr><tr><td rowspan="3">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr><tr><td>主干课</td><td>540</td><td>16</td><td>14</td></tr>'
            '<tr><td>基础课</td><td>144</td><td>4</td><td>4</td></tr><tr><td colspan="2">限选课</td><td>144</td><td>4</td><td>4</td></tr><tr><td colspan="2">合计</td><td>1044</td><td>32</td><td>26</td></tr></table>',
        )
        return html.replace(
            '<table><tr><td rowspan="2">课程类别</td><td rowspan="2">课程编号</td><td rowspan="2">课程名称</td><td rowspan="2">学分</td><td colspan="2">学时</td><td colspan="2">各学期周学时分配</td><td rowspan="2">备注</td></tr>',
            '<table><tr><td colspan="9">理科班</td></tr><tr><td rowspan="2">课程类别</td><td rowspan="2">课程编号</td><td rowspan="2">课程名称</td><td rowspan="2">学分</td><td colspan="2">学时</td><td colspan="2">各学期周学时分配</td><td rowspan="2">备注</td></tr>',
        )
    if title == "民族学本科第二学士学位人才培养方案":
        return html.replace(
            '<td rowspan="13">专业教育</td><td rowspan="13">专业必修课共30学分</td>',
            '<td rowspan="34">专业教育</td><td rowspan="14">专业必修课共30学分</td>',
        )
    return html


def _coalesce_curriculum_table_continuations(
    rows: tuple[dict[str, object], ...],
) -> tuple[dict[str, object], ...]:
    coalesced: list[dict[str, object]] = []
    index = 0
    while index < len(rows):
        row = rows[index]
        if str(row.get("row_type") or "") != "table":
            coalesced.append(row)
            index += 1
            continue

        if _is_curriculum_table_continuation(row):
            coalesced.append(row)
            index += 1
            continue

        owner_row_id = str(row.get("row_id") or "").strip()
        continuation_group_id = str(row.get("continuation_group_id") or owner_row_id).strip()
        merged_html = _normalize_text(row.get("html")) or _normalize_text(row.get("clean_text"))
        merged_row = row
        next_index = index + 1
        did_merge = False

        while next_index < len(rows):
            candidate = rows[next_index]
            if str(candidate.get("row_type") or "") == "page_number":
                next_index += 1
                continue
            if not _is_curriculum_table_continuation_of(
                candidate,
                owner_row_id=owner_row_id,
                continuation_group_id=continuation_group_id,
            ):
                break
            continuation_html = _normalize_text(candidate.get("html")) or _normalize_text(
                candidate.get("clean_text")
            )
            if merged_html and continuation_html:
                merged_html = _merge_curriculum_table_html(merged_html, continuation_html)
                did_merge = True
            next_index += 1

        if did_merge:
            merged_row = dict(row)
            merged_row["html"] = merged_html
            merged_row["clean_text"] = merged_html
        coalesced.append(merged_row)
        index = next_index

    return tuple(coalesced)


def _is_curriculum_table_continuation(row: dict[str, object]) -> bool:
    return (
        str(row.get("row_type") or "") == "table"
        and str(row.get("relation_type") or "") == "table_continuation"
    )


def _is_curriculum_table_continuation_of(
    row: dict[str, object],
    *,
    owner_row_id: str,
    continuation_group_id: str,
) -> bool:
    if not _is_curriculum_table_continuation(row):
        return False
    row_owner_id = str(row.get("owner_row_id") or "").strip()
    row_group_id = str(row.get("continuation_group_id") or "").strip()
    return bool(
        (owner_row_id and row_owner_id == owner_row_id)
        or (continuation_group_id and row_group_id == continuation_group_id)
    )


def _merge_curriculum_table_html(base_html: str, continuation_html: str) -> str:
    base_rows = _extract_curriculum_html_table_rows(base_html)
    continuation_rows = _extract_curriculum_html_table_rows(continuation_html)
    if not base_rows or not continuation_rows:
        return f"{base_html}\n{continuation_html}"

    rows_to_append = continuation_rows
    base_header_signature = _html_row_text_signature(base_rows[0])
    base_second_signature = _html_row_text_signature(base_rows[1]) if len(base_rows) > 1 else ""
    continuation_second_signature = (
        _html_row_text_signature(continuation_rows[1]) if len(continuation_rows) > 1 else ""
    )
    if (
        base_header_signature
        and _html_row_text_signature(continuation_rows[0]) == base_header_signature
    ):
        rows_to_append = continuation_rows[1:]
        if base_second_signature and continuation_second_signature == base_second_signature:
            rows_to_append = continuation_rows[2:]
    return "<table>" + "".join([*base_rows, *rows_to_append]) + "</table>"


def _extract_curriculum_html_table_rows(html: str) -> tuple[str, ...]:
    return tuple(match.group(0) for match in _HTML_TABLE_ROW_RE.finditer(html))


def _html_row_text_signature(row_html: str) -> str:
    return " ".join(_HTML_TAG_RE.sub(" ", row_html).split()).strip().lower()


def _is_curriculum_course_map_heading(text: str) -> bool:
    normalized = _normalize_curriculum_heading_text(text)
    return "课程地图" in normalized


def _append_curriculum_heading(
    blocks: list[tuple[str, str]],
    *,
    text: str,
    source_level: object,
    last_heading_level: int | None,
) -> int | None:
    heading_text = _normalize_curriculum_heading_text(text)
    if not heading_text:
        return last_heading_level
    if heading_text.endswith("如下"):
        blocks.append(("block", heading_text))
        return last_heading_level
    if _looks_like_curriculum_version_note(heading_text):
        blocks.append(("paragraph", heading_text))
        return last_heading_level
    if _looks_like_curriculum_course_requirement_sentence(heading_text):
        blocks.append(("paragraph", heading_text))
        return last_heading_level
    level = _normalize_curriculum_heading_level(
        source_level=source_level,
        last_heading_level=last_heading_level,
    )
    heading_family = _curriculum_same_level_heading_family(heading_text)
    if heading_family is not None:
        previous_family_heading = _find_last_curriculum_heading_family_block(
            blocks,
            heading_family,
        )
        if previous_family_heading is not None:
            level = previous_family_heading[0]
        elif last_heading_level is not None and level <= last_heading_level:
            level = min(last_heading_level + 1, 6)
    blocks.append(("block", f"{'#' * level} {heading_text}"))
    return level


def _find_last_curriculum_heading_block(
    blocks: list[tuple[str, str]],
) -> tuple[int, str] | None:
    for _, block_text in reversed(blocks):
        match = _MARKDOWN_HEADING_BLOCK_RE.match(block_text)
        if match is None:
            continue
        return (len(match.group(1)), match.group(2).strip())
    return None


def _find_last_curriculum_heading_family_block(
    blocks: list[tuple[str, str]],
    family: str,
) -> tuple[int, str] | None:
    for _, block_text in reversed(blocks):
        match = _MARKDOWN_HEADING_BLOCK_RE.match(block_text)
        if match is None:
            continue
        level = len(match.group(1))
        heading_text = match.group(2).strip()
        if _curriculum_same_level_heading_family(heading_text) == family:
            return (level, heading_text)
        if level <= 2:
            break
    return None


def _append_curriculum_caption_block(
    blocks: list[tuple[str, str]],
    *,
    text: str,
    last_heading_level: int | None,
) -> int | None:
    if not text or _looks_like_curriculum_noise_label(text):
        return last_heading_level
    if _should_render_curriculum_caption_as_heading(text):
        level = _infer_curriculum_structural_label_level(
            text=text,
            last_heading_level=last_heading_level,
        )
        heading_text = _normalize_curriculum_heading_text(text)
        if heading_text:
            heading_family = _curriculum_same_level_heading_family(heading_text)
            previous_family_heading = (
                _find_last_curriculum_heading_family_block(blocks, heading_family)
                if heading_family is not None
                else None
            )
            if previous_family_heading is not None:
                level = previous_family_heading[0]
            elif (
                heading_family is not None
                and last_heading_level is not None
                and level <= last_heading_level
            ):
                level = min(last_heading_level + 1, 6)
            blocks.append(("block", f"{'#' * level} {heading_text}"))
            return level
        return last_heading_level
    blocks.append(("block", text))
    return last_heading_level


def _normalize_curriculum_heading_text(text: str) -> str:
    normalized = text.strip()
    while normalized.endswith(("：", ":", "。")):
        normalized = normalized[:-1].rstrip()
    return normalized


def _normalize_curriculum_heading_level(
    *, source_level: object, last_heading_level: int | None
) -> int:
    raw_level = _parse_curriculum_heading_level(source_level, default=2)
    raw_level = max(2, min(6, raw_level))
    if last_heading_level is None:
        return 2
    return max(2, min(raw_level, last_heading_level + 1))


def _parse_curriculum_heading_level(value: object, *, default: int) -> int:
    try:
        return int(value or default)
    except (TypeError, ValueError):
        return default


def _infer_curriculum_structural_label_level(*, text: str, last_heading_level: int | None) -> int:
    if last_heading_level is None:
        return 3
    if _looks_like_curriculum_nested_module_label(text):
        if last_heading_level < 5:
            return min(last_heading_level + 1, 6)
        return 6
    if last_heading_level < 4:
        return min(last_heading_level + 1, 6)
    return 5


def _looks_like_curriculum_figure_or_table_caption(text: str) -> bool:
    return bool(re.match(r"^(表|图|附表|附图)\s*[0-9一二三四五六七八九十]", text.strip()))


def _looks_like_curriculum_nested_module_label(text: str) -> bool:
    return bool(re.match(r"^模块[一二三四五六七八九十0-9]+[：:]", text.strip()))


def _looks_like_curriculum_numbered_heading(text: str) -> bool:
    return bool(re.match(r"^(?:[（(]?\d+[)）.、]|[0-9]+[.．])", text.strip()))


def _looks_like_curriculum_chinese_parenthesized_heading(text: str) -> bool:
    return bool(re.match(r"^[（(][一二三四五六七八九十]+[)）]", text.strip()))


def _looks_like_curriculum_course_requirement_sentence(text: str) -> bool:
    return bool(re.match(r"^[（(]\d+[)）]\s*.+课程.+\d+\s*学分[。.]?$", text.strip()))


def _looks_like_curriculum_version_note(text: str) -> bool:
    return bool(re.fullmatch(r"[（(]?\d{4}\s*版[)）]?", text.strip()))


def _curriculum_same_level_heading_family(text: str) -> str | None:
    if _looks_like_curriculum_numbered_heading(text):
        return "numbered"
    if _looks_like_curriculum_chinese_parenthesized_heading(text):
        return "chinese_parenthesized"
    if _looks_like_curriculum_nested_module_label(text):
        return "module"
    return None


def _should_render_curriculum_caption_as_heading(text: str) -> bool:
    normalized = text.strip()
    if not normalized or _looks_like_curriculum_figure_or_table_caption(normalized):
        return False
    if normalized.endswith("如下"):
        return False
    return not bool(re.match(r"^[0-9一二三四五六七八九十]+[.、]", normalized))


def _looks_like_curriculum_noise_label(text: str) -> bool:
    normalized = text.strip()
    if not normalized:
        return True
    return bool(re.fullmatch(r"[（(]?[0-9一二三四五六七八九十]+[)）]?", normalized))


def _normalize_curriculum_body_text(value: object) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        return ""
    normalized = normalized.replace("\r\n", "\n").replace("\r", "\n")
    normalized = _MARKDOWN_LIST_PREFIX_WITH_BREAK_RE.sub(r"\1 ", normalized)
    normalized = _MARKDOWN_LIST_PREFIX_WITHOUT_SPACE_RE.sub(r"\g<marker> \g<rest>", normalized)
    lines = [re.sub(r"[ \t]+", " ", line.strip()) for line in normalized.split("\n")]
    lines = [line for line in lines if line]
    if len(lines) > 1 and _looks_like_curriculum_list_lines(lines):
        return "\n".join(lines)
    normalized = re.sub(r"\s*\n\s*", "", normalized)
    normalized = re.sub(r"[ \t]+", " ", normalized)
    return normalized.strip()


def _looks_like_curriculum_list_lines(lines: list[str]) -> bool:
    return (
        sum(
            1
            for line in lines
            if _MARKDOWN_ORDERED_LIST_RE.match(line)
            or _MARKDOWN_DECIMAL_LABEL_RE.match(line)
            or _looks_like_curriculum_chinese_parenthesized_heading(line)
        )
        >= 2
    )


def _is_curriculum_structural_heading_row(*, text: str, row: dict[str, object]) -> bool:
    if str(row.get("row_type") or "") != "heading":
        return False
    section_hint = _normalize_text(row.get("section_hint"))
    if section_hint:
        return True
    normalized = text.strip()
    if not normalized:
        return False
    return bool(
        re.match(r"^[一二三四五六七八九十]+、", normalized)
        or re.match(r"^[（(][一二三四五六七八九十]+[)）]", normalized)
        or re.match(r"^[（(]?\d+[)）.、]", normalized)
        or re.match(r"^第[一二三四五六七八九十百千万〇零两0-9]+[章节部分]", normalized)
    )


def _is_curriculum_course_map_section_boundary_row(*, text: str, row: dict[str, object]) -> bool:
    if str(row.get("row_type") or "") != "heading":
        return False
    section_hint = _normalize_text(row.get("section_hint"))
    if section_hint in {"section", "chapter"}:
        return True
    normalized = text.strip()
    if not normalized:
        return False
    return bool(
        re.match(r"^[一二三四五六七八九十]+、", normalized)
        or re.match(r"^第[一二三四五六七八九十百千万〇零两0-9]+[章节部分]", normalized)
    )


def _iter_rows(jsonl_text: str) -> Iterable[dict[str, object]]:
    for line in jsonl_text.splitlines():
        stripped = line.strip()
        if stripped:
            yield json.loads(stripped)


def _should_merge_paragraph(previous: str, current: str) -> bool:
    if not previous:
        return False
    if previous.endswith(("。", "！", "？", "；", "：", ".", "!", "?", ";", ":")):
        return False
    return not _looks_like_compact_metadata_line(previous)


def _looks_like_compact_metadata_line(text: str) -> bool:
    normalized = text.strip()
    return bool(
        _CURRICULUM_METADATA_LINE_RE.fullmatch(normalized)
        or re.fullmatch(r"[^。；！？!?]{1,24}[：:][^，,。；！？!?]{1,16}", normalized)
    )


def _convert_table_html_to_markdown_blocks(html: str) -> list[tuple[str, str]]:
    from .handbook import _convert_table_html_to_markdown_blocks as _handbook_convert

    return _handbook_convert(html)


def _render_markdown_block_lines(block_text: str) -> list[str]:
    if block_text.startswith(("#", "<", "import ", "|")):
        return block_text.splitlines()
    if "\n" in block_text:
        raw_lines = [line.rstrip() for line in block_text.splitlines()]
        stripped_lines = [line.strip() for line in raw_lines if line.strip()]
        if stripped_lines and all(
            _MARKDOWN_ORDERED_LIST_RE.match(line) or _MARKDOWN_DECIMAL_LABEL_RE.match(line)
            for line in stripped_lines
        ):
            rendered: list[str] = []
            for line in stripped_lines:
                rendered.extend(_render_markdown_block_lines(line))
            return rendered
        return raw_lines
    ordered_list_match = _MARKDOWN_ORDERED_LIST_RE.match(block_text)
    if ordered_list_match:
        marker = ordered_list_match.group(0).strip()
        content = block_text[ordered_list_match.end() :]
        return _wrap_markdown_text_lines(
            content,
            initial_prefix=f"{marker} ",
            subsequent_prefix=" " * (len(marker) + 1),
        )
    decimal_label_match = _MARKDOWN_DECIMAL_LABEL_RE.match(block_text)
    if decimal_label_match:
        escaped_label = decimal_label_match.group("label").replace(".", r"\.", 1)
        return _wrap_markdown_text_lines(f"{escaped_label}{decimal_label_match.group('rest')}")
    if _MARKDOWN_UNORDERED_LIST_RE.match(block_text):
        marker, _, content = block_text.partition(" ")
        return _wrap_markdown_text_lines(
            content,
            initial_prefix=f"{marker} ",
            subsequent_prefix=" " * (len(marker) + 1),
        )
    return _wrap_markdown_text_lines(block_text)


def _dedupe_curriculum_heading_blocks(blocks: list[tuple[str, str]]) -> None:
    # Keep visible text source-faithful; the docs renderer owns duplicate heading anchors.
    del blocks
