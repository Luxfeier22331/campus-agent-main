from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    ErrorInfo,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagRequestPayload,
    RagResultPayload,
    SpecialistRequest,
    SpecialistResponse,
)
from campus_retrieval_core import CorpusQueryDisabledError, RetrievalBackendError
from campus_rag_specialist.confidence import derive_confidence
from campus_rag_specialist.service import delegate_to_rag_agent


def _make_evidence(
    *,
    scores: tuple[float, ...] = (0.82, 0.77),
    snippets: tuple[str, ...] | None = None,
    doc_ids: tuple[str, ...] | None = None,
) -> EvidenceBundle:
    sources = tuple(
        EvidenceSource(
            doc_id=(doc_ids[index] if doc_ids is not None else f"handbook:test-{index + 1}"),
            revision_track="source-faithful",
            version_id=f"v1:test-{index + 1}",
            chunk_id=f"{(doc_ids[index] if doc_ids is not None else f'handbook:test-{index + 1}')}:source-faithful:v1:test-{index + 1}:chunk-0001",
            anchor={"page_start": index + 1, "page_end": index + 1},
            acl_level="public",
            canonical_url=f"https://campus.example/handbook/test-{index + 1}",
            latest_url=f"https://campus.example/handbook/test-{index + 1}",
            source_channel="pdf_ocr",
            collection="student_handbook",
            is_current=False,
            snippet=(
                snippets[index]
                if snippets is not None
                else f"Evidence snippet {index + 1} about library hours and student support."
            ),
            score=score,
        )
        for index, score in enumerate(scores)
    )
    return EvidenceBundle(
        query_text="library hours",
        corpus="regulations",
        collection="student_handbook",
        sources=sources,
    )


