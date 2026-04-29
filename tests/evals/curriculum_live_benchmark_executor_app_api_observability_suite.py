from __future__ import annotations

from tests.evals.curriculum_live_benchmark_test_support import (
    CURRICULUM_SCOPE,
    ActorContext,
    AppApiEvalClientSettings,
    ClaimSupport,
    GoldenCase,
    RemoteContentSuspicionSummary,
    SourceTrustSummary,
    TraceExpectation,
    build_app_api_curriculum_live_executor,
    httpx,
    unittest,
)


class CurriculumLiveExecutorAppApiObservabilityTest(unittest.TestCase):
    def test_build_app_api_curriculum_live_executor_preserves_supervisor_diagnostics_and_observability(
        self,
    ) -> None:
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
                        "selectedTarget": "rag-agent",
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
                                "remote_content_suspicion_summary": {
                                    "flagged_source_count": 1,
                                    "flag_labels": ["instructional_imperative"],
                                    "generation_blocked": True,
                                },
                                "source_trust_summary": {
                                    "observed_tiers": ["T0"],
                                    "answer_bearing_tiers": ["T0"],
                                    "blocked_claim_types": ["offering_unit_or_owning_school"],
                                    "freshness_claim_blocked": False,
                                    "authorization_claim_blocked": False,
                                },
                                "claim_supports": [
                                    {
                                        "claim_type": "offering_unit_or_owning_school",
                                        "claim_text": "马克思主义学院",
                                        "required_source_trust_tier": "T0",
                                        "supported": False,
                                        "support_source_doc_id": "",
                                        "support_snippet": "",
                                        "support_source_trust_tier": "",
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
        self.assertEqual(
            result.response.result.diagnostics.semantic_outcome, "unsupported_by_evidence"
        )
        self.assertEqual(
            result.response.result.diagnostics.retrieval_adequacy_verdict, "sufficient"
        )
        self.assertEqual(result.response.result.diagnostics.retrieval_adequacy_reason, "sufficient")
        self.assertEqual(result.response.result.diagnostics.grounding_verdict, "unsupported")
        self.assertEqual(
            result.response.result.diagnostics.unsupported_fields, ("offering_unit_claims",)
        )
        self.assertEqual(
            result.response.result.diagnostics.remote_content_suspicion_summary,
            RemoteContentSuspicionSummary(
                flagged_source_count=1,
                flag_labels=("instructional_imperative",),
                generation_blocked=True,
            ),
        )
        self.assertEqual(
            result.response.result.diagnostics.source_trust_summary,
            SourceTrustSummary(
                observed_tiers=("T0",),
                answer_bearing_tiers=("T0",),
                blocked_claim_types=("offering_unit_or_owning_school",),
                freshness_claim_blocked=False,
                authorization_claim_blocked=False,
            ),
        )
        self.assertEqual(
            result.response.result.diagnostics.claim_supports,
            (
                ClaimSupport(
                    claim_type="offering_unit_or_owning_school",
                    claim_text="马克思主义学院",
                    required_source_trust_tier="T0",
                    supported=False,
                    support_source_doc_id="",
                    support_snippet="",
                    support_source_trust_tier="",
                ),
            ),
        )
        self.assertEqual(
            result.response.result.diagnostics.resolved_scope_collection, "curriculum_plan"
        )
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
