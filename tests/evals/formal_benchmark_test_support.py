from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_contracts import (
    ActorContext,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagResultPayload,
    ToolResponse,
)
from campus_evals import (
    ExecutionResult,
    GoldenCase,
    ObservedTrace,
    SupplementalResult,
    TraceExpectation,
    expected_source_ref,
)
from campus_evals.faithfulness_runtime import current_faithfulness_artifact_context
from campus_evals.formal_benchmark import (
    collect_repairable_benchmark_targets,
    repair_formal_benchmark,
    run_formal_benchmark,
)
from campus_evals.judge_gate import evaluate_judge_gate, load_judge_gate_policy
from campus_evals.operator_observability import OperatorRequestCorrelation

HANDBOOK_SCOPE = KnowledgeScope(corpus="regulations", collection="student_rules")


def _source(doc_id: str) -> EvidenceSource:
    return EvidenceSource(
        doc_id=doc_id,
        revision_track="source-faithful",
        version_id="v1",
        chunk_id="chunk-1",
        anchor={"page": 1},
        canonical_url=f"https://example.edu/{doc_id}",
        latest_url=f"https://example.edu/{doc_id}",
        source_channel="pdf_ocr",
        collection="student_rules",
        is_current=False,
        snippet="snippet",
        score=0.95,
    )


def _completed_case() -> GoldenCase:
    return GoldenCase(
        case_id="benchmark-completed",
        split="release_gate",
        source_type="expert_authored",
        user_goal="图书馆开放时间是什么？",
        actor=ActorContext(),
        scope=HANDBOOK_SCOPE,
        expected_status="completed",
        expected_sources=(expected_source_ref("handbook:library"),),
        required_facts=("08:00",),
        trace_expectation=TraceExpectation(selected_scope=HANDBOOK_SCOPE, retrieval_called=True),
    )


def _no_answer_case() -> GoldenCase:
    return GoldenCase(
        case_id="benchmark-no-answer",
        split="release_gate",
        source_type="expert_authored",
        user_goal="火星校区飞船停靠规则",
        actor=ActorContext(),
        scope=HANDBOOK_SCOPE,
        expected_status="no_answer",
        trace_expectation=TraceExpectation(
            selected_scope=HANDBOOK_SCOPE,
            retrieval_called=True,
            fail_closed_expected=True,
        ),
    )


def _response(
    *,
    status: str,
    answer_text: str = "",
    sources: tuple[EvidenceSource, ...] = (),
    follow_up_question: str = "",
) -> ToolResponse:
    return ToolResponse(
        tool="knowledge_query",
        status=status,
        answer_text=answer_text,
        confidence="high" if status == "completed" else "low",
        follow_up_question=follow_up_question,
        result=RagResultPayload(
            evidence=EvidenceBundle(
                query_text="query",
                corpus="regulations",
                collection="student_rules",
                sources=sources,
            )
        ),
    )


__all__ = (
    "HANDBOOK_SCOPE",
    "ActorContext",
    "EvidenceBundle",
    "EvidenceSource",
    "ExecutionResult",
    "GoldenCase",
    "KnowledgeScope",
    "ObservedTrace",
    "OperatorRequestCorrelation",
    "Path",
    "RagResultPayload",
    "SupplementalResult",
    "TemporaryDirectory",
    "ToolResponse",
    "TraceExpectation",
    "_completed_case",
    "_no_answer_case",
    "_response",
    "_source",
    "collect_repairable_benchmark_targets",
    "current_faithfulness_artifact_context",
    "evaluate_judge_gate",
    "expected_source_ref",
    "json",
    "load_judge_gate_policy",
    "repair_formal_benchmark",
    "run_formal_benchmark",
    "unittest",
)
