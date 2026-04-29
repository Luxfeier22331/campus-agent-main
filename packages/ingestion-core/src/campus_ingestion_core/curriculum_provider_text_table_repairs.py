from __future__ import annotations

import re
from html import escape

from campus_ingestion_core.source_truth_common import (
    extract_html_table_cells,
    infer_table_row_count,
    normalize_text,
)

_TABLE_HTML_RE = re.compile(r"<table\b[^>]*>.*?</table>", re.IGNORECASE | re.DOTALL)
_TABLE_ROW_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.IGNORECASE | re.DOTALL)
_SPLIT_EMPTY_LEADER_TABLE_ROW_RE = re.compile(
    r"<td>(?P<head>[^<]{2,120})</td></tr>"
    r"<tr>(?P<empty_cells>(?:<td(?:\s+[^>]*)?>\s*</td>){1,3})"
    r"<td>(?P<tail>[^<]{1,200})</td></tr>"
)


def _extract_table_cells(html: str) -> list[dict[str, object]] | None:
    return extract_html_table_cells(html)


def _repair_table_category_rowspan_continuations(text: str) -> str:
    if "<table" not in text:
        return text
    return _TABLE_HTML_RE.sub(
        lambda match: _repair_single_table_category_rowspan_continuations(match.group(0)),
        text,
    )


def _repair_single_table_category_rowspan_continuations(table_html: str) -> str:
    table_cells = _extract_table_cells(table_html)
    if not table_cells:
        return table_html

    repaired_cells = [dict(cell) for cell in table_cells]
    changed = False
    while True:
        repaired_cells.sort(key=lambda cell: (int(cell.get("row") or 0), int(cell.get("col") or 0)))
        merged_in_pass = False
        for current in list(repaired_cells):
            if not _is_category_rowspan_continuation_candidate(current):
                continue
            previous = _find_previous_adjacent_category_cell(repaired_cells, current)
            if previous is None:
                continue
            if not _should_merge_category_rowspan_continuation(previous=previous, current=current):
                continue
            previous_row = int(previous.get("row") or 0)
            previous_end = _cell_end_row(previous)
            current_end = _cell_end_row(current)
            merged_text = _merge_category_rowspan_continuation_text(
                previous_text=normalize_text(str(previous.get("text") or "")),
                current_text=normalize_text(str(current.get("text") or "")),
            )
            if merged_text is not None:
                previous["text"] = merged_text
            previous["rowspan"] = max(previous_end, current_end) - previous_row + 1
            repaired_cells.remove(current)
            changed = True
            merged_in_pass = True
            break
        if not merged_in_pass:
            break

    if not changed:
        return table_html
    return _serialize_table_cells_as_td_html(repaired_cells)


def _is_category_rowspan_continuation_candidate(cell: dict[str, object]) -> bool:
    row = int(cell.get("row") or 0)
    col = int(cell.get("col") or 0)
    if row <= 1 or col not in {1, 2} or bool(cell.get("is_header")):
        return False
    text = normalize_text(str(cell.get("text") or ""))
    rowspan = int(cell.get("rowspan") or 1)
    colspan = int(cell.get("colspan") or 1)
    if not text:
        return rowspan > 1 or colspan > 1
    return True


def _find_previous_adjacent_category_cell(
    cells: list[dict[str, object]], current: dict[str, object]
) -> dict[str, object] | None:
    current_row = int(current.get("row") or 0)
    current_col = int(current.get("col") or 0)
    current_colspan = int(current.get("colspan") or 1)
    candidates = [
        cell
        for cell in cells
        if cell is not current
        and int(cell.get("col") or 0) == current_col
        and int(cell.get("colspan") or 1) == current_colspan
        and _cell_end_row(cell) == current_row - 1
        and normalize_text(str(cell.get("text") or ""))
        and not bool(cell.get("is_header"))
    ]
    if not candidates:
        return None
    return max(candidates, key=lambda cell: int(cell.get("row") or 0))


def _should_merge_category_rowspan_continuation(
    *, previous: dict[str, object], current: dict[str, object]
) -> bool:
    previous_text = normalize_text(str(previous.get("text") or ""))
    current_text = normalize_text(str(current.get("text") or ""))
    if not previous_text:
        return False
    if int(current.get("col") or 0) == 2 and not previous_text.startswith("模块"):
        return False
    if not current_text:
        return True
    if (
        _merge_category_rowspan_continuation_text(
            previous_text=previous_text,
            current_text=current_text,
        )
        is not None
    ):
        return True
    if current_text != previous_text:
        return False
    return (
        int(previous.get("rowspan") or 1) > 1
        or int(current.get("rowspan") or 1) > 1
        or int(previous.get("colspan") or 1) > 1
        or int(current.get("colspan") or 1) > 1
    )


