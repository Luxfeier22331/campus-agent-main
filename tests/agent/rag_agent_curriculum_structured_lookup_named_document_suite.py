from __future__ import annotations

from tests.agent.rag_agent_test_support import (
    AgentRequest,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagRequestPayload,
    SourceTrustSummary,
    _make_evidence,
    _make_handbook_source,
    _resolved_scope_diagnostics,
    delegate_to_rag_agent,
    unittest,
)


class RagAgentCurriculumStructuredLookupNamedDocumentTest(unittest.TestCase):
    def test_curriculum_named_document_fact_query_avoids_clarification_and_locks_to_target_document(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="民族学本科第二学士学位人才培养方案学制几年？",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:教育学本科第二学士学位人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:education-years",
                    chunk_id="curriculum:教育学本科第二学士学位人才培养方案:chunk-0005",
                    anchor={"page_start": 12, "page_end": 12},
                    canonical_url="https://campus.example/curriculum/education-second-degree",
                    latest_url="https://campus.example/curriculum/education-second-degree",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="三、学制、总学分和学位授予 学制:2年 总学分:60学分。",
                    score=0.82,
                ),
                EvidenceSource(
                    doc_id="curriculum:应用统计学本科专业第二学位人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:stats-years",
                    chunk_id="curriculum:应用统计学本科专业第二学位人才培养方案:chunk-0005",
                    anchor={"page_start": 8, "page_end": 8},
                    canonical_url="https://campus.example/curriculum/stats-second-degree",
                    latest_url="https://campus.example/curriculum/stats-second-degree",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="三、学制、总学分和学位授予 学制:2年 总学分:48.5学分。",
                    score=0.81,
                ),
                EvidenceSource(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ethnology-intro",
                    chunk_id="curriculum:民族学本科第二学士学位人才培养方案:chunk-0001",
                    anchor={"page_start": 1, "page_end": 1},
                    canonical_url="https://campus.example/curriculum/ethnology-second-degree",
                    latest_url="https://campus.example/curriculum/ethnology-second-degree",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="民族学本科第二学士学位人才培养方案 一、培养目标。",
                    score=0.49,
                ),
                EvidenceSource(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ethnology-years",
                    chunk_id="curriculum:民族学本科第二学士学位人才培养方案:chunk-0005",
                    anchor={"page_start": 5, "page_end": 5},
                    canonical_url="https://campus.example/curriculum/ethnology-second-degree",
                    latest_url="https://campus.example/curriculum/ethnology-second-degree",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="三、学制、总学分和学位授予 学制:2年 总学分:60学分。",
                    score=0.48,
                ),
            ),
        )

        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="民族学本科第二学士学位人才培养方案学制几年？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.confidence, "medium")
        self.assertIn("两年", response.answer_text)
        self.assertIn("民族学本科第二学士学位人才培养方案", response.answer_text)
        self.assertNotIn("教育学本科第二学士学位人才培养方案", response.answer_text)

    def test_curriculum_named_document_multi_chunk_support_allows_medium_confidence_for_low_fact_scores(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="民族学本科第二学士学位人才培养方案学制几年？",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ethnology-years",
                    chunk_id="curriculum:民族学本科第二学士学位人才培养方案:chunk-0005",
                    anchor={"page_start": 5, "page_end": 5},
                    canonical_url="https://campus.example/curriculum/ethnology-second-degree",
                    latest_url="https://campus.example/curriculum/ethnology-second-degree",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="五、学制 两年",
                    score=0.35,
                ),
                EvidenceSource(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ethnology-intro",
                    chunk_id="curriculum:民族学本科第二学士学位人才培养方案:chunk-0001",
                    anchor={"page_start": 1, "page_end": 1},
                    canonical_url="https://campus.example/curriculum/ethnology-second-degree",
                    latest_url="https://campus.example/curriculum/ethnology-second-degree",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="民族学本科第二学士学位人才培养方案 一、培养目标。",
                    score=1.0,
                ),
                EvidenceSource(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ethnology-degree",
                    chunk_id="curriculum:民族学本科第二学士学位人才培养方案:chunk-0006",
                    anchor={"page_start": 6, "page_end": 6},
                    canonical_url="https://campus.example/curriculum/ethnology-second-degree",
                    latest_url="https://campus.example/curriculum/ethnology-second-degree",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="六、授予学位 法学学士",
                    score=0.41,
                ),
            ),
        )

        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="民族学本科第二学士学位人才培养方案学制几年？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.confidence, "medium")
        self.assertIn("两年", response.answer_text)

    def test_curriculum_named_document_credit_query_allows_same_doc_multi_chunk_medium_confidence(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="民族学本科人才培养方案总学分要求是多少？",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:民族学本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ethnology-credits-table",
                    chunk_id="curriculum:民族学本科人才培养方案:chunk-0007",
                    anchor={"page_start": 7, "page_end": 7},
                    canonical_url="https://campus.example/curriculum/ethnology",
                    latest_url="https://campus.example/curriculum/ethnology",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="四、各教学环节学时学分 总学分 — — 159",
                    score=0.21666667,
                ),
                EvidenceSource(
                    doc_id="curriculum:民族学本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ethnology-credits",
                    chunk_id="curriculum:民族学本科人才培养方案:chunk-0005",
                    anchor={"page_start": 5, "page_end": 5},
                    canonical_url="https://campus.example/curriculum/ethnology",
                    latest_url="https://campus.example/curriculum/ethnology",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="三、学制、总学分和学位授予 总学分:159 学分",
                    score=0.13247864,
                ),
                EvidenceSource(
                    doc_id="curriculum:民族学本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ethnology-course-settings",
                    chunk_id="curriculum:民族学本科人才培养方案:chunk-0011",
                    anchor={"page_start": 11, "page_end": 11},
                    canonical_url="https://campus.example/curriculum/ethnology",
                    latest_url="https://campus.example/curriculum/ethnology",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="民族学本科人才培养方案 五、课程设置和修读建议 学科基础教育板块应修学分 26 学分。",
                    score=1.0,
                ),
            ),
        )

        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="民族学本科人才培养方案总学分要求是多少？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.confidence, "medium")
        self.assertIn("159", response.answer_text)
        self.assertNotIn("26 学分", response.answer_text)
        self.assertNotIn("根据培养方案相关内容", response.answer_text)

    def test_handbook_missing_policy_object_clarifies_before_retrieval(self) -> None:
        retriever_called = False

        def fake_retriever(*args: object, **kwargs: object) -> EvidenceBundle:
            nonlocal retriever_called
            retriever_called = True
            return _make_evidence()

        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="评审办法里第一作者不是本校也能拿第二作者的分吧？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertFalse(retriever_called)
        self.assertEqual(
            response.result.diagnostics,
            _resolved_scope_diagnostics(
                corpus="regulations",
                collection="student_rules",
                clarification_reason="policy_object_missing",
            ),
        )

    def test_handbook_policy_alias_passes_target_document_ids_to_retriever(self) -> None:
        retriever_call: dict[str, object] = {}
        target_doc_id = "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15"
        target_title = "中央民族大学本科学生国家奖学金评审办法"
        evidence = EvidenceBundle(
            query_text="unused",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id=target_doc_id,
                    title=target_title,
                    snippet="第九条 在学术研究上取得显著成绩，以第一作者发表的通过鉴定的学术论文，可以优先考虑。",
                    score=0.93,
                    chunk_id_suffix="article-9-paper",
                    detail_label="第九条",
                    content_role="requirement",
                    is_answer_bearing=True,
                ),
                _make_handbook_source(
                    doc_id=target_doc_id,
                    title=target_title,
                    snippet="第九条 以第一、二作者出版的通过鉴定的学术专著，可以优先考虑。",
                    score=0.91,
                    chunk_id_suffix="article-9-book",
                    detail_label="第九条",
                    content_role="requirement",
                    is_answer_bearing=True,
                ),
            ),
        )

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return evidence

        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="国奖第九条里对论文和著作怎么要求的？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(
            retriever_call["target_document_ids"],
            (target_doc_id,),
        )
        self.assertIn(target_title, retriever_call["query_text"])
        self.assertEqual(response.status, "completed")
        self.assertEqual(
            response.result.diagnostics,
            _resolved_scope_diagnostics(
                corpus="regulations",
                collection="student_rules",
                resolved_policy_document_id=target_doc_id,
                resolved_policy_title=target_title,
                rewritten_query=retriever_call["query_text"],
                semantic_outcome="grounded_answer",
                retrieved_title_summary=(target_title,),
                retrieved_sources=response.result.evidence.sources,
                source_trust_summary=SourceTrustSummary(
                    observed_tiers=("T1",),
                    answer_bearing_tiers=("T1",),
                    blocked_claim_types=(),
                    freshness_claim_blocked=False,
                    authorization_claim_blocked=False,
                ),
            ),
        )

    def test_handbook_student_card_alias_passes_target_document_ids_to_retriever(self) -> None:
        retriever_call: dict[str, object] = {}
        target_doc_id = "handbook:e90f9707387f9e232ea88ce1c7f5328242e52389"
        target_title = "中央民族大学本科(预科)学生证管理办法"
        evidence = EvidenceBundle(
            query_text="unused",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id=target_doc_id,
                    title=target_title,
                    snippet="学生如将学生证遗失或损坏，应及时到学院（系）挂失。学生遗失学生证应及时申请补办。",
                    score=0.93,
                    chunk_id_suffix="student-card-reissue",
                    detail_label="学生证补办",
                    content_role="procedure",
                    is_answer_bearing=True,
                ),
            ),
        )

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return evidence

        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="学生证丢了怎么办",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(retriever_call["target_document_ids"], (target_doc_id,))
        self.assertIn(target_title, retriever_call["query_text"])
        self.assertEqual(response.status, "completed")

    def test_handbook_disciplinary_relief_alias_passes_target_document_ids_to_retriever(
        self,
    ) -> None:
        retriever_call: dict[str, object] = {}
        target_doc_id = "handbook:6f147355748d2d2f181c310f8d1e0da908f2f1a8"
        target_title = "中央民族大学解除学生纪律处分实施办法"
        evidence = EvidenceBundle(
            query_text="unused",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id=target_doc_id,
                    title=target_title,
                    snippet="学生受处分后符合条件的，可以按规定申请解除处分。",
                    score=0.93,
                    chunk_id_suffix="disciplinary-relief",
                    detail_label="解除处分",
                    content_role="procedure",
                    is_answer_bearing=True,
                ),
            ),
        )

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return evidence

        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="被处分后多久可以申请解除处分",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(retriever_call["target_document_ids"], (target_doc_id,))
        self.assertIn(target_title, retriever_call["query_text"])
        self.assertEqual(response.status, "completed")

    def test_handbook_disciplinary_appeal_does_not_lock_to_relief_policy(self) -> None:
        retriever_call: dict[str, object] = {}
        evidence = EvidenceBundle(
            query_text="unused",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id="handbook:1e404fb7e280b32c46f09280590255c57e6bd72d",
                    title="中央民族大学学生申诉管理办法",
                    snippet="学生对处分决定有异议时，可以按规定提出申诉。",
                    score=0.93,
                    chunk_id_suffix="appeal",
                    detail_label="申诉",
                    content_role="procedure",
                    is_answer_bearing=True,
                ),
            ),
        )

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return evidence

        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="处分申诉流程是什么",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(retriever_call["target_document_ids"], ())
        self.assertNotIn("中央民族大学解除学生纪律处分实施办法", retriever_call["query_text"])
        self.assertEqual(response.status, "completed")
