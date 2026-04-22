from __future__ import annotations

from tests.specialist.rag_specialist_test_support import (
    ActorContext,
    ContextProjection,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagAgent,
    RagRequestPayload,
    RestrictedDocumentAccessDeniedError,
    SourceTrustSummary,
    SpecialistRequest,
    _make_curriculum_plan_source,
    _make_evidence,
    _make_handbook_source,
    _query_mode,
    _resolved_scope_diagnostics,
    delegate_to_rag_agent,
    derive_confidence,
    unittest,
)


class RagSpecialistCurriculumStructuredLookupTest(unittest.TestCase):
    def test_query_mode_routes_curriculum_structure_queries_away_from_procedure(self) -> None:
        for query_text in (
            "经济学拔尖人才创新班人才培养方案课程地图怎么安排？",
            "法学民族实验班培养方案课程设置怎么安排",
            "法学民族实验班培养方案修读建议怎么安排",
        ):
            with self.subTest(query_text=query_text):
                self.assertEqual(_query_mode(query_text), "curriculum_lookup")

    def test_curriculum_course_map_answer_fail_closes_without_supporting_sources(self) -> None:
        evidence = EvidenceBundle(
            query_text="经济学拔尖人才创新班人才培养方案课程地图怎么安排？",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                _make_curriculum_plan_source(
                    doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    chunk_id="curriculum:economics-innovation:chunk-0023",
                    snippet="六、课程地图 经济学拔尖人才创新班本科课程结果拓扑图。",
                    score=0.99,
                    source_title="经济学拔尖人才创新班人才培养方案",
                    structural_path=("经济学拔尖人才创新班人才培养方案", "六、课程地图"),
                    content_kind="section_text",
                    detail_label="六、课程地图",
                    is_answer_bearing=True,
                ),
                _make_curriculum_plan_source(
                    doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    chunk_id="curriculum:economics-innovation:chunk-0014",
                    snippet="五、课程设置和修读建议 2. 专业选修课程 中国近现代经济史。",
                    score=0.98,
                    source_title="经济学拔尖人才创新班人才培养方案",
                    structural_path=(
                        "经济学拔尖人才创新班人才培养方案",
                        "五、课程设置和修读建议",
                        "(二) 专业教育",
                        "2. 专业选修课程",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                _make_curriculum_plan_source(
                    doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    chunk_id="curriculum:economics-innovation:chunk-0015",
                    snippet="五、课程设置和修读建议 2. 专业选修课程 发展经济学专题。",
                    score=0.97,
                    source_title="经济学拔尖人才创新班人才培养方案",
                    structural_path=(
                        "经济学拔尖人才创新班人才培养方案",
                        "五、课程设置和修读建议",
                        "(二) 专业教育",
                        "2. 专业选修课程",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                _make_curriculum_plan_source(
                    doc_id="curriculum:经济学拔尖人才创新班人才培养方案",
                    chunk_id="curriculum:economics-innovation:chunk-0013",
                    snippet="五、课程设置和修读建议 1. 专业核心课程 专业核心课程 30 学分。",
                    score=0.96,
                    source_title="经济学拔尖人才创新班人才培养方案",
                    structural_path=(
                        "经济学拔尖人才创新班人才培养方案",
                        "五、课程设置和修读建议",
                        "(二) 专业教育",
                        "1. 专业核心课程",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
            ),
        )

        draft = RagAgent().build_answer(evidence)

        self.assertEqual(draft.supporting_sources, ())
        self.assertEqual(draft.supporting_contexts, ())
        self.assertEqual(draft.answer_text, "")

    def test_curriculum_generic_degree_question_uses_curriculum_specific_clarification(
        self,
    ) -> None:
        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="学位怎么授予？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=lambda *args, **kwargs: _make_evidence(),
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertIn("培养方案", response.follow_up_question)
        self.assertNotIn("学生手册", response.follow_up_question)

    def test_curriculum_short_fact_answer_reorders_supporting_sources_before_confidence(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="民族学本科人才培养方案总学分要求是多少？",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:法学本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:law-intro",
                    chunk_id="curriculum:法学本科人才培养方案:chunk-0001",
                    anchor={"page_start": 1, "page_end": 1},
                    canonical_url="https://campus.example/curriculum/law",
                    latest_url="https://campus.example/curriculum/law",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="法学本科人才培养方案 一、培养目标。",
                    score=0.5,
                ),
                EvidenceSource(
                    doc_id="curriculum:民族学本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ethnology-intro",
                    chunk_id="curriculum:民族学本科人才培养方案:chunk-0001",
                    anchor={"page_start": 1, "page_end": 1},
                    canonical_url="https://campus.example/curriculum/ethnology",
                    latest_url="https://campus.example/curriculum/ethnology",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="民族学本科人才培养方案 一、培养目标。",
                    score=0.49,
                ),
                EvidenceSource(
                    doc_id="curriculum:汉语言文学本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:chinese-intro",
                    chunk_id="curriculum:汉语言文学本科人才培养方案:chunk-0001",
                    anchor={"page_start": 1, "page_end": 1},
                    canonical_url="https://campus.example/curriculum/chinese",
                    latest_url="https://campus.example/curriculum/chinese",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="汉语言文学本科人才培养方案 一、培养目标。",
                    score=0.48,
                ),
                EvidenceSource(
                    doc_id="curriculum:民族学本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ethnology-credits",
                    chunk_id="curriculum:民族学本科人才培养方案:chunk-0011",
                    anchor={"page_start": 72, "page_end": 72},
                    canonical_url="https://campus.example/curriculum/ethnology",
                    latest_url="https://campus.example/curriculum/ethnology",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="三、毕业学分要求 应修总学分:155学分 其中通识教育课程 26 学分。",
                    score=0.58,
                ),
            ),
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
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
        self.assertIn("155学分", response.answer_text)
        self.assertNotIn("法学本科人才培养方案", response.answer_text)
        self.assertNotIn("根据培养方案相关内容", response.answer_text)

    def test_curriculum_named_document_query_with_low_title_score_still_completes(self) -> None:
        evidence = EvidenceBundle(
            query_text="民族学本科人才培养方案",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:民族学本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ethnology-intro",
                    chunk_id="curriculum:民族学本科人才培养方案:chunk-0001",
                    anchor={"page_start": 1, "page_end": 1},
                    canonical_url="https://campus.example/curriculum/ethnology",
                    latest_url="https://campus.example/curriculum/ethnology",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="民族学本科人才培养方案 一、培养目标。",
                    score=0.4761905,
                ),
                EvidenceSource(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ethnology-second-degree-intro",
                    chunk_id="curriculum:民族学本科第二学士学位人才培养方案:chunk-0001",
                    anchor={"page_start": 1, "page_end": 1},
                    canonical_url="https://campus.example/curriculum/ethnology-second-degree",
                    latest_url="https://campus.example/curriculum/ethnology-second-degree",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="民族学本科第二学士学位人才培养方案 一、培养目标。",
                    score=0.7,
                ),
            ),
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="民族学本科人才培养方案",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.confidence, "medium")
        self.assertIn("民族学本科人才培养方案", response.answer_text)

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
            SpecialistRequest(
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
            SpecialistRequest(
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
            SpecialistRequest(
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
            SpecialistRequest(
                target="rag-agent",
                user_goal="评审办法里第一作者不是本校也能拿第二作者的分吧？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
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
                collection="student_handbook",
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
            collection="student_handbook",
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
            SpecialistRequest(
                target="rag-agent",
                user_goal="国奖第九条里对论文和著作怎么要求的？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
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
                collection="student_handbook",
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

    def test_handbook_resolved_policy_without_supported_clause_maps_to_object_scoped_no_answer(
        self,
    ) -> None:
        retriever_call: dict[str, object] = {}
        target_doc_id = "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15"
        target_title = "中央民族大学本科学生国家奖学金评审办法"

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
                corpus="regulations",
                collection="student_handbook",
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(
            retriever_call["target_document_ids"],
            (target_doc_id,),
        )
        self.assertEqual(response.status, "no_answer")
        self.assertIn(target_title, response.answer_text)
        self.assertEqual(
            response.result.diagnostics,
            _resolved_scope_diagnostics(
                corpus="regulations",
                collection="student_handbook",
                resolved_policy_document_id=target_doc_id,
                resolved_policy_title=target_title,
                rewritten_query=retriever_call["query_text"],
                no_answer_reason="resolved_policy_clause_not_found",
                semantic_outcome="unsupported_by_evidence",
            ),
        )

    def test_handbook_resolved_policy_with_unsupported_clause_evidence_fail_closes(self) -> None:
        target_doc_id = "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15"
        target_title = "中央民族大学本科学生国家奖学金评审办法"

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            return EvidenceBundle(
                query_text=query_text,
                corpus="regulations",
                collection="student_handbook",
                sources=(
                    EvidenceSource(
                        doc_id=target_doc_id,
                        revision_track="source-faithful",
                        version_id="v1:national-scholarship",
                        chunk_id=f"{target_doc_id}:chunk-0005",
                        anchor={},
                        canonical_url="https://campus.example/handbook/national-scholarship",
                        latest_url="https://campus.example/handbook/national-scholarship",
                        source_channel="pdf_ocr",
                        collection="student_handbook",
                        is_current=True,
                        source_title=target_title,
                        snippet=(
                            "标题：中央民族大学本科学生国家奖学金评审办法 | 章节：第三章 评选条件 | 条款：第九条\n"
                            "2. 在学术研究上取得显著成绩,以第一作者发表的论文被SCI、EI、ISTP、SSCI全文收录,"
                            "以第一、二作者出版学术专著(须通过专家鉴定)。"
                        ),
                        score=0.92,
                        structural_path=("第三章 评选条件",),
                        detail_label="第九条",
                        content_role="eligibility",
                        is_answer_bearing=True,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "no_answer")
        self.assertIn(target_title, response.answer_text)
        self.assertEqual(response.result.evidence.sources, ())
        self.assertEqual(
            response.result.diagnostics.no_answer_reason, "resolved_policy_clause_not_found"
        )
        self.assertEqual(response.result.diagnostics.semantic_outcome, "unsupported_by_evidence")
        self.assertEqual(response.result.diagnostics.retrieval_adequacy_verdict, "insufficient")
        self.assertEqual(
            response.result.diagnostics.retrieval_adequacy_reason,
            "resolved_policy_clause_not_found",
        )

    def test_restricted_access_denied_for_anonymous_user_does_not_leak_resolved_policy_title(
        self,
    ) -> None:
        target_title = "中央民族大学本科学生国家奖学金评审办法"

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            raise RestrictedDocumentAccessDeniedError("restricted document access denied")

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
                context=ContextProjection(actor=ActorContext(principal_type="anonymous")),
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "no_answer")
        self.assertNotIn(target_title, response.answer_text)
        self.assertEqual(response.result.evidence.sources, ())
        self.assertIsNotNone(response.result.diagnostics)
        self.assertEqual(response.result.diagnostics.no_answer_reason, "restricted_access_denied")
        self.assertEqual(response.result.diagnostics.semantic_outcome, "restricted_access_denied")
        self.assertEqual(response.result.diagnostics.resolved_policy_title, target_title)
        self.assertEqual(response.result.diagnostics.retrieved_title_summary, ())

    def test_restricted_access_denied_for_operator_uses_explicit_safe_deny_copy(self) -> None:
        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            raise RestrictedDocumentAccessDeniedError("restricted document access denied")

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
                context=ContextProjection(actor=ActorContext(principal_type="operator")),
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "no_answer")
        self.assertIn("受限内容", response.answer_text)
        self.assertEqual(response.result.evidence.sources, ())
        self.assertIsNotNone(response.result.diagnostics)
        self.assertEqual(response.result.diagnostics.no_answer_reason, "restricted_access_denied")
        self.assertEqual(response.result.diagnostics.semantic_outcome, "restricted_access_denied")
        self.assertEqual(response.result.diagnostics.retrieved_title_summary, ())

    def test_confidence_derivation_prefers_stronger_and_more_consistent_support(self) -> None:
        self.assertEqual(
            derive_confidence(
                EvidenceBundle(
                    query_text="library hours",
                    corpus="regulations",
                    collection="student_handbook",
                )
            ),
            "low",
        )
        self.assertEqual(derive_confidence(_make_evidence(scores=(0.41,))), "low")
        self.assertEqual(derive_confidence(_make_evidence(scores=(0.58,))), "medium")
        self.assertEqual(derive_confidence(_make_evidence(scores=(0.92, 0.89))), "high")
        self.assertEqual(
            derive_confidence(
                EvidenceBundle(
                    query_text="思政课包括哪些课",
                    corpus="curriculum",
                    collection="course_facts",
                    sources=(
                        EvidenceSource(
                            doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                            revision_track="source-faithful",
                            version_id="v1:course-facts",
                            chunk_id="course-facts:family-membership",
                            anchor={"fact_type": "family_membership"},
                            canonical_url="https://campus.example/curriculum/ideological-political-theory",
                            latest_url="https://campus.example/curriculum/ideological-political-theory",
                            source_channel="pdf_ocr",
                            collection="course_facts",
                            is_current=False,
                            snippet=(
                                "思想政治理论课包括马克思主义基本原理、中国近现代史纲要、毛泽东思想和中国特色社会主义理论体系概论、"
                                "习近平新时代中国特色社会主义思想概论、思想道德与法治、形势与政策、中华民族共同体概论。"
                            ),
                            score=0.03,
                            source_title="中央民族大学通识课程思想政治理论课教学计划",
                            structural_path=("思想政治理论课",),
                            detail_label="课程内容",
                            content_kind="course_fact",
                            content_role="family_membership",
                            is_answer_bearing=True,
                        ),
                    ),
                )
            ),
            "medium",
        )
        self.assertEqual(
            derive_confidence(
                EvidenceBundle(
                    query_text="民族班有哪些",
                    corpus="curriculum",
                    collection="program_family_facts",
                    sources=(
                        EvidenceSource(
                            doc_id="program_family_facts:ethnic-class-membership",
                            revision_track="source-faithful",
                            version_id="v1:program-family-facts",
                            chunk_id="program-family-facts:ethnic-class-membership",
                            anchor={"fact_type": "family_membership"},
                            canonical_url="https://campus.example/curriculum/program-family/ethnic-class",
                            latest_url="https://campus.example/curriculum/program-family/ethnic-class",
                            source_channel="pdf_ocr",
                            collection="program_family_facts",
                            is_current=False,
                            snippet="民大的民族班有法学、信息与计算科学、计算机科学与技术。",
                            score=0.03,
                            source_title="中央民族大学民族班项目一览",
                            structural_path=("民族班",),
                            detail_label="成员专业",
                            content_kind="program_family_fact",
                            content_role="family_membership",
                            is_answer_bearing=True,
                        ),
                    ),
                )
            ),
            "medium",
        )
        self.assertEqual(
            derive_confidence(
                EvidenceBundle(
                    query_text="民族学本科人才培养方案",
                    corpus="curriculum",
                    collection="curriculum_plan",
                    sources=(
                        EvidenceSource(
                            doc_id="curriculum:民族学本科人才培养方案",
                            revision_track="source-faithful",
                            version_id="v1:ethnology-intro",
                            chunk_id="curriculum:民族学本科人才培养方案:chunk-0001",
                            anchor={},
                            canonical_url="https://campus.example/curriculum/ethnology",
                            latest_url="https://campus.example/curriculum/ethnology",
                            source_channel="pdf_ocr",
                            collection="curriculum_plan",
                            is_current=False,
                            snippet="民族学本科人才培养方案 一、培养目标。",
                            score=0.4761905,
                        ),
                    ),
                )
            ),
            "medium",
        )
