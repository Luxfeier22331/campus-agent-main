from __future__ import annotations

from tests.agent.knowledge_capability_test_support import (
    CapabilityRequest,
    EvidenceBundle,
    KnowledgeScope,
    RagRequestPayload,
    _make_current_v3_category_overview_source,
    _make_handbook_source,
    delegate_to_knowledge_capability,
    unittest,
)

_NATIONAL_SCHOLARSHIP_DOC_ID = "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15"
_SCHOLARSHIP_DOC_IDS = (
    _NATIONAL_SCHOLARSHIP_DOC_ID,
    "handbook:1f17ba6234c15963648b3d74656d78621cad77a7",
    "handbook:60c8b33801e2e59e6db2210719592a6252e3516d",
    "handbook:a531a3c85de862c737d0576e957bf59598822c54",
    "handbook:aa835b8cd4acddb62c7243fed9a9f8c0728e68bc",
)
_STUDENT_CARD_DOC_ID = "handbook:e90f9707387f9e232ea88ce1c7f5328242e52389"
_DEMERIT_RELIEF_DOC_ID = "handbook:6f147355748d2d2f181c310f8d1e0da908f2f1a8"
_APPEAL_DOC_ID = "handbook:1e404fb7e280b32c46f09280590255c57e6bd72d"
_DEGREE_DOC_ID = "handbook:742d4831bfb443b99323041e263fac2fd9aafcf6"
_RECOMMENDATION_POSTGRADUATE_DEFAULT_DOC_ID = "handbook:4b943c3cb67ec0e3c578781fb0c62c1763fd73b9"
_RECOMMENDATION_POSTGRADUATE_ATHLETE_DOC_ID = "handbook:ceb42210e2431730ef5b1e376b800250fd9eb1fb"
_STUDENT_STATUS_CATEGORY_DOC_IDS = (
    _STUDENT_CARD_DOC_ID,
    _DEGREE_DOC_ID,
)
_DISCIPLINE_CATEGORY_DOC_IDS = (
    _DEMERIT_RELIEF_DOC_ID,
    _APPEAL_DOC_ID,
)


