from __future__ import annotations

import unittest

from campus_contracts import (
    AgentResponse,
    EvidenceBundle,
    EvidenceSource,
    RagResultDiagnostics,
    RagResultPayload,
)
from campus_ingestion_core.curriculum_program_semester_facts_projection import (
    build_curriculum_program_semester_fact_document_id,
)


def _make_official_web_source(
    *,
    doc_id: str,
    title: str,
    snippet: str,
    score: float,
    chunk_id_suffix: str,
    content_role: str = "",
    content_kind: str = "article_body",
    is_answer_bearing: bool = False,
    semantic_role: str = "",
    polarity: str = "",
    action_type: str = "",
    claim_type: str = "",
    anchor: dict[str, object] | None = None,
    structural_path: tuple[str, ...] | None = None,
    collection: str = "muc_public_pages",
) -> EvidenceSource:
    return EvidenceSource(
        doc_id=doc_id,
        revision_track="source-faithful",
        version_id=f"owdocver:{chunk_id_suffix}",
        chunk_id=f"{doc_id}:source-faithful:owdocver:{chunk_id_suffix}:chunk-0001",
        anchor=anchor or {"segment_ord": 1},
        canonical_url=f"https://www.muc.edu.cn/{chunk_id_suffix}.htm",
        latest_url=f"https://www.muc.edu.cn/{chunk_id_suffix}.htm",
        source_channel="official_web",
        collection=collection,
        is_current=True,
        snippet=snippet,
        score=score,
        source_title=title,
        structural_path=structural_path or (title,),
        content_kind=content_kind,
        content_role=content_role,
        detail_label=title,
        is_answer_bearing=is_answer_bearing,
        semantic_role=semantic_role,
        polarity=polarity,
        action_type=action_type,
        claim_type=claim_type,
    )


def _make_official_web_evidence(
    *,
    query_text: str,
    sources: tuple[EvidenceSource, ...],
    collection: str = "muc_public_pages",
) -> EvidenceBundle:
    return EvidenceBundle(
        query_text=query_text,
        corpus="official_web",
        collection=collection,
        sources=sources,
    )


def _make_program_semester_source(
    *,
    source_document_id: str,
    semester_label: str,
    snippet: str,
    score: float,
) -> EvidenceSource:
    source_title = source_document_id.split(":", 1)[-1]
    fact_document_id = build_curriculum_program_semester_fact_document_id(
        source_document_id,
        semester_label,
    )
    return EvidenceSource(
        doc_id=fact_document_id,
        revision_track="source-faithful",
        version_id=f"v1:{source_title}:{semester_label}",
        chunk_id=f"{fact_document_id}:row-0001",
        anchor={"fact_type": "semester_course_list"},
        canonical_url=f"https://campus.example/curriculum/{source_title}",
        latest_url=f"https://campus.example/curriculum/{source_title}",
        source_channel="pdf_ocr",
        collection="program_semester_facts",
        is_current=False,
        snippet=snippet,
        score=score,
        source_title=f"{source_title} {semester_label}课程事实",
        structural_path=(source_title, semester_label),
        detail_label=f"{semester_label}课程",
        content_kind="program_semester_fact",
        content_role="semester_course_list",
        is_answer_bearing=True,
    )


def _make_curriculum_plan_source(
    *,
    doc_id: str,
    chunk_id: str,
    snippet: str,
    score: float,
    source_title: str,
    structural_path: tuple[str, ...] = (),
    content_kind: str = "",
    content_role: str = "",
    detail_label: str = "",
    is_answer_bearing: bool = False,
) -> EvidenceSource:
    return EvidenceSource(
        doc_id=doc_id,
        revision_track="source-faithful",
        version_id=f"v1:{chunk_id.rsplit(':', 1)[-1]}",
        chunk_id=chunk_id,
        anchor={"page_start": 1, "page_end": 1},
        canonical_url=f"https://campus.example/{doc_id.split(':', 1)[-1]}",
        latest_url=f"https://campus.example/{doc_id.split(':', 1)[-1]}",
        source_channel="pdf_ocr",
        collection="curriculum_plan",
        is_current=False,
        snippet=snippet,
        score=score,
        source_title=source_title,
        structural_path=structural_path,
        content_kind=content_kind,
        content_role=content_role,
        detail_label=detail_label,
        is_answer_bearing=is_answer_bearing,
    )


