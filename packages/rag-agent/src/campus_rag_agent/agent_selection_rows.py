from __future__ import annotations

from campus_contracts import EvidenceSource
from campus_retrieval_core.evidence_ranking import query_targets_source_title

from .agent_answer_shape import AnswerShape
from .agent_curriculum_terms import (
    _is_curriculum_course_list_query,
    _is_curriculum_lookup_query,
)
from .agent_official_web_reference_people import (
    _extract_official_web_scholar_domains,
    _extract_official_web_scholar_name,
)
from .agent_official_web_reference_sentences import _flatten_official_web_sentences
from .agent_official_web_terms import (
    _OFFICIAL_WEB_IGNORED_CONTENT_ROLES,
    _is_official_web_reference_query,
    _is_official_web_source,
)
from .agent_selection_query import _query_mode
from .agent_selection_statements import (
    _rank_source_statements,
    _score_source_statements,
)
from .agent_shared import _lead_source_title, _normalize_snippet


def _select_answer_support_rows(
    *,
    query_text: str,
    sources: tuple[EvidenceSource, ...],
    max_sources: int,
    answer_shape: AnswerShape | None = None,
) -> tuple[tuple[EvidenceSource, tuple[str, ...]], ...]:
    if not sources or max_sources <= 0:
        return ()

    mode = _query_mode(query_text)
    shape = answer_shape or AnswerShape.GENERAL_SUMMARY
    course_list_query = _is_curriculum_course_list_query(query_text)
    curriculum_lookup_query = _is_curriculum_lookup_query(query_text)
    consumable_sources = tuple(
        source for source in sources if not _should_ignore_official_web_source(source)
    )
    ranked_source_input = consumable_sources or sources
    if course_list_query or curriculum_lookup_query:
        max_seen_statements = 6
    elif shape == AnswerShape.CONDITION_OVERVIEW:
        max_seen_statements = max(3, max_sources)
    else:
        max_seen_statements = 3
    ranked_sources = (
        tuple(ranked_source_input)
        if course_list_query or curriculum_lookup_query
        else tuple(
            sorted(
                ranked_source_input,
                key=lambda source: _answer_source_sort_key(query_text, source, mode=mode),
                reverse=True,
            )
        )
    )
    rows: list[tuple[EvidenceSource, tuple[str, ...]]] = []
    seen_statements: set[str] = set()

    for index, source in enumerate(ranked_sources):
        ranked_statements = _rank_source_statements(query_text, source, mode=mode)
        if shape == AnswerShape.DETAIL_CLAUSE:
            ranked_statements = _filter_statements_for_query_critical_terms(
                query_text=query_text,
                statements=ranked_statements,
            )
        novel_statements = tuple(
            statement
            for statement in ranked_statements
            if _normalize_snippet(statement).lower() not in seen_statements
        )
        if not novel_statements:
            continue
        rows.append((source, novel_statements))
        seen_statements.update(
            _normalize_snippet(statement).lower() for statement in novel_statements
        )
        if _should_stop_after_official_web_reference_rows(query_text=query_text, rows=tuple(rows)):
            break
        if (
            shape != AnswerShape.CONDITION_OVERVIEW
            and not course_list_query
            and index == 0
            and len(novel_statements) >= 2
            and not _is_official_web_reference_query(query_text=query_text, source=source)
        ):
            break
        if (
            (course_list_query or curriculum_lookup_query)
            and len(rows) >= 2
            and len(seen_statements) >= 5
        ):
            break
        if (
            index == 0
            and mode == "time"
            and any("学制" in statement for statement in novel_statements)
        ):
            break
        if len(rows) >= max_sources or len(seen_statements) >= max_seen_statements:
            break

    if rows:
        return tuple(rows)

    fallback_source = ranked_sources[0]
    return ((fallback_source, _rank_source_statements(query_text, fallback_source, mode=mode)),)


def _should_ignore_official_web_source(source: EvidenceSource) -> bool:
    return (
        _is_official_web_source(source)
        and source.content_role in _OFFICIAL_WEB_IGNORED_CONTENT_ROLES
    )