class KnowledgeCapabilityRealisticE2ESamplesTest(unittest.TestCase):
    def test_fuzzy_scholarship_discovery_lists_recorded_policy_set(self) -> None:
        for query in (
            "本科生有哪些奖学金能申请？",
            "我能申请哪些奖学金？",
            "学校奖学金都有什么？",
        ):
            with self.subTest(query=query):
                retriever_calls: list[dict[str, object]] = []
                response = delegate_to_knowledge_capability(
                    _handbook_request(query),
                    retriever=_scholarship_discovery_retriever(retriever_calls),
                )

                self.assertEqual(response.status, "completed")
                self.assertEqual(retriever_calls[0]["query_text"], query)
                self.assertEqual(retriever_calls[0]["target_document_ids"], ())
                targeted_doc_ids = tuple(
                    call["target_document_ids"][0]
                    for call in retriever_calls
                    if call["target_document_ids"]
                )
                self.assertEqual(targeted_doc_ids, _SCHOLARSHIP_DOC_IDS)
                self.assertIn("当前已收录依据中，本科生奖学金相关制度包括：", response.answer_text)
                self.assertIn("国家奖学金", response.answer_text)
                self.assertIn("国家励志奖学金", response.answer_text)
                self.assertIn("专业奖学金", response.answer_text)
                self.assertIn("专项奖学金", response.answer_text)
                self.assertIn("社会奖助学金", response.answer_text)
                self.assertIn("以当年通知/学院细则为准", response.answer_text)
                self.assertNotIn("一定能申请", response.answer_text)
                self.assertNotIn("个人申请->", response.answer_text)
                self.assertNotIn("标题：", response.answer_text)
                self.assertNotIn("条款：", response.answer_text)

    def test_fuzzy_scholarship_procedure_clarifies_before_retrieval(self) -> None:
        retriever_called = False

        def retriever(*args: object, **kwargs: object) -> EvidenceBundle:
            nonlocal retriever_called
            retriever_called = True
            return EvidenceBundle(corpus="regulations", collection="student_rules")

        response = delegate_to_knowledge_capability(
            _handbook_request("奖学金怎么申请？"),
            retriever=retriever,
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertFalse(retriever_called)
        self.assertEqual(response.result.diagnostics.clarification_reason, "ambiguous_procedure")

    def test_recommendation_postgraduate_procedure_defaults_to_undergraduate_policy(self) -> None:
        retriever_call: dict[str, object] = {}

        response = delegate_to_knowledge_capability(
            _handbook_request("保研流程是什么？"),
            retriever=_single_policy_retriever(
                retriever_call,
                doc_id=_RECOMMENDATION_POSTGRADUATE_DEFAULT_DOC_ID,
                title="中央民族大学推荐应届本科毕业生免试攻读硕士学位研究生管理办法",
                snippet="学校推荐应届本科毕业生免试攻读硕士学位研究生，应按管理办法完成报名、审核和公示等程序。",
                suffix="recommendation-postgraduate-default",
                content_role="procedure",
            ),
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(
            retriever_call["target_document_ids"],
            (_RECOMMENDATION_POSTGRADUATE_DEFAULT_DOC_ID,),
        )
        self.assertIn("保研", response.answer_text)
        self.assertIn("步骤", response.answer_text)
        self.assertIn("报名、审核和公示", response.answer_text)

    def test_recommendation_postgraduate_procedure_athlete_query_hits_athlete_policy(self) -> None:
        retriever_call: dict[str, object] = {}

        response = delegate_to_knowledge_capability(
            _handbook_request("高水平运动员保研流程是什么？"),
            retriever=_single_policy_retriever(
                retriever_call,
                doc_id=_RECOMMENDATION_POSTGRADUATE_ATHLETE_DOC_ID,
                title="中央民族大学推荐应届优秀高水平运动员免试攻读硕士学位研究生管理办法",
                snippet="高水平运动员推免应按管理办法完成资格审核、材料报送和推荐程序。",
                suffix="recommendation-postgraduate-athlete",
                content_role="procedure",
            ),
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(
            retriever_call["target_document_ids"],
            (_RECOMMENDATION_POSTGRADUATE_ATHLETE_DOC_ID,),
        )
        self.assertIn("高水平运动员", response.answer_text)
        self.assertIn("推荐程序", response.answer_text)

    def test_national_scholarship_rank_question_locks_to_specific_policy(self) -> None:
        retriever_call: dict[str, object] = {}

        response = delegate_to_knowledge_capability(
            _handbook_request("成绩没前十还能评国奖吗？"),
            retriever=_national_scholarship_retriever(
                retriever_call,
                snippet="国家奖学金申请人的学习成绩排名与综合考评成绩排名原则上均应位于前10%。",
                suffix="rank-top-ten",
            ),
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["target_document_ids"], (_NATIONAL_SCHOLARSHIP_DOC_ID,))
        self.assertEqual(retriever_call["preferred_document_ids"], ())
        self.assertIn("前10%", response.answer_text)
        self.assertIn("国家奖学金", response.answer_text)

    def test_national_scholarship_paper_question_locks_to_specific_policy(self) -> None:
        retriever_call: dict[str, object] = {}

        response = delegate_to_knowledge_capability(
            _handbook_request("论文能不能算国奖条件？"),
            retriever=_national_scholarship_retriever(
                retriever_call,
                snippet=(
                    "标题：中央民族大学本科学生国家奖学金评审办法 | "
                    "章节：第三章 评选条件 | 条款：第九条\n"
                    "同等条件下，在公开刊物上发表高质量学术论文者可优先推荐参评国家奖学金。"
                ),
                suffix="paper-condition",
            ),
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["target_document_ids"], (_NATIONAL_SCHOLARSHIP_DOC_ID,))
        self.assertEqual(retriever_call["preferred_document_ids"], ())
        self.assertIn("学术论文", response.answer_text)
        self.assertIn("国家奖学金", response.answer_text)
        self.assertNotIn("标题：", response.answer_text)
        self.assertNotIn("章节：", response.answer_text)
        self.assertNotIn("条款：", response.answer_text)

    def test_specific_policy_clause_query_uses_focused_follow_up_lookup(self) -> None:
        retriever_calls: list[dict[str, object]] = []

        def retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_calls.append({"query_text": query_text, **kwargs})
            if "第九条" in query_text and "论文" in query_text and "著作" in query_text:
                sources = (
                    _make_handbook_source(
                        doc_id=_NATIONAL_SCHOLARSHIP_DOC_ID,
                        title="中央民族大学本科学生国家奖学金评审办法",
                        snippet="第九条 学术研究方面取得显著成绩，以第一作者发表论文或以第一、二作者出版学术著作。",
                        score=0.95,
                        chunk_id_suffix="national-paper-book",
                        detail_label="第九条",
                        content_role="requirement",
                        is_answer_bearing=True,
                    ),
                )
            else:
                sources = (
                    _make_handbook_source(
                        doc_id=_NATIONAL_SCHOLARSHIP_DOC_ID,
                        title="中央民族大学本科学生国家奖学金评审办法",
                        snippet="第九条 参评本科学生国家奖学金还须具备以下条件之一：在体育竞赛中取得显著成绩。",
                        score=0.91,
                        chunk_id_suffix="national-sports",
                        detail_label="第九条",
                        content_role="requirement",
                        is_answer_bearing=True,
                    ),
                )
            return EvidenceBundle(
                query_text=query_text,
                corpus="regulations",
                collection="student_rules",
                sources=sources,
            )

        response = delegate_to_knowledge_capability(
            _handbook_request("国奖第九条怎么要求论文和著作？"),
            retriever=retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertGreaterEqual(len(retriever_calls), 2)
        self.assertEqual(
            tuple(call["target_document_ids"] for call in retriever_calls[:2]),
            (
                (_NATIONAL_SCHOLARSHIP_DOC_ID,),
                (_NATIONAL_SCHOLARSHIP_DOC_ID,),
            ),
        )
        focused_follow_up = next(
            (
                call
                for call in retriever_calls[1:]
                if "第九条" in call["query_text"]
                and "论文" in call["query_text"]
                and "著作" in call["query_text"]
            ),
            None,
        )
        self.assertIsNotNone(focused_follow_up)
        self.assertIn("论文", response.answer_text)
        self.assertIn("著作", response.answer_text)
        self.assertNotIn("体育竞赛", response.answer_text)

    def test_student_card_lost_question_locks_to_student_card_policy(self) -> None:
        retriever_call: dict[str, object] = {}

        response = delegate_to_knowledge_capability(
            _handbook_request("学生证丢了怎么办"),
            retriever=_single_policy_retriever(
                retriever_call,
                doc_id=_STUDENT_CARD_DOC_ID,
                title="中央民族大学本科(预科)学生证管理办法",
                snippet="学生证遗失后，应按学校规定办理挂失和补办手续。",
                suffix="student-card-lost",
                content_role="procedure",
            ),
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["target_document_ids"], (_STUDENT_CARD_DOC_ID,))
        self.assertIn("学生证", response.answer_text)
        self.assertIn("补办", response.answer_text)

    def test_discipline_relief_question_locks_to_relief_policy(self) -> None:
        retriever_call: dict[str, object] = {}

        response = delegate_to_knowledge_capability(
            _handbook_request("处分怎么消"),
            retriever=_single_policy_retriever(
                retriever_call,
                doc_id=_DEMERIT_RELIEF_DOC_ID,
                title="中央民族大学解除学生纪律处分实施办法",
                snippet="学生申请解除纪律处分，应按实施办法提交解除处分申请材料。",
                suffix="demerit-relief",
                content_role="procedure",
            ),
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["target_document_ids"], (_DEMERIT_RELIEF_DOC_ID,))
        self.assertIn("解除", response.answer_text)
        self.assertIn("处分", response.answer_text)

    def test_appeal_question_locks_to_appeal_policy(self) -> None:
        retriever_call: dict[str, object] = {}

        response = delegate_to_knowledge_capability(
            _handbook_request("我想申诉怎么办"),
            retriever=_single_policy_retriever(
                retriever_call,
                doc_id=_APPEAL_DOC_ID,
                title="中央民族大学学生申诉管理办法",
                snippet="学生对处分决定不服的，可以按照学生申诉管理办法提出申诉。",
                suffix="student-appeal",
                content_role="procedure",
            ),
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["target_document_ids"], (_APPEAL_DOC_ID,))
        self.assertIn("申诉", response.answer_text)

    def test_degree_requirement_question_locks_to_degree_policy(self) -> None:
        retriever_call: dict[str, object] = {}

        response = delegate_to_knowledge_capability(
            _handbook_request("学位有什么要求"),
            retriever=_single_policy_retriever(
                retriever_call,
                doc_id=_DEGREE_DOC_ID,
                title="中央民族大学全日制本科学生学士学位授予规定",
                snippet="全日制本科学生申请学士学位，应符合学士学位授予规定中的授予条件。",
                suffix="degree-requirement",
                content_role="requirement",
            ),
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["target_document_ids"], (_DEGREE_DOC_ID,))
        self.assertIn("学位", response.answer_text)
        self.assertTrue("要求" in response.answer_text or "条件" in response.answer_text)

    def test_fuzzy_student_status_discovery_lists_recorded_policy_set(self) -> None:
        retriever_calls: list[dict[str, object]] = []

        response = delegate_to_knowledge_capability(
            _handbook_request("有哪些和学籍有关的规定"),
            retriever=_category_policy_retriever(
                retriever_calls,
                fixtures=_STUDENT_STATUS_FIXTURES,
                member_doc_ids=_STUDENT_STATUS_CATEGORY_DOC_IDS,
            ),
        )

        self.assertEqual(response.status, "completed")
        targeted_doc_ids = tuple(
            call["target_document_ids"][0]
            for call in retriever_calls
            if call["target_document_ids"]
        )
        self.assertEqual(targeted_doc_ids, _STUDENT_STATUS_CATEGORY_DOC_IDS)
        self.assertIn("当前已收录依据中，本科生学籍相关制度包括：", response.answer_text)
        self.assertIn("学生证管理办法", response.answer_text)
        self.assertIn("学士学位授予规定", response.answer_text)

    def test_fuzzy_discipline_discovery_lists_recorded_policy_set(self) -> None:
        retriever_calls: list[dict[str, object]] = []

        response = delegate_to_knowledge_capability(
            _handbook_request("处分相关规定有哪些"),
            retriever=_category_policy_retriever(
                retriever_calls,
                fixtures=_DISCIPLINE_FIXTURES,
                member_doc_ids=_DISCIPLINE_CATEGORY_DOC_IDS,
            ),
        )

        self.assertEqual(response.status, "completed")
        targeted_doc_ids = tuple(
            call["target_document_ids"][0]
            for call in retriever_calls
            if call["target_document_ids"]
        )
        self.assertEqual(targeted_doc_ids, _DISCIPLINE_CATEGORY_DOC_IDS)
        self.assertIn("处分相关制度包括：", response.answer_text)
        self.assertIn("解除学生纪律处分实施办法", response.answer_text)
        self.assertIn("学生申诉管理办法", response.answer_text)


def _handbook_request(query: str) -> CapabilityRequest:
    return CapabilityRequest(
        capability="knowledge",
        user_goal=query,
        payload=RagRequestPayload(
            scope=KnowledgeScope(corpus="regulations", collection="student_rules")
        ),
    )


def _scholarship_discovery_retriever(calls: list[dict[str, object]]):
    def retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
        calls.append({"query_text": query_text, **kwargs})
        target_document_ids = tuple(kwargs.get("target_document_ids") or ())
        document_ids = target_document_ids or _SCHOLARSHIP_DOC_IDS
        return EvidenceBundle(
            query_text=query_text,
            corpus="regulations",
            collection="student_rules",
            sources=tuple(
                _scholarship_source_for_doc_id(document_id) for document_id in document_ids
            ),
        )

    return retriever


def _national_scholarship_retriever(
    call: dict[str, object],
    *,
    snippet: str,
    suffix: str,
):
    def retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
        call["query_text"] = query_text
        call.update(kwargs)
        return EvidenceBundle(
            query_text=query_text,
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id=_NATIONAL_SCHOLARSHIP_DOC_ID,
                    title="中央民族大学本科学生国家奖学金评审办法",
                    snippet=snippet,
                    chunk_id_suffix=suffix,
                    score=0.95,
                    content_role="requirement",
                    is_answer_bearing=True,
                ),
            ),
        )

    return retriever


def _single_policy_retriever(
    call: dict[str, object],
    *,
    doc_id: str,
    title: str,
    snippet: str,
    suffix: str,
    content_role: str,
):
    def retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
        call["query_text"] = query_text
        call.update(kwargs)
        return EvidenceBundle(
            query_text=query_text,
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id=doc_id,
                    title=title,
                    snippet=snippet,
                    score=0.95,
                    chunk_id_suffix=suffix,
                    content_role=content_role,
                    is_answer_bearing=True,
                ),
            ),
        )

    return retriever


