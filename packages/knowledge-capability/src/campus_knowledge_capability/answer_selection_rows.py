from __future__ import annotations

from campus_contracts import EvidenceSource

from .answer_selection_alignment import (
    _answer_source_sort_key,
    _condition_overview_quantified_row_budget,
    _curriculum_course_settings_source,
    _filter_category_discovery_statements,
    _filter_official_web_reference_identity_statements,
    _filter_sources_for_query_subject_alignment,
    _filter_sources_for_retrieval_intent_roles,
    _filter_sources_for_retrieval_intent_target_documents,
    _filter_statements_for_query_critical_terms,
    _filter_student_card_procedure_sources,
    _filter_title_lookup_sources_for_answer_bearing_overview,
    _order_procedure_sources_by_contract,
    _prefer_non_intro_statements,
    _query_asks_curriculum_course_settings,
    _requires_student_card_procedure_focus_filter,
    _should_ignore_official_web_source,
    _should_lock_official_web_reference_answer,
    _should_stop_after_official_web_reference_rows,
    _statement_dedupe_key,
    _title_lookup_statement_budget,
    _trim_judgment_statement_for_query,
)
from .answer_selection_condition_overview import (
    condition_overview_should_expand_statements,
    condition_overview_statement_budget,
    filter_condition_overview_statements,
    order_condition_overview_sources_for_policy_coverage,
    select_condition_overview_member_rows,
)
from .answer_selection_query import _query_mode
from .answer_selection_statements import (
    _rank_source_statements,
)
from .answer_shape import AnswerShape
from .answer_summary_facets import (
    general_summary_is_off_nominal,
    general_summary_preferred_term_score,
    general_summary_query_facets,
    general_summary_text_facet_indexes,
)
from .condition_duration import (
    query_asks_condition_duration_lookup,
    statement_has_condition_duration_answer,
)
from .curriculum_terms import (
    _is_curriculum_course_list_query,
    _is_curriculum_lookup_query,
)
from .official_web_reference_selection import (
    official_web_reference_title_lookup_max_seen_statements,
    official_web_reference_title_lookup_should_continue_rows,
)
from .official_web_terms import _is_official_web_reference_query
from .retrieval_intent import RetrievalIntent


