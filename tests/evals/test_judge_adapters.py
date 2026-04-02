from __future__ import annotations

import unittest
from unittest.mock import patch

from campus_contracts import ActorContext, EvidenceBundle, EvidenceSource, KnowledgeScope, RagResultPayload, SpecialistResponse
from campus_shared.provider_config import ProviderConfigResolutionError
from campus_evals import ExecutionResult, GoldenCase, ObservedTrace, TraceExpectation
from campus_evals.judge_adapters import (
    build_answer_rubric_adapter,
    build_responses_json_judge,
    build_handbook_ragas_adapter,
    build_refusal_rubric_adapter,
)
from campus_evals.settings import JudgeLLMSettings, RagasSettings, SupplementalHTTPSettings


HANDBOOK_SCOPE = KnowledgeScope(corpus="regulations", collection="student_handbook")


def _source(
    *,
    doc_id: str = "handbook:library",
    version_id: str = "v1",
    chunk_id: str = "chunk-1",
    snippet: str = "Library hours are 08:00 to 22:00.",
) -> EvidenceSource:
    return EvidenceSource(
        doc_id=doc_id,
        revision_track="source-faithful",
        version_id=version_id,
        chunk_id=chunk_id,
        anchor={"page": 1},
        acl_level="public",
        canonical_url="https://example.edu/handbook/library",
        latest_url="https://example.edu/handbook/library",
        source_channel="pdf_ocr",
        collection="student_handbook",
        is_current=False,
        snippet=snippet,
        score=0.91,
    )


def _response(
    *,
    status: str,
    answer_text: str = "",
    follow_up_question: str = "",
    sources: tuple[EvidenceSource, ...] = (),
) -> SpecialistResponse:
    return SpecialistResponse(
        target="rag-specialist",
        status=status,
        answer_text=answer_text,
        confidence="high" if status == "completed" else "low",
        follow_up_question=follow_up_question,
        result=RagResultPayload(
            evidence=EvidenceBundle(
                query_text="query",
                corpus="regulations",
                collection="student_handbook",
                sources=sources,
            )
        ),
    )


def _completed_case() -> GoldenCase:
    return GoldenCase(
        case_id="judge-completed",
        split="release_gate",
        source_type="expert_authored",
        user_goal="图书馆开放时间是什么？",
        actor=ActorContext(),
        scope=HANDBOOK_SCOPE,
        expected_status="completed",
        required_facts=("08:00", "22:00"),
        trace_expectation=TraceExpectation(
            selected_scope=HANDBOOK_SCOPE,
            retrieval_called=True,
        ),
    )


