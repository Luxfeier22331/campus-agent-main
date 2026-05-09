# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.agent.rag_agent_agentic_depth_runtime_suite_support import *


class RagAgentAgenticDepthRuntimeTestPart01(unittest.TestCase):
    def test_planner_stage_returns_typed_decision(self) -> None:
        request = AgentRequest(
            target="rag-agent",
            user_goal="公费医疗报销需要什么材料",
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_rules")
            ),
        )

        result = execute_rag_planner_stage(
            request=request,
            effective_scope=KnowledgeScope(corpus="regulations", collection="student_rules"),
            user_goal=request.user_goal,
            effective_user_goal=request.user_goal,
            handbook_plan=None,
            curriculum_plan=None,
            curriculum_course_plan=plan_curriculum_course_query(request.user_goal),
            curriculum_program_family_plan=None,
        )

        self.assertIsNotNone(result.planner_decision)
        self.assertEqual(result.planner_decision.query_mode, "current")
        self.assertEqual(result.planner_decision.planned_steps[0].step_type, "indexed_lookup")
        self.assertEqual(
            tuple(
                need.expected_evidence_kind for need in result.planner_decision.information_needs
            ),
            ("requirement",),
        )

    def test_planner_stage_exposes_information_needs_for_multi_part_question(self) -> None:
        result = _plan_student_rules("公费医疗报销需要什么材料，并说明审核流程")

        self.assertGreaterEqual(len(result.information_needs), 2)
        self.assertEqual(
            tuple(need.expected_evidence_kind for need in result.information_needs),
            ("requirement", "procedure"),
        )
        self.assertTrue(
            all(need.target_collection == "student_rules" for need in result.information_needs)
        )
        self.assertIs(result.information_needs, result.planner_decision.information_needs)

    def test_planner_stage_links_information_needs_to_retrieval_steps(self) -> None:
        result = _plan_student_rules("公费医疗报销需要什么材料，并说明审核流程")

        need_ids = tuple(need.need_id for need in result.information_needs)
        self.assertEqual(tuple(step.need_ids for step in result.retrieval_plan.steps), (need_ids,))
        self.assertEqual(
            tuple(step.need_ids for step in result.planner_decision.planned_steps),
            (need_ids,),
        )

    def test_planner_stage_exposes_canonical_entity_resolution_summary(self) -> None:
        request = AgentRequest(
            target="rag-agent",
            user_goal="习概第几学期开？",
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
            ),
        )

        result = execute_rag_planner_stage(
            request=request,
            effective_scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan"),
            user_goal=request.user_goal,
            effective_user_goal=request.user_goal,
            handbook_plan=None,
            curriculum_plan=None,
            curriculum_course_plan=plan_curriculum_course_query(request.user_goal),
            curriculum_program_family_plan=None,
        )

        summary = result.planner_decision.entity_resolution_summary
        self.assertIsNotNone(summary)
        self.assertEqual(summary.resolution_status, "resolved")
        self.assertEqual(summary.entity_type, "course")
        self.assertEqual(summary.canonical_id, "course:muc.xigai")
        self.assertEqual(summary.target_collection, "course_facts")
        self.assertEqual(summary.resolution_source, "canonical_alias_governance")
        self.assertGreaterEqual(summary.confidence, 0.9)
        self.assertEqual(result.retrieval_plan.steps[0].step_type, "entity_resolution")

    def test_completed_answer_diagnostics_expose_safe_entity_resolution_summary(self) -> None:
        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="习概第几学期开？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=lambda *args, **kwargs: EvidenceBundle(
                query_text="习概第几学期开？",
                corpus="curriculum",
                collection="course_facts",
                sources=(
                    _make_handbook_source(
                        doc_id="course:muc.xigai",
                        title="习近平新时代中国特色社会主义思想概论",
                        snippet="习近平新时代中国特色社会主义思想概论通常安排在第 3 学期开设。",
                        score=0.93,
                        chunk_id_suffix="xigai-semester-fact",
                        content_role="course_fact",
                        is_answer_bearing=True,
                    ),
                ),
            ),
        )

        summary = response.result.diagnostics.entity_resolution_summary
        self.assertIsNotNone(summary)
        self.assertEqual(summary.canonical_id, "course:muc.xigai")
        self.assertEqual(summary.resolution_source, "canonical_alias_governance")
        self.assertNotIn("RetrievalStep", str(summary))
        self.assertNotIn("raw_payload", str(summary))

    def test_completed_answer_preserves_need_level_support_provenance(self) -> None:
        query_text = "解除处分需要什么条件，并说明申请流程"
        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal=query_text,
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: _discipline_requirement_and_procedure_evidence(
                query_text=query_text
            ),
        )

        self.assertEqual(response.status, "completed")
        expected_need_ids = tuple(
            need.need_id for need in response.result.diagnostics.planner_information_needs
        )
        self.assertEqual(
            tuple(
                source.anchor["retrieval_need_ids"] for source in response.result.evidence.sources
            ),
            (expected_need_ids, expected_need_ids),
        )
        self.assertTrue(
            all(
                entry.support_need_ids == expected_need_ids
                for entry in response.result.diagnostics.claim_evidence_graph
            )
        )

    def test_delegate_to_rag_agent_uses_bounded_semantic_replan_for_empty_support(self) -> None:
        calls: list[str] = []

        def fake_retriever(query: str, **kwargs: object) -> EvidenceBundle:
            calls.append(query)
            if len(calls) == 1:
                return EvidenceBundle(
                    query_text=query,
                    corpus=str(kwargs["corpus"]),
                    collection=str(kwargs["collection"]),
                    sources=(),
                )
            return _medical_evidence(query_text=query)

        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="公费医疗报销需要什么材料",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(
            calls,
            [
                "中央民族大学学生公费医疗管理办法 公费医疗报销需要什么材料",
                "中央民族大学学生公费医疗管理办法 公费医疗报销 所需材料 条件 要求",
            ],
        )
        self.assertEqual(response.result.diagnostics.retrieval_plan_summary.replan_count, 1)
        self.assertEqual(
            response.result.diagnostics.replan_decision_summary.trigger_reason,
            "empty_supporting_evidence",
        )

    def test_delegate_to_rag_agent_replans_when_positive_procedure_query_gets_negative_exception(
        self,
    ) -> None:
        calls: list[str] = []

        def fake_retriever(query: str, **kwargs: object) -> EvidenceBundle:
            calls.append(query)
            if len(calls) == 1:
                return EvidenceBundle(
                    query_text=query,
                    corpus=str(kwargs["corpus"]),
                    collection=str(kwargs["collection"]),
                    sources=(
                        _make_handbook_source(
                            doc_id="handbook:demerit-relief",
                            title="中央民族大学解除学生纪律处分实施办法",
                            snippet="第六条 有下列情形之一的，不予解除处分。",
                            score=0.93,
                            chunk_id_suffix="discipline-negative-exception",
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
                query_text=query,
                corpus=str(kwargs["corpus"]),
                collection=str(kwargs["collection"]),
                sources=(
                    _make_handbook_source(
                        doc_id="handbook:demerit-relief",
                        title="中央民族大学解除学生纪律处分实施办法",
                        snippet="第三条 学生受处分满考察期后，可以申请解除纪律处分。",
                        score=0.72,
                        chunk_id_suffix="discipline-positive-procedure",
                        content_role="procedure",
                        is_answer_bearing=True,
                        semantic_role="procedure_step",
                        polarity="positive",
                        action_type="lift_discipline",
                        claim_type="procedure",
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="处分怎么消",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(calls, ["解除处分 申请 条件 程序", "解除处分 申请 条件 程序 办理步骤"])
        self.assertEqual(
            tuple(source.chunk_id for source in response.result.evidence.sources),
            ("handbook:demerit-relief:source-faithful:v1:discipline-positive-procedure",),
        )
        self.assertNotIn("不予解除处分", response.answer_text)
        self.assertEqual(response.result.diagnostics.retrieval_plan_summary.replan_count, 1)
        self.assertEqual(
            response.result.diagnostics.replan_decision_summary.trigger_reason,
            "polarity_conflict",
        )

    def test_projection_context_marks_planning_use_without_raw_payload(self) -> None:
        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="结合前序通知，公费医疗报销需要什么材料？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
                workflow_context=WorkflowAgentContext(
                    workflow_run_ref="workflow-run-001",
                    step_id="notice-step",
                    agent_id="rag-agent",
                    target="rag-agent",
                    required_projection_kind="CanonicalNoticeContext",
                    projection_refs=(
                        {
                            "projection_id": "notice-proj-1",
                            "source_step_id": "notice-step",
                            "projection_kind": "CanonicalNoticeContext",
                            "content_hash": "a" * 64,
                            "safety": {"projection_safe": True},
                        },
                    ),
                ),
            ),
            retriever=lambda *args, **kwargs: _medical_evidence(
                query_text="公费医疗报销需要什么材料"
            ),
        )

        summaries = response.result.diagnostics.projection_context_summaries
        self.assertEqual(len(summaries), 1)
        self.assertEqual(summaries[0].projection_id, "notice-proj-1")
        self.assertEqual(summaries[0].evidence_use, "planning_framing")
        self.assertNotIn("raw_payload", summaries[0].safety_summary)

    def test_semantic_replan_preserves_triggering_step_expected_output(self) -> None:
        replanned_steps = build_semantic_replan_steps(
            _single_step_plan(
                plan_id="curriculum:course_facts:entity-replan",
                corpus="curriculum",
                collection="course_facts",
                step_type="entity_resolution",
                expected_output="entity_matches",
                selector=RetrievalSelector(canonical_course_ids=("course:muc.xigai",)),
            ),
            (RetrievalStepResult(step_id="entity-resolution", status="empty"),),
            RetrievalStepResult(step_id="entity-resolution", status="empty"),
        )

        self.assertEqual(len(replanned_steps), 1)
        self.assertEqual(replanned_steps[0].step_type, "indexed_lookup")
        self.assertEqual(replanned_steps[0].expected_output, "entity_matches")

    def test_semantic_replan_rewrites_query_for_missing_procedure_need(self) -> None:
        replanned_steps = build_semantic_replan_steps(
            _single_step_plan(
                query_text="公费医疗报销需要什么材料，并说明审核流程",
                need_ids=("need:1:requirement", "need:2:procedure"),
            ),
            (RetrievalStepResult(step_id="indexed-lookup", status="empty"),),
            RetrievalStepResult(step_id="indexed-lookup", status="empty"),
        )

        self.assertEqual(len(replanned_steps), 1)
        self.assertIn("审核流程", replanned_steps[0].query_text)
        self.assertNotIn("材料", replanned_steps[0].query_text)
        self.assertEqual(replanned_steps[0].need_ids, ("need:2:procedure",))
        self.assertEqual(replanned_steps[0].budget.top_k, 2)

    def test_semantic_replan_rewrites_loss_procedure_query_with_reissue_terms(self) -> None:
        replanned_steps = build_semantic_replan_steps(
            _single_step_plan(
                query_text="学生证丢了怎么办？",
                need_ids=("need:1:procedure",),
            ),
            (RetrievalStepResult(step_id="indexed-lookup", status="empty"),),
            RetrievalStepResult(step_id="indexed-lookup", status="empty"),
        )

        self.assertEqual(len(replanned_steps), 1)
        self.assertIn("学生证", replanned_steps[0].query_text)
        self.assertIn("挂失", replanned_steps[0].query_text)
        self.assertIn("补办", replanned_steps[0].query_text)
        self.assertIn("办理步骤", replanned_steps[0].query_text)

    def test_semantic_replan_rewrites_positive_procedure_query_after_negative_polarity_conflict(
        self,
    ) -> None:
        replanned_steps = build_semantic_replan_steps(
            _single_step_plan(
                query_text="处分怎么消",
                need_ids=("need:1:procedure",),
                selector=RetrievalSelector(target_document_ids=("handbook:demerit-relief",)),
            ),
            (
                RetrievalStepResult(
                    step_id="indexed-lookup",
                    status="empty",
                    references=(
                        _make_handbook_source(
                            doc_id="handbook:demerit-relief",
                            title="中央民族大学解除学生纪律处分实施办法",
                            snippet="第六条 有下列情形之一的，不予解除处分。",
                            score=0.93,
                            chunk_id_suffix="discipline-negative-exception",
                            content_role="procedure",
                            is_answer_bearing=True,
                            semantic_role="exception",
                            polarity="negative",
                            action_type="lift_discipline",
                            claim_type="cannot_do",
                        ),
                    ),
                    activity=RetrievalStepActivity(
                        step_id="indexed-lookup",
                        step_type="indexed_lookup",
                        corpus="regulations",
                        collection="student_rules",
                        status="empty",
                        query_text="处分怎么消",
                        need_ids=("need:1:procedure",),
                        top_k=2,
                        candidate_count=1,
                        reference_count=1,
                        failure_kind="polarity_conflict",
                    ),
                ),
            ),
            RetrievalStepResult(
                step_id="indexed-lookup",
                status="empty",
                activity=RetrievalStepActivity(
                    step_id="indexed-lookup",
                    step_type="indexed_lookup",
                    corpus="regulations",
                    collection="student_rules",
                    status="empty",
                    query_text="处分怎么消",
                    need_ids=("need:1:procedure",),
                    top_k=2,
                    candidate_count=1,
                    reference_count=1,
                    failure_kind="polarity_conflict",
                ),
            ),
        )

        self.assertEqual(len(replanned_steps), 1)
        self.assertEqual(replanned_steps[0].query_text, "解除处分 申请 条件 程序 办理步骤")
        self.assertEqual(
            replanned_steps[0].selector.target_document_ids,
            ("handbook:demerit-relief",),
        )

    def test_semantic_replan_preserves_policy_focus_selector_metadata(self) -> None:
        replanned_steps = build_semantic_replan_steps(
            _single_step_plan(
                query_text="国奖第九条怎么要求论文和著作？",
                need_ids=("need:1:policy_clause",),
                selector=RetrievalSelector(
                    target_document_ids=("handbook:national-scholarship",),
                    focus_detail_labels=("第九条",),
                    focus_article_nos=("9",),
                    focus_terms=("论文", "著作"),
                ),
            ),
            (RetrievalStepResult(step_id="indexed-lookup", status="empty"),),
            RetrievalStepResult(step_id="indexed-lookup", status="empty"),
        )

        self.assertEqual(len(replanned_steps), 1)
        self.assertEqual(
            replanned_steps[0].selector.target_document_ids, ("handbook:national-scholarship",)
        )
        self.assertEqual(replanned_steps[0].selector.focus_detail_labels, ("第九条",))
        self.assertEqual(replanned_steps[0].selector.focus_article_nos, ("9",))
        self.assertEqual(replanned_steps[0].selector.focus_terms, ("论文", "著作"))
        self.assertIn("第九条", replanned_steps[0].query_text)

    def test_semantic_replan_rewrites_rank_query_when_group_support_is_missing(self) -> None:
        replanned_steps = build_semantic_replan_steps(
            _single_step_plan(
                query_text="成绩没前十还能评国奖吗",
                need_ids=("need:1:requirement",),
                selector=RetrievalSelector(
                    target_document_ids=("handbook:national-scholarship",),
                ),
            ),
            (
                RetrievalStepResult(
                    step_id="indexed-lookup",
                    status="empty",
                    references=(
                        _make_handbook_source(
                            doc_id="handbook:national-scholarship",
                            title="中央民族大学本科学生国家奖学金评审办法",
                            snippet="且在学术研究上取得显著成绩。",
                            score=0.91,
                            chunk_id_suffix="national-scholarship-rank-group-example",
                            content_role="eligibility",
                            is_answer_bearing=True,
                            semantic_role="example_evidence",
                            polarity="positive",
                            claim_type="condition",
                            anchor={
                                INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                                    "answer_role": "example_evidence",
                                    "condition_subject": "paper_or_publication",
                                    "condition_group_subject": "rank_threshold",
                                    "condition_group_id": (
                                        "handbook:national-scholarship:article-9:"
                                        "group-01:rank_threshold"
                                    ),
                                    "parent_unit_id": "handbook:national-scholarship:article-9",
                                    "evidence_contract_version": "answer_ready_evidence.v3",
                                    "polarity": "positive",
                                    "claim_type": "condition",
                                },
                                "page_start": 1,
                                "page_end": 1,
                            },
                        ),
                    ),
                    activity=RetrievalStepActivity(
                        step_id="indexed-lookup",
                        step_type="indexed_lookup",
                        corpus="regulations",
                        collection="student_rules",
                        status="empty",
                        query_text="成绩没前十还能评国奖吗",
                        need_ids=("need:1:requirement",),
                        top_k=2,
                        candidate_count=1,
                        reference_count=1,
                        failure_kind="group_support_missing",
                    ),
                ),
            ),
            RetrievalStepResult(
                step_id="indexed-lookup",
                status="empty",
                activity=RetrievalStepActivity(
                    step_id="indexed-lookup",
                    step_type="indexed_lookup",
                    corpus="regulations",
                    collection="student_rules",
                    status="empty",
                    query_text="成绩没前十还能评国奖吗",
                    need_ids=("need:1:requirement",),
                    top_k=2,
                    candidate_count=1,
                    reference_count=1,
                    failure_kind="group_support_missing",
                ),
            ),
        )

        self.assertEqual(len(replanned_steps), 1)
        self.assertIn("排名", replanned_steps[0].query_text)
        self.assertIn("例外", replanned_steps[0].query_text)
        self.assertIn("条款", replanned_steps[0].query_text)

    def test_semantic_replan_uses_semantic_hint_not_raw_query_cues(self) -> None:
        replanned_steps = build_semantic_replan_steps(
            _single_step_plan(
                query_text="中央民族大学学生申诉处理办法",
                need_ids=("need:1:procedure_steps",),
                semantic_hint=RetrievalSemanticHint(
                    intent_kind="procedure_steps",
                    answer_kind="procedure_steps",
                    need_kinds=("procedure_steps",),
                    coverage_policy="procedure_step_completeness",
                    selection_policy="answer_role_first",
                    replan_policy="intent_gap_replan",
                    expected_answer_roles=("procedure_step",),
                ),
            ),
            (RetrievalStepResult(step_id="indexed-lookup", status="empty"),),
            RetrievalStepResult(step_id="indexed-lookup", status="empty"),
        )

        self.assertEqual(len(replanned_steps), 1)
        self.assertIn("办理步骤", replanned_steps[0].query_text)
        self.assertEqual(replanned_steps[0].need_ids, ("need:1:procedure_steps",))


if __name__ == "__main__":
    unittest.main()