class RagSpecialistTest(unittest.TestCase):
    def test_blank_user_goal_is_rejected_by_request_contract(self) -> None:
        with self.assertRaisesRegex(ValueError, "user_goal"):
            SpecialistRequest(
                target="rag-specialist",
                user_goal="   ",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
                ),
            )

    def test_retrieval_error_maps_to_error_response(self) -> None:
        def raising_retriever(*args: object, **kwargs: object) -> EvidenceBundle:
            raise RetrievalBackendError("qdrant unavailable")

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="library hours",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
                ),
            ),
            retriever=raising_retriever,
        )

        self.assertEqual(
            response,
            SpecialistResponse(
                target="rag-specialist",
                status="error",
                confidence="low",
                error=ErrorInfo(
                    code="retrieval_failed",
                    message="qdrant unavailable",
                    retryable=False,
                ),
                result=RagResultPayload(
                    evidence=EvidenceBundle(
                        query_text="library hours",
                        corpus="regulations",
                        collection="student_handbook",
                    )
                ),
            ),
        )

    def test_query_disabled_corpus_maps_to_explicit_error_response(self) -> None:
        def raising_retriever(*args: object, **kwargs: object) -> EvidenceBundle:
            raise CorpusQueryDisabledError(
                "campus_services/service_catalog retrieval is disabled by runtime profile"
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="宿舍报修流程",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(
                        corpus="campus_services",
                        collection="service_catalog",
                    )
                ),
            ),
            retriever=raising_retriever,
        )

        self.assertIsInstance(response, SpecialistResponse)
        self.assertEqual(response.target, "rag-specialist")
        self.assertEqual(response.status, "error")
        self.assertEqual(response.confidence, "low")
        self.assertEqual(response.error.code, "corpus_not_query_enabled")
        self.assertIn("service_catalog", response.error.message)
        self.assertEqual(
            response.result,
            RagResultPayload(
                evidence=EvidenceBundle(
                    query_text="宿舍报修流程",
                    corpus="campus_services",
                    collection="service_catalog",
                )
            ),
        )

    def test_no_evidence_maps_to_no_answer(self) -> None:
        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="library hours",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
                ),
            ),
            retriever=lambda *args, **kwargs: EvidenceBundle(
                query_text="library hours",
                corpus="regulations",
                collection="student_handbook",
            ),
        )

        self.assertEqual(response.target, "rag-specialist")
        self.assertEqual(response.status, "no_answer")
        self.assertEqual(response.confidence, "low")
        self.assertFalse(response.answer_text)
        self.assertEqual(
            response.result,
            RagResultPayload(
                evidence=EvidenceBundle(
                    query_text="library hours",
                    corpus="regulations",
                    collection="student_handbook",
                )
            ),
        )

    def test_referential_question_maps_to_needs_clarification_without_retrieval(self) -> None:
        retriever_called = False

        def fake_retriever(*args: object, **kwargs: object) -> EvidenceBundle:
            nonlocal retriever_called
            retriever_called = True
            return _make_evidence()

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="这个规定怎么办理？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertIn("具体", response.follow_up_question)
        self.assertEqual(response.confidence, "low")
        self.assertEqual(
            response.result,
            RagResultPayload(
                evidence=EvidenceBundle(
                    query_text="这个规定怎么办理？",
                    corpus="regulations",
                    collection="student_handbook",
                )
            ),
        )
        self.assertFalse(retriever_called)

    def test_generic_scholarship_question_maps_to_needs_clarification_without_retrieval(self) -> None:
        retriever_called = False

        def fake_retriever(*args: object, **kwargs: object) -> EvidenceBundle:
            nonlocal retriever_called
            retriever_called = True
            return _make_evidence()

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="奖学金怎么申请？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertIn("奖学金", response.follow_up_question)
        self.assertFalse(retriever_called)

    def test_ambiguous_multi_policy_evidence_maps_to_needs_clarification(self) -> None:
        evidence = _make_evidence(
            scores=(0.68, 0.66),
            doc_ids=("handbook:national-scholarship", "handbook:professional-scholarship"),
            snippets=(
                "中央民族大学本科学生国家奖学金评审办法 / 第一章 总则 国家奖学金每学年评定一次。",
                "中央民族大学本科学生专业奖学金评定办法 / 第一章 总则 专业奖学金面向普通培养类型学生。",
            ),
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="国家奖学金还是专业奖学金怎么申请？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertIn("奖学金", response.follow_up_question)
        self.assertEqual(response.result, RagResultPayload(evidence=evidence))

    def test_low_support_evidence_maps_to_no_answer_instead_of_completed(self) -> None:
        evidence = _make_evidence(scores=(0.41,))

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="How do I replace my student card?",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "no_answer")
        self.assertEqual(response.confidence, "low")
        self.assertFalse(response.answer_text)
        self.assertEqual(response.result, RagResultPayload(evidence=evidence))

    def test_completed_response_uses_evidence_and_actor_context(self) -> None:
        captured_kwargs: dict[str, object] = {}

        def fake_retriever(query: str, **kwargs: object) -> EvidenceBundle:
            captured_kwargs["query"] = query
            captured_kwargs.update(kwargs)
            return _make_evidence()

        request = SpecialistRequest(
            target="rag-specialist",
            user_goal="What are the library hours?",
            actor=ActorContext(
                user_id="student-001",
                groups=("students",),
                campus_scope="north",
            ),
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
            ),
        )

        response = delegate_to_rag_agent(request, retriever=fake_retriever)

        self.assertIsInstance(response, SpecialistResponse)
        self.assertEqual(response.target, "rag-specialist")
        self.assertEqual(response.status, "completed")
        self.assertEqual(captured_kwargs["query"], "What are the library hours?")
        self.assertEqual(captured_kwargs["corpus"], "regulations")
        self.assertEqual(captured_kwargs["collection"], "student_handbook")
        self.assertEqual(captured_kwargs["acl_groups"], ("students",))
        self.assertEqual(captured_kwargs["campus_scope"], "north")
        self.assertTrue(response.answer_text)
        self.assertIn("根据学生手册相关规定", response.answer_text)
        self.assertIn("Evidence snippet 1", response.answer_text)
        self.assertIn("[handbook:test-1#", response.answer_text)
        self.assertIn("[handbook:test-2#", response.answer_text)
        self.assertEqual(response.confidence, "medium")
        self.assertEqual(response.result, RagResultPayload(evidence=_make_evidence()))

    def test_completed_answer_uses_small_deduplicated_evidence_budget(self) -> None:
        evidence = _make_evidence(
            scores=(0.84, 0.8, 0.76, 0.74),
            snippets=(
                "学生应提交书面申请并填写申请表。",
                "院系审核通过后报学校复核。",
                "学校复核后按规定办理。",
                "学校复核后按规定办理。",
            ),
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="提交书面申请后院系如何审核？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("1.", response.answer_text)
        self.assertIn("2.", response.answer_text)
        self.assertIn("3.", response.answer_text)
        self.assertNotIn("4.", response.answer_text)
        self.assertEqual(response.answer_text.count("学校复核后按规定办理。"), 1)

    def test_curriculum_completed_answer_uses_curriculum_specific_prefix(self) -> None:
        evidence = EvidenceBundle(
            query_text="民族学本科人才培养方案",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:民族学本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:test-curriculum",
                    chunk_id="curriculum:民族学本科人才培养方案:chunk-0001",
                    anchor={"page_start": 65, "page_end": 65},
                    acl_level="public",
                    canonical_url="https://campus.example/curriculum/ethnology",
                    latest_url="https://campus.example/curriculum/ethnology",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="民族学本科人才培养方案 / 五、学制 两年。",
                    score=0.83,
                ),
                EvidenceSource(
                    doc_id="curriculum:民族学本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:test-curriculum",
                    chunk_id="curriculum:民族学本科人才培养方案:chunk-0002",
                    anchor={"page_start": 66, "page_end": 66},
                    acl_level="public",
                    canonical_url="https://campus.example/curriculum/ethnology",
                    latest_url="https://campus.example/curriculum/ethnology",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="民族学本科人才培养方案 / 八、教学进程计划表。",
                    score=0.79,
                ),
            ),
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="民族学本科人才培养方案学制几年？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("根据培养方案相关内容", response.answer_text)
        self.assertNotIn("学生手册", response.answer_text)

    def test_curriculum_generic_degree_question_uses_curriculum_specific_clarification(self) -> None:
        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
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

    def test_curriculum_short_fact_answer_reorders_supporting_sources_before_confidence(self) -> None:
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
                    acl_level="public",
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
                    acl_level="public",
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
                    acl_level="public",
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
                    acl_level="public",
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
                target="rag-specialist",
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
                    acl_level="public",
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
                    acl_level="public",
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
                target="rag-specialist",
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

    def test_curriculum_named_document_fact_query_avoids_clarification_and_locks_to_target_document(self) -> None:
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
                    acl_level="public",
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
                    acl_level="public",
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
                    acl_level="public",
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
                    acl_level="public",
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
                target="rag-specialist",
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

    def test_curriculum_named_document_multi_chunk_support_allows_medium_confidence_for_low_fact_scores(self) -> None:
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
                    acl_level="public",
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
                    acl_level="public",
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
                    acl_level="public",
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
                target="rag-specialist",
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

    def test_curriculum_named_document_credit_query_allows_same_doc_multi_chunk_medium_confidence(self) -> None:
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
                    acl_level="public",
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
                    acl_level="public",
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
                    acl_level="public",
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
                target="rag-specialist",
                user_goal="民族学本科人才培养方案总学分要求是多少？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.confidence, "medium")
        self.assertIn("学分", response.answer_text)

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
                            acl_level="public",
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


if __name__ == "__main__":
    unittest.main()
