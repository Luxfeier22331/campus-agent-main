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

INVENTORY_SCOPE = KnowledgeScope(corpus="official_web", collection="muc_public_pages")


class RagAgentOfficialWebPeopleAndNewsTest(unittest.TestCase):
    def test_people_training_and_brand_history_pages_are_inventory_only(self) -> None:
        cases = (
            (
                "中央民族大学研究生培养",
                "研究生培养",
                "现有24个研究生招生培养单位，共有10个博士一级学科授权点。",
            ),
            (
                "中央民族大学学术名流",
                "学术名流",
                "吴泽霖先生将社会学与民族学、人类学等学科联系起来。",
            ),
            (
                "中央民族大学现任领导",
                "现任领导",
                "现任领导包括学校党委和行政领导。",
            ),
            (
                "中央民族大学校友会简介",
                "校友会简介",
                "校友会服务校友、服务母校、服务社会。",
            ),
        )
        for user_goal, title, snippet in cases:
            with self.subTest(title=title):
                response = delegate_to_rag_agent(
                    AgentRequest(
                        target="rag-agent",
                        user_goal=user_goal,
                        payload=RagRequestPayload(scope=INVENTORY_SCOPE),
                    ),
                    retriever=lambda *args, **kwargs: _make_official_web_evidence(
                        query_text=user_goal,
                        sources=(
                            _make_official_web_source(
                                doc_id=f"official_web:muc_public:article_detail:{title}",
                                title=title,
                                snippet=f"标题：{title}\n{snippet}",
                                score=0.9,
                                chunk_id_suffix=title,
                                content_role="primary_content",
                            ),
                        ),
                    ),
                )

                self.assertEqual(response.status, "no_answer")
                self.assertEqual(response.confidence, "low")
                self.assertIn("非默认官网页面库存范围", response.answer_text)
                self.assertEqual(
                    response.result.diagnostics.no_answer_reason, "scope_not_query_enabled"
                )
                self.assertEqual(response.result.diagnostics.semantic_outcome, "unsupported_scope")

    def test_notice_and_news_pages_are_not_default_official_web_rag_surface(self) -> None:
        cases = (
            (
                "民图一小时 信息素养讲座",
                "“民图一小时”信息素养讲座预告",
                "讲座时间：2026年3月26日下午14:00。讲座地点：丰台校区图书馆视听空间125室。",
            ),
            (
                "民族团结进步促进法 解读",
                "校长强世功接受“统战新语”专访 解读民族团结进步促进法",
                "专访解读民族团结进步促进法，不作为 stable_reference 默认答案证据。",
            ),
        )
        for user_goal, title, snippet in cases:
            with self.subTest(title=title):
                response = delegate_to_rag_agent(
                    AgentRequest(
                        target="rag-agent",
                        user_goal=user_goal,
                        payload=RagRequestPayload(scope=INVENTORY_SCOPE),
                    ),
                    retriever=lambda *args, **kwargs: _make_official_web_evidence(
                        query_text=user_goal,
                        sources=(
                            _make_official_web_source(
                                doc_id=f"official_web:muc_public:article_detail:{title}",
                                title=title,
                                snippet=f"标题：{title}\n{snippet}",
                                score=0.9,
                                chunk_id_suffix=title,
                                content_role="primary_content",
                            ),
                        ),
                    ),
                )

                self.assertEqual(response.status, "no_answer")
                self.assertIn("非默认官网页面库存范围", response.answer_text)
                self.assertNotIn("14:00", response.answer_text)
                self.assertNotIn("统战新语", response.answer_text)
                self.assertEqual(response.result.diagnostics.semantic_outcome, "unsupported_scope")

    def test_select_answer_support_rows_ignores_official_web_support_only_roles(self) -> None:
        rows = _select_answer_support_rows(
            query_text="教学和科研单位",
            sources=(
                _make_official_web_source(
                    doc_id="official_web:muc_public:directory_page:teaching-units",
                    title="教学和科研单位",
                    snippet="标题：教学和科研单位\n教学和科研单位 来源：学校官网",
                    score=0.99,
                    chunk_id_suffix="teaching-units-source-attribution",
                    content_role="source_attribution",
                    collection="stable_reference",
                ),
                _make_official_web_source(
                    doc_id="official_web:muc_public:directory_page:teaching-units",
                    title="教学和科研单位",
                    snippet="标题：教学和科研单位\n学校设有民族学与社会学学院、信息工程学院等教学和科研单位。",
                    score=0.61,
                    chunk_id_suffix="teaching-units-reference-fact",
                    content_role="reference_fact",
                    collection="stable_reference",
                ),
            ),
            max_sources=2,
        )

        self.assertEqual(rows[0][0].content_role, "reference_fact")
        self.assertNotIn("来源：学校官网", " ".join(rows[0][1]))

    def test_select_answer_support_rows_returns_empty_when_only_ignored_sources_remain(
        self,
    ) -> None:
        rows = _select_answer_support_rows(
            query_text="教学和科研单位",
            sources=(
                _make_official_web_source(
                    doc_id="official_web:muc_public:directory_page:teaching-units",
                    title="教学和科研单位",
                    snippet="标题：教学和科研单位\n教学和科研单位 来源：学校官网",
                    score=0.99,
                    chunk_id_suffix="teaching-units-source-attribution",
                    content_role="source_attribution",
                    collection="stable_reference",
                ),
            ),
            max_sources=2,
        )

        self.assertEqual(rows, ())
