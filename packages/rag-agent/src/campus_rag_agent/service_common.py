from __future__ import annotations

import re
from collections.abc import Callable

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_ingestion_core import load_runtime_profile
from campus_ingestion_core.corpus_profiles import (
    is_official_web_stable_reference_like_profile,
)
from campus_retrieval_core import RetrievalRequest

_OFFICIAL_WEB_FRESHNESS_QUERY_TERMS = (
    "今天",
    "今日",
    "最新",
    "最近",
    "近期",
    "刚刚",
    "本周",
    "这周",
    "本月",
)
_WHITESPACE_RE = re.compile(r"\s+")
_QUERY_ASK_CUES = frozenset({"多少", "几年", "怎么", "如何", "安排", "什么", "哪些"})


def _normalize_text(text: str) -> str:
    return _WHITESPACE_RE.sub(" ", text).strip()


def _source_label(source: EvidenceSource) -> str:
    snippet = _normalize_text(source.snippet)
    for separator in (" | ", " / "):
        if separator in snippet:
            return snippet.split(separator, 1)[0].strip()
    return snippet.split("。", 1)[0].strip()


def _match_key(text: str) -> str:
    return "".join(
        char for char in _normalize_text(text).lower() if char.isalnum() or _is_cjk_char(char)
    )


def _is_short_title_fragment(query_key: str) -> bool:
    if not query_key or any(cue in query_key for cue in _QUERY_ASK_CUES):
        return False
    cjk_length = sum(1 for char in query_key if _is_cjk_char(char))
    return 0 < cjk_length <= 8


def _source_title_matches_exact_query(query_key: str, source: EvidenceSource) -> bool:
    return any(_match_key(candidate) == query_key for candidate in _source_title_candidates(source))


def _source_title_candidates(source: EvidenceSource) -> tuple[str, ...]:
    candidates = [source.source_title.strip(), source.doc_id.split(":", 1)[-1].strip()]
    if source.structural_path:
        candidates.append(source.structural_path[0].strip())
    return tuple(candidate for candidate in dict.fromkeys(candidates) if candidate)


def _is_cjk_char(char: str) -> bool:
    code_point = ord(char)
    return (
        0x3400 <= code_point <= 0x4DBF
        or 0x4E00 <= code_point <= 0x9FFF
        or 0xF900 <= code_point <= 0xFAFF
    )


def _build_empty_evidence(scope, user_goal: str) -> EvidenceBundle:
    return EvidenceBundle(
        query_text=user_goal,
        corpus=scope.corpus,
        collection=scope.collection,
    )


def _with_query_text(evidence: EvidenceBundle, query_text: str) -> EvidenceBundle:
    return EvidenceBundle(
        query_text=query_text,
        corpus=evidence.corpus,
        collection=evidence.collection,
        sources=evidence.sources,
    )


def _execute_retrieval_request_with_callable_retriever(
    retriever: Callable[..., object],
    retrieval_request: RetrievalRequest,
) -> EvidenceBundle:
    return retriever(
        retrieval_request.query_text,
        corpus=retrieval_request.corpus,
        collection=retrieval_request.collection,
        target_document_ids=retrieval_request.target_document_ids,
        target_version_ids=retrieval_request.target_version_ids,
        target_revision_track=retrieval_request.target_revision_track,
        preferred_document_ids=retrieval_request.preferred_document_ids,
        canonical_course_ids=retrieval_request.canonical_course_ids,
        canonical_course_family_ids=retrieval_request.canonical_course_family_ids,
        canonical_program_family_ids=retrieval_request.canonical_program_family_ids,
        authorized_filter=retrieval_request.authorized_filter,
        personalization_hint=retrieval_request.personalization_hint,
        top_k=retrieval_request.top_k,
    )


def _is_official_web_freshness_sensitive_query(query_text: str) -> bool:
    normalized_goal = _normalize_text(query_text).lower()
    return any(term in normalized_goal for term in _OFFICIAL_WEB_FRESHNESS_QUERY_TERMS)


def _is_official_web_freshness_fail_close(evidence: EvidenceBundle) -> bool:
    if evidence.corpus != "official_web":
        return False
    profile = load_runtime_profile(evidence.corpus, evidence.collection)
    return (
        is_official_web_stable_reference_like_profile(profile)
        and not profile.supports_freshness_sensitive_queries
        and _is_official_web_freshness_sensitive_query(evidence.query_text)
    )
