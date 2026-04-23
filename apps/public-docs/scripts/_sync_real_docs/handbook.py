from __future__ import annotations

import json
import re
from hashlib import sha1
from html.parser import HTMLParser

from .shared import (
    _HANDBOOK_ARTICLE_HEADING_RE,
    _HANDBOOK_CHAPTER_HEADING_RE,
    _MARKDOWN_DECIMAL_LABEL_RE,
    _MARKDOWN_LINE_LIMIT,
    _MARKDOWN_LIST_PREFIX_WITHOUT_SPACE_RE,
    _MARKDOWN_ORDERED_LIST_RE,
    _MARKDOWN_UNORDERED_LIST_RE,
    HANDBOOK_COLLECTION,
    HANDBOOK_CORPUS,
    HANDBOOK_DOC_SLUG_OVERRIDES,
    HANDBOOK_FILENAME,
    HANDBOOK_NOISE_LINES,
    HANDBOOK_REVISION_TRACK,
    HANDBOOK_SPLIT_MANIFEST_PATH,
    HANDBOOK_YEAR,
    HandbookDoc,
    _TableCell,
    _wrap_markdown_text_lines,  # split import to keep lint simple
)


def _build_handbook_index() -> str:
    return "\n".join(
        [
            "---",
            "title: 学生手册",
            "description: 当前公开 student_rules 阅读面的学生手册目录。",
            "---",
            "",
            "当前目录展示学生手册公开阅读面使用的文档产物与导航结构。",
            "",
            "当前文档站与培养方案共享同一套左侧导航；你可以直接在侧边栏切换到培养方案。",
            "",
        ]
    )


def _load_handbook_docs() -> tuple[HandbookDoc, ...]:
    manifest = json.loads(HANDBOOK_SPLIT_MANIFEST_PATH.read_text(encoding="utf-8"))
    docs: list[HandbookDoc] = []
    seen_slugs: set[str] = set()

    for item in manifest.get("documents") or ():
        document_id = str(item.get("document_id") or "").strip()
        title = str(item.get("title") or "").strip()
        if not document_id or not title:
            raise ValueError(
                f"handbook split manifest document requires document_id/title: {item!r}"
            )
        slug = _build_handbook_doc_slug(document_id=document_id, title=title)
        if slug in seen_slugs:
            raise ValueError(f"duplicate handbook slug discovered: {slug}")
        seen_slugs.add(slug)
        docs.append(HandbookDoc(slug=slug, title=title, document_id=document_id))

    return tuple(docs)


def _build_handbook_doc_slug(*, document_id: str, title: str) -> str:
    override = HANDBOOK_DOC_SLUG_OVERRIDES.get(document_id)
    if override:
        return override
    slug = re.sub(r"[_\W]+", "-", title, flags=re.UNICODE).strip("-")
    if slug:
        return slug
    return f"student-handbook-{sha1(document_id.encode('utf-8')).hexdigest()[:10]}"


def _document_id_suffix(document_id: str) -> str:
    segments = tuple(part.strip() for part in document_id.split(":") if part.strip())
    if not segments:
        raise ValueError("document_id is required")
    return segments[-1]


def _document_id_short_label(document_id: str, *, document_suffix: str) -> str:
    normalized_suffix = _slugify_path_label(document_suffix)
    if _looks_like_hash(normalized_suffix) and len(normalized_suffix) > 8:
        return normalized_suffix[:8]
    normalized = _slugify_path_label(document_id)
    if _looks_like_hash(normalized) and len(normalized) > 8:
        return normalized[:8]
    return normalized_suffix


def _looks_like_hash(value: str) -> bool:
    return len(value) >= 8 and all(ch in "0123456789abcdef" for ch in value)


def _slugify_path_label(value: str) -> str:
    normalized = value.strip().lower()
    slug = "".join(ch if ch.isalnum() else "-" for ch in normalized).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "document"


def _build_handbook_doc_key(doc: HandbookDoc) -> str:
    document_suffix = _document_id_suffix(doc.document_id)
    title_slug = _slugify_path_label(doc.title or document_suffix)
    docid8 = _document_id_short_label(doc.document_id, document_suffix=document_suffix)
    return "/".join(
        [
            HANDBOOK_CORPUS,
            "documents",
            HANDBOOK_COLLECTION,
            f"{title_slug}--{docid8}",
            HANDBOOK_REVISION_TRACK,
            HANDBOOK_YEAR,
            HANDBOOK_FILENAME,
        ]
    )


