# ruff: noqa: F403,F405
from __future__ import annotations

import unittest

from tests.agent.rag_agent_request_prompt_grounding_suite_support import *


class RagAgentRequestPromptGroundingTestPart02(unittest.TestCase):
    def test_validate_prompt_answer_grounding_accepts_stable_reference_historical_years(
        self,
    ) -> None:
        evidence = _make_official_web_evidence(
            query_text="中央民族大学学校简介",
            collection="stable_reference",
            sources=(
                _make_official_web_source(
                    doc_id="official_web:muc_public:article_detail:school-profile",
                    title="学校简介",
                    snippet=(
                        "学校前身是中国共产党1941年9月在延安创办的延安民族学院。"
                        "1978年确立为国家重点大学。1993年更名为中央民族大学。"
                    ),
                    score=0.94,
                    chunk_id_suffix="school-profile-0001",
                    collection="stable_reference",
                    is_answer_bearing=True,
                ),
            ),
        )

        result = validate_prompt_answer_grounding(
            answer_text=(
                "中央民族大学前身是1941年9月在延安创办的延安民族学院，"
                "1978年确立为国家重点大学，1993年更名为中央民族大学。"
            ),
            evidence=evidence,
        )

        self.assertEqual(result.verdict, "grounded")
        self.assertNotIn("time_claims", result.unsupported_fields)
        time_claims = [
            claim for claim in result.claim_supports if claim.claim_type == "time_or_deadline"
        ]
        self.assertGreaterEqual(len(time_claims), 3)
        self.assertTrue(all(claim.supported for claim in time_claims))

    def test_validate_prompt_answer_grounding_does_not_treat_school_profile_mission_as_offering_unit(
        self,
    ) -> None:
        evidence = _make_official_web_evidence(
            query_text="中央民族大学学校简介",
            collection="stable_reference",
            sources=(
                _make_official_web_source(
                    doc_id="official_web:muc_public:article_detail:school-profile",
                    title="学校简介",
                    snippet=(
                        "中央民族大学是党和国家为解决民族问题、培养各民族干部和高级专门人才、"
                        "促进中华民族大团结而创建的一所特色鲜明的高等院校。"
                        "学校前身是中国共产党1941年9月在延安创办的延安民族学院。"
                    ),
                    score=0.94,
                    chunk_id_suffix="school-profile-0001",
                    collection="stable_reference",
                    is_answer_bearing=True,
                ),
            ),
        )

        result = validate_prompt_answer_grounding(
            answer_text=(
                "中央民族大学是为解决民族问题、培养各民族干部和高级专门人才、"
                "促进中华民族大团结而创建的一所高等院校。"
                "学校前身是1941年9月在延安创办的延安民族学院。"
            ),
            evidence=evidence,
        )

        self.assertEqual(result.verdict, "grounded")
        self.assertNotIn("offering_unit_claims", result.unsupported_fields)
        self.assertFalse(
            any(
                claim.claim_type == "offering_unit_or_owning_school"
                for claim in result.claim_supports
            )
        )

    def test_validate_prompt_answer_grounding_still_checks_true_offering_unit_claims(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="思想政治理论课由哪个学院开设？",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _make_curriculum_plan_source(
                    doc_id="curriculum:ideological-course-plan",
                    chunk_id="curriculum:ideological-course-plan:chunk-0001",
                    snippet="思想政治理论课由马克思主义学院开设。",
                    score=0.94,
                    source_title="思想政治理论课教学计划",
                    is_answer_bearing=True,
                ),
            ),
        )

        result = validate_prompt_answer_grounding(
            answer_text="思想政治理论课由马克思主义学院开设。",
            evidence=evidence,
        )

        self.assertEqual(result.verdict, "grounded")
        self.assertIn(
            ClaimSupport(
                claim_type="offering_unit_or_owning_school",
                claim_text="马克思主义学院",
                supported=True,
                support_source_doc_id="curriculum:ideological-course-plan",
                support_snippet="思想政治理论课由马克思主义学院开设。",
                required_source_trust_tier="T0",
                support_source_trust_tier="T0",
            ),
            result.claim_supports,
        )

    def test_validate_prompt_answer_grounding_projects_t0_curriculum_support_tiers(self) -> None:
        evidence = EvidenceBundle(
            query_text="法学民族班大二下有什么课",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _make_curriculum_plan_source(
                    doc_id="curriculum:law-ethnic-experimental",
                    chunk_id="curriculum:law-ethnic-experimental:chunk-0001",
                    snippet="第四学期开设习近平新时代中国特色社会主义思想概论。",
                    score=0.94,
                    source_title="法学（民族实验班）本科人才培养方案",
                    is_answer_bearing=True,
                ),
            ),
        )

        result = validate_prompt_answer_grounding(
            answer_text="培养方案把这门课安排在第四学期。",
            evidence=evidence,
        )

        self.assertEqual(result.verdict, "grounded")
        semester_claim = next(
            claim
            for claim in result.claim_supports
            if claim.claim_type == "semester_or_grade_or_term_placement"
        )
        self.assertTrue(semester_claim.supported)
        self.assertEqual(semester_claim.required_source_trust_tier, "T0")
        self.assertEqual(semester_claim.support_source_trust_tier, "T0")
        self.assertEqual(
            result.source_trust_summary,
            SourceTrustSummary(
                observed_tiers=("T0",),
                answer_bearing_tiers=("T0",),
                blocked_claim_types=(),
                freshness_claim_blocked=False,
                authorization_claim_blocked=False,
            ),
        )

    def test_validate_prompt_answer_grounding_allows_t1_policy_quantity_claims(self) -> None:
        evidence = EvidenceBundle(
            query_text="学生证注册多久办一次？",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id="handbook:student-card",
                    title="中央民族大学本科(预科)学生证管理办法",
                    snippet="学生证每学期注册一次，未按期办理注册手续的按学籍管理规定处理。",
                    score=0.94,
                    chunk_id_suffix="student-card-quantity-0001",
                    detail_label="注册要求",
                    content_role="procedure",
                    is_answer_bearing=True,
                ),
            ),
        )

        result = validate_prompt_answer_grounding(
            answer_text="学生证每学期注册一次。",
            evidence=evidence,
        )

        self.assertEqual(result.verdict, "grounded")
        quantity_claim = next(
            claim
            for claim in result.claim_supports
            if claim.claim_type == "quantity_or_credit_or_score_requirement"
        )
        self.assertTrue(quantity_claim.supported)
        self.assertEqual(quantity_claim.support_source_trust_tier, "T1")

    def test_validate_prompt_answer_grounding_accepts_numeric_unit_spacing_variants(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="民族学本科人才培养方案总学分要求是多少？",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _make_curriculum_plan_source(
                    doc_id="curriculum:民族学本科人才培养方案",
                    chunk_id="curriculum:民族学本科人才培养方案:chunk-0005",
                    source_title="民族学本科人才培养方案",
                    snippet="三、学制、总学分和学位授予 总学分:159 学分",
                    score=0.93,
                    is_answer_bearing=True,
                ),
            ),
        )

        result = validate_prompt_answer_grounding(
            answer_text="《民族学本科人才培养方案》总学分为159学分。",
            evidence=evidence,
        )

        self.assertEqual(result.verdict, "grounded")
        quantity_claim = next(
            claim
            for claim in result.claim_supports
            if claim.claim_type == "quantity_or_credit_or_score_requirement"
        )
        self.assertTrue(quantity_claim.supported)
        self.assertEqual(quantity_claim.support_source_trust_tier, "T0")

    def test_validate_prompt_answer_grounding_accepts_chinese_arabic_year_unit_variants(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="民族学本科第二学士学位人才培养方案学制几年？",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _make_curriculum_plan_source(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    chunk_id="curriculum:民族学本科第二学士学位人才培养方案:chunk-0005",
                    source_title="民族学本科第二学士学位人才培养方案",
                    snippet="三、学制、总学分和学位授予 学制:2年 总学分:60学分。",
                    score=0.93,
                    is_answer_bearing=True,
                ),
            ),
        )

        result = validate_prompt_answer_grounding(
            answer_text="《民族学本科第二学士学位人才培养方案》学制为两年。",
            evidence=evidence,
        )

        self.assertEqual(result.verdict, "grounded")
        time_claim = next(
            claim for claim in result.claim_supports if claim.claim_type == "time_or_deadline"
        )
        self.assertTrue(time_claim.supported)
        self.assertEqual(time_claim.support_source_trust_tier, "T0")

    def test_validate_prompt_answer_grounding_accepts_total_credit_table_unit(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="民族学本科人才培养方案总学分要求是多少？",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _make_curriculum_plan_source(
                    doc_id="curriculum:民族学本科人才培养方案",
                    chunk_id="curriculum:民族学本科人才培养方案:chunk-0007",
                    source_title="民族学本科人才培养方案",
                    snippet=(
                        "四、各教学环节学时学分\n\n"
                        "培养阶段 | 板块名称 | 类别 | 学分设置\n"
                        "总学分 | — | — | 159"
                    ),
                    score=0.93,
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
            ),
        )

        result = validate_prompt_answer_grounding(
            answer_text="《民族学本科人才培养方案》总学分为159学分。",
            evidence=evidence,
        )

        self.assertEqual(result.verdict, "grounded")
        quantity_claim = next(
            claim
            for claim in result.claim_supports
            if claim.claim_type == "quantity_or_credit_or_score_requirement"
        )
        self.assertTrue(quantity_claim.supported)

    def test_prompt_answer_with_unsupported_offering_unit_and_audience_downgrades_to_no_answer(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="思想政治理论课有哪些要求",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id="handbook:ideological-course-plan",
                    title="中央民族大学通识课程思想政治理论课教学计划",
                    snippet="思想政治理论课为全校性公共必修课，所有本预科学生应认真完成上述7门课程设置的各教学环节。",
                    score=0.92,
                    chunk_id_suffix="ideological-course-plan-0101",
                    detail_label="修读要求",
                    content_role="audience",
                    is_answer_bearing=True,
                ),
            ),
        )

        class FakePromptExecutor:
            def compose_answer(
                self, packet: object
            ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
                return RagPromptExecutionResult(
                    output=RagAnswerPromptOutput(
                        answer_text="根据教学计划，这门课由马克思主义学院开设，法学专业和历史学专业要上，安排在第四学期，共3学分。"
                    ),
                    prompt_trace=_rag_prompt_trace("rag_answer_v1"),
                )

            def compose_no_answer(
                self, packet: object
            ) -> RagPromptExecutionResult[RagAnswerPromptOutput]:
                return RagPromptExecutionResult(
                    output=RagAnswerPromptOutput(
                        answer_text="当前检索结果不足以支持开课单位和适用专业，请以原文为准。"
                    ),
                    prompt_trace=_rag_prompt_trace("rag_unsupported_v1"),
                )

            def compose_clarify(
                self, packet: object
            ) -> RagPromptExecutionResult[RagClarifyPromptOutput]:
                raise AssertionError("clarify prompt should not be used")

        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="思想政治理论课有哪些要求",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
            prompt_executor=FakePromptExecutor(),
        )

        self.assertEqual(response.status, "no_answer")
        self.assertEqual(
            response.answer_text, "当前检索结果不足以支持开课单位和适用专业，请以原文为准。"
        )
        self.assertEqual(response.result.diagnostics.semantic_outcome, "unsupported_by_evidence")
        self.assertEqual(response.result.diagnostics.grounding_verdict, "unsupported")
        self.assertTrue(response.result.diagnostics.grounding_downgraded)
        self.assertIn("offering_unit_claims", response.result.diagnostics.unsupported_fields)
        self.assertIn("audience_claims", response.result.diagnostics.unsupported_fields)
        self.assertIn(
            "semester_or_grade_or_term_placement_claims",
            response.result.diagnostics.unsupported_fields,
        )
        self.assertIn(
            "quantity_or_credit_or_score_requirement_claims",
            response.result.diagnostics.unsupported_fields,
        )
        self.assertIn(
            ClaimSupport(
                claim_type="semester_or_grade_or_term_placement",
                claim_text="第四学期",
                supported=False,
                support_source_doc_id="",
                support_snippet="",
            ),
            response.result.diagnostics.claim_supports,
        )
        self.assertIn(
            ClaimSupport(
                claim_type="quantity_or_credit_or_score_requirement",
                claim_text="3学分",
                supported=False,
                support_source_doc_id="",
                support_snippet="",
            ),
            response.result.diagnostics.claim_supports,
        )
        self.assertEqual(response.result.diagnostics.prompt_trace.prompt_id, "rag_unsupported_v1")


if __name__ == "__main__":
    unittest.main()
