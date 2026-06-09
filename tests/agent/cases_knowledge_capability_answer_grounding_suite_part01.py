# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.agent.knowledge_capability_answer_grounding_suite_support import *


class KnowledgeCapabilityAnswerGroundingTestPart01(unittest.TestCase):
    def test_low_support_evidence_maps_to_no_answer_instead_of_completed(self) -> None:
        evidence = _make_evidence(
            scores=(0.41,),
            query_text="How do I replace my student card?",
        )

        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
                user_goal="How do I replace my student card?",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "no_answer")
        self.assertEqual(response.confidence, "low")
        self.assertIn("未检索到足够依据", response.answer_text)
        self.assertEqual(
            tuple(source.chunk_id for source in response.result.evidence.sources),
            tuple(source.chunk_id for source in evidence.sources),
        )
        self.assertIsNotNone(response.result.diagnostics)
        self.assertEqual(response.result.diagnostics.resolved_scope_corpus, "regulations")
        self.assertEqual(response.result.diagnostics.resolved_scope_collection, "student_rules")
        self.assertEqual(response.result.diagnostics.semantic_outcome, "unsupported_by_evidence")

    def test_completed_response_uses_evidence_and_actor_context(self) -> None:
        captured_kwargs: dict[str, object] = {}
        expected_evidence = _make_evidence(query_text="What are the library hours?")

        def fake_retriever(query: str, **kwargs: object) -> EvidenceBundle:
            captured_kwargs["query"] = query
            captured_kwargs.update(kwargs)
            return expected_evidence

        request = CapabilityRequest(
            capability="knowledge",
            user_goal="What are the library hours?",
            actor=ActorContext(
                user_id="student-001",
            ),
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_rules")
            ),
        )

        response = delegate_to_knowledge_capability(request, retriever=fake_retriever)

        self.assertIsInstance(response, CapabilityResponse)
        self.assertEqual(response.capability, "knowledge")
        self.assertEqual(response.status, "completed")
        self.assertEqual(captured_kwargs["query"], "What are the library hours?")
        self.assertEqual(captured_kwargs["corpus"], "regulations")
        self.assertEqual(captured_kwargs["collection"], "student_rules")
        self.assertEqual(
            captured_kwargs["authorized_filter"],
            AuthorizedRetrievalFilter(
                entitlement_groups=(),
                visibility_level="public",
                visibility_scope=None,
                policy_projection_version="phase1-authorization-projection-v1",
            ),
        )
        self.assertEqual(
            captured_kwargs["personalization_hint"],
            PersonalizationHint(
                actor_claim_terms=(),
                recent_goal="",
                confirmed_slot_terms=(),
            ),
        )
        self.assertTrue(response.answer_text)
        self.assertIn("根据学生手册相关规定", response.answer_text)
        self.assertIn("Evidence snippet 1", response.answer_text)
        _assert_answer_text_hides_internal_locators(self, response.answer_text)
        self.assertEqual(response.confidence, "medium")
        self.assertEqual(
            tuple(source.chunk_id for source in response.result.evidence.sources),
            tuple(source.chunk_id for source in expected_evidence.sources),
        )
        self.assertEqual(
            response.result.diagnostics.resolved_scope_corpus,
            "regulations",
        )
        self.assertEqual(
            response.result.diagnostics.resolved_scope_collection,
            "student_rules",
        )
        self.assertEqual(response.result.diagnostics.semantic_outcome, "grounded_answer")
        self.assertEqual(
            response.result.diagnostics.retrieved_title_summary,
            (
                "Evidence snippet 1 about library hours and student support.",
                "Evidence snippet 2 about library hours and student support.",
            ),
        )
        self.assertEqual(response.result.diagnostics.retrieved_sources, expected_evidence.sources)
        self.assertEqual(
            response.result.diagnostics.source_trust_summary,
            SourceTrustSummary(
                observed_tiers=("T1",),
                answer_bearing_tiers=("T1",),
                blocked_claim_types=(),
                freshness_claim_blocked=False,
                authorization_claim_blocked=False,
            ),
        )
        self.assertIsNotNone(response.result.diagnostics.retrieval_plan_summary)
        self.assertTrue(response.result.diagnostics.stage_activities)
        self.assertIsNotNone(response.capability_observability)
        assert response.capability_observability is not None
        self.assertEqual(response.capability_observability.selected_tool, "retrieval.query")
        self.assertEqual(response.capability_observability.tool_attempted, True)
        self.assertEqual(response.capability_observability.tool_outcome, "grounded_answer")
        self.assertEqual(response.capability_observability.source_ref_count, 2)
        safe_details = response.capability_observability.safe_details
        self.assertEqual(
            safe_details["agent_execution_projection"],
            {
                "schema_version": "agent-execution-projection-v1",
                "projection_owner": "knowledge",
                "selected_tool": "retrieval.query",
                "payload_kind": "rag_request",
                "tool_selection_reason": "retrieval_plan_executed",
            },
        )
        agent_plan = safe_details["agent_plan"]
        self.assertEqual(agent_plan["schema_version"], "agent-local-plan-v1")
        self.assertEqual(agent_plan["planner"], "rag_retrieval_planner")
        self.assertEqual(agent_plan["selected_tool"], "retrieval.query")
        self.assertEqual(agent_plan["query_mode"], "current")
        self.assertEqual(agent_plan["terminal_state"], "completed")
        result_guardrail = safe_details["result_guardrail"]
        self.assertEqual(result_guardrail["schema_version"], "agent-result-guardrail-v1")
        self.assertEqual(result_guardrail["outcome"], "source_backed")
        self.assertEqual(result_guardrail["retrieval_adequacy_verdict"], "sufficient")
        self.assertEqual(result_guardrail["grounding_verdict"], "grounded")
        self.assertEqual(result_guardrail["source_ref_count"], 2)

    def test_low_score_single_paper_judgment_evidence_still_completes_when_semantically_targeted(
        self,
    ) -> None:
        source = _make_handbook_source(
            doc_id="handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
            title="中央民族大学本科学生国家奖学金评审办法",
            snippet=(
                "在学术研究上取得显著成绩,以第一作者发表的论文被SCI、EI、ISTP、SSCI全文收录,"
                "以第一、二作者出版学术专著(须通过专家鉴定)。"
            ),
            score=0.033333335,
            chunk_id_suffix="national-paper-condition-live-like",
            content_role="eligibility",
            is_answer_bearing=True,
            semantic_role="example_evidence",
            polarity="positive",
            claim_type="condition",
        )
        source = replace(
            source,
            anchor={
                INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                    "answer_role": "example_evidence",
                    "semantic_role": "example_evidence",
                    "evidence_contract_version": "answer_ready_evidence.v3",
                    "parent_unit_id": "handbook:national-scholarship:article-9",
                    "condition_subject": "paper_or_publication",
                    "condition_group_subject": "paper_or_publication",
                    "condition_group_id": "handbook:national-scholarship:article-9:paper_or_publication",
                    "condition_polarity": "positive",
                    "condition_subject_taxonomy_version": "condition_subject.v1",
                    "condition_subject_provenance": "suite-fixture",
                    "polarity": "positive",
                    "claim_type": "condition",
                }
            },
        )

        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
                user_goal="论文能不能算国奖条件",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda query_text, **kwargs: EvidenceBundle(
                query_text=query_text,
                corpus="regulations",
                collection="student_rules",
                sources=(source,),
            ),
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.confidence, "medium")
        self.assertIn("论文", response.answer_text)
        self.assertTrue(response.result.diagnostics.claim_supports)
        self.assertEqual(
            tuple(claim.claim_type for claim in response.result.diagnostics.claim_supports),
            ("eligibility_judgment",),
        )

    def test_completed_response_projects_typed_draft_support_into_claim_evidence_graph(
        self,
    ) -> None:
        source = _make_handbook_source(
            doc_id="handbook:demerit-relief",
            title="中央民族大学解除学生纪律处分实施办法",
            snippet="学生受处分满考察期后，可以提交解除处分申请表，经学院审核后报学生处。",
            score=0.86,
            chunk_id_suffix="discipline-procedure",
            content_role="procedure",
            is_answer_bearing=True,
            semantic_role="procedure_step",
            polarity="positive",
            action_type="lift_discipline",
            claim_type="procedure",
        )
        source = replace(
            source,
            anchor={
                INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                    "answer_role": "procedure_step",
                    "evidence_contract_version": "answer_ready_evidence.v3",
                    "parent_unit_id": "handbook:demerit-relief:article-3",
                    "condition_subject": "application_procedure",
                    "condition_group_subject": "application_procedure",
                    "condition_group_id": "handbook:demerit-relief:article-3:application_procedure",
                    "procedure_step_index": 1,
                    "procedure_actor": "student",
                    "procedure_action": "submit_materials",
                    "procedure_materials": ("解除处分申请表",),
                    "procedure_next_actor": "college",
                    "condition_subject_taxonomy_version": "condition_subject.v1",
                    "condition_subject_provenance": "suite-fixture",
                    "procedure_action_taxonomy_version": "procedure_action.v1",
                    "procedure_action_provenance": "suite-fixture",
                    "condition_polarity": "positive",
                    "polarity": "positive",
                    "action_type": "lift_discipline",
                    "claim_type": "procedure",
                }
            },
        )

        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
                user_goal="处分怎么消",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda query, **kwargs: EvidenceBundle(
                query_text=query,
                corpus="regulations",
                collection="student_rules",
                sources=(source,),
            ),
        )

        self.assertEqual(response.status, "completed")
        assert response.result.diagnostics is not None
        self.assertIn(
            "procedure_step",
            tuple(support.claim_type for support in response.result.diagnostics.claim_supports),
        )
        self.assertTrue(response.result.diagnostics.claim_evidence_graph)
        self.assertEqual(
            response.result.diagnostics.claim_evidence_graph[0].support_source_doc_ids,
            (source.doc_id,),
        )
        self.assertEqual(
            response.result.diagnostics.claim_evidence_graph[0].support_chunk_ids,
            (source.chunk_id,),
        )

    def test_target_v3_rejects_legacy_like_procedure_fixture_before_synthesis(self) -> None:
        source = _make_handbook_source(
            doc_id="handbook:demerit-relief",
            title="中央民族大学解除学生纪律处分实施办法",
            snippet="学生提交解除处分申请表，经学院审核后报学生处。",
            score=0.86,
            chunk_id_suffix="discipline-procedure-missing-step-fields",
            content_role="procedure",
            is_answer_bearing=True,
            semantic_role="procedure_step",
            polarity="positive",
            action_type="lift_discipline",
            claim_type="procedure",
        )
        source = replace(
            source,
            anchor={
                INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                    "answer_role": "procedure_step",
                    "evidence_contract_version": "answer_ready_evidence.v3",
                    "parent_unit_id": "handbook:demerit-relief:article-3",
                    "condition_subject": "application_procedure",
                    "condition_group_subject": "application_procedure",
                    "condition_group_id": "handbook:demerit-relief:article-3:application_procedure",
                    "condition_subject_taxonomy_version": "condition_subject.v1",
                    "condition_subject_provenance": "suite-fixture",
                    "condition_polarity": "positive",
                    "polarity": "positive",
                    "action_type": "lift_discipline",
                    "claim_type": "procedure",
                    "procedure_action_taxonomy_version": "procedure_action.v1",
                    "procedure_action_provenance": "suite-fixture",
                }
            },
        )

        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
                user_goal="处分怎么消",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda query, **kwargs: EvidenceBundle(
                query_text=query,
                corpus="regulations",
                collection="student_rules",
                sources=(source,),
            ),
        )

        self.assertEqual(response.status, "error")
        self.assertIsNotNone(response.error)
        assert response.error is not None
        self.assertEqual(response.error.code, "retrieval_failed")
        self.assertIn("answer-ready evidence contract missing", response.error.message)
        self.assertEqual(response.result.evidence.sources, ())
        self.assertEqual(response.capability_observability.tool_outcome, "retrieval_failed")

    def test_completed_response_preserves_time_constraint_claim_support_type(self) -> None:
        source = _make_handbook_source(
            doc_id="handbook:appeal",
            title="中央民族大学学生申诉处理办法",
            snippet="学生应当在收到处理决定之日起10日内提出申诉。",
            score=0.88,
            chunk_id_suffix="appeal-deadline-claim-support",
            content_role="deadline",
            is_answer_bearing=True,
        )
        source = replace(
            source,
            anchor={
                INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                    "answer_role": "time_constraint",
                    "evidence_contract_version": "answer_ready_evidence.v3",
                    "parent_unit_id": "handbook:appeal:article-5",
                    "condition_subject": "deadline",
                    "condition_group_subject": "deadline",
                    "condition_group_id": "handbook:appeal:article-5:deadline",
                    "condition_polarity": "positive",
                    "condition_subject_taxonomy_version": "condition_subject.v1",
                    "condition_subject_provenance": "suite-fixture",
                }
            },
        )

        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
                user_goal="申诉有时间限制吗",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda query, **kwargs: EvidenceBundle(
                query_text=query,
                corpus="regulations",
                collection="student_rules",
                sources=(source,),
            ),
        )

        self.assertEqual(response.status, "completed")
        assert response.result.diagnostics is not None
        self.assertIn(
            "time_constraint",
            tuple(support.claim_type for support in response.result.diagnostics.claim_supports),
        )

    def test_completed_response_keeps_institutional_material_requirement_answer_grounded(
        self,
    ) -> None:
        source = _make_handbook_source(
            doc_id="official_web_regulation:e350a6f1f7c0fdb2",
            title="校园一卡通管理规定",
            snippet=(
                "第17条 校园卡补卡：因丢失、损坏等原因需要重新办卡，必须携带本人证件"
                "（工作证、学生证及其他有效证件）到卡务中心申请补办，同时交纳卡片工本费。"
            ),
            score=0.91,
            chunk_id_suffix="institutional-card-material-claim-support",
            content_role="requirement",
            is_answer_bearing=True,
        )
        source = replace(
            source,
            collection="institutional_rules",
            anchor={
                INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                    "answer_role": "material_requirement",
                    "evidence_contract_version": "answer_ready_evidence.v3",
                    "parent_unit_id": "institutional:card:article-17",
                    "condition_subject": "material_requirement",
                    "condition_group_subject": "material_requirement",
                    "condition_group_id": "institutional:card:article-17:material_requirement",
                    "condition_polarity": "positive",
                    "condition_subject_taxonomy_version": "condition_subject.v1",
                    "condition_subject_provenance": "suite-fixture",
                }
            },
        )

        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
                user_goal="校园卡补卡要带什么材料",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="institutional_rules")
                ),
            ),
            retriever=lambda query, **kwargs: EvidenceBundle(
                query_text=query,
                corpus="regulations",
                collection="institutional_rules",
                sources=(source,),
            ),
        )

        self.assertEqual(response.status, "completed")
        assert response.result.diagnostics is not None
        self.assertEqual(response.result.diagnostics.grounding_verdict, "grounded")
        self.assertEqual(response.result.diagnostics.semantic_outcome, "grounded_answer")
        self.assertEqual(
            tuple(support.claim_type for support in response.result.diagnostics.claim_supports),
            ("material_requirement",),
        )

    def test_completed_response_keeps_institutional_time_constraint_answer_grounded(self) -> None:
        source = _make_handbook_source(
            doc_id="official_web_regulation:ce565b348ca6ee31",
            title="中央民族大学二级网站建设与运行管理办法",
            snippet=(
                "第十一条 各单位需建立二级网站应急保障机制，指派专人负责网站安全管理；"
                "随时检查网页，发现受到攻击等安全问题必须在第一时间进行处理并上报。"
            ),
            score=0.91,
            chunk_id_suffix="institutional-website-deadline-claim-support",
            content_role="time_rule",
            is_answer_bearing=True,
        )
        source = replace(
            source,
            collection="institutional_rules",
            anchor={
                INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                    "answer_role": "time_constraint",
                    "evidence_contract_version": "answer_ready_evidence.v3",
                    "parent_unit_id": "institutional:website:article-11",
                    "condition_subject": "deadline",
                    "condition_group_subject": "deadline",
                    "condition_group_id": "institutional:website:article-11:deadline",
                    "condition_polarity": "positive",
                    "condition_subject_taxonomy_version": "condition_subject.v1",
                    "condition_subject_provenance": "suite-fixture",
                }
            },
        )

        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
                user_goal="二级网站安全问题要多久上报",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="institutional_rules")
                ),
            ),
            retriever=lambda query, **kwargs: EvidenceBundle(
                query_text=query,
                corpus="regulations",
                collection="institutional_rules",
                sources=(source,),
            ),
        )

        self.assertEqual(response.status, "completed")
        assert response.result.diagnostics is not None
        self.assertEqual(response.result.diagnostics.grounding_verdict, "grounded")
        self.assertEqual(response.result.diagnostics.semantic_outcome, "grounded_answer")
        self.assertEqual(
            tuple(support.claim_type for support in response.result.diagnostics.claim_supports),
            ("time_constraint",),
        )

    def test_institutional_no_hit_response_uses_institutional_scope_text(self) -> None:
        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
                user_goal="中央民族大学星际通勤飞船管理办法",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="institutional_rules")
                ),
            ),
            retriever=lambda query, **kwargs: EvidenceBundle(
                query_text=query,
                corpus="regulations",
                collection="institutional_rules",
                sources=(),
            ),
        )

        self.assertEqual(response.status, "no_answer")
        self.assertIn("校级制度问题", response.answer_text)
        self.assertNotIn("学生手册问题", response.answer_text)

    def test_completed_response_preserves_table_fact_claim_support_type(self) -> None:
        source = _make_handbook_source(
            doc_id="handbook:professional-scholarship",
            title="中央民族大学本科学生专业奖学金评定办法",
            snippet="一等奖 | 3000元 | 10人",
            score=0.89,
            chunk_id_suffix="professional-scholarship-table-fact-claim-support",
            content_role="table_fact",
            is_answer_bearing=True,
        )
        source = replace(
            source,
            anchor={
                INTERNAL_EVIDENCE_ATTRIBUTES_ANCHOR_KEY: {
                    "answer_role": "table_fact",
                    "evidence_contract_version": "answer_ready_evidence.v3",
                    "parent_unit_id": "handbook:professional-scholarship:table-1",
                    "condition_subject": "amount_or_quota",
                    "condition_group_subject": "amount_or_quota",
                    "condition_group_id": "handbook:professional-scholarship:table:amount_or_quota",
                    "condition_polarity": "positive",
                    "condition_subject_taxonomy_version": "condition_subject.v1",
                    "condition_subject_provenance": "suite-fixture",
                }
            },
        )

        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
                user_goal="专业奖学金一等奖金额是多少？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda query, **kwargs: EvidenceBundle(
                query_text=query,
                corpus="regulations",
                collection="student_rules",
                sources=(source,),
            ),
        )

        self.assertEqual(response.status, "completed")
        assert response.result.diagnostics is not None
        self.assertIn(
            "table_fact",
            tuple(support.claim_type for support in response.result.diagnostics.claim_supports),
        )


if __name__ == "__main__":
    unittest.main()