def _category_policy_retriever(
    calls: list[dict[str, object]],
    *,
    fixtures: dict[str, tuple[str, str, str]],
    member_doc_ids: tuple[str, ...],
):
    def retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
        calls.append({"query_text": query_text, **kwargs})
        target_document_ids = tuple(kwargs.get("target_document_ids") or ())
        document_ids = target_document_ids or member_doc_ids
        return EvidenceBundle(
            query_text=query_text,
            corpus="regulations",
            collection="student_rules",
            sources=tuple(
                _policy_source_for_doc_id(document_id=document_id, fixtures=fixtures)
                for document_id in document_ids
            ),
        )

    return retriever


def _scholarship_source(
    *,
    doc_id: str,
    title: str,
    snippet: str,
    suffix: str,
    score: float,
):
    return _make_current_v3_category_overview_source(
        doc_id=doc_id,
        title=title,
        snippet=snippet,
        score=score,
        chunk_id_suffix=suffix,
    )


_SCHOLARSHIP_FIXTURES = {
    _SCHOLARSHIP_DOC_IDS[0]: (
        "中央民族大学本科学生国家奖学金评审办法",
        "国家奖学金用于奖励特别优秀的全日制本科学生。",
        "national",
    ),
    _SCHOLARSHIP_DOC_IDS[1]: (
        "中央民族大学本科学生国家励志奖学金评审办法",
        "国家励志奖学金用于奖励资助品学兼优的家庭经济困难本科学生。",
        "encouragement",
    ),
    _SCHOLARSHIP_DOC_IDS[2]: (
        "中央民族大学本科学生专业奖学金评定办法",
        "专业奖学金用于奖励学习成绩优秀、综合表现良好的本科学生。",
        "professional",
    ),
    _SCHOLARSHIP_DOC_IDS[3]: (
        "中央民族大学本科学生专项奖学金评定办法",
        "专项奖学金用于奖励在特定方面表现突出的本科学生。",
        "special",
    ),
    _SCHOLARSHIP_DOC_IDS[4]: (
        "中央民族大学社会奖助学金管理办法",
        "社会奖助学金包括奖学金和助学金，用于奖励或资助符合条件的在校学生。",
        "social",
    ),
}


