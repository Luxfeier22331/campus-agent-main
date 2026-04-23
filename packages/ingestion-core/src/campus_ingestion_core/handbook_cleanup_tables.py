from __future__ import annotations

import re
from html.parser import HTMLParser

from campus_ingestion_core.handbook_cleanup_normalize import normalize_handbook_body_text
from campus_ingestion_core.handbook_cleanup_policy import (
    _looks_like_appendix_heading,
    _looks_like_appendix_marker_only,
    _looks_like_attachment_title_text,
    _looks_like_list_entry,
    _normalize_policy_page_table_context,
    _split_article_line,
)
from campus_ingestion_core.handbook_cleanup_shared import (
    DECORATIVE_TABLE_KEYWORDS,
    FORM_COVER_KEYWORDS,
    FORM_TABLE_CAPTION_KEYWORDS,
    FORM_TABLE_CHECKBOX_MARKERS,
    FORM_TABLE_FIELD_KEYWORDS,
    FORM_TABLE_SECTION_KEYWORDS,
    FORM_TABLE_SIGNATURE_KEYWORDS,
    GENERIC_TABLE_PROJECT_LABEL,
    LEAF_SECTION_PUNCTUATION_RE,
    LIST_ENTRY_PHONE_RE,
    PHONE_GROUP_HEADINGS,
    PHONE_GROUP_KEYWORDS,
    PHONE_HEADER_LABELS,
    TABLE_CONTEXT_INTRO_PHRASES,
    NormalizedHandbookTable,
)
from campus_ingestion_core.handbook_structure import classify_structural_heading


def _normalize_table_matrix(*, html: object, table_cells: object) -> list[list[str]] | None:
    html_matrix = _parse_html_table_matrix(html) if isinstance(html, str) and html.strip() else None
    cell_matrix = _normalize_table_cells_matrix(table_cells)
    if html_matrix and cell_matrix:
        return (
            html_matrix
            if _matrix_information_score(html_matrix) >= _matrix_information_score(cell_matrix)
            else cell_matrix
        )
    return html_matrix or cell_matrix


def _normalize_table_cells_matrix(table_cells: object) -> list[list[str]] | None:
    if not isinstance(table_cells, list):
        return None
    normalized_rows: list[list[str]] = []
    max_width = 0
    for row in table_cells:
        if not isinstance(row, list):
            continue
        normalized_row = [str(cell) for cell in row]
        normalized_rows.append(normalized_row)
        max_width = max(max_width, len(normalized_row))
    if max_width == 0:
        return None
    return [row + [""] * (max_width - len(row)) for row in normalized_rows]


def _build_table_unit_semantics(
    *,
    table_cells: list[list[str]] | None,
    table_context: object,
) -> NormalizedHandbookTable | None:
    if not table_cells:
        return None
    normalized_matrix = [
        tuple(normalize_handbook_body_text(cell) for cell in row) for row in table_cells
    ]
    caption_text = (
        normalize_handbook_body_text(str(table_context)) if isinstance(table_context, str) else ""
    )
    if _looks_like_form_table(normalized_matrix, caption_text=caption_text):
        return None
    header_row_count = _detect_table_header_row_count([list(row) for row in normalized_matrix])
    header_rows = tuple(normalized_matrix[:header_row_count])
    body_rows = tuple(normalized_matrix[header_row_count:])
    selected_columns = _select_semantic_table_columns(header_rows=header_rows, body_rows=body_rows)
    if not selected_columns:
        return None
    filtered_header_rows = tuple(
        tuple(row[column_index] for column_index in selected_columns) for row in header_rows
    )
    filtered_body_rows = tuple(
        tuple(row[column_index] for column_index in selected_columns) for row in body_rows
    )
    filtered_body_rows = _merge_split_table_group_labels(filtered_body_rows)
    column_paths = _build_table_column_paths(
        header_rows=filtered_header_rows or (tuple(filtered_body_rows[0]),),
        body_rows=filtered_body_rows,
    )
    header_line = " | ".join(column_paths)
    row_lines = tuple(
        " | ".join(row) for row in filtered_body_rows if any(cell.strip() for cell in row)
    )
    if not row_lines:
        return None
    caption_lines = (caption_text,) if caption_text else ()
    return NormalizedHandbookTable(
        matrix=(*filtered_header_rows, *filtered_body_rows),
        header_rows=filtered_header_rows,
        body_rows=filtered_body_rows,
        column_paths=column_paths,
        header_line=header_line,
        row_lines=row_lines,
        caption_lines=caption_lines,
        note_lines=(),
    )


