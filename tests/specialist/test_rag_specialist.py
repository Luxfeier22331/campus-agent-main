from __future__ import annotations

import unittest

from campus_contracts import (
    ActorContext,
    AuthorizedRetrievalFilter,
    AuthorizationProjection,
    ContextProjection,
    CURRICULUM_PROGRAM_FAMILY_SLOT_NAME,
    CURRICULUM_PROGRAM_SLOT_NAME,
    CURRICULUM_SEMESTER_SLOT_NAME,
    ErrorInfo,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    PersonalizationHint,
    ProfileMemoryItem,
    ProfileMemorySummary,
    RagRequestPayload,
    RagResultDiagnostics,
    RagResultPayload,
    SessionSlot,
    SessionSummary,
    SpecialistRequest,
    SpecialistResponse,
)
from campus_retrieval_core import (
    CorpusQueryDisabledError,
    RestrictedDocumentAccessDeniedError,
    RetrievalBackendError,
)
from campus_rag_specialist import RagSpecialistAgent
from campus_rag_specialist.confidence import derive_confidence
from campus_rag_specialist.intent import frame_rag_intent
from campus_rag_specialist.service import delegate_to_rag_agent
from campus_rag_specialist.query_planning import (
    plan_curriculum_course_query,
    plan_curriculum_program_family_query,
    plan_curriculum_query,
)