def _scholarship_source_for_doc_id(document_id: str):
    title, snippet, suffix = _SCHOLARSHIP_FIXTURES[document_id]
    return _scholarship_source(
        doc_id=document_id,
        title=title,
        snippet=snippet,
        suffix=suffix,
        score=0.031,
    )


_STUDENT_STATUS_FIXTURES = {
    _STUDENT_CARD_DOC_ID: (
        "中央民族大学本科(预科)学生证管理办法",
        "学生证管理办法用于说明学生证办理、使用、补办等事项。",
        "student-card-overview",
    ),
    _DEGREE_DOC_ID: (
        "中央民族大学全日制本科学生学士学位授予规定",
        "学士学位授予规定用于说明本科学生学士学位授予条件。",
        "degree-overview",
    ),
}
_DISCIPLINE_FIXTURES = {
    _DEMERIT_RELIEF_DOC_ID: (
        "中央民族大学解除学生纪律处分实施办法",
        "解除学生纪律处分实施办法用于说明学生申请解除纪律处分的条件和程序。",
        "demerit-relief-overview",
    ),
    _APPEAL_DOC_ID: (
        "中央民族大学学生申诉管理办法",
        "学生申诉管理办法用于说明学生对处分决定等事项提出申诉的处理程序。",
        "appeal-overview",
    ),
}


def _policy_source_for_doc_id(
    *,
    document_id: str,
    fixtures: dict[str, tuple[str, str, str]],
):
    title, snippet, suffix = fixtures[document_id]
    return _make_current_v3_category_overview_source(
        doc_id=document_id,
        title=title,
        snippet=snippet,
        score=0.031,
        chunk_id_suffix=suffix,
    )


if __name__ == "__main__":
    unittest.main()
