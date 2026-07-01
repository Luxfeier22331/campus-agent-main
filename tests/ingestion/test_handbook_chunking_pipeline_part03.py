from __future__ import annotations

import unittest

from tests.ingestion.handbook_chunking_pipeline_support import (
    _registry_record_for_document,
    _structured_row,
    build_hermetic_handbook_v3_chunk_profile,
    build_indexable_chunks_from_jsonl,
    evaluate_answer_ready_contract_metadata,
    is_answer_ready_contract_issue,
    json,
)


class HandbookChunkingPipelinePart03Test(unittest.TestCase):
    def test_repeated_material_intros_under_same_parent_emit_distinct_condition_group_ids(
        self,
    ) -> None:
        record = _registry_record_for_document("handbook:test-repeated-material-groups")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-repeated-material-groups",
                    clean_text="\n".join(
                        [
                            "申请材料如下:",
                            "1. 书面申请。",
                            "2. 相关证明材料。",
                            "补充材料如下:",
                            "3. 成绩单复印件。",
                            "4. 身份证复印件。",
                        ]
                    ),
                    anchor={
                        "section_path": ["第三章 申诉材料"],
                        "article_label": "第五条",
                        "page_start": 1,
                        "page_end": 1,
                    },
                    metadata={"title": "示例大学学生申诉处理办法"},
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        material_chunks = [
            chunk
            for chunk in chunks
            if chunk.metadata["display_text"]
            in {
                "1. 书面申请。",
                "2. 相关证明材料。",
                "3. 成绩单复印件。",
                "4. 身份证复印件。",
            }
        ]
        self.assertEqual(len(material_chunks), 4)
        self.assertEqual(
            tuple(chunk.metadata["answer_role"] for chunk in material_chunks),
            (
                "material_requirement",
                "material_requirement",
                "material_requirement",
                "material_requirement",
            ),
        )
        self.assertEqual(
            {chunk.metadata["condition_group_id"] for chunk in material_chunks},
            {
                "article-repeated-material-groups:group-01:material_requirement",
                "article-repeated-material-groups:group-02:material_requirement",
            },
        )
        intro_chunks = [
            chunk
            for chunk in chunks
            if chunk.metadata["display_text"] in {"申请材料如下:", "补充材料如下:"}
        ]
        self.assertEqual(len(intro_chunks), 2)
        self.assertEqual(
            tuple(chunk.metadata["introduced_condition_group_id"] for chunk in intro_chunks),
            (
                "article-repeated-material-groups:group-01:material_requirement",
                "article-repeated-material-groups:group-02:material_requirement",
            ),
        )

    def test_repeated_time_intros_under_same_parent_emit_distinct_condition_group_ids(
        self,
    ) -> None:
        record = _registry_record_for_document("handbook:test-repeated-time-groups")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-repeated-time-groups",
                    clean_text="\n".join(
                        [
                            "申诉期限如下:",
                            "1. 应在收到处理决定后5个工作日内提出申诉。",
                            "2. 公示期不少于3个工作日。",
                            "补充期限如下:",
                            "3. 复核意见应在10个工作日内反馈。",
                            "4. 逾期不再受理。",
                        ]
                    ),
                    anchor={
                        "section_path": ["第三章 申诉期限"],
                        "article_label": "第六条",
                        "page_start": 1,
                        "page_end": 1,
                    },
                    metadata={"title": "示例大学学生申诉处理办法"},
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        time_chunks = [
            chunk
            for chunk in chunks
            if chunk.metadata["display_text"]
            in {
                "1. 应在收到处理决定后5个工作日内提出申诉。",
                "2. 公示期不少于3个工作日。",
                "3. 复核意见应在10个工作日内反馈。",
                "4. 逾期不再受理。",
            }
        ]
        self.assertEqual(len(time_chunks), 4)
        self.assertEqual(
            tuple(chunk.metadata["answer_role"] for chunk in time_chunks),
            (
                "time_constraint",
                "time_constraint",
                "time_constraint",
                "time_constraint",
            ),
        )
        self.assertEqual(
            {chunk.metadata["condition_group_id"] for chunk in time_chunks},
            {
                "article-repeated-time-groups:group-01:deadline",
                "article-repeated-time-groups:group-02:deadline",
            },
        )
        intro_chunks = [
            chunk
            for chunk in chunks
            if chunk.metadata["display_text"] in {"申诉期限如下:", "补充期限如下:"}
        ]
        self.assertEqual(len(intro_chunks), 2)
        self.assertEqual(
            tuple(chunk.metadata["introduced_condition_group_id"] for chunk in intro_chunks),
            (
                "article-repeated-time-groups:group-01:deadline",
                "article-repeated-time-groups:group-02:deadline",
            ),
        )

    def test_student_rules_procedure_steps_are_not_misclassified_as_eligibility(
        self,
    ) -> None:
        record = _registry_record_for_document("handbook:test-procedure")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-procedure",
                    clean_text="\n".join(
                        [
                            "申请奖学金按照以下程序进行:",
                            "1. 学生本人提交申请材料。",
                            "2. 学院进行审核并公示。",
                        ]
                    ),
                    metadata={"title": "示例大学本科学生专业奖学金评定办法"},
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        procedure_chunks = [
            chunk
            for chunk in chunks
            if "提交申请材料" in chunk.metadata["display_text"]
            or "审核并公示" in chunk.metadata["display_text"]
        ]
        self.assertEqual(len(procedure_chunks), 2)
        self.assertTrue(
            all(chunk.metadata["answer_role"] == "procedure_step" for chunk in procedure_chunks)
        )
        self.assertTrue(
            all(chunk.metadata["content_role"] == "procedure" for chunk in procedure_chunks)
        )
        self.assertEqual(
            tuple(chunk.metadata["procedure_step_index"] for chunk in procedure_chunks), (1, 2)
        )
        self.assertTrue(all(chunk.metadata["procedure_actor"] for chunk in procedure_chunks))
        self.assertTrue(all(chunk.metadata["procedure_action"] for chunk in procedure_chunks))
        self.assertEqual(
            tuple(chunk.metadata["procedure_action"] for chunk in procedure_chunks),
            ("submit_materials", "college_review"),
        )
        self.assertEqual(
            tuple(chunk.metadata["procedure_action_provenance"] for chunk in procedure_chunks),
            ("keyword:提交+材料", "keyword:审核+actor:college"),
        )
        self.assertEqual(
            tuple(chunk.metadata["condition_group_id"] for chunk in procedure_chunks),
            ("article-procedure:application_procedure", "article-procedure:application_procedure"),
        )
        self.assertTrue(
            all(
                chunk.metadata["evidence_contract_version"] == "answer_ready_evidence.v3"
                for chunk in procedure_chunks
            )
        )

    def test_student_rules_eligibility_headings_are_not_misclassified_as_procedure(
        self,
    ) -> None:
        record = _registry_record_for_document("handbook:test-eligibility-heading")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-eligibility-heading",
                    clean_text="\n".join(
                        [
                            "申请条件",
                            "凡符合条件者均可申请。",
                        ]
                    ),
                    anchor={
                        "section_path": ["第二章 奖学金评定", "申请条件"],
                        "article_label": "第六条",
                    },
                    metadata={"title": "示例大学本科学生专业奖学金评定办法"},
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        eligibility_chunks = [
            chunk for chunk in chunks if "凡符合条件者均可申请" in chunk.metadata["display_text"]
        ]
        self.assertEqual(len(eligibility_chunks), 1)
        metadata = eligibility_chunks[0].metadata
        self.assertEqual(metadata["content_role"], "eligibility")
        self.assertEqual(metadata["answer_role"], "eligibility_condition")

    def test_student_rules_procedure_intro_has_complete_intro_contract(self) -> None:
        record = _registry_record_for_document("handbook:test-procedure-intro-contract")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-procedure-intro-contract",
                    clean_text="\n".join(
                        [
                            "指导教师的职责是:",
                            "1. 负责指导学生开展项目研究。",
                            "2. 审核学生提交的结题材料。",
                        ]
                    ),
                    metadata={"title": "示例大学本科创新教育实施办法"},
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        intro_chunks = [
            chunk for chunk in chunks if chunk.metadata["display_text"] == "指导教师的职责是:"
        ]
        self.assertEqual(len(intro_chunks), 1)
        metadata = intro_chunks[0].metadata
        self.assertEqual(metadata["answer_role"], "eligibility_intro")
        self.assertEqual(metadata["intro_scope"], "procedure_list")
        self.assertEqual(
            metadata["introduced_condition_group_id"],
            "article-procedure-intro-contract:application_procedure",
        )
        self.assertEqual(metadata["intro_target_roles"], ("procedure_step",))
        self.assertEqual(
            evaluate_answer_ready_contract_metadata(
                corpus=record.corpus,
                collection=record.collection,
                metadata=metadata,
                anchor=intro_chunks[0].anchor,
            ).status,
            "passed",
        )

    def test_student_rules_procedure_intro_filters_supporting_detail_from_intro_target_roles(
        self,
    ) -> None:
        record = _registry_record_for_document("handbook:test-procedure-intro-filtered-targets")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-procedure-intro-filtered-targets",
                    clean_text="\n".join(
                        [
                            "指导教师(组)应:",
                            "1. 对项目实施过程进行指导。",
                            "2. 对项目结题材料进行审核。",
                        ]
                    ),
                    metadata={"title": "示例大学本科创新教育实施办法"},
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        intro_chunk = next(
            chunk for chunk in chunks if chunk.metadata["display_text"] == "指导教师(组)应:"
        )
        self.assertEqual(intro_chunk.metadata["answer_role"], "eligibility_intro")
        self.assertEqual(intro_chunk.metadata["intro_target_roles"], ("procedure_step",))
        self.assertEqual(intro_chunk.metadata["intro_scope"], "procedure_list")
        self.assertEqual(
            intro_chunk.metadata["answer_ready_contract_validation_status"],
            "passed",
        )

    def test_student_rules_category_prefix_intro_filters_supporting_detail_from_intro_target_roles(
        self,
    ) -> None:
        record = _registry_record_for_document(
            "handbook:test-category-prefix-intro-filtered-targets"
        )
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-category-prefix-intro-filtered-targets",
                    clean_text="\n".join(
                        [
                            "本科生研究训练计划项目分为自由申报项目和双向选择项目:",
                            "1. 学生自主申报。",
                            "2. 导师双向选择。",
                        ]
                    ),
                    metadata={"title": "示例大学本科创新教育实施办法"},
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        intro_chunk = next(
            chunk
            for chunk in chunks
            if chunk.metadata["display_text"]
            == "本科生研究训练计划项目分为自由申报项目和双向选择项目:"
        )
        self.assertEqual(intro_chunk.metadata["answer_role"], "eligibility_intro")
        self.assertEqual(intro_chunk.metadata["intro_target_roles"], ("procedure_step",))
        self.assertEqual(intro_chunk.metadata["intro_scope"], "procedure_list")
        self.assertEqual(
            intro_chunk.metadata["answer_ready_contract_validation_status"],
            "passed",
        )

    def test_student_rules_fill_and_report_step_has_complete_procedure_contract(self) -> None:
        record = _registry_record_for_document("handbook:test-fill-and-report-procedure-step")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-fill-and-report-procedure-step",
                    clean_text="2. 学生填写《本科生研究训练计划项目申请书》并上报项目负责人所在院系;",
                    anchor={
                        "section_path": ["第三章 项目管理", "申请程序"],
                        "article_label": "第八条",
                        "provision_label": "2.",
                    },
                    metadata={"title": "示例大学本科创新教育实施办法"},
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(len(chunks), 1)
        metadata = chunks[0].metadata
        self.assertEqual(metadata["answer_role"], "procedure_step")
        self.assertEqual(metadata["procedure_actor"], "student")
        self.assertEqual(metadata["procedure_action"], "submit_materials")
        self.assertEqual(metadata["answer_ready_contract_validation_status"], "passed")

    def test_student_rules_review_failure_clause_does_not_degrade_to_generic_procedure_fallback(
        self,
    ) -> None:
        record = _registry_record_for_document("handbook:69eef0f78d250946924e6a02187fafdb88852c23")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="policy_page",
                    root_unit_id="article-0023",
                    clean_text=(
                        "第二十三条\n"
                        "(三)休学、保留学籍期满,逾期二周末提出复学申请或者二次休学后的复学申请经审查不合格的;"
                    ),
                    metadata={
                        "title": "示例大学学生管理规定",
                    },
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(len(chunks), 2)
        metadata = chunks[1].metadata
        self.assertEqual(
            metadata["display_text"],
            "(三)休学、保留学籍期满,逾期二周末提出复学申请或者二次休学后的复学申请经审查不合格的;",
        )
        self.assertEqual(metadata["answer_role"], "exclusion_rule")
        self.assertIsNone(metadata.get("procedure_actor"))
        self.assertIsNone(metadata.get("procedure_action"))

    def test_student_rules_hearing_notice_modes_are_not_typed_as_generic_procedure_fallback(
        self,
    ) -> None:
        record = _registry_record_for_document("handbook:1b7c532ecdbc8afe1820d2c55dfba911d891e37a")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="policy_page",
                    root_unit_id="article-0014",
                    clean_text=(
                        "第十四条 告知方式包括口头告知和书面告知两种。"
                        "第十五条 书面告知可根据不同情况分别采取直接送达、留置送达、邮寄送达、公告送达四种方式。"
                        "公告送达的公告期为10天。"
                    ),
                    metadata={
                        "title": "示例大学学生听证实施办法",
                    },
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(len(chunks), 1)
        metadata = chunks[0].metadata
        self.assertNotEqual(metadata["answer_role"], "procedure_step")
        self.assertNotEqual(metadata.get("procedure_actor"), "responsible_party")
        self.assertNotEqual(metadata.get("procedure_action"), "procedure_step")

    def test_category_overview_registry_version_issue_is_release_gate_contract_issue(
        self,
    ) -> None:
        result = evaluate_answer_ready_contract_metadata(
            corpus="regulations",
            collection="institutional_rules",
            metadata={
                "answer_role": "category_overview",
                "evidence_contract_version": "answer_ready_evidence.v3",
                "parent_unit_id": "category:appeal",
                "category_id": "appeal",
                "category_registry_version": "policy_category_registry.experimental",
                "audience": "student",
                "member_policy_document_ids": ["appeal-rule-1"],
                "member_policy_titles": ["学生申诉处理办法"],
            },
        )

        self.assertEqual(result.status, "failed")
        self.assertIn("category_overview_registry_version_unknown", result.issues)
        self.assertTrue(
            is_answer_ready_contract_issue("category_overview_registry_version_unknown")
        )

    def test_student_rules_procedure_intro_segment_uses_procedure_role(
        self,
    ) -> None:
        record = _registry_record_for_document("handbook:test-procedure-intro-segment")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-procedure-intro-segment",
                    clean_text="\n".join(
                        [
                            "申请奖学金按照以下程序进行:",
                            "1. 学生本人提交申请材料。",
                            "2. 学院进行审核并公示。",
                        ]
                    ),
                    metadata={"title": "示例大学本科学生专业奖学金评定办法"},
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        intro_chunks = [
            chunk
            for chunk in chunks
            if chunk.metadata["display_text"] == "申请奖学金按照以下程序进行:"
        ]
        self.assertEqual(len(intro_chunks), 1)
        self.assertEqual(intro_chunks[0].metadata["answer_role"], "eligibility_intro")
        self.assertEqual(intro_chunks[0].metadata["intro_scope"], "procedure_list")
        self.assertEqual(intro_chunks[0].metadata["intro_target_roles"], ("procedure_step",))
        self.assertEqual(intro_chunks[0].metadata["content_role"], "eligibility")


if __name__ == "__main__":
    unittest.main()
