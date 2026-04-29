from __future__ import annotations

from tests.agent.rag_agent_test_support import (
    AgentRequest,
    KnowledgeScope,
    RagRequestPayload,
    _make_official_web_evidence,
    _make_official_web_source,
    _select_answer_support_rows,
    delegate_to_rag_agent,
    unittest,
)


class RagAgentOfficialWebPeopleAndNewsTest(unittest.TestCase):
    def test_official_web_graduate_training_answer_highlights_degree_authorizations(self) -> None:
        evidence = _make_official_web_evidence(
            query_text="中央民族大学研究生培养",
            sources=(
                _make_official_web_source(
                    doc_id="official_web:muc_public:article_detail:d043e2b8d29c0023c945a9c5909cb09b1f68d0ca",
                    title="研究生培养",
                    snippet=(
                        "标题：研究生培养\n"
                        "中央民族大学研究生教育始于上世纪50年代北京建校之初，研究生院始终坚持为党育人、为国育才初心使命。\n"
                        "学校研究生教育涵盖哲学、经济学、法学、教育学、文学、历史学、理学、工学、医学、管理学、艺术学、交叉学科12个学科门类。"
                        "现有24个研究生招生培养单位，共有10个博士一级学科授权点，4个博士专业学位授权类别，"
                        "28个硕士一级学科授权点，26个硕士专业学位授权类别。\n"
                        "近年来，获批国家级项目600余项。学校拥有一支高水平、高素质师资队伍，省部级以上人才500多人。"
                    ),
                    score=0.033333335,
                    chunk_id_suffix="graduate-education",
                    content_role="primary_content",
                ),
            ),
        )

        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="中央民族大学研究生培养",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="official_web", collection="muc_public_pages")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("12个学科门类", response.answer_text)
        self.assertIn("24个研究生招生培养单位", response.answer_text)
        self.assertNotIn("600余项", response.answer_text)
        self.assertNotIn("500多人", response.answer_text)

    def test_official_web_scholar_page_answer_summarizes_people_and_domains_instead_of_biography_timelines(
        self,
    ) -> None:
        evidence = _make_official_web_evidence(
            query_text="中央民族大学学术名流",
            sources=(
                _make_official_web_source(
                    doc_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2",
                    title="学术名流",
                    snippet=(
                        "标题：学术名流 | 章节：翦伯赞\n"
                        "1919年于武昌商业专门学校毕业。1949年后历任中央民族学院研究部西南研究室主任、北京大学教授、副校长。"
                        "翦伯赞先生治学严谨，著作宏富。与郭沫若、范文澜等一起筹建中国历史学会，对改造旧史学、创建马克思主义新史学做出了卓越贡献。"
                    ),
                    score=0.033333335,
                    chunk_id_suffix="scholar-jian",
                    content_role="primary_content",
                    anchor={"segment_ord": 1, "section_path": ["学校概况", "学校概况", "翦伯赞"]},
                    structural_path=("学术名流", "翦伯赞"),
                ),
                _make_official_web_source(
                    doc_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2",
                    title="学术名流",
                    snippet=(
                        "标题：学术名流 | 章节：吴泽霖\n"
                        "1913年考入清华学堂。吴泽霖先生将社会学与民族学、人类学等学科联系起来，对社会现象作跨学科研究。"
                        "他还是我国民族学博物馆事业的创始人。"
                    ),
                    score=0.032333335,
                    chunk_id_suffix="scholar-wu",
                    content_role="primary_content",
                    anchor={"segment_ord": 2, "section_path": ["学校概况", "学校概况", "吴泽霖"]},
                    structural_path=("学术名流", "吴泽霖"),
                ),
                _make_official_web_source(
                    doc_id="official_web:muc_public:article_detail:e5f0a4d0916a8a506036f1931a2f5a480e9db3f2",
                    title="学术名流",
                    snippet=(
                        "标题：学术名流 | 章节：费孝通\n"
                        "1933年毕业于燕京大学，1938年获哲学博士学位。费孝通先生在中国社会学和人类学的建设中有突出贡献。"
                        "代表著作有《乡土中国》《江村经济》。"
                    ),
                    score=0.031333335,
                    chunk_id_suffix="scholar-fei",
                    content_role="primary_content",
                    anchor={"segment_ord": 3, "section_path": ["学校概况", "学校概况", "费孝通"]},
                    structural_path=("学术名流", "费孝通"),
                ),
            ),
        )

        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="中央民族大学学术名流",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="official_web", collection="muc_public_pages")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("翦伯赞", response.answer_text)
        self.assertIn("吴泽霖", response.answer_text)
        self.assertIn("费孝通", response.answer_text)
        self.assertIn("历史学", response.answer_text)
        self.assertIn("社会学", response.answer_text)
        self.assertNotIn("1919年", response.answer_text)
        self.assertNotIn("1933年毕业于燕京大学", response.answer_text)
        self.assertNotIn("副校长", response.answer_text)

    def test_official_web_current_leadership_answer_lists_roles_without_biographies(self) -> None:
        evidence = _make_official_web_evidence(
            query_text="中央民族大学现任领导",
            sources=(
                _make_official_web_source(
                    doc_id="official_web:muc_public:article_detail:43fdab9acbf0e68e67fddba209463e97d0b2fe4e",
                    title="现任领导",
                    snippet=(
                        "现任领导 / 查显友\n"
                        "查显友，男，汉族，安徽怀宁人，中共党员。现任国家民族事务委员会专职委员（副部长级）、中央民族大学党委书记。\n"
                        "党委副书记、校长\n"
                        "强世功 强世功，男，汉族，陕西榆林人，中共党员，教授，博士生导师。现任中央民族大学党委副书记、校长。"
                    ),
                    score=0.033333335,
                    chunk_id_suffix="current-leadership",
                    content_role="primary_content",
                ),
            ),
        )

        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="中央民族大学现任领导",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="official_web", collection="muc_public_pages")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("查显友", response.answer_text)
        self.assertIn("强世功", response.answer_text)
        self.assertIn("党委书记", response.answer_text)
        self.assertIn("党委副书记、校长", response.answer_text)
        self.assertNotIn("安徽怀宁人", response.answer_text)
        self.assertNotIn("博士生导师", response.answer_text)

    def test_official_web_alumni_profile_answer_removes_slogan_boilerplate(self) -> None:
        evidence = _make_official_web_evidence(
            query_text="中央民族大学校友会简介",
            sources=(
                _make_official_web_source(
                    doc_id="official_web:muc_public:article_detail:3f735e1c08be05c5426948f7ea737d3d422c6e02",
                    title="校友会简介",
                    snippet=(
                        "标题：校友会简介\n"
                        "中央民族大学校友会简介\n"
                        "新时代，中央民族大学校友会将携手国内外校友，高举习近平新时代中国特色社会主义思想的伟大旗帜，"
                        "在践行“服务校友、服务母校、服务社会”的征途上，为促进校友事业发展，为助力母校教育事业发展，"
                        "为推动民族地区社会经济发展，为推进国家民族团结进步事业，阔步前行。"
                    ),
                    score=0.033333335,
                    chunk_id_suffix="alumni-profile",
                    content_role="primary_content",
                ),
            ),
        )

        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="中央民族大学校友会简介",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="official_web", collection="muc_public_pages")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("服务校友、服务母校、服务社会", response.answer_text)
        self.assertNotIn("高举习近平新时代中国特色社会主义思想的伟大旗帜", response.answer_text)
        self.assertNotIn("阔步前行", response.answer_text)

    def test_official_web_notice_answer_uses_fact_style_without_title_wrapper(self) -> None:
        evidence = _make_official_web_evidence(
            query_text="民图一小时 信息素养讲座",
            sources=(
                _make_official_web_source(
                    doc_id="official_web:muc_public:article_detail:b6e3922bbc68f5bfe601407b62e4c2de47a0f226",
                    title="“民图一小时”信息素养讲座预告",
                    snippet=(
                        "标题：“民图一小时”信息素养讲座预告 | 章节：“民图一小时”信息素养讲座预告 | "
                        "聚焦人文社科前沿研究——人大复印报刊资料数据库助力科研创新\n"
                        "讲座主题：聚焦人文社科前沿研究——人大复印报刊资料数据库助力科研创新\n"
                        "讲座时间：2026年3月26日下午 时间：14:00——15:00\n"
                        "讲座地点：丰台校区图书馆视听空间125室\n"
                        "线上腾讯会议：756 416 554\n"
                        "请感兴趣的同学扫描二维码预约讲座信息。"
                    ),
                    score=0.033333335,
                    chunk_id_suffix="lecture-notice-facts",
                    content_role="primary_content",
                ),
            ),
        )

        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="民图一小时 信息素养讲座",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="official_web", collection="muc_public_pages")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("人大复印报刊资料数据库", response.answer_text)
        self.assertIn("14:00", response.answer_text)
        self.assertIn("丰台校区图书馆视听空间125室", response.answer_text)
        self.assertNotIn("》显示", response.answer_text)
        self.assertNotIn("二维码", response.answer_text)
        self.assertNotIn("线上腾讯会议", response.answer_text)

    def test_select_answer_support_rows_ignores_official_web_support_only_roles(self) -> None:
        rows = _select_answer_support_rows(
            query_text="本科培养",
            sources=(
                _make_official_web_source(
                    doc_id="official_web:muc_public:article_detail:undergraduate",
                    title="本科培养",
                    snippet="标题：本科培养 | 章节：人才培养\n本科培养 来源：教务处",
                    score=0.99,
                    chunk_id_suffix="undergraduate-source-attribution",
                    content_role="source_attribution",
                ),
                _make_official_web_source(
                    doc_id="official_web:muc_public:article_detail:undergraduate",
                    title="本科培养",
                    snippet="标题：本科培养 | 章节：人才培养\n学校现有本科专业71个，在招专业61个，涵盖11个学科门类。",
                    score=0.61,
                    chunk_id_suffix="undergraduate-reference-fact",
                    content_role="reference_fact",
                ),
            ),
            max_sources=2,
        )

        self.assertEqual(rows[0][0].content_role, "reference_fact")
        self.assertNotIn("教务处", " ".join(rows[0][1]))

    def test_official_web_news_answer_avoids_title_restatement_and_prompt_boilerplate(self) -> None:
        evidence = _make_official_web_evidence(
            query_text="民族团结进步促进法 解读",
            sources=(
                _make_official_web_source(
                    doc_id="official_web:muc_public:article_detail:871878763a91199730493efe0cbb0358b884fe58",
                    title="校长强世功接受“统战新语”专访 解读民族团结进步促进法",
                    snippet=(
                        "标题：校长强世功接受“统战新语”专访 解读民族团结进步促进法\n"
                        "把党在民族工作中取得的重大理论和实践成果转化为国家意志，把铸牢中华民族共同体意识的制度、体制和机制提升到宪制高度。\n"
                        "于十四届全国人大四次会议表决通过的《中华人民共和国民族团结进步促进法》，承载着怎样的历史使命与时代内涵？"
                        "将如何为铸牢中华民族共同体意识提供坚实的法治保障？“统战新语”就此专访中央民族大学校长、知名法学家强世功。\n"
                        "一部基本法律的“硬支撑”"
                    ),
                    score=0.033333335,
                    chunk_id_suffix="law-interpretation",
                    content_role="primary_content",
                ),
            ),
        )

        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="民族团结进步促进法 解读",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="official_web", collection="muc_public_pages")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("民族团结进步促进法", response.answer_text)
        self.assertIn("统战新语", response.answer_text)
        self.assertIn("强世功", response.answer_text)
        self.assertNotIn("》明确", response.answer_text)
        self.assertNotIn("承载着怎样的历史使命与时代内涵", response.answer_text)

    def test_official_web_low_confidence_title_match_still_no_answers_with_scope_specific_copy(
        self,
    ) -> None:
        evidence = _make_official_web_evidence(
            query_text="食堂营业时间",
            sources=(
                _make_official_web_source(
                    doc_id="official_web:muc_public:article_detail:cafeteria-news",
                    title="后勤服务调研新闻",
                    snippet="学校召开后勤服务保障调研座谈会，围绕校园生活服务开展交流。",
                    score=0.41,
                    chunk_id_suffix="cafeteria-news",
                ),
            ),
        )

        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="食堂营业时间",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="official_web", collection="muc_public_pages")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "no_answer")
        self.assertEqual(response.confidence, "low")
        self.assertIn("官网页面", response.answer_text)
        self.assertNotIn("学生手册", response.answer_text)
