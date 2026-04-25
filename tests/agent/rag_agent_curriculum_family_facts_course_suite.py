from __future__ import annotations

from tests.agent.rag_agent_test_support import (
    AgentRequest,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagRequestPayload,
    _resolved_curriculum_diagnostics_from_response,
    delegate_to_rag_agent,
    unittest,
)


class RagAgentCurriculumFamilyFactsCourseTest(unittest.TestCase):
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
            AgentRequest(
                target="rag-agent",
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
        self.assertEqual(
            retriever_call["target_document_ids"], ("course_facts:muc.xigai-audience",)
        )
        self.assertEqual(retriever_call["canonical_course_ids"], ("course:muc.xigai",))
        self.assertEqual(retriever_call["canonical_course_family_ids"], ())
        self.assertEqual(
            response.answer_text, "习近平新时代中国特色社会主义思想概论面向所有本预科学生。"
        )
        self.assertIn("所有本预科学生", response.answer_text)
        self.assertEqual(
            response.result.diagnostics,
            _resolved_curriculum_diagnostics_from_response(
                response,
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
            AgentRequest(
                target="rag-agent",
                user_goal="思政课包括哪些课",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["collection"], "course_facts")
        self.assertEqual(retriever_call["target_document_ids"], ("course_facts:family-membership",))
        self.assertEqual(retriever_call["canonical_course_ids"], ())
        self.assertEqual(
            retriever_call["canonical_course_family_ids"],
            ("course_family:muc.ideological_political_theory",),
        )
        self.assertTrue(response.answer_text.startswith("思想政治理论课包括"))
        self.assertNotIn("根据培养方案和课程教学计划", response.answer_text)
        self.assertIn("习近平新时代中国特色社会主义思想概论", response.answer_text)
        self.assertIn("中华民族共同体概论", response.answer_text)
        self.assertEqual(
            response.result.diagnostics,
            _resolved_curriculum_diagnostics_from_response(
                response,
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
            AgentRequest(
                target="rag-agent",
                user_goal="思政课是哪个学院开的，有哪些专业要上",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["collection"], "course_facts")
        self.assertEqual(retriever_call["target_document_ids"], ("course_facts:family-audience",))
        self.assertNotIn("根据培养方案和课程教学计划", response.answer_text)
        self.assertIn("所有本预科学生", response.answer_text)
        self.assertIn("当前还不能稳定确认开课学院", response.answer_text)
        self.assertEqual(
            response.result.diagnostics,
            _resolved_curriculum_diagnostics_from_response(
                response,
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
            AgentRequest(
                target="rag-agent",
                user_goal="习概第几学期开",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["collection"], "course_facts")
        self.assertEqual(
            retriever_call["target_document_ids"], ("course_facts:muc.xigai-semester",)
        )
        self.assertEqual(retriever_call["canonical_course_ids"], ("course:muc.xigai",))
        self.assertEqual(retriever_call["canonical_course_family_ids"], ())
        self.assertIn("第1学期(理工/艺体)", response.answer_text)
        self.assertIn("第2学期(文科)", response.answer_text)
        self.assertEqual(
            response.result.diagnostics,
            _resolved_curriculum_diagnostics_from_response(
                response,
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
            AgentRequest(
                target="rag-agent",
                user_goal="习概哪个学院开，第几学期开",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["collection"], "course_facts")
        self.assertEqual(
            retriever_call["target_document_ids"], ("course_facts:muc.xigai-semester",)
        )
        self.assertIn(
            "习近平新时代中国特色社会主义思想概论开设学期：第1学期(理工/艺体)；第2学期(文科)",
            response.answer_text,
        )
        self.assertIn("当前还不能稳定确认开课学院", response.answer_text)
        self.assertEqual(
            response.result.diagnostics,
            _resolved_curriculum_diagnostics_from_response(
                response,
                resolution_mode="resolved_single",
                resolved_entity_type="course",
                resolved_course_id="course:muc.xigai",
                resolved_course_title="习近平新时代中国特色社会主义思想概论",
                unsupported_fields=("offering_unit",),
                partial_answer=True,
                retrieved_title_summary=("中央民族大学通识课程思想政治理论课教学计划",),
            ),
        )

    def test_course_schedule_answer_uses_user_facing_wording_without_internal_course_fact_phrase(
        self,
    ) -> None:
        response = delegate_to_rag_agent(
            AgentRequest(
                target="rag-agent",
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
        self.assertEqual(
            response.answer_text,
            "习近平新时代中国特色社会主义思想概论开设学期：第1学期(理工/艺体)；第2学期(文科)。",
        )
        self.assertNotIn("根据培养方案和课程教学计划", response.answer_text)
        self.assertNotIn("当前已采集的课程事实", response.answer_text)
        self.assertNotIn("课程事实", response.answer_text)
