from __future__ import annotations

import re
from collections.abc import Callable, Mapping, Sequence
from typing import Any

from campus_ingestion_core.source_truth_common import extract_html_table_grid

TableMatrix = tuple[tuple[str, ...], ...]


def iter_notice_derived_transport_table_matrices(
    units: Sequence[Mapping[str, Any]],
    *,
    clean_cell: Callable[[object], str],
    coerce_int: Callable[[object], int],
    extract_times: Callable[[str], tuple[str, ...]],
    resolve_route: Callable[[str], object],
) -> tuple[TableMatrix, ...]:
    matrices: list[TableMatrix] = []
    seen: set[TableMatrix] = set()
    for unit in units:
        for matrix in _table_matrices_from_unit(
            unit,
            clean_cell=clean_cell,
            coerce_int=coerce_int,
            extract_times=extract_times,
            resolve_route=resolve_route,
        ):
            if matrix and matrix not in seen:
                matrices.append(matrix)
                seen.add(matrix)
    return tuple(matrices)


def _table_matrices_from_unit(
    unit: Mapping[str, Any],
    *,
    clean_cell: Callable[[object], str],
    coerce_int: Callable[[object], int],
    extract_times: Callable[[str], tuple[str, ...]],
    resolve_route: Callable[[str], object],
) -> tuple[TableMatrix, ...]:
    candidates: list[TableMatrix] = []
    table_cells_matrix = _normalize_table_cells(
        unit.get("table_cells"),
        clean_cell=clean_cell,
        coerce_int=coerce_int,
    )
    if table_cells_matrix:
        candidates.append(table_cells_matrix)

    for html_value in (unit.get("html"), unit.get("table_html")):
        if isinstance(html_value, str) and html_value.strip():
            html_matrix = _normalize_table_cells(
                extract_html_table_grid(html_value),
                clean_cell=clean_cell,
                coerce_int=coerce_int,
            )
            if html_matrix:
                candidates.append(html_matrix)

    if candidates:
        return tuple(candidates)

    for text_value in (unit.get("clean_text"), unit.get("text"), unit.get("raw_text")):
        if not isinstance(text_value, str) or not text_value.strip():
            continue
        markdown_matrix = _parse_markdown_table_matrix(text_value, clean_cell=clean_cell)
        if markdown_matrix:
            candidates.append(markdown_matrix)
            continue
        aligned_matrix = _parse_plain_text_schedule_matrix(
            text_value,
            clean_cell=clean_cell,
            extract_times=extract_times,
            resolve_route=resolve_route,
        )
        if aligned_matrix:
            candidates.append(aligned_matrix)
    return tuple(candidates)


def _parse_markdown_table_matrix(
    value: str,
    *,
    clean_cell: Callable[[object], str],
) -> TableMatrix:
    rows: list[tuple[str, ...]] = []
    for line in value.splitlines():
        normalized = line.strip()
        if "|" not in normalized:
            continue
        cells = tuple(clean_cell(cell) for cell in normalized.strip("|").split("|"))
        if not cells or all(not cell for cell in cells):
            continue
        if all(re.fullmatch(r":?-{3,}:?", cell.replace(" ", "")) for cell in cells if cell):
            continue
        rows.append(cells)
    return tuple(rows)


def _parse_plain_text_schedule_matrix(
    value: str,
    *,
    clean_cell: Callable[[object], str],
    extract_times: Callable[[str], tuple[str, ...]],
    resolve_route: Callable[[str], object],
) -> TableMatrix:
    rows: list[tuple[str, ...]] = []
    for line in value.splitlines():
        normalized = clean_cell(line)
        if not normalized:
            continue
        if not extract_times(normalized) and resolve_route(normalized) is None:
            continue
        cells = tuple(cell for cell in re.split(r"\t+|\s{2,}", normalized) if cell)
        rows.append(cells or (normalized,))
    return tuple(rows)


def _normalize_table_cells(
    value: object,
    *,
    clean_cell: Callable[[object], str],
    coerce_int: Callable[[object], int],
) -> TableMatrix:
    if not isinstance(value, list) or not value:
        return ()
    if all(isinstance(row, list) for row in value):
        return tuple(
            tuple(clean_cell(cell) for cell in row)
            for row in value
            if any(clean_cell(cell) for cell in row)
        )
    if not all(isinstance(cell, dict) for cell in value):
        return ()
    cells = [dict(cell) for cell in value]
    max_row = max((coerce_int(cell.get("row")) for cell in cells), default=0)
    max_col = max((coerce_int(cell.get("col")) for cell in cells), default=0)
    if max_row <= 0 or max_col <= 0:
        return ()
    matrix = [["" for _column in range(max_col)] for _row in range(max_row)]
    for cell in cells:
        row_index = coerce_int(cell.get("row")) - 1
        col_index = coerce_int(cell.get("col")) - 1
        if row_index < 0 or col_index < 0:
            continue
        matrix[row_index][col_index] = clean_cell(
            cell.get("text") or cell.get("value") or cell.get("content")
        )
    return tuple(tuple(row) for row in matrix if any(row))


__all__ = ("iter_notice_derived_transport_table_matrices",)
