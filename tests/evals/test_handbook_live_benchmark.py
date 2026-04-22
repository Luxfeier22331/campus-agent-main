from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import httpx
from campus_contracts import (
    ActorContext,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagRequestPayload,
    RagResultPayload,
    SpecialistResponse,
    VersionQuery,
)
from campus_evals import ExecutionResult, GoldenCase, TraceExpectation
from campus_evals.handbook_live_benchmark import (
    AppApiEvalClientSettings,
    build_app_api_handbook_live_executor,
    build_default_output_dir,
    build_handbook_live_profile,
    build_legacy_handbook_live_executor,
    main,
)
from campus_evals.operator_observability import OperatorRequestCorrelation

HANDBOOK_SCOPE = KnowledgeScope(corpus="regulations", collection="student_rules")


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
        collection="student_rules",
        is_current=True,
        snippet=f"snippet for {doc_id}",
        score=score,
        source_title=doc_id,
    )


def _case(
    *,
    case_id: str = "release-gate-student-card",
    user_goal: str = "学生证丢了怎么办",
    version_query: VersionQuery | None = None,
) -> GoldenCase:
    return GoldenCase(
        case_id=case_id,
        split="release_gate",
        source_type="expert_authored",
        user_goal=user_goal,
        actor=ActorContext(),
        scope=HANDBOOK_SCOPE,
        version_query=version_query or VersionQuery(),
        expected_status="completed",
        trace_expectation=TraceExpectation(
            selected_scope=HANDBOOK_SCOPE,
            retrieval_called=True,
            clarification_expected=False,
            error_expected=False,
        ),
    )