def _merge_category_rowspan_continuation_text(
    *,
    previous_text: str,
    current_text: str,
) -> str | None:
    if not previous_text or not current_text:
        return None
    if previous_text == "跨学科" and current_text == "交叉课程":
        return "跨学科交叉课程"
    if not _has_unclosed_parenthetical(previous_text):
        return None
    if not _has_closing_parenthetical(current_text):
        return None
    return f"{previous_text}{_joiner_between(previous_text, current_text)}{current_text}"


def _has_unclosed_parenthetical(text: str) -> bool:
    return text.count("(") > text.count(")") or text.count("（") > text.count("）")


def _has_closing_parenthetical(text: str) -> bool:
    return ")" in text or "）" in text


def _cell_end_row(cell: dict[str, object]) -> int:
    return int(cell.get("row") or 0) + int(cell.get("rowspan") or 1) - 1


def _normalize_table_body_header_cells(text: str) -> str:
    if "<th" not in text.lower() or "<table" not in text.lower():
        return text
    return _TABLE_HTML_RE.sub(
        lambda match: _normalize_single_table_body_header_cells(match.group(0)),
        text,
    )


def _normalize_single_table_body_header_cells(table_html: str) -> str:
    row_matches = list(_TABLE_ROW_RE.finditer(table_html))
    if len(row_matches) <= 1:
        return table_html
    chunks: list[str] = []
    cursor = 0
    for row_index, row_match in enumerate(row_matches):
        chunks.append(table_html[cursor : row_match.start()])
        row_html = row_match.group(0)
        if row_index > 0:
            row_html = re.sub(r"<th(\b[^>]*)>", r"<td\1>", row_html, flags=re.IGNORECASE)
            row_html = re.sub(r"</th>", "</td>", row_html, flags=re.IGNORECASE)
        chunks.append(row_html)
        cursor = row_match.end()
    chunks.append(table_html[cursor:])
    return "".join(chunks)


def _serialize_table_cells_as_td_html(table_cells: list[dict[str, object]]) -> str:
    row_count = infer_table_row_count(table_cells) or 0
    if row_count <= 0:
        return "<table></table>"
    cells_by_row: dict[int, list[dict[str, object]]] = {}
    for cell in table_cells:
        row_number = int(cell.get("row") or 0)
        if row_number <= 0:
            continue
        cells_by_row.setdefault(row_number, []).append(cell)

    html_rows: list[str] = []
    for row_number in range(1, row_count + 1):
        rendered_cells: list[str] = []
        for cell in sorted(
            cells_by_row.get(row_number, ()), key=lambda item: int(item.get("col") or 0)
        ):
            attrs: list[str] = []
            rowspan = int(cell.get("rowspan") or 1)
            colspan = int(cell.get("colspan") or 1)
            if rowspan > 1:
                attrs.append(f' rowspan="{rowspan}"')
            if colspan > 1:
                attrs.append(f' colspan="{colspan}"')
            rendered_cells.append(
                f"<td{''.join(attrs)}>{escape(str(cell.get('text') or ''), quote=False)}</td>"
            )
        html_rows.append(f"<tr>{''.join(rendered_cells)}</tr>")
    return f"<table>{''.join(html_rows)}</table>"


def _repair_split_table_cell_continuations(text: str) -> str:
    if "<table" not in text:
        return text

    def replace(match: re.Match[str]) -> str:
        head = match.group("head").strip()
        tail = match.group("tail").strip()
        if not _should_merge_split_table_cell_continuation(head=head, tail=tail):
            return match.group(0)
        return f"<td>{head}{_joiner_between(head, tail)}{tail}</td></tr>"

    return _SPLIT_EMPTY_LEADER_TABLE_ROW_RE.sub(replace, text)


def _should_merge_split_table_cell_continuation(*, head: str, tail: str) -> bool:
    if not head or not tail:
        return False
    if head.endswith(("。", "！", "？", "；", ":", "：", ".", "!", "?", ";")):
        return False
    if re.match(r"^(?:[0-9A-Za-z]+|[一二三四五六七八九十]+[、.]|[（(])", tail):
        return False
    return any(char.isalpha() or "\u4e00" <= char <= "\u9fff" for char in tail)


def _joiner_between(previous: str, current: str) -> str:
    previous_tail = previous.rstrip()
    current_head = current.lstrip()
    if not previous_tail or not current_head:
        return ""
    if (
        previous_tail[-1].isascii()
        and previous_tail[-1].isalnum()
        and current_head[0].isascii()
        and current_head[0].isalnum()
    ):
        return " "
    return ""
