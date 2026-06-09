from __future__ import annotations

import re

from campus_contracts import EvidenceBundle, EvidenceSource

from .answer_selection_query import _CJK_SEGMENT_RE, _PROCEDURE_QUERY_HINTS
from .answer_shared import (
    _answer_prefix,
    _lead_source_title,
    _normalize_snippet,
    _render_source_support,
    _source_context_label,
)
from .answer_summary_facets import (
    general_summary_query_facets,
    general_summary_text_facet_indexes,
    order_general_summary_fragments_by_query_facets,
)


def _compose_generic_answer(
    *,
    evidence: EvidenceBundle,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
    collapse_to_short: bool = False,
) -> str:
    if collapse_to_short:
        fragments = [_first_statement(statements) for _, statements in selected_rows if statements]
    else:
        fragments = ["；".join(statements) for _, statements in selected_rows if statements]
    if not fragments:
        fragments = [_render_source_support(source) for source, _ in selected_rows]
    fragments = [fragment for fragment in fragments if fragment]
    if not fragments:
        return ""

    answer_prefix = _answer_prefix(evidence)
    supporting_sources = tuple(source for source, _ in selected_rows)
    context_label = (
        _source_context_label(evidence=evidence, source=supporting_sources[0])
        if supporting_sources
        else ""
    )
    topic_label = _query_topic_label(evidence.query_text)
    if collapse_to_short:
        fragment = fragments[0]
        if len(fragments) > 1 and general_summary_query_facets(evidence.query_text):
            summary_fragments = tuple(
                _first_sentence_fragment(
                    fragment,
                    query_text=evidence.query_text,
                )
                for fragment in fragments
                if fragment.strip()
            )
            summary_fragments = order_general_summary_fragments_by_query_facets(
                query_text=evidence.query_text,
                fragments=summary_fragments,
            )
            summary = "，同时".join(fragment for fragment in summary_fragments if fragment)
            summary_context_label = _summary_context_label(
                evidence=evidence, sources=supporting_sources
            )
            direct_subject = _summary_direct_subject(evidence.query_text)
            if direct_subject:
                if summary_context_label:
                    return f"{direct_subject}：{summary}，依据《{summary_context_label}》。"
                return f"{direct_subject}：{summary}。"
            if summary_context_label and _normalize_snippet(
                summary_context_label
            ) not in _normalize_snippet(summary):
                return f"{answer_prefix}，《{summary_context_label}》明确：{summary}。"
            if topic_label and topic_label not in _normalize_snippet(summary):
                return f"{answer_prefix}，关于{topic_label}：{summary}。"
            return f"{answer_prefix}，{summary}。"
        if context_label and _normalize_snippet(context_label) not in _normalize_snippet(fragment):
            return f"{answer_prefix}，{context_label}明确：{fragment}"
        if topic_label and topic_label not in _normalize_snippet(fragment):
            return f"{answer_prefix}，关于{topic_label}：{fragment}"
        return f"{answer_prefix}，{fragment}"
    if context_label and _normalize_snippet(context_label) not in _normalize_snippet(
        " ".join(fragments)
    ):
        return f"{answer_prefix}，{context_label}明确：{'；'.join(fragments)}"
    if topic_label and topic_label not in _normalize_snippet(" ".join(fragments)):
        return f"{answer_prefix}，关于{topic_label}：{'；'.join(fragments)}"
    return f"{answer_prefix}，{'；'.join(fragments)}"


def _first_sentence_fragment(fragment: str, *, query_text: str = "") -> str:
    normalized = _normalize_snippet(fragment).strip("。；;，, ")
    if not normalized:
        return ""
    first_sentence = re.split(r"[。！？!?]", normalized, maxsplit=1)[0].strip("。；;，, ")
    if not query_text:
        return first_sentence
    return _compress_summary_sentence_for_query(
        sentence=first_sentence,
        query_text=query_text,
    )


def _compress_summary_sentence_for_query(*, sentence: str, query_text: str) -> str:
    facets = general_summary_query_facets(query_text)
    if not facets:
        return sentence
    sentence = _strip_parenthetical_definitions(sentence)
    clauses = _summary_sentence_clauses(sentence)
    if len(clauses) <= 1:
        return _normalize_summary_clause(sentence)
    selected: list[str] = []
    for facet_index, _ in enumerate(facets):
        matching_clauses = tuple(
            clause
            for clause in clauses
            if facet_index in general_summary_text_facet_indexes(clause, facets)
        )
        if not matching_clauses:
            continue
        best_clause = max(
            matching_clauses,
            key=lambda clause: _summary_clause_quality_score(clause),
        )
        best_clause = _normalize_summary_clause(best_clause)
        if best_clause not in selected:
            selected.append(best_clause)
    if not selected:
        return clauses[0]
    return "，".join(selected[:2])


def _summary_clause_quality_score(clause: str) -> tuple[int, int]:
    normalized = _normalize_snippet(clause)
    conclusion_score = sum(
        1
        for cue in (
            "仍属于",
            "采用对应原则",
            "认定",
            "转换",
            "承认",
            "录入",
            "提交",
            "期满",
        )
        if cue in normalized
    )
    return (conclusion_score, -len(normalized))


def _summary_sentence_clauses(sentence: str) -> tuple[str, ...]:
    return tuple(
        clause
        for clause in (
            _normalize_snippet(item).strip("。；;，, ") for item in re.split(r"[，,；;]", sentence)
        )
        if clause
    )


def _strip_parenthetical_definitions(sentence: str) -> str:
    return re.sub(r"[（(]以下简称[^）)]*[）)]", "", sentence)


def _normalize_summary_clause(clause: str) -> str:
    normalized = _normalize_snippet(clause)
    match = re.search(r"学分按照协议予以转换和承认", normalized)
    if match:
        return match.group(0)
    return normalized


def _summary_context_label(
    *,
    evidence: EvidenceBundle,
    sources: tuple[EvidenceSource, ...],
) -> str:
    del evidence
    titles = tuple(dict.fromkeys(_lead_source_title((source,)) for source in sources))
    titles = tuple(title for title in titles if title)
    if len(titles) == 1:
        return titles[0]
    return ""


def _summary_direct_subject(query_text: str) -> str:
    normalized = _normalize_snippet(query_text)
    if not normalized:
        return ""
    for cue in ("怎么管理", "如何管理", "怎么处理", "如何处理"):
        if cue in normalized:
            return normalized.split(cue, 1)[0].rstrip("，,？?。 ")
    return ""


def _first_statement(statements: tuple[str, ...]) -> str:
    for statement in statements:
        normalized = _normalize_snippet(statement)
        if normalized:
            return normalized
    return ""


def _query_topic_label(query_text: str) -> str:
    normalized = _normalize_snippet(query_text).strip("。？！? ")
    if not normalized:
        return ""
    lowered = normalized.lower()
    if any(hint in lowered for hint in _PROCEDURE_QUERY_HINTS):
        return ""
    if any(hint in lowered for hint in ("什么", "哪些", "how", "what", "when")):
        return ""
    if len(normalized) > 10 or not _CJK_SEGMENT_RE.search(normalized):
        return ""
    return normalized


__all__ = ["_compose_generic_answer"]
