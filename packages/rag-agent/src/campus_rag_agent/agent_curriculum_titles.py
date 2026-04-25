from __future__ import annotations

import re
from dataclasses import dataclass

from campus_contracts import EvidenceSource

from .agent_curriculum_tables import (
    _curriculum_row_matches_target_semester,
    _CurriculumSemesterTableLayout,
    _is_curriculum_course_row,
    _is_curriculum_table_heading,
    _resolve_curriculum_semester_table_layout,
    _split_curriculum_table_cells,
)
from .agent_curriculum_terms import (
    _curriculum_semester_labels,
    _curriculum_target_semesters,
)
from .agent_shared import _normalize_snippet


@dataclass(frozen=True, slots=True)
class _CurriculumCourseTitleCandidate:
    title: str
    partial_boundary: bool = False


def _extract_curriculum_semester_course_titles_from_statement(
    statement: str,
    *,
    semester_labels: tuple[str, ...],
) -> tuple[str, ...]:
    normalized = _normalize_snippet(statement)
    if not normalized or "|" in normalized:
        return ()
    cleaned = normalized
    for label in semester_labels:
        cleaned = cleaned.replace(label, "")
    cleaned = re.sub(r"^(?:有|包括|课程有|课程包括|课程为|主要有)\s*", "", cleaned)
    cleaned = cleaned.strip("：:，,；;。 ")
    if not cleaned:
        return ()
    return tuple(
        dict.fromkeys(
            fragment.strip("：:，,；;。 ")
            for fragment in re.split(r"[、，,；;]", cleaned)
            if fragment.strip("：:，,；;。 ")
        )
    )


def _extract_program_semester_course_title_candidates_from_statement(
    statement: str,
    *,
    semester_labels: tuple[str, ...],
) -> tuple[_CurriculumCourseTitleCandidate, ...]:
    normalized = _normalize_snippet(statement)
    if not normalized:
        return ()
    cleaned = re.sub(r"^根据培养方案相关内容[，,]?\s*", "", normalized)
    cleaned = re.sub(r"^按当前已采集的《[^》]+》[，,]?\s*", "", cleaned)
    has_list_start_boundary = any(
        token in normalized
        for token in (
            "按当前已采集的《",
            "根据培养方案相关内容",
            *(f"{label}有" for label in semester_labels),
            *(f"{label}课程有" for label in semester_labels),
            *(f"{label}课程包括" for label in semester_labels),
            *(f"{label}课程为" for label in semester_labels),
        )
    )
    has_list_end_boundary = normalized.endswith(("。", "；", ";", "，", ",", "、"))
    for label in semester_labels:
        cleaned = cleaned.replace(label, "")
    cleaned = re.sub(r"^(?:有|包括|课程有|课程包括|课程为|主要有)\s*", "", cleaned)
    cleaned = cleaned.strip("：:，,；;。 ")
    if not cleaned:
        return ()

    fragments = tuple(
        fragment.strip("：:，,；;。 ")
        for fragment in re.split(r"[、，,；;。]", cleaned)
        if fragment.strip("：:，,；;。 ")
    )
    if not fragments:
        return ()

    candidates: list[_CurriculumCourseTitleCandidate] = []
    last_index = len(fragments) - 1
    for index, fragment in enumerate(fragments):
        if any(token in fragment for token in ("当前已采集", "培养方案", "课程事实")):
            continue
        candidates.append(
            _CurriculumCourseTitleCandidate(
                title=fragment,
                partial_boundary=(
                    (index == 0 and not has_list_start_boundary)
                    or (index == last_index and not has_list_end_boundary)
                ),
            )
        )
    return tuple(candidates)


def _has_unbalanced_course_title_brackets(title: str) -> bool:
    return any(
        title.count(open_bracket) != title.count(close_bracket)
        for open_bracket, close_bracket in (("(", ")"), ("（", "）"), ("[", "]"), ("【", "】"))
    )


def _is_partial_curriculum_course_title_fragment(
    candidate: _CurriculumCourseTitleCandidate,
    other: _CurriculumCourseTitleCandidate,
) -> bool:
    candidate_title = _normalize_snippet(candidate.title)
    other_title = _normalize_snippet(other.title)
    if not candidate_title or not other_title or candidate_title == other_title:
        return False
    if len(other_title) <= len(candidate_title):
        return False
    if not (other_title.startswith(candidate_title) or other_title.endswith(candidate_title)):
        return False
    if _has_unbalanced_course_title_brackets(candidate_title):
        return True
    return candidate.partial_boundary and len(candidate_title) <= 4


