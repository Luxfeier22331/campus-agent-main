from __future__ import annotations

from campus_rag_agent.agent import RagAgent
from campus_rag_agent.agent_answer_shape import AnswerShape
from campus_rag_agent.query_planning import plan_student_handbook_query
from campus_rag_agent.service_evidence_stage import execute_rag_evidence_selection_stage
from campus_rag_agent.service_versioning_context import _VersionAnswerContext

from tests.agent.rag_agent_test_support import (
    AgentRequest,
    EvidenceBundle,
    KnowledgeScope,
    RagRequestPayload,
    _make_handbook_source,
    delegate_to_rag_agent,
    unittest,
)

_SCHOLARSHIP_DOC_IDS = (
    "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15",
    "handbook:1f17ba6234c15963648b3d74656d78621cad77a7",
    "handbook:60c8b33801e2e59e6db2210719592a6252e3516d",
    "handbook:a531a3c85de862c737d0576e957bf59598822c54",
    "handbook:aa835b8cd4acddb62c7243fed9a9f8c0728e68bc",
)


class RagAgentHandbookCategoryDiscoveryTest(unittest.TestCase):
    def test_scholarship_list_questions_are_category_discovery(self) -> None:
        for query in (
            "有哪些本科生可以申请的奖学金",
            "本科生有哪些奖学金能申请？",
            "我能申请哪些奖学金？",
            "学校奖学金都有什么？",
        ):
            with self.subTest(query=query):
                plan = plan_student_handbook_query(query)

                self.assertEqual(plan.status, "resolved")
                self.assertEqual(plan.task_kind, "category_discovery")
                self.assertEqual(plan.category_id, "scholarship")
                self.assertEqual(plan.audience, "本科生")
                self.assertEqual(plan.clarification_reason, "")
                self.assertEqual(plan.target_document_ids, ())
                self.assertEqual(plan.preferred_document_ids, _SCHOLARSHIP_DOC_IDS)

    def test_generic_scholarship_procedure_still_clarifies(self) -> None:
        plan = plan_student_handbook_query("奖学金怎么申请？")

        self.assertEqual(plan.status, "needs_clarification")
        self.assertEqual(plan.task_kind, "ambiguous_procedure")
        self.assertEqual(plan.clarification_reason, "ambiguous_procedure")
        self.assertEqual(plan.category_id, "scholarship")

    def test_specific_policy_alias_questions_remain_specific_lookup(self) -> None:
        expected_doc_by_query = {
            "成绩没前十还能评国奖吗？": _SCHOLARSHIP_DOC_IDS[0],
            "论文能不能算国奖条件？": _SCHOLARSHIP_DOC_IDS[0],
            "学生证丢了怎么办": "handbook:e90f9707387f9e232ea88ce1c7f5328242e52389",
            "处分怎么消": "handbook:6f147355748d2d2f181c310f8d1e0da908f2f1a8",
            "我想申诉怎么办": "handbook:1e404fb7e280b32c46f09280590255c57e6bd72d",
            "学位有什么要求": "handbook:742d4831bfb443b99323041e263fac2fd9aafcf6",
        }
        for query, expected_doc_id in expected_doc_by_query.items():
            with self.subTest(query=query):
                plan = plan_student_handbook_query(query)

                self.assertEqual(plan.status, "resolved")
                self.assertEqual(plan.task_kind, "specific_policy_lookup")
                self.assertEqual(plan.target_document_ids, (expected_doc_id,))
                self.assertEqual(plan.preferred_document_ids, ())
                self.assertEqual(plan.clarification_reason, "")

    def test_non_scholarship_list_questions_are_category_discovery(self) -> None:
        expected = {
            "有哪些和学籍有关的规定": (
                "student_status",
                "学籍",
                (
                    "handbook:e90f9707387f9e232ea88ce1c7f5328242e52389",
                    "handbook:742d4831bfb443b99323041e263fac2fd9aafcf6",
                ),
            ),
            "处分相关规定有哪些": (
                "discipline",
                "处分",
                (
                    "handbook:6f147355748d2d2f181c310f8d1e0da908f2f1a8",
                    "handbook:1e404fb7e280b32c46f09280590255c57e6bd72d",
                ),
            ),
        }
        for query, (category_id, display_name, document_ids) in expected.items():
            with self.subTest(query=query):
                plan = plan_student_handbook_query(query)

                self.assertEqual(plan.status, "resolved")
                self.assertEqual(plan.task_kind, "category_discovery")
                self.assertEqual(plan.category_id, category_id)
                self.assertEqual(plan.category_display_name, display_name)
                self.assertEqual(plan.category_member_document_ids, document_ids)

    def test_category_discovery_enters_retrieval_with_category_policy_set(self) -> None:
        retriever_calls: list[dict[str, object]] = []

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_calls.append({"query_text": query_text, **kwargs})
            target_document_ids = tuple(kwargs.get("target_document_ids") or ())
            requested_doc_ids = target_document_ids or _SCHOLARSHIP_DOC_IDS
            sources = tuple(
                _category_overview_source(document_id=document_id, score=0.032)
                for document_id in requested_doc_ids
            )
            return EvidenceBundle(
                query_text=query_text,
                corpus="regulations",
                collection="student_rules",
                sources=sources,
            )

        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="有哪些本科生可以申请的奖学金",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_calls[0]["query_text"], "有哪些本科生可以申请的奖学金")
        self.assertEqual(retriever_calls[0]["target_document_ids"], ())
        targeted_calls = tuple(
            call for call in retriever_calls if tuple(call["target_document_ids"])
        )
        self.assertEqual(
            tuple(call["target_document_ids"] for call in targeted_calls),
            tuple((document_id,) for document_id in _SCHOLARSHIP_DOC_IDS),
        )
        self.assertTrue(all(call["preferred_document_ids"] == () for call in targeted_calls))
        self.assertTrue(all(call["top_k"] >= 1 for call in targeted_calls))
        self.assertIn("当前已收录依据中", response.answer_text)
        self.assertIn("国家奖学金", response.answer_text)
        self.assertIn("国家励志奖学金", response.answer_text)
        self.assertIn("专业奖学金", response.answer_text)
        self.assertIn("专项奖学金", response.answer_text)
        self.assertIn("社会奖助学金", response.answer_text)
        self.assertIn("以当年通知/学院细则为准", response.answer_text)
        self.assertNotIn("一定能申请", response.answer_text)
        diagnostics = response.result.diagnostics
        self.assertEqual(diagnostics.resolution_mode, "category_discovery")
        self.assertEqual(diagnostics.resolved_entity_type, "policy_category")
        self.assertEqual(diagnostics.resolved_policy_document_id, "scholarship")

    def test_category_discovery_confidence_uses_coverage_not_absolute_rrf_score(self) -> None:
        plan = plan_student_handbook_query("本科生有哪些奖学金能申请？")
        evidence = EvidenceBundle(
            query_text="本科生有哪些奖学金能申请？",
            corpus="regulations",
            collection="student_rules",
            sources=tuple(
                _category_overview_source(document_id=document_id, score=0.031)
                for document_id in _SCHOLARSHIP_DOC_IDS[:4]
            ),
        )

        result = execute_rag_evidence_selection_stage(
            retrieved_evidence=evidence,
            version_answer_context=_VersionAnswerContext(mode="current"),
            handbook_plan=plan,
        )

        self.assertEqual(result.confidence, "medium")
        self.assertEqual(
            tuple(source.doc_id for source in result.supporting_evidence.sources),
            _SCHOLARSHIP_DOC_IDS[:4],
        )

    def test_category_discovery_prefers_overview_source_over_exclusion_clause(self) -> None:
        bad_clause = _make_handbook_source(
            doc_id=_SCHOLARSHIP_DOC_IDS[0],
            title="中央民族大学本科学生国家奖学金评审办法",
            snippet="所评学年同时申请国家励志奖学金或“宝钢”教育奖学金的，不得同时获得。",
            score=0.99,
            chunk_id_suffix="national-exclusion",
            content_role="eligibility",
            is_answer_bearing=True,
        )
        overview = _category_overview_source(
            document_id=_SCHOLARSHIP_DOC_IDS[0],
            score=0.031,
            suffix="national-overview",
        )
        plan = plan_student_handbook_query("我能申请哪些奖学金？")
        result = execute_rag_evidence_selection_stage(
            retrieved_evidence=EvidenceBundle(
                query_text="我能申请哪些奖学金？",
                corpus="regulations",
                collection="student_rules",
                sources=(bad_clause, overview),
            ),
            version_answer_context=_VersionAnswerContext(mode="current"),
            handbook_plan=plan,
        )
        draft = RagAgent().build_answer(
            result.supporting_evidence,
            answer_shape=AnswerShape.CATEGORY_DISCOVERY_LIST,
            category_display_name=plan.category_display_name,
            audience=plan.audience,
        )

        self.assertIn("国家奖学金用于奖励", draft.answer_text)
        self.assertNotIn("不得同时获得", draft.answer_text)

    def test_category_discovery_list_does_not_use_metadata_or_narrow_ratio_as_description(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="我能申请哪些奖学金？",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id=_SCHOLARSHIP_DOC_IDS[2],
                    title="中央民族大学本科学生专业奖学金评定办法",
                    snippet=(
                        "特殊培养类型学生基地班、民族语“零起点”班等各类享受学校推荐"
                        "免试攻读硕士学位研究生特殊支持政策专业的学生,专业奖学金的"
                        "评定比例按照免试攻读硕士学位研究生的推荐比例确定。"
                    ),
                    score=0.031,
                    chunk_id_suffix="professional-ratio",
                    content_role="requirement",
                    is_answer_bearing=True,
                ),
                _make_handbook_source(
                    doc_id=_SCHOLARSHIP_DOC_IDS[3],
                    title="中央民族大学本科学生专项奖学金评定办法",
                    snippet="标题：中央民族大学本科学生专项奖学金评定办法 | 章节：第二章 评选对象 | 条款：第五条-第八条",
                    score=0.031,
                    chunk_id_suffix="special-metadata",
                    content_role="eligibility",
                    is_answer_bearing=True,
                ),
            ),
        )

        draft = RagAgent().build_answer(
            evidence,
            answer_shape=AnswerShape.CATEGORY_DISCOVERY_LIST,
            category_display_name="奖学金",
            audience="本科生",
        )

        self.assertIn("《中央民族大学本科学生专业奖学金评定办法》", draft.answer_text)
        self.assertIn("《中央民族大学本科学生专项奖学金评定办法》", draft.answer_text)
        self.assertNotIn("特殊培养类型学生", draft.answer_text)
        self.assertNotIn("评定比例按照", draft.answer_text)
        self.assertNotIn("章节：第二章", draft.answer_text)
        self.assertNotIn("条款：第五条", draft.answer_text)

    def test_category_discovery_answer_heading_uses_planned_category_context(self) -> None:
        evidence = EvidenceBundle(
            query_text="本科生都有哪些相关制度？",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id="handbook:student-status",
                    title="中央民族大学本科学生学籍管理规定",
                    snippet="学籍管理规定用于说明本科学生注册、休学、复学等事项。",
                    score=0.91,
                    chunk_id_suffix="status-overview",
                    content_role="definition",
                    is_answer_bearing=True,
                ),
            ),
        )

        draft = RagAgent().build_answer(
            evidence,
            answer_shape=AnswerShape.CATEGORY_DISCOVERY_LIST,
            category_display_name="学籍",
            audience="本科生",
        )

        self.assertIn("当前已收录依据中，本科生学籍相关制度包括：", draft.answer_text)
        self.assertNotIn("奖学金", draft.answer_text)


