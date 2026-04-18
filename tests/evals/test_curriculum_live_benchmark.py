from __future__ import annotations

from pathlib import Path
import unittest
from unittest.mock import patch

import httpx

from campus_contracts import (
    ActorContext,
    ClaimSupport,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagResultPayload,
)
from campus_evals import (
    ExecutionResult,
    GoldenCase,
    TraceExpectation,
    build_default_ragas_metric_names,
    expected_source_ref,
)
from campus_evals.curriculum_live_benchmark import (
    AppApiEvalClientSettings,
    build_app_api_curriculum_live_executor,
    build_curriculum_live_profile,
    build_legacy_curriculum_live_executor,
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
) -> GoldenCase:
    return GoldenCase(
        case_id=case_id,
        split="release_gate",
        source_type="expert_authored",
        user_goal=user_goal,
        actor=ActorContext(),
        scope=CURRICULUM_SCOPE,
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


class CurriculumLiveExecutorTest(unittest.TestCase):
    def test_build_legacy_curriculum_live_executor_captures_retrieved_and_supporting_sources(self) -> None:
        retrieved_bundle = EvidenceBundle(
            query_text="民族学本科人才培养方案",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _source("curriculum:民族学本科人才培养方案", chunk_id="chunk-a", score=0.97),
                _source("curriculum:background", chunk_id="chunk-b", score=0.73),
            ),
        )
        executor = build_legacy_curriculum_live_executor(
            retriever=lambda *args, **kwargs: retrieved_bundle,
        )

        result = executor(_completed_case())

        self.assertTrue(result.observed_trace.retrieval_called)
        self.assertFalse(result.observed_trace.clarification_emitted)
        self.assertFalse(result.observed_trace.error_path)
        self.assertEqual(result.observed_trace.retrieved_sources, retrieved_bundle.sources)
        self.assertEqual(result.observed_trace.supporting_sources, result.response.result.evidence.sources)

    def test_build_app_api_curriculum_live_executor_captures_request_correlation_from_app_api(self) -> None:
        captured: dict[str, object] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["url"] = str(request.url)
            captured["header"] = request.headers.get("x-app-internal-auth")
            captured["body"] = request.content.decode("utf-8")
            return httpx.Response(
                200,
                request=request,
                headers={
                    "x-request-id": "req_curriculum_eval_01HQ",
                    "x-trace-id": "trace_curriculum_eval_01HQ",
                },
                json={
                    "answer": {
                        "conversation": {
                            "id": "conv_curriculum_eval_01HQ",
                            "title": "民族学本科人才培养方案",
                            "createdAt": "2026-04-03T00:00:00.000Z",
                            "updatedAt": "2026-04-03T00:00:01.000Z",
                            "messages": [],
                        },
                        "result": {
                            "kind": "answer",
                            "text": "民族学本科人才培养方案。",
                            "requestId": "req_curriculum_eval_01HQ",
                            "traceId": "trace_curriculum_eval_01HQ",
                        },
                    },
                    "supervisor": {
                        "answerText": "民族学本科人才培养方案。",
                        "followUpQuestion": "",
                        "selectedTarget": "rag-specialist",
                        "status": "completed",
                        "traceId": "trace_curriculum_eval_01HQ",
                        "result": {
                            "evidence": {
                                "query_text": "民族学本科人才培养方案",
                                "corpus": "curriculum",
                                "collection": "curriculum_plan",
                                "sources": [
                                    {
                                        "doc_id": "curriculum:民族学本科人才培养方案",
                                        "revision_track": "source-faithful",
                                        "version_id": "v1",
                                        "chunk_id": "chunk-1",
                                        "anchor": {"page": 1},
                                        "canonical_url": "https://example.edu/curriculum:民族学本科人才培养方案",
                                        "latest_url": "https://example.edu/curriculum:民族学本科人才培养方案",
                                        "source_channel": "pdf_ocr",
                                        "collection": "curriculum_plan",
                                        "is_current": True,
                                        "snippet": "民族学本科人才培养方案。",
                                        "score": 0.95,
                                        "source_title": "民族学本科人才培养方案",
                                    }
                                ],
                            }
                        },
                        "observability": {
                            "candidateCount": 6,
                            "citationCount": 1,
                            "citationExpected": True,
                            "citationMissing": False,
                            "retrievedSourceCount": 1,
                            "retrievedSources": [
                                {
                                    "doc_id": "curriculum:民族学本科人才培养方案",
                                    "chunk_id": "chunk-retrieved",
                                    "collection": "curriculum_plan",
                                    "score": 0.88,
                                    "source_title": "民族学本科人才培养方案",
                                }
                            ],
                            "retrievalAttempted": True,
                        },
                        "error": None,
                    },
                },
            )

        settings = AppApiEvalClientSettings(
            app_api_base_url="https://app-api.internal",
            internal_shared_secret="trusted-secret",
            eval_user_email="eval-benchmark@example.edu",
            eval_user_id="eval_user_01HQ",
            eval_user_name="Eval Benchmark",
        )
        transport = httpx.MockTransport(handler)
        client = httpx.Client(base_url="https://app-api.internal", transport=transport)

        try:
            executor = build_app_api_curriculum_live_executor(
                settings=settings,
                client=client,
            )
            result = executor(_completed_case())
        finally:
            client.close()

        self.assertIsInstance(result, ExecutionResult)
        self.assertEqual(captured["url"], "https://app-api.internal/api/internal/evals/chat/requests")
        self.assertEqual(captured["header"], "trusted-secret")
        self.assertEqual(
            result.request_correlation,
            OperatorRequestCorrelation(
                case_id="curriculum-release-gate-ethnology-title",
                request_id="req_curriculum_eval_01HQ",
                trace_id="trace_curriculum_eval_01HQ",
                sampled_at="2026-04-03T00:00:01.000Z",
            ),
        )
        self.assertEqual(result.response.status, "completed")
        self.assertEqual(result.response.answer_text, "民族学本科人才培养方案。")
        self.assertIsInstance(result.response.result, RagResultPayload)
        self.assertEqual(
            result.response.result.evidence.sources,
            (
                EvidenceSource(
                    doc_id="curriculum:民族学本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1",
                    chunk_id="chunk-1",
                    anchor={"page": 1},
                    canonical_url="https://example.edu/curriculum:民族学本科人才培养方案",
                    latest_url="https://example.edu/curriculum:民族学本科人才培养方案",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=True,
                    snippet="民族学本科人才培养方案。",
                    score=0.95,
                    source_title="民族学本科人才培养方案",
                ),
            ),
        )
        self.assertEqual(result.observed_trace.selected_scope, CURRICULUM_SCOPE)
        self.assertTrue(result.observed_trace.retrieval_called)
        self.assertEqual(
            result.observed_trace.retrieved_sources,
            (
                EvidenceSource(
                    doc_id="curriculum:民族学本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="observed-trace",
                    chunk_id="chunk-retrieved",
                    anchor={},
                    canonical_url="",
                    latest_url="",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="",
                    score=0.88,
                    source_title="民族学本科人才培养方案",
                ),
            ),
        )
        self.assertEqual(
            result.observed_trace.supporting_sources,
            result.response.result.evidence.sources,
        )

    def test_build_app_api_curriculum_live_executor_does_not_mirror_supporting_sources_for_clarification(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                request=request,
                headers={
                    "x-request-id": "req_curriculum_eval_clarify_01HQ",
                    "x-trace-id": "trace_curriculum_eval_clarify_01HQ",
                },
                json={
                    "answer": {
                        "conversation": {
                            "id": "conv_curriculum_eval_clarify_01HQ",
                            "title": "法学培养方案",
                            "createdAt": "2026-04-03T00:00:00.000Z",
                            "updatedAt": "2026-04-03T00:00:01.000Z",
                            "messages": [],
                        },
                        "result": {
                            "kind": "clarification",
                            "text": "请明确是法学民族实验班还是其他法学培养方案。",
                            "requestId": "req_curriculum_eval_clarify_01HQ",
                            "traceId": "trace_curriculum_eval_clarify_01HQ",
                        },
                    },
                    "supervisor": {
                        "status": "needs_clarification",
                        "selectedTarget": "rag-specialist",
                        "answerText": "请明确是法学民族实验班还是其他法学培养方案。",
                        "followUpQuestion": "请明确是法学民族实验班还是其他法学培养方案。",
                        "traceId": "trace_curriculum_eval_clarify_01HQ",
                        "result": {
                            "evidence": {
                                "query_text": "法学培养方案",
                                "corpus": "curriculum",
                                "collection": "curriculum_plan",
                                "sources": [
                                    {
                                        "doc_id": "curriculum:法学（民族实验班）本科人才培养方案",
                                        "revision_track": "source-faithful",
                                        "version_id": "v1",
                                        "chunk_id": "chunk-support",
                                        "anchor": {"page": 1},
                                        "canonical_url": "https://example.edu/curriculum:law",
                                        "latest_url": "https://example.edu/curriculum:law",
                                        "source_channel": "pdf_ocr",
                                        "collection": "curriculum_plan",
                                        "is_current": True,
                                        "snippet": "请明确是法学民族实验班还是其他法学培养方案。",
                                        "score": 0.91,
                                        "source_title": "法学（民族实验班）本科人才培养方案",
                                    }
                                ],
                            },
                            "diagnostics": {
                                "resolved_scope_corpus": "curriculum",
                                "resolved_scope_collection": "curriculum_plan",
                                "clarification_reason": "ambiguous_program",
                            },
                        },
                        "observability": {
                            "candidateCount": 0,
                            "retrievedSourceCount": 0,
                            "retrievalAttempted": False,
                            "citationExpected": False,
                            "citationCount": 0,
                            "citationMissing": False,
                        },
                        "error": None,
                    },
                },
            )

        settings = AppApiEvalClientSettings(
            app_api_base_url="https://app-api.internal",
            internal_shared_secret="trusted-secret",
            eval_user_email="eval-benchmark@example.edu",
        )
        transport = httpx.MockTransport(handler)
        client = httpx.Client(base_url="https://app-api.internal", transport=transport)

        try:
            executor = build_app_api_curriculum_live_executor(
                settings=settings,
                client=client,
            )
            result = executor(
                GoldenCase(
                    case_id="curriculum-needs-clarification-no-mirror",
                    split="release_gate",
                    source_type="expert_authored",
                    user_goal="法学培养方案",
                    actor=ActorContext(),
                    scope=CURRICULUM_SCOPE,
                    expected_status="needs_clarification",
                    trace_expectation=TraceExpectation(
                        selected_scope=CURRICULUM_SCOPE,
                        retrieval_called=False,
                        clarification_expected=True,
                        error_expected=False,
                    ),
                )
            )
        finally:
            client.close()

        self.assertEqual(result.response.status, "needs_clarification")
        self.assertFalse(result.observed_trace.retrieval_called)
        self.assertEqual(result.observed_trace.retrieved_sources, ())
        self.assertEqual(
            tuple(source.chunk_id for source in result.observed_trace.supporting_sources),
            ("chunk-support",),
        )

    def test_build_app_api_curriculum_live_executor_replays_multi_turn_follow_up_with_same_conversation(self) -> None:
        captured_bodies: list[str] = []

        def handler(request: httpx.Request) -> httpx.Response:
            payload = request.content.decode("utf-8")
            captured_bodies.append(payload)
            if len(captured_bodies) == 1:
                return httpx.Response(
                    200,
                    request=request,
                    headers={
                        "x-request-id": "req_curriculum_eval_followup_01",
                        "x-trace-id": "trace_curriculum_eval_followup_01",
                    },
                    json={
                        "answer": {
                            "conversation": {
                                "id": "conv_curriculum_eval_followup_01HQ",
                                "title": "法学民族班培养方案里大一上有什么课",
                                "createdAt": "2026-04-03T00:00:00.000Z",
                                "updatedAt": "2026-04-03T00:00:01.000Z",
                                "messages": [],
                            },
                            "result": {
                                "kind": "answer",
                                "text": "第一学期有法理学导论等课程。",
                                "requestId": "req_curriculum_eval_followup_01",
                                "traceId": "trace_curriculum_eval_followup_01",
                            },
                        },
                        "supervisor": {
                            "answerText": "第一学期有法理学导论等课程。",
                            "followUpQuestion": "",
                            "selectedTarget": "rag-specialist",
                            "status": "completed",
                            "traceId": "trace_curriculum_eval_followup_01",
                            "result": {
                                "evidence": {
                                    "query_text": "法学民族实验班培养方案里第一学期有什么课",
                                    "corpus": "curriculum",
                                    "collection": "curriculum_plan",
                                    "sources": [
                                        {
                                            "doc_id": "curriculum:法学（民族实验班）本科人才培养方案",
                                            "revision_track": "source-faithful",
                                            "version_id": "v1",
                                            "chunk_id": "chunk-1",
                                            "anchor": {"page": 1},
                                            "canonical_url": "https://example.edu/curriculum:法学（民族实验班）本科人才培养方案",
                                            "latest_url": "https://example.edu/curriculum:法学（民族实验班）本科人才培养方案",
                                            "source_channel": "pdf_ocr",
                                            "collection": "curriculum_plan",
                                            "is_current": True,
                                            "snippet": "第一学期有法理学导论。",
                                            "score": 0.94,
                                            "source_title": "法学（民族实验班）本科人才培养方案",
                                        }
                                    ],
                                }
                            },
                            "observability": {
                                "candidateCount": 6,
                                "citationCount": 1,
                                "citationExpected": True,
                                "citationMissing": False,
                                "retrievedSourceCount": 1,
                                "retrievalAttempted": True,
                            },
                            "error": None,
                        },
                    },
                )

            return httpx.Response(
                200,
                request=request,
                headers={
                    "x-request-id": "req_curriculum_eval_followup_02",
                    "x-trace-id": "trace_curriculum_eval_followup_02",
                },
                json={
                    "answer": {
                        "conversation": {
                            "id": "conv_curriculum_eval_followup_01HQ",
                            "title": "法学民族班培养方案里大一上有什么课",
                            "createdAt": "2026-04-03T00:00:00.000Z",
                            "updatedAt": "2026-04-03T00:00:02.000Z",
                            "messages": [],
                        },
                        "result": {
                            "kind": "answer",
                            "text": "第四学期有中国少数民族文字学、侵权责任法、翻译学导论。",
                            "requestId": "req_curriculum_eval_followup_02",
                            "traceId": "trace_curriculum_eval_followup_02",
                        },
                    },
                    "supervisor": {
                        "answerText": "第四学期有中国少数民族文字学、侵权责任法、翻译学导论。",
                        "followUpQuestion": "",
                        "selectedTarget": "rag-specialist",
                        "status": "completed",
                        "traceId": "trace_curriculum_eval_followup_02",
                        "result": {
                            "evidence": {
                                "query_text": "法学民族实验班培养方案里第四学期有什么课",
                                "corpus": "curriculum",
                                "collection": "curriculum_plan",
                                "sources": [
                                    {
                                        "doc_id": LAW_FOLLOW_UP_DOC_ID,
                                        "revision_track": "source-faithful",
                                        "version_id": "v1",
                                        "chunk_id": f"{LAW_FOLLOW_UP_DOC_ID}:row-0001",
                                        "anchor": {"page": 4},
                                        "canonical_url": "https://example.edu/curriculum:法学（民族实验班）本科人才培养方案",
                                        "latest_url": "https://example.edu/curriculum:法学（民族实验班）本科人才培养方案",
                                        "source_channel": "pdf_ocr",
                                        "collection": "program_semester_facts",
                                        "is_current": True,
                                        "snippet": "第四学期有中国少数民族文字学、侵权责任法、翻译学导论。",
                                        "score": 0.97,
                                        "source_title": "法学（民族实验班）本科人才培养方案 第四学期课程事实",
                                        "canonical_source_id": "curriculum:法学（民族实验班）本科人才培养方案",
                                        "canonical_source_title": "法学（民族实验班）本科人才培养方案",
                                        "source_unit_kind": "semester_course_list",
                                        "source_unit_key": "semester-4",
                                    }
                                ],
                            }
                        },
                        "observability": {
                            "candidateCount": 6,
                            "citationCount": 1,
                            "citationExpected": True,
                            "citationMissing": False,
                            "retrievedSourceCount": 1,
                            "retrievalAttempted": True,
                        },
                        "error": None,
                    },
                },
            )

        settings = AppApiEvalClientSettings(
            app_api_base_url="https://app-api.internal",
            internal_shared_secret="trusted-secret",
            eval_user_email="eval-benchmark@example.edu",
            eval_user_id="eval_user_01HQ",
            eval_user_name="Eval Benchmark",
        )
        transport = httpx.MockTransport(handler)
        client = httpx.Client(base_url="https://app-api.internal", transport=transport)

        try:
            executor = build_app_api_curriculum_live_executor(
                settings=settings,
                client=client,
            )
            result = executor(_follow_up_case())
        finally:
            client.close()

        self.assertIsInstance(result, ExecutionResult)
        self.assertEqual(len(captured_bodies), 2)
        self.assertIn('"prompt":"法学民族班培养方案里大一上有什么课"', captured_bodies[0])
        self.assertNotIn('"conversationId"', captured_bodies[0])
        self.assertIn('"prompt":"那大二下呢"', captured_bodies[1])
        self.assertIn('"conversationId":"conv_curriculum_eval_followup_01HQ"', captured_bodies[1])
        self.assertEqual(
            result.request_correlation,
            OperatorRequestCorrelation(
                case_id="curriculum-release-gate-program-follow-up-session-replay",
                request_id="req_curriculum_eval_followup_02",
                trace_id="trace_curriculum_eval_followup_02",
                sampled_at="2026-04-03T00:00:02.000Z",
            ),
        )
        self.assertEqual(result.response.status, "completed")
        self.assertEqual(result.response.answer_text, "第四学期有中国少数民族文字学、侵权责任法、翻译学导论。")
        self.assertTrue(result.observed_trace.retrieval_called)
        self.assertEqual(len(result.response.result.evidence.sources), 1)
        self.assertEqual(
            result.response.result.evidence.sources[0].doc_id,
            LAW_FOLLOW_UP_DOC_ID,
        )
        self.assertEqual(
            result.response.result.evidence.sources[0].canonical_source_id,
            "curriculum:法学（民族实验班）本科人才培养方案",
        )
        self.assertEqual(
            result.response.result.evidence.sources[0].source_unit_key,
            "semester-4",
        )

    def test_build_app_api_curriculum_live_executor_sends_verified_major_headers_for_follow_up_cases(self) -> None:
        captured_headers: list[dict[str, str | None]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            captured_headers.append(
                {
                    "x-eval-major": request.headers.get("x-eval-major"),
                    "x-eval-program": request.headers.get("x-eval-program"),
                    "x-eval-cohort": request.headers.get("x-eval-cohort"),
                }
            )
            return httpx.Response(
                200,
                request=request,
                headers={
                    "x-request-id": "req_curriculum_eval_followup_03",
                    "x-trace-id": "trace_curriculum_eval_followup_03",
                },
                json={
                    "answer": {
                        "conversation": {
                            "id": "conv_curriculum_eval_followup_03HQ",
                            "title": "历史学强基计划培养方案里大一上有什么课",
                            "createdAt": "2026-04-03T00:00:00.000Z",
                            "updatedAt": "2026-04-03T00:00:02.000Z",
                            "messages": [],
                        },
                        "result": {
                            "kind": "answer",
                            "text": "第四学期有大学英语(四)、中华民族共同体概论、中国近代边疆民族史料研读、世界现当代史。",
                            "requestId": "req_curriculum_eval_followup_03",
                            "traceId": "trace_curriculum_eval_followup_03",
                        },
                    },
                    "supervisor": {
                        "answerText": "第四学期有大学英语(四)、中华民族共同体概论、中国近代边疆民族史料研读、世界现当代史。",
                        "followUpQuestion": "",
                        "selectedTarget": "rag-specialist",
                        "status": "completed",
                        "traceId": "trace_curriculum_eval_followup_03",
                        "result": {
                            "evidence": {
                                "query_text": "历史学（强基计划）本科人才培养方案里第四学期有什么课",
                                "corpus": "curriculum",
                                "collection": "curriculum_plan",
                                "sources": [
                                    {
                                        "doc_id": HISTORY_FOLLOW_UP_DOC_ID,
                                        "revision_track": "source-faithful",
                                        "version_id": "v1",
                                        "chunk_id": f"{HISTORY_FOLLOW_UP_DOC_ID}:row-0001",
                                        "anchor": {"page": 24},
                                        "canonical_url": "https://example.edu/curriculum:历史学（强基计划）本科人才培养方案",
                                        "latest_url": "https://example.edu/curriculum:历史学（强基计划）本科人才培养方案",
                                        "source_channel": "pdf_ocr",
                                        "collection": "program_semester_facts",
                                        "is_current": True,
                                        "snippet": "第四学期有大学英语(四)、中华民族共同体概论、中国近代边疆民族史料研读、世界现当代史。",
                                        "score": 0.96,
                                        "source_title": "历史学（强基计划）本科人才培养方案 第四学期课程事实",
                                        "canonical_source_id": "curriculum:历史学（强基计划）本科人才培养方案",
                                        "canonical_source_title": "历史学（强基计划）本科人才培养方案",
                                        "source_unit_kind": "semester_course_list",
                                        "source_unit_key": "semester-4",
                                    }
                                ],
                            }
                        },
                        "observability": {
                            "candidateCount": 4,
                            "citationCount": 1,
                            "citationExpected": True,
                            "citationMissing": False,
                            "retrievedSourceCount": 1,
                            "retrievalAttempted": True,
                        },
                        "error": None,
                    },
                },
            )

        settings = AppApiEvalClientSettings(
            app_api_base_url="https://app-api.internal",
            internal_shared_secret="trusted-secret",
            eval_user_email="eval-benchmark@example.edu",
            eval_user_id="eval_user_01HQ",
            eval_user_name="Eval Benchmark",
        )
        transport = httpx.MockTransport(handler)
        client = httpx.Client(base_url="https://app-api.internal", transport=transport)

        try:
            executor = build_app_api_curriculum_live_executor(
                settings=settings,
                client=client,
            )
            result = executor(_strong_base_follow_up_case())
        finally:
            client.close()

        self.assertIsInstance(result, ExecutionResult)
        self.assertEqual(len(captured_headers), 2)
        self.assertEqual(captured_headers[0]["x-eval-major"], "b64:5Y6G5Y+y5a2m")
        self.assertEqual(captured_headers[1]["x-eval-major"], "b64:5Y6G5Y+y5a2m")
        self.assertIsNone(captured_headers[0]["x-eval-program"])
        self.assertIsNone(captured_headers[0]["x-eval-cohort"])
        self.assertEqual(result.response.status, "completed")
        self.assertEqual(
            result.response.answer_text,
            "第四学期有大学英语(四)、中华民族共同体概论、中国近代边疆民族史料研读、世界现当代史。",
        )
        self.assertEqual(
            result.response.result.evidence.sources[0].doc_id,
            HISTORY_FOLLOW_UP_DOC_ID,
        )
        self.assertEqual(
            result.response.result.evidence.sources[0].canonical_source_id,
            "curriculum:历史学（强基计划）本科人才培养方案",
        )
        self.assertEqual(
            result.response.result.evidence.sources[0].source_unit_key,
            "semester-4",
        )

    def test_build_app_api_curriculum_live_executor_preserves_supervisor_diagnostics_and_observability(self) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                request=request,
                headers={
                    "x-request-id": "req_curriculum_eval_no_answer_01HQ",
                    "x-trace-id": "trace_curriculum_eval_no_answer_01HQ",
                },
                json={
                    "answer": {
                        "conversation": {
                            "id": "conv_curriculum_eval_no_answer_01HQ",
                            "title": "火星校区飞船停靠规则",
                            "createdAt": "2026-04-03T00:00:00.000Z",
                            "updatedAt": "2026-04-03T00:00:01.000Z",
                            "messages": [],
                        },
                        "result": {
                            "kind": "no_answer",
                            "text": "当前未检索到足够依据支持回答这个培养方案问题，请补充更具体的培养方案名称、学位要求或课程表名称。",
                            "requestId": "req_curriculum_eval_no_answer_01HQ",
                            "traceId": "trace_curriculum_eval_no_answer_01HQ",
                        },
                    },
                    "supervisor": {
                        "answerText": "当前未检索到足够依据支持回答这个培养方案问题，请补充更具体的培养方案名称、学位要求或课程表名称。",
                        "followUpQuestion": "",
                        "selectedTarget": "rag-specialist",
                        "status": "no_answer",
                        "traceId": "trace_curriculum_eval_no_answer_01HQ",
                        "result": {
                            "evidence": {
                                "query_text": "火星校区飞船停靠规则",
                                "corpus": "curriculum",
                                "collection": "curriculum_plan",
                                "sources": [],
                            },
                            "diagnostics": {
                                "resolved_scope_corpus": "curriculum",
                                "resolved_scope_collection": "curriculum_plan",
                                "no_answer_reason": "",
                                "semantic_outcome": "unsupported_by_evidence",
                                "retrieval_adequacy_verdict": "sufficient",
                                "retrieval_adequacy_reason": "sufficient",
                                "grounding_verdict": "unsupported",
                                "claim_supports": [
                                    {
                                        "claim_type": "offering_unit_or_owning_school",
                                        "claim_text": "马克思主义学院",
                                        "supported": False,
                                        "support_source_doc_id": "",
                                        "support_snippet": "",
                                    }
                                ],
                                "unsupported_fields": ["offering_unit_claims"],
                                "resolution_mode": "",
                                "retrieved_title_summary": [],
                            },
                        },
                        "observability": {
                            "candidateCount": 0,
                            "retrievedSourceCount": 0,
                            "retrievalAttempted": True,
                            "citationExpected": False,
                            "citationCount": 0,
                            "citationMissing": False,
                            "failClosed": True,
                            "refusalClass": "no_answer",
                            "semanticOutcome": "unsupported_by_evidence",
                            "scopeClass": "in_scope",
                            "policyReason": "",
                            "resolvedScopeCorpus": "curriculum",
                            "resolvedScopeCollection": "curriculum_plan",
                            "promptRuntimeState": "content_filter",
                            "promptRuntimeDetail": "content_filter",
                            "promptTrace": {
                                "promptId": "rag_unsupported_v1",
                                "promptVersion": "v1",
                                "templateSha256": "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
                                "variablesSchemaVersion": "v1",
                                "outputSchemaVersion": "v1",
                                "modelProvider": "openai-responses",
                                "modelName": "gpt-5.2-mini",
                            },
                        },
                        "error": None,
                    },
                },
            )

        settings = AppApiEvalClientSettings(
            app_api_base_url="https://app-api.internal",
            internal_shared_secret="trusted-secret",
            eval_user_email="eval-benchmark@example.edu",
            eval_user_id="eval_user_01HQ",
            eval_user_name="Eval Benchmark",
        )
        transport = httpx.MockTransport(handler)
        client = httpx.Client(base_url="https://app-api.internal", transport=transport)

        try:
            executor = build_app_api_curriculum_live_executor(
                settings=settings,
                client=client,
            )
            result = executor(
                GoldenCase(
                    case_id="curriculum-release-gate-no-answer",
                    split="release_gate",
                    source_type="expert_authored",
                    user_goal="火星校区飞船停靠规则",
                    actor=ActorContext(),
                    scope=CURRICULUM_SCOPE,
                    expected_status="no_answer",
                    expected_semantic_outcome="unsupported_by_evidence",
                    trace_expectation=TraceExpectation(
                        selected_scope=CURRICULUM_SCOPE,
                        retrieval_called=True,
                        clarification_expected=False,
                        error_expected=False,
                        fail_closed_expected=True,
                    ),
                )
            )
        finally:
            client.close()

        self.assertEqual(result.response.status, "no_answer")
        self.assertIsNotNone(result.response.result)
        self.assertIsNotNone(result.response.result.diagnostics)
        self.assertEqual(result.response.result.diagnostics.semantic_outcome, "unsupported_by_evidence")
        self.assertEqual(result.response.result.diagnostics.retrieval_adequacy_verdict, "sufficient")
        self.assertEqual(result.response.result.diagnostics.retrieval_adequacy_reason, "sufficient")
        self.assertEqual(result.response.result.diagnostics.grounding_verdict, "unsupported")
        self.assertEqual(result.response.result.diagnostics.unsupported_fields, ("offering_unit_claims",))
        self.assertEqual(
            result.response.result.diagnostics.claim_supports,
            (
                ClaimSupport(
                    claim_type="offering_unit_or_owning_school",
                    claim_text="马克思主义学院",
                    supported=False,
                    support_source_doc_id="",
                    support_snippet="",
                ),
            ),
        )
        self.assertEqual(result.response.result.diagnostics.resolved_scope_collection, "curriculum_plan")
        self.assertIsNotNone(result.response.observability)
        self.assertEqual(result.response.observability.semantic_outcome, "unsupported_by_evidence")
        self.assertEqual(result.response.observability.scope_class, "in_scope")
        self.assertEqual(result.response.observability.resolved_scope_corpus, "curriculum")
        self.assertEqual(result.response.observability.resolved_scope_collection, "curriculum_plan")
        self.assertTrue(result.response.observability.fail_closed)
        self.assertEqual(result.response.observability.prompt_runtime_state, "content_filter")
        self.assertEqual(result.response.observability.prompt_runtime_detail, "content_filter")
        self.assertIsNotNone(result.response.observability.prompt_trace)
        self.assertEqual(result.response.observability.prompt_trace.prompt_id, "rag_unsupported_v1")

    def test_build_legacy_curriculum_live_executor_injects_retrieval_backend_failure_case(self) -> None:
        executor = build_legacy_curriculum_live_executor(
            retriever=lambda *args, **kwargs: EvidenceBundle(
                query_text="民族学本科人才培养方案",
                corpus="curriculum",
                collection="curriculum_plan",
                sources=(_source("curriculum:民族学本科人才培养方案"),),
            ),
        )

        result = executor(_error_case(failure_mode="retrieval_backend_failure"))

        self.assertEqual(result.response.status, "error")
        self.assertEqual(result.response.error.code, "retrieval_failed")
        self.assertTrue(result.observed_trace.retrieval_called)
        self.assertTrue(result.observed_trace.error_path)
        self.assertEqual(result.observed_trace.retrieved_sources, ())
        self.assertEqual(result.observed_trace.supporting_sources, ())

    def test_build_legacy_curriculum_live_executor_injects_evidence_shaping_failure_case(self) -> None:
        executor = build_legacy_curriculum_live_executor(
            retriever=lambda *args, **kwargs: EvidenceBundle(
                query_text="经济学拔尖人才创新班人才培养方案课程地图怎么安排？",
                corpus="curriculum",
                collection="curriculum_plan",
                sources=(_source("curriculum:经济学拔尖人才创新班人才培养方案"),),
            ),
        )

        result = executor(_error_case(failure_mode="evidence_shaping_failure"))

        self.assertEqual(result.response.status, "error")
        self.assertEqual(result.response.error.code, "evidence_shaping_failed")
        self.assertTrue(result.observed_trace.retrieval_called)
        self.assertTrue(result.observed_trace.error_path)
        self.assertEqual(result.observed_trace.retrieved_sources, ())
        self.assertEqual(result.observed_trace.supporting_sources, ())

    def test_build_legacy_curriculum_live_executor_injects_invalid_backend_contract_case(self) -> None:
        executor = build_legacy_curriculum_live_executor(
            retriever=lambda *args, **kwargs: EvidenceBundle(
                query_text="民族学本科第二学士学位人才培养方案学制几年？",
                corpus="curriculum",
                collection="curriculum_plan",
                sources=(_source("curriculum:民族学本科第二学士学位人才培养方案"),),
            ),
        )

        result = executor(_error_case(failure_mode="invalid_backend_contract"))

        self.assertEqual(result.response.status, "error")
        self.assertEqual(result.response.error.code, "invalid_backend_contract")
        self.assertTrue(result.observed_trace.retrieval_called)
        self.assertTrue(result.observed_trace.error_path)
        self.assertEqual(result.observed_trace.retrieved_sources, ())
        self.assertEqual(result.observed_trace.supporting_sources, ())


