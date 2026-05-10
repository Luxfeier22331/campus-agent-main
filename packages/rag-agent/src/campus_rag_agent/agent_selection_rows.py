from __future__ import annotations

from campus_contracts import EvidenceSource
from campus_retrieval_core.evidence_attributes import evidence_attributes_for_source
from campus_retrieval_core.evidence_ranking import query_targets_source_title
from campus_retrieval_core.evidence_semantics import (
    infer_query_condition_subject,
    semantic_alignment_score,
)

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
    _is_generic_intro_statement,
    _rank_source_statements,
    _score_source_statements,
)
from .agent_shared import _lead_source_title, _normalize_snippet
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
    consumable_sources = tuple(
        source for source in sources if not _should_ignore_official_web_source(source)
    )
    if not consumable_sources:
        return ()
    ranked_source_input = consumable_sources
    if course_list_query or curriculum_lookup_query:
        max_seen_statements = 6
    elif shape in {AnswerShape.CATEGORY_DISCOVERY_LIST, AnswerShape.CONDITION_OVERVIEW}:
        max_seen_statements = max(3, max_sources)
    elif shape == AnswerShape.JUDGMENT_CLAUSE:
        max_seen_statements = 1
    else:
        max_seen_statements = 3
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
    if shape == AnswerShape.TITLE_LOOKUP and not course_list_query and not curriculum_lookup_query:
        ranked_sources = _filter_title_lookup_sources_for_answer_bearing_overview(ranked_sources)
        if not ranked_sources:
            return ()
    rows: list[tuple[EvidenceSource, tuple[str, ...]]] = []
    seen_statements: set[str] = set()

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
        novel_statements = tuple(
            statement
            for statement in ranked_statements
            if _normalize_snippet(statement).lower() not in seen_statements
        )
        if shape == AnswerShape.CATEGORY_DISCOVERY_LIST:
            novel_statements = tuple(novel_statements[:1])
            if not novel_statements:
                rows.append((source, ()))
                if len(rows) >= max_sources:
                    break
                continue
        if shape == AnswerShape.JUDGMENT_CLAUSE:
            novel_statements = tuple(novel_statements[:1])
        if not novel_statements:
            continue
        rows.append((source, novel_statements))
        seen_statements.update(
            _normalize_snippet(statement).lower() for statement in novel_statements
        )
        if _should_stop_after_official_web_reference_rows(query_text=query_text, rows=tuple(rows)):
            break
        if (
            shape not in {AnswerShape.CATEGORY_DISCOVERY_LIST, AnswerShape.CONDITION_OVERVIEW}
            and not course_list_query
            and index == 0
            and len(novel_statements) >= 2
            and not _is_official_web_reference_query(query_text=query_text, source=source)
        ):
            break
        if shape == AnswerShape.JUDGMENT_CLAUSE:
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

    return ()


def _should_ignore_official_web_source(source: EvidenceSource) -> bool:
    return (
        _is_official_web_source(source)
        and source.content_role in _OFFICIAL_WEB_IGNORED_CONTENT_ROLES
    )


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
    retrieval_intent: RetrievalIntent | None = None,
) -> tuple[int, int, int, int, int, int, int, int]:
    scored = _score_source_statements(query_text, source, mode=mode)
    if not scored:
        return (0, 0, 0, 0, 0, 0, 0, 0)
    best_score = scored[0][0]
    total_score = sum(score for score, _ in scored[:3])
    return (
        _retrieval_intent_alignment_score(retrieval_intent=retrieval_intent, source=source),
        _query_anchor_match_score(query_text, source),
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
    return tuple(
        statement
        for statement in statements
        if _statement_covers_critical_groups(statement, critical_groups)
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
    return tuple(groups)


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
        if attributes.answer_role in retrieval_intent.expected.evidence_roles:
            score += 18
        elif attributes.answer_role:
            score -= 6
    return score


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