def _select_answer_support_rows(
    *,
    query_text: str,
    sources: tuple[EvidenceSource, ...],
    max_sources: int,
    answer_shape: AnswerShape | None = None,
    retrieval_intent: RetrievalIntent | None = None,
) -> tuple[tuple[EvidenceSource, tuple[str, ...]], ...]:
    if not sources or max_sources <= 0:
        return ()

    mode = _query_mode(query_text)
    shape = answer_shape or AnswerShape.GENERAL_SUMMARY
    course_list_query = _is_curriculum_course_list_query(query_text)
    curriculum_lookup_query = _is_curriculum_lookup_query(query_text)
    curriculum_course_settings_query = _query_asks_curriculum_course_settings(query_text)
    consumable_sources = tuple(
        source for source in sources if not _should_ignore_official_web_source(source)
    )
    if not consumable_sources:
        return ()
    ranked_source_input = consumable_sources
    if course_list_query or curriculum_lookup_query:
        max_seen_statements = 6
    elif shape == AnswerShape.TITLE_LOOKUP:
        max_seen_statements = 1
    elif shape in {AnswerShape.CATEGORY_DISCOVERY_LIST, AnswerShape.CONDITION_OVERVIEW}:
        max_seen_statements = max(3, max_sources)
    elif shape == AnswerShape.JUDGMENT_CLAUSE:
        max_seen_statements = 1
    else:
        max_seen_statements = 3
    row_budget = max_sources
    if curriculum_course_settings_query:
        max_seen_statements = max(max_seen_statements, max_sources * 3)
    if shape == AnswerShape.TITLE_LOOKUP:
        max_seen_statements = official_web_reference_title_lookup_max_seen_statements(
            query_text=query_text,
            sources=consumable_sources,
            default_budget=max_seen_statements,
            max_sources=max_sources,
        )
    if shape == AnswerShape.CONDITION_OVERVIEW:
        quantified_row_budget = _condition_overview_quantified_row_budget(
            sources=consumable_sources,
            retrieval_intent=retrieval_intent,
        )
        max_seen_statements = max(max_seen_statements, quantified_row_budget)
        row_budget = max(row_budget, quantified_row_budget)
    ranked_sources = (
        tuple(ranked_source_input)
        if course_list_query
        or curriculum_lookup_query
        or shape == AnswerShape.CATEGORY_DISCOVERY_LIST
        else tuple(
            sorted(
                ranked_source_input,
                key=lambda source: _answer_source_sort_key(
                    query_text,
                    source,
                    mode=mode,
                    answer_shape=shape,
                    retrieval_intent=retrieval_intent,
                ),
                reverse=True,
            )
        )
    )
    ranked_sources = _filter_sources_for_query_subject_alignment(
        query_text=query_text,
        sources=ranked_sources,
        mode=mode,
        answer_shape=shape,
        retrieval_intent=retrieval_intent,
    )
    ranked_sources = _filter_sources_for_retrieval_intent_target_documents(
        sources=ranked_sources,
        retrieval_intent=retrieval_intent,
    )
    ranked_sources = _filter_sources_for_retrieval_intent_roles(
        sources=ranked_sources,
        retrieval_intent=retrieval_intent,
    )
    if not ranked_sources:
        return ()
    if shape == AnswerShape.CONDITION_OVERVIEW:
        ranked_sources = order_condition_overview_sources_for_policy_coverage(
            query_text=query_text,
            sources=ranked_sources,
            mode=mode,
            retrieval_intent=retrieval_intent,
            source_sort_key=_answer_source_sort_key,
        )
    if _requires_student_card_procedure_focus_filter(query_text=query_text, mode=mode):
        focused_sources = _filter_student_card_procedure_sources(ranked_sources)
        if focused_sources:
            ranked_sources = focused_sources
    ranked_sources = _order_procedure_sources_by_contract(
        sources=ranked_sources,
        answer_shape=shape,
        retrieval_intent=retrieval_intent,
    )
    if shape == AnswerShape.TITLE_LOOKUP and not course_list_query and not curriculum_lookup_query:
        ranked_sources = _filter_title_lookup_sources_for_answer_bearing_overview(
            query_text=query_text,
            sources=ranked_sources,
        )
        if not ranked_sources:
            return ()
    condition_overview_member_rows = (
        select_condition_overview_member_rows(
            query_text=query_text,
            sources=ranked_sources,
            mode=mode,
            retrieval_intent=retrieval_intent,
            max_sources=max_sources,
        )
        if shape == AnswerShape.CONDITION_OVERVIEW
        and retrieval_intent is not None
        and retrieval_intent.expected.selection_policy == "one_answer_ready_source_per_member"
        else None
    )
    if condition_overview_member_rows is not None:
        return condition_overview_member_rows
    strict_critical_source_filter = shape in {
        AnswerShape.CONDITION_OVERVIEW,
        AnswerShape.FACT_LOOKUP,
    } and any(
        _filter_statements_for_query_critical_terms(
            query_text=query_text,
            statements=_rank_source_statements(query_text, source, mode=mode),
        )
        for source in ranked_sources
    )
    rows: list[tuple[EvidenceSource, tuple[str, ...]]] = []
    seen_statements: set[str] = set()
    strict_condition_duration_filter = (
        shape == AnswerShape.CONDITION_OVERVIEW and query_asks_condition_duration_lookup(query_text)
    )

    for index, source in enumerate(ranked_sources):
        ranked_statements = _rank_source_statements(query_text, source, mode=mode)
        if shape in {AnswerShape.DETAIL_CLAUSE, AnswerShape.JUDGMENT_CLAUSE}:
            ranked_statements = _filter_statements_for_query_critical_terms(
                query_text=query_text,
                statements=ranked_statements,
            )
            ranked_statements = _prefer_non_intro_statements(ranked_statements)
        if shape == AnswerShape.JUDGMENT_CLAUSE:
            ranked_statements = tuple(
                _trim_judgment_statement_for_query(query_text=query_text, statement=statement)
                for statement in ranked_statements
            )
        if shape == AnswerShape.CATEGORY_DISCOVERY_LIST:
            ranked_statements = _filter_category_discovery_statements(ranked_statements)
        if shape in {AnswerShape.CONDITION_OVERVIEW, AnswerShape.FACT_LOOKUP}:
            critical_term_statements = _filter_statements_for_query_critical_terms(
                query_text=query_text,
                statements=ranked_statements,
            )
            if critical_term_statements:
                ranked_statements = critical_term_statements
            elif strict_critical_source_filter:
                ranked_statements = ()
        if shape == AnswerShape.CONDITION_OVERVIEW:
            ranked_statements = filter_condition_overview_statements(
                source=source,
                statements=ranked_statements,
                retrieval_intent=retrieval_intent,
            )
            if strict_condition_duration_filter:
                ranked_statements = tuple(
                    statement
                    for statement in ranked_statements
                    if statement_has_condition_duration_answer(statement)
                )
            ranked_statements = condition_overview_statement_budget(
                source=source,
                statements=ranked_statements,
                retrieval_intent=retrieval_intent,
                max_statements=max_seen_statements - len(seen_statements),
            )
        if shape == AnswerShape.TITLE_LOOKUP and _is_official_web_reference_query(
            query_text=query_text, source=source
        ):
            ranked_statements = _filter_official_web_reference_identity_statements(
                source=source,
                statements=ranked_statements,
            )
        if shape == AnswerShape.CONDITION_OVERVIEW and condition_overview_should_expand_statements(
            source=source,
            statements=ranked_statements,
            retrieval_intent=retrieval_intent,
        ):
            for statement in ranked_statements:
                statement_key = _statement_dedupe_key(
                    statement,
                    answer_shape=shape,
                )
                if statement_key in seen_statements:
                    continue
                rows.append((source, (statement,)))
                seen_statements.add(statement_key)
                if len(rows) >= row_budget or len(seen_statements) >= max_seen_statements:
                    break
            if len(rows) >= row_budget or len(seen_statements) >= max_seen_statements:
                break
            continue
        novel_statements = tuple(
            statement
            for statement in ranked_statements
            if _statement_dedupe_key(
                statement,
                answer_shape=shape,
            )
            not in seen_statements
        )
        if shape == AnswerShape.CATEGORY_DISCOVERY_LIST:
            novel_statements = tuple(novel_statements[:1])
            if not novel_statements:
                rows.append((source, ()))
                if len(rows) >= max_sources:
                    break
                continue
        if shape == AnswerShape.TITLE_LOOKUP:
            novel_statements = tuple(
                novel_statements[
                    : _title_lookup_statement_budget(
                        query_text=query_text,
                        source=source,
                    )
                ]
            )
        if shape == AnswerShape.JUDGMENT_CLAUSE:
            novel_statements = tuple(novel_statements[:1])
        if (
            shape == AnswerShape.TITLE_LOOKUP
            and retrieval_intent is not None
            and retrieval_intent.expected.selection_policy == "document_identity_first"
            and not novel_statements
        ):
            rows.append((source, ()))
            break
        if shape == AnswerShape.GENERAL_SUMMARY:
            novel_statements = tuple(
                statement
                for statement in novel_statements
                if not general_summary_is_off_nominal(
                    query_text=query_text,
                    text=statement,
                )
            )
            novel_statements = _select_general_summary_statements_for_facet_coverage(
                query_text=query_text,
                statements=novel_statements,
                covered_facets=_covered_general_summary_facets_for_rows(
                    query_text=query_text,
                    rows=tuple(rows),
                ),
            )
        if not novel_statements:
            continue
        rows.append((source, novel_statements))
        seen_statements.update(
            _statement_dedupe_key(statement, answer_shape=shape) for statement in novel_statements
        )
        if _should_stop_after_official_web_reference_rows(query_text=query_text, rows=tuple(rows)):
            break
        if (
            shape not in {AnswerShape.CATEGORY_DISCOVERY_LIST, AnswerShape.CONDITION_OVERVIEW}
            and not course_list_query
            and not curriculum_lookup_query
            and index == 0
            and len(novel_statements) >= 2
            and not _is_official_web_reference_query(query_text=query_text, source=source)
        ):
            break
        if shape == AnswerShape.JUDGMENT_CLAUSE:
            break
        if shape == AnswerShape.TITLE_LOOKUP and not (
            rows
            and official_web_reference_title_lookup_should_continue_rows(
                query_text=query_text,
                source=rows[0][0],
            )
        ):
            break
        if (
            (course_list_query or curriculum_lookup_query)
            and not curriculum_course_settings_query
            and len(rows) >= 2
            and len(seen_statements) >= 5
        ):
            break
        if (
            index == 0
            and mode == "time"
            and not _curriculum_course_settings_source(query_text=query_text, source=source)
            and any("学制" in statement for statement in novel_statements)
        ):
            break
        if len(rows) >= row_budget or len(seen_statements) >= max_seen_statements:
            break

    if rows:
        return tuple(rows)

    return ()


