from __future__ import annotations

from campus_contracts import EvidenceBundle, EvidenceSource

from .agent_selection_query import _CJK_SEGMENT_RE, _PROCEDURE_QUERY_HINTS
from .agent_shared import (
    _answer_prefix,
    _lead_source_title,
    _normalize_snippet,
    _render_source_support,
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
    lead_title = _lead_source_title(supporting_sources)
    topic_label = _query_topic_label(evidence.query_text)
    if lead_title and _normalize_snippet(lead_title) in _normalize_snippet(evidence.query_text):
        return f"{answer_prefix}，《{lead_title}》明确：{'；'.join(fragments)}"
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
