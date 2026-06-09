from __future__ import annotations

from tests.agent.knowledge_capability_test_support import (
    CapabilityRequest,
    EvidenceBundle,
    EvidenceSource,
    KnowledgeScope,
    RagRequestPayload,
    _resolved_curriculum_diagnostics_from_response,
    delegate_to_knowledge_capability,
    unittest,
)


class KnowledgeCapabilityCurriculumFamilyFactsScheduleTest(unittest.TestCase):
    def test_course_family_schedule_answer_uses_user_facing_wording_without_internal_course_fact_phrase(
        self,
    ) -> None:
        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
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

        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
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
        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
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

        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
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

        response = delegate_to_knowledge_capability(
            CapabilityRequest(
                capability="knowledge",
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
