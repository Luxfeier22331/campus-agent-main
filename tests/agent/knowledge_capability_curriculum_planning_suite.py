from __future__ import annotations

from tests.agent.knowledge_capability_test_support import (
    CapabilityRequest,
    EvidenceBundle,
    KnowledgeScope,
    RagRequestPayload,
    _make_evidence,
    _resolved_scope_diagnostics,
    delegate_to_knowledge_capability,
    plan_curriculum_course_query,
    plan_curriculum_program_family_query,
    plan_curriculum_query,
    unittest,
)


class KnowledgeCapabilityCurriculumPlanningTest(unittest.TestCase):
    def test_plan_curriculum_course_query_resolves_short_family_alias(self) -> None:
        plan = plan_curriculum_course_query("思政有哪些专业要上")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(plan.entity_type, "course_family")
        self.assertEqual(
            plan.canonical_course_family_id,
            "course_family:muc.ideological_political_theory",
        )

    def test_plan_curriculum_course_query_resolves_family_alias_variant(self) -> None:
        plan = plan_curriculum_course_query("思政课程包括哪些课")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(plan.entity_type, "course_family")
        self.assertEqual(
            plan.canonical_course_family_id,
            "course_family:muc.ideological_political_theory",
        )

    def test_plan_curriculum_course_query_marks_schedule_partial_answer_for_unsupported_offering_unit(
        self,
    ) -> None:
        plan = plan_curriculum_course_query("思政课哪个学院开，第几学期开")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(plan.entity_type, "course_family")
        self.assertEqual(plan.fact_intent, "schedule")
        self.assertEqual(plan.unsupported_fields, ("offering_unit",))
        self.assertTrue(plan.partial_answer)

    def test_plan_curriculum_course_query_resolves_short_family_schedule_alias_variant(
        self,
    ) -> None:
        plan = plan_curriculum_course_query("思政第几学期开")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(plan.entity_type, "course_family")
        self.assertEqual(plan.fact_intent, "schedule")
        self.assertEqual(
            plan.canonical_course_family_id,
            "course_family:muc.ideological_political_theory",
        )

    def test_plan_curriculum_course_query_resolves_family_schedule_alias_variant(self) -> None:
        plan = plan_curriculum_course_query("思政课程第几学期开")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(plan.entity_type, "course_family")
        self.assertEqual(plan.fact_intent, "schedule")
        self.assertEqual(
            plan.canonical_course_family_id,
            "course_family:muc.ideological_political_theory",
        )

    def test_plan_curriculum_course_query_resolves_sixiuke_schedule_alias(self) -> None:
        plan = plan_curriculum_course_query("思修课第几学期开")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(plan.entity_type, "course_family")
        self.assertEqual(plan.fact_intent, "schedule")
        self.assertEqual(
            plan.canonical_course_family_id,
            "course_family:muc.ideological_political_theory",
        )

    def test_plan_curriculum_course_query_resolves_single_course_schedule_alias_variant(
        self,
    ) -> None:
        plan = plan_curriculum_course_query("习概开设学期")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_single")
        self.assertEqual(plan.entity_type, "course")
        self.assertEqual(plan.fact_intent, "schedule")
        self.assertEqual(plan.canonical_course_id, "course:muc.xigai")

    def test_plan_curriculum_program_family_query_resolves_innovation_experimental_alias(
        self,
    ) -> None:
        plan = plan_curriculum_program_family_query("创新实验班有哪些")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(
            plan.canonical_program_family_id,
            "program_family:muc.innovation_class_generic",
        )

    def test_plan_curriculum_program_family_query_resolves_ethnic_experimental_membership_alias(
        self,
    ) -> None:
        plan = plan_curriculum_program_family_query("民族实验班有哪些")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(
            plan.canonical_program_family_id,
            "program_family:muc.ethnic_experimental_class",
        )

    def test_plan_curriculum_program_family_query_resolves_strong_base_alias(self) -> None:
        plan = plan_curriculum_program_family_query("强基有哪些专业")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(
            plan.canonical_program_family_id,
            "program_family:muc.strong_base_plan",
        )

    def test_plan_curriculum_program_family_query_resolves_full_strong_base_alias(self) -> None:
        plan = plan_curriculum_program_family_query("强基计划有哪些专业")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(
            plan.canonical_program_family_id,
            "program_family:muc.strong_base_plan",
        )

    def test_plan_curriculum_program_family_query_resolves_second_degree_alias(self) -> None:
        plan = plan_curriculum_program_family_query("二学位有哪些专业")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(
            plan.canonical_program_family_id,
            "program_family:muc.second_bachelor_degree",
        )

    def test_plan_curriculum_program_family_query_resolves_second_degree_alias_variant(
        self,
    ) -> None:
        plan = plan_curriculum_program_family_query("第二学位有哪些专业")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(
            plan.canonical_program_family_id,
            "program_family:muc.second_bachelor_degree",
        )

    def test_plan_curriculum_program_family_query_resolves_full_second_degree_alias(self) -> None:
        plan = plan_curriculum_program_family_query("第二学士学位有哪些专业")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(
            plan.canonical_program_family_id,
            "program_family:muc.second_bachelor_degree",
        )

    def test_plan_curriculum_program_family_query_resolves_experimental_name_pattern_query(
        self,
    ) -> None:
        plan = plan_curriculum_program_family_query("名称里带实验班的培养方案有哪些")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(
            plan.canonical_program_family_id,
            "program_family:muc.experimental_class_generic",
        )

    def test_plan_curriculum_program_family_query_resolves_innovation_name_pattern_query(
        self,
    ) -> None:
        plan = plan_curriculum_program_family_query("名称里带创新班的培养方案有哪些")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(
            plan.canonical_program_family_id,
            "program_family:muc.innovation_class_generic",
        )

    def test_plan_curriculum_query_clarifies_generic_base_class_even_with_verified_major(
        self,
    ) -> None:
        plan = plan_curriculum_query(
            "基地班",
            verified_major="历史学",
        )

        self.assertEqual(plan.status, "needs_clarification")
        self.assertEqual(plan.target_document_ids, ())
        self.assertEqual(
            plan.preferred_document_ids, ("curriculum:历史学（强基计划）本科人才培养方案",)
        )

    def test_plan_curriculum_query_uses_verified_major_for_deictic_query_soft_preference(
        self,
    ) -> None:
        plan = plan_curriculum_query(
            "我这个专业的基地班大二下有什么课",
            verified_major="历史学",
        )

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(
            plan.target_document_ids,
            ("curriculum:历史学（强基计划）本科人才培养方案",),
        )
        self.assertEqual(plan.preferred_document_ids, ())
        self.assertIn("历史学（强基计划）本科人才培养方案", plan.rewritten_query_text)

    def test_plan_curriculum_query_marks_course_map_queries_as_unsupported(self) -> None:
        plan = plan_curriculum_query("经济学拔尖人才创新班人才培养方案课程地图怎么安排？")

        self.assertEqual(plan.status, "unsupported")
        self.assertEqual(plan.unsupported_reason, "curriculum_course_map_unsupported")
        self.assertEqual(
            plan.target_document_ids,
            ("curriculum:经济学拔尖人才创新班人才培养方案",),
        )
        self.assertEqual(plan.resolved_document_title, "经济学拔尖人才创新班人才培养方案")

    def test_plan_curriculum_query_treats_course_teaching_plan_title_as_document_lookup(
        self,
    ) -> None:
        query_title = "中央民族大学通识课程中华文化课程教学计划"
        canonical_title = "中央民族大学通识课程“中华文化”课程教学计划"
        plan = plan_curriculum_query(query_title)

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(plan.intent_kind, "generic")
        self.assertEqual(plan.target_document_ids, (f"curriculum:{canonical_title}",))
        self.assertEqual(plan.retrieval_intent.kind, "curriculum_document_lookup")
        self.assertEqual(plan.retrieval_intent.expected.answer_kind, "curriculum_document")

    def test_plan_curriculum_query_resolves_short_course_teaching_plan_before_major_plan(
        self,
    ) -> None:
        canonical_title = "中央民族大学通识课程“大学英语”课程教学计划"

        plan = plan_curriculum_query("大学英语课程教学计划一共多少学分")

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(plan.target_document_ids, (f"curriculum:{canonical_title}",))
        self.assertEqual(plan.resolved_document_title, canonical_title)
        self.assertEqual(plan.retrieval_intent.kind, "curriculum_fact_lookup")

    def test_plan_curriculum_query_resolves_parenthesized_language_track_title(
        self,
    ) -> None:
        plan = plan_curriculum_query("俄语中亚语本科人才培养方案")

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(
            plan.target_document_ids,
            ("curriculum:俄语（俄语、中亚语）本科人才培养方案",),
        )
        self.assertEqual(plan.retrieval_intent.kind, "curriculum_document_lookup")

    def test_plan_curriculum_query_prefers_specific_strong_base_family_over_plain_major(
        self,
    ) -> None:
        plan = plan_curriculum_query("中国少数民族语言文学强基计划本科人才培养方案")

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(
            plan.target_document_ids,
            ("curriculum:中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",),
        )
        self.assertEqual(plan.retrieval_intent.kind, "curriculum_document_lookup")

    def test_delegate_to_knowledge_capability_fail_closes_course_map_queries_without_retrieval(self) -> None:
        retriever_called = False

        def fake_retriever(*args: object, **kwargs: object) -> EvidenceBundle:
            nonlocal retriever_called
            retriever_called = True
            return _make_evidence(query_text="经济学拔尖人才创新班人才培养方案课程地图怎么安排？")

        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
                user_goal="经济学拔尖人才创新班人才培养方案课程地图怎么安排？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "no_answer")
        self.assertFalse(retriever_called)
        self.assertIn("课程地图", response.answer_text)
        self.assertIn("不能稳定解析", response.answer_text)
        diagnostics = response.result.diagnostics
        expected = _resolved_scope_diagnostics(
            corpus="curriculum",
            collection="curriculum_plan",
            resolved_policy_document_id="curriculum:经济学拔尖人才创新班人才培养方案",
            no_answer_reason="curriculum_course_map_unsupported",
            semantic_outcome="unsupported_scope",
            retrieval_adequacy_verdict="insufficient",
            retrieval_adequacy_reason="unsupported_query_type",
            candidate_title_summary=("经济学拔尖人才创新班人才培养方案",),
            resolution_mode="unsupported",
        )
        self.assertEqual(diagnostics.resolved_scope_corpus, expected.resolved_scope_corpus)
        self.assertEqual(
            diagnostics.resolved_scope_collection,
            expected.resolved_scope_collection,
        )
        self.assertEqual(
            diagnostics.resolved_policy_document_id,
            expected.resolved_policy_document_id,
        )
        self.assertEqual(diagnostics.no_answer_reason, expected.no_answer_reason)
        self.assertEqual(diagnostics.semantic_outcome, expected.semantic_outcome)
        self.assertEqual(
            diagnostics.retrieval_adequacy_verdict,
            expected.retrieval_adequacy_verdict,
        )
        self.assertEqual(
            diagnostics.retrieval_adequacy_reason,
            expected.retrieval_adequacy_reason,
        )
        self.assertEqual(
            diagnostics.candidate_title_summary,
            expected.candidate_title_summary,
        )
        self.assertEqual(diagnostics.resolution_mode, expected.resolution_mode)
        self.assertTrue(diagnostics.stage_activities)
