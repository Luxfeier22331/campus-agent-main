from __future__ import annotations

import re

from campus_contracts import EvidenceSource
from campus_retrieval_core.evidence_attributes import evidence_attributes_for_source
from campus_shared.regulation_semantic_registry import REGULATION_CONDITION_SUBJECT_DEFINITIONS

from .agent_answer_shape import AnswerShape
from .agent_selection_statements import (
    _extract_source_statements,
    _is_generic_intro_statement,
    _rank_source_statements,
    _score_source_statements,
)
from .agent_shared import _normalize_snippet
from .retrieval_intent import RetrievalIntent

_CONDITION_OVERVIEW_MEMBER_ROW_ROLE_PRIORITY = {
    "eligibility_condition": 80,
    "exception_rule": 70,
    "exclusion_rule": 70,
    "table_fact": 60,
    "time_constraint": 50,
    "material_requirement": 45,
    "eligibility_intro": 10,
}


def order_condition_overview_sources_for_policy_coverage(
    *,
    query_text: str,
    sources: tuple[EvidenceSource, ...],
    mode: str,
    retrieval_intent: RetrievalIntent | None,
    source_sort_key,
) -> tuple[EvidenceSource, ...]:
    best_source_by_doc: dict[str, EvidenceSource] = {}
    remaining_sources: list[EvidenceSource] = []
    for source in sources:
        if condition_overview_source_quality_score(source) < 0 and not (
            retrieval_intent is not None
            and source.doc_id in retrieval_intent.target.category_member_document_ids
            and filter_condition_overview_statements(
                source=source,
                statements=_rank_source_statements(query_text, source, mode=mode),
                retrieval_intent=retrieval_intent,
            )
        ):
            remaining_sources.append(source)
            continue
        doc_id = source.doc_id
        if not doc_id:
            remaining_sources.append(source)
            continue
        current = best_source_by_doc.get(doc_id)
        if current is None:
            best_source_by_doc[doc_id] = source
            continue
        if source_sort_key(
            query_text,
            source,
            mode=mode,
            answer_shape=AnswerShape.CONDITION_OVERVIEW,
            retrieval_intent=retrieval_intent,
        ) > source_sort_key(
            query_text,
            current,
            mode=mode,
            answer_shape=AnswerShape.CONDITION_OVERVIEW,
            retrieval_intent=retrieval_intent,
        ):
            remaining_sources.append(current)
            best_source_by_doc[doc_id] = source
        else:
            remaining_sources.append(source)
    best_sources = tuple(
        sorted(
            best_source_by_doc.values(),
            key=lambda source: source_sort_key(
                query_text,
                source,
                mode=mode,
                answer_shape=AnswerShape.CONDITION_OVERVIEW,
                retrieval_intent=retrieval_intent,
            ),
            reverse=True,
        )
    )
    member_doc_ids = (
        retrieval_intent.target.category_member_document_ids
        if retrieval_intent is not None
        else ()
    )
    if member_doc_ids:
        member_sources = tuple(
            best_source_by_doc[doc_id] for doc_id in member_doc_ids if doc_id in best_source_by_doc
        )
        selected_keys = {_condition_overview_source_key(source) for source in member_sources}
        non_member_best_sources = tuple(
            source
            for source in best_sources
            if _condition_overview_source_key(source) not in selected_keys
        )
        selected_keys.update(
            _condition_overview_source_key(source) for source in non_member_best_sources
        )
        return (
            *member_sources,
            *non_member_best_sources,
            *tuple(
                source
                for source in sources
                if source in remaining_sources
                and _condition_overview_source_key(source) not in selected_keys
            ),
        )
    return (
        *best_sources,
        *tuple(
            source
            for source in sources
            if source not in best_sources and source in remaining_sources
        ),
    )


def filter_condition_overview_statements(
    *,
    source: EvidenceSource,
    statements: tuple[str, ...],
    retrieval_intent: RetrievalIntent | None,
) -> tuple[str, ...]:
    if not statements:
        return ()
    if retrieval_intent is None or retrieval_intent.expected.answer_kind != "condition_table":
        return _filter_off_target_condition_fact_statements(statements)
    expected_roles = set(retrieval_intent.expected.evidence_roles)
    if not expected_roles:
        return _filter_off_target_condition_fact_statements(statements)
    attributes = evidence_attributes_for_source(source)
    if attributes.answer_role in expected_roles:
        return _filter_off_target_condition_fact_statements(
            statements,
            source=source,
            retrieval_intent=retrieval_intent,
        )
    return ()