def _answer_source_sort_key(
    query_text: str, source: EvidenceSource, *, mode: str
) -> tuple[int, int, int, int]:
    scored = _score_source_statements(query_text, source, mode=mode)
    if not scored:
        return (0, 0, 0, 0)
    best_score = scored[0][0]
    total_score = sum(score for score, _ in scored[:3])
    return (best_score, total_score, len(scored), 1 if source.is_answer_bearing else 0)


def _filter_statements_for_query_critical_terms(
    *,
    query_text: str,
    statements: tuple[str, ...],
) -> tuple[str, ...]:
    critical_groups = _query_critical_term_groups(query_text)
    if not critical_groups:
        return statements
    return tuple(
        statement
        for statement in statements
        if _statement_covers_critical_groups(statement, critical_groups)
    )


def _query_critical_term_groups(query_text: str) -> tuple[tuple[str, ...], ...]:
    normalized = _normalize_snippet(query_text)
    groups: list[tuple[str, ...]] = []
    if "论文" in normalized:
        groups.append(("论文", "发表"))
    if "著作" in normalized:
        groups.append(("著作", "出版"))
    if "专利" in normalized:
        groups.append(("专利", "发明"))
    if "竞赛" in normalized:
        groups.append(("竞赛", "比赛"))
    return tuple(groups)


def _statement_covers_critical_groups(
    statement: str,
    groups: tuple[tuple[str, ...], ...],
) -> bool:
    normalized = _normalize_snippet(statement)
    return all(any(term in normalized for term in group) for group in groups)


def _should_lock_official_web_reference_answer(
    *,
    query_text: str,
    source: EvidenceSource,
    statements: tuple[str, ...],
) -> bool:
    if not _is_official_web_source(source):
        return False
    if not _is_official_web_reference_query(query_text=query_text, source=source):
        return False
    if not query_targets_source_title(query_text=query_text, source=source):
        return False
    return any(_normalize_snippet(statement) for statement in statements)


def _should_stop_after_official_web_reference_rows(
    *,
    query_text: str,
    rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> bool:
    if not rows:
        return False
    lead_source = rows[0][0]
    if not _should_lock_official_web_reference_answer(
        query_text=query_text,
        source=lead_source,
        statements=rows[0][1],
    ):
        return False
    normalized_title = _normalize_snippet(lead_source.source_title)
    lead_title = _lead_source_title(tuple(source for source, _ in rows))
    sentences = _flatten_official_web_sentences(rows, lead_title=lead_title)
    if normalized_title == "学校概况":
        has_campus = any(
            "三个校区" in sentence or ("海淀" in sentence and "丰台" in sentence)
            for sentence in sentences
        )
        has_discipline = any(
            "12个学科门类" in sentence or "71个本科专业" in sentence for sentence in sentences
        )
        return has_campus and has_discipline
    if normalized_title == "学术名流":
        names = {
            name
            for source, statements in rows
            if (name := _extract_official_web_scholar_name(source, statements))
        }
        domains = {
            domain
            for _, statements in rows
            for domain in _extract_official_web_scholar_domains(statements)
        }
        return len(names) >= 3 and bool(domains)
    if normalized_title == "本科培养":
        has_scale = any("本科专业" in sentence and "在招专业" in sentence for sentence in sentences)
        has_excellence = any(
            "强基计划" in sentence or "一流本科专业" in sentence for sentence in sentences
        )
        return has_scale and has_excellence
    if normalized_title == "博士后":
        has_stations = any("博士后科研流动站" in sentence for sentence in sentences)
        has_assessment = any(
            "合格率均为100" in sentence or "优秀博士后流动站" in sentence for sentence in sentences
        )
        return has_stations and has_assessment
    if normalized_title == "研究生培养":
        has_discipline = any("12个学科门类" in sentence for sentence in sentences)
        has_authorization = any(
            "24个研究生招生培养单位" in sentence or "博士一级学科授权点" in sentence
            for sentence in sentences
        )
        return has_discipline and has_authorization
    return True


__all__ = [
    "_answer_source_sort_key",
    "_filter_statements_for_query_critical_terms",
    "_select_answer_support_rows",
    "_should_ignore_official_web_source",
    "_should_lock_official_web_reference_answer",
    "_should_stop_after_official_web_reference_rows",
]
