from __future__ import annotations

from pathlib import Path
import unittest

from campus_contracts import ActorContext, EvidenceBundle, EvidenceSource, KnowledgeScope
from campus_evals import GoldenCase, TraceExpectation, build_default_ragas_metric_names
from campus_evals.curriculum_live_benchmark import build_curriculum_live_executor, build_curriculum_live_profile


CURRICULUM_SCOPE = KnowledgeScope(corpus="curriculum", collection="curriculum_plan")


def _source(doc_id: str, *, chunk_id: str = "chunk-1", score: float = 0.9) -> EvidenceSource:
    return EvidenceSource(
        doc_id=doc_id,
        revision_track="source-faithful",
        version_id="v1",
        chunk_id=chunk_id,
        anchor={"page": 1},
        acl_level="public",
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
    def test_build_curriculum_live_executor_captures_retrieved_and_supporting_sources(self) -> None:
        retrieved_bundle = EvidenceBundle(
            query_text="民族学本科人才培养方案",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _source("curriculum:民族学本科人才培养方案", chunk_id="chunk-a", score=0.97),
                _source("curriculum:background", chunk_id="chunk-b", score=0.73),
            ),
        )
        executor = build_curriculum_live_executor(
            retriever=lambda *args, **kwargs: retrieved_bundle,
        )

        result = executor(_completed_case())

        self.assertTrue(result.observed_trace.retrieval_called)
        self.assertFalse(result.observed_trace.clarification_emitted)
        self.assertFalse(result.observed_trace.error_path)
        self.assertEqual(result.observed_trace.retrieved_sources, retrieved_bundle.sources)
        self.assertEqual(result.observed_trace.supporting_sources, result.response.result.evidence.sources)

    def test_build_curriculum_live_executor_injects_retrieval_backend_failure_case(self) -> None:
        executor = build_curriculum_live_executor(
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

    def test_build_curriculum_live_executor_injects_evidence_shaping_failure_case(self) -> None:
        executor = build_curriculum_live_executor(
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

    def test_build_curriculum_live_executor_injects_invalid_backend_contract_case(self) -> None:
        executor = build_curriculum_live_executor(
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


if __name__ == "__main__":
    unittest.main()