class HandbookLiveExecutorTest(unittest.TestCase):
    def test_build_handbook_live_executor_captures_retrieved_and_supporting_sources(self) -> None:
        retrieved_bundle = EvidenceBundle(
            query_text="学生证丢了怎么办",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _source(
                    "handbook:e90f9707387f9e232ea88ce1c7f5328242e52389",
                    chunk_id="chunk-a",
                    score=0.97,
                ),
                _source("handbook:background", chunk_id="chunk-b", score=0.73),
            ),
        )
        supporting_source = retrieved_bundle.sources[0]
        seen_requests = []

        def fake_delegate(request, *, retriever):
            seen_requests.append(request)
            bundle = retriever(
                request.user_goal,
                corpus=request.payload.scope.corpus,
                collection=request.payload.scope.collection,
                authorized_filter=request.context.authorization.retrieval_filter,
                personalization_hint=None,
            )
            self.assertEqual(bundle, retrieved_bundle)
            return SpecialistResponse(
                target="rag-agent",
                status="completed",
                answer_text="学生证遗失后应补办学生证。",
                confidence="high",
                result=RagResultPayload(
                    evidence=EvidenceBundle(
                        query_text=request.user_goal,
                        corpus=bundle.corpus,
                        collection=bundle.collection,
                        sources=(supporting_source,),
                    )
                ),
            )

        executor = build_legacy_handbook_live_executor(
            retriever=lambda *args, **kwargs: retrieved_bundle,
            delegate=fake_delegate,
        )

        result = executor(_case())

        self.assertIsInstance(result, ExecutionResult)
        self.assertEqual(len(seen_requests), 1)
        self.assertEqual(seen_requests[0].payload, RagRequestPayload(scope=HANDBOOK_SCOPE))
        self.assertEqual(result.observed_trace.selected_scope, HANDBOOK_SCOPE)
        self.assertTrue(result.observed_trace.retrieval_called)
        self.assertFalse(result.observed_trace.clarification_emitted)
        self.assertFalse(result.observed_trace.error_path)
        self.assertEqual(result.observed_trace.retrieved_sources, retrieved_bundle.sources)
        self.assertEqual(result.observed_trace.supporting_sources, (supporting_source,))

    def test_build_handbook_live_executor_passes_case_version_query(self) -> None:
        seen_requests = []

        def fake_delegate(request, *, retriever):
            seen_requests.append(request)
            return SpecialistResponse(
                target="rag-agent",
                status="no_answer",
                answer_text="当前依据不足。",
                confidence="low",
                result=RagResultPayload(
                    evidence=EvidenceBundle(
                        query_text=request.user_goal,
                        corpus=request.payload.scope.corpus,
                        collection=request.payload.scope.collection,
                    )
                ),
            )

        executor = build_legacy_handbook_live_executor(
            retriever=lambda *args, **kwargs: EvidenceBundle(
                query_text="上一版学生证补办流程",
                corpus="regulations",
                collection="student_rules",
            ),
            delegate=fake_delegate,
        )

        executor(_case(version_query=VersionQuery(mode="historical")))

        self.assertEqual(len(seen_requests), 1)
        self.assertEqual(seen_requests[0].payload.version_query, VersionQuery(mode="historical"))

    def test_build_app_api_handbook_live_executor_captures_request_correlation_from_app_api(
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
                    "x-request-id": "req_eval_01HQ",
                    "x-trace-id": "trace_eval_01HQ",
                },
                json={
                    "answer": {
                        "conversation": {
                            "id": "conv_eval_01HQ",
                            "title": "图书馆开放时间",
                            "createdAt": "2026-04-03T00:00:00.000Z",
                            "updatedAt": "2026-04-03T00:00:01.000Z",
                            "messages": [],
                        },
                        "result": {
                            "kind": "answer",
                            "text": "图书馆开放到 22:00。",
                            "requestId": "req_eval_01HQ",
                            "traceId": "trace_eval_01HQ",
                        },
                    },
                    "supervisor": {
                        "answerText": "图书馆开放到 22:00。",
                        "followUpQuestion": "",
                        "selectedTarget": "rag-agent",
                        "status": "completed",
                        "traceId": "trace_eval_01HQ",
                        "result": {
                            "evidence": {
                                "query_text": "学生证丢了怎么办",
                                "corpus": "regulations",
                                "collection": "student_rules",
                                "sources": [
                                    {
                                        "doc_id": "handbook:e90f9707387f9e232ea88ce1c7f5328242e52389",
                                        "revision_track": "source-faithful",
                                        "version_id": "v1",
                                        "chunk_id": "chunk-a",
                                        "anchor": {"page": 1},
                                        "canonical_url": "https://example.edu/handbook:e90f9707387f9e232ea88ce1c7f5328242e52389",
                                        "latest_url": "https://example.edu/handbook:e90f9707387f9e232ea88ce1c7f5328242e52389",
                                        "source_channel": "pdf_ocr",
                                        "collection": "student_rules",
                                        "is_current": True,
                                        "snippet": "学生如将学生证遗失或损坏,应及时到学院(系)挂失。",
                                        "score": 0.97,
                                        "source_title": "学生证管理",
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
            executor = build_app_api_handbook_live_executor(
                settings=settings,
                client=client,
            )
            result = executor(_case())
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
                case_id="release-gate-student-card",
                request_id="req_eval_01HQ",
                trace_id="trace_eval_01HQ",
                sampled_at="2026-04-03T00:00:01.000Z",
            ),
        )
        self.assertEqual(result.response.status, "completed")
        self.assertEqual(result.response.answer_text, "图书馆开放到 22:00。")
        self.assertIsInstance(result.response.result, RagResultPayload)
        self.assertEqual(
            result.response.result.evidence.sources,
            (
                EvidenceSource(
                    doc_id="handbook:e90f9707387f9e232ea88ce1c7f5328242e52389",
                    revision_track="source-faithful",
                    version_id="v1",
                    chunk_id="chunk-a",
                    anchor={"page": 1},
                    canonical_url="https://example.edu/handbook:e90f9707387f9e232ea88ce1c7f5328242e52389",
                    latest_url="https://example.edu/handbook:e90f9707387f9e232ea88ce1c7f5328242e52389",
                    source_channel="pdf_ocr",
                    collection="student_rules",
                    is_current=True,
                    snippet="学生如将学生证遗失或损坏,应及时到学院(系)挂失。",
                    score=0.97,
                    source_title="学生证管理",
                ),
            ),
        )
        self.assertEqual(result.observed_trace.selected_scope, HANDBOOK_SCOPE)
        self.assertTrue(result.observed_trace.retrieval_called)
        self.assertEqual(
            result.observed_trace.retrieved_sources,
            result.response.result.evidence.sources,
        )
        self.assertEqual(
            result.observed_trace.supporting_sources,
            result.response.result.evidence.sources,
        )

    def test_build_app_api_handbook_live_executor_rejects_non_current_version_query(self) -> None:
        settings = AppApiEvalClientSettings(
            app_api_base_url="https://app-api.internal",
            internal_shared_secret="trusted-secret",
            eval_user_email="eval-benchmark@example.edu",
        )
        transport = httpx.MockTransport(
            lambda request: httpx.Response(200, request=request, json={})
        )
        client = httpx.Client(base_url="https://app-api.internal", transport=transport)

        try:
            executor = build_app_api_handbook_live_executor(
                settings=settings,
                client=client,
            )
            with self.assertRaisesRegex(ValueError, "version_query"):
                executor(_case(version_query=VersionQuery(mode="historical")))
        finally:
            client.close()

    def test_build_app_api_handbook_live_executor_renders_trace_backlink_from_template(
        self,
    ) -> None:
        def handler(request: httpx.Request) -> httpx.Response:
            return httpx.Response(
                200,
                request=request,
                headers={
                    "x-request-id": "req_eval_01HQ",
                    "x-trace-id": "trace_eval_01HQ",
                },
                json={
                    "answer": {
                        "conversation": {
                            "id": "conv_eval_01HQ",
                            "title": "图书馆开放时间",
                            "createdAt": "2026-04-03T00:00:00.000Z",
                            "updatedAt": "2026-04-03T00:00:01.000Z",
                            "messages": [],
                        },
                        "result": {
                            "kind": "answer",
                            "text": "图书馆开放到 22:00。",
                            "requestId": "req_eval_01HQ",
                            "traceId": "trace_eval_01HQ",
                        },
                    },
                    "supervisor": {
                        "answerText": "图书馆开放到 22:00。",
                        "followUpQuestion": "",
                        "selectedTarget": "rag-agent",
                        "status": "completed",
                        "traceId": "trace_eval_01HQ",
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
            trace_link_template="https://sentry.example/organizations/campus/traces/{trace_id}",
        )
        transport = httpx.MockTransport(handler)
        client = httpx.Client(base_url="https://app-api.internal", transport=transport)

        try:
            executor = build_app_api_handbook_live_executor(
                settings=settings,
                client=client,
            )
            result = executor(_case())
        finally:
            client.close()

        self.assertEqual(
            result.request_correlation,
            OperatorRequestCorrelation(
                case_id="release-gate-student-card",
                request_id="req_eval_01HQ",
                trace_id="trace_eval_01HQ",
                sampled_at="2026-04-03T00:00:01.000Z",
                trace_link="https://sentry.example/organizations/campus/traces/trace_eval_01HQ",
            ),
        )

    def test_build_handbook_live_executor_marks_pre_retrieval_clarification(self) -> None:
        def fake_delegate(request, *, retriever):
            del retriever
            return SpecialistResponse(
                target="rag-agent",
                status="needs_clarification",
                follow_up_question="请说明你想咨询哪一类奖学金。",
                confidence="low",
                result=RagResultPayload(
                    evidence=EvidenceBundle(
                        query_text=request.user_goal,
                        corpus="regulations",
                        collection="student_rules",
                    )
                ),
            )

        executor = build_legacy_handbook_live_executor(
            retriever=lambda *args, **kwargs: self.fail("retriever should not be called"),
            delegate=fake_delegate,
        )

        result = executor(
            _case(
                case_id="release-gate-needs-clarification",
                user_goal="奖学金怎么申请？",
            )
        )

        self.assertFalse(result.observed_trace.retrieval_called)
        self.assertTrue(result.observed_trace.clarification_emitted)
        self.assertFalse(result.observed_trace.error_path)
        self.assertEqual(result.observed_trace.retrieved_sources, ())
        self.assertEqual(result.observed_trace.supporting_sources, ())

    def test_build_handbook_live_executor_marks_retrieval_backed_no_answer_without_clarification(
        self,
    ) -> None:
        retrieved_bundle = EvidenceBundle(
            query_text="民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _source(
                    "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
                    chunk_id="chunk-a",
                    score=0.88,
                ),
            ),
        )

        def fake_delegate(request, *, retriever):
            bundle = retriever(
                request.user_goal,
                corpus=request.payload.scope.corpus,
                collection=request.payload.scope.collection,
                authorized_filter=request.context.authorization.retrieval_filter,
                personalization_hint=None,
            )
            self.assertEqual(bundle, retrieved_bundle)
            return SpecialistResponse(
                target="rag-agent",
                status="no_answer",
                answer_text="在《中央民族大学本科学生国家奖学金评审办法》中，当前未检索到足够依据支持回答这个问题；请确认是否有更具体的条款表述。",
                confidence="low",
                result=RagResultPayload(
                    evidence=EvidenceBundle(
                        query_text=request.user_goal,
                        corpus=bundle.corpus,
                        collection=bundle.collection,
                    )
                ),
            )

        executor = build_legacy_handbook_live_executor(
            retriever=lambda *args, **kwargs: retrieved_bundle,
            delegate=fake_delegate,
        )

        result = executor(
            GoldenCase(
                case_id="release-gate-national-scholarship-no-answer-author-affiliation",
                split="release_gate",
                source_type="expert_authored",
                user_goal="民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
                actor=ActorContext(),
                scope=HANDBOOK_SCOPE,
                expected_status="no_answer",
                trace_expectation=TraceExpectation(
                    selected_scope=HANDBOOK_SCOPE,
                    retrieval_called=True,
                    clarification_expected=False,
                    error_expected=False,
                ),
            )
        )

        self.assertTrue(result.observed_trace.retrieval_called)
        self.assertFalse(result.observed_trace.clarification_emitted)
        self.assertFalse(result.observed_trace.error_path)
        self.assertEqual(result.observed_trace.retrieved_sources, retrieved_bundle.sources)
        self.assertEqual(result.observed_trace.supporting_sources, ())


class HandbookLiveProfileTest(unittest.TestCase):
    def test_build_handbook_live_profile_uses_repo_tracked_http_settings_for_supplemental_adapters(
        self,
    ) -> None:
        profile = build_handbook_live_profile(
            env={
                "EVAL_LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EVAL_EMBEDDING_API_KEY": "embed-key",
                "EVAL_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
                "EVAL_HTTP_READ_TIMEOUT_SECONDS": "90",
            }
        )

        with patch(
            "campus_evals.handbook_live_benchmark.build_default_handbook_supplemental_adapters_from_env",
            return_value=("adapters",),
        ) as build_adapters:
            adapters = profile.supplemental_adapters_factory()

        self.assertEqual(adapters, ("adapters",))
        self.assertEqual(profile.http_settings.read_timeout_seconds, 180.0)
        self.assertEqual(profile.case_workers, 2)
        self.assertEqual(
            build_adapters.call_args.kwargs["http_settings"].read_timeout_seconds,
            180.0,
        )
        self.assertEqual(build_adapters.call_args.kwargs["faithfulness_nli_batch_size"], 6)

    def test_build_handbook_live_profile_aligns_app_api_eval_timeout_with_profile_http_settings(
        self,
    ) -> None:
        profile = build_handbook_live_profile(
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

        with patch(
            "campus_evals.handbook_live_benchmark.build_handbook_live_executor",
            return_value="executor",
        ) as build_executor:
            executor = profile.executor_factory()

        self.assertEqual(executor, "executor")
        self.assertEqual(
            build_executor.call_args.kwargs["default_timeout_seconds"],
            profile.http_settings.read_timeout_seconds,
        )


class HandbookLiveBenchmarkCliTest(unittest.TestCase):
    def test_build_default_output_dir_uses_timestamped_eval_directory(self) -> None:
        path = build_default_output_dir(
            prefix="student-handbook-formal-benchmark", timestamp="20260329T123456"
        )
        self.assertEqual(path, Path(".tmp/evals/student-handbook-formal-benchmark-20260329T123456"))

    def test_main_runs_formal_benchmark_with_live_executor_and_default_output_dir(self) -> None:
        case = _case()
        adapters = (object(),)

        with TemporaryDirectory() as tmpdir:
            expected_output_dir = Path(tmpdir) / "student-handbook-formal-benchmark-20260329T123456"
            with (
                patch(
                    "campus_evals.handbook_live_benchmark.handbook_release_gate_cases",
                    return_value=(case,),
                ),
                patch(
                    "campus_evals.handbook_live_benchmark.build_default_handbook_supplemental_adapters_from_env",
                    return_value=adapters,
                ),
                patch(
                    "campus_evals.handbook_live_benchmark.build_default_output_dir",
                    return_value=expected_output_dir,
                ),
                patch(
                    "campus_evals.handbook_live_benchmark.build_handbook_live_executor",
                    return_value="executor",
                ),
                patch(
                    "campus_evals.handbook_live_benchmark.run_handbook_formal_benchmark"
                ) as run_benchmark,
            ):
                exit_code = main(["run", "--reruns", "3"])

        self.assertEqual(exit_code, 0)
        run_benchmark.assert_called_once_with(
            cases=(case,),
            executor="executor",
            supplemental_adapters=adapters,
            output_dir=expected_output_dir,
            reruns=3,
            case_workers=2,
        )

    def test_main_loads_repo_env_before_running_profile(self) -> None:
        case = _case()

        with TemporaryDirectory() as tmpdir:
            expected_output_dir = Path(tmpdir) / "student-handbook-formal-benchmark-20260329T123456"
            with (
                patch("campus_evals.live_benchmark.load_repo_env") as load_repo_env,
                patch(
                    "campus_evals.handbook_live_benchmark.handbook_release_gate_cases",
                    return_value=(case,),
                ),
                patch(
                    "campus_evals.handbook_live_benchmark.build_default_handbook_supplemental_adapters_from_env",
                    return_value=(object(),),
                ),
                patch(
                    "campus_evals.handbook_live_benchmark.build_default_output_dir",
                    return_value=expected_output_dir,
                ),
                patch(
                    "campus_evals.handbook_live_benchmark.build_handbook_live_executor",
                    return_value="executor",
                ),
                patch("campus_evals.handbook_live_benchmark.run_handbook_formal_benchmark"),
            ):
                exit_code = main(["run", "--reruns", "1"])

        self.assertEqual(exit_code, 0)
        load_repo_env.assert_called_once_with()

    def test_main_runs_repair_against_existing_benchmark_dir(self) -> None:
        case = _case()
        adapters = (object(),)

        with TemporaryDirectory() as tmpdir:
            benchmark_dir = Path(tmpdir) / "existing-benchmark"
            benchmark_dir.mkdir()
            expected_output_dir = (
                Path(tmpdir) / "student-handbook-formal-benchmark-repair-20260329T123456"
            )
            with (
                patch(
                    "campus_evals.handbook_live_benchmark.handbook_release_gate_cases",
                    return_value=(case,),
                ),
                patch(
                    "campus_evals.handbook_live_benchmark.build_default_handbook_supplemental_adapters_from_env",
                    return_value=adapters,
                ),
                patch(
                    "campus_evals.handbook_live_benchmark.build_default_output_dir",
                    return_value=expected_output_dir,
                ),
                patch(
                    "campus_evals.handbook_live_benchmark.build_handbook_live_executor",
                    return_value="executor",
                ),
                patch(
                    "campus_evals.handbook_live_benchmark.repair_handbook_formal_benchmark"
                ) as repair_benchmark,
            ):
                exit_code = main(["repair", "--benchmark-dir", str(benchmark_dir)])

        self.assertEqual(exit_code, 0)
        repair_benchmark.assert_called_once_with(
            cases=(case,),
            executor="executor",
            supplemental_adapters=adapters,
            benchmark_dir=benchmark_dir,
            output_dir=expected_output_dir,
            case_workers=2,
        )

    def test_main_runs_acceptance_against_live_chain(self) -> None:
        case = _case()

        with TemporaryDirectory() as tmpdir:
            expected_output_dir = (
                Path(tmpdir) / "student-handbook-formal-benchmark-accept-20260329T123456"
            )
            with (
                patch(
                    "campus_evals.handbook_live_benchmark.handbook_release_gate_cases",
                    return_value=(case,),
                ),
                patch(
                    "campus_evals.handbook_live_benchmark.build_default_output_dir",
                    return_value=expected_output_dir,
                ),
                patch(
                    "campus_evals.handbook_live_benchmark.accept_live_benchmark_profile"
                ) as accept_benchmark,
            ):
                exit_code = main(["accept", "--reruns", "3"])

        self.assertEqual(exit_code, 0)
        accept_benchmark.assert_called_once()
        self.assertEqual(accept_benchmark.call_args.kwargs["output_dir"], expected_output_dir)
        self.assertEqual(accept_benchmark.call_args.kwargs["reruns"], 3)