def _detect_table_header_row_count(table_matrix: list[list[str]]) -> int:
    if not table_matrix:
        return 0
    if len(table_matrix) == 1:
        return 1
    first_row = table_matrix[0]
    second_row = table_matrix[1]
    if _looks_like_header_continuation_row(first_row, second_row):
        return 2
    return 1


def _looks_like_header_continuation_row(first_row: list[str], second_row: list[str]) -> bool:
    first_non_empty = [cell.strip() for cell in first_row if cell.strip()]
    second_non_empty = [cell.strip() for cell in second_row if cell.strip()]
    if not first_non_empty or not second_non_empty:
        return False
    if _row_looks_like_numeric_payload(second_non_empty):
        return False
    first_form_prompt_count = sum(
        1
        for cell in first_non_empty
        if _contains_form_table_signature_keyword(cell) or _contains_decorative_table_keyword(cell)
    )
    second_field_like_count = sum(
        1 for cell in second_non_empty if len(cell) <= 10 or _contains_form_table_keyword(cell)
    )
    if first_form_prompt_count >= 2 and second_field_like_count >= max(
        2, len(second_non_empty) - 1
    ):
        return True
    first_has_duplicate_labels = len(set(first_non_empty)) < len(first_non_empty)
    second_short_label_count = sum(1 for cell in second_non_empty if len(cell) <= 8)
    return first_has_duplicate_labels and second_short_label_count == len(second_non_empty)


