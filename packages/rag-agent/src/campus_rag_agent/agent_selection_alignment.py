from __future__ import annotations

import re

from campus_contracts import EvidenceSource
from campus_retrieval_core.evidence_attributes import evidence_attributes_for_source
from campus_retrieval_core.evidence_ranking import query_targets_source_title
from campus_retrieval_core.evidence_semantics import (
    infer_query_condition_subject,
    semantic_alignment_score,
)
from campus_shared.regulation_semantic_registry import REGULATION_CONDITION_SUBJECT_DEFINITIONS

from .agent_answer_shape import AnswerShape
from .agent_official_web_reference_selection import (
    official_web_reference_title_lookup_should_continue_rows,
    official_web_reference_title_lookup_statement_budget,
)
from .agent_official_web_terms import (
    _OFFICIAL_WEB_IGNORED_CONTENT_ROLES,
    _is_official_web_reference_query,
    _is_official_web_source,
)
from .agent_selection_condition_overview import (
    condition_overview_source_quality_score,
    condition_overview_statement_budget,
    condition_overview_statement_dedupe_key,
)
from .agent_selection_statements import (
    _is_generic_intro_statement,
    _query_asks_curriculum_total_credits,
    _score_source_statements,
)
from .agent_shared import _normalize_snippet
from .agent_summary_facets import (
    general_summary_preferred_term_score,
    general_summary_query_facets,
    general_summary_text_facet_indexes,
)
from .retrieval_intent import RetrievalIntent


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
    *,
    query_text: str,
    sources: tuple[EvidenceSource, ...],
) -> tuple[EvidenceSource, ...]:
    return tuple(
        source
        for source in sources
        if not _is_table_like_answer_source(source)
        or _is_official_web_reference_query(query_text=query_text, source=source)
    )


def _title_lookup_statement_budget(*, query_text: str, source: EvidenceSource) -> int:
    return official_web_reference_title_lookup_statement_budget(
        query_text=query_text,
        source=source,
        default_budget=1,
    )


def _requires_student_card_procedure_focus_filter(*, query_text: str, mode: str) -> bool:
    if mode != "procedure":
        return False
    normalized_query = _normalize_snippet(query_text)
    return "学生证" in normalized_query and any(
        token in normalized_query for token in ("补办", "补发", "挂失", "遗失", "丢失", "丢了")
    )


def _filter_student_card_procedure_sources(
    sources: tuple[EvidenceSource, ...],
) -> tuple[EvidenceSource, ...]:
    return tuple(source for source in sources if _source_covers_student_card_procedure(source))


def _source_covers_student_card_procedure(source: EvidenceSource) -> bool:
    normalized_source = _normalize_snippet(
        " ".join(fragment for fragment in (source.detail_label, source.snippet) if fragment)
    )
    if not normalized_source:
        return False
    return "学生证" in normalized_source and any(
        token in normalized_source for token in ("补办", "补发", "挂失", "遗失", "损坏")
    )


def _order_procedure_sources_by_contract(
    *,
    sources: tuple[EvidenceSource, ...],
    answer_shape: AnswerShape,
    retrieval_intent: RetrievalIntent | None,
) -> tuple[EvidenceSource, ...]:
    if retrieval_intent is None or retrieval_intent.expected.answer_kind != "procedure_steps":
        return sources
    if answer_shape not in {AnswerShape.DETAIL_CLAUSE, AnswerShape.GENERAL_SUMMARY}:
        return sources
    indexed = tuple(
        source
        for source in sources
        if evidence_attributes_for_source(source).procedure.step_index is not None
    )
    if not indexed:
        return sources
    return tuple(
        sorted(
            sources,
            key=lambda source: _procedure_contract_order_key(source),
        )
    )


def _procedure_contract_order_key(source: EvidenceSource) -> tuple[int, int]:
    step_index = evidence_attributes_for_source(source).procedure.step_index
    if step_index is None:
        return (1, 0)
    return (0, step_index)


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
        " ".join(fragment for fragment in (source.detail_label, source.snippet) if fragment)
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
    if _query_asks_curriculum_total_credits(query_text) and _text_has_curriculum_total_credit_fact(
        normalized_source
    ):
        return 8
    if ("学制" in normalized_query or "几年" in normalized_query) and "学制" in normalized_source:
        return 8
    return 0


