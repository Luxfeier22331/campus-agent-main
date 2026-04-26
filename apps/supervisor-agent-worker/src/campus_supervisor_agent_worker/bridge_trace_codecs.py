from __future__ import annotations

from campus_contracts import KnowledgeScope, TraceContext, VersionQuery

from campus_supervisor_agent_worker.bridge_parse_utils import (
    parse_optional_string,
    require_string,
)


def parse_requested_scope(raw_scope: object) -> KnowledgeScope | None:
    if raw_scope is None:
        return None
    if not isinstance(raw_scope, dict):
        raise ValueError("requested_scope must be an object")
    corpus = str(raw_scope.get("corpus", "")).strip()
    collection = str(raw_scope.get("collection", "")).strip()
    if not corpus or not collection:
        raise ValueError("requested_scope requires corpus and collection")
    return KnowledgeScope(corpus=corpus, collection=collection)


def parse_trace_context(raw_trace: object) -> TraceContext:
    if not isinstance(raw_trace, dict):
        raise ValueError("trace must be an object")
    trace_id = require_string(raw_trace.get("trace_id"), field_name="trace.trace_id")
    return TraceContext(trace_id=trace_id)


def parse_version_query(raw_version_query: object) -> VersionQuery:
    if raw_version_query is None:
        return VersionQuery()
    if not isinstance(raw_version_query, dict):
        raise ValueError("version_query must be an object")
    mode = parse_optional_string(raw_version_query.get("mode"))
    as_of = parse_optional_string(raw_version_query.get("as_of"))
    version_id = parse_optional_string(raw_version_query.get("version_id"))
    compare_to_version_id = parse_optional_string(raw_version_query.get("compare_to_version_id"))
    return VersionQuery(
        mode="current" if mode is None else mode,
        as_of="" if as_of is None else as_of,
        version_id="" if version_id is None else version_id,
        compare_to_version_id="" if compare_to_version_id is None else compare_to_version_id,
    )


__all__ = [
    "parse_requested_scope",
    "parse_trace_context",
    "parse_version_query",
]
