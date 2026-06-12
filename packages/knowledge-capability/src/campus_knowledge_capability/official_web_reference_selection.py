from __future__ import annotations

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_ingestion_core.corpus_profiles import is_official_web_stable_reference_like_collection

from .answer_shared import _normalize_snippet
from .official_web_terms import _is_official_web_reference_query, _is_official_web_source

_OFFICIAL_WEB_REFERENCE_LIST_CUES = (
    "有哪些",
    "哪些",
    "有什么",
    "包括什么",
    "包括哪些",
)
_OFFICIAL_WEB_DIRECTORY_REFERENCE_SUPPORT_BUDGET = 6


def official_web_reference_support_budget(
    *,
    evidence: EvidenceBundle,
    query_text: str,
    default_budget: int,
) -> int:
    if evidence.corpus != "official_web":
        return default_budget
    if not is_official_web_stable_reference_like_collection(evidence.collection):
        return default_budget
    if not official_web_reference_query_needs_multi_entry_support(
        query_text=query_text,
        sources=evidence.sources,
    ):
        return default_budget
    return max(default_budget, _OFFICIAL_WEB_DIRECTORY_REFERENCE_SUPPORT_BUDGET)


def official_web_reference_title_lookup_max_seen_statements(
    *,
    query_text: str,
    sources: tuple[EvidenceSource, ...],
    default_budget: int,
    max_sources: int,
) -> int:
    if official_web_reference_query_needs_multi_entry_support(
        query_text=query_text,
        sources=sources,
    ):
        return max(default_budget, max_sources)
    return default_budget


def official_web_reference_title_lookup_statement_budget(
    *,
    query_text: str,
    source: EvidenceSource,
    default_budget: int,
) -> int:
    if source.content_kind == "table_unit" and _is_official_web_reference_query(
        query_text=query_text, source=source
    ):
        return 2
    return default_budget


def official_web_reference_title_lookup_should_continue_rows(
    *,
    query_text: str,
    source: EvidenceSource,
) -> bool:
    return _is_official_web_directory_reference_list_query(
        query_text=query_text,
        source=source,
    )


def official_web_reference_query_needs_multi_entry_support(
    *,
    query_text: str,
    sources: tuple[EvidenceSource, ...],
) -> bool:
    return any(
        _is_official_web_directory_reference_list_query(query_text=query_text, source=source)
        for source in sources
    )


def _is_official_web_directory_reference_list_query(
    *,
    query_text: str,
    source: EvidenceSource,
) -> bool:
    if not _is_official_web_source(source):
        return False
    if source.content_kind != "directory_entry":
        return False
    if not _is_official_web_reference_query(query_text=query_text, source=source):
        return False
    normalized_query = _normalize_snippet(query_text)
    return any(cue in normalized_query for cue in _OFFICIAL_WEB_REFERENCE_LIST_CUES)


__all__ = [
    "official_web_reference_query_needs_multi_entry_support",
    "official_web_reference_support_budget",
    "official_web_reference_title_lookup_max_seen_statements",
    "official_web_reference_title_lookup_should_continue_rows",
    "official_web_reference_title_lookup_statement_budget",
]