def _clean_handbook_markdown(markdown: str) -> str:
    lines = markdown.splitlines()
    if not lines:
        return markdown

    frontmatter_end = -1
    if lines[0].strip() == "---":
        for index in range(1, len(lines)):
            if lines[index].strip() == "---":
                frontmatter_end = index
                break

    prefix = lines[: frontmatter_end + 1] if frontmatter_end != -1 else []
    body = lines[frontmatter_end + 1 :] if frontmatter_end != -1 else lines
    if prefix:
        prefix = _normalize_handbook_frontmatter(prefix)

    cleaned_body: list[str] = []
    previous_blank = False
    for line in body:
        stripped = line.strip()
        if stripped in HANDBOOK_NOISE_LINES:
            continue
        if not stripped:
            if previous_blank:
                continue
            previous_blank = True
            cleaned_body.append("")
            continue
        previous_blank = False
        cleaned_body.append(line.rstrip())

    combined = prefix + _normalize_handbook_body(cleaned_body, title=_frontmatter_title(prefix))
    return "\n".join(combined).rstrip() + "\n"


def _normalize_handbook_frontmatter(frontmatter_lines: list[str]) -> list[str]:
    if len(frontmatter_lines) < 2:
        return frontmatter_lines
    rewritten: list[str] = [frontmatter_lines[0]]
    seen_corpus = False
    seen_collection = False
    for line in frontmatter_lines[1:-1]:
        stripped = line.strip()
        if stripped.startswith("corpus:"):
            rewritten.append(f"corpus: {HANDBOOK_CORPUS}")
            seen_corpus = True
            continue
        if stripped.startswith("collection:"):
            rewritten.append(f"collection: {HANDBOOK_COLLECTION}")
            seen_collection = True
            continue
        rewritten.append(line)
    if not seen_corpus:
        rewritten.append(f"corpus: {HANDBOOK_CORPUS}")
    if not seen_collection:
        rewritten.append(f"collection: {HANDBOOK_COLLECTION}")
    rewritten.append(frontmatter_lines[-1])
    return rewritten


def _frontmatter_title(frontmatter_lines: list[str]) -> str | None:
    for line in frontmatter_lines[1:-1]:
        key, separator, value = line.partition(":")
        if separator and key.strip() == "title":
            return value.strip().strip("'\"")
    return None


def _normalize_handbook_body(lines: list[str], *, title: str | None) -> list[str]:
    normalized: list[str] = []
    saw_chapter_heading = False
    pending_table_marker = False
    html_table_lines: list[str] = []
    heading_counts: dict[str, int] = {}

    for line in _iter_handbook_source_lines(lines):
        stripped = line.strip()

        if html_table_lines:
            html_table_lines.append(stripped)
            if "</table>" in stripped:
                _append_handbook_table_blocks(normalized, "\n".join(html_table_lines))
                html_table_lines = []
                pending_table_marker = False
            continue

        if not stripped:
            if normalized and normalized[-1] != "":
                normalized.append("")
            continue

        if stripped == "[表格]":
            pending_table_marker = True
            continue
        if stripped.startswith("<table"):
            html_table_lines = [stripped]
            if "</table>" in stripped:
                _append_handbook_table_blocks(normalized, "\n".join(html_table_lines))
                html_table_lines = []
                pending_table_marker = False
            continue
        if pending_table_marker:
            normalized.extend(["[表格]", ""])
            pending_table_marker = False

        heading_text = stripped.lstrip("#").strip()
        heading = _normalize_handbook_heading(
            stripped,
            title=title,
            saw_chapter_heading=saw_chapter_heading,
        )
        if heading is not None:
            if not heading:
                continue
            heading = _dedupe_handbook_heading(heading, heading_counts=heading_counts)
            if normalized and normalized[-1] != "":
                normalized.append("")
            normalized.extend([heading, ""])
            if _HANDBOOK_CHAPTER_HEADING_RE.fullmatch(heading_text):
                saw_chapter_heading = True
            continue

        if (
            normalized
            and normalized[-1] != ""
            and (
                _is_markdown_list_item(stripped)
                or (
                    _is_markdown_list_item(normalized[-1])
                    and not _is_markdown_list_item(stripped)
                )
            )
        ):
            normalized.append("")
        normalized.extend(_render_handbook_body_lines(line.rstrip()))

    while normalized and not normalized[-1]:
        normalized.pop()
    return normalized


