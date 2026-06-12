from __future__ import annotations

import unittest
from pathlib import Path
from unittest.mock import patch

import httpx
from campus_contracts import (
    ActorContext,
    CapabilityResponse,
    ClaimSupport,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagRequestPayload,
    RagResultPayload,
    RemoteContentSuspicionSummary,
    SourceTrustSummary,
    VersionQuery,
)
from campus_evals import (
    ExecutionResult,
    GoldenCase,
    TraceExpectation,
    build_default_ragas_metric_names,
    curriculum_error_gate_cases,
    curriculum_release_gate_cases,
    expected_source_ref,
)
from campus_evals.curriculum_live_benchmark import (
    AppApiEvalClientSettings,
    build_app_api_curriculum_live_executor,
    build_curriculum_live_profile,
    build_inprocess_curriculum_live_executor,
)
from campus_evals.operator_observability import OperatorRequestCorrelation
from campus_ingestion_core.curriculum_program_semester_facts_projection import (
    build_curriculum_program_semester_fact_document_id,
)

CURRICULUM_SCOPE = KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
LAW_FOLLOW_UP_DOC_ID = build_curriculum_program_semester_fact_document_id(
    "curriculum:法学（民族实验班）本科人才培养方案",
    "第四学期",
)
HISTORY_FOLLOW_UP_DOC_ID = build_curriculum_program_semester_fact_document_id(
    "curriculum:历史学（强基计划）本科人才培养方案",
    "第四学期",
)


def _source(doc_id: str, *, chunk_id: str = "chunk-1", score: float = 0.9) -> EvidenceSource:
    return EvidenceSource(
        doc_id=doc_id,
        revision_track="source-faithful",
        version_id="v1",
        chunk_id=chunk_id,
        anchor={"page": 1},
        canonical_url=f"https://example.edu/{doc_id}",
        latest_url=f"https://example.edu/{doc_id}",
        source_channel="pdf_ocr",
        collection="curriculum_plan",
        is_current=True,
        snippet=f"snippet for {doc_id}",
        score=score,
        source_title=doc_id,
    )


def _completed_case(
    *,
    case_id: str = "curriculum-release-gate-ethnology-title",
    user_goal: str = "民族学本科人才培养方案",
    version_query: VersionQuery | None = None,
) -> GoldenCase:
    return GoldenCase(
        case_id=case_id,
        split="release_gate",
        source_type="expert_authored",
        user_goal=user_goal,
        actor=ActorContext(),
        scope=CURRICULUM_SCOPE,
        version_query=version_query or VersionQuery(),
        expected_status="completed",
        trace_expectation=TraceExpectation(
            selected_scope=CURRICULUM_SCOPE,
            retrieval_called=True,
            clarification_expected=False,
            error_expected=False,
        ),
    )


def _follow_up_case() -> GoldenCase:
    return GoldenCase(
        case_id="curriculum-release-gate-program-follow-up-session-replay",
        split="release_gate",
        source_type="expert_authored",
        user_goal="法学民族班培养方案里大二下有什么课",
        actor=ActorContext(),
        scope=CURRICULUM_SCOPE,
        expected_status="completed",
        expected_sources=(
            expected_source_ref(
                LAW_FOLLOW_UP_DOC_ID,
                canonical_source_id="curriculum:法学（民族实验班）本科人才培养方案",
                source_unit_kind="semester_course_list",
                source_unit_key="semester-4",
            ),
        ),
        required_facts=("中国少数民族文字学", "侵权责任法"),
        reference_context_ids=("curriculum:法学（民族实验班）本科人才培养方案",),
        conversation_turns=(
            "法学民族班培养方案里大一上有什么课",
            "那大二下呢",
        ),
        trace_expectation=TraceExpectation(
            selected_scope=CURRICULUM_SCOPE,
            retrieval_called=True,
            clarification_expected=False,
            error_expected=False,
        ),
    )


def _strong_base_follow_up_case() -> GoldenCase:
    return GoldenCase(
        case_id="curriculum-release-gate-strong-base-follow-up-session-replay",
        split="release_gate",
        source_type="expert_authored",
        user_goal="历史学强基计划培养方案里大二下有什么课",
        actor=ActorContext(major="历史学"),
        scope=CURRICULUM_SCOPE,
        expected_status="completed",
        expected_sources=(
            expected_source_ref(
                HISTORY_FOLLOW_UP_DOC_ID,
                canonical_source_id="curriculum:历史学（强基计划）本科人才培养方案",
                source_unit_kind="semester_course_list",
                source_unit_key="semester-4",
            ),
        ),
        required_facts=("大学英语(四)", "中国近代边疆民族史料研读"),
        reference_context_ids=("curriculum:历史学（强基计划）本科人才培养方案",),
        conversation_turns=(
            "历史学强基计划培养方案里大一上有什么课",
            "那大二下呢",
        ),
        trace_expectation=TraceExpectation(
            selected_scope=CURRICULUM_SCOPE,
            retrieval_called=True,
            clarification_expected=False,
            error_expected=False,
        ),
    )


def _error_case(*, failure_mode: str) -> GoldenCase:
    return GoldenCase(
        case_id=f"curriculum-error-gate-{failure_mode}",
        split="release_gate",
        source_type="expert_authored",
        user_goal=f"模拟 curriculum {failure_mode}",
        actor=ActorContext(),
        scope=CURRICULUM_SCOPE,
        expected_status="error",
        trace_expectation=TraceExpectation(
            selected_scope=CURRICULUM_SCOPE,
            retrieval_called=True,
            clarification_expected=False,
            error_expected=True,
            fail_closed_expected=True,
        ),
        metadata={"failure_mode": failure_mode},
    )


__all__ = (
    "CURRICULUM_SCOPE",
    "HISTORY_FOLLOW_UP_DOC_ID",
    "LAW_FOLLOW_UP_DOC_ID",
    "ActorContext",
    "AppApiEvalClientSettings",
    "CapabilityResponse",
    "ClaimSupport",
    "EvidenceBundle",
    "EvidenceSource",
    "ExecutionResult",
    "GoldenCase",
    "KnowledgeScope",
    "OperatorRequestCorrelation",
    "Path",
    "RagRequestPayload",
    "RagResultPayload",
    "RemoteContentSuspicionSummary",
    "SourceTrustSummary",
    "TraceExpectation",
    "VersionQuery",
    "_completed_case",
    "_error_case",
    "_follow_up_case",
    "_source",
    "_strong_base_follow_up_case",
    "build_app_api_curriculum_live_executor",
    "build_curriculum_live_profile",
    "build_curriculum_program_semester_fact_document_id",
    "build_default_ragas_metric_names",
    "build_inprocess_curriculum_live_executor",
    "curriculum_error_gate_cases",
    "curriculum_release_gate_cases",
    "expected_source_ref",
    "httpx",
    "patch",
    "unittest",
)
