from __future__ import annotations

import hashlib
import json
import re
import unicodedata
from html import unescape
from typing import Mapping, Sequence

_TABLE_HEADER_HINTS = frozenset(
    {
        "项目",
        "说明",
        "单位名称",
        "电话号码",
        "姓名",
        "学院",
        "学号",
        "类别",
        "标准",
        "金额",
        "课程",
        "学分",
    }
)
_TERMINAL_SENTENCE_ENDINGS = ("。", "！", "？", "；", ":", "：")
_CONTINUATION_ENDINGS = ("，", ",", "、", "（", "(", "及", "与", "和")
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_TABLE_ROW_RE = re.compile(r"<tr[^>]*>(.*?)</tr>", re.IGNORECASE | re.DOTALL)
_TABLE_CELL_RE = re.compile(r"<(td|th)\b([^>]*)>(.*?)</\1>", re.IGNORECASE | re.DOTALL)
_SPAN_ATTR_RE = re.compile(r"""\b(rowspan|colspan)\s*=\s*["']?(\d+)["']?""", re.IGNORECASE)


def serialize_layout_rows(rows: list[dict[str, object]]) -> bytes:
    return ("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n").encode("utf-8")


def normalize_text(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text.replace("\r\n", "\n").replace("\r", "\n"))
    output_lines: list[str] = []
    previous_blank = False
    for raw_line in normalized.split("\n"):
        collapsed = " ".join(raw_line.split()).strip()
        if not collapsed:
            if output_lines and not previous_blank:
                output_lines.append("")
            previous_blank = True
            continue
        output_lines.append(collapsed)
        previous_blank = False
    while output_lines and output_lines[0] == "":
        output_lines.pop(0)
    while output_lines and output_lines[-1] == "":
        output_lines.pop()
    return "\n".join(output_lines)


def normalize_bbox(value: object) -> list[float] | None:
    if (
        isinstance(value, list)
        and value
        and all(isinstance(item, (list, tuple)) and len(item) >= 2 for item in value)
    ):
        xs = [float(item[0]) for item in value if isinstance(item[0], (int, float))]
        ys = [float(item[1]) for item in value if isinstance(item[1], (int, float))]
        if xs and ys:
            return [min(xs), min(ys), max(xs), max(ys)]
    if not isinstance(value, list):
        return None
    normalized: list[float] = []
    for item in value:
        if isinstance(item, (int, float)):
            normalized.append(float(item))
    return normalized or None


def infer_list_level_hint(text: str) -> int | None:
    stripped = text.lstrip()
    if not stripped or stripped.startswith(("第",)):
        return None
    if stripped[:1].isdigit() and len(stripped) > 1 and stripped[1] in {".", "、"}:
        return 1
    if stripped.startswith(("（", "(")) and len(stripped) > 2:
        return 2
    if stripped[:1] in "一二三四五六七八九十" and len(stripped) > 1 and stripped[1] == "、":
        return 1
    return None


def infer_table_header_rows(table_cells: object) -> object:
    if (
        isinstance(table_cells, list)
        and table_cells
        and all(isinstance(row, list) for row in table_cells)
    ):
        first_row = table_cells[0]
        if all(isinstance(cell, str) for cell in first_row):
            if all(cell in _TABLE_HEADER_HINTS for cell in first_row):
                return [first_row]
            if all(cell and len(cell) <= 12 for cell in first_row):
                return [first_row]
    if (
        isinstance(table_cells, list)
        and table_cells
        and all(isinstance(cell, dict) for cell in table_cells)
    ):
        header_cells = [
            cell
            for cell in table_cells
            if bool(cell.get("is_header")) and int(cell.get("row") or 0) == 1
        ]
        if header_cells:
            return [
                [
                    str(cell.get("text") or "")
                    for cell in sorted(header_cells, key=lambda item: int(item.get("col") or 0))
                ]
            ]
    return None


def infer_table_row_count(table_cells: object) -> int | None:
    if (
        isinstance(table_cells, list)
        and table_cells
        and all(isinstance(row, list) for row in table_cells)
    ):
        return len(table_cells)
    if (
        isinstance(table_cells, list)
        and table_cells
        and all(isinstance(cell, dict) for cell in table_cells)
    ):
        return max((int(cell.get("row") or 0) for cell in table_cells), default=0) or None
    return None


def infer_table_column_count(table_cells: object) -> int | None:
    if (
        isinstance(table_cells, list)
        and table_cells
        and all(isinstance(row, list) for row in table_cells)
    ):
        return max((len(row) for row in table_cells), default=0) or None
    if (
        isinstance(table_cells, list)
        and table_cells
        and all(isinstance(cell, dict) for cell in table_cells)
    ):
        return (
            max(
                (
                    int(cell.get("col") or 0) + int(cell.get("colspan") or 1) - 1
                    for cell in table_cells
                ),
                default=0,
            )
            or None
        )
    return None