def _normalize_handbook_heading(
    line: str,
    *,
    title: str | None,
    saw_chapter_heading: bool,
) -> str | None:
    text = line.removeprefix("#").strip()
    if line.startswith("#"):
        heading_text = line.lstrip("#").strip()
        if title and heading_text == title:
            return ""
        text = heading_text
    text = text.rstrip("：:；;，,。. ")
    if title and text == title:
        return ""
    if _HANDBOOK_CHAPTER_HEADING_RE.fullmatch(text):
        return f"## {text}"
    if _HANDBOOK_ARTICLE_HEADING_RE.fullmatch(text):
        return f"{'###' if saw_chapter_heading else '##'} {text}"
    return None if not line.startswith("#") else f"## {text}"


def _is_markdown_list_item(line: str) -> bool:
    return bool(_MARKDOWN_ORDERED_LIST_RE.match(line) or _MARKDOWN_UNORDERED_LIST_RE.match(line))


def _iter_handbook_source_lines(lines: list[str]):
    index = 0
    while index < len(lines):
        current = lines[index].rstrip()
        stripped = current.strip()
        if re.fullmatch(r"(?:\d+\.|[-*+])", stripped) and index + 1 < len(lines):
            next_line = lines[index + 1].strip()
            if next_line:
                yield f"{stripped} {next_line}"
                index += 2
                continue
        yield current
        index += 1


def _render_handbook_body_lines(line: str) -> list[str]:
    escaped_line = _escape_handbook_placeholder_underscores(line)
    escaped_line = _MARKDOWN_LIST_PREFIX_WITHOUT_SPACE_RE.sub(
        r"\g<marker> \g<rest>",
        escaped_line,
    )
    decimal_label_match = _MARKDOWN_DECIMAL_LABEL_RE.match(escaped_line)
    if decimal_label_match:
        escaped_label = decimal_label_match.group("label").replace(".", r"\.", 1)
        return _wrap_markdown_text_lines(f"{escaped_label}{decimal_label_match.group('rest')}")
    if _MARKDOWN_ORDERED_LIST_RE.match(escaped_line):
        _, _, content = escaped_line.partition(" ")
        return _wrap_markdown_text_lines(
            content,
            initial_prefix="1. ",
            subsequent_prefix="   ",
        )
    if _MARKDOWN_UNORDERED_LIST_RE.match(escaped_line):
        marker, _, content = escaped_line.partition(" ")
        return _wrap_markdown_text_lines(
            content,
            initial_prefix=f"{marker} ",
            subsequent_prefix=" " * (len(marker) + 1),
        )
    return _wrap_markdown_text_lines(escaped_line)


def _dedupe_handbook_heading(heading: str, *, heading_counts: dict[str, int]) -> str:
    marker, _, text = heading.partition(" ")
    if not marker or not text:
        return heading
    count = heading_counts.get(text, 0)
    heading_counts[text] = count + 1
    return heading


def _append_handbook_table_blocks(lines: list[str], html: str) -> None:
    if _should_preserve_handbook_table_as_html(html):
        if lines and lines[-1] != "":
            lines.append("")
        lines.extend([html.strip(), ""])
        return

    blocks = _convert_table_html_to_markdown_blocks(html)
    if any(block_type != "table" for block_type, _ in blocks):
        if lines and lines[-1] != "":
            lines.append("")
        lines.extend([html.strip(), ""])
        return
    if not blocks:
        if lines and lines[-1] != "":
            lines.append("")
        lines.extend([html.strip(), ""])
        return
    for block_type, block_text in blocks:
        if lines and lines[-1] != "":
            lines.append("")
        if block_type == "section_label":
            lines.append(f"### {block_text.rstrip('：:；;，,。. ')}")
        else:
            lines.extend(block_text.splitlines())
        lines.append("")


def _should_preserve_handbook_table_as_html(html: str) -> bool:
    parser = _TableHTMLParser()
    parser.feed(html)
    parser.close()
    rows = parser.rows
    if not rows:
        return False
    if len(rows) < 4:
        return False
    empty_cell_count = sum(1 for row in rows for cell in row if not cell.text)
    merged_cell_count = sum(
        1 for row in rows for cell in row if cell.rowspan > 1 or cell.colspan > 1
    )
    field_labels = {
        "姓名",
        "学号",
        "民族",
        "学院(系)",
        "专业",
        "学制",
        "出生年月日",
        "家庭所在地",
        "火车到站站名",
        "学院(系)领导签字",
    }
    field_like_label_count = 0
    for row in rows:
        for cell in row:
            label = re.sub(r"\s+", "", cell.text)
            if label in field_labels or label.startswith("照片"):
                field_like_label_count += 1
    return empty_cell_count >= 3 and merged_cell_count >= 1 and field_like_label_count >= 4