_SCHOLARSHIP_TITLES = {
    _SCHOLARSHIP_DOC_IDS[0]: "中央民族大学本科学生国家奖学金评审办法",
    _SCHOLARSHIP_DOC_IDS[1]: "中央民族大学本科学生国家励志奖学金评审办法",
    _SCHOLARSHIP_DOC_IDS[2]: "中央民族大学本科学生专业奖学金评定办法",
    _SCHOLARSHIP_DOC_IDS[3]: "中央民族大学本科学生专项奖学金评定办法",
    _SCHOLARSHIP_DOC_IDS[4]: "中央民族大学社会奖助学金管理办法",
}
_SCHOLARSHIP_OVERVIEWS = {
    _SCHOLARSHIP_DOC_IDS[0]: "国家奖学金用于奖励特别优秀的全日制本科学生。",
    _SCHOLARSHIP_DOC_IDS[1]: "国家励志奖学金用于奖励资助品学兼优的家庭经济困难本科学生。",
    _SCHOLARSHIP_DOC_IDS[2]: "专业奖学金用于奖励学习成绩优秀、综合表现良好的本科学生。",
    _SCHOLARSHIP_DOC_IDS[3]: "专项奖学金用于奖励在特定方面表现突出的本科学生。",
    _SCHOLARSHIP_DOC_IDS[4]: "社会奖助学金包括奖学金和助学金，用于奖励或资助符合条件的在校学生。",
}


def _category_overview_source(
    *,
    document_id: str,
    score: float,
    suffix: str = "overview",
):
    return _make_handbook_source(
        doc_id=document_id,
        title=_SCHOLARSHIP_TITLES[document_id],
        snippet=_SCHOLARSHIP_OVERVIEWS[document_id],
        score=score,
        chunk_id_suffix=suffix,
        content_role="definition",
        is_answer_bearing=True,
    )


if __name__ == "__main__":
    unittest.main()