def detect_merged_cells(table_cells: object) -> bool | None:
    if (
        isinstance(table_cells, list)
        and table_cells
        and all(isinstance(row, list) for row in table_cells)
    ):
        widths = {len(row) for row in table_cells}
        return len(widths) > 1
    if (
        isinstance(table_cells, list)
        and table_cells
        and all(isinstance(cell, dict) for cell in table_cells)
    ):
        return any(
            int(cell.get("rowspan") or 1) > 1 or int(cell.get("colspan") or 1) > 1
            for cell in table_cells
        )
    if table_cells is None:
        return None
    return False


def position_band(bbox: object) -> str | None:
    if not isinstance(bbox, list) or len(bbox) < 4:
        return None
    top = float(bbox[1])
    bottom = float(bbox[3])
    if top <= 120:
        return "top"
    if top >= 850 or bottom >= 980:
        return "bottom"
    return "middle"


def is_top_band(*, bbox: list[float] | None, page_height: float | None = None) -> bool:
    if not bbox or len(bbox) < 4:
        return False
    top = float(bbox[1])
    if page_height is not None and page_height > 0:
        return top <= page_height * 0.12
    return top <= 120


def is_bottom_band(*, bbox: list[float] | None, page_height: float | None = None) -> bool:
    if not bbox or len(bbox) < 4:
        return False
    top = float(bbox[1])
    bottom = float(bbox[3])
    if page_height is not None and page_height > 0:
        return top >= page_height * 0.8 or bottom >= page_height * 0.88
    return top >= 850 or bottom >= 980


def enrich_repeated_candidates(rows: list[dict[str, object]]) -> None:
    clusters: dict[tuple[str, str], list[dict[str, object]]] = {}
    for row in rows:
        text = str(row.get("text_normalized") or "").strip()
        if not text:
            continue
        band = position_band(row.get("bbox"))
        if band not in {"top", "bottom"}:
            continue
        clusters.setdefault((text, band), []).append(row)
    for (text, band), members in clusters.items():
        if len(members) < 2 or len(text) > 24:
            continue
        cluster_id = hashlib.sha1(f"{band}:{text}".encode("utf-8")).hexdigest()[:12]
        for row in members:
            row["repeat_cluster_id"] = cluster_id
            row["repeat_frequency"] = len(members)
            row["repeat_position_band"] = band
            row["is_repeated_candidate"] = True


def enrich_parent_heading_hints(rows: list[dict[str, object]]) -> None:
    current_heading: str | None = None
    current_page: int | None = None
    for row in rows:
        if bool(row.get("is_repeated_candidate")):
            continue
        page = _coerce_int(row.get("page_start"))
        if current_page != page:
            current_page = page
        if str(row.get("row_type") or "") == "heading":
            current_heading = str(row.get("text_normalized") or "").strip() or None
            continue
        row["parent_heading_hint"] = current_heading


def enrich_cross_page_continuations(
    rows: list[dict[str, object]],
    *,
    textual_row_types: tuple[str, ...] = ("paragraph", "list_item"),
) -> None:
    page_first_textual: dict[int, dict[str, object]] = {}
    page_last_textual: dict[int, dict[str, object]] = {}
    for row in rows:
        if bool(row.get("is_repeated_candidate")):
            continue
        row_type = str(row.get("row_type") or "")
        if row_type not in textual_row_types:
            continue
        text = str(row.get("text_normalized") or "").strip()
        if not text:
            continue
        page = _coerce_int(row.get("page_start"))
        if page is None:
            continue
        page_first_textual.setdefault(page, row)
        page_last_textual[page] = row
    for page, last_row in page_last_textual.items():
        next_row = page_first_textual.get(page + 1)
        if next_row is None:
            continue
        if looks_like_cross_page_continuation(
            current_text=str(last_row.get("text_normalized") or "").strip(),
            next_text=str(next_row.get("text_normalized") or "").strip(),
        ):
            last_row["continues_to_next_page"] = True
            next_row["continues_from_previous_page"] = True


def looks_like_cross_page_continuation(*, current_text: str, next_text: str) -> bool:
    if not current_text or not next_text:
        return False
    if current_text.endswith(_TERMINAL_SENTENCE_ENDINGS):
        return False
    if current_text.endswith(_CONTINUATION_ENDINGS):
        return True
    if len(current_text) >= 8 and not next_text.startswith(("第", "附件", "附表")):
        return True
    return False


def extract_html_table_grid(html: str) -> list[list[str]] | None:
    if not html:
        return None
    row_matches = _TABLE_ROW_RE.findall(html)
    if not row_matches:
        return None
    table_rows: list[list[str]] = []
    for row_html in row_matches:
        normalized_cells = [
            normalize_text(unescape(_HTML_TAG_RE.sub(" ", cell_html)))
            for _, _, cell_html in _TABLE_CELL_RE.findall(row_html)
        ]
        normalized_cells = [cell for cell in normalized_cells if cell]
        if normalized_cells:
            table_rows.append(normalized_cells)
    return table_rows or None


