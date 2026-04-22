from __future__ import annotations

import re
from dataclasses import dataclass

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_retrieval_core.curriculum_query_resolution import interpret_curriculum_query

from .agent_shared import _answer_prefix, _lead_source_title, _normalize_snippet, _render_source_support

_CURRICULUM_COURSE_LIST_QUERY_HINTS = ("什么课", "哪些课", "有什么课", "有哪些课", "修什么")
_CURRICULUM_TOTAL_CREDITS_FACT_RE = re.compile(r"总学分[^0-9]{0,12}([0-9]{2,3})(?:\s*学分)?")
_CURRICULUM_STUDY_YEARS_FACT_RE = re.compile(
    r"学制[^0-9一二三四五六七八九十两]{0,12}((?:\d+|[一二三四五六七八九十两]+)年)"
)
_CURRICULUM_SEMESTER_NUMERIC_LABELS = {
    "第一学期": "1",
    "第二学期": "2",
    "第三学期": "3",
    "第四学期": "4",
    "第五学期": "5",
    "第六学期": "6",
    "第七学期": "7",
    "第八学期": "8",
    "第九学期": "9",
    "第十学期": "10",
}
_CURRICULUM_EMPTY_TABLE_CELLS = frozenset({"", "-", "—", "/", "／"})


@dataclass(frozen=True, slots=True)
class _CurriculumSemesterTableLayout:
    single_semester_index: int = -1
    distribution_semester_indexes: tuple[tuple[str, int], ...] = ()


@dataclass(frozen=True, slots=True)
class _CurriculumCourseTitleCandidate:
    title: str
    partial_boundary: bool = False


def _is_curriculum_course_list_query(query_text: str) -> bool:
    normalized_query = _normalize_snippet(query_text)
    return any(hint in normalized_query for hint in _CURRICULUM_COURSE_LIST_QUERY_HINTS)


def _is_curriculum_lookup_query(query_text: str) -> bool:
    interpretation = interpret_curriculum_query(query_text)
    return interpretation.intent_kind == "curriculum_lookup"


def _curriculum_semester_labels(query_text: str) -> tuple[str, ...]:
    interpretation = interpret_curriculum_query(query_text)
    if interpretation.intent_kind != "course_list" or not interpretation.semester_labels:
        return ()
    return tuple(dict.fromkeys(interpretation.semester_labels))


def _curriculum_target_semesters(query_text: str) -> tuple[str, ...]:
    semester_labels = _curriculum_semester_labels(query_text)
    if not semester_labels:
        return ()
    return tuple(
        dict.fromkeys(
            _CURRICULUM_SEMESTER_NUMERIC_LABELS.get(label, "")
            for label in semester_labels
            if _CURRICULUM_SEMESTER_NUMERIC_LABELS.get(label, "")
        )
    )


def _is_curriculum_semester_course_list_query(query_text: str) -> bool:
    return bool(_curriculum_semester_labels(query_text))


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
    if normalized.startswith("课程类别 |") or normalized.startswith("专业方向 |"):
        return True
    return False


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


def _compose_curriculum_semester_course_list_answer(
    *,
    evidence: EvidenceBundle,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> str:
    if evidence.collection not in {"curriculum_plan", "program_semester_facts"}:
        return ""
    semester_labels = _curriculum_semester_labels(evidence.query_text)
    if len(semester_labels) != 1:
        return ""

    if evidence.collection == "program_semester_facts":
        course_titles = list(
            _extract_program_semester_course_titles(
                query_text=evidence.query_text,
                selected_rows=selected_rows,
            )
        )
        if not course_titles:
            return ""
        return f"{_answer_prefix(evidence)}，{semester_labels[0]}有{'、'.join(course_titles)}。"

    course_titles: list[str] = []
    seen_titles: set[str] = set()
    for source, statements in selected_rows:
        for course_title in _extract_curriculum_semester_course_titles(
            query_text=evidence.query_text,
            source=source,
            statements=statements,
        ):
            normalized = _normalize_snippet(course_title).lower()
            if not normalized or normalized in seen_titles:
                continue
            seen_titles.add(normalized)
            course_titles.append(course_title)
    if not course_titles:
        return ""

    return f"{_answer_prefix(evidence)}，{semester_labels[0]}有{'、'.join(course_titles)}。"


def _compose_curriculum_lookup_answer(
    *,
    evidence: EvidenceBundle,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> str:
    statements = _flatten_curriculum_statements(selected_rows)
    if not statements:
        return ""
    lead_title = _lead_source_title(tuple(source for source, _ in selected_rows))
    normalized_query = _normalize_snippet(evidence.query_text)
    if any(token in normalized_query for token in ("学制", "几年")):
        years = _extract_curriculum_study_years(statements)
        if years:
            return _curriculum_fact_sentence(lead_title, f"学制为{years}")
    if "总学分" in normalized_query:
        credits = _extract_curriculum_total_credits(statements)
        if credits:
            return _curriculum_fact_sentence(lead_title, f"总学分为{credits}")
    return ""


def _flatten_curriculum_statements(
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> tuple[str, ...]:
    statements: list[str] = []
    for source, row_statements in selected_rows:
        if row_statements:
            statements.extend(statement for statement in row_statements if statement)
            continue
        fallback = _render_source_support(source)
        if fallback:
            statements.append(fallback)
    return tuple(statements)


def _extract_curriculum_study_years(statements: tuple[str, ...]) -> str:
    for statement in statements:
        normalized = _normalize_snippet(statement)
        match = _CURRICULUM_STUDY_YEARS_FACT_RE.search(normalized)
        if match:
            return match.group(1)
        if "学制" in normalized:
            tail = normalized.split("学制", 1)[-1]
            fallback = re.search(r"((?:\d+|[一二三四五六七八九十两]+)年)", tail)
            if fallback:
                return fallback.group(1)
    return ""


def _extract_curriculum_total_credits(statements: tuple[str, ...]) -> str:
    for statement in statements:
        normalized = _normalize_snippet(statement)
        if "总学分" not in normalized:
            continue
        match = _CURRICULUM_TOTAL_CREDITS_FACT_RE.search(normalized)
        if match:
            return f"{match.group(1)}学分"
    return ""


def _curriculum_fact_sentence(lead_title: str, body: str) -> str:
    if lead_title:
        return f"《{lead_title}》{body}。"
    return f"{body}。"
