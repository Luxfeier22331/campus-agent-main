from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from typing import Any

from campus_contracts import EvidenceSource
from campus_ingestion_core.process_shared import IndexableChunk
from campus_retrieval_core.backend_qdrant_evidence import build_evidence_sources
from campus_retrieval_core.evidence_attributes import (
    evidence_attributes_for_source,
    evidence_fallback_diagnostics_for_source,
)
from campus_retrieval_core.evidence_ranking import (
    prioritize_evidence_sources,
    select_supporting_evidence_sources,
)
from campus_shared.regulation_semantic_registry import canonical_regulation_condition_subject
from qdrant_client.http import models as qdrant_models

from .retrieval_chunk_quality import build_chunk_quality_audit_report


@dataclass(frozen=True, slots=True)
class AnswerReadyCloseoutCase:
    case_id: str
    query: str
    expected_top_answer_role: str
    expected_selected_answer_role: str
    expected_condition_subject: str = ""


@dataclass(frozen=True, slots=True)
class AnswerReadyCloseoutCaseResult:
    case_id: str
    status: str
    top_answer_role: str
    selected_answer_roles: tuple[str, ...]
    selected_condition_subjects: tuple[str, ...]
    fallback_used: bool
    issues: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class AnswerReadyCloseoutAuditReport:
    status: str
    chunk_quality_status: str
    chunk_count: int
    failed_case_count: int
    primary_text_cue_fallback_count: int
    answer_role_counts: dict[str, int]
    condition_subject_counts: dict[str, int]
    cases: tuple[AnswerReadyCloseoutCaseResult, ...]
    chunk_quality_issues: dict[str, tuple[str, ...]] = field(default_factory=dict)


def audit_answer_ready_closeout(
    *,
    chunks: Iterable[IndexableChunk],
    cases: tuple[AnswerReadyCloseoutCase, ...],
    max_tokens: int = 512,
) -> AnswerReadyCloseoutAuditReport:
    chunk_rows = tuple(chunks)
    chunk_quality = build_chunk_quality_audit_report(
        chunks=tuple(_chunk_quality_row(chunk) for chunk in chunk_rows),
        max_tokens=max_tokens,
    )
    sources = _evidence_sources_from_chunks(chunk_rows)
    answer_role_counts: dict[str, int] = {}
    condition_subject_counts: dict[str, int] = {}
    primary_text_cue_fallback_count = 0
    for source in sources:
        attributes = evidence_attributes_for_source(source)
        if attributes.answer_role:
            answer_role_counts[attributes.answer_role] = (
                answer_role_counts.get(attributes.answer_role, 0) + 1
            )
        if attributes.condition_subject:
            canonical_subject = canonical_regulation_condition_subject(attributes.condition_subject)
            condition_subject_counts[canonical_subject] = (
                condition_subject_counts.get(canonical_subject, 0) + 1
            )
        fallback = evidence_fallback_diagnostics_for_source(source)
        if fallback.fallback_used and fallback.fallback_primary_signal == "text_cue":
            primary_text_cue_fallback_count += 1

    case_results = tuple(_audit_case(case=case, sources=sources) for case in cases)
    failed_case_count = sum(1 for result in case_results if result.status != "passed")
    status = (
        "passed"
        if chunk_quality.status == "passed"
        and failed_case_count == 0
        and primary_text_cue_fallback_count == 0
        else "failed"
    )
    return AnswerReadyCloseoutAuditReport(
        status=status,
        chunk_quality_status=chunk_quality.status,
        chunk_count=chunk_quality.chunk_count,
        failed_case_count=failed_case_count,
        primary_text_cue_fallback_count=primary_text_cue_fallback_count,
        answer_role_counts=dict(sorted(answer_role_counts.items())),
        condition_subject_counts=dict(sorted(condition_subject_counts.items())),
        cases=case_results,
        chunk_quality_issues=chunk_quality.issues_by_chunk_id,
    )


def _audit_case(
    *,
    case: AnswerReadyCloseoutCase,
    sources: tuple[EvidenceSource, ...],
) -> AnswerReadyCloseoutCaseResult:
    ranked = prioritize_evidence_sources(query_text=case.query, sources=sources)
    selected = select_supporting_evidence_sources(
        query_text=case.query,
        sources=ranked,
        max_sources=3,
    )
    top_attributes = evidence_attributes_for_source(ranked[0]) if ranked else None
    selected_attributes = tuple(evidence_attributes_for_source(source) for source in selected)
    issues: list[str] = []
    top_answer_role = top_attributes.answer_role if top_attributes is not None else ""
    if top_answer_role != case.expected_top_answer_role:
        issues.append(f"top_answer_role:{top_answer_role}!={case.expected_top_answer_role}")
    selected_roles = tuple(attributes.answer_role for attributes in selected_attributes)
    if case.expected_selected_answer_role not in selected_roles:
        issues.append(
            f"selected_answer_role:{selected_roles} missing {case.expected_selected_answer_role}"
        )
    selected_subjects = tuple(
        canonical_regulation_condition_subject(attributes.condition_subject)
        for attributes in selected_attributes
        if attributes.condition_subject
    )
    if (
        case.expected_condition_subject
        and canonical_regulation_condition_subject(case.expected_condition_subject)
        not in selected_subjects
    ):
        issues.append(
            "selected_condition_subject:"
            f"{selected_subjects} missing {case.expected_condition_subject}"
        )
    fallback_used = any(
        evidence_fallback_diagnostics_for_source(source).fallback_used
        for source in (*ranked, *selected)
    )
    if fallback_used:
        issues.append("typed_metadata_fallback_used")
    return AnswerReadyCloseoutCaseResult(
        case_id=case.case_id,
        status="passed" if not issues else "failed",
        top_answer_role=top_answer_role,
        selected_answer_roles=selected_roles,
        selected_condition_subjects=selected_subjects,
        fallback_used=fallback_used,
        issues=tuple(issues),
    )


def _evidence_sources_from_chunks(chunks: tuple[IndexableChunk, ...]) -> tuple[EvidenceSource, ...]:
    points: list[qdrant_models.ScoredPoint] = []
    for index, chunk in enumerate(chunks, start=1):
        node = chunk.to_node()
        payload = {"_node_content": node.model_dump_json(), **node.metadata}
        points.append(
            qdrant_models.ScoredPoint(
                id=node.node_id,
                version=0,
                score=1.0 / index,
                payload=payload,
                vector=None,
            )
        )
    return build_evidence_sources(None, tuple(points))


def _chunk_quality_row(chunk: IndexableChunk) -> Mapping[str, Any]:
    return {
        "document_id": chunk.document_id,
        "version_id": chunk.version_id,
        "chunk_id": chunk.chunk_id,
        "chunk_order": chunk.chunk_order,
        "corpus": chunk.corpus,
        "collection": chunk.collection,
        "text": chunk.text,
        "source_uri": chunk.source_uri,
        "anchor": chunk.anchor,
        "metadata": chunk.metadata,
    }


__all__ = [
    "AnswerReadyCloseoutAuditReport",
    "AnswerReadyCloseoutCase",
    "AnswerReadyCloseoutCaseResult",
    "audit_answer_ready_closeout",
]
