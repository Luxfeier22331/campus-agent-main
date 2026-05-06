from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import Mock, patch

from campus_contracts import (
    EvidenceBundle,
)
from campus_retrieval_core.models import (
    RetrievalPlan,
    RetrievalPlanBudget,
    RetrievalRequest,
    RetrievalScope,
    RetrievalSelector,
    RetrievalStep,
    RetrievalStepBudget,
)
from campus_retrieval_core.service import (
    RetrievalBackendError,
    build_jsonl_retrieval_observation_sink,
    build_retrieval_observation_event_sink,
    execute_retrieval_plan,
)

from tests.retrieval.retrieval_service_test_support import _make_source


class RetrievalServiceReplanExecutionTest(unittest.TestCase):
    def test_execute_retrieval_plan_merges_dual_step_compare_results(self) -> None:
        seen_requests: list[RetrievalRequest] = []

        def fake_retrieve_step(request: RetrievalRequest) -> EvidenceBundle:
            seen_requests.append(request)
            version_id = request.target_version_ids[0]
            return EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
                sources=(
                    _make_source(
                        chunk_id=f"{version_id}:chunk-1",
                        version_id=version_id,
                        snippet=f"{version_id} content",
                    ),
                ),
            )

        plan = RetrievalPlan(
            plan_id="regulations:student_rules:compare",
            query_mode="compare",
            admitted_scopes=(RetrievalScope(corpus="regulations", collection="student_rules"),),
            budget=RetrievalPlanBudget(max_steps=2, max_replans=0),
            steps=(
                RetrievalStep(
                    step_id="primary",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="国奖变化",
                    selector=RetrievalSelector(
                        target_document_ids=("handbook:national-scholarship",),
                        target_version_ids=("v1:national-scholarship",),
                    ),
                    budget=RetrievalStepBudget(top_k=2),
                ),
                RetrievalStep(
                    step_id="comparison",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="国奖变化",
                    selector=RetrievalSelector(
                        target_document_ids=("handbook:national-scholarship",),
                        target_version_ids=("v2:national-scholarship",),
                    ),
                    budget=RetrievalStepBudget(top_k=2),
                ),
            ),
        )

        result = execute_retrieval_plan(plan, retrieve_step=fake_retrieve_step)

        self.assertEqual(
            [request.target_version_ids for request in seen_requests],
            [("v1:national-scholarship",), ("v2:national-scholarship",)],
        )
        self.assertEqual(
            tuple(step_result.status for step_result in result.step_results),
            ("succeeded", "succeeded"),
        )
        self.assertEqual(len(result.merged_evidence.sources), 2)

    def test_execute_retrieval_plan_supports_bounded_replan_append(self) -> None:
        seen_requests: list[RetrievalRequest] = []

        def fake_retrieve_step(request: RetrievalRequest) -> EvidenceBundle:
            seen_requests.append(request)
            if request.query_text == "国奖":
                return EvidenceBundle(
                    query_text=request.query_text,
                    corpus=request.corpus,
                    collection=request.collection,
                )
            return EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
                sources=(
                    _make_source(
                        chunk_id="v1:national-scholarship:chunk-1",
                        version_id="v1:national-scholarship",
                        snippet="narrowed content",
                    ),
                ),
            )

        plan = RetrievalPlan(
            plan_id="regulations:student_rules:replan",
            query_mode="historical",
            admitted_scopes=(RetrievalScope(corpus="regulations", collection="student_rules"),),
            budget=RetrievalPlanBudget(max_steps=2, max_replans=1),
            steps=(
                RetrievalStep(
                    step_id="primary",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="国奖",
                    selector=RetrievalSelector(
                        target_document_ids=("handbook:national-scholarship",),
                        target_version_ids=("v1:national-scholarship",),
                    ),
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
                        step_id="replanned",
                        step_type="indexed_lookup",
                        scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                        query_text="国家奖学金",
                        depends_on_step_ids=(last_result.step_id,),
                        selector=RetrievalSelector(
                            target_document_ids=("handbook:national-scholarship",),
                            target_version_ids=("v1:national-scholarship",),
                        ),
                        budget=RetrievalStepBudget(top_k=1),
                    ),
                )
                if last_result.status == "empty"
                else ()
            ),
        )

        self.assertEqual([request.query_text for request in seen_requests], ["国奖", "国家奖学金"])
        self.assertEqual(result.replan_count, 1)
        self.assertEqual(
            tuple(step_result.status for step_result in result.step_results), ("empty", "succeeded")
        )
        self.assertEqual(len(result.merged_evidence.sources), 1)

    def test_execute_retrieval_plan_replans_low_quality_grounding_without_dropping_references(
        self,
    ) -> None:
        seen_requests: list[RetrievalRequest] = []

        def fake_retrieve_step(request: RetrievalRequest) -> EvidenceBundle:
            seen_requests.append(request)
            if len(seen_requests) == 1:
                return EvidenceBundle(
                    query_text=request.query_text,
                    corpus=request.corpus,
                    collection=request.collection,
                    sources=(
                        _make_source(
                            chunk_id="student-card-closing",
                            snippet="附则 本办法由学生处负责解释。",
                            score=0.91,
                            content_role="closing_provision",
                        ),
                    ),
                )
            return EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
                sources=(
                    _make_source(
                        chunk_id="student-card-procedure",
                        snippet="学生证遗失后，应及时挂失并填写补办申请。",
                        score=0.73,
                        content_role="procedure",
                        is_answer_bearing=True,
                    ),
                ),
            )

        plan = RetrievalPlan(
            plan_id="regulations:student_rules:low-quality-replan",
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
                        query_text="学生证补办 挂失 办理步骤",
                        need_ids=last_result.activity.need_ids if last_result.activity else (),
                        depends_on_step_ids=(last_result.step_id,),
                        selector=RetrievalSelector(target_document_ids=("handbook:student-card",)),
                        budget=RetrievalStepBudget(top_k=2),
                    ),
                )
                if last_result.status == "empty"
                else ()
            ),
        )

        self.assertEqual(
            [request.query_text for request in seen_requests],
            ["学生证丢了怎么办？", "学生证补办 挂失 办理步骤"],
        )
        self.assertEqual(result.replan_count, 1)
        self.assertEqual(
            tuple(step_result.status for step_result in result.step_results),
            ("empty", "succeeded"),
        )
        self.assertEqual(result.step_results[0].references[0].chunk_id, "student-card-closing")
        self.assertEqual(
            tuple(source.chunk_id for source in result.merged_evidence.sources),
            ("student-card-procedure",),
        )

    def test_execute_retrieval_plan_replans_policy_clause_query_when_anchor_support_is_missing(
        self,
    ) -> None:
        seen_requests: list[RetrievalRequest] = []

        def fake_retrieve_step(request: RetrievalRequest) -> EvidenceBundle:
            seen_requests.append(request)
            if len(seen_requests) == 1:
                return EvidenceBundle(
                    query_text=request.query_text,
                    corpus=request.corpus,
                    collection=request.collection,
                    sources=(
                        _make_source(
                            chunk_id="national-scholarship-article-8",
                            snippet="第八条 国家奖学金候选人应当坚持德智体美劳全面发展。",
                            score=0.88,
                            detail_label="第八条",
                            content_role="requirement",
                            is_answer_bearing=True,
                        ),
                    ),
                )
            return EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
                sources=(
                    _make_source(
                        chunk_id="national-scholarship-article-9",
                        snippet="第九条 在前10%的基础上，必须在论文、著作等方面特别优秀。",
                        score=0.83,
                        detail_label="第九条",
                        content_role="requirement",
                        is_answer_bearing=True,
                    ),
                ),
            )

        plan = RetrievalPlan(
            plan_id="regulations:student_rules:policy-clause-replan",
            query_mode="current",
            admitted_scopes=(RetrievalScope(corpus="regulations", collection="student_rules"),),
            budget=RetrievalPlanBudget(max_steps=2, max_replans=1),
            steps=(
                RetrievalStep(
                    step_id="policy-focused-lookup",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="国奖第九条怎么要求论文和著作？",
                    need_ids=("need:1:policy_clause",),
                    selector=RetrievalSelector(
                        target_document_ids=("handbook:national-scholarship",),
                        focus_detail_labels=("第九条",),
                        focus_article_nos=("9",),
                        focus_terms=("论文", "著作"),
                    ),
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
                        step_id="policy-focused-lookup-semantic-replan",
                        step_type="indexed_lookup",
                        scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                        query_text="国奖第九条 论文 著作 依据 条款 规定",
                        need_ids=("need:1:policy_clause",),
                        depends_on_step_ids=(last_result.step_id,),
                        selector=RetrievalSelector(
                            target_document_ids=("handbook:national-scholarship",),
                            focus_detail_labels=("第九条",),
                            focus_article_nos=("9",),
                            focus_terms=("论文", "著作"),
                        ),
                        budget=RetrievalStepBudget(top_k=2),
                    ),
                )
                if last_result.status == "empty"
                else ()
            ),
        )

        self.assertEqual(
            [request.focus_detail_labels for request in seen_requests],
            [("第九条",), ("第九条",)],
        )
        self.assertEqual(
            [request.focus_terms for request in seen_requests],
            [("论文", "著作"), ("论文", "著作")],
        )
        self.assertEqual(
            [request.query_text for request in seen_requests],
            ["国奖第九条怎么要求论文和著作？", "国奖第九条 论文 著作 依据 条款 规定"],
        )
        self.assertEqual(result.replan_count, 1)
        self.assertEqual(
            tuple(step_result.status for step_result in result.step_results),
            ("empty", "succeeded"),
        )
        self.assertEqual(
            tuple(source.chunk_id for source in result.merged_evidence.sources),
            ("national-scholarship-article-9",),
        )

    def test_execute_retrieval_plan_replans_when_top_grounding_conflicts_with_query_polarity(
        self,
    ) -> None:
        seen_requests: list[RetrievalRequest] = []

        def fake_retrieve_step(request: RetrievalRequest) -> EvidenceBundle:
            seen_requests.append(request)
            if len(seen_requests) == 1:
                return EvidenceBundle(
                    query_text=request.query_text,
                    corpus=request.corpus,
                    collection=request.collection,
                    sources=(
                        _make_source(
                            chunk_id="discipline-negative-exception",
                            doc_id="handbook:demerit-relief",
                            source_title="中央民族大学解除学生纪律处分实施办法",
                            snippet="第六条 有下列情形之一的，不予解除处分。",
                            score=0.93,
                            content_role="procedure",
                            is_answer_bearing=True,
                            semantic_role="exception",
                            polarity="negative",
                            action_type="lift_discipline",
                            claim_type="cannot_do",
                        ),
                    ),
                )
            return EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
                sources=(
                    _make_source(
                        chunk_id="discipline-positive-procedure",
                        doc_id="handbook:demerit-relief",
                        source_title="中央民族大学解除学生纪律处分实施办法",
                        snippet="学生受处分满考察期后，可以申请解除纪律处分。",
                        score=0.72,
                        content_role="procedure",
                        is_answer_bearing=True,
                        semantic_role="procedure_step",
                        polarity="positive",
                        action_type="lift_discipline",
                        claim_type="procedure",
                    ),
                ),
            )

        plan = RetrievalPlan(
            plan_id="regulations:student_rules:polarity-replan",
            query_mode="current",
            admitted_scopes=(RetrievalScope(corpus="regulations", collection="student_rules"),),
            budget=RetrievalPlanBudget(max_steps=2, max_replans=1),
            steps=(
                RetrievalStep(
                    step_id="indexed-lookup",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="处分怎么消",
                    need_ids=("need:1:procedure",),
                    selector=RetrievalSelector(target_document_ids=("handbook:demerit-relief",)),
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
                        query_text="解除处分 申请 条件 程序 办理步骤",
                        need_ids=last_result.activity.need_ids if last_result.activity else (),
                        depends_on_step_ids=(last_result.step_id,),
                        selector=RetrievalSelector(
                            target_document_ids=("handbook:demerit-relief",)
                        ),
                        budget=RetrievalStepBudget(top_k=2),
                    ),
                )
                if last_result.status == "empty"
                else ()
            ),
        )

        self.assertEqual(
            [request.query_text for request in seen_requests],
            ["处分怎么消", "解除处分 申请 条件 程序 办理步骤"],
        )
        self.assertEqual(result.replan_count, 1)
        self.assertEqual(
            tuple(step_result.status for step_result in result.step_results),
            ("empty", "succeeded"),
        )
        self.assertEqual(
            result.step_results[0].references[0].chunk_id, "discipline-negative-exception"
        )
        self.assertEqual(
            tuple(source.chunk_id for source in result.merged_evidence.sources),
            ("discipline-positive-procedure",),
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

    def test_execute_retrieval_plan_fail_closes_when_replan_drops_existing_version_filter(
        self,
    ) -> None:
        seen_requests: list[RetrievalRequest] = []

        def fake_retrieve_step(request: RetrievalRequest) -> EvidenceBundle:
            seen_requests.append(request)
            return EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
            )

        plan = RetrievalPlan(
            plan_id="regulations:student_rules:replan-version-tightening",
            query_mode="historical",
            admitted_scopes=(RetrievalScope(corpus="regulations", collection="student_rules"),),
            budget=RetrievalPlanBudget(max_steps=2, max_replans=1),
            steps=(
                RetrievalStep(
                    step_id="primary",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="国奖",
                    selector=RetrievalSelector(
                        target_document_ids=("handbook:national-scholarship",),
                        target_version_ids=("v1:national-scholarship",),
                    ),
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
                        step_id="replanned",
                        step_type="indexed_lookup",
                        scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                        query_text="国家奖学金",
                        depends_on_step_ids=(last_result.step_id,),
                        selector=RetrievalSelector(
                            target_document_ids=("handbook:national-scholarship",),
                        ),
                        budget=RetrievalStepBudget(top_k=1),
                    ),
                )
                if last_result.status == "empty"
                else ()
            ),
        )

        self.assertEqual([request.query_text for request in seen_requests], ["国奖"])
        self.assertEqual(result.replan_count, 0)
        self.assertEqual(
            tuple(step_result.status for step_result in result.step_results), ("empty", "failed")
        )
        self.assertEqual(result.step_results[-1].failure.failure_kind, "executor_error")
        self.assertIn("target_version_ids", result.step_results[-1].failure.message)

    def test_execute_retrieval_plan_fail_closes_when_replan_switches_scope(self) -> None:
        seen_requests: list[RetrievalRequest] = []

        def fake_retrieve_step(request: RetrievalRequest) -> EvidenceBundle:
            seen_requests.append(request)
            return EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
            )

        plan = RetrievalPlan(
            plan_id="regulations:student_rules:replan-scope-switch",
            query_mode="current",
            admitted_scopes=(
                RetrievalScope(corpus="regulations", collection="student_rules"),
                RetrievalScope(corpus="curriculum", collection="curriculum_plan"),
            ),
            budget=RetrievalPlanBudget(max_steps=2, max_replans=1),
            steps=(
                RetrievalStep(
                    step_id="primary",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="国奖",
                    selector=RetrievalSelector(
                        target_document_ids=("handbook:national-scholarship",),
                    ),
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
                        step_id="replanned",
                        step_type="indexed_lookup",
                        scope=RetrievalScope(corpus="curriculum", collection="curriculum_plan"),
                        query_text="国家奖学金",
                        depends_on_step_ids=(last_result.step_id,),
                        selector=RetrievalSelector(
                            target_document_ids=("handbook:national-scholarship",),
                        ),
                        budget=RetrievalStepBudget(top_k=1),
                    ),
                )
                if last_result.status == "empty"
                else ()
            ),
        )

        self.assertEqual([request.query_text for request in seen_requests], ["国奖"])
        self.assertEqual(result.replan_count, 0)
        self.assertEqual(
            tuple(step_result.status for step_result in result.step_results), ("empty", "failed")
        )
        self.assertEqual(result.step_results[-1].failure.failure_kind, "executor_error")
        self.assertIn("scope", result.step_results[-1].failure.message)
