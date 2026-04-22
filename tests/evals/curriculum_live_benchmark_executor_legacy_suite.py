from __future__ import annotations

from tests.evals.curriculum_live_benchmark_test_support import (
    CURRICULUM_SCOPE,
    EvidenceBundle,
    RagRequestPayload,
    RagResultPayload,
    SpecialistResponse,
    VersionQuery,
    _completed_case,
    _error_case,
    _source,
    build_legacy_curriculum_live_executor,
    unittest,
)


class CurriculumLiveExecutorLegacyTest(unittest.TestCase):
    def test_build_legacy_curriculum_live_executor_captures_retrieved_and_supporting_sources(
        self,
    ) -> None:
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
        self.assertEqual(
            result.observed_trace.supporting_sources, result.response.result.evidence.sources
        )

    def test_build_legacy_curriculum_live_executor_passes_case_version_query(self) -> None:
        seen_requests = []

        def fake_delegate(request, *, retriever):
            seen_requests.append(request)
            return SpecialistResponse(
                target="rag-agent",
                status="completed",
                answer_text="旧版课程安排如下。",
                confidence="medium",
                result=RagResultPayload(
                    evidence=EvidenceBundle(
                        query_text=request.user_goal,
                        corpus=request.payload.scope.corpus,
                        collection=request.payload.scope.collection,
                    )
                ),
            )

        executor = build_legacy_curriculum_live_executor(
            retriever=lambda *args, **kwargs: EvidenceBundle(
                query_text="旧版民族学本科人才培养方案",
                corpus="curriculum",
                collection="curriculum_plan",
            ),
            delegate=fake_delegate,
        )

        result = executor(_completed_case(version_query=VersionQuery(mode="historical")))

        self.assertEqual(len(seen_requests), 1)
        self.assertEqual(
            seen_requests[0].payload,
            RagRequestPayload(
                scope=CURRICULUM_SCOPE, version_query=VersionQuery(mode="historical")
            ),
        )
        self.assertEqual(result.response.status, "completed")

    def test_build_legacy_curriculum_live_executor_injects_retrieval_backend_failure_case(
        self,
    ) -> None:
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

    def test_build_legacy_curriculum_live_executor_injects_evidence_shaping_failure_case(
        self,
    ) -> None:
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

    def test_build_legacy_curriculum_live_executor_injects_invalid_backend_contract_case(
        self,
    ) -> None:
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