def _no_answer_case() -> GoldenCase:
    return GoldenCase(
        case_id="judge-no-answer",
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


def _clarification_case() -> GoldenCase:
    return GoldenCase(
        case_id="judge-clarify",
        split="release_gate",
        source_type="expert_authored",
        user_goal="奖学金怎么申请？",
        actor=ActorContext(),
        scope=HANDBOOK_SCOPE,
        expected_status="needs_clarification",
        trace_expectation=TraceExpectation(
            selected_scope=HANDBOOK_SCOPE,
            retrieval_called=False,
            clarification_expected=True,
        ),
    )


class JudgeSettingsTest(unittest.TestCase):
    def test_judge_settings_from_env_reads_shared_judge_profile(self) -> None:
        settings = JudgeLLMSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "SUPPLEMENTAL_HTTP_READ_TIMEOUT_SECONDS": "120",
                "SUPPLEMENTAL_HTTP_CONNECT_TIMEOUT_SECONDS": "4",
                "RAGAS_REASONING_EFFORT": "none",
                "RAGAS_TEXT_VERBOSITY": "low",
                "RAGAS_MAX_OUTPUT_TOKENS": "256",
            }
        )

        self.assertEqual(settings.llm_model, "gpt-5.4")
        self.assertEqual(settings.http_settings.read_timeout_seconds, 120.0)
        self.assertEqual(settings.http_settings.connect_timeout_seconds, 4.0)
        self.assertEqual(settings.http_settings.request_min_interval_seconds, 0.0)
        self.assertEqual(settings.reasoning_effort, "none")
        self.assertEqual(settings.text_verbosity, "low")
        self.assertEqual(settings.max_output_tokens, 256)

    def test_judge_settings_from_env_prefers_eval_scoped_keys(self) -> None:
        settings = JudgeLLMSettings.from_env(
            {
                "EVAL_LLM_BASE_URL": "https://eval-llm.example/v1",
                "EVAL_LLM_API_KEY": "eval-llm-key",
                "EVAL_JUDGE_MODEL": "gpt-5.4-judge",
                "LLM_BASE_URL": "https://shared-llm.example/v1",
                "LLM_API_KEY": "shared-llm-key",
            }
        )

        self.assertEqual(settings.llm_base_url, "https://eval-llm.example/v1")
        self.assertEqual(settings.llm_api_key, "eval-llm-key")
        self.assertEqual(settings.llm_model, "gpt-5.4-judge")

    def test_judge_settings_from_env_requires_eval_judge_or_ragas_model(self) -> None:
        with self.assertRaisesRegex(ValueError, "EVAL_JUDGE_MODEL or EVAL_RAGAS_MODEL is required"):
            JudgeLLMSettings.from_env(
                {
                    "LLM_API_KEY": "llm-key",
                }
            )

    def test_judge_settings_from_env_requires_provider_key_with_surface_aware_error(self) -> None:
        with self.assertRaises(ProviderConfigResolutionError) as raised:
            JudgeLLMSettings.from_env(
                {
                    "EVAL_JUDGE_MODEL": "gpt-5.4-judge",
                }
            )

        self.assertEqual(raised.exception.surface_name, "eval.judge")
        self.assertEqual(raised.exception.checked_keys, ("EVAL_LLM_API_KEY", "LLM_API_KEY"))
        self.assertIn("eval.judge", str(raised.exception))
        self.assertIn("EVAL_LLM_API_KEY", str(raised.exception))

    def test_judge_settings_from_env_accept_repo_tracked_http_settings_override(self) -> None:
        settings = JudgeLLMSettings.from_env(
            {
                "EVAL_LLM_BASE_URL": "https://eval-llm.example/v1",
                "EVAL_LLM_API_KEY": "eval-llm-key",
                "EVAL_JUDGE_MODEL": "gpt-5.4-judge",
            },
            http_settings=SupplementalHTTPSettings(read_timeout_seconds=45.0),
        )

        self.assertEqual(settings.http_settings.read_timeout_seconds, 45.0)

    def test_judge_settings_from_env_reads_request_pacing_override(self) -> None:
        settings = JudgeLLMSettings.from_env(
            {
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "SUPPLEMENTAL_HTTP_REQUEST_MIN_INTERVAL_SECONDS": "15",
            }
        )

        self.assertEqual(settings.http_settings.request_min_interval_seconds, 15.0)

    def test_build_responses_json_judge_attaches_request_pacer_when_configured(self) -> None:
        settings = JudgeLLMSettings.from_env(
            {
                "LLM_BASE_URL": "https://llm.example/v1",
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "SUPPLEMENTAL_HTTP_REQUEST_MIN_INTERVAL_SECONDS": "12.5",
            }
        )
        captured: dict[str, object] = {}

        class FakeLLM:
            def __init__(self, **kwargs) -> None:
                captured.update(kwargs)

            def generate_text(self, prompt):
                del prompt
                generation = type("Generation", (), {"text": '{"score":1.0,"verdict":"passed","rationale":"ok"}'})()
                return type("LLMResult", (), {"generations": [[generation]]})()

        with patch("campus_evals.judge_adapters.OpenAICompatibleResponsesLLM", FakeLLM):
            judge = build_responses_json_judge(settings)
            result = judge("只回复 JSON")

        self.assertEqual(result["score"], 1.0)
        self.assertIsNotNone(captured["request_pacer"])


