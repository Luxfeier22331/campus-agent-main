from __future__ import annotations

from campus_contracts import EvidenceBundle, EvidenceSource
from campus_ingestion_core.corpus_profiles import is_official_web_stable_reference_like_collection
from campus_retrieval_core.evidence_ranking import (
    query_targets_source_title,
    select_supporting_evidence_sources,
)

from .agent_shared import _normalize_snippet

_POSITIVE_SUPPORT_ROLES = frozenset(
    {
        "procedure",
        "requirement",
        "eligibility",
        "time_rule",
        "deadline",
        "table_fact",
        "family_membership",
        "semester",
        "semester_course_list",
        "audience",
        "definition",
        "scope_rule",
        "primary_content",
    }
)
_CURATED_FACT_COLLECTIONS = frozenset(
    {"course_facts", "program_family_facts", "program_semester_facts"}
)
_CURRICULUM_PLAN_BODY_HINTS = frozenset(
    {
        "培养目标",
        "培养要求",
        "毕业要求",
        "学制",
        "总学分",
        "毕业学分",
        "学位授予",
        "授予学位",
        "课程设置",
        "修读建议",
    }
)
_CURRICULUM_PLAN_NEGATIVE_ROLES = frozenset(
    {"navigation", "source_attribution", "boilerplate", "media_caption"}
)


def derive_confidence(evidence: EvidenceBundle, *, handbook_plan=None) -> str:
    if not evidence.sources:
        return "low"
    if (
        handbook_plan is not None
        and getattr(handbook_plan, "task_kind", "") == "category_discovery"
    ):
        return _derive_category_discovery_confidence(evidence, handbook_plan=handbook_plan)

    supporting_sources = select_supporting_evidence_sources(
        query_text=evidence.query_text,
        sources=evidence.sources,
        max_sources=3,
    )
    top_score = supporting_sources[0].score
    support_count = len(supporting_sources)
    distinct_doc_count = len({source.doc_id for source in supporting_sources})
    distinct_chunk_count = len({source.chunk_id for source in supporting_sources})
    strong_support_count = sum(1 for source in supporting_sources if source.score >= 0.75)
    medium_support_count = sum(1 for source in supporting_sources if source.score >= 0.55)
    primary_doc_id = supporting_sources[0].doc_id
    primary_doc_sources = tuple(
        source for source in supporting_sources if source.doc_id == primary_doc_id
    )
    primary_doc_chunk_count = len({source.chunk_id for source in primary_doc_sources})
    primary_doc_positive_support_count = sum(
        1
        for source in primary_doc_sources
        if _has_positive_answer_support(
            source,
            query_text=evidence.query_text,
            corpus=evidence.corpus,
            collection=evidence.collection,
        )
    )
    named_doc_id = next(
        (
            source.doc_id
            for source in primary_doc_sources
            if query_targets_source_title(query_text=evidence.query_text, source=source)
        ),
        None,
    )
    named_doc_chunk_count = primary_doc_chunk_count if named_doc_id is not None else 0
    if named_doc_id is not None and primary_doc_positive_support_count == 0:
        return "low"

    if (
        top_score >= 0.85
        and strong_support_count >= 2
        and distinct_chunk_count >= 2
        and (distinct_doc_count >= 2 or support_count >= 3)
    ):
        return "high"
    if (
        named_doc_id is not None
        and primary_doc_positive_support_count >= 2
        and named_doc_chunk_count >= 2
        and strong_support_count >= 2
    ):
        return "high"
    if _is_official_web_title_targeted_single_doc_hit(
        evidence=evidence,
        supporting_sources=supporting_sources,
    ):
        return "medium"
    if named_doc_id is not None and named_doc_chunk_count >= 2:
        return "medium"
    if named_doc_id is not None and primary_doc_positive_support_count >= 1:
        return "medium"
    if primary_doc_positive_support_count >= 1 and primary_doc_chunk_count >= 2:
        return "medium"
    if (
        evidence.collection in _CURATED_FACT_COLLECTIONS
        and supporting_sources[0].is_answer_bearing
        and primary_doc_positive_support_count >= 1
    ):
        return "medium"
    if (
        query_targets_source_title(query_text=evidence.query_text, source=supporting_sources[0])
        and top_score >= 0.4
        and _has_positive_answer_support(
            supporting_sources[0],
            query_text=evidence.query_text,
            corpus=evidence.corpus,
            collection=evidence.collection,
        )
    ):
        return "medium"
    if top_score >= 0.55 and medium_support_count >= 1:
        return "medium"
    return "low"


def _derive_category_discovery_confidence(evidence: EvidenceBundle, *, handbook_plan) -> str:
    member_document_ids = tuple(getattr(handbook_plan, "category_member_document_ids", ()) or ())
    if not member_document_ids:
        return "low"
    member_set = set(member_document_ids)
    positive_member_doc_ids = {
        source.doc_id
        for source in evidence.sources
        if source.doc_id in member_set
        and _has_positive_answer_support(
            source,
            query_text=evidence.query_text,
            corpus=evidence.corpus,
            collection=evidence.collection,
        )
    }
    if len(positive_member_doc_ids) >= min(3, len(member_set)):
        return "medium"
    if len(positive_member_doc_ids) >= 2 and len(member_set) <= 3:
        return "medium"
    return "low"


def _is_official_web_title_targeted_single_doc_hit(
    *,
    evidence: EvidenceBundle,
    supporting_sources: tuple,
) -> bool:
    if evidence.corpus != "official_web" or not is_official_web_stable_reference_like_collection(
        evidence.collection
    ):
        return False
    if not supporting_sources:
        return False
    top_source = supporting_sources[0]
    if top_source.source_channel != "official_web":
        return False
    if not _has_positive_answer_support(
        top_source,
        query_text=evidence.query_text,
        corpus=evidence.corpus,
        collection=evidence.collection,
    ):
        return False
    if not query_targets_source_title(query_text=evidence.query_text, source=top_source):
        return False
    return len({source.doc_id for source in supporting_sources}) == 1


def _has_positive_answer_support(
    source: EvidenceSource,
    *,
    query_text: str = "",
    corpus: str = "",
    collection: str = "",
) -> bool:
    if source.is_answer_bearing or source.content_role in _POSITIVE_SUPPORT_ROLES:
        return True
    return _has_curriculum_plan_textual_answer_support(
        source,
        query_text=query_text,
        corpus=corpus,
        collection=collection,
    )


def _has_curriculum_plan_textual_answer_support(
    source: EvidenceSource,
    *,
    query_text: str,
    corpus: str,
    collection: str,
) -> bool:
    if corpus != "curriculum" or collection != "curriculum_plan":
        return False
    if source.collection != "curriculum_plan":
        return False
    if source.content_role in _CURRICULUM_PLAN_NEGATIVE_ROLES:
        return False

    normalized_query = _normalize_snippet(query_text)
    normalized_snippet = _normalize_snippet(source.snippet)
    if not normalized_query or not normalized_snippet:
        return False

    if any(term in normalized_query for term in ("总学分", "多少学分", "学分要求")):
        return "总学分" in normalized_snippet or "毕业学分" in normalized_snippet
    if any(term in normalized_query for term in ("学制", "几年")):
        return "学制" in normalized_snippet
    if "学位" in normalized_query:
        return "学位" in normalized_snippet or "授予" in normalized_snippet

    if not query_targets_source_title(query_text=query_text, source=source):
        return False
    return any(hint in normalized_snippet for hint in _CURRICULUM_PLAN_BODY_HINTS)
