from __future__ import annotations

import re
import unittest

from campus_contracts import (
    ActorContext,
    ErrorInfo,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagResultDiagnostics,
    RagResultPayload,
    SpecialistResponse,
    SupervisorObservability,
    SupervisorResponse,
    VersionQuery,
)
from campus_evals import (
    ExecutionResult,
    GoldenCase,
    ObservedTrace,
    TraceExpectation,
    curriculum_error_gate_cases,
    curriculum_regression_locked_cases,
    curriculum_release_gate_cases,
    curriculum_smoke_cases,
    expected_source_ref,
    handbook_error_gate_cases,
    handbook_regression_locked_cases,
    handbook_release_gate_cases,
    handbook_smoke_cases,
    official_web_release_gate_cases,
    policy_risk_and_grounding_release_gate_cases,
    run_cases,
    versioned_history_regression_locked_cases,
)
from campus_ingestion_core.curriculum_program_semester_facts_projection import (
    build_curriculum_program_semester_fact_document_id,
)

HANDBOOK_SCOPE = KnowledgeScope(corpus="regulations", collection="student_rules")
CURRICULUM_SCOPE = KnowledgeScope(corpus="curriculum", collection="curriculum_plan")


def _is_lookup_style_goal(user_goal: str) -> bool:
    normalized = user_goal.strip()
    if re.search(r"第[一二三四五六七八九十百0-9]+条", normalized):
        return True
    if any(
        token in normalized for token in ("怎么办", "怎么", "如何", "多少", "几年", "安排", "授予")
    ):
        return False
    return normalized.endswith(("管理办法", "评审办法", "人才培养方案", "教学计划", "宿舍照明"))


def _source(
    *,
    doc_id: str = "handbook:library",
    version_id: str = "v1",
    chunk_id: str = "chunk-1",
    collection: str = "student_rules",
    snippet: str = "Library hours are 08:00 to 22:00.",
    canonical_source_id: str = "",
    canonical_source_title: str = "",
    source_unit_kind: str = "",
    source_unit_key: str = "",
) -> EvidenceSource:
    return EvidenceSource(
        doc_id=doc_id,
        revision_track="source-faithful",
        version_id=version_id,
        chunk_id=chunk_id,
        anchor={"page": 1},
        canonical_url="https://example.edu/handbook/library",
        latest_url="https://example.edu/handbook/library",
        source_channel="pdf_ocr",
        collection=collection,
        is_current=False,
        snippet=snippet,
        score=0.91,
        canonical_source_id=canonical_source_id,
        canonical_source_title=canonical_source_title,
        source_unit_kind=source_unit_kind,
        source_unit_key=source_unit_key,
    )


def _response(
    *,
    status: str = "completed",
    answer_text: str = "Library hours are 08:00 to 22:00.",
    corpus: str = "regulations",
    collection: str = "student_rules",
    sources: tuple[EvidenceSource, ...] = (),
    diagnostics: RagResultDiagnostics | None = None,
) -> SpecialistResponse:
    return SpecialistResponse(
        target="rag-agent",
        status=status,
        answer_text=answer_text,
        confidence="high" if status == "completed" else "low",
        result=RagResultPayload(
            evidence=EvidenceBundle(
                query_text="library hours",
                corpus=corpus,
                collection=collection,
                sources=sources,
            ),
            diagnostics=diagnostics,
        ),
    )


__all__ = (
    "CURRICULUM_SCOPE",
    "HANDBOOK_SCOPE",
    "ActorContext",
    "ErrorInfo",
    "EvidenceBundle",
    "EvidenceSource",
    "ExecutionResult",
    "GoldenCase",
    "KnowledgeScope",
    "ObservedTrace",
    "RagResultDiagnostics",
    "RagResultPayload",
    "SpecialistResponse",
    "SupervisorObservability",
    "SupervisorResponse",
    "TraceExpectation",
    "VersionQuery",
    "_is_lookup_style_goal",
    "_response",
    "_source",
    "build_curriculum_program_semester_fact_document_id",
    "curriculum_error_gate_cases",
    "curriculum_regression_locked_cases",
    "curriculum_release_gate_cases",
    "curriculum_smoke_cases",
    "expected_source_ref",
    "handbook_error_gate_cases",
    "handbook_regression_locked_cases",
    "handbook_release_gate_cases",
    "handbook_smoke_cases",
    "official_web_release_gate_cases",
    "policy_risk_and_grounding_release_gate_cases",
    "run_cases",
    "unittest",
    "versioned_history_regression_locked_cases",
)