def extract_html_table_cells(html: str) -> list[dict[str, object]] | None:
    if not html:
        return None
    row_matches = list(_TABLE_ROW_RE.finditer(html))
    if not row_matches:
        return None

    cells: list[dict[str, object]] = []
    occupied: dict[int, int] = {}
    for row_number, row_match in enumerate(row_matches, start=1):
        current_occupied = {
            col: remaining - 1 for col, remaining in occupied.items() if remaining > 1
        }
        col_number = 1
        row_cells = list(_TABLE_CELL_RE.finditer(row_match.group(1)))
        if not row_cells:
            occupied = current_occupied
            continue
        for cell_match in row_cells:
            while col_number in current_occupied:
                col_number += 1
            tag_name = cell_match.group(1).lower()
            attr_text = cell_match.group(2) or ""
            cell_html = cell_match.group(3) or ""
            text = normalize_text(unescape(_HTML_TAG_RE.sub(" ", cell_html)))
            spans = {
                match.group(1).lower(): int(match.group(2))
                for match in _SPAN_ATTR_RE.finditer(attr_text)
            }
            rowspan = spans.get("rowspan", 1)
            colspan = spans.get("colspan", 1)
            cells.append(
                {
                    "row": row_number,
                    "col": col_number,
                    "text": text,
                    "rowspan": rowspan,
                    "colspan": colspan,
                    "is_header": tag_name == "th" or row_number == 1,
                }
            )
            if rowspan > 1:
                for occupied_col in range(col_number, col_number + colspan):
                    current_occupied[occupied_col] = rowspan
            col_number += colspan
        occupied = current_occupied
    return cells or None


def build_position_preserving_table_rows(
    *,
    html: str | None = None,
    table_cells: object = None,
    fallback_text: str | None = None,
) -> tuple[tuple[str, ...], ...]:
    if isinstance(table_cells, list) and table_cells:
        if all(isinstance(cell, dict) for cell in table_cells):
            dense_rows = _build_dense_rows_from_cell_records(table_cells)
            if dense_rows:
                return dense_rows
        if all(isinstance(row, list) for row in table_cells):
            normalized_rows = _normalize_dense_rows(
                tuple(tuple(normalize_text(str(cell)) for cell in row) for row in table_cells)
            )
            if normalized_rows:
                return normalized_rows
    if html:
        html_cells = extract_html_table_cells(html)
        if html_cells:
            dense_rows = _build_dense_rows_from_cell_records(html_cells)
            if dense_rows:
                return dense_rows
    if fallback_text:
        return _extract_pipe_delimited_rows(fallback_text)
    return ()


def _build_dense_rows_from_cell_records(
    table_cells: Sequence[Mapping[str, object]],
) -> tuple[tuple[str, ...], ...]:
    row_count = infer_table_row_count(list(table_cells)) or 0
    column_count = infer_table_column_count(list(table_cells)) or 0
    if row_count <= 0 or column_count <= 0:
        return ()
    grid = [["" for _ in range(column_count)] for _ in range(row_count)]
    for cell in sorted(
        table_cells,
        key=lambda item: (int(item.get("row") or 0), int(item.get("col") or 0)),
    ):
        row_index = int(cell.get("row") or 0) - 1
        column_index = int(cell.get("col") or 0) - 1
        if row_index < 0 or column_index < 0:
            continue
        if row_index >= row_count or column_index >= column_count:
            continue
        grid[row_index][column_index] = normalize_text(str(cell.get("text") or ""))
    return _normalize_dense_rows(tuple(tuple(row) for row in grid))


def _extract_pipe_delimited_rows(text: str) -> tuple[tuple[str, ...], ...]:
    raw_rows = tuple(
        tuple(normalize_text(cell) for cell in line.split("|"))
        for line in re.split(r"[\r\n]+", text)
        if "|" in line
    )
    return _normalize_dense_rows(raw_rows)


def _normalize_dense_rows(rows: Sequence[Sequence[str]]) -> tuple[tuple[str, ...], ...]:
    if not rows:
        return ()
    width = max((len(row) for row in rows), default=0)
    if width <= 0:
        return ()
    normalized_rows: list[tuple[str, ...]] = []
    for row in rows:
        padded = tuple(
            str(row[index]).strip() if index < len(row) else "" for index in range(width)
        )
        if any(cell for cell in padded):
            normalized_rows.append(padded)
    return tuple(normalized_rows)


def _coerce_int(value: object) -> int | None:
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    if isinstance(value, str) and value.strip():
        return int(value)
    return None
