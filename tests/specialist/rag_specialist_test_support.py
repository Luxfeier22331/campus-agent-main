from __future__ import annotations

import unittest
from unittest.mock import patch

from campus_contracts import (
    CURRICULUM_PROGRAM_FAMILY_SLOT_NAME,
    CURRICULUM_PROGRAM_SLOT_NAME,
    CURRICULUM_SEMESTER_SLOT_NAME,
    ActorContext,
    AuthorizationProjection,
    AuthorizedRetrievalFilter,
    ClaimSupport,
    ContextProjection,
    ErrorInfo,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    PersonalizationHint,
    ProfileMemoryItem,
    ProfileMemorySummary,
    PromptTrace,
    RagRequestPayload,
    RagResultDiagnostics,
    RagResultPayload,
    RemoteContentSuspicionSummary,
    SessionSlot,
    SessionSummary,
    SourceTrustSummary,
    SpecialistRequest,
    SpecialistResponse,
    VersionQuery,
)
from campus_ingestion_core import ResolvedVersionQuery, ResolvedVersionSelection
from campus_ingestion_core.curriculum_program_semester_facts_projection import (
    build_curriculum_program_semester_fact_document_id,
)
from campus_rag_agent import RagAgent
from campus_rag_agent.agent import _query_mode, _select_answer_support_rows
from campus_rag_agent.confidence import derive_confidence
from campus_rag_agent.grounding_validation import validate_prompt_answer_grounding
from campus_rag_agent.intent import frame_rag_intent
from campus_rag_agent.prompt_execution import (
    RagAnswerPromptOutput,
    RagClarifyPromptOutput,
    RagPromptExecutionResult,
)
from campus_rag_agent.prompts.registry import get_rag_prompt_spec
from campus_rag_agent.query_planning import (
    plan_curriculum_course_query,
    plan_curriculum_program_family_query,
    plan_curriculum_query,
)
from campus_rag_agent.service import delegate_to_rag_agent
from campus_retrieval_core import (
    CorpusQueryDisabledError,
    RestrictedDocumentAccessDeniedError,
    RetrievalBackendError,
)
from campus_shared import (
    NormalizedProviderGroundingSupport,
    PromptRuntimeValidationError,
)
from campus_supervisor_core.response import (
    build_supervisor_observability_from_specialist_response,
)


def _rag_prompt_trace(prompt_id: str) -> PromptTrace:
    spec = get_rag_prompt_spec(prompt_id)
    return PromptTrace(
        prompt_id=prompt_id,
        prompt_version=prompt_id.rsplit("_", 1)[-1],
        template_sha256=spec.template_sha256,
        variables_schema_version=spec.variables_schema_version,
        output_schema_version=spec.output_schema_version,
        model_provider="openai-responses",
        model_name="gpt-5.2-mini",
    )


def _make_evidence(
    *,
    scores: tuple[float, ...] = (0.82, 0.77),
    snippets: tuple[str, ...] | None = None,
    doc_ids: tuple[str, ...] | None = None,
    query_text: str = "library hours",
) -> EvidenceBundle:
    sources = tuple(
        EvidenceSource(
            doc_id=(doc_ids[index] if doc_ids is not None else f"handbook:test-{index + 1}"),
            revision_track="source-faithful",
            version_id=f"v1:test-{index + 1}",
            chunk_id=f"{(doc_ids[index] if doc_ids is not None else f'handbook:test-{index + 1}')}:source-faithful:v1:test-{index + 1}:chunk-0001",
            anchor={"page_start": index + 1, "page_end": index + 1},
            canonical_url=f"https://campus.example/handbook/test-{index + 1}",
            latest_url=f"https://campus.example/handbook/test-{index + 1}",
            source_channel="pdf_ocr",
            collection="student_handbook",
            is_current=False,
            snippet=(
                snippets[index]
                if snippets is not None
                else f"Evidence snippet {index + 1} about library hours and student support."
            ),
            score=score,
        )
        for index, score in enumerate(scores)
    )
    return EvidenceBundle(
        query_text=query_text,
        corpus="regulations",
        collection="student_handbook",
        sources=sources,
    )