def condition_overview_statement_budget(
    *,
    source: EvidenceSource,
    statements: tuple[str, ...],
    retrieval_intent: RetrievalIntent | None,
    max_statements: int = 1,
) -> tuple[str, ...]:
    if max_statements <= 0:
        return ()
    row_statements = condition_overview_quantified_row_statements(
        source=source,
        retrieval_intent=retrieval_intent,
    )
    if row_statements:
        return _limit_condition_overview_statements(
            row_statements,
            max_statements=max_statements,
        )
    return tuple(statements[:max_statements])


def condition_overview_should_expand_statements(
    *,
    source: EvidenceSource,
    statements: tuple[str, ...],
    retrieval_intent: RetrievalIntent | None,
) -> bool:
    if len(statements) <= 1:
        return False
    row_statements = condition_overview_quantified_row_statements(
        source=source,
        retrieval_intent=retrieval_intent,
    )
    return bool(row_statements) and set(statements).issubset(set(row_statements))


def condition_overview_statement_dedupe_key(statement: str) -> str:
    normalized = _normalize_snippet(statement).lower()
    normalized = re.sub(
        r"^(?:参评|申请)?[^，,。；;:：]{0,24}(?:奖学金|奖助学金|助学金)"
        r"(?:的学生)?(?:还)?(?:应当|应该|须|需|必须|要)",
        "",
        normalized,
    )
    normalized = normalized.strip(" ，,。；;:：")
    return normalized or _normalize_snippet(statement).lower()


def _filter_off_target_condition_fact_statements(
    statements: tuple[str, ...],
    *,
    source: EvidenceSource | None = None,
    retrieval_intent: RetrievalIntent | None = None,
) -> tuple[str, ...]:
    filtered: list[str] = []
    for statement in statements:
        normalized = _normalize_off_target_condition_fact_statement(
            statement,
            source=source,
            retrieval_intent=retrieval_intent,
        )
        if not normalized:
            continue
        if _is_off_target_condition_fact_statement(
            normalized,
            source=source,
            retrieval_intent=retrieval_intent,
        ):
            continue
        filtered.append(normalized)
    return tuple(filtered)


def _is_off_target_condition_fact_statement(
    statement: str,
    *,
    source: EvidenceSource | None,
    retrieval_intent: RetrievalIntent | None,
) -> bool:
    normalized = _normalize_snippet(statement)
    if not normalized:
        return True
    if any(cue in normalized for cue in ("颁发荣誉证书", "颁发证书", "获得者颁发")):
        return True
    return _is_review_action_statement_without_condition_predicate(
        normalized,
        source=source,
        retrieval_intent=retrieval_intent,
    )


def _is_review_action_statement_without_condition_predicate(
    statement: str,
    *,
    source: EvidenceSource | None,
    retrieval_intent: RetrievalIntent | None,
) -> bool:
    if retrieval_intent is None or retrieval_intent.expected.answer_kind != "condition_table":
        return False
    if source is not None and evidence_attributes_for_source(source).answer_role not in {
        "eligibility_condition",
        "eligibility_intro",
    }:
        return False
    compact = "".join(statement.split())
    if not compact:
        return True
    if _has_condition_overview_predicate(compact):
        return False
    return any(
        cue in compact
        for cue in (
            "本人申请",
            "民主评议",
            "评议推荐",
            "推荐",
            "审核",
            "审批",
            "公示",
            "报送",
            "复评",
            "复审",
        )
    )


def _has_condition_overview_predicate(compact_statement: str) -> bool:
    return any(
        cue in compact_statement
        for cue in (
            "符合",
            "满足",
            "具备",
            "应当",
            "应为",
            "须",
            "需",
            "必须",
            "可申请",
            "可以申请",
            "不得",
            "不能",
            "不予",
            "条件之一",
            "基本条件",
            "评选条件",
            "评选要求",
            "申请资格",
            "参评资格",
            "成绩",
            "排名",
            "综合测评",
            "遵纪守法",
            "诚实守信",
            "热爱祖国",
            "家庭经济困难",
        )
    )


def _normalize_off_target_condition_fact_statement(
    statement: str,
    *,
    source: EvidenceSource | None,
    retrieval_intent: RetrievalIntent | None,
) -> str:
    normalized = _normalize_snippet(statement)
    if not normalized:
        return ""
    if (
        source is not None
        and retrieval_intent is not None
        and evidence_attributes_for_source(source).answer_role == "table_fact"
        and retrieval_intent.target.condition_subject == "amount_or_quota"
    ):
        normalized = _trim_amount_or_quota_table_fact_statement(normalized)
    return normalized


def _trim_amount_or_quota_table_fact_statement(statement: str) -> str:
    normalized = _normalize_snippet(statement)
    if not normalized:
        return ""
    amount_match = re.search(
        r"(其中,)?[^。；;]*?(?:奖励标准|奖金额度|金额标准|标准为)[^。；;]*",
        normalized,
    )
    if amount_match is not None:
        return amount_match.group(0).lstrip("，,")
    return normalized


