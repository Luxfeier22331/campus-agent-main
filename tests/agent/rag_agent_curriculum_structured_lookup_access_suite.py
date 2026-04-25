from __future__ import annotations

from tests.agent.rag_agent_test_support import (
    ActorContext,
    AgentRequest,
    ContextProjection,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagRequestPayload,
    RestrictedDocumentAccessDeniedError,
    _make_evidence,
    _resolved_scope_diagnostics,
    delegate_to_rag_agent,
    derive_confidence,
    unittest,
)


class RagAgentCurriculumStructuredLookupAccessTest(unittest.TestCase):
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
                collection="student_rules",
            )

        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
                user_goal="民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
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
        self.assertEqual(response.status, "no_answer")
        self.assertIn(target_title, response.answer_text)
        self.assertEqual(
            response.result.diagnostics,
            _resolved_scope_diagnostics(
                corpus="regulations",
                collection="student_rules",
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
                collection="student_rules",
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
                        collection="student_rules",
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
            AgentRequest(
                target="rag-agent",
                user_goal="民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
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
            AgentRequest(
                target="rag-agent",
                user_goal="民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
                context=ContextProjection(actor=ActorContext(principal_type="anonymous")),
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
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
            AgentRequest(
                target="rag-agent",
                user_goal="民大评国奖不看第一作者单位吧，第一作者不是本校也能拿第二作者的分吧？",
                context=ContextProjection(actor=ActorContext(principal_type="operator")),
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="regulations", collection="student_rules")
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
                    collection="student_rules",
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
