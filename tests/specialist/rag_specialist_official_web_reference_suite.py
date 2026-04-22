from __future__ import annotations

from tests.specialist.rag_specialist_test_support import (
    KnowledgeScope,
    RagRequestPayload,
    SpecialistRequest,
    _make_official_web_evidence,
    _make_official_web_source,
    delegate_to_rag_agent,
    unittest,
)


class RagSpecialistOfficialWebReferenceTest(unittest.TestCase):
    def test_official_web_stable_reference_reference_page_uses_official_web_answering(self) -> None:
        evidence = _make_official_web_evidence(
            query_text="中央民族大学学校简介",
            collection="stable_reference",
            sources=(
                _make_official_web_source(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    title="学校简介",
                    snippet="标题：学校简介 | 章节：学校概况\n中央民族大学坐落于北京市海淀区，直属国家民委。",
                    score=0.03175403,
                    chunk_id_suffix="school-profile-stable-reference",
                    content_role="primary_content",
                    collection="stable_reference",
                ),
            ),
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="中央民族大学学校简介",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="official_web", collection="stable_reference")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.confidence, "medium")
        self.assertNotIn("学生手册", response.answer_text)
        self.assertNotIn("培养方案", response.answer_text)
        self.assertIn("学校简介", response.answer_text)

    def test_official_web_school_profile_answer_prefers_intro_fact_over_late_background_detail(
        self,
    ) -> None:
        evidence = _make_official_web_evidence(
            query_text="中央民族大学学校简介",
            sources=(
                _make_official_web_source(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    title="学校简介",
                    snippet=(
                        "标题：学校简介 | 章节：学校概况\n"
                        "中央民族大学是党和国家为解决民族问题、培养各民族干部和高级专门人才而创建的一所特色鲜明的高等院校。"
                    ),
                    score=0.03175403,
                    chunk_id_suffix="school-profile-intro",
                    content_role="primary_content",
                ),
                _make_official_web_source(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    title="学校简介",
                    snippet=(
                        "标题：学校简介 | 章节：学校概况\n"
                        "2021年，“中央民族学院开学”先后入选《中国共产党一百年大事记》。"
                    ),
                    score=0.04175403,
                    chunk_id_suffix="school-profile-late",
                    content_role="primary_content",
                ),
            ),
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="中央民族大学学校简介",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="official_web", collection="muc_public_pages")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("特色鲜明的高等院校", response.answer_text)
        self.assertNotIn("中国共产党一百年大事记", response.answer_text)

    def test_official_web_school_profile_answer_compresses_long_reference_page(self) -> None:
        evidence = _make_official_web_evidence(
            query_text="中央民族大学学校简介",
            sources=(
                _make_official_web_source(
                    doc_id="official_web:muc_public:article_detail:e286aba2b39208a26af21e9dd518afc6faa49487",
                    title="学校简介",
                    snippet=(
                        "标题：学校简介 | 章节：学校概况\n"
                        "中央民族大学是党和国家为解决民族问题、培养各民族干部和高级专门人才、促进中华民族大团结而创建的一所特色鲜明的高等院校。"
                        "学校前身是中国共产党1941年9月在延安创办的延安民族学院。"
                        "新中国成立后，经中央人民政府批准于1951年6月在北京成立中央民族学院。"
                        "1978年确立为国家重点大学，1993年更名为中央民族大学，1999年进入国家“211工程”重点建设高校行列，"
                        "2002年成为国家民委、教育部、北京市人民政府重点共建高校，2004年进入国家“985工程”重点建设高校行列，"
                        "2017年和2022年先后入选首轮“双一流”建设A类高校和第二轮“双一流”建设高校。"
                        "学校现有北京海淀、丰台和海南陵水黎安国际教育创新试验区三个校区。\n"
                        "党和国家格外关心和高度重视学校建设发展。"
                    ),
                    score=0.033333335,
                    chunk_id_suffix="school-profile-long",
                    content_role="primary_content",
                ),
            ),
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="中央民族大学学校简介",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="official_web", collection="muc_public_pages")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("延安民族学院", response.answer_text)
        self.assertIn("双一流", response.answer_text)
        self.assertNotIn("1999年进入国家“211工程”重点建设高校行列", response.answer_text)
        self.assertNotIn("党和国家格外关心和高度重视学校建设发展", response.answer_text)

    def test_official_web_school_overview_answer_highlights_campuses_and_disciplines(self) -> None:
        evidence = _make_official_web_evidence(
            query_text="中央民族大学学校概况",
            sources=(
                _make_official_web_source(
                    doc_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85",
                    title="学校概况",
                    snippet=(
                        "标题：学校概况 | 章节：学校简介\n"
                        "中央民族大学是党和国家为解决民族问题、培养各民族干部和高级专门人才、促进中华民族大团结而创建的一所特色鲜明的高等院校。"
                        "学校现有北京海淀、丰台和海南陵水黎安国际教育创新试验区三个校区。"
                        "学校逐步发展成为文学、历史学、哲学、经济学、管理学、法学、理学、工学、医学、教育学、艺术学等多学科门类齐全的综合性大学。"
                        "目前，学校设有1个学部、26个学院，有覆盖12个学科门类的71个本科专业。"
                    ),
                    score=0.033333335,
                    chunk_id_suffix="school-overview",
                    content_role="primary_content",
                ),
            ),
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="中央民族大学学校概况",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="official_web", collection="muc_public_pages")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("三个校区", response.answer_text)
        self.assertIn("12个学科门类", response.answer_text)
        self.assertNotIn("延安民族学院", response.answer_text)
        self.assertNotIn("双一流", response.answer_text)

    def test_official_web_school_overview_answer_uses_complementary_same_doc_chunks(self) -> None:
        evidence = _make_official_web_evidence(
            query_text="中央民族大学学校概况",
            sources=(
                _make_official_web_source(
                    doc_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85",
                    title="学校概况",
                    snippet=(
                        "标题：学校概况 | 章节：学校简介\n"
                        "中央民族大学是党和国家为解决民族问题、培养各民族干部和高级专门人才而创建的一所特色鲜明的高等院校。"
                        "学校现有北京海淀、丰台和海南陵水黎安国际教育创新试验区三个校区。"
                    ),
                    score=0.033333335,
                    chunk_id_suffix="school-overview-campus",
                    content_role="primary_content",
                ),
                _make_official_web_source(
                    doc_id="official_web:muc_public:article_detail:36021906c0348aa73ed1f5467c4cb57954295e85",
                    title="学校概况",
                    snippet=(
                        "标题：学校概况 | 章节：学校简介\n"
                        "学校逐步发展成为多学科门类齐全的综合性大学。"
                        "目前，学校设有1个学部、26个学院，有覆盖12个学科门类的71个本科专业。"
                    ),
                    score=0.031333335,
                    chunk_id_suffix="school-overview-discipline",
                    content_role="primary_content",
                ),
            ),
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="中央民族大学学校概况",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="official_web", collection="muc_public_pages")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("三个校区", response.answer_text)
        self.assertIn("12个学科门类", response.answer_text)

    def test_official_web_undergraduate_training_answer_highlights_program_scale_and_excellence(
        self,
    ) -> None:
        evidence = _make_official_web_evidence(
            query_text="中央民族大学本科培养",
            sources=(
                _make_official_web_source(
                    doc_id="official_web:muc_public:article_detail:dfd33d034080e7df93a707edef7f555a95d78b13",
                    title="本科培养",
                    snippet=(
                        "标题：本科培养\n"
                        "中央民族大学坚持立德树人根本任务，为党育人、为国育才，以铸牢中华民族共同体意识为主线，"
                        "秉承“厚基础、宽视野、重创新”的育人理念，着力为各民族共同走向现代化培养“担当使命、求是创新、包容共美”的强国栋梁。\n"
                        "学校现有本科专业71个，在招专业61个，涵盖11个学科门类。"
                        "3个专业入选国家“强基计划”，一流本科专业占招生专业比例达到84%，覆盖了全校所有学院。"
                    ),
                    score=0.033333335,
                    chunk_id_suffix="undergraduate-education",
                    content_role="primary_content",
                ),
            ),
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="中央民族大学本科培养",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="official_web", collection="muc_public_pages")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("本科专业71个", response.answer_text)
        self.assertIn("3个专业入选国家“强基计划”", response.answer_text)
        self.assertNotIn("担当使命", response.answer_text)
        self.assertNotIn("强国栋梁", response.answer_text)

    def test_official_web_postdoctoral_answer_highlights_station_count_and_assessment(self) -> None:
        evidence = _make_official_web_evidence(
            query_text="中央民族大学博士后",
            sources=(
                _make_official_web_source(
                    doc_id="official_web:muc_public:article_detail:c754a99f576af8d8e67869524e327781dbb2c916",
                    title="博士后",
                    snippet=(
                        "标题：博士后\n"
                        "中央民族大学全面推动“双一流”建设和整体发展，创新工作机制，强化服务保障。\n"
                        "为深化博士后体制机制改革，将博士后研究人员作为学校师资队伍的重要来源，激发博士后学术活力。\n"
                        "学校现有6个博士后科研流动站，分别是民族学、社会学、中国少数民族语言文学、中国史、哲学、教育学流动站。"
                        "在全国博管会组织的历次流动站评估中，我校参评的流动站合格率均为100％，其中民族学流动站获评“优秀博士后流动站”。"
                    ),
                    score=0.033333335,
                    chunk_id_suffix="postdoctoral-program",
                    content_role="primary_content",
                ),
            ),
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="中央民族大学博士后",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="official_web", collection="muc_public_pages")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("6个博士后科研流动站", response.answer_text)
        self.assertIn("合格率均为100％", response.answer_text)
        self.assertNotIn("双一流", response.answer_text)