def _escape_handbook_placeholder_underscores(line: str) -> str:
    return line.replace("___", r"\_\_\_")


class _TableHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.rows: list[list[_TableCell]] = []
        self._current_row: list[_TableCell] | None = None
        self._cell_parts: list[str] = []
        self._cell_rowspan = 1
        self._cell_colspan = 1
        self._in_cell = False

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "tr":
            self._current_row = []
            return
        if tag not in {"td", "th"}:
            if self._in_cell and tag == "br":
                self._cell_parts.append("\n")
            return
        attr_map = dict(attrs)
        self._cell_parts = []
        self._cell_rowspan = _parse_positive_int(attr_map.get("rowspan"))
        self._cell_colspan = _parse_positive_int(attr_map.get("colspan"))
        self._in_cell = True

    def handle_endtag(self, tag: str) -> None:
        if tag in {"td", "th"} and self._in_cell:
            text = _normalize_table_cell_text("".join(self._cell_parts))
            if self._current_row is not None:
                self._current_row.append(
                    _TableCell(
                        text=text,
                        rowspan=self._cell_rowspan,
                        colspan=self._cell_colspan,
                    )
                )
            self._in_cell = False
            return
        if tag == "tr" and self._current_row is not None:
            if self._current_row:
                self.rows.append(self._current_row)
            self._current_row = None

    def handle_data(self, data: str) -> None:
        if self._in_cell:
            self._cell_parts.append(data)


def _parse_positive_int(value: str | None) -> int:
    try:
        parsed = int(value or "1")
    except ValueError:
        return 1
    return parsed if parsed > 0 else 1


def _normalize_table_cell_text(text: str) -> str:
    normalized = text.replace("\xa0", " ")
    normalized = re.sub(r"\s+", " ", normalized)
    return normalized.strip()


def _convert_table_html_to_markdown_blocks(html: str) -> list[tuple[str, str]]:
    parser = _TableHTMLParser()
    parser.feed(html)
    parser.close()
    grid = _expand_table_rows(parser.rows)
    if not grid:
        return []

    blocks: list[tuple[str, str]] = []
    header_row: list[str] | None = None
    current_table: list[list[str]] = []
    for row in grid:
        trimmed_row = _trim_trailing_empty_cells(row)
        if not any(trimmed_row):
            continue
        if _is_section_row(trimmed_row):
            if current_table and not (
                header_row is not None
                and len(current_table) == 1
                and current_table[0] == header_row
            ):
                blocks.append(("table", _render_markdown_table(current_table)))
            current_table = [list(header_row)] if header_row is not None else []
            blocks.append(("section_label", trimmed_row[0]))
            continue
        if header_row is None:
            header_row = list(trimmed_row)
            current_table = [list(header_row)]
            continue
        if not current_table:
            current_table = [list(header_row)]
        current_table.append(trimmed_row)
    if current_table and not (
        header_row is not None and len(current_table) == 1 and current_table[0] == header_row
    ):
        blocks.extend(_render_table_blocks(current_table))
    return blocks


def _expand_table_rows(rows: list[list[_TableCell]]) -> list[list[str]]:
    active_rowspans: dict[int, tuple[str, int]] = {}
    expanded_rows: list[list[str]] = []
    max_width = 0

    for source_row in rows:
        expanded_row: list[str] = []
        column_index = 0

        def consume_active_rowspans(row: list[str] = expanded_row) -> None:
            nonlocal column_index
            while column_index in active_rowspans:
                text, remaining = active_rowspans[column_index]
                row.append(text)
                if remaining <= 1:
                    del active_rowspans[column_index]
                else:
                    active_rowspans[column_index] = (text, remaining - 1)
                column_index += 1

        consume_active_rowspans()
        for cell in source_row:
            consume_active_rowspans()
            for offset in range(cell.colspan):
                expanded_row.append(cell.text)
                if cell.rowspan > 1:
                    active_rowspans[column_index + offset] = (cell.text, cell.rowspan - 1)
            column_index += cell.colspan
        consume_active_rowspans()
        max_width = max(max_width, len(expanded_row))
        expanded_rows.append(expanded_row)

    for row in expanded_rows:
        row.extend([""] * (max_width - len(row)))
    return expanded_rows