def _make_versioned_handbook_evidence(
    *,
    query_text: str,
    document_id: str,
    primary_version_id: str,
    primary_snippet: str,
    comparison_version_id: str = "",
    comparison_snippet: str = "",
) -> EvidenceBundle:
    sources = [
        EvidenceSource(
            doc_id=document_id,
            revision_track="source-faithful",
            version_id=primary_version_id,
            chunk_id=f"{document_id}:source-faithful:{primary_version_id}:chunk-0001",
            anchor={"page_start": 1, "page_end": 1},
            canonical_url=f"https://campus.example/handbook/{document_id}",
            latest_url=f"https://campus.example/handbook/{document_id}",
            source_channel="pdf_ocr",
            collection="student_rules",
            is_current=False,
            snippet=primary_snippet,
            score=0.92,
            source_title="中央民族大学本科学生国家奖学金评审办法",
            structural_path=("中央民族大学本科学生国家奖学金评审办法",),
            is_answer_bearing=True,
        )
    ]
    if comparison_version_id:
        sources.append(
            EvidenceSource(
                doc_id=document_id,
                revision_track="source-faithful",
                version_id=comparison_version_id,
                chunk_id=f"{document_id}:source-faithful:{comparison_version_id}:chunk-0001",
                anchor={"page_start": 2, "page_end": 2},
                canonical_url=f"https://campus.example/handbook/{document_id}",
                latest_url=f"https://campus.example/handbook/{document_id}",
                source_channel="pdf_ocr",
                collection="student_rules",
                is_current=True,
                snippet=comparison_snippet,
                score=0.9,
                source_title="中央民族大学本科学生国家奖学金评审办法",
                structural_path=("中央民族大学本科学生国家奖学金评审办法",),
                is_answer_bearing=True,
            )
        )
    return EvidenceBundle(
        query_text=query_text,
        corpus="regulations",
        collection="student_rules",
        sources=tuple(sources),
    )


def _assert_answer_text_hides_internal_locators(
    test_case: unittest.TestCase,
    answer_text: str,
) -> None:
    test_case.assertNotIn("source-faithful", answer_text)
    test_case.assertNotIn("program_semester_facts:", answer_text)
    test_case.assertNotIn("chunk-", answer_text)
    test_case.assertNotRegex(answer_text, r"\[[^\]]*#[^\]]*\]")


def _resolved_scope_diagnostics(
    *,
    corpus: str,
    collection: str,
    **kwargs: object,
) -> RagResultDiagnostics:
    clarification_reason = kwargs.get("clarification_reason", "")
    no_answer_reason = kwargs.get("no_answer_reason", "")
    semantic_outcome = kwargs.get("semantic_outcome", "")
    if "retrieval_adequacy_verdict" not in kwargs:
        if isinstance(clarification_reason, str) and clarification_reason:
            kwargs["retrieval_adequacy_verdict"] = "ambiguous"
            kwargs["retrieval_adequacy_reason"] = clarification_reason
        elif semantic_outcome == "grounded_answer":
            kwargs["retrieval_adequacy_verdict"] = "sufficient"
            kwargs["retrieval_adequacy_reason"] = "sufficient"
        elif semantic_outcome in {"unsupported_by_evidence", "freshness_fail_close"}:
            kwargs["retrieval_adequacy_verdict"] = "insufficient"
            if no_answer_reason == "resolved_policy_clause_not_found":
                kwargs["retrieval_adequacy_reason"] = "resolved_policy_clause_not_found"
            elif no_answer_reason == "freshness_fail_close":
                kwargs["retrieval_adequacy_reason"] = "freshness_fail_close"
            else:
                kwargs["retrieval_adequacy_reason"] = "no_supporting_sources"
    if semantic_outcome == "grounded_answer" and "grounding_verdict" not in kwargs:
        kwargs["grounding_verdict"] = "grounded"
    return RagResultDiagnostics(
        resolved_scope_corpus=corpus,
        resolved_scope_collection=collection,
        **kwargs,
    )


def _resolved_curriculum_diagnostics_from_response(
    response: AgentResponse,
    **kwargs: object,
) -> RagResultDiagnostics:
    result = response.result
    if not isinstance(result, RagResultPayload):
        raise AssertionError("expected RagResultPayload for curriculum diagnostics assertion")
    if result.diagnostics is not None:
        kwargs.setdefault("retrieval_plan_summary", result.diagnostics.retrieval_plan_summary)
        kwargs.setdefault("stage_activities", result.diagnostics.stage_activities)
        kwargs.setdefault("source_trust_summary", result.diagnostics.source_trust_summary)
        kwargs.setdefault("retrieved_sources", result.diagnostics.retrieved_sources)
        kwargs.setdefault(
            "planner_information_needs",
            result.diagnostics.planner_information_needs,
        )
        kwargs.setdefault(
            "projection_context_summaries",
            result.diagnostics.projection_context_summaries,
        )
        kwargs.setdefault("claim_supports", result.diagnostics.claim_supports)
        kwargs.setdefault("claim_evidence_graph", result.diagnostics.claim_evidence_graph)
    if (
        response.status == "completed"
        and "semantic_outcome" not in kwargs
        and not kwargs.get("no_answer_reason")
        and not kwargs.get("clarification_reason")
    ):
        kwargs["semantic_outcome"] = "grounded_answer"
    return _resolved_scope_diagnostics(
        corpus="curriculum",
        collection="curriculum_plan",
        **kwargs,
    )
