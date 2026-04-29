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


class RagAgentCurriculumFamilyFactsProgramTest(unittest.TestCase):
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
            AgentRequest(
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
            AgentRequest(
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
            AgentRequest(
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
            AgentRequest(
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
            AgentRequest(
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
            AgentRequest(
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
            AgentRequest(
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
            AgentRequest(
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
            AgentRequest(
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
            AgentRequest(
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