def _trim_trailing_empty_cells(row: list[str]) -> list[str]:
    trimmed = list(row)
    while trimmed and not trimmed[-1]:
        trimmed.pop()
    return trimmed


def _is_section_row(row: list[str]) -> bool:
    nonempty = [cell for cell in row if cell]
    if len(nonempty) < 2 or len(set(nonempty)) != 1:
        return False
    return not bool(re.fullmatch(r"[（(]?[0-9一二三四五六七八九十]+[)）]?", nonempty[0]))


def _render_markdown_table(rows: list[list[str]]) -> str:
    width = max(len(row) for row in rows)
    normalized_rows = [row + [""] * (width - len(row)) for row in rows]
    if len(normalized_rows) == 1:
        return (
            "|" + "|".join(_escape_markdown_cell(cell) for cell in normalized_rows[0] if cell) + "|"
        )

    header = normalized_rows[0]
    separator = ["---"] * width
    lines = [_render_markdown_row(header), _render_markdown_row(separator)]
    lines.extend(_render_markdown_row(row) for row in normalized_rows[1:])
    return "\n".join(lines)


def _render_markdown_row(row: list[str]) -> str:
    return "|" + "|".join(_escape_markdown_cell(cell) for cell in row) + "|"


def _escape_markdown_cell(text: str) -> str:
    return text.replace("\\", "\\\\").replace("|", "\\|")


def _render_table_blocks(rows: list[list[str]]) -> list[tuple[str, str]]:
    if any(len(_render_markdown_row(row)) > _MARKDOWN_LINE_LIMIT for row in rows):
        return [("block", _render_markdown_records(rows))]
    return [("table", _render_markdown_table(rows))]


def _render_markdown_records(rows: list[list[str]]) -> str:
    if len(rows) < 2:
        return _render_markdown_table(rows)

    headers = rows[0]
    records: list[str] = []
    for row in rows[1:]:
        record_lines: list[str] = []
        first_field = True
        for header, value in _iter_markdown_record_entries(headers=headers, row=row):
            label = f"{header}：" if header else ""
            if first_field:
                record_lines.extend(
                    _wrap_markdown_text_lines(
                        f"{label}{value}",
                        initial_prefix="- ",
                        subsequent_prefix="  ",
                    )
                )
                first_field = False
            else:
                record_lines.extend(
                    _wrap_markdown_text_lines(
                        f"{label}{value}",
                        initial_prefix="  - ",
                        subsequent_prefix="    ",
                    )
                )
        if record_lines:
            records.append("\n".join(record_lines))
    return "\n\n".join(records)


def _iter_markdown_record_entries(*, headers: list[str], row: list[str]) -> list[tuple[str, str]]:
    compacted_course_entries = _compact_curriculum_course_colspan_entries(
        headers=headers,
        row=row,
    )
    if compacted_course_entries is not None:
        return compacted_course_entries

    entries: list[tuple[str, str]] = []
    for index, cell in enumerate(row):
        value = _normalize_markdown_record_value(cell)
        if not value:
            continue
        header = headers[index].strip() if index < len(headers) else ""
        entries.append((header, value))
    return entries


def _compact_curriculum_course_colspan_entries(
    *,
    headers: list[str],
    row: list[str],
) -> list[tuple[str, str]] | None:
    normalized_headers = [header.strip() for header in headers]
    if normalized_headers[:8] != [
        "课程类",
        "课程号",
        "课程名称",
        "学分",
        "学时",
        "实践学时",
        "开设学期",
        "备注",
    ]:
        return None

    values = [_normalize_markdown_record_value(cell) for cell in row]
    if len(values) < 7 or not values[0]:
        return None

    merged_value = values[1]
    if not merged_value:
        return None
    merged_cells = values[1:7]
    if len(merged_cells) != 6 or merged_cells != [merged_value] * 6:
        return None

    entries: list[tuple[str, str]] = [("课程类", values[0]), ("课程名称", merged_value)]
    if len(values) > 7 and values[7]:
        entries.append(("备注", values[7]))
    return entries


def _normalize_markdown_record_value(value: str) -> str:
    normalized = value.strip()
    if normalized == "学校通开的全球胜任力培养课程/":
        return "学校通开的全球胜任力培养课程"
    return normalized