def _collapse_curriculum_course_title_candidates(
    candidates: tuple[_CurriculumCourseTitleCandidate, ...],
) -> tuple[str, ...]:
    filtered: list[str] = []
    seen_titles: set[str] = set()
    for candidate in candidates:
        normalized = _normalize_snippet(candidate.title)
        if not normalized:
            continue
        if any(
            _is_partial_curriculum_course_title_fragment(candidate, other) for other in candidates
        ):
            continue
        lowered = normalized.lower()
        if lowered in seen_titles:
            continue
        seen_titles.add(lowered)
        filtered.append(normalized)
    return tuple(filtered)


def _extract_program_semester_course_titles(
    *,
    query_text: str,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> tuple[str, ...]:
    semester_labels = _curriculum_semester_labels(query_text)
    if not semester_labels:
        return ()
    candidates: list[_CurriculumCourseTitleCandidate] = []
    for source, statements in selected_rows:
        if source.collection != "program_semester_facts":
            continue
        if (
            source.source_unit_kind != "semester_course_list"
            and source.content_role != "semester_course_list"
        ):
            continue
        for statement in statements:
            candidates.extend(
                _extract_program_semester_course_title_candidates_from_statement(
                    statement,
                    semester_labels=semester_labels,
                )
            )
    return _collapse_curriculum_course_title_candidates(tuple(candidates))


def _extract_curriculum_semester_course_titles(
    *,
    query_text: str,
    source: EvidenceSource,
    statements: tuple[str, ...],
) -> tuple[str, ...]:
    semester_labels = _curriculum_semester_labels(query_text)
    target_semesters = _curriculum_target_semesters(query_text)
    if not semester_labels or not target_semesters:
        return ()
    if source.collection not in {"curriculum_plan", "program_semester_facts"}:
        return ()

    if "|" in source.snippet and source.content_role == "table_fact":
        title = _normalize_snippet(source.source_title)
        ignored_lines = {
            title,
            *(_normalize_snippet(item) for item in source.structural_path if item.strip()),
        }
        if source.detail_label.strip():
            ignored_lines.add(_normalize_snippet(source.detail_label))

        table_layout: _CurriculumSemesterTableLayout | None = None
        course_name_index = -1
        course_titles: list[str] = []
        for raw_line in re.split(r"[\r\n]+", source.snippet):
            line = _normalize_snippet(raw_line)
            if not line or line in ignored_lines or line.startswith("文号："):
                continue
            cells = _split_curriculum_table_cells(line)
            if "课程名称" in cells:
                course_name_index = cells.index("课程名称")
            resolved_layout = _resolve_curriculum_semester_table_layout(cells)
            if resolved_layout is not None:
                table_layout = resolved_layout
                continue
            if _is_curriculum_table_heading(source, line) or not _is_curriculum_course_row(
                source, line
            ):
                continue
            if course_name_index < 0 or course_name_index >= len(cells):
                continue
            if not _curriculum_row_matches_target_semester(
                cells=cells,
                layout=table_layout,
                target_semesters=target_semesters,
            ):
                continue
            course_name = _normalize_snippet(cells[course_name_index])
            if course_name and course_name != "课程名称":
                course_titles.append(course_name)
        if course_titles:
            return tuple(dict.fromkeys(course_titles))

    fallback_titles: list[str] = []
    for statement in statements:
        fallback_titles.extend(
            _extract_curriculum_semester_course_titles_from_statement(
                statement,
                semester_labels=semester_labels,
            )
        )
    return tuple(dict.fromkeys(fallback_titles))


__all__ = [
    "_CurriculumCourseTitleCandidate",
    "_collapse_curriculum_course_title_candidates",
    "_extract_curriculum_semester_course_titles",
    "_extract_curriculum_semester_course_titles_from_statement",
    "_extract_program_semester_course_title_candidates_from_statement",
    "_extract_program_semester_course_titles",
    "_has_unbalanced_course_title_brackets",
    "_is_partial_curriculum_course_title_fragment",
]