def select_condition_overview_member_rows(
    *,
    query_text: str,
    sources: tuple[EvidenceSource, ...],
    mode: str,
    retrieval_intent: RetrievalIntent | None,
    max_sources: int,
) -> tuple[tuple[EvidenceSource, tuple[str, ...]], ...] | None:
    member_doc_ids = (
        retrieval_intent.target.category_member_document_ids
        if retrieval_intent is not None
        else ()
    )
    if not member_doc_ids or max_sources <= 0:
        return None
    rows: list[tuple[EvidenceSource, tuple[str, ...]]] = []
    seen_statement_keys: set[str] = set()
    for doc_id in member_doc_ids:
        candidates = tuple(source for source in sources if source.doc_id == doc_id)
        row = _select_condition_overview_row_for_doc(
            query_text=query_text,
            sources=candidates,
            mode=mode,
            retrieval_intent=retrieval_intent,
            seen_statement_keys=seen_statement_keys,
        )
        if row is None:
            continue
        source, statements = row
        rows.append((source, statements))
        seen_statement_keys.update(
            _member_condition_statement_key(source=source, statement=item) for item in statements
        )
        seen_statement_keys.update(
            condition_overview_statement_dedupe_key(item) for item in statements
        )
        if len(rows) >= max_sources:
            break
    return tuple(rows)


def _select_condition_overview_row_for_doc(
    *,
    query_text: str,
    sources: tuple[EvidenceSource, ...],
    mode: str,
    retrieval_intent: RetrievalIntent,
    seen_statement_keys: set[str],
) -> tuple[EvidenceSource, tuple[str, ...]] | None:
    candidates: list[tuple[tuple[int, int, int, int, int], EvidenceSource, str]] = []
    for source in sources:
        statements = filter_condition_overview_statements(
            source=source,
            statements=_rank_source_statements(query_text, source, mode=mode),
            retrieval_intent=retrieval_intent,
        )
        for statement in statements:
            if not _condition_overview_statement_matches_source_policy(
                source=source,
                statement=statement,
            ):
                continue
            semantic_key = condition_overview_statement_dedupe_key(statement)
            member_key = _member_condition_statement_key(source=source, statement=statement)
            if member_key in seen_statement_keys:
                continue
            if (
                semantic_key in seen_statement_keys
                and not _is_policy_specific_intro_statement(statement)
            ):
                continue
            candidates.append(
                (
                    _condition_overview_member_candidate_sort_key(
                        query_text=query_text,
                        source=source,
                        statement=statement,
                        mode=mode,
                        retrieval_intent=retrieval_intent,
                    ),
                    source,
                    statement,
                )
            )
    if not candidates:
        return None
    _, source, statement = max(candidates, key=lambda item: item[0])
    return source, (statement,)


def _condition_overview_member_candidate_sort_key(
    *,
    query_text: str,
    source: EvidenceSource,
    statement: str,
    mode: str,
    retrieval_intent: RetrievalIntent | None,
) -> tuple[int, int, int, int, int, int]:
    attributes = evidence_attributes_for_source(source)
    scored_statements = dict(
        (scored_statement, score)
        for score, scored_statement in _score_source_statements(query_text, source, mode=mode)
    )
    return (
        _condition_overview_expected_role_priority(
            answer_role=attributes.answer_role,
            retrieval_intent=retrieval_intent,
        ),
        _CONDITION_OVERVIEW_MEMBER_ROW_ROLE_PRIORITY.get(attributes.answer_role, 0),
        condition_overview_source_quality_score(source),
        scored_statements.get(statement, 0),
        0 if _is_generic_intro_statement(statement) else 1,
        len(_normalize_snippet(statement)),
    )


def _condition_overview_expected_role_priority(
    *,
    answer_role: str,
    retrieval_intent: RetrievalIntent | None,
) -> int:
    if retrieval_intent is None:
        return 0
    expected_roles = tuple(
        role.strip() for role in retrieval_intent.expected.evidence_roles if role.strip()
    )
    if not expected_roles or answer_role not in expected_roles:
        return 0
    return len(expected_roles) - expected_roles.index(answer_role)


def _member_condition_statement_key(*, source: EvidenceSource, statement: str) -> str:
    policy_label = _condition_overview_policy_label(source.source_title)
    statement_key = condition_overview_statement_dedupe_key(statement)
    return f"{policy_label}:{statement_key}" if policy_label else statement_key


def _condition_overview_statement_matches_source_policy(
    *,
    source: EvidenceSource,
    statement: str,
) -> bool:
    source_label = _condition_overview_policy_label(source.source_title)
    if not source_label:
        return True
    statement_labels = _condition_overview_policy_labels(statement)
    return not statement_labels or source_label in statement_labels


def _condition_overview_policy_label(text: str) -> str:
    labels = _condition_overview_policy_labels(text)
    return labels[0] if labels else ""


