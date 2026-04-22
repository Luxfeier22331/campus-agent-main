from __future__ import annotations

from tests.evals.curriculum_live_benchmark_test_support import (
    HISTORY_FOLLOW_UP_DOC_ID,
    LAW_FOLLOW_UP_DOC_ID,
    AppApiEvalClientSettings,
    ExecutionResult,
    OperatorRequestCorrelation,
    _follow_up_case,
    _strong_base_follow_up_case,
    build_app_api_curriculum_live_executor,
    httpx,
    unittest,
)


class CurriculumLiveExecutorAppApiFollowUpTest(unittest.TestCase):
    def test_build_app_api_curriculum_live_executor_replays_multi_turn_follow_up_with_same_conversation(
        self,
    ) -> None:
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
                            "selectedTarget": "rag-agent",
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
                        "selectedTarget": "rag-agent",
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
        self.assertEqual(
            result.response.answer_text, "第四学期有中国少数民族文字学、侵权责任法、翻译学导论。"
        )
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

    def test_build_app_api_curriculum_live_executor_sends_verified_major_headers_for_follow_up_cases(
        self,
    ) -> None:
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
                        "selectedTarget": "rag-agent",
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