def _text_has_curriculum_total_credit_fact(text: str) -> bool:
    normalized = _normalize_snippet(text)
    if not normalized:
        return False
    if "总学分" in normalized:
        return True
    if re.search(r"(?:^|[|｜])\s*合计\s*(?:[|｜]\s*)+[0-9]{1,3}(?:\.\d+)?\s*$", normalized):
        return True
    return bool(re.search(r"(?:合计|共计(?:获得)?|总计)\s*[0-9]{1,3}(?:\.\d+)?\s*学分", normalized))


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
        groups.append(("总学分", "合计"))
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


def _filter_sources_for_retrieval_intent_roles(
    *,
    sources: tuple[EvidenceSource, ...],
    retrieval_intent: RetrievalIntent | None,
) -> tuple[EvidenceSource, ...]:
    if retrieval_intent is None:
        return sources
    if retrieval_intent.expected.selection_policy == "document_identity_first":
        return tuple(source for source in sources if _source_can_ground_document_identity(source))
    expected_roles = frozenset(
        role.strip() for role in retrieval_intent.expected.evidence_roles if role.strip()
    )
    if not expected_roles:
        return sources
    return tuple(
        source
        for source in sources
        if _source_matches_retrieval_intent_roles(source=source, expected_roles=expected_roles)
    )


def _source_matches_retrieval_intent_roles(
    *,
    source: EvidenceSource,
    expected_roles: frozenset[str],
) -> bool:
    attributes = evidence_attributes_for_source(source)
    source_roles = {
        role
        for role in (
            attributes.answer_role,
            attributes.semantic_role,
            source.semantic_role,
            source.content_role,
            source.content_kind,
        )
        if role
    }
    return bool(source_roles & expected_roles)


def _filter_sources_for_retrieval_intent_target_documents(
    *,
    sources: tuple[EvidenceSource, ...],
    retrieval_intent: RetrievalIntent | None,
) -> tuple[EvidenceSource, ...]:
    if retrieval_intent is None or not retrieval_intent.target.document_ids:
        return sources
    if (
        retrieval_intent.target.corpus != "curriculum"
        or retrieval_intent.target.collection != "curriculum_plan"
    ):
        return sources
    target_document_ids = frozenset(retrieval_intent.target.document_ids)
    return tuple(source for source in sources if source.doc_id in target_document_ids)


def _source_can_ground_document_identity(source: EvidenceSource) -> bool:
    if not source.is_answer_bearing and source.collection != "curriculum_plan":
        return False
    if _is_table_like_answer_source(source):
        return False
    if _should_ignore_official_web_source(source):
        return False
    return bool(_normalize_snippet(source.source_title))


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
    if official_web_reference_title_lookup_should_continue_rows(
        query_text=query_text,
        source=lead_source,
    ):
        return False
    return normalized_title in {
        "学校简介",
        "教学和科研单位",
        "中央民族大学大学教育收费公示表",
    }


__all__ = [
    "_answer_source_sort_key",
    "_condition_overview_quantified_row_budget",
    "_curriculum_course_settings_source",
    "_filter_category_discovery_statements",
    "_filter_official_web_reference_identity_statements",
    "_filter_sources_for_query_subject_alignment",
    "_filter_sources_for_retrieval_intent_roles",
    "_filter_sources_for_retrieval_intent_target_documents",
    "_filter_statements_for_query_critical_terms",
    "_filter_student_card_procedure_sources",
    "_filter_title_lookup_sources_for_answer_bearing_overview",
    "_is_table_like_answer_source",
    "_order_procedure_sources_by_contract",
    "_prefer_non_intro_statements",
    "_query_anchor_match_score",
    "_query_asks_curriculum_course_settings",
    "_query_critical_source_match_score",
    "_regulation_semantic_answer_sort_score",
    "_retrieval_intent_alignment_score",
    "_should_ignore_official_web_source",
    "_should_lock_official_web_reference_answer",
    "_should_stop_after_official_web_reference_rows",
    "_statement_dedupe_key",
    "_title_lookup_statement_budget",
    "_trim_judgment_statement_for_query",
]
