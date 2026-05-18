from __future__ import annotations

from campus_ingestion_core.handbook_cleanup_tables import (
    _build_table_unit_semantics,
    _normalize_table_cells_matrix,
)


def _resolve_official_web_table_context(*, title: str, section_path: list[str]) -> str:
    labels = [item.strip() for item in section_path if item.strip()]
    if labels:
        return labels[-1]
    normalized_title = title.strip()
    if normalized_title:
        return normalized_title
    raise ValueError("official_web table unit requires title or section_path table context")


def _build_official_web_table_semantics(
    *,
    table_cells: object,
    table_context: str,
    title: str,
    normalized_canonical_url: str,
    row_id: str,
):
    normalized_cells = _strip_official_web_table_caption_rows(
        _normalize_table_cells_matrix(table_cells),
        table_context=table_context,
        title=title,
    )
    table_semantics = _build_table_unit_semantics(
        table_cells=normalized_cells,
        table_context=table_context,
    )
    if table_semantics is None:
        location = f"{normalized_canonical_url}#{row_id}" if row_id else normalized_canonical_url
        raise ValueError(
            f"official_web table block must expose evidence-grade tableCells semantics: {location}"
        )
    return table_semantics


def _strip_official_web_table_caption_rows(
    table_cells: list[list[str]] | None,
    *,
    table_context: str,
    title: str,
) -> list[list[str]] | None:
    if not table_cells:
        return table_cells
    rows = list(table_cells)
    while rows and _is_official_web_table_caption_row(
        rows[0],
        table_context=table_context,
        title=title,
    ):
        rows = rows[1:]
    return rows or table_cells


def _is_official_web_table_caption_row(
    row: list[str],
    *,
    table_context: str,
    title: str,
) -> bool:
    non_empty = [cell.strip() for cell in row if cell.strip()]
    if len(non_empty) != 1:
        return False
    caption = " ".join(non_empty[0].split()).strip()
    allowed_captions = {
        " ".join(value.split()).strip()
        for value in (table_context, title)
        if " ".join(value.split()).strip()
    }
    return bool(caption and caption in allowed_captions)


def _build_official_web_table_metadata(*, table_semantics, table_context: str) -> dict[str, object]:
    columns = list(table_semantics.column_paths)
    return {
        "table_context": table_context,
        "caption_lines": list(table_semantics.caption_lines),
        "note_lines": list(table_semantics.note_lines),
        "table_header_rows": [list(row) for row in table_semantics.header_rows],
        "table_body_rows": [list(row) for row in table_semantics.body_rows],
        "table_column_paths": columns,
        "table_columns": columns,
        "table_headers": columns,
        "table_header_line": table_semantics.header_line,
        "table_row_lines": list(table_semantics.row_lines),
        "table_header_row_count": len(table_semantics.header_rows),
        "table_row_count": len(table_semantics.row_lines),
        "table_column_count": len(columns),
    }
