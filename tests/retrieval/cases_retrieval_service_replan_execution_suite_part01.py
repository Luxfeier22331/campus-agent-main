# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.retrieval.retrieval_service_replan_execution_suite_support import *


class RetrievalServiceReplanExecutionTestPart01(unittest.TestCase):
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

    def test_execute_retrieval_plan_rejects_replan_from_indexed_lookup_to_live_lookup(self) -> None:
        def fake_retrieve_step(request: RetrievalRequest) -> EvidenceBundle:
            return EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
            )

        plan = RetrievalPlan(
            plan_id="regulations:student_rules:reject-live-replan",
            query_mode="current",
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
                    ),
                    budget=RetrievalStepBudget(top_k=2),
                ),
            ),
        )

        result = execute_retrieval_plan(
            plan,
            retrieve_step=fake_retrieve_step,
            replan_callback=lambda _plan, _results, last_result: (
                RetrievalStep(
                    step_id="live-replanned",
                    step_type="live_source_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="国家奖学金 最新",
                    depends_on_step_ids=(last_result.step_id,),
                    selector=RetrievalSelector(
                        target_document_ids=("handbook:national-scholarship",),
                    ),
                    budget=RetrievalStepBudget(top_k=1),
                ),
            ),
        )

        self.assertEqual(tuple(step.status for step in result.step_results), ("empty", "failed"))
        self.assertEqual(result.step_results[1].step_id, "live-replanned:failure")
        self.assertIn("cannot switch to live branch", result.step_results[1].failure.message)
        self.assertEqual(result.replan_count, 0)

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
                        anchor=_answer_ready_anchor(
                            answer_role="procedure_step",
                            condition_subject="application_procedure",
                            condition_group_subject="application_procedure",
                            condition_group_id=(
                                "handbook:student-card:article-6:group-01:application_procedure"
                            ),
                            parent_unit_id="handbook:student-card:article-6",
                            procedure_action="apply",
                            action_type="student_card_reissue",
                            claim_type="procedure",
                            polarity="positive",
                        ),
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
                            anchor=_answer_ready_anchor(
                                answer_role="eligibility_condition",
                                condition_subject="general_eligibility",
                                condition_group_subject="general_eligibility",
                                condition_group_id=(
                                    "handbook:national-scholarship:article-8:"
                                    "group-01:general_eligibility"
                                ),
                                parent_unit_id="handbook:national-scholarship:article-8",
                                claim_type="condition",
                                polarity="positive",
                            ),
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
                        anchor=_answer_ready_anchor(
                            answer_role="eligibility_condition",
                            condition_subject="paper_or_publication",
                            condition_group_subject="paper_or_publication",
                            condition_group_id=(
                                "handbook:national-scholarship:article-9:"
                                "group-01:paper_or_publication"
                            ),
                            parent_unit_id="handbook:national-scholarship:article-9",
                            claim_type="condition",
                            polarity="positive",
                        ),
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
                            anchor=_answer_ready_anchor(
                                answer_role="exclusion_rule",
                                condition_subject="ineligible_condition",
                                condition_group_subject="application_procedure",
                                condition_group_id=(
                                    "handbook:demerit-relief:article-6:"
                                    "group-01:application_procedure"
                                ),
                                parent_unit_id="handbook:demerit-relief:article-6",
                                action_type="lift_discipline",
                                claim_type="cannot_do",
                                condition_polarity="negative",
                                polarity="negative",
                            ),
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
                        anchor=_answer_ready_anchor(
                            answer_role="procedure_step",
                            condition_subject="application_procedure",
                            condition_group_subject="application_procedure",
                            condition_group_id=(
                                "handbook:demerit-relief:article-3:group-01:application_procedure"
                            ),
                            parent_unit_id="handbook:demerit-relief:article-3",
                            procedure_action="apply",
                            action_type="lift_discipline",
                            claim_type="procedure",
                            polarity="positive",
                        ),
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

    def test_execute_retrieval_plan_marks_group_support_missing_for_rank_query_with_only_example_child(
        self,
    ) -> None:
        def fake_retrieve_step(request: RetrievalRequest) -> EvidenceBundle:
            return EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
                sources=(
                    _make_source(
                        chunk_id="national-scholarship-rank-group-example",
                        doc_id="handbook:national-scholarship",
                        source_title="中央民族大学本科学生国家奖学金评审办法",
                        snippet="且在学术研究上取得显著成绩。",
                        score=0.91,
                        content_role="eligibility",
                        is_answer_bearing=True,
                        semantic_role="example_evidence",
                        polarity="positive",
                        claim_type="condition",
                        anchor=_answer_ready_anchor(
                            answer_role="example_evidence",
                            condition_subject="paper_or_publication",
                            condition_group_subject="rank_threshold",
                            condition_group_id=(
                                "handbook:national-scholarship:article-9:group-01:rank_threshold"
                            ),
                            parent_unit_id="handbook:national-scholarship:article-9",
                            claim_type="condition",
                            polarity="positive",
                        ),
                    ),
                ),
            )

        plan = RetrievalPlan(
            plan_id="regulations:student_rules:group-support-missing",
            query_mode="current",
            admitted_scopes=(RetrievalScope(corpus="regulations", collection="student_rules"),),
            budget=RetrievalPlanBudget(max_steps=2, max_replans=1),
            steps=(
                RetrievalStep(
                    step_id="indexed-lookup",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="成绩没前十还能评国奖吗",
                    need_ids=("need:1:requirement",),
                    selector=RetrievalSelector(
                        target_document_ids=("handbook:national-scholarship",)
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
                        step_id="indexed-lookup-semantic-replan",
                        step_type="indexed_lookup",
                        scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                        query_text="国家奖学金 排名 条件 例外 条款 规定",
                        need_ids=("need:1:requirement",),
                        depends_on_step_ids=(last_result.step_id,),
                        selector=RetrievalSelector(
                            target_document_ids=("handbook:national-scholarship",)
                        ),
                        budget=RetrievalStepBudget(top_k=2),
                    ),
                )
                if last_result.status == "empty"
                else ()
            ),
        )

        self.assertEqual(result.replan_count, 1)
        self.assertEqual(result.step_results[0].status, "empty")
        self.assertEqual(result.step_results[0].activity.failure_kind, "group_support_missing")
        self.assertEqual(
            result.step_results[0].references[0].chunk_id,
            "national-scholarship-rank-group-example",
        )

    def test_execute_retrieval_plan_accepts_subject_expected_example_evidence_for_paper_query(
        self,
    ) -> None:
        def fake_retrieve_step(request: RetrievalRequest) -> EvidenceBundle:
            return EvidenceBundle(
                query_text=request.query_text,
                corpus=request.corpus,
                collection=request.collection,
                sources=(
                    _make_source(
                        chunk_id="national-scholarship-paper-example",
                        doc_id="handbook:national-scholarship",
                        source_title="中央民族大学本科学生国家奖学金评审办法",
                        snippet=(
                            "在学术研究上取得显著成绩，以第一作者发表的论文被SCI、EI、ISTP、"
                            "SSCI全文收录，以第一、二作者出版学术专著。"
                        ),
                        score=0.91,
                        content_role="eligibility",
                        is_answer_bearing=True,
                        semantic_role="example_evidence",
                        polarity="positive",
                        claim_type="condition",
                        anchor=_answer_ready_anchor(
                            answer_role="example_evidence",
                            condition_subject="paper_or_publication",
                            condition_group_subject="paper_or_publication",
                            condition_group_id=(
                                "handbook:national-scholarship:article-9:"
                                "group-01:paper_or_publication"
                            ),
                            parent_unit_id="handbook:national-scholarship:article-9",
                            claim_type="condition",
                            polarity="positive",
                        ),
                    ),
                ),
            )

        plan = RetrievalPlan(
            plan_id="regulations:student_rules:paper-example-supported",
            query_mode="current",
            admitted_scopes=(RetrievalScope(corpus="regulations", collection="student_rules"),),
            budget=RetrievalPlanBudget(max_steps=1, max_replans=0),
            steps=(
                RetrievalStep(
                    step_id="indexed-lookup",
                    step_type="indexed_lookup",
                    scope=RetrievalScope(corpus="regulations", collection="student_rules"),
                    query_text="论文能不能算国奖条件",
                    need_ids=("need:1:requirement",),
                    selector=RetrievalSelector(
                        target_document_ids=("handbook:national-scholarship",)
                    ),
                    budget=RetrievalStepBudget(top_k=2),
                ),
            ),
        )

        result = execute_retrieval_plan(plan, retrieve_step=fake_retrieve_step)

        self.assertEqual(result.step_results[0].status, "succeeded")
        self.assertEqual(
            tuple(source.chunk_id for source in result.merged_evidence.sources),
            ("national-scholarship-paper-example",),
        )


if __name__ == "__main__":
    unittest.main()