def _select_general_summary_statements_for_facet_coverage(
    *,
    query_text: str,
    statements: tuple[str, ...],
    covered_facets: frozenset[int],
) -> tuple[str, ...]:
    facets = general_summary_query_facets(query_text)
    if not facets or not statements:
        return statements
    uncovered = frozenset(range(len(facets))) - covered_facets
    if not uncovered:
        return tuple(statements[:1])
    ranked = sorted(
        statements,
        key=lambda statement: (
            len(general_summary_text_facet_indexes(statement, facets) & uncovered),
            general_summary_preferred_term_score(statement, facets),
            len(general_summary_text_facet_indexes(statement, facets)),
            len(statement),
        ),
        reverse=True,
    )
    selected: list[str] = []
    next_covered = set(covered_facets)
    if not uncovered:
        return ()
    for statement in ranked:
        statement_facets = general_summary_text_facet_indexes(statement, facets)
        if not (statement_facets - next_covered):
            continue
        selected.append(statement)
        next_covered.update(statement_facets)
        if len(selected) >= 1:
            break
    return tuple(selected)


def _covered_general_summary_facets_for_rows(
    *,
    query_text: str,
    rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> frozenset[int]:
    facets = general_summary_query_facets(query_text)
    if not facets:
        return frozenset()
    covered: set[int] = set()
    for _, statements in rows:
        for statement in statements:
            covered.update(general_summary_text_facet_indexes(statement, facets))
    return frozenset(covered)


__all__ = [
    "_answer_source_sort_key",
    "_filter_statements_for_query_critical_terms",
    "_filter_title_lookup_sources_for_answer_bearing_overview",
    "_select_answer_support_rows",
    "_should_ignore_official_web_source",
    "_should_lock_official_web_reference_answer",
    "_should_stop_after_official_web_reference_rows",
]
