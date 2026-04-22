from __future__ import annotations

from tests.specialist.rag_specialist_test_support import (
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagRequestPayload,
    SpecialistRequest,
    _resolved_curriculum_diagnostics_from_response,
    delegate_to_rag_agent,
    unittest,
)


class RagSpecialistCurriculumFamilyFactsTest(unittest.TestCase):
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
            SpecialistRequest(
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
            SpecialistRequest(
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
            SpecialistRequest(
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
            SpecialistRequest(
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
            SpecialistRequest(
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

    def test_course_family_schedule_answer_uses_user_facing_wording_without_internal_course_fact_phrase(
        self,
    ) -> None:
        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
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
                        structural_path=(
                            "思想政治理论课",
                            "毛泽东思想和中国特色社会主义理论体系概论",
                        ),
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
                target="rag-agent",
                user_goal="思政课第几学期开",
                payload=RagRequestPayload(
                    scope=KnowledgeScope(corpus="curriculum", collection="curriculum_plan")
                ),
            ),
            retriever=fake_retriever,
        )

        self.assertEqual(response.status, "completed")
        self.assertEqual(retriever_call["collection"], "course_facts")
        self.assertEqual(
            retriever_call["target_document_ids"],
            (
                "course_facts:muc.marxist_basic_principles-semester",
                "course_facts:muc.modern_chinese_history_outline-semester",
                "course_facts:muc.mao_zedong_thought_and_theoretical_system-semester",
                "course_facts:muc.xigai-semester",
                "course_facts:muc.ideological_morality_and_rule_of_law-semester",
                "course_facts:muc.situation_and_policy-semester",
                "course_facts:muc.community_for_chinese_nation-semester",
            ),
        )
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
            _resolved_curriculum_diagnostics_from_response(
                response,
                resolution_mode="resolved_family",
                resolved_entity_type="course_family",
                resolved_course_family_id="course_family:muc.ideological_political_theory",
                resolved_course_family_title="思想政治理论课",
                retrieved_title_summary=("中央民族大学通识课程思想政治理论课教学计划",),
            ),
        )

    def test_course_family_schedule_query_uses_partial_completeness_wording_when_family_members_are_missing(
        self,
    ) -> None:
        response = delegate_to_rag_agent(
            SpecialistRequest(
                target="rag-agent",
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
        self.assertIn(
            "习近平新时代中国特色社会主义思想概论：第1学期(理工/艺体)；第2学期(文科)",
            response.answer_text,
        )

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
                target="rag-agent",
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
                target="rag-agent",
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

    def test_program_family_membership_query_uses_program_family_facts_for_ethnic_class(
        self,
    ) -> None:
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
                target="rag-agent",
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
            _resolved_curriculum_diagnostics_from_response(
                response,
                resolution_mode="resolved_family",
                resolved_entity_type="program_family",
                resolved_program_family_id="program_family:muc.ethnic_experimental_class",
                resolved_program_family_title="民族班",
                retrieved_title_summary=("中央民族大学民族班项目一览",),
            ),
        )

    def test_program_family_membership_query_uses_program_family_facts_for_ethnic_experimental_alias(
        self,
    ) -> None:
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
                target="rag-agent",
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
                target="rag-agent",
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
                target="rag-agent",
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
                target="rag-agent",
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
                target="rag-agent",
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
                target="rag-agent",
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
                target="rag-agent",
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
                target="rag-agent",
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
                target="rag-agent",
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