def _make_evidence(
    *,
    scores: tuple[float, ...] = (0.82, 0.77),
    snippets: tuple[str, ...] | None = None,
    doc_ids: tuple[str, ...] | None = None,
    query_text: str = "library hours",
) -> EvidenceBundle:
    sources = tuple(
        EvidenceSource(
            doc_id=(doc_ids[index] if doc_ids is not None else f"handbook:test-{index + 1}"),
            revision_track="source-faithful",
            version_id=f"v1:test-{index + 1}",
            chunk_id=f"{(doc_ids[index] if doc_ids is not None else f'handbook:test-{index + 1}')}:source-faithful:v1:test-{index + 1}:chunk-0001",
            anchor={"page_start": index + 1, "page_end": index + 1},
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
        query_text=query_text,
        corpus="regulations",
        collection="student_handbook",
        sources=sources,
    )


def _make_handbook_source(
    *,
    doc_id: str,
    title: str,
    snippet: str,
    score: float,
    chunk_id_suffix: str,
    detail_label: str = "",
    content_role: str = "",
    is_answer_bearing: bool = False,
) -> EvidenceSource:
    return EvidenceSource(
        doc_id=doc_id,
        revision_track="source-faithful",
        version_id=f"v1:{chunk_id_suffix}",
        chunk_id=f"{doc_id}:source-faithful:v1:{chunk_id_suffix}",
        anchor={"page_start": 1, "page_end": 1},
        canonical_url=f"https://campus.example/handbook/{doc_id}",
        latest_url=f"https://campus.example/handbook/{doc_id}",
        source_channel="pdf_ocr",
        collection="student_handbook",
        is_current=True,
        snippet=snippet,
        score=score,
        source_title=title,
        structural_path=(title,),
        detail_label=detail_label,
        content_role=content_role,
        is_answer_bearing=is_answer_bearing,
    )


class RagSpecialistTest(unittest.TestCase):
    def test_frame_rag_intent_marks_user_grounded_personalization_when_context_exists(self) -> None:
        request = SpecialistRequest(
            target="rag-specialist",
            user_goal="保研申请流程是什么？",
            context=ContextProjection(
                actor=ActorContext(
                    user_id="student-001",
                    principal_id="principal-001",
                    cohort="2023",
                    major="philosophy",
                ),
                profile_memory=ProfileMemorySummary(
                    items=(
                        ProfileMemoryItem(
                            item_id="memory-001",
                            key="recent_goal",
                            value="咨询保研",
                            source_type="user_declared",
                            confidence="high",
                            visibility="user_visible",
                            last_verified_at="2026-03-28",
                        ),
                    ),
                ),
                session=SessionSummary(
                    confirmed_slots=(SessionSlot(name="policy_topic", value="推免资格", confirmed=True),),
                    turn_count=3,
                ),
            ),
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
            ),
        )

        frame = frame_rag_intent(request)

        self.assertEqual(frame.question_kind, "procedure")
        self.assertEqual(frame.personalization_mode, "user_grounded")
        self.assertEqual(frame.response_mode, "retrieve_then_answer")
        self.assertEqual(frame.retrieval_plan, "personalized_rewrite")

    def test_blank_user_goal_is_rejected_by_request_contract(self) -> None:
        with self.assertRaisesRegex(ValueError, "user_goal"):
            SpecialistRequest(
                target="rag-specialist",
                user_goal="   ",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
                ),
            )

    def test_missing_scope_resolves_curriculum_plan_for_curriculum_query(self) -> None:
        captured_calls: list[dict[str, object]] = []

        def fake_retriever(query: str, **kwargs: object) -> EvidenceBundle:
            captured_calls.append(
                {
                    "collection": kwargs.get("collection"),
                    "corpus": kwargs.get("corpus"),
                    "query": query,
                }
            )
            return EvidenceBundle(
                query_text=query,
                corpus=str(kwargs["corpus"]),
                collection=str(kwargs["collection"]),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="民族学本科人才培养方案总学分要求是多少？",
                payload=RagRequestPayload(scope=None),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(captured_calls[0]["corpus"], "curriculum")
        self.assertEqual(captured_calls[0]["collection"], "curriculum_plan")
        assert isinstance(response.result, RagResultPayload)
        self.assertEqual(response.result.evidence.corpus, "curriculum")
        self.assertEqual(response.result.evidence.collection, "curriculum_plan")
        self.assertEqual(response.result.diagnostics.resolved_scope_corpus, "curriculum")
        self.assertEqual(response.result.diagnostics.resolved_scope_collection, "curriculum_plan")

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
        self.assertIn("未检索到足够依据", response.answer_text)
        self.assertIn("学生手册", response.answer_text)
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

    def test_contextual_clarification_mentions_recent_goal_when_available(self) -> None:
        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="这个申请条件是什么？",
                context=ContextProjection(
                    actor=ActorContext(user_id="student-001", principal_id="principal-001"),
                    profile_memory=ProfileMemorySummary(
                        items=(
                            ProfileMemoryItem(
                                item_id="memory-001",
                                key="recent_goal",
                                value="咨询保研",
                                source_type="user_declared",
                                confidence="high",
                                visibility="user_visible",
                                last_verified_at="2026-03-28",
                            ),
                        ),
                    ),
                ),
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
                ),
            ),
            retriever=lambda *args, **kwargs: _make_evidence(),
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertIn("保研", response.follow_up_question)

    def test_contextual_clarification_mentions_confirmed_slot_when_recent_goal_absent(self) -> None:
        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="这个申请条件是什么？",
                context=ContextProjection(
                    actor=ActorContext(user_id="student-001", principal_id="principal-001"),
                    session=SessionSummary(
                        confirmed_slots=(
                            SessionSlot(name="policy_topic", value="推免资格", confirmed=True),
                        ),
                        turn_count=2,
                    ),
                ),
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
                ),
            ),
            retriever=lambda *args, **kwargs: _make_evidence(),
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertIn("推免资格", response.follow_up_question)

    def test_frame_rag_intent_ignores_internal_only_profile_memory(self) -> None:
        request = SpecialistRequest(
            target="rag-specialist",
            user_goal="这个申请条件是什么？",
            context=ContextProjection(
                actor=ActorContext(user_id="student-001", principal_id="principal-001"),
                profile_memory=ProfileMemorySummary(
                    items=(
                        ProfileMemoryItem(
                            item_id="memory-001",
                            key="recent_goal",
                            value="处分申诉",
                            source_type="system_inferred",
                            confidence="high",
                            visibility="internal_only",
                            last_verified_at="2026-04-02",
                        ),
                    ),
                ),
            ),
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
            ),
        )

        frame = frame_rag_intent(request)

        self.assertEqual(frame.personalization_mode, "generic")
        self.assertEqual(frame.retrieval_plan, "default_rewrite")

        response = delegate_to_rag_agent(request, retriever=lambda *args, **kwargs: _make_evidence())

        self.assertEqual(response.status, "needs_clarification")
        self.assertNotIn("处分申诉", response.follow_up_question)

    def test_completed_response_passes_typed_personalization_hint_to_retriever(self) -> None:
        captured_kwargs: dict[str, object] = {}

        def fake_retriever(query: str, **kwargs: object) -> EvidenceBundle:
            captured_kwargs["query"] = query
            captured_kwargs.update(kwargs)
            return _make_evidence(scores=(0.82,), query_text=query)

        request = SpecialistRequest(
            target="rag-specialist",
            user_goal="保研流程是什么？",
            context=ContextProjection(
                actor=ActorContext(
                    user_id="student-001",
                    principal_id="principal-001",
                    cohort="2023",
                    major="philosophy",
                ),
                authorization=AuthorizationProjection(
                    visibility_scope="north",
                    retrieval_filter=AuthorizedRetrievalFilter(visibility_scope="north"),
                ),
                profile_memory=ProfileMemorySummary(
                    items=(
                        ProfileMemoryItem(
                            item_id="memory-001",
                            key="recent_goal",
                            value="咨询保研",
                            source_type="user_declared",
                            confidence="high",
                            visibility="user_visible",
                            last_verified_at="2026-03-28",
                        ),
                    ),
                ),
                session=SessionSummary(
                    confirmed_slots=(SessionSlot(name="policy_topic", value="推免资格", confirmed=True),),
                    turn_count=2,
                ),
            ),
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
            ),
        )

        response = delegate_to_rag_agent(request, retriever=fake_retriever)

        self.assertEqual(response.status, "completed")
        self.assertEqual(
            captured_kwargs["personalization_hint"],
            PersonalizationHint(
                actor_claim_terms=("north campus", "2023 cohort", "philosophy major"),
                recent_goal="咨询保研",
                confirmed_slot_terms=("推免资格",),
            ),
        )

    def test_ambiguous_multi_policy_evidence_maps_to_needs_clarification(self) -> None:
        retriever_called = False

        def fake_retriever(*args: object, **kwargs: object) -> EvidenceBundle:
            nonlocal retriever_called
            retriever_called = True
            return _make_evidence(
                scores=(0.68, 0.66),
                doc_ids=("handbook:national-scholarship", "handbook:professional-scholarship"),
                snippets=(
                    "中央民族大学本科学生国家奖学金评审办法 / 第一章 总则 国家奖学金每学年评定一次。",
                    "中央民族大学本科学生专业奖学金评定办法 / 第一章 总则 专业奖学金面向普通培养类型学生。",
                ),
                query_text="国家奖学金还是专业奖学金怎么申请？",
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="国家奖学金还是专业奖学金怎么申请？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertIn("奖学金", response.follow_up_question)
        self.assertFalse(retriever_called)
        self.assertEqual(
            response.result.diagnostics,
            RagResultDiagnostics(
                clarification_reason="policy_object_conflict",
            ),
        )

    def test_curriculum_ambiguous_title_fragment_maps_to_needs_clarification(self) -> None:
        evidence = EvidenceBundle(
            query_text="民族实验班",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:law-ethnic-experimental",
                    chunk_id="curriculum:法学（民族实验班）本科人才培养方案:chunk-0001",
                    anchor={"page_start": 1, "page_end": 1},
                    canonical_url="https://campus.example/curriculum/law-ethnic-experimental",
                    latest_url="https://campus.example/curriculum/law-ethnic-experimental",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="法学（民族实验班）本科人才培养方案 一、培养目标。",
                    score=0.49,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "一、培养目标"),
                ),
                EvidenceSource(
                    doc_id="curriculum:信息与计算科学（民族实验班）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ics-ethnic-experimental",
                    chunk_id="curriculum:信息与计算科学（民族实验班）本科人才培养方案:chunk-0001",
                    anchor={"page_start": 1, "page_end": 1},
                    canonical_url="https://campus.example/curriculum/ics-ethnic-experimental",
                    latest_url="https://campus.example/curriculum/ics-ethnic-experimental",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="信息与计算科学（民族实验班）本科人才培养方案 一、培养目标。",
                    score=0.48,
                    source_title="信息与计算科学（民族实验班）本科人才培养方案",
                    structural_path=("信息与计算科学（民族实验班）本科人才培养方案", "一、培养目标"),
                ),
                EvidenceSource(
                    doc_id="curriculum:计算机科学与技术（民族实验班）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:cs-ethnic-experimental",
                    chunk_id="curriculum:计算机科学与技术（民族实验班）本科人才培养方案:chunk-0001",
                    anchor={"page_start": 1, "page_end": 1},
                    canonical_url="https://campus.example/curriculum/cs-ethnic-experimental",
                    latest_url="https://campus.example/curriculum/cs-ethnic-experimental",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="计算机科学与技术（民族实验班）本科人才培养方案 一、培养目标。",
                    score=0.47,
                    source_title="计算机科学与技术（民族实验班）本科人才培养方案",
                    structural_path=("计算机科学与技术（民族实验班）本科人才培养方案", "一、培养目标"),
                ),
            ),
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="民族实验班",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertIn("民族实验班", response.follow_up_question)
        self.assertEqual(response.result, RagResultPayload(evidence=evidence))

    def test_curriculum_semester_course_query_normalizes_alias_and_avoids_cross_doc_contamination(self) -> None:
        evidence = EvidenceBundle(
            query_text="法学民族实验班培养方案里第四学期有什么课",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:law-ethnic-experimental",
                    chunk_id="curriculum:法学（民族实验班）本科人才培养方案:chunk-0004",
                    anchor={"page_start": 24, "page_end": 24},
                    canonical_url="https://campus.example/curriculum/law-ethnic-experimental",
                    latest_url="https://campus.example/curriculum/law-ethnic-experimental",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=True,
                    snippet="第四学期 侵权责任法、公司法。",
                    score=0.92,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "第四学期"),
                    detail_label="第四学期",
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
                EvidenceSource(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:law-ethnic-experimental",
                    chunk_id="curriculum:法学（民族实验班）本科人才培养方案:chunk-0005",
                    anchor={"page_start": 25, "page_end": 25},
                    canonical_url="https://campus.example/curriculum/law-ethnic-experimental",
                    latest_url="https://campus.example/curriculum/law-ethnic-experimental",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=True,
                    snippet="第四学期 翻译学导论、中国少数民族文字学。",
                    score=0.90,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "第四学期"),
                    detail_label="第四学期",
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
                EvidenceSource(
                    doc_id="curriculum:信息与计算科学（民族实验班）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ics-ethnic-experimental",
                    chunk_id="curriculum:信息与计算科学（民族实验班）本科人才培养方案:chunk-0004",
                    anchor={"page_start": 24, "page_end": 24},
                    canonical_url="https://campus.example/curriculum/ics-ethnic-experimental",
                    latest_url="https://campus.example/curriculum/ics-ethnic-experimental",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=True,
                    snippet="第四学期 常微分方程、概率论、数学分析II。",
                    score=0.88,
                    source_title="信息与计算科学（民族实验班）本科人才培养方案",
                    structural_path=("信息与计算科学（民族实验班）本科人才培养方案", "第四学期"),
                    detail_label="第四学期",
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
            ),
        )
        retriever_calls: list[str] = []

        def fake_retriever(query_text: str, *args: object, **kwargs: object) -> EvidenceBundle:
            retriever_calls.append(query_text)
            return evidence

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="法学民族班培养方案里大二下有什么课",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(retriever_calls, ["法学民族实验班培养方案里第四学期有什么课"])
        self.assertEqual(response.status, "completed")
        self.assertIn("侵权责任法", response.answer_text)
        self.assertIn("中国少数民族文字学", response.answer_text)
        self.assertNotIn("常微分方程", response.answer_text)
        self.assertEqual(
            tuple(source.doc_id for source in response.result.evidence.sources),
            (
                "curriculum:法学（民族实验班）本科人才培养方案",
                "curriculum:法学（民族实验班）本科人才培养方案",
            ),
        )
        self.assertEqual(
            tuple(source.chunk_id for source in response.result.evidence.sources),
            (
                "curriculum:法学（民族实验班）本科人才培养方案:chunk-0004",
                "curriculum:法学（民族实验班）本科人才培养方案:chunk-0005",
            ),
        )
        self.assertEqual(response.result.diagnostics.session_program_family, "民族实验班")
        self.assertEqual(response.result.diagnostics.session_program, "法学民族实验班")
        self.assertEqual(response.result.diagnostics.session_semester, "第四学期")

    def test_curriculum_semester_course_query_without_program_resolution_maps_to_needs_clarification(self) -> None:
        evidence = EvidenceBundle(
            query_text="民族实验班培养方案里第四学期有什么课",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:law-ethnic-experimental",
                    chunk_id="curriculum:法学（民族实验班）本科人才培养方案:chunk-0004",
                    anchor={"page_start": 24, "page_end": 24},
                    canonical_url="https://campus.example/curriculum/law-ethnic-experimental",
                    latest_url="https://campus.example/curriculum/law-ethnic-experimental",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=True,
                    snippet="第四学期 侵权责任法、中国少数民族文字学。",
                    score=0.92,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "第四学期"),
                    detail_label="第四学期",
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
                EvidenceSource(
                    doc_id="curriculum:信息与计算科学（民族实验班）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ics-ethnic-experimental",
                    chunk_id="curriculum:信息与计算科学（民族实验班）本科人才培养方案:chunk-0004",
                    anchor={"page_start": 24, "page_end": 24},
                    canonical_url="https://campus.example/curriculum/ics-ethnic-experimental",
                    latest_url="https://campus.example/curriculum/ics-ethnic-experimental",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=True,
                    snippet="第四学期 常微分方程、概率论、数学分析II。",
                    score=0.91,
                    source_title="信息与计算科学（民族实验班）本科人才培养方案",
                    structural_path=("信息与计算科学（民族实验班）本科人才培养方案", "第四学期"),
                    detail_label="第四学期",
                    content_kind="table_unit",
                    content_role="table_fact",
                    is_answer_bearing=True,
                ),
            ),
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="民族班培养方案里大二下有什么课",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertIn("培养方案", response.follow_up_question)

    def test_curriculum_follow_up_program_fragment_uses_recent_goal_to_resolve_family_then_semester(self) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="curriculum_plan",
                sources=(
                    EvidenceSource(
                        doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                        revision_track="source-faithful",
                        version_id="v1:law-ethnic-experimental",
                        chunk_id="curriculum:法学（民族实验班）本科人才培养方案:chunk-0004",
                        anchor={"page_start": 24, "page_end": 24},
                    canonical_url="https://campus.example/curriculum/law-ethnic-experimental",
                    latest_url="https://campus.example/curriculum/law-ethnic-experimental",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=True,
                    snippet="第四学期 侵权责任法、翻译学导论、中国少数民族文字学。",
                    score=0.92,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "第四学期"),
                    detail_label="第四学期",
                    content_kind="table_unit",
                        content_role="table_fact",
                        is_answer_bearing=True,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="法学",
                context=ContextProjection(
                    actor=ActorContext(user_id="student-001", principal_id="principal-001"),
                    profile_memory=ProfileMemorySummary(
                        items=(
                            ProfileMemoryItem(
                                item_id="memory-001",
                                key="recent_goal",
                                value="民族班培养方案里大二下有什么课",
                                source_type="user_declared",
                                confidence="high",
                                visibility="user_visible",
                                last_verified_at="2026-04-03",
                            ),
                        ),
                    ),
                ),
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(
            retriever_call["query_text"],
            "法学民族实验班培养方案里第四学期有什么课",
        )
        self.assertEqual(
            retriever_call["target_document_ids"],
            ("curriculum:法学（民族实验班）本科人才培养方案",),
        )
        self.assertIn("侵权责任法", response.answer_text)

    def test_curriculum_follow_up_semester_fragment_uses_recent_goal_to_continue_same_program(self) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="curriculum_plan",
                sources=(
                    EvidenceSource(
                        doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                        revision_track="source-faithful",
                        version_id="v1:law-ethnic-experimental",
                        chunk_id="curriculum:法学（民族实验班）本科人才培养方案:chunk-0004",
                        anchor={"page_start": 24, "page_end": 24},
                    canonical_url="https://campus.example/curriculum/law-ethnic-experimental",
                    latest_url="https://campus.example/curriculum/law-ethnic-experimental",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=True,
                    snippet="第四学期 侵权责任法、翻译学导论、中国少数民族文字学。",
                    score=0.92,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "第四学期"),
                    detail_label="第四学期",
                    content_kind="table_unit",
                        content_role="table_fact",
                        is_answer_bearing=True,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="那大二下呢",
                context=ContextProjection(
                    actor=ActorContext(user_id="student-001", principal_id="principal-001"),
                    profile_memory=ProfileMemorySummary(
                        items=(
                            ProfileMemoryItem(
                                item_id="memory-001",
                                key="recent_goal",
                                value="法学民族班培养方案里大一上有什么课",
                                source_type="user_declared",
                                confidence="high",
                                visibility="user_visible",
                                last_verified_at="2026-04-03",
                            ),
                        ),
                    ),
                ),
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(
            retriever_call["query_text"],
            "法学民族实验班培养方案里第四学期有什么课",
        )
        self.assertEqual(
            retriever_call["target_document_ids"],
            ("curriculum:法学（民族实验班）本科人才培养方案",),
        )
        self.assertIn("中国少数民族文字学", response.answer_text)

    def test_curriculum_follow_up_program_fragment_prefers_typed_session_slots_over_stale_recent_goal(self) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="curriculum_plan",
                sources=(
                    EvidenceSource(
                        doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                        revision_track="source-faithful",
                        version_id="v1:law-ethnic-experimental",
                        chunk_id="curriculum:法学（民族实验班）本科人才培养方案:chunk-0004",
                        anchor={"page_start": 24, "page_end": 24},
                    canonical_url="https://campus.example/curriculum/law-ethnic-experimental",
                    latest_url="https://campus.example/curriculum/law-ethnic-experimental",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=True,
                    snippet="第四学期 侵权责任法、翻译学导论、中国少数民族文字学。",
                    score=0.92,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "第四学期"),
                    detail_label="第四学期",
                    content_kind="table_unit",
                        content_role="table_fact",
                        is_answer_bearing=True,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="法学",
                context=ContextProjection(
                    actor=ActorContext(user_id="student-001", principal_id="principal-001"),
                    profile_memory=ProfileMemorySummary(
                        items=(
                            ProfileMemoryItem(
                                item_id="memory-001",
                                key="recent_goal",
                                value="民族班培养方案里大一上有什么课",
                                source_type="user_declared",
                                confidence="high",
                                visibility="user_visible",
                                last_verified_at="2026-04-03",
                            ),
                        ),
                    ),
                    session=SessionSummary(
                        confirmed_slots=(
                            SessionSlot(
                                name=CURRICULUM_PROGRAM_FAMILY_SLOT_NAME,
                                value="民族实验班",
                                confirmed=True,
                            ),
                            SessionSlot(
                                name=CURRICULUM_SEMESTER_SLOT_NAME,
                                value="第四学期",
                                confirmed=True,
                            ),
                        ),
                        turn_count=4,
                    ),
                ),
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["query_text"], "法学民族实验班培养方案里第四学期有什么课")
        self.assertEqual(
            retriever_call["target_document_ids"],
            ("curriculum:法学（民族实验班）本科人才培养方案",),
        )
        self.assertEqual(response.result.diagnostics.session_program_family, "民族实验班")
        self.assertEqual(response.result.diagnostics.session_program, "法学民族实验班")
        self.assertEqual(response.result.diagnostics.session_semester, "第四学期")

    def test_curriculum_follow_up_semester_fragment_prefers_typed_program_slot_over_stale_recent_goal(self) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="curriculum_plan",
                sources=(
                    EvidenceSource(
                        doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                        revision_track="source-faithful",
                        version_id="v1:law-ethnic-experimental",
                        chunk_id="curriculum:法学（民族实验班）本科人才培养方案:chunk-0004",
                        anchor={"page_start": 24, "page_end": 24},
                    canonical_url="https://campus.example/curriculum/law-ethnic-experimental",
                    latest_url="https://campus.example/curriculum/law-ethnic-experimental",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=True,
                    snippet="第四学期 侵权责任法、翻译学导论、中国少数民族文字学。",
                    score=0.92,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "第四学期"),
                    detail_label="第四学期",
                    content_kind="table_unit",
                        content_role="table_fact",
                        is_answer_bearing=True,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="那大二下呢",
                context=ContextProjection(
                    actor=ActorContext(user_id="student-001", principal_id="principal-001"),
                    profile_memory=ProfileMemorySummary(
                        items=(
                            ProfileMemoryItem(
                                item_id="memory-001",
                                key="recent_goal",
                                value="信息与计算科学民族班培养方案里大一上有什么课",
                                source_type="user_declared",
                                confidence="high",
                                visibility="user_visible",
                                last_verified_at="2026-04-03",
                            ),
                        ),
                    ),
                    session=SessionSummary(
                        confirmed_slots=(
                            SessionSlot(
                                name=CURRICULUM_PROGRAM_SLOT_NAME,
                                value="法学民族实验班",
                                confirmed=True,
                            ),
                            SessionSlot(
                                name=CURRICULUM_SEMESTER_SLOT_NAME,
                                value="第一学期",
                                confirmed=True,
                            ),
                        ),
                        turn_count=5,
                    ),
                ),
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["query_text"], "法学民族实验班培养方案里第四学期有什么课")
        self.assertEqual(
            retriever_call["target_document_ids"],
            ("curriculum:法学（民族实验班）本科人才培养方案",),
        )

    def test_curriculum_generic_base_class_with_verified_major_prefers_clarification_over_silent_resolution(self) -> None:
        retriever_called = False

        def fake_retriever(*args: object, **kwargs: object) -> EvidenceBundle:
            nonlocal retriever_called
            retriever_called = True
            return _make_evidence(query_text="基地班")

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="基地班",
                context=ContextProjection(
                    actor=ActorContext(
                        user_id="student-001",
                        principal_id="principal-001",
                        major="历史学",
                    ),
                ),
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertFalse(retriever_called)

    def test_curriculum_deictic_query_with_verified_major_prefers_major_scoped_candidate(self) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="curriculum_plan",
                sources=(
                    EvidenceSource(
                        doc_id="curriculum:历史学（强基计划）本科人才培养方案",
                        revision_track="source-faithful",
                        version_id="v1:history-strong-base",
                        chunk_id="curriculum:历史学（强基计划）本科人才培养方案:chunk-0004",
                        anchor={"page_start": 24, "page_end": 24},
                        canonical_url="https://campus.example/curriculum/history-strong-base",
                        latest_url="https://campus.example/curriculum/history-strong-base",
                        source_channel="pdf_ocr",
                        collection="curriculum_plan",
                        is_current=True,
                        snippet="第四学期 中国史学史、史学理论专题。",
                        score=0.92,
                        source_title="历史学（强基计划）本科人才培养方案",
                        structural_path=("历史学（强基计划）本科人才培养方案", "第四学期"),
                        detail_label="第四学期",
                        content_kind="table_unit",
                        content_role="table_fact",
                        is_answer_bearing=True,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="我这个专业的基地班大二下有什么课",
                context=ContextProjection(
                    actor=ActorContext(
                        user_id="student-001",
                        principal_id="principal-001",
                        major="历史学",
                    ),
                ),
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(
            retriever_call["target_document_ids"],
            ("curriculum:历史学（强基计划）本科人才培养方案",),
        )
        self.assertEqual(retriever_call["preferred_document_ids"], ())
        self.assertIn("中国史学史", response.answer_text)
        self.assertEqual(response.result.diagnostics.session_program_family, "强基计划")
        self.assertEqual(response.result.diagnostics.session_program, "历史学强基计划")
        self.assertEqual(response.result.diagnostics.session_semester, "第四学期")

    def test_curriculum_generic_base_class_clarification_records_soft_bias_without_identity_resolution(self) -> None:
        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="基地班",
                context=ContextProjection(
                    actor=ActorContext(
                        user_id="student-001",
                        principal_id="principal-001",
                        major="历史学",
                    ),
                ),
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=lambda *args, **kwargs: _make_evidence(query_text="基地班"),
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertEqual(response.result.diagnostics.clarification_reason, "curriculum_program_family_alias")
        self.assertEqual(response.result.diagnostics.resolution_mode, "needs_clarification")
        self.assertFalse(response.result.diagnostics.used_verified_identity)
        self.assertTrue(response.result.diagnostics.used_soft_preference)
        self.assertEqual(
            response.result.diagnostics.candidate_title_summary[0],
            "历史学（强基计划）本科人才培养方案",
        )
        self.assertIn(
            "哲学（强基计划）本科人才培养方案",
            response.result.diagnostics.candidate_title_summary,
        )
        self.assertIn(
            "中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案",
            response.result.diagnostics.candidate_title_summary,
        )

    def test_curriculum_deictic_resolution_records_verified_identity_diagnostics(self) -> None:
        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="我这个专业的基地班大二下有什么课",
                context=ContextProjection(
                    actor=ActorContext(
                        user_id="student-001",
                        principal_id="principal-001",
                        major="历史学",
                    ),
                ),
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=lambda *args, **kwargs: EvidenceBundle(
                query_text="我这个专业的基地班大二下有什么课",
                corpus="curriculum",
                collection="curriculum_plan",
                sources=(),
            ),
        )

        self.assertEqual(response.status, "no_answer")
        self.assertEqual(
            response.result.diagnostics,
            RagResultDiagnostics(
                resolved_policy_document_id="curriculum:历史学（强基计划）本科人才培养方案",
                resolved_policy_title="历史学（强基计划）本科人才培养方案",
                rewritten_query="历史学（强基计划）本科人才培养方案 我这个专业的基地班第四学期有什么课",
                resolution_mode="resolved_single",
                used_verified_identity=True,
                used_soft_preference=False,
            ),
        )

    def test_curriculum_deictic_experimental_class_with_verified_major_still_needs_clarification(self) -> None:
        retriever_called = False

        def fake_retriever(*args: object, **kwargs: object) -> EvidenceBundle:
            nonlocal retriever_called
            retriever_called = True
            return _make_evidence(query_text="我这个专业的实验班大二下有什么课")

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="我这个专业的实验班大二下有什么课",
                context=ContextProjection(
                    actor=ActorContext(
                        user_id="student-001",
                        principal_id="principal-001",
                        major="历史学",
                    ),
                ),
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "needs_clarification")
        self.assertFalse(retriever_called)


class CurriculumQueryPlanningTest(unittest.TestCase):
    def test_plan_curriculum_course_query_resolves_short_family_alias(self) -> None:
        plan = plan_curriculum_course_query("思政有哪些专业要上")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(plan.entity_type, "course_family")
        self.assertEqual(
            plan.canonical_course_family_id,
            "course_family:muc.ideological_political_theory",
        )

    def test_plan_curriculum_course_query_resolves_family_alias_variant(self) -> None:
        plan = plan_curriculum_course_query("思政课程包括哪些课")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(plan.entity_type, "course_family")
        self.assertEqual(
            plan.canonical_course_family_id,
            "course_family:muc.ideological_political_theory",
        )

    def test_plan_curriculum_course_query_marks_schedule_partial_answer_for_unsupported_offering_unit(self) -> None:
        plan = plan_curriculum_course_query("思政课哪个学院开，第几学期开")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(plan.entity_type, "course_family")
        self.assertEqual(plan.fact_intent, "schedule")
        self.assertEqual(plan.unsupported_fields, ("offering_unit",))
        self.assertTrue(plan.partial_answer)

    def test_plan_curriculum_course_query_resolves_short_family_schedule_alias_variant(self) -> None:
        plan = plan_curriculum_course_query("思政第几学期开")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(plan.entity_type, "course_family")
        self.assertEqual(plan.fact_intent, "schedule")
        self.assertEqual(
            plan.canonical_course_family_id,
            "course_family:muc.ideological_political_theory",
        )

    def test_plan_curriculum_course_query_resolves_family_schedule_alias_variant(self) -> None:
        plan = plan_curriculum_course_query("思政课程第几学期开")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(plan.entity_type, "course_family")
        self.assertEqual(plan.fact_intent, "schedule")
        self.assertEqual(
            plan.canonical_course_family_id,
            "course_family:muc.ideological_political_theory",
        )

    def test_plan_curriculum_course_query_resolves_sixiuke_schedule_alias(self) -> None:
        plan = plan_curriculum_course_query("思修课第几学期开")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(plan.entity_type, "course_family")
        self.assertEqual(plan.fact_intent, "schedule")
        self.assertEqual(
            plan.canonical_course_family_id,
            "course_family:muc.ideological_political_theory",
        )

    def test_plan_curriculum_course_query_resolves_single_course_schedule_alias_variant(self) -> None:
        plan = plan_curriculum_course_query("习概开设学期")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_single")
        self.assertEqual(plan.entity_type, "course")
        self.assertEqual(plan.fact_intent, "schedule")
        self.assertEqual(plan.canonical_course_id, "course:muc.xigai")

    def test_plan_curriculum_program_family_query_resolves_innovation_experimental_alias(self) -> None:
        plan = plan_curriculum_program_family_query("创新实验班有哪些")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(
            plan.canonical_program_family_id,
            "program_family:muc.innovation_class_generic",
        )

    def test_plan_curriculum_program_family_query_resolves_ethnic_experimental_membership_alias(self) -> None:
        plan = plan_curriculum_program_family_query("民族实验班有哪些")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(
            plan.canonical_program_family_id,
            "program_family:muc.ethnic_experimental_class",
        )

    def test_plan_curriculum_program_family_query_resolves_strong_base_alias(self) -> None:
        plan = plan_curriculum_program_family_query("强基有哪些专业")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(
            plan.canonical_program_family_id,
            "program_family:muc.strong_base_plan",
        )

    def test_plan_curriculum_program_family_query_resolves_full_strong_base_alias(self) -> None:
        plan = plan_curriculum_program_family_query("强基计划有哪些专业")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(
            plan.canonical_program_family_id,
            "program_family:muc.strong_base_plan",
        )

    def test_plan_curriculum_program_family_query_resolves_second_degree_alias(self) -> None:
        plan = plan_curriculum_program_family_query("二学位有哪些专业")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(
            plan.canonical_program_family_id,
            "program_family:muc.second_bachelor_degree",
        )

    def test_plan_curriculum_program_family_query_resolves_second_degree_alias_variant(self) -> None:
        plan = plan_curriculum_program_family_query("第二学位有哪些专业")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(
            plan.canonical_program_family_id,
            "program_family:muc.second_bachelor_degree",
        )

    def test_plan_curriculum_program_family_query_resolves_full_second_degree_alias(self) -> None:
        plan = plan_curriculum_program_family_query("第二学士学位有哪些专业")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(
            plan.canonical_program_family_id,
            "program_family:muc.second_bachelor_degree",
        )

    def test_plan_curriculum_program_family_query_resolves_experimental_name_pattern_query(self) -> None:
        plan = plan_curriculum_program_family_query("名称里带实验班的培养方案有哪些")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(
            plan.canonical_program_family_id,
            "program_family:muc.experimental_class_generic",
        )

    def test_plan_curriculum_program_family_query_resolves_innovation_name_pattern_query(self) -> None:
        plan = plan_curriculum_program_family_query("名称里带创新班的培养方案有哪些")

        self.assertIsNotNone(plan)
        assert plan is not None
        self.assertEqual(plan.resolution_mode, "resolved_family")
        self.assertEqual(
            plan.canonical_program_family_id,
            "program_family:muc.innovation_class_generic",
        )

    def test_plan_curriculum_query_clarifies_generic_base_class_even_with_verified_major(self) -> None:
        plan = plan_curriculum_query(
            "基地班",
            verified_major="历史学",
        )

        self.assertEqual(plan.status, "needs_clarification")
        self.assertEqual(plan.target_document_ids, ())
        self.assertEqual(plan.preferred_document_ids, ("curriculum:历史学（强基计划）本科人才培养方案",))

    def test_plan_curriculum_query_uses_verified_major_for_deictic_query_soft_preference(self) -> None:
        plan = plan_curriculum_query(
            "我这个专业的基地班大二下有什么课",
            verified_major="历史学",
        )

        self.assertEqual(plan.status, "resolved")
        self.assertEqual(
            plan.target_document_ids,
            ("curriculum:历史学（强基计划）本科人才培养方案",),
        )
        self.assertEqual(plan.preferred_document_ids, ())
        self.assertIn("历史学（强基计划）本科人才培养方案", plan.rewritten_query_text)

    def test_course_single_audience_query_uses_course_facts_collection(self) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="course_facts",
                sources=(
                    EvidenceSource(
                        doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                        revision_track="source-faithful",
                        version_id="v1:course-facts",
                        chunk_id="course-facts:xigai:audience",
                        anchor={"fact_type": "audience"},
                        canonical_url="https://campus.example/curriculum/ideological-political-theory",
                        latest_url="https://campus.example/curriculum/ideological-political-theory",
                        source_channel="pdf_ocr",
                        collection="course_facts",
                        is_current=False,
                        snippet="习近平新时代中国特色社会主义思想概论面向所有本预科学生。",
                        score=0.93,
                        source_title="中央民族大学通识课程思想政治理论课教学计划",
                        structural_path=("思想政治理论课",),
                        detail_label="修读要求",
                        content_kind="course_fact",
                        content_role="audience",
                        is_answer_bearing=True,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="习概有哪些专业要上",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["corpus"], "curriculum")
        self.assertEqual(retriever_call["collection"], "course_facts")
        self.assertEqual(retriever_call["canonical_course_ids"], ("course:muc.xigai",))
        self.assertEqual(retriever_call["canonical_course_family_ids"], ())
        self.assertIn("所有本预科学生", response.answer_text)
        self.assertEqual(
            response.result.diagnostics,
            RagResultDiagnostics(
                resolution_mode="resolved_single",
                resolved_entity_type="course",
                resolved_course_id="course:muc.xigai",
                resolved_course_title="习近平新时代中国特色社会主义思想概论",
                retrieved_title_summary=("中央民族大学通识课程思想政治理论课教学计划",),
            ),
        )

    def test_course_family_membership_query_does_not_collapse_to_single_course(self) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="course_facts",
                sources=(
                    EvidenceSource(
                        doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                        revision_track="source-faithful",
                        version_id="v1:course-facts",
                        chunk_id="course-facts:family:members",
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
                        score=0.95,
                        source_title="中央民族大学通识课程思想政治理论课教学计划",
                        structural_path=("思想政治理论课",),
                        detail_label="课程内容",
                        content_kind="course_fact",
                        content_role="family_membership",
                        is_answer_bearing=True,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="思政课包括哪些课",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["collection"], "course_facts")
        self.assertEqual(retriever_call["canonical_course_ids"], ())
        self.assertEqual(
            retriever_call["canonical_course_family_ids"],
            ("course_family:muc.ideological_political_theory",),
        )
        self.assertIn("习近平新时代中国特色社会主义思想概论", response.answer_text)
        self.assertIn("中华民族共同体概论", response.answer_text)
        self.assertEqual(
            response.result.diagnostics,
            RagResultDiagnostics(
                resolution_mode="resolved_family",
                resolved_entity_type="course_family",
                resolved_course_family_id="course_family:muc.ideological_political_theory",
                resolved_course_family_title="思想政治理论课",
                retrieved_title_summary=("中央民族大学通识课程思想政治理论课教学计划",),
            ),
        )

    def test_course_family_partial_answer_marks_unsupported_offering_unit(self) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="course_facts",
                sources=(
                    EvidenceSource(
                        doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                        revision_track="source-faithful",
                        version_id="v1:course-facts",
                        chunk_id="course-facts:family:audience",
                        anchor={"fact_type": "audience"},
                        canonical_url="https://campus.example/curriculum/ideological-political-theory",
                        latest_url="https://campus.example/curriculum/ideological-political-theory",
                        source_channel="pdf_ocr",
                        collection="course_facts",
                        is_current=False,
                        snippet="思想政治理论课为全校性公共必修课，所有本预科学生应认真完成上述7门课程设置的各教学环节。",
                        score=0.92,
                        source_title="中央民族大学通识课程思想政治理论课教学计划",
                        structural_path=("思想政治理论课",),
                        detail_label="修读要求",
                        content_kind="course_fact",
                        content_role="audience",
                        is_answer_bearing=True,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="思政课是哪个学院开的，有哪些专业要上",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["collection"], "course_facts")
        self.assertIn("所有本预科学生", response.answer_text)
        self.assertIn("当前还不能稳定确认开课学院", response.answer_text)
        self.assertEqual(
            response.result.diagnostics,
            RagResultDiagnostics(
                resolution_mode="resolved_family",
                resolved_entity_type="course_family",
                resolved_course_family_id="course_family:muc.ideological_political_theory",
                resolved_course_family_title="思想政治理论课",
                unsupported_fields=("offering_unit",),
                partial_answer=True,
                retrieved_title_summary=("中央民族大学通识课程思想政治理论课教学计划",),
            ),
        )

    def test_course_single_schedule_query_uses_course_facts_collection(self) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="course_facts",
                sources=(
                    EvidenceSource(
                        doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                        revision_track="source-faithful",
                        version_id="v1:course-facts",
                        chunk_id="course-facts:xigai:semester",
                        anchor={"fact_type": "semester"},
                        canonical_url="https://campus.example/curriculum/ideological-political-theory",
                        latest_url="https://campus.example/curriculum/ideological-political-theory",
                        source_channel="pdf_ocr",
                        collection="course_facts",
                        is_current=False,
                        snippet="习近平新时代中国特色社会主义思想概论开设学期：第1学期(理工/艺体)；第2学期(文科)。",
                        score=0.94,
                        source_title="中央民族大学通识课程思想政治理论课教学计划",
                        structural_path=("思想政治理论课", "习近平新时代中国特色社会主义思想概论"),
                        detail_label="开设学期",
                        content_kind="course_fact",
                        content_role="semester",
                        is_answer_bearing=True,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="习概第几学期开",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["collection"], "course_facts")
        self.assertEqual(retriever_call["canonical_course_ids"], ("course:muc.xigai",))
        self.assertEqual(retriever_call["canonical_course_family_ids"], ())
        self.assertIn("第1学期(理工/艺体)", response.answer_text)
        self.assertIn("第2学期(文科)", response.answer_text)
        self.assertEqual(
            response.result.diagnostics,
            RagResultDiagnostics(
                resolution_mode="resolved_single",
                resolved_entity_type="course",
                resolved_course_id="course:muc.xigai",
                resolved_course_title="习近平新时代中国特色社会主义思想概论",
                retrieved_title_summary=("中央民族大学通识课程思想政治理论课教学计划",),
            ),
        )

    def test_course_single_schedule_partial_answer_marks_unsupported_offering_unit(self) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="course_facts",
                sources=(
                    EvidenceSource(
                        doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                        revision_track="source-faithful",
                        version_id="v1:course-facts",
                        chunk_id="course-facts:xigai-semester",
                        anchor={"fact_type": "semester"},
                        canonical_url="https://campus.example/curriculum/ideological-political-theory",
                        latest_url="https://campus.example/curriculum/ideological-political-theory",
                        source_channel="pdf_ocr",
                        collection="course_facts",
                        is_current=False,
                        snippet="习近平新时代中国特色社会主义思想概论开设学期：第1学期(理工/艺体)；第2学期(文科)。",
                        score=0.94,
                        source_title="中央民族大学通识课程思想政治理论课教学计划",
                        structural_path=("思想政治理论课", "习近平新时代中国特色社会主义思想概论"),
                        detail_label="开设学期",
                        content_kind="course_fact",
                        content_role="semester",
                        is_answer_bearing=True,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="习概哪个学院开，第几学期开",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["collection"], "course_facts")
        self.assertIn("习近平新时代中国特色社会主义思想概论开设学期：第1学期(理工/艺体)；第2学期(文科)", response.answer_text)
        self.assertIn("当前还不能稳定确认开课学院", response.answer_text)
        self.assertEqual(
            response.result.diagnostics,
            RagResultDiagnostics(
                resolution_mode="resolved_single",
                resolved_entity_type="course",
                resolved_course_id="course:muc.xigai",
                resolved_course_title="习近平新时代中国特色社会主义思想概论",
                unsupported_fields=("offering_unit",),
                partial_answer=True,
                retrieved_title_summary=("中央民族大学通识课程思想政治理论课教学计划",),
            ),
        )

    def test_course_schedule_answer_uses_user_facing_wording_without_internal_course_fact_phrase(self) -> None:
        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="习概开设学期",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=lambda query_text, **kwargs: EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="course_facts",
                sources=(
                    EvidenceSource(
                        doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                        revision_track="source-faithful",
                        version_id="v1:course-facts",
                        chunk_id="course-facts:xigai-semester",
                        anchor={"fact_type": "semester"},
                        canonical_url="https://campus.example/curriculum/ideological-political-theory",
                        latest_url="https://campus.example/curriculum/ideological-political-theory",
                        source_channel="pdf_ocr",
                        collection="course_facts",
                        is_current=False,
                        snippet="习近平新时代中国特色社会主义思想概论开设学期：第1学期(理工/艺体)；第2学期(文科)。",
                        score=0.94,
                        source_title="中央民族大学通识课程思想政治理论课教学计划",
                        structural_path=("思想政治理论课", "习近平新时代中国特色社会主义思想概论"),
                        detail_label="开设学期",
                        content_kind="course_fact",
                        content_role="semester",
                        is_answer_bearing=True,
                    ),
                ),
            ),
        )

        self.assertEqual(response.status, "completed")
        self.assertNotIn("当前已采集的课程事实", response.answer_text)
        self.assertNotIn("课程事实", response.answer_text)

    def test_course_family_schedule_answer_uses_user_facing_wording_without_internal_course_fact_phrase(self) -> None:
        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="思政第几学期开",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=lambda query_text, **kwargs: EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="course_facts",
                sources=(
                    EvidenceSource(
                        doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                        revision_track="source-faithful",
                        version_id="v1:course-facts",
                        chunk_id="course-facts:xigai-semester",
                        anchor={"fact_type": "semester"},
                        canonical_url="https://campus.example/curriculum/ideological-political-theory",
                        latest_url="https://campus.example/curriculum/ideological-political-theory",
                        source_channel="pdf_ocr",
                        collection="course_facts",
                        is_current=False,
                        snippet="习近平新时代中国特色社会主义思想概论开设学期：第1学期(理工/艺体)；第2学期(文科)。",
                        score=0.94,
                        source_title="中央民族大学通识课程思想政治理论课教学计划",
                        structural_path=("思想政治理论课", "习近平新时代中国特色社会主义思想概论"),
                        detail_label="开设学期",
                        content_kind="course_fact",
                        content_role="semester",
                        is_answer_bearing=True,
                    ),
                    EvidenceSource(
                        doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                        revision_track="source-faithful",
                        version_id="v1:course-facts",
                        chunk_id="course-facts:marxist-semester",
                        anchor={"fact_type": "semester"},
                        canonical_url="https://campus.example/curriculum/ideological-political-theory",
                        latest_url="https://campus.example/curriculum/ideological-political-theory",
                        source_channel="pdf_ocr",
                        collection="course_facts",
                        is_current=False,
                        snippet="马克思主义基本原理开设学期：第3学期(文科)；第4学期(理工/艺体)。",
                        score=0.93,
                        source_title="中央民族大学通识课程思想政治理论课教学计划",
                        structural_path=("思想政治理论课", "马克思主义基本原理"),
                        detail_label="开设学期",
                        content_kind="course_fact",
                        content_role="semester",
                        is_answer_bearing=True,
                    ),
                ),
            ),
        )

        self.assertEqual(response.status, "completed")
        self.assertNotIn("当前已采集的课程事实", response.answer_text)
        self.assertNotIn("课程事实", response.answer_text)

    def test_course_family_schedule_query_returns_structured_multi_course_answer(self) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="course_facts",
                sources=(
                    EvidenceSource(
                        doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                        revision_track="source-faithful",
                        version_id="v1:course-facts",
                        chunk_id="course-facts:history:outline-semester",
                        anchor={"fact_type": "semester"},
                        canonical_url="https://campus.example/curriculum/ideological-political-theory",
                        latest_url="https://campus.example/curriculum/ideological-political-theory",
                        source_channel="pdf_ocr",
                        collection="course_facts",
                        is_current=False,
                        snippet="中国近现代史纲要开设学期：第1学期(文科)；第2学期(理工/艺体)。",
                        score=0.96,
                        source_title="中央民族大学通识课程思想政治理论课教学计划",
                        structural_path=("思想政治理论课", "中国近现代史纲要"),
                        detail_label="开设学期",
                        content_kind="course_fact",
                        content_role="semester",
                        is_answer_bearing=True,
                    ),
                    EvidenceSource(
                        doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                        revision_track="source-faithful",
                        version_id="v1:course-facts",
                        chunk_id="course-facts:ideological-rule-law-semester",
                        anchor={"fact_type": "semester"},
                        canonical_url="https://campus.example/curriculum/ideological-political-theory",
                        latest_url="https://campus.example/curriculum/ideological-political-theory",
                        source_channel="pdf_ocr",
                        collection="course_facts",
                        is_current=False,
                        snippet="思想道德与法治开设学期：第1学期(理工/艺体)；第2学期(文科)。",
                        score=0.95,
                        source_title="中央民族大学通识课程思想政治理论课教学计划",
                        structural_path=("思想政治理论课", "思想道德与法治"),
                        detail_label="开设学期",
                        content_kind="course_fact",
                        content_role="semester",
                        is_answer_bearing=True,
                    ),
                    EvidenceSource(
                        doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                        revision_track="source-faithful",
                        version_id="v1:course-facts",
                        chunk_id="course-facts:xigai-semester",
                        anchor={"fact_type": "semester"},
                        canonical_url="https://campus.example/curriculum/ideological-political-theory",
                        latest_url="https://campus.example/curriculum/ideological-political-theory",
                        source_channel="pdf_ocr",
                        collection="course_facts",
                        is_current=False,
                        snippet="习近平新时代中国特色社会主义思想概论开设学期：第1学期(理工/艺体)；第2学期(文科)。",
                        score=0.94,
                        source_title="中央民族大学通识课程思想政治理论课教学计划",
                        structural_path=("思想政治理论课", "习近平新时代中国特色社会主义思想概论"),
                        detail_label="开设学期",
                        content_kind="course_fact",
                        content_role="semester",
                        is_answer_bearing=True,
                    ),
                    EvidenceSource(
                        doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                        revision_track="source-faithful",
                        version_id="v1:course-facts",
                        chunk_id="course-facts:marxist-semester",
                        anchor={"fact_type": "semester"},
                        canonical_url="https://campus.example/curriculum/ideological-political-theory",
                        latest_url="https://campus.example/curriculum/ideological-political-theory",
                        source_channel="pdf_ocr",
                        collection="course_facts",
                        is_current=False,
                        snippet="马克思主义基本原理开设学期：第3学期(文科)；第4学期(理工/艺体)。",
                        score=0.93,
                        source_title="中央民族大学通识课程思想政治理论课教学计划",
                        structural_path=("思想政治理论课", "马克思主义基本原理"),
                        detail_label="开设学期",
                        content_kind="course_fact",
                        content_role="semester",
                        is_answer_bearing=True,
                    ),
                    EvidenceSource(
                        doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                        revision_track="source-faithful",
                        version_id="v1:course-facts",
                        chunk_id="course-facts:mao-semester",
                        anchor={"fact_type": "semester"},
                        canonical_url="https://campus.example/curriculum/ideological-political-theory",
                        latest_url="https://campus.example/curriculum/ideological-political-theory",
                        source_channel="pdf_ocr",
                        collection="course_facts",
                        is_current=False,
                        snippet="毛泽东思想和中国特色社会主义理论体系概论开设学期：第3学期。",
                        score=0.92,
                        source_title="中央民族大学通识课程思想政治理论课教学计划",
                        structural_path=("思想政治理论课", "毛泽东思想和中国特色社会主义理论体系概论"),
                        detail_label="开设学期",
                        content_kind="course_fact",
                        content_role="semester",
                        is_answer_bearing=True,
                    ),
                    EvidenceSource(
                        doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                        revision_track="source-faithful",
                        version_id="v1:course-facts",
                        chunk_id="course-facts:situation-policy-semester",
                        anchor={"fact_type": "semester"},
                        canonical_url="https://campus.example/curriculum/ideological-political-theory",
                        latest_url="https://campus.example/curriculum/ideological-political-theory",
                        source_channel="pdf_ocr",
                        collection="course_facts",
                        is_current=False,
                        snippet="形势与政策开设学期：第1至第8学期。",
                        score=0.91,
                        source_title="中央民族大学通识课程思想政治理论课教学计划",
                        structural_path=("思想政治理论课", "形势与政策"),
                        detail_label="开设学期",
                        content_kind="course_fact",
                        content_role="semester",
                        is_answer_bearing=True,
                    ),
                    EvidenceSource(
                        doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                        revision_track="source-faithful",
                        version_id="v1:course-facts",
                        chunk_id="course-facts:minzuguailun-semester",
                        anchor={"fact_type": "semester"},
                        canonical_url="https://campus.example/curriculum/ideological-political-theory",
                        latest_url="https://campus.example/curriculum/ideological-political-theory",
                        source_channel="pdf_ocr",
                        collection="course_facts",
                        is_current=False,
                        snippet="中华民族共同体概论开设学期：第2学期。",
                        score=0.90,
                        source_title="中央民族大学通识课程思想政治理论课教学计划",
                        structural_path=("思想政治理论课", "中华民族共同体概论"),
                        detail_label="开设学期",
                        content_kind="course_fact",
                        content_role="semester",
                        is_answer_bearing=True,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="思政课第几学期开",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["collection"], "course_facts")
        self.assertEqual(retriever_call["canonical_course_ids"], ())
        self.assertEqual(
            retriever_call["canonical_course_family_ids"],
            ("course_family:muc.ideological_political_theory",),
        )
        self.assertGreaterEqual(retriever_call["top_k"], 7)
        self.assertIn("思想政治理论课各课程开设学期如下", response.answer_text)
        self.assertIn("中国近现代史纲要：第1学期(文科)；第2学期(理工/艺体)", response.answer_text)
        self.assertIn("马克思主义基本原理：第3学期(文科)；第4学期(理工/艺体)", response.answer_text)
        self.assertIn("毛泽东思想和中国特色社会主义理论体系概论：第3学期", response.answer_text)
        self.assertIn("形势与政策：第1至第8学期", response.answer_text)
        self.assertIn("中华民族共同体概论：第2学期", response.answer_text)
        self.assertNotIn("根据当前已采集的课程事实，思想政治理论课：", response.answer_text)
        self.assertEqual(
            response.result.diagnostics,
            RagResultDiagnostics(
                resolution_mode="resolved_family",
                resolved_entity_type="course_family",
                resolved_course_family_id="course_family:muc.ideological_political_theory",
                resolved_course_family_title="思想政治理论课",
                retrieved_title_summary=("中央民族大学通识课程思想政治理论课教学计划",),
            ),
        )

    def test_course_family_schedule_query_uses_partial_completeness_wording_when_family_members_are_missing(self) -> None:
        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="思政课第几学期开",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=lambda query_text, **kwargs: EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="course_facts",
                sources=(
                    EvidenceSource(
                        doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                        revision_track="source-faithful",
                        version_id="v1:course-facts",
                        chunk_id="course-facts:xigai-semester",
                        anchor={"fact_type": "semester"},
                        canonical_url="https://campus.example/curriculum/ideological-political-theory",
                        latest_url="https://campus.example/curriculum/ideological-political-theory",
                        source_channel="pdf_ocr",
                        collection="course_facts",
                        is_current=False,
                        snippet="习近平新时代中国特色社会主义思想概论开设学期：第1学期(理工/艺体)；第2学期(文科)。",
                        score=0.94,
                        source_title="中央民族大学通识课程思想政治理论课教学计划",
                        structural_path=("思想政治理论课", "习近平新时代中国特色社会主义思想概论"),
                        detail_label="开设学期",
                        content_kind="course_fact",
                        content_role="semester",
                        is_answer_bearing=True,
                    ),
                    EvidenceSource(
                        doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                        revision_track="source-faithful",
                        version_id="v1:course-facts",
                        chunk_id="course-facts:marxist-semester",
                        anchor={"fact_type": "semester"},
                        canonical_url="https://campus.example/curriculum/ideological-political-theory",
                        latest_url="https://campus.example/curriculum/ideological-political-theory",
                        source_channel="pdf_ocr",
                        collection="course_facts",
                        is_current=False,
                        snippet="马克思主义基本原理开设学期：第3学期(文科)；第4学期(理工/艺体)。",
                        score=0.93,
                        source_title="中央民族大学通识课程思想政治理论课教学计划",
                        structural_path=("思想政治理论课", "马克思主义基本原理"),
                        detail_label="开设学期",
                        content_kind="course_fact",
                        content_role="semester",
                        is_answer_bearing=True,
                    ),
                ),
            ),
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("目前能确认的有", response.answer_text)
        self.assertNotIn("各课程开设学期如下", response.answer_text)
        self.assertIn("马克思主义基本原理：第3学期(文科)；第4学期(理工/艺体)", response.answer_text)
        self.assertIn("习近平新时代中国特色社会主义思想概论：第1学期(理工/艺体)；第2学期(文科)", response.answer_text)

    def test_course_family_schedule_query_orders_courses_by_canonical_family_order(self) -> None:
        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            return EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="course_facts",
                sources=(
                    EvidenceSource(
                        doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                        revision_track="source-faithful",
                        version_id="v1:course-facts",
                        chunk_id="course-facts:history:outline-semester",
                        anchor={"fact_type": "semester"},
                        canonical_url="https://campus.example/curriculum/ideological-political-theory",
                        latest_url="https://campus.example/curriculum/ideological-political-theory",
                        source_channel="pdf_ocr",
                        collection="course_facts",
                        is_current=False,
                        snippet="中国近现代史纲要开设学期：第1学期(文科)；第2学期(理工/艺体)。",
                        score=0.96,
                        source_title="中央民族大学通识课程思想政治理论课教学计划",
                        structural_path=("思想政治理论课", "中国近现代史纲要"),
                        detail_label="开设学期",
                        content_kind="course_fact",
                        content_role="semester",
                        is_answer_bearing=True,
                    ),
                    EvidenceSource(
                        doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                        revision_track="source-faithful",
                        version_id="v1:course-facts",
                        chunk_id="course-facts:ideological-rule-law-semester",
                        anchor={"fact_type": "semester"},
                        canonical_url="https://campus.example/curriculum/ideological-political-theory",
                        latest_url="https://campus.example/curriculum/ideological-political-theory",
                        source_channel="pdf_ocr",
                        collection="course_facts",
                        is_current=False,
                        snippet="思想道德与法治开设学期：第1学期(理工/艺体)；第2学期(文科)。",
                        score=0.95,
                        source_title="中央民族大学通识课程思想政治理论课教学计划",
                        structural_path=("思想政治理论课", "思想道德与法治"),
                        detail_label="开设学期",
                        content_kind="course_fact",
                        content_role="semester",
                        is_answer_bearing=True,
                    ),
                    EvidenceSource(
                        doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                        revision_track="source-faithful",
                        version_id="v1:course-facts",
                        chunk_id="course-facts:xigai-semester",
                        anchor={"fact_type": "semester"},
                        canonical_url="https://campus.example/curriculum/ideological-political-theory",
                        latest_url="https://campus.example/curriculum/ideological-political-theory",
                        source_channel="pdf_ocr",
                        collection="course_facts",
                        is_current=False,
                        snippet="习近平新时代中国特色社会主义思想概论开设学期：第1学期(理工/艺体)；第2学期(文科)。",
                        score=0.94,
                        source_title="中央民族大学通识课程思想政治理论课教学计划",
                        structural_path=("思想政治理论课", "习近平新时代中国特色社会主义思想概论"),
                        detail_label="开设学期",
                        content_kind="course_fact",
                        content_role="semester",
                        is_answer_bearing=True,
                    ),
                    EvidenceSource(
                        doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                        revision_track="source-faithful",
                        version_id="v1:course-facts",
                        chunk_id="course-facts:marxist-semester",
                        anchor={"fact_type": "semester"},
                        canonical_url="https://campus.example/curriculum/ideological-political-theory",
                        latest_url="https://campus.example/curriculum/ideological-political-theory",
                        source_channel="pdf_ocr",
                        collection="course_facts",
                        is_current=False,
                        snippet="马克思主义基本原理开设学期：第3学期(文科)；第4学期(理工/艺体)。",
                        score=0.93,
                        source_title="中央民族大学通识课程思想政治理论课教学计划",
                        structural_path=("思想政治理论课", "马克思主义基本原理"),
                        detail_label="开设学期",
                        content_kind="course_fact",
                        content_role="semester",
                        is_answer_bearing=True,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="思政课第几学期开",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        marxist_index = response.answer_text.index("马克思主义基本原理：")
        history_index = response.answer_text.index("中国近现代史纲要：")
        xigai_index = response.answer_text.index("习近平新时代中国特色社会主义思想概论：")
        rule_of_law_index = response.answer_text.index("思想道德与法治：")
        self.assertLess(marxist_index, history_index)
        self.assertLess(history_index, xigai_index)
        self.assertLess(xigai_index, rule_of_law_index)

    def test_course_family_schedule_partial_answer_marks_unsupported_offering_unit(self) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="course_facts",
                sources=(
                    EvidenceSource(
                        doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                        revision_track="source-faithful",
                        version_id="v1:course-facts",
                        chunk_id="course-facts:xigai-semester",
                        anchor={"fact_type": "semester"},
                        canonical_url="https://campus.example/curriculum/ideological-political-theory",
                        latest_url="https://campus.example/curriculum/ideological-political-theory",
                        source_channel="pdf_ocr",
                        collection="course_facts",
                        is_current=False,
                        snippet="习近平新时代中国特色社会主义思想概论开设学期：第1学期(理工/艺体)；第2学期(文科)。",
                        score=0.94,
                        source_title="中央民族大学通识课程思想政治理论课教学计划",
                        structural_path=("思想政治理论课", "习近平新时代中国特色社会主义思想概论"),
                        detail_label="开设学期",
                        content_kind="course_fact",
                        content_role="semester",
                        is_answer_bearing=True,
                    ),
                    EvidenceSource(
                        doc_id="curriculum:中央民族大学通识课程思想政治理论课教学计划",
                        revision_track="source-faithful",
                        version_id="v1:course-facts",
                        chunk_id="course-facts:marxist-semester",
                        anchor={"fact_type": "semester"},
                        canonical_url="https://campus.example/curriculum/ideological-political-theory",
                        latest_url="https://campus.example/curriculum/ideological-political-theory",
                        source_channel="pdf_ocr",
                        collection="course_facts",
                        is_current=False,
                        snippet="马克思主义基本原理开设学期：第3学期(文科)；第4学期(理工/艺体)。",
                        score=0.93,
                        source_title="中央民族大学通识课程思想政治理论课教学计划",
                        structural_path=("思想政治理论课", "马克思主义基本原理"),
                        detail_label="开设学期",
                        content_kind="course_fact",
                        content_role="semester",
                        is_answer_bearing=True,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="思政课哪个学院开，第几学期开",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["collection"], "course_facts")
        self.assertIn("思想政治理论课目前能确认的有", response.answer_text)
        self.assertNotIn("思想政治理论课各课程开设学期如下", response.answer_text)
        self.assertIn("马克思主义基本原理：第3学期(文科)；第4学期(理工/艺体)", response.answer_text)
        self.assertIn("当前还不能稳定确认开课学院", response.answer_text)
        self.assertEqual(
            response.result.diagnostics,
            RagResultDiagnostics(
                resolution_mode="resolved_family",
                resolved_entity_type="course_family",
                resolved_course_family_id="course_family:muc.ideological_political_theory",
                resolved_course_family_title="思想政治理论课",
                unsupported_fields=("offering_unit",),
                partial_answer=True,
                retrieved_title_summary=("中央民族大学通识课程思想政治理论课教学计划",),
            ),
        )

    def test_program_family_membership_query_uses_program_family_facts_for_ethnic_class(self) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
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
                        score=0.96,
                        source_title="中央民族大学民族班项目一览",
                        structural_path=("民族班",),
                        detail_label="成员专业",
                        content_kind="program_family_fact",
                        content_role="family_membership",
                        is_answer_bearing=True,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="民族班有哪些",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["collection"], "program_family_facts")
        self.assertEqual(
            retriever_call["canonical_program_family_ids"],
            ("program_family:muc.ethnic_experimental_class",),
        )
        self.assertIn("法学", response.answer_text)
        self.assertIn("计算机科学与技术", response.answer_text)
        self.assertNotIn("当前已采集", response.answer_text)
        self.assertEqual(
            response.result.diagnostics,
            RagResultDiagnostics(
                resolution_mode="resolved_family",
                resolved_entity_type="program_family",
                resolved_program_family_id="program_family:muc.ethnic_experimental_class",
                resolved_program_family_title="民族班",
                retrieved_title_summary=("中央民族大学民族班项目一览",),
            ),
        )

    def test_program_family_membership_query_uses_program_family_facts_for_ethnic_experimental_alias(self) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
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
                        score=0.96,
                        source_title="中央民族大学民族班项目一览",
                        structural_path=("民族班",),
                        detail_label="成员专业",
                        content_kind="program_family_fact",
                        content_role="family_membership",
                        is_answer_bearing=True,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="民族实验班有哪些",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["collection"], "program_family_facts")
        self.assertEqual(
            retriever_call["canonical_program_family_ids"],
            ("program_family:muc.ethnic_experimental_class",),
        )
        self.assertIn("法学", response.answer_text)
        self.assertIn("计算机科学与技术", response.answer_text)


    def test_program_family_membership_query_uses_program_family_facts_for_base_class(self) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="program_family_facts",
                sources=(
                    EvidenceSource(
                        doc_id="program_family_facts:base-class-membership",
                        revision_track="source-faithful",
                        version_id="v1:program-family-facts",
                        chunk_id="program-family-facts:base-class-membership",
                        anchor={"fact_type": "family_membership"},
                        canonical_url="https://campus.example/curriculum/program-family/base-class",
                        latest_url="https://campus.example/curriculum/program-family/base-class",
                        source_channel="pdf_ocr",
                        collection="program_family_facts",
                        is_current=False,
                        snippet="民大的基地班有历史学、哲学、中国少数民族语言文学（古文字学方向）。",
                        score=0.95,
                        source_title="中央民族大学基地班项目一览",
                        structural_path=("基地班",),
                        detail_label="成员专业",
                        content_kind="program_family_fact",
                        content_role="family_membership",
                        is_answer_bearing=True,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="基地班有哪些",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["collection"], "program_family_facts")
        self.assertEqual(
            retriever_call["canonical_program_family_ids"],
            ("program_family:muc.base_class",),
        )
        self.assertIn("历史学", response.answer_text)
        self.assertIn("哲学", response.answer_text)
        self.assertNotIn("当前已采集", response.answer_text)

    def test_program_family_generic_experimental_class_returns_membership_answer(self) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="program_family_facts",
                sources=(
                    EvidenceSource(
                        doc_id="program_family_facts:experimental-class-membership",
                        revision_track="source-faithful",
                        version_id="v1:program-family-facts",
                        chunk_id="program-family-facts:experimental-class-membership",
                        anchor={"fact_type": "family_membership"},
                        canonical_url="https://campus.example/curriculum/program-family/experimental-class",
                        latest_url="https://campus.example/curriculum/program-family/experimental-class",
                        source_channel="pdf_ocr",
                        collection="program_family_facts",
                        is_current=False,
                        snippet=(
                            "按当前已采集的培养方案，名称里带“实验班”的有孝通实验班、法学（民族实验班）、"
                            "信息与计算科学（民族实验班）、计算机科学与技术（民族实验班）、"
                            "理工科交叉创新人才培养实验班、光电科学与工程创新实验班。"
                        ),
                        score=0.95,
                        source_title="中央民族大学实验班相关培养方案一览",
                        structural_path=("实验班相关培养方案",),
                        detail_label="成员培养方案",
                        content_kind="program_family_fact",
                        content_role="family_membership",
                        is_answer_bearing=True,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="实验班有哪些",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["collection"], "program_family_facts")
        self.assertEqual(
            retriever_call["canonical_program_family_ids"],
            ("program_family:muc.experimental_class_generic",),
        )
        self.assertIn("当前已采集", response.answer_text)
        self.assertIn("孝通实验班", response.answer_text)
        self.assertIn("光电科学与工程创新实验班", response.answer_text)

    def test_program_family_generic_innovation_class_returns_membership_answer(self) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="program_family_facts",
                sources=(
                    EvidenceSource(
                        doc_id="program_family_facts:innovation-class-membership",
                        revision_track="source-faithful",
                        version_id="v1:program-family-facts",
                        chunk_id="program-family-facts:innovation-class-membership",
                        anchor={"fact_type": "family_membership"},
                        canonical_url="https://campus.example/curriculum/program-family/innovation-class",
                        latest_url="https://campus.example/curriculum/program-family/innovation-class",
                        source_channel="pdf_ocr",
                        collection="program_family_facts",
                        is_current=False,
                        snippet=(
                            "按当前已采集的培养方案，名称里带“创新班”或“创新实验班”的有经济学拔尖人才创新班、"
                            "理工科交叉创新人才培养实验班、光电科学与工程创新实验班。"
                        ),
                        score=0.95,
                        source_title="中央民族大学创新班相关培养方案一览",
                        structural_path=("创新班相关培养方案",),
                        detail_label="成员培养方案",
                        content_kind="program_family_fact",
                        content_role="family_membership",
                        is_answer_bearing=True,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="创新班有哪些",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["collection"], "program_family_facts")
        self.assertEqual(
            retriever_call["canonical_program_family_ids"],
            ("program_family:muc.innovation_class_generic",),
        )
        self.assertIn("当前已采集", response.answer_text)
        self.assertIn("经济学拔尖人才创新班", response.answer_text)
        self.assertIn("光电科学与工程创新实验班", response.answer_text)

    def test_program_family_innovation_experimental_alias_returns_membership_answer(self) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="program_family_facts",
                sources=(
                    EvidenceSource(
                        doc_id="program_family_facts:innovation-class-membership",
                        revision_track="source-faithful",
                        version_id="v1:program-family-facts",
                        chunk_id="program-family-facts:innovation-class-membership",
                        anchor={"fact_type": "family_membership"},
                        canonical_url="https://campus.example/curriculum/program-family/innovation-class",
                        latest_url="https://campus.example/curriculum/program-family/innovation-class",
                        source_channel="pdf_ocr",
                        collection="program_family_facts",
                        is_current=False,
                        snippet=(
                            "按当前已采集的培养方案，名称里带“创新班”或“创新实验班”的有经济学拔尖人才创新班、"
                            "理工科交叉创新人才培养实验班、光电科学与工程创新实验班。"
                        ),
                        score=0.95,
                        source_title="中央民族大学创新班相关培养方案一览",
                        structural_path=("创新班相关培养方案",),
                        detail_label="成员培养方案",
                        content_kind="program_family_fact",
                        content_role="family_membership",
                        is_answer_bearing=True,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="创新实验班有哪些",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["collection"], "program_family_facts")
        self.assertEqual(
            retriever_call["canonical_program_family_ids"],
            ("program_family:muc.innovation_class_generic",),
        )
        self.assertIn("当前已采集", response.answer_text)
        self.assertIn("经济学拔尖人才创新班", response.answer_text)
        self.assertIn("光电科学与工程创新实验班", response.answer_text)

    def test_program_family_strong_base_returns_membership_answer(self) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="program_family_facts",
                sources=(
                    EvidenceSource(
                        doc_id="program_family_facts:strong-base-membership",
                        revision_track="source-faithful",
                        version_id="v1:program-family-facts",
                        chunk_id="program-family-facts:strong-base-membership",
                        anchor={"fact_type": "family_membership"},
                        canonical_url="https://campus.example/curriculum/program-family/strong-base",
                        latest_url="https://campus.example/curriculum/program-family/strong-base",
                        source_channel="pdf_ocr",
                        collection="program_family_facts",
                        is_current=False,
                        snippet="按当前已采集的培养方案，强基计划有历史学、哲学、中国少数民族语言文学（古文字学方向）。",
                        score=0.95,
                        source_title="中央民族大学强基计划项目一览",
                        structural_path=("强基计划",),
                        detail_label="成员培养方案",
                        content_kind="program_family_fact",
                        content_role="family_membership",
                        is_answer_bearing=True,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="强基有哪些专业",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["collection"], "program_family_facts")
        self.assertEqual(
            retriever_call["canonical_program_family_ids"],
            ("program_family:muc.strong_base_plan",),
        )
        self.assertIn("当前已采集", response.answer_text)
        self.assertIn("历史学", response.answer_text)
        self.assertIn("中国少数民族语言文学", response.answer_text)

    def test_program_family_second_degree_returns_membership_answer(self) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="program_family_facts",
                sources=(
                    EvidenceSource(
                        doc_id="program_family_facts:second-degree-membership",
                        revision_track="source-faithful",
                        version_id="v1:program-family-facts",
                        chunk_id="program-family-facts:second-degree-membership",
                        anchor={"fact_type": "family_membership"},
                        canonical_url="https://campus.example/curriculum/program-family/second-degree",
                        latest_url="https://campus.example/curriculum/program-family/second-degree",
                        source_channel="pdf_ocr",
                        collection="program_family_facts",
                        is_current=False,
                        snippet=(
                            "按当前已采集的培养方案，第二学士学位项目有民族学、社会学、文物与博物馆学、"
                            "金融学、会计学、法学、环境工程、数据科学与大数据技术、教育学。"
                        ),
                        score=0.95,
                        source_title="中央民族大学第二学士学位项目一览",
                        structural_path=("第二学士学位",),
                        detail_label="成员培养方案",
                        content_kind="program_family_fact",
                        content_role="family_membership",
                        is_answer_bearing=True,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="二学位有哪些专业",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["collection"], "program_family_facts")
        self.assertEqual(
            retriever_call["canonical_program_family_ids"],
            ("program_family:muc.second_bachelor_degree",),
        )
        self.assertIn("当前已采集", response.answer_text)
        self.assertIn("民族学", response.answer_text)
        self.assertIn("教育学", response.answer_text)

    def test_program_family_experimental_name_pattern_query_returns_membership_answer(self) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="program_family_facts",
                sources=(
                    EvidenceSource(
                        doc_id="program_family_facts:experimental-class-membership",
                        revision_track="source-faithful",
                        version_id="v1:program-family-facts",
                        chunk_id="program-family-facts:experimental-class-membership",
                        anchor={"fact_type": "family_membership"},
                        canonical_url="https://campus.example/curriculum/program-family/experimental-class",
                        latest_url="https://campus.example/curriculum/program-family/experimental-class",
                        source_channel="pdf_ocr",
                        collection="program_family_facts",
                        is_current=False,
                        snippet=(
                            "按当前已采集的培养方案，名称里带“实验班”的有孝通实验班、法学（民族实验班）、"
                            "信息与计算科学（民族实验班）、计算机科学与技术（民族实验班）、"
                            "理工科交叉创新人才培养实验班、光电科学与工程创新实验班。"
                        ),
                        score=0.95,
                        source_title="中央民族大学实验班相关培养方案一览",
                        structural_path=("实验班相关培养方案",),
                        detail_label="成员培养方案",
                        content_kind="program_family_fact",
                        content_role="family_membership",
                        is_answer_bearing=True,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="名称里带实验班的培养方案有哪些",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["collection"], "program_family_facts")
        self.assertEqual(
            retriever_call["canonical_program_family_ids"],
            ("program_family:muc.experimental_class_generic",),
        )
        self.assertIn("名称里带“实验班”", response.answer_text)
        self.assertIn("孝通实验班", response.answer_text)

    def test_program_family_innovation_name_pattern_query_returns_membership_answer(self) -> None:
        retriever_call: dict[str, object] = {}

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            retriever_call["query_text"] = query_text
            retriever_call.update(kwargs)
            return EvidenceBundle(
                query_text=query_text,
                corpus="curriculum",
                collection="program_family_facts",
                sources=(
                    EvidenceSource(
                        doc_id="program_family_facts:innovation-class-membership",
                        revision_track="source-faithful",
                        version_id="v1:program-family-facts",
                        chunk_id="program-family-facts:innovation-class-membership",
                        anchor={"fact_type": "family_membership"},
                        canonical_url="https://campus.example/curriculum/program-family/innovation-class",
                        latest_url="https://campus.example/curriculum/program-family/innovation-class",
                        source_channel="pdf_ocr",
                        collection="program_family_facts",
                        is_current=False,
                        snippet=(
                            "按当前已采集的培养方案，名称里带“创新班”或“创新实验班”的有经济学拔尖人才创新班、"
                            "理工科交叉创新人才培养实验班、光电科学与工程创新实验班。"
                        ),
                        score=0.95,
                        source_title="中央民族大学创新班相关培养方案一览",
                        structural_path=("创新班相关培养方案",),
                        detail_label="成员培养方案",
                        content_kind="program_family_fact",
                        content_role="family_membership",
                        is_answer_bearing=True,
                    ),
                ),
            )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="名称里带创新班的培养方案有哪些",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["collection"], "program_family_facts")
        self.assertEqual(
            retriever_call["canonical_program_family_ids"],
            ("program_family:muc.innovation_class_generic",),
        )
        self.assertIn("名称里带“创新班”或“创新实验班”", response.answer_text)
        self.assertIn("光电科学与工程创新实验班", response.answer_text)

    def test_low_support_evidence_maps_to_no_answer_instead_of_completed(self) -> None:
        evidence = _make_evidence(
            scores=(0.41,),
            query_text="How do I replace my student card?",
        )

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
        self.assertIn("未检索到足够依据", response.answer_text)
        self.assertEqual(response.result, RagResultPayload(evidence=evidence))

    def test_completed_response_uses_evidence_and_actor_context(self) -> None:
        captured_kwargs: dict[str, object] = {}

        def fake_retriever(query: str, **kwargs: object) -> EvidenceBundle:
            captured_kwargs["query"] = query
            captured_kwargs.update(kwargs)
            return _make_evidence(query_text="What are the library hours?")

        request = SpecialistRequest(
            target="rag-specialist",
            user_goal="What are the library hours?",
            actor=ActorContext(
                user_id="student-001",
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
        self.assertEqual(
            captured_kwargs["authorized_filter"],
            AuthorizedRetrievalFilter(
                entitlement_groups=(),
                visibility_level="public",
                visibility_scope=None,
                policy_projection_version="phase1-authorization-projection-v1",
            ),
        )
        self.assertEqual(
            captured_kwargs["personalization_hint"],
            PersonalizationHint(
                actor_claim_terms=(),
                recent_goal="",
                confirmed_slot_terms=(),
            ),
        )
        self.assertTrue(response.answer_text)
        self.assertIn("根据学生手册相关规定", response.answer_text)
        self.assertIn("Evidence snippet 1", response.answer_text)
        self.assertIn("[handbook:test-1#", response.answer_text)
        self.assertIn("[handbook:test-2#", response.answer_text)
        self.assertEqual(response.confidence, "medium")
        self.assertEqual(
            response.result,
            RagResultPayload(evidence=_make_evidence(query_text="What are the library hours?")),
        )

    def test_delegate_passes_context_authorization_filter_to_retriever(self) -> None:
        captured_kwargs: dict[str, object] = {}

        def fake_retriever(query: str, **kwargs: object) -> EvidenceBundle:
            captured_kwargs["query"] = query
            captured_kwargs.update(kwargs)
            return _make_evidence(scores=(0.83,), query_text=query)

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="保研流程是什么？",
                context=ContextProjection(
                    actor=ActorContext(
                        user_id="student-001",
                        principal_id="principal-001",
                    ),
                    authorization=AuthorizationProjection(
                        principal_id="principal-001",
                        entitlement_snapshot_id="entitlements-2026-03-29",
                        entitlement_groups=("students",),
                        visibility_scope="north",
                        retrieval_filter=AuthorizedRetrievalFilter(
                            entitlement_groups=("students",),
                            visibility_level="public",
                            visibility_scope="north",
                            policy_projection_version="phase1-authorization-projection-v1",
                        ),
                    ),
                ),
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(
            captured_kwargs["authorized_filter"],
            AuthorizedRetrievalFilter(
                entitlement_groups=("students",),
                visibility_level="public",
                visibility_scope="north",
                policy_projection_version="phase1-authorization-projection-v1",
            ),
        )
        self.assertNotIn("acl_groups", captured_kwargs)
        self.assertNotIn("campus_scope", captured_kwargs)

    def test_completed_answer_uses_small_deduplicated_supporting_evidence_budget(self) -> None:
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
        self.assertNotIn("1.", response.answer_text)
        self.assertIn("学生应提交书面申请并填写申请表", response.answer_text)
        self.assertIn("院系审核通过后报学校复核", response.answer_text)
        self.assertLessEqual(len(response.result.evidence.sources), 3)
        self.assertEqual(
            len({source.chunk_id for source in response.result.evidence.sources}),
            len(response.result.evidence.sources),
        )
        self.assertLessEqual(response.answer_text.count("学校复核后按规定办理。"), 1)

    def test_completed_response_keeps_only_supporting_sources_and_excludes_background_snippets(self) -> None:
        evidence = EvidenceBundle(
            query_text="学生证丢失后怎么办理补办？",
            corpus="regulations",
            collection="student_handbook",
            sources=(
                EvidenceSource(
                    doc_id="handbook:student-card",
                    revision_track="source-faithful",
                    version_id="v1:student-card",
                    chunk_id="student-card-procedure",
                    anchor={"section_path": ["第三章 学籍管理"], "article_label": "第十二条"},
                    canonical_url="https://campus.example/handbook/student-card",
                    latest_url="https://campus.example/handbook/student-card",
                    source_channel="pdf_ocr",
                    collection="student_handbook",
                    is_current=False,
                    snippet="中央民族大学学生证管理办法\n第三章 学籍管理\n第十二条 学生证遗失后，应及时到学院挂失，填写补办申请表，经学院审批后到学生处办理。",
                    score=0.74,
                    source_title="中央民族大学学生证管理办法",
                    structural_path=("第三章 学籍管理",),
                    content_kind="text",
                    content_role="procedure",
                    detail_label="第十二条",
                    is_answer_bearing=True,
                ),
                EvidenceSource(
                    doc_id="handbook:student-card",
                    revision_track="source-faithful",
                    version_id="v1:student-card",
                    chunk_id="student-card-closing",
                    anchor={"section_path": ["附则"], "provision_label": "附则"},
                    canonical_url="https://campus.example/handbook/student-card",
                    latest_url="https://campus.example/handbook/student-card",
                    source_channel="pdf_ocr",
                    collection="student_handbook",
                    is_current=False,
                    snippet="中央民族大学学生证管理办法\n附则\n本办法由学生处负责解释。",
                    score=0.89,
                    source_title="中央民族大学学生证管理办法",
                    structural_path=("附则",),
                    content_kind="text",
                    content_role="closing_provision",
                    detail_label="附则",
                ),
                EvidenceSource(
                    doc_id="handbook:medical",
                    revision_track="source-faithful",
                    version_id="v1:medical",
                    chunk_id="medical-background",
                    anchor={"section_path": ["公费医疗"]},
                    canonical_url="https://campus.example/handbook/medical",
                    latest_url="https://campus.example/handbook/medical",
                    source_channel="pdf_ocr",
                    collection="student_handbook",
                    is_current=False,
                    snippet="公费医疗管理办法 住院报销按学校相关规定执行。",
                    score=0.78,
                    source_title="中央民族大学学生公费医疗管理办法",
                    structural_path=("公费医疗",),
                    content_kind="text",
                    content_role="scope_rule",
                    detail_label="第二条",
                ),
            ),
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="学生证丢失后怎么办理补办？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(
            [source.chunk_id for source in response.result.evidence.sources],
            ["student-card-procedure"],
        )
        self.assertIn("学生证遗失后", response.answer_text)
        self.assertNotIn("负责解释", response.answer_text)
        self.assertNotIn("公费医疗", response.answer_text)
        self.assertNotIn("1.", response.answer_text)

    def test_completed_response_focuses_student_card_reissue_on_actionable_steps(self) -> None:
        evidence = EvidenceBundle(
            query_text="学生证丢了怎么办",
            corpus="regulations",
            collection="student_handbook",
            sources=(
                EvidenceSource(
                    doc_id="handbook:e90f9707387f9e232ea88ce1c7f5328242e52389",
                    revision_track="source-faithful",
                    version_id="v1:f9c1621665f50ffbf0c02cf79cb5452bfd938d2e",
                    chunk_id="chunk-0002",
                    anchor={"page_start": 163, "page_end": 164, "section_path": ("二、学生证是",)},
                    canonical_url="https://campus.example/handbook/student-card",
                    latest_url="https://campus.example/handbook/student-card",
                    source_channel="pdf_ocr",
                    collection="student_handbook",
                    is_current=True,
                    snippet=(
                        "标题：中央民族大学本科(预科)学生证管理办法 | 章节：二、学生证是\n"
                        "文号：民大学发[2013]8号\n"
                        "学生的身份证明,学生应妥善保管,爱护使用,谨防丢失。\n"
                        "十二、丢失的学生证在补办后又找到的,应将找到的学生证交回学生处销毁。学生不得持有两个学生证。\n"
                        "十三、学生证转借他人者,一经发现,将视情节给予通报批评直至纪律处分,并停止享受半价火车票的资格。\n"
                        "十四、学生办理学生证要如实填写各项内容,不得弄虚作假。凡弄虚作假者,一经查实,给予警告及以上处分,并取消当年评定各项奖、助学金的资格。"
                    ),
                    score=0.03306011,
                    source_title="中央民族大学本科(预科)学生证管理办法",
                    structural_path=("二、学生证是",),
                    content_kind="policy_page",
                    content_role="procedure",
                    detail_label="二、学生证是",
                    is_answer_bearing=True,
                ),
                EvidenceSource(
                    doc_id="handbook:e90f9707387f9e232ea88ce1c7f5328242e52389",
                    revision_track="source-faithful",
                    version_id="v1:f9c1621665f50ffbf0c02cf79cb5452bfd938d2e",
                    chunk_id="chunk-0001",
                    anchor={"page_start": 163, "page_end": 164, "section_path": ("二、学生证是",)},
                    canonical_url="https://campus.example/handbook/student-card",
                    latest_url="https://campus.example/handbook/student-card",
                    source_channel="pdf_ocr",
                    collection="student_handbook",
                    is_current=True,
                    snippet=(
                        "标题：中央民族大学本科(预科)学生证管理办法 | 章节：二、学生证是\n"
                        "文号：民大学发[2013]8号\n"
                        "学生的身份证明,学生应妥善保管,爱护使用,谨防丢失。\n"
                        "六、学生如将学生证遗失或损坏,应及时到学院(系)挂失,写明遗失或损坏的原因、时间、地点等,并报学生处备案。如遗失不报被他人使用造成不良后果,由本人负责。\n"
                        "七、学生遗失学生证应及时申请补办。遗失或损坏的学生证,原则上可以申请补办一次。补办后如再次遗失或损坏,根据遗失或损坏的原因决定是否可以补发第二次。\n"
                        "八、学生补办学生证,必须提出书面申请,并填写《中央民族大学补办学生证申请表》(见附表)。申请表经学院(系)领导审批,并在学生本人照片背面加盖骑缝章后,到学生处办理补办手续。学生证集中补办时间为每周四下午。"
                    ),
                    score=0.03306011,
                    source_title="中央民族大学本科(预科)学生证管理办法",
                    structural_path=("二、学生证是",),
                    content_kind="policy_page",
                    content_role="time_rule",
                    detail_label="二、学生证是",
                    is_answer_bearing=True,
                ),
                EvidenceSource(
                    doc_id="handbook:e90f9707387f9e232ea88ce1c7f5328242e52389",
                    revision_track="source-faithful",
                    version_id="v1:f9c1621665f50ffbf0c02cf79cb5452bfd938d2e",
                    chunk_id="chunk-0003",
                    anchor={"page_start": 164, "page_end": 164},
                    canonical_url="https://campus.example/handbook/student-card",
                    latest_url="https://campus.example/handbook/student-card",
                    source_channel="pdf_ocr",
                    collection="student_handbook",
                    is_current=True,
                    snippet="中央民族大学本科(预科)学生证管理办法 / 十八\n文号：民大学发[2013]8号\n十八、本办法由学生处负责解释。",
                    score=0.032258064,
                    source_title="中央民族大学本科(预科)学生证管理办法",
                    structural_path=(),
                    content_kind="policy_page",
                    content_role="closing_provision",
                    detail_label="十八",
                    is_answer_bearing=False,
                ),
            ),
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="学生证丢了怎么办",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual([source.chunk_id for source in response.result.evidence.sources], ["chunk-0001"])
        self.assertIn("先", response.answer_text)
        self.assertIn("再", response.answer_text)
        self.assertIn("挂失", response.answer_text)
        self.assertIn("申请补办", response.answer_text)
        self.assertIn("书面申请", response.answer_text)
        self.assertIn("每周四下午", response.answer_text)
        self.assertLess(response.answer_text.index("挂失"), response.answer_text.index("申请补办"))
        self.assertNotIn("交回学生处销毁", response.answer_text)
        self.assertNotIn("火车票学生优惠卡", response.answer_text)
        self.assertNotIn("不予发放", response.answer_text)
        self.assertNotIn("不良后果", response.answer_text)

    def test_completed_response_keeps_only_primary_time_rule_when_it_already_answers_lighting_query(self) -> None:
        evidence = EvidenceBundle(
            query_text="宿舍照明",
            corpus="regulations",
            collection="student_handbook",
            sources=(
                EvidenceSource(
                    doc_id="handbook:2ec80263a9e7b11379281349196ceb96afa44c3b",
                    revision_track="source-faithful",
                    version_id="v1:04053b0f1ea9d0d4cbfeaf5e5381c16b67b1164f",
                    chunk_id="chunk-0001",
                    anchor={"page_start": 256, "page_end": 256, "section_path": ("一、时间安排",)},
                    canonical_url="https://campus.example/handbook/dormitory-lighting",
                    latest_url="https://campus.example/handbook/dormitory-lighting",
                    source_channel="pdf_ocr",
                    collection="student_handbook",
                    is_current=True,
                    snippet=(
                        "中央民族大学关于学生宿舍照明的管理规定 / 一、时间安排\n"
                        "文号：民大校发[2007]299号\n"
                        "1. 10月至次年5月31日:\n"
                        "亮灯时间: 周一至周五 每天早晨 5:30。\n"
                        "熄灯时间: 周日至周四 每天晚上 24:00; 23:50 提示。\n"
                        "每周五、周六晚上及复习考试期间不统一熄灯。\n"
                        "2. 6月1日至9月30日,学生宿舍不统一熄灯。\n"
                        "3. 国家法定节假日不统一熄灯。"
                    ),
                    score=0.032522473,
                    source_title="中央民族大学关于学生宿舍照明的管理规定",
                    structural_path=("一、时间安排",),
                    content_kind="policy_page",
                    content_role="time_rule",
                    detail_label="一、时间安排",
                    is_answer_bearing=True,
                ),
                EvidenceSource(
                    doc_id="handbook:2ec80263a9e7b11379281349196ceb96afa44c3b",
                    revision_track="source-faithful",
                    version_id="v1:04053b0f1ea9d0d4cbfeaf5e5381c16b67b1164f",
                    chunk_id="chunk-0003",
                    anchor={"page_start": 256, "page_end": 256},
                    canonical_url="https://campus.example/handbook/dormitory-lighting",
                    latest_url="https://campus.example/handbook/dormitory-lighting",
                    source_channel="pdf_ocr",
                    collection="student_handbook",
                    is_current=True,
                    snippet="中央民族大学关于学生宿舍照明的管理规定 / 三\n文号：民大校发[2007]299号\n三、本规定适用于本科、预科学生宿舍,研究生宿舍、留学生公寓除外。",
                    score=0.03306011,
                    source_title="中央民族大学关于学生宿舍照明的管理规定",
                    structural_path=(),
                    content_kind="policy_page",
                    content_role="scope_rule",
                    detail_label="三",
                    is_answer_bearing=True,
                ),
                EvidenceSource(
                    doc_id="handbook:2ec80263a9e7b11379281349196ceb96afa44c3b",
                    revision_track="source-faithful",
                    version_id="v1:04053b0f1ea9d0d4cbfeaf5e5381c16b67b1164f",
                    chunk_id="chunk-0002",
                    anchor={"page_start": 256, "page_end": 256, "section_path": ("二、要求:",)},
                    canonical_url="https://campus.example/handbook/dormitory-lighting",
                    latest_url="https://campus.example/handbook/dormitory-lighting",
                    source_channel="pdf_ocr",
                    collection="student_handbook",
                    is_current=True,
                    snippet=(
                        "中央民族大学关于学生宿舍照明的管理规定 / 二、要求:\n"
                        "文号：民大校发[2007]299号\n"
                        "1. 学生处、团委及后勤管理部门要加强对学生的教育和管理,引导学生自觉遵守学校制度。\n"
                        "2. 加强安全防范力度。熄灯之前学生应做好就寝准备,将不用的或可能存在安全隐患的插座及电器拔下,关闭电源,熄灯之后禁止使用蜡烛及其它明火。\n"
                        "3. 严禁私接电线及违章使用各类电器。"
                    ),
                    score=0.032795697,
                    source_title="中央民族大学关于学生宿舍照明的管理规定",
                    structural_path=("二、要求:",),
                    content_kind="policy_page",
                    content_role="procedure",
                    detail_label="二、要求:",
                    is_answer_bearing=True,
                ),
            ),
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="宿舍照明",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_handbook")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual([source.chunk_id for source in response.result.evidence.sources], ["chunk-0001"])
        self.assertIn("宿舍照明", response.answer_text)
        self.assertIn("24:00", response.answer_text)
        self.assertIn("6月1日至9月30日", response.answer_text)
        self.assertNotIn("研究生宿舍", response.answer_text)

    def test_answer_draft_exposes_statement_level_supporting_contexts(self) -> None:
        evidence = EvidenceBundle(
            query_text="宿舍照明",
            corpus="regulations",
            collection="student_handbook",
            sources=(
                EvidenceSource(
                    doc_id="handbook:2ec80263a9e7b11379281349196ceb96afa44c3b",
                    revision_track="source-faithful",
                    version_id="v1:04053b0f1ea9d0d4cbfeaf5e5381c16b67b1164f",
                    chunk_id="chunk-0001",
                    anchor={"page_start": 256, "page_end": 256, "section_path": ("一、时间安排",)},
                    canonical_url="https://campus.example/handbook/dormitory-lighting",
                    latest_url="https://campus.example/handbook/dormitory-lighting",
                    source_channel="pdf_ocr",
                    collection="student_handbook",
                    is_current=True,
                    snippet=(
                        "中央民族大学关于学生宿舍照明的管理规定 / 一、时间安排\n"
                        "文号：民大校发[2007]299号\n"
                        "1. 10月至次年5月31日:\n"
                        "亮灯时间: 周一至周五 每天早晨 5:30。\n"
                        "熄灯时间: 周日至周四 每天晚上 24:00; 23:50 提示。\n"
                        "每周五、周六晚上及复习考试期间不统一熄灯。\n"
                        "2. 6月1日至9月30日,学生宿舍不统一熄灯。\n"
                        "3. 国家法定节假日不统一熄灯。"
                    ),
                    score=0.032522473,
                    source_title="中央民族大学关于学生宿舍照明的管理规定",
                    structural_path=("一、时间安排",),
                    content_kind="policy_page",
                    content_role="time_rule",
                    detail_label="一、时间安排",
                    is_answer_bearing=True,
                ),
            ),
        )

        draft = RagSpecialistAgent().build_answer(evidence)

        self.assertEqual([source.chunk_id for source in draft.supporting_sources], ["chunk-0001"])
        self.assertEqual(len(draft.supporting_contexts), 1)
        self.assertIn("中央民族大学关于学生宿舍照明的管理规定：", draft.supporting_contexts[0])
        self.assertIn("24:00", draft.supporting_contexts[0])
        self.assertIn("6月1日至9月30日", draft.supporting_contexts[0])
        self.assertNotIn("文号：", draft.supporting_contexts[0])

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

    def test_curriculum_table_semester_query_accepts_numeric_semester_columns(self) -> None:
        evidence = EvidenceBundle(
            query_text="法学民族实验班培养方案里第一学期有什么课",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:law-intro",
                    chunk_id="curriculum:法学（民族实验班）本科人才培养方案:chunk-0001",
                    anchor={"page_start": 147, "page_end": 147},
                    canonical_url="https://campus.example/curriculum/law-ethnic",
                    latest_url="https://campus.example/curriculum/law-ethnic",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet="法学（民族实验班）本科人才培养方案 法学专业 1979 年开始招生。",
                    score=0.99,
                    source_title="法学（民族实验班）本科人才培养方案",
                ),
                EvidenceSource(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:law-semester-1",
                    chunk_id="curriculum:法学（民族实验班）本科人才培养方案:chunk-0002",
                    anchor={"page_start": 150, "page_end": 150},
                    canonical_url="https://campus.example/curriculum/law-ethnic",
                    latest_url="https://campus.example/curriculum/law-ethnic",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(一)大类培养\n\n"
                        "2. 学科基础教育\n\n"
                        "课程清单如下:\n"
                        "专业方向 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                        "民族班 | 1036030166 | 习近平法治思想概论 | 2 | 36 | / | 1\n"
                        "民族班 | 1036030001 | 法学导论 | 2 | 36 | / | 1"
                    ),
                    score=0.97,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "五、课程设置和修读建议"),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                EvidenceSource(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:law-semester-4",
                    chunk_id="curriculum:法学（民族实验班）本科人才培养方案:chunk-0003",
                    anchor={"page_start": 153, "page_end": 153},
                    canonical_url="https://campus.example/curriculum/law-ethnic",
                    latest_url="https://campus.example/curriculum/law-ethnic",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(二)专业教育\n\n"
                        "2. 专业选修课程\n\n"
                        "课程清单如下:\n"
                        "专业方向 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 开设学期\n"
                        "民族班 | 1036040175 | 侵权责任法 | 2 | 36 | / | 4\n"
                        "民族班 | 1036040023 | 公司法 | 2 | 36 | / | 4"
                    ),
                    score=0.96,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "五、课程设置和修读建议"),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
            ),
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="法学民族实验班培养方案里第一学期有什么课",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertIn("习近平法治思想概论", response.answer_text)
        self.assertIn("法学导论", response.answer_text)
        self.assertNotIn("侵权责任法", response.answer_text)

    def test_curriculum_time_answer_prefers_direct_academic_year_statement(self) -> None:
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
                    source_title="民族学本科第二学士学位人才培养方案",
                ),
                EvidenceSource(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ethnology-table",
                    chunk_id="curriculum:民族学本科第二学士学位人才培养方案:chunk-0009",
                    anchor={"page_start": 668, "page_end": 669},
                    canonical_url="https://campus.example/curriculum/ethnology-second-degree",
                    latest_url="https://campus.example/curriculum/ethnology-second-degree",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet=(
                        "八、民族学本科专业教学进程计划表\n\n"
                        "课程类别 | — | 课程编号 | 课程名称 | 学分 | 学时 | — | 各学期周学时分配\n"
                        "课程类别 | — | 课程编号 | 课程名称 | 学分 | 总计 | 其中实践 | 1 | 2 | 3 | 4\n"
                        "专业教育 | 专业必修课共30学分 | 1026030031 | 民族学导论 | 2 | 36 | — | 2\n"
                        "专业教育 | 专业必修课共30学分 | 1026030067 | 人类学导论 | 2 | 36 | — | — | 2\n"
                        "专业教育 | 专业必修课共30学分 | 1026030047 | 民族学人类学经典导读 | 2 | 36 | — | — | — | 2"
                    ),
                    score=0.48,
                    source_title="民族学本科第二学士学位人才培养方案",
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
            ),
        )

        draft = RagSpecialistAgent().build_answer(evidence)

        self.assertEqual(
            [source.chunk_id for source in draft.supporting_sources],
            ["curriculum:民族学本科第二学士学位人才培养方案:chunk-0005"],
        )
        self.assertIn("两年", draft.answer_text)
        self.assertNotIn("民族学导论", draft.answer_text)

    def test_curriculum_semester_answer_filters_other_semester_rows_within_same_source(self) -> None:
        evidence = EvidenceBundle(
            query_text="法学民族实验班培养方案里第四学期有什么课",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:law-semester-mixed",
                    chunk_id="curriculum:法学（民族实验班）本科人才培养方案:chunk-0016",
                    anchor={"page_start": 153, "page_end": 153},
                    canonical_url="https://campus.example/curriculum/law-ethnic",
                    latest_url="https://campus.example/curriculum/law-ethnic",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(二)专业教育\n\n"
                        "2. 专业选修课程\n\n"
                        "课程清单如下:\n"
                        "专业方向 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 开设学期\n"
                        "民族班 | 1036040243 | 法学论文写作(初阶) | 2 | 36 | / | 1\n"
                        "民族班 | 1036040003 | 中国法律思想史 | 2 | 36 | / | 2\n"
                        "民族班 | 1036040175 | 侵权责任法 | 2 | 36 | / | 4\n"
                        "民族班 | 1036040023 | 公司法 | 2 | 36 | / | 4\n"
                        "民族班 | 1036040205 | 消费者权益保护法 | 2 | 36 | / | 5"
                    ),
                    score=0.97,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "五、课程设置和修读建议"),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
            ),
        )

        draft = RagSpecialistAgent().build_answer(evidence)

        self.assertIn("侵权责任法", draft.answer_text)
        self.assertIn("公司法", draft.answer_text)
        self.assertNotIn("法学论文写作(初阶)", draft.answer_text)
        self.assertNotIn("中国法律思想史", draft.answer_text)
        self.assertNotIn("消费者权益保护法", draft.answer_text)

    def test_curriculum_semester_answer_filters_rows_by_numeric_semester_columns(self) -> None:
        evidence = EvidenceBundle(
            query_text="民族学本科第二学士学位人才培养方案里第二学期有什么课",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:民族学本科第二学士学位人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:ethnology-semester-mixed",
                    chunk_id="curriculum:民族学本科第二学士学位人才培养方案:chunk-0009",
                    anchor={"page_start": 668, "page_end": 669},
                    canonical_url="https://campus.example/curriculum/ethnology-second-degree",
                    latest_url="https://campus.example/curriculum/ethnology-second-degree",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet=(
                        "八、民族学本科专业教学进程计划表\n\n"
                        "课程类别 | — | 课程编号 | 课程名称 | 学分 | 学时 | — | 各学期周学时分配\n"
                        "课程类别 | — | 课程编号 | 课程名称 | 学分 | 总计 | 其中实践 | 1 | 2 | 3 | 4\n"
                        "专业教育 | 专业必修课共30学分 | 1026030031 | 民族学导论 | 2 | 36 | — | 2\n"
                        "专业教育 | 专业必修课共30学分 | 1026030067 | 人类学导论 | 2 | 36 | — | — | 2\n"
                        "专业教育 | 专业必修课共30学分 | 1026030361 | 中国民族志 | 3 | 54 | — | 3\n"
                        "专业教育 | 专业必修课共30学分 | 1026030081 | 民族学田野调查方法 | 2 | 36 | 9 | — | 2\n"
                        "专业教育 | 专业必修课共30学分 | 1026030047 | 民族学人类学经典导读 | 2 | 36 | — | — | — | 2"
                    ),
                    score=0.95,
                    source_title="民族学本科第二学士学位人才培养方案",
                    structural_path=("民族学本科第二学士学位人才培养方案", "八、民族学本科专业教学进程计划表"),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
            ),
        )

        draft = RagSpecialistAgent().build_answer(evidence)

        self.assertIn("人类学导论", draft.answer_text)
        self.assertIn("民族学田野调查方法", draft.answer_text)
        self.assertNotIn("民族学导论", draft.answer_text)
        self.assertNotIn("中国民族志", draft.answer_text)

    def test_curriculum_semester_answer_merges_same_semester_rows_across_multiple_sources(self) -> None:
        evidence = EvidenceBundle(
            query_text="历史学强基计划培养方案里第四学期有什么课",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:历史学（强基计划）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:history-general-education",
                    chunk_id="curriculum:历史学（强基计划）本科人才培养方案:chunk-0010",
                    anchor={"page_start": 93, "page_end": 93},
                    canonical_url="https://campus.example/curriculum/history-strong-base",
                    latest_url="https://campus.example/curriculum/history-strong-base",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(一)大类培养\n\n"
                        "1. 通识教育\n\n"
                        "课程清单如下:\n"
                        "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                        "思政课 | 1037010044 | 中华民族共同体概论 | 2 | 36 | 12 | 4\n"
                        "培养课 | 1042010082 | 大学英语(四) | 2 | 54 | 36 | 4"
                    ),
                    score=0.97,
                    source_title="历史学（强基计划）本科人才培养方案",
                    structural_path=("历史学（强基计划）本科人才培养方案", "五、课程设置和修读建议"),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                EvidenceSource(
                    doc_id="curriculum:历史学（强基计划）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:history-core-courses",
                    chunk_id="curriculum:历史学（强基计划）本科人才培养方案:chunk-0014",
                    anchor={"page_start": 95, "page_end": 96},
                    canonical_url="https://campus.example/curriculum/history-strong-base",
                    latest_url="https://campus.example/curriculum/history-strong-base",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(二)专业教育\n\n"
                        "1. 专业核心课程\n\n"
                        "课程清单如下:\n"
                        "课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                        "1040030131 | 中国近代边疆民族史料研读 | 3 | 54 | 6 | 4\n"
                        "1040030127 | 世界现当代史 | 3 | 54 | / | 4\n"
                        "1040030019 | 西方史学史 | 2 | 36 | / | 4\n"
                        "1040030015 | 中国史学史 | 2 | 36 | / | 5"
                    ),
                    score=0.96,
                    source_title="历史学（强基计划）本科人才培养方案",
                    structural_path=("历史学（强基计划）本科人才培养方案", "五、课程设置和修读建议"),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
            ),
        )

        draft = RagSpecialistAgent().build_answer(evidence)

        self.assertIn("大学英语(四)", draft.answer_text)
        self.assertIn("中国近代边疆民族史料研读", draft.answer_text)
        self.assertNotIn("中国史学史", draft.answer_text)
        self.assertEqual(
            {source.chunk_id for source in draft.supporting_sources},
            {
                "curriculum:历史学（强基计划）本科人才培养方案:chunk-0010",
                "curriculum:历史学（强基计划）本科人才培养方案:chunk-0014",
            },
        )
        self.assertNotIn("民族学人类学经典导读", draft.answer_text)

    def test_curriculum_semester_answer_lists_all_semester_courses_without_table_row_truncation(self) -> None:
        evidence = EvidenceBundle(
            query_text="法学民族实验班培养方案里第四学期有什么课",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:law-semester-4a",
                    chunk_id="curriculum:法学（民族实验班）本科人才培养方案:chunk-0015",
                    anchor={"page_start": 152, "page_end": 152},
                    canonical_url="https://campus.example/curriculum/law-ethnic",
                    latest_url="https://campus.example/curriculum/law-ethnic",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(二)专业教育\n\n"
                        "2. 专业选修课程\n\n"
                        "课程清单如下:\n"
                        "专业方向 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 开设学期\n"
                        "民族班 | 1036040100 | 合同法 | 2 | 36 | / | 4\n"
                        "民族班 | 1036040101 | 人格权法 | 2 | 36 | / | 4\n"
                        "民族班 | 1036040102 | 物权法 | 2 | 36 | / | 4"
                    ),
                    score=0.98,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "五、课程设置和修读建议"),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                EvidenceSource(
                    doc_id="curriculum:法学（民族实验班）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:law-semester-4b",
                    chunk_id="curriculum:法学（民族实验班）本科人才培养方案:chunk-0016",
                    anchor={"page_start": 153, "page_end": 153},
                    canonical_url="https://campus.example/curriculum/law-ethnic",
                    latest_url="https://campus.example/curriculum/law-ethnic",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(二)专业教育\n\n"
                        "2. 专业选修课程\n\n"
                        "课程清单如下:\n"
                        "专业方向 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 开设学期\n"
                        "民族班 | 1036040175 | 侵权责任法 | 2 | 36 | / | 4\n"
                        "民族班 | 1036040023 | 公司法 | 2 | 36 | / | 4\n"
                        "民族班 | 1036040201 | 翻译学导论 | 2 | 36 | / | 4\n"
                        "民族班 | 1036040202 | 中国少数民族文字学 | 2 | 36 | / | 4"
                    ),
                    score=0.97,
                    source_title="法学（民族实验班）本科人才培养方案",
                    structural_path=("法学（民族实验班）本科人才培养方案", "五、课程设置和修读建议"),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
            ),
        )

        draft = RagSpecialistAgent().build_answer(evidence)

        self.assertIn("第四学期有", draft.answer_text)
        self.assertIn("合同法", draft.answer_text)
        self.assertIn("侵权责任法", draft.answer_text)
        self.assertIn("中国少数民族文字学", draft.answer_text)
        self.assertNotIn("|", draft.answer_text)
        self.assertEqual(
            {source.chunk_id for source in draft.supporting_sources},
            {
                "curriculum:法学（民族实验班）本科人才培养方案:chunk-0015",
                "curriculum:法学（民族实验班）本科人才培养方案:chunk-0016",
            },
        )