def _row_looks_like_numeric_payload(cells: list[str]) -> bool:
    numeric_like = 0
    for cell in cells:
        normalized = normalize_handbook_body_text(cell)
        if not normalized:
            continue
        if LIST_ENTRY_PHONE_RE.search(normalized) or re.search(r"\d", normalized):
            numeric_like += 1
    return numeric_like >= max(1, len(cells) // 2)


def _select_semantic_table_columns(
    *,
    header_rows: tuple[tuple[str, ...], ...],
    body_rows: tuple[tuple[str, ...], ...],
) -> tuple[int, ...]:
    width = max((len(row) for row in (*header_rows, *body_rows)), default=0)
    selected: list[int] = []
    for column_index in range(width):
        header_labels = tuple(
            row[column_index].strip()
            for row in header_rows
            if column_index < len(row) and row[column_index].strip()
        )
        column_values = tuple(
            row[column_index].strip()
            for row in body_rows
            if column_index < len(row) and row[column_index].strip()
        )
        if _is_semantic_table_column(header_labels=header_labels, column_values=column_values):
            selected.append(column_index)
    return tuple(selected)


def _is_semantic_table_column(
    *,
    header_labels: tuple[str, ...],
    column_values: tuple[str, ...],
) -> bool:
    header_text = " / ".join(header_labels)
    if _contains_decorative_table_keyword(header_text):
        return False
    if not column_values:
        return bool(header_labels)
    decorative_value_count = sum(
        1 for value in column_values if _looks_like_decorative_table_cell(value)
    )
    return not decorative_value_count >= max(1, len(column_values))


def _build_table_column_paths(
    *,
    header_rows: tuple[tuple[str, ...], ...],
    body_rows: tuple[tuple[str, ...], ...],
) -> tuple[str, ...]:
    width = max((len(row) for row in header_rows), default=0)
    column_paths: list[str] = []
    for column_index in range(width):
        parts: list[str] = []
        for header_row in header_rows:
            if column_index >= len(header_row):
                continue
            label = normalize_handbook_body_text(header_row[column_index])
            if not label:
                continue
            if not parts or parts[-1] != label:
                parts.append(label)
        if parts:
            column_paths.append(" / ".join(parts))
            continue
        inferred = _infer_missing_table_column_label(column_index=column_index, body_rows=body_rows)
        column_paths.append(inferred if inferred else "未命名列")
    return tuple(column_paths)


def _merge_split_table_group_labels(
    body_rows: tuple[tuple[str, ...], ...],
) -> tuple[tuple[str, ...], ...]:
    if len(body_rows) < 2:
        return body_rows
    repaired_rows = [list(row) for row in body_rows]
    for row_index in range(len(repaired_rows) - 1):
        current_label = normalize_handbook_body_text(repaired_rows[row_index][0])
        previous_label = (
            normalize_handbook_body_text(repaired_rows[row_index - 1][0]) if row_index > 0 else ""
        )
        next_label = normalize_handbook_body_text(repaired_rows[row_index + 1][0])
        if not _should_merge_split_table_group_label(
            current_row=repaired_rows[row_index],
            current_label=current_label,
            previous_label=previous_label,
            next_label=next_label,
            following_rows=repaired_rows[row_index + 1 :],
        ):
            continue
        repaired_rows[row_index][0] = f"{current_label}{next_label}"
    return tuple(tuple(row) for row in repaired_rows)


def _should_merge_split_table_group_label(
    *,
    current_row: list[str],
    current_label: str,
    previous_label: str,
    next_label: str,
    following_rows: list[list[str]],
) -> bool:
    if not current_label or not next_label or current_label == next_label:
        return False
    if previous_label == current_label:
        return False
    if not (2 <= len(current_label) <= 6 and 4 <= len(next_label) <= 12):
        return False
    if not re.fullmatch(r"[\u4e00-\u9fff()（）]+", current_label):
        return False
    if not re.fullmatch(r"[\u4e00-\u9fff()（）]+", next_label):
        return False
    if len(current_label + next_label) > 18:
        return False
    if any(cell.strip() for cell in current_row[2:]):
        return False
    repeated_group_rows = 0
    for row in following_rows:
        if normalize_handbook_body_text(row[0]) != next_label:
            break
        repeated_group_rows += 1
    return repeated_group_rows >= 2


def _infer_missing_table_column_label(
    *,
    column_index: int,
    body_rows: tuple[tuple[str, ...], ...],
) -> str | None:
    column_values = [
        normalize_handbook_body_text(row[column_index])
        for row in body_rows
        if column_index < len(row) and normalize_handbook_body_text(row[column_index])
    ]
    if not column_values:
        return None
    if column_index == 0 and _looks_like_project_table_column(column_values):
        return GENERIC_TABLE_PROJECT_LABEL
    return None


def _looks_like_form_table(
    table_matrix: list[tuple[str, ...]],
    *,
    caption_text: str,
) -> bool:
    total_cells = sum(len(row) for row in table_matrix)
    if total_cells == 0:
        return False
    flattened = [cell.strip() for row in table_matrix for cell in row]
    blank_count = sum(1 for cell in flattened if not cell)
    non_empty = [cell for cell in flattened if cell]
    if not non_empty:
        return False
    if any(keyword in caption_text for keyword in FORM_TABLE_CAPTION_KEYWORDS):
        return True
    decorative_hits = sum(1 for cell in non_empty if _looks_like_decorative_table_cell(cell))
    field_hits = sum(1 for cell in non_empty if _contains_form_table_keyword(cell))
    checkbox_hits = sum(1 for cell in non_empty if _contains_form_table_checkbox(cell))
    signature_hits = sum(1 for cell in non_empty if _contains_form_table_signature_keyword(cell))
    unique_non_empty_count = len(set(non_empty))
    section_row_hits = sum(
        1
        for row in table_matrix
        if row and row[0].strip() and _contains_form_table_section_keyword(row[0])
    )
    blank_ratio = blank_count / total_cells
    if checkbox_hits >= 2 and (field_hits >= 3 or signature_hits >= 1 or section_row_hits >= 2):
        return True
    if (
        len(table_matrix) <= 3
        and unique_non_empty_count <= 6
        and signature_hits >= 2
        and field_hits >= 2
    ):
        return True
    if section_row_hits >= 3 and (signature_hits >= 1 or field_hits >= 4):
        return True
    return blank_ratio >= 0.2 and (decorative_hits >= 2 or field_hits >= 3)


def _contains_form_table_keyword(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    return any(keyword in normalized for keyword in FORM_TABLE_FIELD_KEYWORDS)


def _contains_form_table_section_keyword(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    return any(keyword in normalized for keyword in FORM_TABLE_SECTION_KEYWORDS)


def _contains_form_table_signature_keyword(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    return any(keyword in normalized for keyword in FORM_TABLE_SIGNATURE_KEYWORDS)


def _contains_form_table_checkbox(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    return any(marker in normalized for marker in FORM_TABLE_CHECKBOX_MARKERS)


def _contains_decorative_table_keyword(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    return any(keyword in normalized for keyword in DECORATIVE_TABLE_KEYWORDS)


def _looks_like_decorative_table_cell(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    if not normalized:
        return False
    if _contains_decorative_table_keyword(normalized):
        return True
    return normalized.startswith("(请在") and normalized.endswith(")")


def _looks_like_project_table_column(values: list[str]) -> bool:
    if not values:
        return False
    textual_values = sum(1 for value in values if not _looks_like_numeric_dominant_cell(value))
    return textual_values >= max(1, len(values) - 1)


def _looks_like_numeric_dominant_cell(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    if not normalized:
        return False
    return bool(re.fullmatch(r"[0-9０-９\s\-–—~～./:%()（）]+", normalized))


class _HtmlTableMatrixParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.rows: list[list[str]] = []
        self._pending_rowspans: dict[tuple[int, int], str] = {}
        self._current_row_index = -1
        self._current_col_index = 0
        self._current_row: list[str] | None = None
        self._current_cell_parts: list[str] | None = None
        self._current_cell_attrs: dict[str, str] = {}

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        normalized_tag = tag.lower()
        if normalized_tag == "tr":
            self._start_row()
            return
        if normalized_tag in {"td", "th"} and self._current_row is not None:
            self._advance_to_next_open_column()
            self._current_cell_parts = []
            self._current_cell_attrs = {name.lower(): value or "" for name, value in attrs}

    def handle_data(self, data: str) -> None:
        if self._current_cell_parts is not None:
            self._current_cell_parts.append(data)

    def handle_endtag(self, tag: str) -> None:
        normalized_tag = tag.lower()
        if (
            normalized_tag in {"td", "th"}
            and self._current_row is not None
            and self._current_cell_parts is not None
        ):
            self._close_cell()
            return
        if normalized_tag == "tr" and self._current_row is not None:
            self.rows.append(self._current_row)
            self._current_row = None
            self._current_cell_parts = None
            self._current_cell_attrs = {}

    def _start_row(self) -> None:
        self._current_row_index += 1
        self._current_col_index = 0
        self._current_row = []
        self._current_cell_parts = None
        self._current_cell_attrs = {}
        self._apply_rowspans_for_current_row()

    def _apply_rowspans_for_current_row(self) -> None:
        while True:
            key = (self._current_row_index, self._current_col_index)
            if key not in self._pending_rowspans:
                break
            self._ensure_row_length(self._current_col_index + 1)
            self._current_row[self._current_col_index] = self._pending_rowspans.pop(key)
            self._current_col_index += 1

    def _advance_to_next_open_column(self) -> None:
        while (self._current_row_index, self._current_col_index) in self._pending_rowspans:
            self._ensure_row_length(self._current_col_index + 1)
            self._current_row[self._current_col_index] = self._pending_rowspans.pop(
                (self._current_row_index, self._current_col_index)
            )
            self._current_col_index += 1

    def _close_cell(self) -> None:
        value = normalize_handbook_body_text("".join(self._current_cell_parts))
        rowspan = max(1, _safe_positive_int(self._current_cell_attrs.get("rowspan")))
        colspan = max(1, _safe_positive_int(self._current_cell_attrs.get("colspan")))
        for offset in range(colspan):
            col_index = self._current_col_index + offset
            self._ensure_row_length(col_index + 1)
            self._current_row[col_index] = value
            for row_offset in range(1, rowspan):
                self._pending_rowspans[(self._current_row_index + row_offset, col_index)] = value
        self._current_col_index += colspan
        self._current_cell_parts = None
        self._current_cell_attrs = {}
        self._apply_rowspans_for_current_row()

    def _ensure_row_length(self, length: int) -> None:
        assert self._current_row is not None
        while len(self._current_row) < length:
            self._current_row.append("")


def _parse_html_table_matrix(html: str) -> list[list[str]] | None:
    parser = _HtmlTableMatrixParser()
    parser.feed(html)
    rows = [row for row in parser.rows if any(cell.strip() for cell in row)]
    if not rows:
        return None
    max_width = max(len(row) for row in rows)
    return [row + [""] * (max_width - len(row)) for row in rows]


def _safe_positive_int(value: object) -> int:
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        return 1
    return parsed if parsed > 0 else 1


def _matrix_information_score(matrix: list[list[str]]) -> tuple[int, int, int]:
    row_count = len(matrix)
    max_width = max((len(row) for row in matrix), default=0)
    filled_cells = sum(1 for row in matrix for cell in row if cell.strip())
    return (filled_cells, row_count, max_width)


def _looks_like_table_lead_label(text: str, *, next_row: dict[str, object] | None) -> bool:
    if next_row is None or str(next_row.get("row_type") or "") != "table":
        return False
    normalized = normalize_handbook_body_text(text)
    if not normalized:
        return False
    if re.search(r"[。；;！？!?]", normalized):
        return False
    if len(normalized) > 32:
        return False
    return bool(
        re.match(r"^[（(][一二三四五六七八九十0-9]+[)）]", normalized)
        or re.match(r"^[0-9]+[.、]", normalized)
    )


def _should_attach_policy_page_to_following_table(text: str) -> bool:
    normalized = _normalize_policy_page_table_context(text)
    if normalized is None:
        return True
    if "\n" in normalized:
        return False
    if _looks_like_form_cover_table_context(normalized):
        return True
    if LEAF_SECTION_PUNCTUATION_RE.search(normalized):
        return False
    return len(normalized) <= 48


def _should_merge_policy_fragment_into_previous_line(
    *,
    fragment: str,
    current_parts: list[str],
    next_row: dict[str, object] | None,
) -> bool:
    normalized_fragment = normalize_handbook_body_text(fragment)
    if not normalized_fragment or not current_parts or next_row is None:
        return False
    if str(next_row.get("row_type") or "") != "table":
        return False
    previous_line = normalize_handbook_body_text(current_parts[-1])
    if (
        re.match(
            r"^(?:[0-9]+[.、]|[（(][一二三四五六七八九十百千万〇零两0-9]+[)）])", previous_line
        )
        is None
    ):
        return False
    if _split_article_line(normalized_fragment)[0] is not None:
        return False
    if _looks_like_appendix_heading(normalized_fragment):
        return False
    if _looks_like_appendix_marker_only(normalized_fragment):
        return False
    if (
        classify_structural_heading(text=normalized_fragment, row_type="paragraph", next_text=None)
        is not None
    ):
        return False
    if _looks_like_list_entry(normalized_fragment):
        return False
    if re.search(r"[。；;！？!?]", normalized_fragment):
        return False
    return len(normalized_fragment) <= 32


def _merge_policy_fragment_into_previous_line(previous_line: str, fragment: str) -> str:
    normalized_previous = normalize_handbook_body_text(previous_line)
    normalized_fragment = normalize_handbook_body_text(fragment)
    return f"{normalized_previous}{normalized_fragment}".strip()


def _looks_like_table_context(
    text: str,
    *,
    next_row: dict[str, object] | None = None,
    followed_by_table: bool | None = None,
) -> bool:
    normalized = normalize_handbook_body_text(text)
    if not normalized:
        return False
    if followed_by_table is None:
        followed_by_table = next_row is not None and str(next_row.get("row_type") or "") == "table"
    if normalized.endswith(("：", ":")):
        return True
    if followed_by_table and any(phrase in normalized for phrase in TABLE_CONTEXT_INTRO_PHRASES):
        return True
    return bool(
        next_row is not None
        and str(next_row.get("row_type") or "") == "table"
        and re.match(r"^[（(][一二三四五六七八九十0-9]+[)）]", normalized)
    )


def _looks_like_form_cover_table_context(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    if not normalized:
        return False
    if _looks_like_attachment_title_text(normalized):
        return False
    if len(normalized) > 96:
        return False
    return any(keyword in normalized for keyword in FORM_COVER_KEYWORDS)


def _looks_like_form_template_legend(text: str) -> bool:
    normalized = normalize_handbook_body_text(text)
    if not normalized or len(normalized) > 96:
        return False
    if "为:" not in normalized and "为：" not in normalized:
        return False
    if not re.search(r"[;；、]", normalized):
        return False
    field_hits = sum(1 for keyword in FORM_TABLE_FIELD_KEYWORDS if keyword in normalized)
    return field_hits >= 2


def _project_phone_table_policy_pages(
    *,
    row: dict[str, object],
    page_start: int,
    page_end: int,
) -> list[dict[str, object]]:
    table_matrix = _normalize_table_matrix(
        html=row.get("html"),
        table_cells=row.get("table_cells"),
    )
    if not table_matrix or len(table_matrix) < 2:
        return []
    header = [normalize_handbook_body_text(cell) for cell in table_matrix[0]]
    if len(header) < 4 or set(header[:4]) != PHONE_HEADER_LABELS:
        return []

    entries: list[tuple[str, str]] = []
    pending_names: list[str | None] = [None, None]

    def consume_pair(name_index: int, raw_name: object, raw_phone: object) -> None:
        name = normalize_handbook_body_text(str(raw_name))
        phone = normalize_handbook_body_text(str(raw_phone))
        pending_name = pending_names[name_index]
        if name in PHONE_GROUP_HEADINGS and not phone:
            entries.append((name, ""))
            pending_names[name_index] = None
            return
        if name == "办公室" and phone and pending_name:
            entries.append((f"{pending_name}办公室", phone))
            pending_names[name_index] = None
            return
        if name and phone:
            entries.append((name, phone))
            pending_names[name_index] = None
            return
        if name and not phone:
            pending_names[name_index] = name
            return
        if phone and pending_name:
            entries.append((pending_name, phone))
            pending_names[name_index] = None

    for cell_row in table_matrix[1:]:
        consume_pair(0, cell_row[0], cell_row[1])
        consume_pair(
            1, cell_row[2] if len(cell_row) > 2 else "", cell_row[3] if len(cell_row) > 3 else ""
        )

    if not entries:
        return []

    grouped_lines: dict[str, list[str]] = {heading: [] for heading in PHONE_GROUP_HEADINGS}

    for name, phone in entries:
        if name in PHONE_GROUP_HEADINGS and not phone:
            continue
        if phone:
            inferred_group = _infer_phone_group(name)
            grouped_lines[inferred_group].append(f"{name} {phone}")

    groups = [
        (group_title, grouped_lines[group_title])
        for group_title in PHONE_GROUP_HEADINGS
        if grouped_lines[group_title]
    ]
    if not groups:
        return []

    return [
        {
            "kind": "policy_page",
            "text": normalize_handbook_body_text("\n".join(lines)),
            "page_start": page_start,
            "page_end": page_end,
            "section_path": (group_title,),
        }
        for group_title, lines in groups
    ]


def _infer_phone_group(name: str) -> str:
    for group_title, keywords in PHONE_GROUP_KEYWORDS:
        if any(keyword in name for keyword in keywords):
            return group_title
    return "校级办公与公共服务"


__all__ = [
    "_build_table_unit_semantics",
    "_looks_like_form_template_legend",
    "_looks_like_table_context",
    "_looks_like_table_lead_label",
    "_merge_policy_fragment_into_previous_line",
    "_normalize_table_matrix",
    "_project_phone_table_policy_pages",
    "_should_attach_policy_page_to_following_table",
    "_should_merge_policy_fragment_into_previous_line",
]
