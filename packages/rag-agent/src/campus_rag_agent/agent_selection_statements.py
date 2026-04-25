from __future__ import annotations

import re

from campus_contracts import EvidenceSource

from .agent_curriculum_tables import (
    _extract_curriculum_semester_scoped_statements,
    _is_curriculum_course_row,
    _is_curriculum_table_heading,
)
from .agent_curriculum_terms import (
    _is_curriculum_course_list_query,
    _is_curriculum_semester_course_list_query,
)
from .agent_official_web import (
    _is_official_web_source,
    _normalize_official_web_statement_line,
    _score_official_web_statement,
)
from .agent_selection_query import _query_keywords
from .agent_shared import (
    _normalize_snippet,
    _render_source_support,
    _replace_academic_years_match,
)

_LEADING_ENUM_RE = re.compile(r"^(?:[0-9]{1,2}[.、]\s*|[一二三四五六七八九十百]+[、.]\s*)")
_ACTION_STATEMENT_HINTS = (
    "挂失",
    "申请",
    "补办",
    "办理",
    "提交",
    "填写",
    "审批",
    "备案",
    "注册",
    "检测",
    "充值",
    "报销",
    "replace",
)
_TIME_STATEMENT_HINTS = (
    "时间",
    "几点",
    "学制",
    "亮灯",
    "熄灯",
    "周一",
    "周二",
    "周三",
    "周四",
    "周五",
    "周六",
    "周日",
    "星期",
    "月",
    "日",
    ":",
)
_ACADEMIC_YEARS_FACT_RE = re.compile(r"学制[:： ]*(?:\d+|[一二三四五六七八九十两]+)年")


def _extract_source_statements(source: EvidenceSource) -> tuple[str, ...]:
    title = _normalize_snippet(source.source_title)
    ignored_lines = {
        title,
        *(_normalize_snippet(item) for item in source.structural_path if item.strip()),
    }
    if source.detail_label.strip():
        ignored_lines.add(_normalize_snippet(source.detail_label))

    statements: list[str] = []
    for raw_line in re.split(r"[\r\n]+", source.snippet):
        line = _normalize_snippet(raw_line)
        if _is_official_web_source(source):
            line = _normalize_official_web_statement_line(line=line, title=title)
        if not line or line in ignored_lines or line.startswith("文号："):
            continue
        if title and line.startswith(title):
            continue
        line = _LEADING_ENUM_RE.sub("", line)
        line = re.sub(r"^[（(]?[一二三四五六七八九十百]+[)）]\s*", "", line)
        line = re.sub(r"\s*[:：]\s*$", "", line).strip()
        line = re.sub(r"(学制[:： ]*)(\d+)年", _replace_academic_years_match, line)
        if not line or line in ignored_lines or line.startswith("文号："):
            continue
        statements.append(line)

    if statements:
        return tuple(dict.fromkeys(statements))
    rendered = _render_source_support(source)
    return (rendered,) if rendered else ()


def _score_statement(
    query_text: str,
    source: EvidenceSource,
    statement: str,
    *,
    mode: str,
    keywords: tuple[str, ...],
) -> int:
    normalized = _normalize_snippet(statement).lower()
    if _is_curriculum_table_heading(source, statement):
        return 0
    score = 0
    for keyword in keywords:
        if keyword in normalized:
            score += 3 if len(keyword) >= 3 else 1
    if _is_curriculum_course_list_query(query_text) and _is_curriculum_course_row(
        source, statement
    ):
        score += 4
    if mode == "procedure":
        score += sum(2 for token in _ACTION_STATEMENT_HINTS if token in normalized)
        if source.content_role == "procedure":
            score += 2
    if mode == "time":
        score += sum(2 for token in _TIME_STATEMENT_HINTS if token in normalized)
        if source.content_role == "time_rule":
            score += 2
        if ("学制" in query_text or "几年" in query_text) and _ACADEMIC_YEARS_FACT_RE.search(
            normalized
        ):
            score += 8
    if "负责解释" in normalized:
        score -= 6
    if "研究生宿舍" in normalized and "研究生" not in _normalize_snippet(query_text):
        score -= 2
    if _is_official_web_source(source):
        score += _score_official_web_statement(
            query_text=query_text,
            source=source,
            statement=statement,
        )
    return score


def _candidate_source_statements(
    query_text: str, source: EvidenceSource
) -> tuple[tuple[str, ...], bool]:
    scoped_statements = _extract_curriculum_semester_scoped_statements(
        query_text=query_text,
        source=source,
    )
    if scoped_statements is not None:
        return scoped_statements, True
    return _extract_source_statements(source), False


def _score_source_statements(
    query_text: str,
    source: EvidenceSource,
    *,
    mode: str,
) -> tuple[tuple[int, str], ...]:
    keywords = _query_keywords(query_text)
    scored: list[tuple[int, str]] = []
    statements, _ = _candidate_source_statements(query_text, source)
    for statement in statements:
        score = _score_statement(query_text, source, statement, mode=mode, keywords=keywords)
        if score > 0:
            scored.append((score, statement))
    return tuple(sorted(scored, key=lambda item: (item[0], len(item[1])), reverse=True))


def _rank_source_statements(
    query_text: str, source: EvidenceSource, *, mode: str
) -> tuple[str, ...]:
    statements, scoped = _candidate_source_statements(query_text, source)
    statement_limit = 4 if mode == "time" else 3
    if scoped and _is_curriculum_semester_course_list_query(query_text):
        return statements
    if scoped and _is_curriculum_course_list_query(query_text):
        return statements[:statement_limit]
    scored = _score_source_statements(query_text, source, mode=mode)
    if not scored:
        if scoped:
            return ()
        return statements[:1]
    return tuple(statement for _, statement in scored[:statement_limit])


__all__ = [
    "_ACADEMIC_YEARS_FACT_RE",
    "_ACTION_STATEMENT_HINTS",
    "_LEADING_ENUM_RE",
    "_TIME_STATEMENT_HINTS",
    "_candidate_source_statements",
    "_extract_source_statements",
    "_rank_source_statements",
    "_score_source_statements",
    "_score_statement",
]
