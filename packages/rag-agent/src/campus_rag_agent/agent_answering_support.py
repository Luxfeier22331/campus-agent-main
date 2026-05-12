from __future__ import annotations

from campus_contracts import EvidenceSource

from .agent_shared import _normalize_snippet, _render_source_support


def _render_supporting_contexts(
    selected_rows: tuple[tuple[EvidenceSource, tuple[str, ...]], ...],
) -> tuple[str, ...]:
    merged_rows: list[tuple[EvidenceSource, tuple[str, ...]]] = []
    source_index_by_key: dict[tuple[str, str, str], int] = {}
    for source, statements in selected_rows:
        source_key = (source.doc_id, source.chunk_id, source.snippet)
        if source_key in source_index_by_key:
            index = source_index_by_key[source_key]
            existing_source, existing_statements = merged_rows[index]
            merged_rows[index] = (
                existing_source,
                tuple(dict.fromkeys((*existing_statements, *statements))),
            )
            continue
        source_index_by_key[source_key] = len(merged_rows)
        merged_rows.append((source, statements))
    contexts: list[str] = []
    for source, statements in merged_rows:
        context = _render_supporting_context(source, statements)
        if context:
            contexts.append(context)
    return tuple(contexts)


def _render_supporting_context(source: EvidenceSource, statements: tuple[str, ...]) -> str:
    fragments = tuple(statement for statement in statements if statement)
    body = "；".join(fragments) if fragments else _render_source_support(source)
    if not body:
        return ""
    title = _normalize_snippet(source.source_title)
    detail_label = (
        _normalize_snippet(source.detail_label)
        if _is_clause_detail_label(source.detail_label)
        else ""
    )
    label = " ".join(part for part in (title, detail_label) if part)
    if label and label not in body:
        return f"{label}：{body}"
    if title and title not in body:
        return f"{title}：{body}"
    return body


def _is_clause_detail_label(detail_label: str) -> bool:
    normalized = _normalize_snippet(detail_label)
    return normalized.startswith("第") and normalized.endswith("条")


__all__ = ["_render_supporting_contexts"]