class RagSpecialistCurriculumSemesterSelectionTest(unittest.TestCase):
    def test_curriculum_semester_answer_keeps_general_and_core_sections_ahead_of_elective_duplicates(self) -> None:
        evidence = EvidenceBundle(
            query_text="历史学强基计划培养方案里第四学期有什么课",
            corpus="curriculum",
            collection="curriculum_plan",
            sources=(
                EvidenceSource(
                    doc_id="curriculum:历史学（强基计划）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:history-general-education",
                    chunk_id="curriculum:历史学（强基计划）本科人才培养方案:chunk-0010",
                    anchor={"page_start": 93, "page_end": 93},
                    canonical_url="https://campus.example/curriculum/history-strong-base",
                    latest_url="https://campus.example/curriculum/history-strong-base",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(一)大类培养\n\n"
                        "1. 通识教育\n\n"
                        "课程清单如下:\n"
                        "类别 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                        "思政课 | 1037010044 | 中华民族共同体概论 | 2 | 36 | 12 | 4\n"
                        "培养课 | 1042010082 | 大学英语(四) | 2 | 54 | 36 | 4"
                    ),
                    score=0.95,
                    source_title="历史学（强基计划）本科人才培养方案",
                    structural_path=(
                        "历史学（强基计划）本科人才培养方案",
                        "五、课程设置和修读建议",
                        "(一)大类培养",
                        "1. 通识教育",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                EvidenceSource(
                    doc_id="curriculum:历史学（强基计划）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:history-core-courses",
                    chunk_id="curriculum:历史学（强基计划）本科人才培养方案:chunk-0014",
                    anchor={"page_start": 95, "page_end": 96},
                    canonical_url="https://campus.example/curriculum/history-strong-base",
                    latest_url="https://campus.example/curriculum/history-strong-base",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(二)专业教育\n\n"
                        "1. 专业核心课程\n"
                        "课程清单如下:\n"
                        "课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期\n"
                        "1040030131 | 中国近代边疆民族史料研读 | 3 | 54 | 6 | 4\n"
                        "1040030127 | 世界现当代史 | 3 | 54 | / | 4\n"
                        "1040030019 | 西方史学史 | 2 | 36 | / | 4\n"
                        "1040030017 | 中国历史地理 | 2 | 36 | 4 | 4\n"
                        "1040030122 | 史学经典研读(三) | 1 | 18 | / | 4"
                    ),
                    score=0.97,
                    source_title="历史学（强基计划）本科人才培养方案",
                    structural_path=(
                        "历史学（强基计划）本科人才培养方案",
                        "五、课程设置和修读建议",
                        "(二)专业教育",
                        "1. 专业核心课程",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
                EvidenceSource(
                    doc_id="curriculum:历史学（强基计划）本科人才培养方案",
                    revision_track="source-faithful",
                    version_id="v1:history-elective-courses",
                    chunk_id="curriculum:历史学（强基计划）本科人才培养方案:chunk-0018",
                    anchor={"page_start": 97, "page_end": 98},
                    canonical_url="https://campus.example/curriculum/history-strong-base",
                    latest_url="https://campus.example/curriculum/history-strong-base",
                    source_channel="pdf_ocr",
                    collection="curriculum_plan",
                    is_current=False,
                    snippet=(
                        "五、课程设置和修读建议\n\n"
                        "(二)专业教育\n\n"
                        "2. 专业选修课程\n\n"
                        "课程清单如下:\n"
                        "专业方向名称 | 课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 开设学期\n"
                        "强基班 | 1040040061 | 满族史 | 2 | 36 | / | 4\n"
                        "强基班 | 1040040228 | 满文文献选读 | 2 | 36 | / | 4\n"
                        "强基班 | 1040040239 | 中国传统村落概要 | 2 | 36 | / | 4"
                    ),
                    score=0.96,
                    source_title="历史学（强基计划）本科人才培养方案",
                    structural_path=(
                        "历史学（强基计划）本科人才培养方案",
                        "五、课程设置和修读建议",
                        "(二)专业教育",
                        "2. 专业选修课程",
                    ),
                    content_kind="table_unit",
                    content_role="table_fact",
                ),
            ),
        )

        draft = RagSpecialistAgent().build_answer(evidence)

        self.assertIn("大学英语(四)", draft.answer_text)
        self.assertIn("中国近代边疆民族史料研读", draft.answer_text)
        self.assertEqual(
            {source.chunk_id for source in draft.supporting_sources},
            {
                "curriculum:历史学（强基计划）本科人才培养方案:chunk-0010",
                "curriculum:历史学（强基计划）本科人才培养方案:chunk-0014",
            },
        )

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

    def test_handbook_missing_policy_object_clarifies_before_retrieval(self) -> None:
        retriever_called = False

        def fake_retriever(*args: object, **kwargs: object) -> EvidenceBundle:
            nonlocal retriever_called
            retriever_called = True
            return _make_evidence()

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
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
            RagResultDiagnostics(
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
                target="rag-specialist",
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
            RagResultDiagnostics(
                resolved_policy_document_id=target_doc_id,
                resolved_policy_title=target_title,
                rewritten_query=retriever_call["query_text"],
                retrieved_title_summary=(target_title,),
            ),
        )

    def test_handbook_resolved_policy_without_supported_clause_maps_to_object_scoped_no_answer(self) -> None:
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
                target="rag-specialist",
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
            RagResultDiagnostics(
                resolved_policy_document_id=target_doc_id,
                resolved_policy_title=target_title,
                rewritten_query=retriever_call["query_text"],
                no_answer_reason="resolved_policy_clause_not_found",
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
                target="rag-specialist",
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
        self.assertEqual(response.result.diagnostics.no_answer_reason, "resolved_policy_clause_not_found")

    def test_restricted_access_denied_for_public_user_does_not_leak_resolved_policy_title(self) -> None:
        target_title = "中央民族大学本科学生国家奖学金评审办法"

        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            raise RestrictedDocumentAccessDeniedError("restricted document access denied")

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
                user_goal="民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
                context=ContextProjection(actor=ActorContext(principal_type="public_user")),
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
        self.assertEqual(response.result.diagnostics.resolved_policy_title, "")
        self.assertEqual(response.result.diagnostics.retrieved_title_summary, ())

    def test_restricted_access_denied_for_operator_uses_explicit_safe_deny_copy(self) -> None:
        def fake_retriever(query_text: str, **kwargs: object) -> EvidenceBundle:
            raise RestrictedDocumentAccessDeniedError("restricted document access denied")

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-specialist",
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


if __name__ == "__main__":
    unittest.main()
