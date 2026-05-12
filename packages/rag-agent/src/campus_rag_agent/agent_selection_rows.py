from __future__ import annotations

from campus_contracts import EvidenceSource
from campus_retrieval_core.evidence_attributes import evidence_attributes_for_source
from campus_retrieval_core.evidence_ranking import query_targets_source_title
from campus_retrieval_core.evidence_semantics import (
    infer_query_condition_subject,
    semantic_alignment_score,
)
from campus_shared.regulation_semantic_registry import REGULATION_CONDITION_SUBJECT_DEFINITIONS

from .agent_answer_shape import AnswerShape
from .agent_condition_duration import (
    query_asks_condition_duration_lookup,
    statement_has_condition_duration_answer,
)
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
from .agent_selection_condition_overview import (
    condition_overview_should_expand_statements,
    condition_overview_source_quality_score,
    condition_overview_statement_budget,
    condition_overview_statement_dedupe_key,
    filter_condition_overview_statements,
    order_condition_overview_sources_for_policy_coverage,
    select_condition_overview_member_rows,
)
from .agent_selection_query import _query_mode
from .agent_selection_statements import (
    _is_generic_intro_statement,
    _rank_source_statements,
    _score_source_statements,
)
from .agent_shared import _lead_source_title, _normalize_snippet
from .agent_summary_facets import (
    general_summary_is_off_nominal,
    general_summary_preferred_term_score,
    general_summary_query_facets,
    general_summary_text_facet_indexes,
)
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
    if shape == AnswerShape.CONDITION_OVERVIEW:
        ranked_sources = order_condition_overview_sources_for_policy_coverage(
            query_text=query_text,
            sources=ranked_sources,
            mode=mode,
            retrieval_intent=retrieval_intent,
            source_sort_key=_answer_source_sort_key,
        )
    if shape == AnswerShape.TITLE_LOOKUP and not course_list_query and not curriculum_lookup_query:
        ranked_sources = _filter_title_lookup_sources_for_answer_bearing_overview(ranked_sources)
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
        shape == AnswerShape.CONDITION_OVERVIEW
        and query_asks_condition_duration_lookup(query_text)
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
        if (
            shape == AnswerShape.TITLE_LOOKUP
            and _is_official_web_reference_query(query_text=query_text, source=source)
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
            novel_statements = tuple(novel_statements[:1])
        if shape == AnswerShape.JUDGMENT_CLAUSE:
            novel_statements = tuple(novel_statements[:1])
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
            _statement_dedupe_key(statement, answer_shape=shape)
            for statement in novel_statements
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
        if shape == AnswerShape.TITLE_LOOKUP:
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


def _should_ignore_official_web_source(source: EvidenceSource) -> bool:
    return (
        _is_official_web_source(source)
        and source.content_role in _OFFICIAL_WEB_IGNORED_CONTENT_ROLES
    )


def _statement_dedupe_key(statement: str, *, answer_shape: AnswerShape) -> str:
    if answer_shape == AnswerShape.CONDITION_OVERVIEW:
        return condition_overview_statement_dedupe_key(statement)
    return _normalize_snippet(statement).lower()


def _condition_overview_quantified_row_budget(
    *,
    sources: tuple[EvidenceSource, ...],
    retrieval_intent: RetrievalIntent | None,
) -> int:
    row_count = 0
    for source in sources:
        statements = condition_overview_statement_budget(
            source=source,
            statements=(),
            retrieval_intent=retrieval_intent,
            max_statements=99,
        )
        row_count = max(row_count, len(statements))
    return row_count


def _curriculum_course_settings_source(*, query_text: str, source: EvidenceSource) -> bool:
    if source.collection != "curriculum_plan" or source.content_role != "table_fact":
        return False
    normalized_query = _normalize_snippet(query_text)
    return "课程设置" in normalized_query or "修读建议" in normalized_query


def _query_asks_curriculum_course_settings(query_text: str) -> bool:
    normalized_query = _normalize_snippet(query_text)
    return "课程设置" in normalized_query or "修读建议" in normalized_query


def _filter_title_lookup_sources_for_answer_bearing_overview(
    sources: tuple[EvidenceSource, ...],
) -> tuple[EvidenceSource, ...]:
    return tuple(source for source in sources if not _is_table_like_answer_source(source))


def _is_table_like_answer_source(source: EvidenceSource) -> bool:
    return source.content_role == "table_fact" or source.content_kind == "table_unit"


def _answer_source_sort_key(
    query_text: str,
    source: EvidenceSource,
    *,
    mode: str,
    answer_shape: AnswerShape | None = None,
    retrieval_intent: RetrievalIntent | None = None,
) -> tuple[int, ...]:
    condition_overview_quality_score = (
        condition_overview_source_quality_score(source)
        if answer_shape == AnswerShape.CONDITION_OVERVIEW
        else 0
    )
    curriculum_fact_quality_score = _curriculum_fact_source_quality_score(
        query_text=query_text,
        source=source,
        answer_shape=answer_shape,
    )
    general_summary_facet_score = _general_summary_source_facet_score(
        query_text=query_text,
        source=source,
        answer_shape=answer_shape,
    )
    scored = _score_source_statements(query_text, source, mode=mode)
    if not scored:
        return (
            _retrieval_intent_alignment_score(retrieval_intent=retrieval_intent, source=source),
            _query_anchor_match_score(query_text, source),
            condition_overview_quality_score,
            curriculum_fact_quality_score,
            general_summary_facet_score,
            _regulation_semantic_answer_sort_score(
                query_text=query_text,
                source=source,
                retrieval_intent=retrieval_intent,
            ),
            _query_critical_source_match_score(query_text, source),
            0,
            0,
            0,
            1 if source.is_answer_bearing else 0,
        )
    best_score = scored[0][0]
    total_score = sum(score for score, _ in scored[:3])
    return (
        _retrieval_intent_alignment_score(retrieval_intent=retrieval_intent, source=source),
        _query_anchor_match_score(query_text, source),
        condition_overview_quality_score,
        curriculum_fact_quality_score,
        general_summary_facet_score,
        _regulation_semantic_answer_sort_score(
            query_text=query_text,
            source=source,
            retrieval_intent=retrieval_intent,
        ),
        _query_critical_source_match_score(query_text, source),
        best_score,
        total_score,
        len(scored),
        1 if source.is_answer_bearing else 0,
    )


def _curriculum_fact_source_quality_score(
    *,
    query_text: str,
    source: EvidenceSource,
    answer_shape: AnswerShape | None,
) -> int:
    if answer_shape != AnswerShape.FACT_LOOKUP or source.collection != "curriculum_plan":
        return 0
    normalized_query = _normalize_snippet(query_text)
    normalized_source = _normalize_snippet(
        " ".join(
            fragment
            for fragment in (source.detail_label, source.snippet)
            if fragment
        )
    )
    if not normalized_source:
        return 0
    if "总学分" in normalized_query or "学分要求" in normalized_query:
        if "学制、总学分和学位授予" in normalized_source:
            return 8
        if "总学分" in normalized_source and "|" not in normalized_source:
            return 6
        if "总学分" in normalized_source:
            return 3
    if ("学制" in normalized_query or "几年" in normalized_query) and "学制" in normalized_source:
        return 8
    return 0


def _general_summary_source_facet_score(
    *,
    query_text: str,
    source: EvidenceSource,
    answer_shape: AnswerShape | None,
) -> int:
    if answer_shape != AnswerShape.GENERAL_SUMMARY:
        return 0
    facets = general_summary_query_facets(query_text)
    if not facets:
        return 0
    text = " ".join(
        fragment
        for fragment in (
            source.detail_label,
            source.snippet,
        )
        if fragment
    )
    facet_count = len(general_summary_text_facet_indexes(text, facets))
    if not facet_count:
        return 0
    return facet_count * 36 + general_summary_preferred_term_score(text, facets)


def _regulation_semantic_answer_sort_score(
    *,
    query_text: str,
    source: EvidenceSource,
    retrieval_intent: RetrievalIntent | None = None,
) -> int:
    if source.collection not in {"student_rules", "institutional_rules"}:
        return 0
    if retrieval_intent is not None:
        return _retrieval_intent_alignment_score(retrieval_intent=retrieval_intent, source=source)
    return semantic_alignment_score(query_text=query_text, source=source)


def _filter_statements_for_query_critical_terms(
    *,
    query_text: str,
    statements: tuple[str, ...],
) -> tuple[str, ...]:
    critical_groups = _query_critical_term_groups(query_text)
    if not critical_groups:
        return statements
    strict_matches = tuple(
        statement
        for statement in statements
        if _statement_covers_critical_groups(statement, critical_groups)
    )
    if strict_matches:
        return strict_matches
    return tuple(
        statement
        for statement in statements
        if _statement_covers_any_critical_group(statement, critical_groups)
    )


def _query_critical_term_groups(query_text: str) -> tuple[tuple[str, ...], ...]:
    normalized = _normalize_snippet(query_text)
    groups: list[tuple[str, ...]] = []
    if any(
        cue in normalized
        for cue in (
            "没前十",
            "没前10",
            "没进前十",
            "没进前10",
            "不在前十",
            "不在前10",
            "前十之外",
            "前10之外",
            "前十以外",
            "前10以外",
            "超出前十",
            "超出前10",
        )
    ):
        groups.append(("前10", "前十"))
        if "前30" in normalized or "前三十" in normalized:
            groups.append(("前30", "前三十"))
    if "论文" in normalized:
        groups.append(("论文", "发表"))
    if "著作" in normalized:
        groups.append(("著作", "出版"))
    if "专利" in normalized:
        groups.append(("专利", "发明"))
    if "竞赛" in normalized:
        groups.append(("竞赛", "比赛"))
    if "旷课" in normalized:
        groups.append(("旷课",))
        if "学时" in normalized or "多少" in normalized:
            groups.extend(
                _condition_subject_focus_equivalent_groups("attendance_absence_threshold")
            )
    if "解除处分" in normalized or "处分解除" in normalized:
        groups.append(("解除处分", "解除纪律处分"))
        if any(token in normalized for token in ("多久", "多长时间", "什么时候", "何时")):
            groups.append(("考察期", "期满", "届满"))
    if "总学分" in normalized:
        groups.append(("总学分",))
    if "学制" in normalized or "几年" in normalized:
        groups.append(("学制",))
    return tuple(groups)


def _condition_subject_focus_equivalent_groups(
    condition_subject: str,
) -> tuple[tuple[str, ...], ...]:
    definition = REGULATION_CONDITION_SUBJECT_DEFINITIONS.get(condition_subject)
    if definition is None:
        return ()
    return definition.query_focus_equivalents


def _query_anchor_match_score(query_text: str, source: EvidenceSource) -> int:
    normalized_query = _normalize_snippet(query_text)
    if not normalized_query:
        return 0
    score = 0
    if source.detail_label and source.detail_label in normalized_query:
        score += 2
    if source.article_no and f"第{source.article_no}条" in normalized_query:
        score += 2
    if source.clause_no and f"第{source.clause_no}款" in normalized_query:
        score += 1
    return score


def _query_critical_source_match_score(query_text: str, source: EvidenceSource) -> int:
    groups = _query_critical_term_groups(query_text)
    if not groups:
        return 0
    normalized = _normalize_snippet(
        " ".join(
            fragment
            for fragment in (
                source.source_title,
                source.detail_label,
                source.snippet,
            )
            if fragment
        )
    )
    if not normalized:
        return 0
    return sum(1 for group in groups if any(term in normalized for term in group))


def _statement_covers_critical_groups(
    statement: str,
    groups: tuple[tuple[str, ...], ...],
) -> bool:
    normalized = _normalize_snippet(statement)
    return all(any(term in normalized for term in group) for group in groups)


def _statement_covers_any_critical_group(
    statement: str,
    groups: tuple[tuple[str, ...], ...],
) -> bool:
    normalized = _normalize_snippet(statement)
    return any(any(term in normalized for term in group) for group in groups)


def _prefer_non_intro_statements(statements: tuple[str, ...]) -> tuple[str, ...]:
    filtered = tuple(
        statement for statement in statements if not _is_generic_intro_statement(statement)
    )
    return filtered or statements


def _filter_category_discovery_statements(statements: tuple[str, ...]) -> tuple[str, ...]:
    filtered: list[str] = []
    for statement in statements:
        normalized = _normalize_snippet(statement)
        if not normalized:
            continue
        if _is_generic_intro_statement(normalized):
            continue
        if any(cue in normalized for cue in ("流程", "步骤", "程序", "审核", "审定", "推荐")):
            continue
        if any(cue in normalized for cue in ("公示", "审批", "报送学生处", "最终名单")):
            continue
        if any(cue in normalized for cue in ("不得", "不得同时", "不能", "不予", "取消")):
            continue
        if "同时申请" in normalized:
            continue
        filtered.append(statement)
    return tuple(filtered)


def _filter_official_web_reference_identity_statements(
    *,
    source: EvidenceSource,
    statements: tuple[str, ...],
) -> tuple[str, ...]:
    substantive_statements = tuple(
        statement
        for statement in statements
        if not _is_official_web_reference_identity_statement(source=source, statement=statement)
    )
    return substantive_statements or statements


def _is_official_web_reference_identity_statement(
    *,
    source: EvidenceSource,
    statement: str,
) -> bool:
    normalized_statement = _normalize_snippet(statement).strip("《》:：，,。 ")
    normalized_title = _normalize_snippet(source.source_title).strip("《》:：，,。 ")
    if not normalized_statement or not normalized_title:
        return False
    return normalized_statement in {
        normalized_title,
        f"中央民族大学{normalized_title}",
    }


def _filter_sources_for_query_subject_alignment(
    *,
    query_text: str,
    sources: tuple[EvidenceSource, ...],
    mode: str,
    answer_shape: AnswerShape,
    retrieval_intent: RetrievalIntent | None = None,
) -> tuple[EvidenceSource, ...]:
    if not sources or answer_shape == AnswerShape.CATEGORY_DISCOVERY_LIST:
        return sources
    if answer_shape in {AnswerShape.DETAIL_CLAUSE, AnswerShape.JUDGMENT_CLAUSE}:
        critical_groups = _query_critical_term_groups(query_text)
        if critical_groups:
            aligned = tuple(
                source
                for source in sources
                if _statement_covers_critical_groups(source.snippet, critical_groups)
            )
            if aligned:
                return aligned
    query_subject = (
        retrieval_intent.target.condition_subject
        if retrieval_intent is not None and retrieval_intent.target.condition_subject
        else infer_query_condition_subject(query_text)
    )
    if mode == "time":
        aligned = tuple(
            source
            for source in sources
            if evidence_attributes_for_source(source).condition_subject == "deadline"
        )
        return aligned or sources
    if mode == "generic" and query_subject == "material_requirement":
        aligned = tuple(
            source
            for source in sources
            if evidence_attributes_for_source(source).condition_subject == "material_requirement"
        )
        return aligned or sources
    if mode == "generic" and query_subject:
        aligned = tuple(
            source
            for source in sources
            if evidence_attributes_for_source(source).condition_subject == query_subject
            or evidence_attributes_for_source(source).condition_group_subject == query_subject
        )
        return aligned or sources
    return sources


def _retrieval_intent_alignment_score(
    *,
    retrieval_intent: RetrievalIntent | None,
    source: EvidenceSource,
) -> int:
    if retrieval_intent is None:
        return 0
    attributes = evidence_attributes_for_source(source)
    score = 0
    if retrieval_intent.target.condition_subject:
        if attributes.condition_subject == retrieval_intent.target.condition_subject:
            score += 48
        elif attributes.condition_group_subject == retrieval_intent.target.condition_subject:
            score += 32
        elif attributes.condition_subject or attributes.condition_group_subject:
            score -= 12
    if retrieval_intent.expected.evidence_roles:
        role_priority = _retrieval_intent_answer_role_priority(
            retrieval_intent=retrieval_intent,
            answer_role=attributes.answer_role,
        )
        if role_priority > 0:
            score += role_priority
        elif attributes.answer_role:
            score -= 6
    return score


def _retrieval_intent_answer_role_priority(
    *,
    retrieval_intent: RetrievalIntent,
    answer_role: str,
) -> int:
    roles = tuple(role for role in retrieval_intent.expected.evidence_roles if role)
    if not answer_role or answer_role not in roles:
        return 0
    return 28 + (len(roles) - roles.index(answer_role)) * 6


def _trim_judgment_statement_for_query(*, query_text: str, statement: str) -> str:
    normalized_query = _normalize_snippet(query_text)
    normalized_statement = _normalize_snippet(statement)
    if not normalized_statement:
        return ""
    if any(
        cue in normalized_query
        for cue in (
            "没前十",
            "没前10",
            "没进前十",
            "没进前10",
            "不在前十",
            "不在前10",
            "前十之外",
            "前10之外",
            "前十以外",
            "前10以外",
            "超出前十",
            "超出前10",
        )
    ):
        for cue in ("必须在道德风尚", "必须在某一方面表现特别优秀", "且可提供相应的证明材料"):
            if cue in normalized_statement:
                normalized_statement = normalized_statement.split(cue, 1)[0].rstrip("，,；;。 ")
                break
        for cue in ("具体表现如下", "表现如下"):
            if cue in normalized_statement:
                normalized_statement = normalized_statement.split(cue, 1)[0].rstrip("，,；;。 ")
                break
    return normalized_statement


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
    "_filter_title_lookup_sources_for_answer_bearing_overview",
    "_select_answer_support_rows",
    "_should_ignore_official_web_source",
    "_should_lock_official_web_reference_answer",
    "_should_stop_after_official_web_reference_rows",
]
