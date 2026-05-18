from __future__ import annotations

import unittest
from dataclasses import replace

from campus_contracts import EvidenceBundle
from campus_rag_agent import RagAgent
from campus_rag_agent.agent_answer_shape import AnswerShape
from campus_rag_agent.query_planning import plan_curriculum_query
from campus_rag_agent.typed_answer_drafts import validate_typed_answer_draft

from tests.agent.rag_agent_answer_quality_regression_suite_support import (
    _answer_ready_anchor,
    _make_policy_source,
)
from tests.agent.rag_agent_test_support import (
    _make_curriculum_plan_source,
    _make_official_web_source,
)


class RagAgentShortAnswerContractSuite(unittest.TestCase):
    def test_student_rules_title_lookup_uses_document_identity_presentation(self) -> None:
        title = "中央民族大学本科学生国家奖学金评审办法"
        evidence = EvidenceBundle(
            query_text=title,
            corpus="regulations",
            collection="student_rules",
            sources=(
                replace(
                    _make_policy_source(
                        doc_id="handbook:national-scholarship",
                        title=title,
                        snippet=(
                            "标题：中央民族大学本科学生国家奖学金评审办法 | 章节：第一章 总则 "
                            "第一条 为奖励特别优秀的全日制本科学生，设立国家奖学金。"
                        ),
                        score=0.96,
                        chunk="national-scholarship-article-1",
                    ),
                    content_role="requirement",
                    is_answer_bearing=True,
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        semantic_role="eligibility_condition",
                        claim_type="condition",
                        condition_subject="generic_condition",
                        condition_polarity="positive",
                    ),
                ),
                replace(
                    _make_policy_source(
                        doc_id="handbook:national-scholarship",
                        title=title,
                        snippet=(
                            "标题：中央民族大学本科学生国家奖学金评审办法 | 章节：第三章 评审条件 "
                            "第九条 学习成绩排名与综合考评成绩排名均位于前10%。"
                        ),
                        score=0.93,
                        chunk="national-scholarship-article-9",
                    ),
                    content_role="requirement",
                    is_answer_bearing=True,
                    anchor=_answer_ready_anchor(
                        answer_role="eligibility_condition",
                        semantic_role="eligibility_condition",
                        claim_type="condition",
                        condition_subject="rank_threshold",
                        condition_polarity="positive",
                    ),
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn("《中央民族大学本科学生国家奖学金评审办法》", draft.answer_text)
        self.assertNotIn("特别优秀的全日制本科学生", draft.answer_text)
        self.assertNotIn("前10", draft.answer_text)
        self.assertEqual(len(draft.supporting_sources), 1)
        self.assertEqual(draft.presentation_kind, "document_identity")
        self.assertEqual(draft.presentation_path, "")
        self.assertEqual(draft.diagnostic_reason, "")
        self.assertIsNotNone(draft.typed_draft.presentation)
        self.assertEqual(draft.typed_draft.presentation.kind.value, "document_identity")
        self.assertEqual(validate_typed_answer_draft(draft.typed_draft).verdict, "valid")

    def test_institutional_governing_document_query_uses_document_identity_presentation(
        self,
    ) -> None:
        title = "中央民族大学研究生“三助”工作管理办法"
        evidence = EvidenceBundle(
            query_text="研究生助教助研助管工作应该依据哪份管理办法？",
            corpus="regulations",
            collection="institutional_rules",
            sources=(
                _make_policy_source(
                    doc_id=(
                        "institutional_regulation:muc:"
                        "中央民族大学研究生-三助-工作管理办法:49319e7c44d3"
                    ),
                    title=title,
                    snippet=(
                        "标题：中央民族大学研究生“三助”工作管理办法 | 章节：第一章 总 则 | "
                        "条款：第三条 第三条 研究生担任助教、助研、助管工作是研究生培养的重要环节。"
                    ),
                    score=0.96,
                    chunk="three-assists-article-3",
                    collection="institutional_rules",
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn("《中央民族大学研究生“三助”工作管理办法》", draft.answer_text)
        self.assertNotIn("研究生培养的重要环节", draft.answer_text)
        self.assertEqual(draft.presentation_kind, "document_identity")
        self.assertEqual(draft.presentation_path, "")
        self.assertEqual(draft.typed_draft.presentation.kind.value, "document_identity")

    def test_curriculum_title_lookup_uses_document_identity_presentation(self) -> None:
        title = "民族学本科人才培养方案"
        evidence = EvidenceBundle(
            query_text=title,
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0001",
                    source_title=title,
                    snippet="民族学本科人才培养方案 一、培养目标 本专业培养具有民族学理论基础和田野调查能力的人才。",
                    score=0.9,
                    is_answer_bearing=True,
                ),
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0005",
                    source_title=title,
                    snippet="三、学制、总学分和学位授予 学制:4年 总学分:159 学分 学位授予:法学学士",
                    score=0.88,
                    content_kind="section_text",
                    is_answer_bearing=True,
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn("《民族学本科人才培养方案》", draft.answer_text)
        self.assertIn("培养目标", draft.answer_text)
        self.assertNotIn("总学分", draft.answer_text)
        self.assertEqual(draft.presentation_kind, "document_identity")
        self.assertEqual(draft.presentation_path, "")
        self.assertEqual(draft.typed_draft.presentation.kind.value, "document_identity")

    def test_curriculum_document_intent_keeps_short_identity_answer(self) -> None:
        title = "民族学本科人才培养方案"
        evidence = EvidenceBundle(
            query_text=title,
            corpus="curriculum",
            collection="curriculum_plan",
            sources=tuple(
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-{index:04d}",
                    source_title=title,
                    snippet=snippet,
                    score=score,
                    is_answer_bearing=True,
                )
                for index, (snippet, score) in enumerate(
                    (
                        (
                            "民族学本科人才培养方案 一、培养目标 本专业培养具有民族学理论基础和田野调查能力的人才。",
                            0.9,
                        ),
                        ("课程体系包括通识教育、学科基础、专业核心和实践教学。", 0.89),
                        ("三、学制、总学分和学位授予 学制:4年 总学分:159 学分。", 0.88),
                    ),
                    start=1,
                )
            ),
        )

        draft = RagAgent().build_answer(
            evidence,
            retrieval_intent=plan_curriculum_query(title).retrieval_intent,
        )

        self.assertTrue(draft.answer_text)
        self.assertIn("《民族学本科人才培养方案》", draft.answer_text)
        self.assertIn("相关培养方案", draft.answer_text)
        self.assertNotIn("本专业培养具有民族学理论基础", draft.answer_text)
        self.assertEqual(draft.presentation_kind, "document_identity")
        self.assertEqual(draft.presentation_path, "")

    def test_curriculum_document_lookup_accepts_title_grounding_without_answer_bearing(
        self,
    ) -> None:
        title = "会计学本科第二学士学位人才培养方案"
        evidence = EvidenceBundle(
            query_text=title,
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0001",
                    source_title=title,
                    snippet=(
                        "会计学本科第二学士学位人才培养方案 一、培养目标 培养适应"
                        "社会主义市场经济需要的会计学人才。"
                    ),
                    score=0.9,
                    is_answer_bearing=False,
                ),
            ),
        )

        draft = RagAgent().build_answer(
            evidence,
            retrieval_intent=plan_curriculum_query(title).retrieval_intent,
        )

        self.assertTrue(draft.answer_text)
        self.assertIn(f"《{title}》", draft.answer_text)
        self.assertEqual(len(draft.supporting_sources), 1)
        self.assertEqual(draft.supporting_sources[0].doc_id, f"curriculum:{title}")
        self.assertEqual(draft.presentation_kind, "document_identity")

    def test_curriculum_paraphrased_document_intent_keeps_brief_identity_answer(self) -> None:
        title = "数字经济本科人才培养方案"
        evidence = EvidenceBundle(
            query_text="想看数字经济这个专业的培养方案",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0001",
                    source_title=title,
                    snippet=(
                        "数字经济本科人才培养方案 一、培养目标 本专业培养熟悉数字经济理论、"
                        "掌握数据分析能力并能服务数字产业发展的人才。"
                    ),
                    score=0.9,
                    is_answer_bearing=True,
                ),
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0005",
                    source_title=title,
                    snippet="三、学制、总学分和学位授予 学制:4年 总学分:157 学分。",
                    score=0.88,
                    is_answer_bearing=True,
                ),
            ),
        )

        draft = RagAgent().build_answer(
            evidence,
            retrieval_intent=plan_curriculum_query(evidence.query_text).retrieval_intent,
        )

        self.assertIn(f"《{title}》", draft.answer_text)
        self.assertIn("可以查看", draft.answer_text)
        self.assertNotIn("相关培养方案为", draft.answer_text)
        self.assertNotIn("掌握数据分析能力", draft.answer_text)
        self.assertNotIn("总学分", draft.answer_text)
        self.assertEqual(draft.presentation_kind, "document_identity")
        self.assertLessEqual(draft.answer_text.count("。"), 1)

    def test_curriculum_document_lookup_does_not_expand_long_training_goal(self) -> None:
        title = "数字经济本科人才培养方案"
        evidence = EvidenceBundle(
            query_text="想看数字经济这个专业的培养方案",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _make_curriculum_plan_source(
                    doc_id=f"curriculum:{title}",
                    chunk_id=f"curriculum:{title}:chunk-0001",
                    source_title=title,
                    snippet=(
                        "数字经济本科人才培养方案\n\n一、培养目标\n\n"
                        "本专业服务于国家战略与民族地区发展，培养政治素质过硬、综合素质优异、"
                        "数字技能高超、经济理论扎实，具备前沿学术研究能力和数字创新创业能力，"
                        "具有积极的世界观、人生观、价值观，具有强烈社会责任感、深厚家国情怀、"
                        "宽广国际视野、良好人文科学素养。"
                    ),
                    score=0.9,
                    is_answer_bearing=True,
                ),
            ),
        )

        draft = RagAgent().build_answer(
            evidence,
            retrieval_intent=plan_curriculum_query(evidence.query_text).retrieval_intent,
        )

        self.assertIn(f"《{title}》", draft.answer_text)
        self.assertIn("可以查看", draft.answer_text)
        self.assertIn("培养方案", draft.answer_text)
        self.assertEqual(draft.presentation_kind, "document_identity")
        self.assertNotIn("服务于国家战略", draft.answer_text)
        self.assertNotIn("数字技能高超", draft.answer_text)

    def test_official_web_title_lookup_skips_title_only_statement_when_content_exists(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="中央民族大学教学和科研单位",
            corpus="official_web",
            collection="stable_reference",
            sources=(
                _make_official_web_source(
                    doc_id="official_web:muc_public:directory_page:b8993ee7004c02e028bc5f6bb166e26ac4eb5afc",
                    title="教学和科研单位",
                    snippet=(
                        "标题：教学和科研单位 | 教学和科研单位 | "
                        "学校设有民族学与社会学学院、中国少数民族语言文学学院、经济学院、"
                        "信息工程学院等教学和科研单位。"
                    ),
                    score=0.9,
                    chunk_id_suffix="teaching-units",
                    content_role="reference_fact",
                    collection="stable_reference",
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn("民族学与社会学学院", draft.answer_text)
        self.assertIn("信息工程学院", draft.answer_text)
        self.assertNotEqual(
            draft.answer_text,
            "根据官网页面内容，《教学和科研单位》明确：教学和科研单位",
        )
        self.assertEqual(draft.presentation_kind, "brief_reference")

    def test_official_web_title_lookup_skips_prefixed_title_line_when_content_exists(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="中央民族大学教学和科研单位",
            corpus="official_web",
            collection="stable_reference",
            sources=(
                _make_official_web_source(
                    doc_id="official_web:muc_public:directory_page:b8993ee7004c02e028bc5f6bb166e26ac4eb5afc",
                    title="教学和科研单位",
                    snippet=(
                        "标题：教学和科研单位\n"
                        "教学和科研单位\n"
                        "学校设有民族学与社会学学院、中国少数民族语言文学学院、经济学院、"
                        "信息工程学院等教学和科研单位。"
                    ),
                    score=0.9,
                    chunk_id_suffix="teaching-units-newlines",
                    content_role="reference_fact",
                    collection="stable_reference",
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn("民族学与社会学学院", draft.answer_text)
        self.assertIn("信息工程学院", draft.answer_text)
        self.assertNotEqual(
            draft.answer_text,
            "根据官网页面内容，《教学和科研单位》明确：教学和科研单位",
        )
        self.assertEqual(draft.presentation_kind, "brief_reference")

    def test_title_lookup_typed_draft_stays_valid_for_document_identity(self) -> None:
        title = "中央民族大学本科学生国家奖学金评审办法"
        evidence = EvidenceBundle(
            query_text=title,
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_policy_source(
                    doc_id="handbook:national-scholarship",
                    title=title,
                    snippet="标题：中央民族大学本科学生国家奖学金评审办法 | 章节：第一章 总则。",
                    score=0.96,
                    chunk="national-scholarship-title",
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertTrue(draft.answer_text)
        self.assertEqual(draft.presentation_kind, "document_identity")
        self.assertEqual(validate_typed_answer_draft(draft.typed_draft).verdict, "valid")

    def test_official_web_title_lookup_uses_brief_reference_presentation(self) -> None:
        evidence = EvidenceBundle(
            query_text="中央民族大学学校简介",
            corpus="official_web",
            collection="stable_reference",
            sources=(
                _make_official_web_source(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    title="学校简介",
                    snippet=(
                        "标题：学校简介 | 章节：学校概况 "
                        "中央民族大学是党和国家为解决民族问题、培养各民族干部和高级专门人才而创建的一所特色鲜明的高等院校。"
                        "学校前身是中国共产党1941年9月在延安创办的延安民族学院。"
                        "2017年和2022年先后入选首轮“双一流”建设A类高校和第二轮“双一流”建设高校。"
                        "学校现有北京海淀、丰台和海南陵水黎安国际教育创新试验区三个校区。"
                    ),
                    score=0.9,
                    chunk_id_suffix="school-profile-long",
                    content_role="primary_content",
                    collection="stable_reference",
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertIn("高等院校", draft.answer_text)
        self.assertIn("延安民族学院", draft.answer_text)
        self.assertNotIn("三个校区", draft.answer_text)
        self.assertEqual(draft.presentation_kind, "brief_reference")
        self.assertEqual(draft.presentation_path, "")
        self.assertEqual(draft.typed_draft.presentation.kind.value, "brief_reference")

    def test_general_summary_presentation_collapses_to_single_short_sentence(self) -> None:
        evidence = EvidenceBundle(
            query_text="图书馆情况",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_policy_source(
                    doc_id="handbook:library-service",
                    title="校园服务说明",
                    snippet="图书馆提供借阅服务，并支持自助查询。",
                    score=0.91,
                    chunk="library-service-1",
                ),
                _make_policy_source(
                    doc_id="handbook:library-service",
                    title="校园服务说明",
                    snippet="图书馆开放安排以馆内通知为准，部分资源支持线上访问。",
                    score=0.89,
                    chunk="library-service-2",
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence, answer_shape=AnswerShape.GENERAL_SUMMARY)

        self.assertIn("图书馆提供借阅服务", draft.answer_text)
        self.assertNotIn("线上访问", draft.answer_text)
        self.assertNotIn("；", draft.answer_text)
        self.assertEqual(draft.presentation_kind, "general_summary")
        self.assertEqual(draft.presentation_path, "")
        self.assertEqual(draft.diagnostic_reason, "")
        self.assertIsNotNone(draft.typed_draft.presentation)
        self.assertEqual(draft.typed_draft.presentation.kind.value, "general_summary")
        self.assertEqual(validate_typed_answer_draft(draft.typed_draft).verdict, "valid")


if __name__ == "__main__":
    unittest.main()
