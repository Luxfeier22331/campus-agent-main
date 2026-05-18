from __future__ import annotations

import re
from dataclasses import dataclass

from campus_contracts import EvidenceSource

from .agent_curriculum_terms import (
    _CURRICULUM_EMPTY_TABLE_CELLS,
    _CURRICULUM_SEMESTER_NUMERIC_LABELS,
    _curriculum_target_semesters,
    _is_curriculum_semester_course_list_query,
)
from .agent_shared import _normalize_snippet


@dataclass(frozen=True, slots=True)
class _CurriculumSemesterTableLayout:
    single_semester_index: int = -1
    distribution_semester_indexes: tuple[tuple[str, int], ...] = ()


def _is_curriculum_course_row(source: EvidenceSource, statement: str) -> bool:
    if source.collection != "curriculum_plan" or source.content_role != "table_fact":
        return False
    normalized = _normalize_snippet(statement)
    if normalized.count("|") < 5:
        return False
    return "课程号" not in normalized and "课程名称" not in normalized


def _is_curriculum_table_heading(source: EvidenceSource, statement: str) -> bool:
    if source.collection != "curriculum_plan" or source.content_role != "table_fact":
        return False
    normalized = _normalize_snippet(statement)
    if not normalized:
        return False
    if normalized.endswith("教学进程计划表"):
        return True
    if normalized in {"大类培养", "学科基础教育", "专业教育", "专业选修课程"}:
        return True
    if "课程清单如下" in normalized:
        return True
    if "课程名称" in normalized and "学分" in normalized and "|" in normalized:
        return True
    return bool(normalized.startswith(("课程类别 |", "专业方向 |")))


def _extract_curriculum_semester_scoped_statements(
    *,
    query_text: str,
    source: EvidenceSource,
) -> tuple[str, ...] | None:
    if source.collection != "curriculum_plan" or source.content_role != "table_fact":
        return None
    if not _is_curriculum_semester_course_list_query(query_text):
        return None
    if "|" not in source.snippet:
        return None
    target_semesters = _curriculum_target_semesters(query_text)
    if not target_semesters:
        return None

    title = _normalize_snippet(source.source_title)
    ignored_lines = {
        title,
        *(_normalize_snippet(item) for item in source.structural_path if item.strip()),
    }
    if source.detail_label.strip():
        ignored_lines.add(_normalize_snippet(source.detail_label))

    matched_rows: list[str] = []
    table_layout: _CurriculumSemesterTableLayout | None = None
    for raw_line in re.split(r"[\r\n]+", source.snippet):
        line = _normalize_snippet(raw_line)
        if not line or line in ignored_lines or line.startswith("文号："):
            continue
        cells = _split_curriculum_table_cells(line)
        resolved_layout = _resolve_curriculum_semester_table_layout(cells)
        if resolved_layout is not None:
            table_layout = resolved_layout
            continue
        if _is_curriculum_table_heading(source, line) or not _is_curriculum_course_row(
            source, line
        ):
            continue
        if _curriculum_row_matches_target_semester(
            cells=cells,
            layout=table_layout,
            target_semesters=target_semesters,
        ):
            matched_rows.append(line)
    return tuple(dict.fromkeys(matched_rows))


def _split_curriculum_table_cells(line: str) -> tuple[str, ...]:
    return tuple(_normalize_snippet(cell) for cell in line.split("|"))


def _resolve_curriculum_semester_table_layout(
    cells: tuple[str, ...],
) -> _CurriculumSemesterTableLayout | None:
    if "课程名称" not in cells:
        return None
    for index, cell in enumerate(cells):
        if cell.endswith("学期") and "各学期" not in cell:
            return _CurriculumSemesterTableLayout(single_semester_index=index)
    distribution_indexes = tuple(
        (cell, index)
        for index, cell in enumerate(cells)
        if cell in _CURRICULUM_SEMESTER_NUMERIC_LABELS.values()
    )
    if len(distribution_indexes) >= 2:
        return _CurriculumSemesterTableLayout(
            distribution_semester_indexes=distribution_indexes,
        )
    return None


def _curriculum_row_matches_target_semester(
    *,
    cells: tuple[str, ...],
    layout: _CurriculumSemesterTableLayout | None,
    target_semesters: tuple[str, ...],
) -> bool:
    if not cells:
        return False
    if layout is not None and layout.single_semester_index >= 0:
        if layout.single_semester_index >= len(cells):
            return False
        return cells[layout.single_semester_index] in target_semesters
    if layout is not None and layout.distribution_semester_indexes:
        return any(
            column_index < len(cells) and _curriculum_table_cell_has_value(cells[column_index])
            for semester_label, column_index in layout.distribution_semester_indexes
            if semester_label in target_semesters
        )
    return cells[-1] in target_semesters


def _curriculum_table_cell_has_value(value: str) -> bool:
    return _normalize_snippet(value) not in _CURRICULUM_EMPTY_TABLE_CELLS


__all__ = [
    "_CurriculumSemesterTableLayout",
    "_curriculum_row_matches_target_semester",
    "_curriculum_table_cell_has_value",
    "_extract_curriculum_semester_scoped_statements",
    "_is_curriculum_course_row",
    "_is_curriculum_table_heading",
    "_resolve_curriculum_semester_table_layout",
    "_split_curriculum_table_cells",
]
