from __future__ import annotations

from campus_contracts import EvidenceBundle, EvidenceSource

from .agent_selection_query import _CJK_SEGMENT_RE, _PROCEDURE_QUERY_HINTS
from .agent_shared import (
    _answer_prefix,
    _normalize_snippet,
    _render_source_support,
    _source_context_label,
)


def _compose_generic_answer(
    *,
    evidence: EvidenceBundle,
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> str:
    fragments = ["；".join(statements) for _, statements in selected_rows if statements]
    if not fragments:
        fragments = [_render_source_support(source) for source, _ in selected_rows]

    answer_prefix = _answer_prefix(evidence)
    supporting_sources = tuple(source for source, _ in selected_rows)
    context_label = (
        _source_context_label(evidence=evidence, source=supporting_sources[0])
        if supporting_sources
        else ""
    )
    topic_label = _query_topic_label(evidence.query_text)
    if context_label and _normalize_snippet(context_label) not in _normalize_snippet(
        " ".join(fragments)
    ):
        return f"{answer_prefix}，{context_label}明确：{'；'.join(fragments)}"
    if topic_label and topic_label not in _normalize_snippet(" ".join(fragments)):
        return f"{answer_prefix}，关于{topic_label}：{'；'.join(fragments)}"
    return f"{answer_prefix}，{'；'.join(fragments)}"


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