def _condition_overview_policy_labels(text: str) -> tuple[str, ...]:
    normalized = _normalize_snippet(text)
    labels: list[str] = []
    for label in (
        "国家励志奖学金",
        "国家奖学金",
        "专业奖学金",
        "专项奖学金",
        "社会奖助学金",
        "社会奖学金",
        "国家助学金",
    ):
        if label in normalized:
            labels.append(label)
    return tuple(labels)


def _is_policy_specific_intro_statement(statement: str) -> bool:
    return _is_generic_intro_statement(statement) and bool(
        _condition_overview_policy_labels(statement)
    )


def condition_overview_quantified_row_statements(
    *,
    source: EvidenceSource,
    retrieval_intent: RetrievalIntent | None,
) -> tuple[str, ...]:
    if retrieval_intent is None or retrieval_intent.expected.answer_kind != "condition_table":
        return ()
    condition_subject = retrieval_intent.target.condition_subject.strip()
    if not condition_subject:
        return ()
    definition = REGULATION_CONDITION_SUBJECT_DEFINITIONS.get(condition_subject)
    if definition is None:
        return ()
    attributes = evidence_attributes_for_source(source)
    if attributes.answer_role not in retrieval_intent.expected.evidence_roles:
        return ()
    statements = _extract_source_statements(source)
    threshold_rows = tuple(
        statement for statement in statements if _is_quantified_condition_statement(statement)
    )
    if not threshold_rows:
        return ()
    return tuple(
        statement
        for statement in threshold_rows
        if _statement_matches_condition_subject(
            statement=statement,
            condition_subject=condition_subject,
        )
    )


def _is_quantified_condition_statement(statement: str) -> bool:
    normalized = _normalize_snippet(statement)
    if not normalized:
        return False
    return bool(
        re.search(r"\d+(?:\s*[-－—至到]\s*\d+)?\s*(?:节|学时|课时)", normalized)
        or re.search(r"\d+\s*(?:%|％|元|人|名|个|项|年|月|日)", normalized)
    )


def _statement_matches_condition_subject(
    *,
    statement: str,
    condition_subject: str,
) -> bool:
    definition = REGULATION_CONDITION_SUBJECT_DEFINITIONS.get(condition_subject)
    if definition is None:
        return False
    normalized = _normalize_snippet(statement)
    if not normalized:
        return False
    direct_terms = tuple(term for term in definition.query_focus_terms if term)
    if direct_terms and not any(term in normalized for term in direct_terms):
        return False
    return all(
        any(term in normalized for term in equivalent_group if term)
        for equivalent_group in definition.query_focus_equivalents
    )


def _limit_condition_overview_statements(
    statements: tuple[str, ...],
    *,
    max_statements: int,
) -> tuple[str, ...]:
    if len(statements) <= max_statements:
        return statements
    if max_statements == 1:
        return (statements[0],)
    return (*statements[: max_statements - 1], statements[-1])


def condition_overview_source_quality_score(source: EvidenceSource) -> int:
    attributes = evidence_attributes_for_source(source)
    if attributes.answer_role != "eligibility_condition":
        return 0
    normalized = _normalize_snippet(source.snippet)
    score = 0
    for cue in (
        "学习成绩",
        "学业成绩",
        "成绩优异",
        "成绩优秀",
        "成绩优良",
        "单科成绩",
        "平均成绩",
        "综合测评",
        "排名",
        "遵纪守法",
        "遵守学校规章制度",
        "诚实守信",
        "道德品质",
        "热爱祖国",
        "拥护中国共产党",
        "家庭经济困难",
    ):
        if cue in normalized:
            score += 4
    if "用以奖励" in normalized and "申请" not in normalized and "参评" not in normalized:
        score -= 16
    if any(cue in normalized for cue in ("颁发", "奖金", "荣誉证书", "档案")):
        score -= 16
    return score


def condition_overview_sort_key(
    *,
    query_text: str,
    source: EvidenceSource,
    mode: str,
) -> tuple[int, int, int]:
    scored = _score_source_statements(query_text, source, mode=mode)
    if not scored:
        return (condition_overview_source_quality_score(source), 0, 0)
    return (
        condition_overview_source_quality_score(source),
        scored[0][0],
        sum(score for score, _ in scored[:3]),
    )


def _condition_overview_source_key(source: EvidenceSource) -> tuple[str, str, str]:
    return source.doc_id, source.chunk_id, source.snippet


__all__ = [
    "condition_overview_should_expand_statements",
    "condition_overview_sort_key",
    "condition_overview_source_quality_score",
    "condition_overview_statement_budget",
    "condition_overview_statement_dedupe_key",
    "filter_condition_overview_statements",
    "order_condition_overview_sources_for_policy_coverage",
    "select_condition_overview_member_rows",
]
