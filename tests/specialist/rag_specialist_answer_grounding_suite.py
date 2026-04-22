from __future__ import annotations

from tests.specialist.rag_specialist_test_support import (
    ActorContext,
    AuthorizationProjection,
    AuthorizedRetrievalFilter,
    ContextProjection,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    PersonalizationHint,
    RagAgent,
    RagRequestPayload,
    RagResultPayload,
    SourceTrustSummary,
    SpecialistRequest,
    SpecialistResponse,
    _assert_answer_text_hides_internal_locators,
    _make_evidence,
    _make_handbook_source,
    _resolved_scope_diagnostics,
    build_supervisor_observability_from_specialist_response,
    delegate_to_rag_agent,
    unittest,
)


class RagSpecialistAnswerGroundingTest(unittest.TestCase):
    def test_low_support_evidence_maps_to_no_answer_instead_of_completed(self) -> None:
        evidence = _make_evidence(
            scores=(0.41,),
            query_text="How do I replace my student card?",
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="How do I replace my student card?",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "no_answer")
        self.assertEqual(response.confidence, "low")
        self.assertIn("未检索到足够依据", response.answer_text)
        self.assertEqual(response.result.evidence, evidence)
        self.assertIsNotNone(response.result.diagnostics)
        self.assertEqual(response.result.diagnostics.resolved_scope_corpus, "regulations")
        self.assertEqual(response.result.diagnostics.resolved_scope_collection, "student_rules")
        self.assertEqual(response.result.diagnostics.semantic_outcome, "unsupported_by_evidence")

    def test_completed_response_uses_evidence_and_actor_context(self) -> None:
        captured_kwargs: dict[str, object] = {}
        expected_evidence = _make_evidence(query_text="What are the library hours?")

        def fake_retriever(query: str, **kwargs: object) -> EvidenceBundle:
            captured_kwargs["query"] = query
            captured_kwargs.update(kwargs)
            return expected_evidence

        request = SpecialistRequest(
            target="rag-agent",
            user_goal="What are the library hours?",
            actor=ActorContext(
                user_id="student-001",
            ),
            payload=RagRequestPayload(
                scope=KnowledgeScope(corpus="regulations", collection="student_rules")
            ),
        )

        response = delegate_to_rag_agent(request, retriever=fake_retriever)

        self.assertIsInstance(response, SpecialistResponse)
        self.assertEqual(response.target, "rag-agent")
        self.assertEqual(response.status, "completed")
        self.assertEqual(captured_kwargs["query"], "What are the library hours?")
        self.assertEqual(captured_kwargs["corpus"], "regulations")
        self.assertEqual(captured_kwargs["collection"], "student_rules")
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
        _assert_answer_text_hides_internal_locators(self, response.answer_text)
        self.assertEqual(response.confidence, "medium")
        self.assertEqual(
            response.result,
            RagResultPayload(
                evidence=expected_evidence,
                diagnostics=_resolved_scope_diagnostics(
                    corpus="regulations",
                    collection="student_rules",
                    semantic_outcome="grounded_answer",
                    retrieved_title_summary=(
                        "Evidence snippet 1 about library hours and student support.",
                        "Evidence snippet 2 about library hours and student support.",
                    ),
                    retrieved_sources=expected_evidence.sources,
                    source_trust_summary=SourceTrustSummary(
                        observed_tiers=("T1",),
                        answer_bearing_tiers=(),
                        blocked_claim_types=(),
                        freshness_claim_blocked=False,
                        authorization_claim_blocked=False,
                    ),
                ),
            ),
        )

    def test_delegate_passes_context_authorization_filter_to_retriever(self) -> None:
        captured_kwargs: dict[str, object] = {}

        def fake_retriever(query: str, **kwargs: object) -> EvidenceBundle:
            captured_kwargs["query"] = query
            captured_kwargs.update(kwargs)
            return _make_evidence(scores=(0.83,), query_text=query)

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
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
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
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
                target="rag-agent",
                user_goal="提交书面申请后院系如何审核？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
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

    def test_completed_response_keeps_only_supporting_sources_and_excludes_background_snippets(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="学生证丢失后怎么办理补办？",
            corpus="regulations",
            collection="student_rules",
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
                    collection="student_rules",
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
                    collection="student_rules",
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
                    collection="student_rules",
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
                target="rag-agent",
                user_goal="学生证丢失后怎么办理补办？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(
            [source.chunk_id for source in response.result.evidence.sources],
            ["student-card-procedure"],
        )
        self.assertEqual(
            [source.chunk_id for source in response.result.diagnostics.retrieved_sources],
            [
                "student-card-procedure",
                "student-card-closing",
                "medical-background",
            ],
        )
        self.assertIn("学生证遗失后", response.answer_text)
        self.assertNotIn("负责解释", response.answer_text)
        self.assertNotIn("公费医疗", response.answer_text)
        self.assertNotIn("1.", response.answer_text)

    def test_completed_response_preserves_raw_retrieved_sources_even_when_support_matches(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="民族班有哪些",
            corpus="curriculum",
            collection="program_family_facts",
            sources=(
                EvidenceSource(
                    doc_id="program_family_facts:ethnic-class-membership",
                    revision_track="source-faithful",
                    version_id="v1:program-family-facts",
                    chunk_id="program-family-facts:ethnic-class-membership",
                    anchor={"page_start": 1, "page_end": 1},
                    canonical_url="https://campus.example/curriculum/program-family/ethnic-class",
                    latest_url="https://campus.example/curriculum/program-family/ethnic-class",
                    source_channel="pdf_ocr",
                    collection="program_family_facts",
                    is_current=True,
                    snippet="民大的民族班有法学、信息与计算科学、计算机科学与技术。",
                    score=0.97,
                    source_title="中央民族大学民族班项目一览",
                    structural_path=("民族班",),
                    content_kind="program_family_fact",
                    content_role="family_membership",
                    detail_label="成员专业",
                ),
            ),
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="民族班有哪些",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertIsNotNone(response.result.diagnostics)
        self.assertEqual(
            tuple(source.chunk_id for source in response.result.evidence.sources),
            ("program-family-facts:ethnic-class-membership",),
        )
        self.assertEqual(
            tuple(source.chunk_id for source in response.result.diagnostics.retrieved_sources),
            ("program-family-facts:ethnic-class-membership",),
        )

    def test_completed_handbook_response_preserves_raw_retrieved_sources_for_observability_counts(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="学生证补办要求是什么",
            corpus="regulations",
            collection="student_rules",
            sources=(
                _make_handbook_source(
                    doc_id="handbook:student-card",
                    title="中央民族大学本科(预科)学生证管理办法",
                    snippet="学生补办学生证时，必须提出书面申请，并填写补办申请表。",
                    score=0.94,
                    chunk_id_suffix="student-card-reissue",
                    detail_label="补办手续",
                    content_role="procedure",
                    is_answer_bearing=True,
                ),
            ),
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="学生证补办要求是什么",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(
            tuple(source.chunk_id for source in response.result.evidence.sources),
            ("handbook:student-card:source-faithful:v1:student-card-reissue",),
        )
        self.assertEqual(
            tuple(source.chunk_id for source in response.result.diagnostics.retrieved_sources),
            ("handbook:student-card:source-faithful:v1:student-card-reissue",),
        )
        observability = build_supervisor_observability_from_specialist_response(response)
        self.assertEqual(observability.candidate_count, 1)
        self.assertEqual(observability.retrieved_source_count, 1)
        self.assertEqual(observability.citation_count, 1)
        self.assertIsNotNone(response.result.diagnostics.retrieval_plan_summary)
        self.assertEqual(
            response.result.diagnostics.retrieval_plan_summary.plan_id,
            "regulations:student_rules:current",
        )
        self.assertEqual(
            response.result.diagnostics.retrieval_plan_summary.query_mode,
            "current",
        )
        self.assertEqual(
            response.result.diagnostics.retrieval_plan_summary.terminal_state,
            "completed",
        )
        self.assertEqual(
            response.result.diagnostics.retrieval_plan_summary.replan_count,
            0,
        )
        self.assertEqual(
            response.result.diagnostics.retrieval_plan_summary.step_activities[0].step_type,
            "indexed_lookup",
        )
        self.assertEqual(
            response.result.diagnostics.retrieval_plan_summary.step_activities[0].status,
            "succeeded",
        )
        self.assertEqual(
            response.result.diagnostics.retrieval_plan_summary.step_activities[0].candidate_count,
            1,
        )

    def test_completed_response_focuses_student_card_reissue_on_actionable_steps(self) -> None:
        evidence = EvidenceBundle(
            query_text="学生证丢了怎么办",
            corpus="regulations",
            collection="student_rules",
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
                    collection="student_rules",
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
                    collection="student_rules",
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
                    collection="student_rules",
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
                target="rag-agent",
                user_goal="学生证丢了怎么办",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(
            [source.chunk_id for source in response.result.evidence.sources], ["chunk-0001"]
        )
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

    def test_completed_deterministic_handbook_answer_retains_grounded_diagnostics(self) -> None:
        evidence = EvidenceBundle(
            query_text="学生证丢了怎么办",
            corpus="regulations",
            collection="student_rules",
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
                    collection="student_rules",
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
                    content_role="procedure",
                    detail_label="二、学生证是",
                    is_answer_bearing=True,
                ),
            ),
        )

        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
                user_goal="学生证丢了怎么办",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(response.result.diagnostics.semantic_outcome, "grounded_answer")
        self.assertEqual(response.result.diagnostics.retrieval_adequacy_verdict, "sufficient")
        self.assertEqual(response.result.diagnostics.retrieval_adequacy_reason, "sufficient")
        self.assertEqual(response.result.diagnostics.grounding_verdict, "grounded")
        self.assertFalse(response.result.diagnostics.grounding_downgraded)
        self.assertEqual(
            response.result.diagnostics.retrieved_title_summary,
            ("中央民族大学本科(预科)学生证管理办法",),
        )

    def test_completed_response_keeps_only_primary_time_rule_when_it_already_answers_lighting_query(
        self,
    ) -> None:
        evidence = EvidenceBundle(
            query_text="宿舍照明",
            corpus="regulations",
            collection="student_rules",
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
                    collection="student_rules",
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
                    collection="student_rules",
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
                    collection="student_rules",
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
                target="rag-agent",
                user_goal="宿舍照明",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
                ),
            ),
            retriever=lambda *args, **kwargs: evidence,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(
            [source.chunk_id for source in response.result.evidence.sources], ["chunk-0001"]
        )
        self.assertIn("宿舍照明", response.answer_text)
        self.assertIn("24:00", response.answer_text)
        self.assertIn("6月1日至9月30日", response.answer_text)
        self.assertNotIn("研究生宿舍", response.answer_text)

    def test_answer_draft_exposes_statement_level_supporting_contexts(self) -> None:
        evidence = EvidenceBundle(
            query_text="宿舍照明",
            corpus="regulations",
            collection="student_rules",
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
                    collection="student_rules",
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

        draft = RagAgent().build_answer(evidence)

        self.assertEqual([source.chunk_id for source in draft.supporting_sources], ["chunk-0001"])
        self.assertEqual(len(draft.supporting_contexts), 1)
        self.assertIn("中央民族大学关于学生宿舍照明的管理规定：", draft.supporting_contexts[0])
        self.assertIn("24:00", draft.supporting_contexts[0])
        self.assertIn("6月1日至9月30日", draft.supporting_contexts[0])
        self.assertNotIn("文号：", draft.supporting_contexts[0])
