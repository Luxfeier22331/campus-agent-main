from __future__ import annotations

import re

from campus_contracts import EvidenceBundle, EvidenceSource

from .agent_curriculum_terms import (
    _curriculum_semester_labels,
    _is_curriculum_lookup_query,
    _is_curriculum_semester_course_list_query,
)
from .agent_curriculum_titles import (
    _extract_curriculum_semester_course_titles,
    _extract_program_semester_course_titles,
)
from .agent_shared import (
    _answer_prefix,
    _lead_source_title,
    _normalize_snippet,
    _render_source_support,
    _source_context_label,
)

_CURRICULUM_TOTAL_CREDITS_FACT_RE = re.compile(r"总学分[^0-9]{0,12}([0-9]{2,3})(?:\s*学分)?")
_CURRICULUM_STUDY_YEARS_FACT_RE = re.compile(
    r"学制[^0-9一二三四五六七八九十两]{0,12}((?:\d+|[一二三四五六七八九十两]+)年)"
)


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
        lead_title = _program_semester_source_title(selected_rows)
        course_titles = list(
            _extract_program_semester_course_titles(
                query_text=evidence.query_text,
                selected_rows=selected_rows,
            )
        )
        if not course_titles:
            return ""
        title_prefix = f"《{lead_title}》" if lead_title else ""
        return (
            f"{_answer_prefix(evidence)}，{title_prefix}{semester_labels[0]}有"
            f"{'、'.join(course_titles)}。"
        )

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
    if selected_rows:
        source = selected_rows[0][0]
        context_label = _source_context_label(evidence=evidence, source=source)
        if context_label:
            return f"{_answer_prefix(evidence)}，{context_label}明确：{'；'.join(statements[:3])}"
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


def _program_semester_source_title(
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> str:
    if not selected_rows:
        return ""
    source = selected_rows[0][0]
    for label in source.structural_path:
        normalized = _normalize_snippet(label)
        if normalized and "课程事实" not in normalized:
            return normalized
    title = _lead_source_title((source,))
    return re.sub(r"\s*第[一二三四五六七八九十0-9]+学期课程事实$", "", title).strip()


__all__ = [
    "_compose_curriculum_lookup_answer",
    "_compose_curriculum_semester_course_list_answer",
    "_curriculum_fact_sentence",
    "_extract_curriculum_study_years",
    "_extract_curriculum_total_credits",
    "_flatten_curriculum_statements",
    "_is_curriculum_lookup_query",
    "_is_curriculum_semester_course_list_query",
]