class JudgeAdapterApplicabilityTest(unittest.TestCase):
    def test_build_handbook_ragas_adapter_passes_metric_names_to_scorer(self) -> None:
        ragas_settings = RagasSettings.from_env(
            {
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )

        with (
            patch("campus_evals.supplemental_http.build_http_ragas_llm", return_value=object()),
            patch("campus_evals.supplemental_http.build_http_ragas_embeddings", return_value=object()),
            patch("campus_evals.judge_adapters.build_ragas_scorer", return_value=lambda projection: ()) as build_scorer,
        ):
            adapter = build_handbook_ragas_adapter(
                ragas_settings,
                metric_names=("faithfulness",),
            )

        self.assertEqual(adapter.metric_names, ("faithfulness",))
        self.assertEqual(build_scorer.call_args.kwargs["metric_names"], ("faithfulness",))

    def test_answer_rubric_adapter_scores_completed_case_and_marks_non_completed_not_applicable(self) -> None:
        adapter = build_answer_rubric_adapter(
            JudgeLLMSettings.from_env(
                {
                    "LLM_API_KEY": "llm-key",
                    "EVAL_RAGAS_MODEL": "gpt-5.4",
                }
            ),
            judge_fn=lambda prompt: {
                "score": 0.92,
                "verdict": "passed",
                "rationale": f"judged {prompt[:12]}",
            },
        )

        completed = adapter.evaluate(
            _completed_case(),
            ExecutionResult(
                response=_response(
                    status="completed",
                    answer_text="图书馆开放时间为 08:00 到 22:00。",
                    sources=(_source(),),
                ),
                observed_trace=ObservedTrace(selected_scope=HANDBOOK_SCOPE, retrieval_called=True),
            ),
        )
        no_answer = adapter.evaluate(
            _no_answer_case(),
            ExecutionResult(
                response=_response(status="no_answer"),
                observed_trace=ObservedTrace(selected_scope=HANDBOOK_SCOPE, retrieval_called=True),
            ),
        )

        self.assertEqual(completed[0].metric_name, "answer_correctness_rubric")
        self.assertEqual(completed[0].score, 0.92)
        self.assertEqual(completed[0].verdict, "passed")
        self.assertEqual(no_answer[0].metric_name, "answer_correctness_rubric")
        self.assertEqual(no_answer[0].verdict, "not_applicable")

    def test_refusal_rubric_adapter_scores_boundary_cases_and_marks_completed_not_applicable(self) -> None:
        adapter = build_refusal_rubric_adapter(
            JudgeLLMSettings.from_env(
                {
                    "LLM_API_KEY": "llm-key",
                    "EVAL_RAGAS_MODEL": "gpt-5.4",
                }
            ),
            judge_fn=lambda prompt: {
                "score": 0.88,
                "verdict": "passed",
                "rationale": f"judged {prompt[:12]}",
            },
        )

        no_answer = adapter.evaluate(
            _no_answer_case(),
            ExecutionResult(
                response=_response(status="no_answer"),
                observed_trace=ObservedTrace(selected_scope=HANDBOOK_SCOPE, retrieval_called=True),
            ),
        )
        clarification = adapter.evaluate(
            _clarification_case(),
            ExecutionResult(
                response=_response(
                    status="needs_clarification",
                    follow_up_question="请说明是哪一类奖学金。",
                ),
                observed_trace=ObservedTrace(
                    selected_scope=HANDBOOK_SCOPE,
                    retrieval_called=False,
                    clarification_emitted=True,
                ),
            ),
        )
        completed = adapter.evaluate(
            _completed_case(),
            ExecutionResult(
                response=_response(
                    status="completed",
                    answer_text="图书馆开放时间为 08:00 到 22:00。",
                    sources=(_source(),),
                ),
                observed_trace=ObservedTrace(selected_scope=HANDBOOK_SCOPE, retrieval_called=True),
            ),
        )

        self.assertEqual(no_answer[0].metric_name, "refusal_quality")
        self.assertEqual(no_answer[0].score, 0.88)
        self.assertEqual(clarification[0].metric_name, "refusal_quality")
        self.assertEqual(clarification[0].score, 0.88)
        self.assertEqual(completed[0].metric_name, "refusal_quality")
        self.assertEqual(completed[0].verdict, "not_applicable")

    def test_handbook_ragas_adapter_marks_non_completed_cases_not_applicable(self) -> None:
        ragas_settings = RagasSettings.from_env(
            {
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )
        adapter = build_handbook_ragas_adapter(
            ragas_settings,
            scorer=lambda projection: (
                type("Result", (), {})(),
            ),
            metric_names=("faithfulness", "answer_relevancy"),
        )

        results = adapter.evaluate(
            _no_answer_case(),
            ExecutionResult(
                response=_response(status="no_answer"),
                observed_trace=ObservedTrace(selected_scope=HANDBOOK_SCOPE, retrieval_called=True),
            ),
        )

        self.assertEqual(tuple(item.metric_name for item in results), ("faithfulness", "answer_relevancy"))
        self.assertTrue(all(item.verdict == "not_applicable" for item in results))

    def test_handbook_ragas_adapter_converts_runtime_errors_into_failed_report_only_results(self) -> None:
        ragas_settings = RagasSettings.from_env(
            {
                "LLM_API_KEY": "llm-key",
                "EVAL_RAGAS_MODEL": "gpt-5.4",
                "EMBEDDING_API_KEY": "embed-key",
                "EMBEDDING_MODEL": "Qwen3-Embedding-4B",
            }
        )
        adapter = build_handbook_ragas_adapter(
            ragas_settings,
            scorer=lambda projection: (_ for _ in ()).throw(RuntimeError(f"524 timeout for {projection.case_id}")),
            metric_names=("faithfulness", "answer_relevancy"),
        )

        results = adapter.evaluate(
            _completed_case(),
            ExecutionResult(
                response=_response(
                    status="completed",
                    answer_text="图书馆开放时间为 08:00 到 22:00。",
                    sources=(_source(),),
                ),
                observed_trace=ObservedTrace(selected_scope=HANDBOOK_SCOPE, retrieval_called=True),
            ),
        )

        self.assertEqual(tuple(item.metric_name for item in results), ("faithfulness", "answer_relevancy"))
        self.assertTrue(all(item.verdict == "failed" for item in results))
        self.assertTrue(all(item.score is None for item in results))

    def test_answer_rubric_adapter_converts_runtime_errors_into_failed_report_only_result(self) -> None:
        adapter = build_answer_rubric_adapter(
            JudgeLLMSettings.from_env(
                {
                    "LLM_API_KEY": "llm-key",
                    "EVAL_RAGAS_MODEL": "gpt-5.4",
                }
            ),
            judge_fn=lambda prompt: (_ for _ in ()).throw(TimeoutError(prompt[:12])),
        )

        results = adapter.evaluate(
            _completed_case(),
            ExecutionResult(
                response=_response(
                    status="completed",
                    answer_text="图书馆开放时间为 08:00 到 22:00。",
                    sources=(_source(),),
                ),
                observed_trace=ObservedTrace(selected_scope=HANDBOOK_SCOPE, retrieval_called=True),
            ),
        )

        self.assertEqual(len(results), 1)
        self.assertEqual(results[0].metric_name, "answer_correctness_rubric")
        self.assertEqual(results[0].verdict, "failed")
        self.assertIsNone(results[0].score)


if __name__ == "__main__":
    unittest.main()