class AppApiEvalClientSettingsTest(unittest.TestCase):
    def test_from_env_uses_profile_default_timeout_when_env_override_is_absent(self) -> None:
        settings = AppApiEvalClientSettings.from_env(
            {
                "APP_API_BASE_URL": "https://app-api.internal",
                "APP_API_INTERNAL_SHARED_SECRET": "trusted-secret",
                "APP_API_EVAL_USER_EMAIL": "eval-benchmark@example.edu",
            },
            default_timeout_seconds=180.0,
        )

        self.assertEqual(settings.timeout_seconds, 180.0)

    def test_from_env_prefers_explicit_env_timeout_over_profile_default(self) -> None:
        settings = AppApiEvalClientSettings.from_env(
            {
                "APP_API_BASE_URL": "https://app-api.internal",
                "APP_API_INTERNAL_SHARED_SECRET": "trusted-secret",
                "APP_API_EVAL_USER_EMAIL": "eval-benchmark@example.edu",
                "APP_API_EVAL_HTTP_TIMEOUT_SECONDS": "45",
            },
            default_timeout_seconds=180.0,
        )

        self.assertEqual(settings.timeout_seconds, 45.0)


class CurriculumLiveProfileTest(unittest.TestCase):
    def test_build_curriculum_live_profile_uses_curriculum_policy_and_metric_named_ragas_adapter(self) -> None:
        profile = build_curriculum_live_profile(
            env={
                "EVAL_LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EVAL_EMBEDDING_API_KEY": "embed-key",
                "EVAL_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )

        self.assertEqual(profile.benchmark_type, "curriculum_live_gate")
        self.assertEqual(Path(profile.policy_path).name, "curriculum_plan_live_gate_policy.json")
        self.assertEqual(profile.http_settings.read_timeout_seconds, 180.0)
        self.assertEqual(profile.http_settings.retry_attempts, 1)
        self.assertEqual(profile.http_settings.request_min_interval_seconds, 1.0)
        self.assertEqual(profile.http_settings.circuit_breaker_failure_threshold, 5)
        self.assertEqual(profile.http_settings.circuit_breaker_cooldown_seconds, 15.0)
        adapters = profile.supplemental_adapters_factory()
        self.assertEqual(len(adapters), 1)
        self.assertEqual(adapters[0].metric_names, build_default_ragas_metric_names())

    def test_build_curriculum_live_profile_uses_repo_tracked_http_settings_instead_of_env(self) -> None:
        profile = build_curriculum_live_profile(
            env={
                "EVAL_LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EVAL_EMBEDDING_API_KEY": "embed-key",
                "EVAL_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "EVAL_HTTP_READ_TIMEOUT_SECONDS": "90",
            }
        )

        self.assertEqual(profile.http_settings.read_timeout_seconds, 180.0)
        self.assertEqual(profile.http_settings.request_min_interval_seconds, 1.0)

    def test_build_curriculum_live_profile_aligns_app_api_eval_timeout_with_profile_http_settings(self) -> None:
        profile = build_curriculum_live_profile(
            env={
                "APP_API_BASE_URL": "https://app-api.internal",
                "APP_API_INTERNAL_SHARED_SECRET": "trusted-secret",
                "APP_API_EVAL_USER_EMAIL": "eval-benchmark@example.edu",
                "EVAL_LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EVAL_EMBEDDING_API_KEY": "embed-key",
                "EVAL_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )

        with patch("campus_evals.curriculum_live_benchmark.build_curriculum_live_executor", return_value="executor") as build_executor:
            executor = profile.executor_factory()

        self.assertEqual(executor, "executor")
        self.assertEqual(
            build_executor.call_args.kwargs["default_timeout_seconds"],
            profile.http_settings.read_timeout_seconds,
        )


if __name__ == "__main__":
    unittest.main()