def _make_handbook_source(
    *,
    doc_id: str,
    title: str,
    snippet: str,
    score: float,
    chunk_id_suffix: str,
    detail_label: str = "",
    content_role: str = "",
    is_answer_bearing: bool = False,
) -> EvidenceSource:
    return EvidenceSource(
        doc_id=doc_id,
        revision_track="source-faithful",
        version_id=f"v1:{chunk_id_suffix}",
        chunk_id=f"{doc_id}:source-faithful:v1:{chunk_id_suffix}",
        anchor={"page_start": 1, "page_end": 1},
        canonical_url=f"https://campus.example/handbook/{doc_id}",
        latest_url=f"https://campus.example/handbook/{doc_id}",
        source_channel="pdf_ocr",
        collection="student_handbook",
        is_current=True,
        snippet=snippet,
        score=score,
        source_title=title,
        structural_path=(title,),
        detail_label=detail_label,
        content_role=content_role,
        is_answer_bearing=is_answer_bearing,
    )


def _make_official_web_source(
    *,
    doc_id: str,
    title: str,
    snippet: str,
    score: float,
    chunk_id_suffix: str,
    content_role: str = "",
    is_answer_bearing: bool = False,
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
        content_kind="article_body",
        content_role=content_role,
        detail_label=title,
        is_answer_bearing=is_answer_bearing,
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
            collection="student_handbook",
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
                collection="student_handbook",
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
        collection="student_handbook",
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
    response: SpecialistResponse,
    **kwargs: object,
) -> RagResultDiagnostics:
    result = response.result
    if not isinstance(result, RagResultPayload):
        raise AssertionError("expected RagResultPayload for curriculum diagnostics assertion")
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
        retrieved_sources=result.evidence.sources,
        **kwargs,
    )


__all__ = (
    "CURRICULUM_PROGRAM_FAMILY_SLOT_NAME",
    "CURRICULUM_PROGRAM_SLOT_NAME",
    "CURRICULUM_SEMESTER_SLOT_NAME",
    "ActorContext",
    "AuthorizationProjection",
    "AuthorizedRetrievalFilter",
    "ClaimSupport",
    "ContextProjection",
    "ErrorInfo",
    "EvidenceBundle",
    "EvidenceSource",
    "KnowledgeScope",
    "PersonalizationHint",
    "ProfileMemoryItem",
    "ProfileMemorySummary",
    "PromptTrace",
    "RagRequestPayload",
    "RagResultDiagnostics",
    "RagResultPayload",
    "RemoteContentSuspicionSummary",
    "SessionSlot",
    "SessionSummary",
    "SourceTrustSummary",
    "SpecialistRequest",
    "SpecialistResponse",
    "VersionQuery",
    "ResolvedVersionQuery",
    "ResolvedVersionSelection",
    "build_curriculum_program_semester_fact_document_id",
    "RagAgent",
    "_query_mode",
    "_select_answer_support_rows",
    "derive_confidence",
    "validate_prompt_answer_grounding",
    "frame_rag_intent",
    "RagAnswerPromptOutput",
    "RagClarifyPromptOutput",
    "RagPromptExecutionResult",
    "get_rag_prompt_spec",
    "plan_curriculum_course_query",
    "plan_curriculum_program_family_query",
    "plan_curriculum_query",
    "delegate_to_rag_agent",
    "CorpusQueryDisabledError",
    "RestrictedDocumentAccessDeniedError",
    "RetrievalBackendError",
    "NormalizedProviderGroundingSupport",
    "PromptRuntimeValidationError",
    "build_supervisor_observability_from_specialist_response",
    "_rag_prompt_trace",
    "_make_evidence",
    "_make_handbook_source",
    "_make_official_web_source",
    "_make_official_web_evidence",
    "_make_program_semester_source",
    "_make_curriculum_plan_source",
    "_make_versioned_handbook_evidence",
    "_assert_answer_text_hides_internal_locators",
    "_resolved_scope_diagnostics",
    "_resolved_curriculum_diagnostics_from_response",
    "patch",
    "unittest",
)
