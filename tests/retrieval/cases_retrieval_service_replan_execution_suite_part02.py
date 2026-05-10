# ruff: noqa: F403,F405
from __future__ import annotations

import unittest
from dataclasses import fields

from tests.retrieval.retrieval_service_replan_execution_suite_support import *


class RetrievalServiceReplanExecutionTestPart02(unittest.TestCase):
    def test_execute_retrieval_plan_marks_procedure_group_mismatch_when_only_condition_child_returned(
        self,
    ) -> None:
        def fake_retrieve_step(request: RetrievalRequest) -> EvidenceBundle:
            return EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
                sources=(
                    _make_source(
                        chunk_id="student-card-material-condition",
                        doc_id="handbook:student-card",
                        source_title="中央民族大学学生证管理办法",
                        snippet="补办学生证应提交书面申请和身份证明。",
                        score=0.92,
                        content_role="requirement",
                        is_answer_bearing=True,
                        semantic_role="material_requirement",
                        polarity="positive",
                        claim_type="condition",
                        anchor=_answer_ready_anchor(
                            answer_role="material_requirement",
                            condition_subject="material_requirement",
                            condition_group_subject="student_card_or_identity_credential",
                            condition_group_id=(
                                "handbook:student-card:article-6:"
                                "group-01:student_card_or_identity_credential"
                            ),
                            parent_unit_id="handbook:student-card:article-6",
                            claim_type="condition",
                            polarity="positive",
                        ),
                    ),
                ),
            )

        plan = RetrievalPlan(
            plan_id="regulations:student_rules:procedure-group-mismatch",
            query_mode="current",
            admitted_scopes=(RetrievalScope(corpus="regulations", collection="student_rules"),),
            budget=RetrievalPlanBudget(max_steps=2, max_replans=1),
            steps=(
                RetrievalStep(
                    step_id="indexed-lookup",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="学生证丢了怎么办？",
                    need_ids=("need:1:procedure",),
                    selector=RetrievalSelector(target_document_ids=("handbook:student-card",)),
                    budget=RetrievalStepBudget(top_k=2),
                ),
            ),
        )

        result = execute_retrieval_plan(
            plan,
            retrieve_step=fake_retrieve_step,
            replan_callback=lambda _plan, _results, last_result: (
                (
                    RetrievalStep(
                        step_id="indexed-lookup-semantic-replan",
                        step_type="indexed_lookup",
                        scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                        query_text="学生证 挂失 补办 办理步骤",
                        need_ids=("need:1:procedure",),
                        depends_on_step_ids=(last_result.step_id,),
                        selector=RetrievalSelector(target_document_ids=("handbook:student-card",)),
                        budget=RetrievalStepBudget(top_k=2),
                    ),
                )
                if last_result.status == "empty"
                else ()
            ),
        )

        self.assertEqual(result.replan_count, 1)
        self.assertEqual(result.step_results[0].status, "empty")
        self.assertEqual(
            result.step_results[0].activity.failure_kind,
            "procedure_group_answer_role_mismatch",
        )
        self.assertEqual(
            result.step_results[0].references[0].chunk_id,
            "student-card-material-condition",
        )

    def test_execute_retrieval_plan_emits_sanitized_monitoring_observation_without_raw_query(
        self,
    ) -> None:
        observations: list[dict[str, object]] = []
        plan = RetrievalPlan(
            plan_id="official_web:stable_reference:no-hit",
            query_mode="current",
            admitted_scopes=(RetrievalScope(corpus="official_web", collection="stable_reference"),),
            steps=(
                RetrievalStep(
                    step_id="primary",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="official_web", collection="stable_reference"),
                    query_text="校内宇宙签证办理处",
                    budget=RetrievalStepBudget(top_k=3),
                ),
            ),
        )

        result = execute_retrieval_plan(
            plan,
            retrieve_step=lambda request: EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
                sources=(),
            ),
            observation_sink=observations.append,
            observation_request_id="req-no-hit",
        )

        self.assertEqual(result.step_results[0].status, "empty")
        self.assertEqual(len(observations), 1)
        self.assertEqual(observations[0]["request_id"], "req-no-hit")
        self.assertNotIn("query", observations[0])
        self.assertEqual(
            observations[0]["query_sha256"],
            hashlib.sha256("校内宇宙签证办理处".encode()).hexdigest(),
        )
        self.assertEqual(
            observations[0]["scope"],
            {"corpus": "official_web", "collection": "stable_reference"},
        )
        self.assertEqual(observations[0]["candidate_count"], 0)
        self.assertEqual(observations[0]["terminal_state"], "completed")

    def test_execute_retrieval_plan_can_explicitly_emit_raw_query_for_operator_backlog(
        self,
    ) -> None:
        observations: list[dict[str, object]] = []
        plan = RetrievalPlan(
            plan_id="official_web:stable_reference:no-hit-debug",
            query_mode="current",
            admitted_scopes=(RetrievalScope(corpus="official_web", collection="stable_reference"),),
            steps=(
                RetrievalStep(
                    step_id="primary",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="official_web", collection="stable_reference"),
                    query_text="校内宇宙签证办理处",
                    budget=RetrievalStepBudget(top_k=3),
                ),
            ),
        )

        execute_retrieval_plan(
            plan,
            retrieve_step=lambda request: EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
                sources=(),
            ),
            observation_sink=observations.append,
            observation_request_id="req-no-hit-debug",
            include_observation_query_text=True,
        )

        self.assertEqual(observations[0]["query"], "校内宇宙签证办理处")

    def test_execute_retrieval_plan_fails_closed_for_legacy_index_contract_diagnostics(
        self,
    ) -> None:
        observations: list[dict[str, object]] = []
        plan = RetrievalPlan(
            plan_id="regulations:student_rules:legacy-contract-diagnostics",
            query_mode="current",
            admitted_scopes=(RetrievalScope(corpus="regulations", collection="student_rules"),),
            source_trust_policy=RetrievalSourceTrustPolicy(minimum_tier="T1"),
            steps=(
                RetrievalStep(
                    step_id="primary",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="处分怎么消",
                    budget=RetrievalStepBudget(top_k=3),
                ),
            ),
        )

        with self.assertRaisesRegex(RetrievalBackendError, "legacy old-index fallback"):
            execute_retrieval_plan(
                plan,
                retrieve_step=lambda request: EvidenceBundle(
                    query_text=request.query_text,
                    corpus=request.corpus,
                    collection=request.collection,
                    sources=(
                        _make_source(
                            chunk_id="legacy-discipline-procedure",
                            snippet="学生受处分满考察期后，可以申请解除纪律处分。",
                            content_role="procedure",
                            is_answer_bearing=True,
                            semantic_role="procedure_step",
                            polarity="positive",
                            action_type="lift_discipline",
                            claim_type="procedure",
                        ),
                    ),
                ),
                observation_sink=observations.append,
                observation_request_id="req-legacy-contract",
            )

        self.assertEqual(len(observations), 1)
        self.assertEqual(observations[0]["terminal_state"], "failed_closed")
        self.assertEqual(observations[0]["failure_kind"], "release_metadata_drift")

    def test_execute_retrieval_plan_fails_closed_when_target_regulation_path_hits_legacy_fallback(
        self,
    ) -> None:
        observations: list[dict[str, object]] = []
        plan = RetrievalPlan(
            plan_id="regulations:student_rules:target-v3-legacy-fallback-blocked",
            query_mode="current",
            admitted_scopes=(RetrievalScope(corpus="regulations", collection="student_rules"),),
            source_trust_policy=RetrievalSourceTrustPolicy(minimum_tier="T1"),
            steps=(
                RetrievalStep(
                    step_id="primary",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="处分怎么消",
                    budget=RetrievalStepBudget(top_k=3),
                ),
            ),
        )

        with self.assertRaisesRegex(RetrievalBackendError, "legacy old-index fallback"):
            execute_retrieval_plan(
                plan,
                retrieve_step=lambda request: EvidenceBundle(
                    query_text=request.query_text,
                    corpus=request.corpus,
                    collection=request.collection,
                    sources=(
                        _make_source(
                            chunk_id="legacy-discipline-procedure",
                            snippet="学生受处分满考察期后，可以申请解除纪律处分。",
                            content_role="procedure",
                            is_answer_bearing=True,
                            semantic_role="procedure_step",
                            polarity="positive",
                            action_type="lift_discipline",
                            claim_type="procedure",
                        ),
                    ),
                ),
                observation_sink=observations.append,
                observation_request_id="req-target-v3-legacy-fallback-blocked",
            )

        self.assertEqual(len(observations), 1)
        self.assertEqual(observations[0]["terminal_state"], "failed_closed")
        self.assertEqual(observations[0]["failure_kind"], "release_metadata_drift")

    def test_execute_retrieval_plan_defaults_to_contract_required_for_regulation_serving(
        self,
    ) -> None:
        plan = RetrievalPlan(
            plan_id="regulations:student_rules:target-v3-default-legacy-fallback-blocked",
            query_mode="current",
            admitted_scopes=(RetrievalScope(corpus="regulations", collection="student_rules"),),
            steps=(
                RetrievalStep(
                    step_id="primary",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="处分怎么消",
                    budget=RetrievalStepBudget(top_k=3),
                ),
            ),
        )

        with self.assertRaisesRegex(RetrievalBackendError, "legacy old-index fallback"):
            execute_retrieval_plan(
                plan,
                retrieve_step=lambda request: EvidenceBundle(
                    query_text=request.query_text,
                    corpus=request.corpus,
                    collection=request.collection,
                    sources=(
                        _make_source(
                            chunk_id="legacy-discipline-procedure",
                            snippet="学生受处分满考察期后，可以申请解除纪律处分。",
                            content_role="procedure",
                            is_answer_bearing=True,
                            semantic_role="procedure_step",
                            polarity="positive",
                            action_type="lift_discipline",
                            claim_type="procedure",
                        ),
                    ),
                ),
            )

    def test_source_trust_policy_has_no_legacy_fallback_compatibility_switch(
        self,
    ) -> None:
        policy_field_names = {field.name for field in fields(RetrievalSourceTrustPolicy)}

        self.assertNotIn("legacy_fallback_mode", policy_field_names)

    def test_jsonl_observation_sink_appends_one_json_object_per_line(self) -> None:
        with TemporaryDirectory() as temp_dir:
            output_path = Path(temp_dir) / "runtime-observations.jsonl"
            sink = build_jsonl_retrieval_observation_sink(output_path)

            sink(
                {
                    "schema_version": "retrieval-runtime-observation-v1",
                    "request_id": "req-1",
                    "query": "校园卡丢了怎么办",
                    "scope": {"corpus": "regulations", "collection": "student_rules"},
                    "top_source_ids": ("doc-1", "doc-2"),
                }
            )
            sink(
                {
                    "schema_version": "retrieval-runtime-observation-v1",
                    "request_id": "req-2",
                    "query": "学士学位授予规定",
                    "scope": {"corpus": "regulations", "collection": "student_rules"},
                    "top_source_ids": (),
                }
            )

            rows = [
                json.loads(line) for line in output_path.read_text(encoding="utf-8").splitlines()
            ]

        self.assertEqual([row["request_id"] for row in rows], ["req-1", "req-2"])
        self.assertEqual(rows[0]["top_source_ids"], ["doc-1", "doc-2"])
        self.assertEqual(rows[1]["top_source_ids"], [])

    def test_event_observation_sink_wraps_observation_as_durable_event(self) -> None:
        events: list[tuple[str, dict[str, object]]] = []
        sink = build_retrieval_observation_event_sink(
            lambda event_name, payload: events.append((event_name, payload))
        )

        sink(
            {
                "schema_version": "retrieval-runtime-observation-v1",
                "request_id": "req-1",
                "query_sha256": "abc123",
                "scope": {"corpus": "regulations", "collection": "student_rules"},
            }
        )

        self.assertEqual(len(events), 1)
        self.assertEqual(events[0][0], "retrieval.runtime_observation")
        self.assertEqual(events[0][1]["request_id"], "req-1")
        self.assertNotIn("query", events[0][1])

    def test_execute_retrieval_plan_does_not_fail_when_observation_sink_raises(self) -> None:
        plan = RetrievalPlan(
            plan_id="official_web:stable_reference:observation-sink-failure",
            query_mode="current",
            admitted_scopes=(RetrievalScope(corpus="official_web", collection="stable_reference"),),
            steps=(
                RetrievalStep(
                    step_id="primary",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="official_web", collection="stable_reference"),
                    query_text="图书馆开放时间",
                    budget=RetrievalStepBudget(top_k=3),
                ),
            ),
        )

        with self.assertLogs("campus_retrieval_core.service", level="WARNING") as logs:
            result = execute_retrieval_plan(
                plan,
                retrieve_step=lambda request: EvidenceBundle(
                    query_text=request.query_text,
                    corpus=request.corpus,
                    collection=request.collection,
                    sources=(
                        _make_source(
                            doc_id="official_web:library-hours",
                            chunk_id="official_web:library-hours:chunk-1",
                            version_id="v1:library-hours",
                            snippet="图书馆开放时间为 08:00 至 22:00。",
                        ),
                    ),
                ),
                observation_sink=lambda _observation: (_ for _ in ()).throw(OSError("disk full")),
                observation_request_id="req-observation-sink-failure",
            )

        self.assertEqual(result.step_results[0].status, "succeeded")
        self.assertEqual(len(result.merged_evidence.sources), 1)
        self.assertIn("retrieval observation sink failed", logs.output[0])

    def test_execute_retrieval_plan_emits_failure_observation_before_reraising_backend_error(
        self,
    ) -> None:
        observations: list[dict[str, object]] = []
        plan = RetrievalPlan(
            plan_id="regulations:student_rules:backend-error",
            query_mode="current",
            admitted_scopes=(RetrievalScope(corpus="regulations", collection="student_rules"),),
            steps=(
                RetrievalStep(
                    step_id="primary",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="校园卡丢了怎么办",
                    budget=RetrievalStepBudget(top_k=3),
                ),
            ),
        )

        with self.assertRaisesRegex(RetrievalBackendError, "qdrant unavailable"):
            execute_retrieval_plan(
                plan,
                retrieve_step=lambda _request: (_ for _ in ()).throw(
                    RetrievalBackendError("qdrant unavailable")
                ),
                observation_sink=observations.append,
                observation_request_id="req-backend-error",
            )

        self.assertEqual(len(observations), 1)
        self.assertEqual(observations[0]["request_id"], "req-backend-error")
        self.assertEqual(observations[0]["terminal_state"], "failed_closed")
        self.assertEqual(observations[0]["failure_kind"], "executor_error")
        self.assertEqual(observations[0]["candidate_count"], 0)
        self.assertNotIn("query", observations[0])

    def test_execute_retrieval_plan_classifies_release_drift_failure_observation(
        self,
    ) -> None:
        observations: list[dict[str, object]] = []
        plan = RetrievalPlan(
            plan_id="regulations:student_rules:release-drift",
            query_mode="current",
            admitted_scopes=(RetrievalScope(corpus="regulations", collection="student_rules"),),
            steps=(
                RetrievalStep(
                    step_id="primary",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="学士学位授予规定",
                    budget=RetrievalStepBudget(top_k=3),
                ),
            ),
        )

        with self.assertRaisesRegex(RetrievalBackendError, "release metadata drift"):
            execute_retrieval_plan(
                plan,
                retrieve_step=lambda _request: (_ for _ in ()).throw(
                    RetrievalBackendError(
                        "release metadata drift for student_rules/r1: profile_identity_hash"
                    )
                ),
                observation_sink=observations.append,
                observation_request_id="req-release-drift",
            )

        self.assertEqual(observations[0]["terminal_state"], "failed_closed")
        self.assertEqual(observations[0]["failure_kind"], "release_metadata_drift")

    def test_execute_retrieval_plan_skips_reranker_without_runtime_profile_opt_in(self) -> None:
        rerank_calls: list[RetrievalRequest] = []
        plan = RetrievalPlan(
            plan_id="regulations:student_rules:reranker-opt-out",
            query_mode="current",
            admitted_scopes=(RetrievalScope(corpus="regulations", collection="student_rules"),),
            steps=(
                RetrievalStep(
                    step_id="primary",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="校园卡丢了怎么办",
                    budget=RetrievalStepBudget(top_k=3),
                ),
            ),
        )

        with patch(
            "campus_retrieval_core.service.load_runtime_profile",
            return_value=Mock(reranker_enabled_by_default=False),
        ):
            result = execute_retrieval_plan(
                plan,
                retrieve_step=lambda request: EvidenceBundle(
                    query_text=request.query_text,
                    corpus=request.corpus,
                    collection=request.collection,
                    sources=(
                        _make_source(
                            chunk_id="campus-card:chunk-1",
                            version_id="v2:campus-card",
                            snippet="校园卡丢失后可自助补卡。",
                        ),
                    ),
                ),
                rerank_step=lambda request, evidence: rerank_calls.append(request) or evidence,
            )

        self.assertEqual(rerank_calls, [])
        self.assertEqual(result.step_results[0].status, "succeeded")
        self.assertEqual(len(result.merged_evidence.sources), 1)

    def test_execute_retrieval_plan_falls_back_to_baseline_when_reranker_degrades(self) -> None:
        observations: list[dict[str, object]] = []
        plan = RetrievalPlan(
            plan_id="regulations:student_rules:reranker-degraded",
            query_mode="current",
            admitted_scopes=(RetrievalScope(corpus="regulations", collection="student_rules"),),
            steps=(
                RetrievalStep(
                    step_id="primary",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="校园卡丢了怎么办",
                    budget=RetrievalStepBudget(top_k=3),
                ),
            ),
        )

        with (
            patch(
                "campus_retrieval_core.service.load_runtime_profile",
                return_value=Mock(reranker_enabled_by_default=True, reranker_top_n=20),
            ),
            self.assertLogs("campus_retrieval_core.service", level="WARNING") as logs,
        ):
            result = execute_retrieval_plan(
                plan,
                retrieve_step=lambda request: EvidenceBundle(
                    query_text=request.query_text,
                    corpus=request.corpus,
                    collection=request.collection,
                    sources=(
                        _make_source(
                            chunk_id="campus-card:chunk-1",
                            version_id="v2:campus-card",
                            snippet="校园卡丢失后可自助补卡。",
                        ),
                    ),
                ),
                rerank_step=lambda _request, _evidence: (_ for _ in ()).throw(
                    TimeoutError("reranker timed out")
                ),
                observation_sink=observations.append,
                observation_request_id="req-reranker-degraded",
            )

        self.assertEqual(result.step_results[0].status, "succeeded")
        self.assertEqual(len(result.merged_evidence.sources), 1)
        self.assertEqual(observations[0]["failure_kind"], "reranker_degraded")
        self.assertEqual(observations[0]["reranker_degraded"], True)
        self.assertIn("retrieval reranker degraded", logs.output[0])


if __name__ == "__main__":
    unittest.main()
