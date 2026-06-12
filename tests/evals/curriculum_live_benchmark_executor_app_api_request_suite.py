from __future__ import annotations

from tests.evals.curriculum_live_benchmark_test_support import (
    CURRICULUM_SCOPE,
    ActorContext,
    AppApiEvalClientSettings,
    EvidenceSource,
    ExecutionResult,
    GoldenCase,
    OperatorRequestCorrelation,
    RagResultPayload,
    TraceExpectation,
    VersionQuery,
    _completed_case,
    build_app_api_curriculum_live_executor,
    httpx,
    unittest,
)


class CurriculumLiveExecutorAppApiRequestTest(unittest.TestCase):
    def test_build_app_api_curriculum_live_executor_captures_request_correlation_from_app_api(
        self,
    ) -> None:
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
                        "selectedCapability": "knowledge",
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
        self.assertEqual(
            captured["url"], "https://app-api.internal/api/internal/evals/chat/requests"
        )
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

    def test_build_app_api_curriculum_live_executor_does_not_mirror_supporting_sources_for_clarification(
        self,
    ) -> None:
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
                        "selectedCapability": "knowledge",
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

    def test_build_app_api_curriculum_live_executor_passes_non_current_version_query_to_app_api(
        self,
    ) -> None:
        captured: dict[str, object] = {}

        def handler(request: httpx.Request) -> httpx.Response:
            captured["body"] = request.content.decode("utf-8")
            return httpx.Response(
                200,
                request=request,
                headers={
                    "x-request-id": "req_curriculum_eval_compare_01HQ",
                    "x-trace-id": "trace_curriculum_eval_compare_01HQ",
                },
                json={
                    "answer": {
                        "conversation": {
                            "id": "conv_curriculum_eval_compare_01HQ",
                            "title": "民族学本科人才培养方案",
                            "createdAt": "2026-04-03T00:00:00.000Z",
                            "updatedAt": "2026-04-03T00:00:01.000Z",
                            "messages": [],
                        },
                        "result": {
                            "kind": "answer",
                            "text": "2024 与 2025 版培养方案在第四学期课程安排上存在差异。",
                            "requestId": "req_curriculum_eval_compare_01HQ",
                            "traceId": "trace_curriculum_eval_compare_01HQ",
                        },
                    },
                    "supervisor": {
                        "answerText": "2024 与 2025 版培养方案在第四学期课程安排上存在差异。",
                        "followUpQuestion": "",
                        "selectedCapability": "knowledge",
                        "status": "completed",
                        "traceId": "trace_curriculum_eval_compare_01HQ",
                        "result": None,
                        "observability": None,
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
            executor(
                _completed_case(
                    version_query=VersionQuery(
                        mode="compare",
                        version_id="v2024-curriculum-plan",
                        compare_to_version_id="v2025-curriculum-plan",
                    )
                )
            )
        finally:
            client.close()

        self.assertEqual(
            captured["body"],
            '{"prompt":"民族学本科人才培养方案","requestedCapability":"knowledge","requestedScope":{"corpus":"curriculum","collection":"curriculum_plan"},"versionQuery":{"mode":"compare","versionId":"v2024-curriculum-plan","compareToVersionId":"v2025-curriculum-plan"}}',
        )
