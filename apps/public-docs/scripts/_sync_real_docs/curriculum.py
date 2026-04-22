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

    for row in _iter_rows(jsonl_text):
        row_type = str(row.get("row_type") or "")
        if row_type in {"heading", "paragraph", "table_caption"}:
            text = _normalize_curriculum_body_text(row.get("clean_text"))
        else:
            text = _normalize_text(row.get("clean_text"))

        if row_type == "page_number":
            continue
        if course_map_embed is not None and in_course_map_section:
            if row_type == "heading" and _is_curriculum_structural_heading_row(text=text, row=row):
                in_course_map_section = False
            else:
                continue
        if row_type == "heading":
            if course_map_embed is not None and _is_curriculum_course_map_heading(text):
                heading_text = _normalize_curriculum_heading_text(text)
                blocks.append(("block", f"## {heading_text}"))
                blocks.append(("block", _build_course_map_section_block(course_map_embed)))
                in_course_map_section = True
                inserted_course_map_section = True
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
            html = _normalize_text(row.get("html")) or text
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
    level = _normalize_curriculum_heading_level(
        source_level=source_level,
        last_heading_level=last_heading_level,
    )
    blocks.append(("block", f"{'#' * level} {heading_text}"))
    return level


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


def _should_render_curriculum_caption_as_heading(text: str) -> bool:
    normalized = text.strip()
    if not normalized or _looks_like_curriculum_figure_or_table_caption(normalized):
        return False
    if normalized.endswith("如下"):
        return False
    if bool(re.match(r"^[0-9一二三四五六七八九十]+[.、]", normalized)):
        return False
    return True


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
    normalized = re.sub(r"\s*\n\s*", "", normalized)
    normalized = re.sub(r"[ \t]+", " ", normalized)
    return normalized.strip()


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
    if _looks_like_compact_metadata_line(previous):
        return False
    return True


def _looks_like_compact_metadata_line(text: str) -> bool:
    normalized = text.strip()
    return bool(re.fullmatch(r"[^。；！？!?]{1,24}[：:][^，,。；！？!?]{1,16}", normalized))


def _convert_table_html_to_markdown_blocks(html: str) -> list[tuple[str, str]]:
    from .handbook import _convert_table_html_to_markdown_blocks as _handbook_convert

    return _handbook_convert(html)


def _render_markdown_block_lines(block_text: str) -> list[str]:
    if block_text.startswith(("#", "<", "import ", "|")):
        return block_text.splitlines()
    if "\n" in block_text:
        return [line.rstrip() for line in block_text.splitlines()]
    decimal_label_match = _MARKDOWN_DECIMAL_LABEL_RE.match(block_text)
    if decimal_label_match:
        escaped_label = decimal_label_match.group("label").replace(".", r"\.", 1)
        return _wrap_markdown_text_lines(f"{escaped_label}{decimal_label_match.group('rest')}")
    if _MARKDOWN_ORDERED_LIST_RE.match(block_text):
        _, _, content = block_text.partition(" ")
        return _wrap_markdown_text_lines(content, initial_prefix="1. ", subsequent_prefix="   ")
    if _MARKDOWN_UNORDERED_LIST_RE.match(block_text):
        marker, _, content = block_text.partition(" ")
        return _wrap_markdown_text_lines(
            content,
            initial_prefix=f"{marker} ",
            subsequent_prefix=" " * (len(marker) + 1),
        )
    return _wrap_markdown_text_lines(block_text)


def _dedupe_curriculum_heading_blocks(blocks: list[tuple[str, str]]) -> None:
    seen_headings: dict[str, int] = {}
    for index, (block_type, block_text) in enumerate(blocks):
        if block_type != "block" or not block_text.startswith("#"):
            continue
        marker, _, heading_text = block_text.partition(" ")
        if not heading_text:
            continue
        count = seen_headings.get(heading_text, 0)
        seen_headings[heading_text] = count + 1
        if not count:
            continue
        suffix = "（续）" if count == 1 else f"（续{count}）"
        blocks[index] = (block_type, f"{marker} {heading_text}{suffix}")
