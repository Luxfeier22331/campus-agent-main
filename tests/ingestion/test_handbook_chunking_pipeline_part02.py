from __future__ import annotations

import unittest

from tests.ingestion.handbook_chunking_pipeline_support import (
    _institutional_registry_record,
    _registry_record_for_document,
    _structured_row,
    build_hermetic_handbook_v3_chunk_profile,
    build_indexable_chunks_from_jsonl,
    evaluate_answer_ready_contract_metadata,
    json,
    replace,
)


class HandbookChunkingPipelinePart02Test(unittest.TestCase):
    def test_explicit_condition_subject_alias_is_canonicalized_in_v3_contract(self) -> None:
        record = _registry_record_for_document("handbook:test-explicit-condition-subject-alias")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-explicit-condition-subject",
                    clean_text="申请人应当热爱社会主义祖国，拥护中国共产党的领导。",
                    metadata={
                        "title": "示例大学本科学生国家奖学金评审办法",
                        "answer_role": "eligibility_condition",
                        "condition_subject": "general_eligibility",
                        "role_confidence": "high",
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
        self.assertEqual(metadata["condition_subject"], "generic_condition")
        self.assertEqual(
            metadata["condition_subject_provenance"],
            "metadata:condition_subject",
        )
        self.assertEqual(
            metadata["condition_group_id"],
            "article-explicit-condition-subject:generic_condition",
        )
        self.assertEqual(
            evaluate_answer_ready_contract_metadata(
                corpus=record.corpus,
                collection=record.collection,
                metadata=metadata,
                anchor=chunks[0].anchor,
            ).status,
            "passed",
        )

    def test_explicit_procedure_action_metadata_overrides_heuristic_action(self) -> None:
        record = _institutional_registry_record("official-web-regulation-explicit-action-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="official-web-regulation-explicit-action-test:unit-0022",
                    clean_text="（四）统一受理、协调处理、统一答复向学校提出的信息公开申请；",
                    anchor={
                        "section_path": ["第三章 信息公开工作机构"],
                        "provision_label": "（四）",
                    },
                    metadata={
                        "title": "示例大学信息公开实施细则",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
                        "source_channel": "official_web",
                        "page_family": "article_detail",
                        "procedure_actor": "office",
                        "procedure_action": "office_review",
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
        self.assertEqual(metadata["procedure_actor"], "office")
        self.assertEqual(metadata["procedure_action"], "office_review")
        self.assertEqual(
            metadata["procedure_action_provenance"],
            "metadata:procedure_action",
        )
        self.assertEqual(
            evaluate_answer_ready_contract_metadata(
                corpus=record.corpus,
                collection=record.collection,
                metadata=metadata,
                anchor=chunks[0].anchor,
            ).status,
            "passed",
        )

    def test_handbook_chunking_keeps_positive_material_requirement_polarity_despite_negative_note(
        self,
    ) -> None:
        record = _registry_record_for_document("handbook:test-material-note-polarity")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-material-note-polarity",
                    clean_text=(
                        "(三)由毕业生所在院系盖章确认后的《个人学习成绩及品德评价书》一份(附件2)。\n"
                        "注:在校学习期间获得国家助学贷款的毕业生,如已递交《学费和国家助学贷款代偿申请表》"
                        "和就业协议书原件,在与国家助学贷款经办银行签订毕业后的还款计划书时,"
                        "应注明已申请国家助学贷款代偿。如果获得国家助学贷款代偿资格,"
                        "不再需要自行向银行还款。"
                    ),
                    anchor={
                        "section_path": ["一、学费和国家助学贷款代偿资助的基本内容"],
                        "article_label": "第七条",
                        "provision_label": "(三)",
                    },
                    metadata={
                        "title": "示例大学毕业生学费和国家助学贷款代偿暂行实施办法",
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
        self.assertEqual(metadata["answer_role"], "eligibility_condition")
        self.assertEqual(metadata["condition_subject"], "generic_condition")
        self.assertEqual(metadata["condition_polarity"], "positive")
        self.assertEqual(
            evaluate_answer_ready_contract_metadata(
                corpus=record.corpus,
                collection=record.collection,
                metadata=metadata,
                anchor=chunks[0].anchor,
            ).status,
            "passed",
        )

    def test_section_heading_without_body_is_not_answer_ready(self) -> None:
        record = _registry_record_for_document("official_web_regulation:test-heading-only")
        record = replace(
            record,
            collection="student_rules",
            revision_track="current-effective",
            version_id="owregver:test-heading-only",
            source_channel="official_web",
            import_source="official_web_regulation_source_truth_materialization",
        )
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="official_web_regulation:test-heading-only:unit-0006",
                    clean_text="二、评选条件",
                    anchor={"section_path": ["二、评选条件"]},
                    metadata={
                        "title": "示例大学研究生宝钢优秀学生奖评选实施办法（试行）",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
                        "source_channel": "official_web",
                        "page_family": "article_detail",
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
        self.assertFalse(metadata["is_answer_bearing"])
        self.assertEqual(metadata["answer_role"], "supporting_detail")
        self.assertEqual(
            evaluate_answer_ready_contract_metadata(
                corpus=record.corpus,
                collection=record.collection,
                metadata=metadata,
                anchor=chunks[0].anchor,
            ).status,
            "passed",
        )

    def test_official_web_regulation_body_uses_answer_ready_contract_semantics(
        self,
    ) -> None:
        record = _institutional_registry_record("official-web-regulation-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="official-web-regulation-test:unit-0009",
                    clean_text=(
                        "（四）依法审查的原则。进行公开的信息，应当依照法律法规进行审查，"
                        "公开的信息不得危及国家安全、公共安全、经济安全、社会稳定和学校安全稳定。"
                    ),
                    anchor={
                        "section_path": ["第一章 总则"],
                        "provision_label": "（四）",
                    },
                    metadata={
                        "title": "示例大学信息公开实施细则",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
                        "source_channel": "official_web",
                        "page_family": "article_detail",
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
        self.assertEqual(metadata["answer_role"], "exclusion_rule")
        self.assertEqual(metadata["condition_subject"], "safety_or_security_restriction")
        self.assertEqual(
            metadata["condition_subject_taxonomy_version"],
            "condition_subject.v1",
        )
        self.assertEqual(
            metadata["condition_subject_provenance"],
            "keyword:安全稳定限制",
        )
        self.assertEqual(
            metadata["condition_group_id"],
            "official-web-regulation-test:unit-0009:safety_or_security_restriction",
        )
        self.assertEqual(
            evaluate_answer_ready_contract_metadata(
                corpus=record.corpus,
                collection=record.collection,
                metadata=metadata,
                anchor=chunks[0].anchor,
            ).status,
            "passed",
        )

    def test_official_web_regulation_chinese_labeled_procedure_step_has_typed_fields(
        self,
    ) -> None:
        record = _institutional_registry_record("official-web-regulation-procedure-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="official-web-regulation-procedure-test:unit-0022",
                    clean_text="（四）统一受理、协调处理、统一答复向学校提出的信息公开申请；",
                    anchor={
                        "section_path": ["第三章 信息公开工作机构"],
                        "provision_label": "（四）",
                    },
                    metadata={
                        "title": "示例大学信息公开实施细则",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
                        "source_channel": "official_web",
                        "page_family": "article_detail",
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
        self.assertEqual(metadata["answer_role"], "procedure_step")
        self.assertEqual(metadata["procedure_step_index"], 4)
        self.assertEqual(
            metadata["clause_unit_id"], "official-web-regulation-procedure-test:unit-0022:4"
        )
        self.assertEqual(metadata["procedure_actor"], "office")
        self.assertEqual(metadata["procedure_action"], "process")
        self.assertEqual(metadata["procedure_action_provenance"], "keyword:处理")
        self.assertEqual(
            evaluate_answer_ready_contract_metadata(
                corpus=record.corpus,
                collection=record.collection,
                metadata=metadata,
                anchor=chunks[0].anchor,
            ).status,
            "passed",
        )

    def test_institutional_rules_procedure_list_preserves_child_steps(self) -> None:
        record = _institutional_registry_record("official-web-regulation-appeal-procedure-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="official-web-regulation-appeal-procedure-test:unit-0010",
                    clean_text="\n".join(
                        [
                            "申诉按如下程序办理:",
                            "（一）学生应当在收到处理决定后5个工作日内提交书面申诉申请。",
                            "（二）学校有关部门受理后进行复核并答复。",
                        ]
                    ),
                    anchor={
                        "section_path": ["第三章 申诉程序"],
                        "article_label": "第十条",
                    },
                    metadata={
                        "title": "示例大学学生申诉处理办法",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
                        "source_channel": "official_web",
                        "page_family": "article_detail",
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

        procedure_chunks = [
            chunk
            for chunk in chunks
            if "提交书面申诉申请" in chunk.metadata["display_text"]
            or "复核并答复" in chunk.metadata["display_text"]
        ]
        self.assertEqual(len(procedure_chunks), 2)
        self.assertEqual(
            tuple(chunk.metadata["answer_role"] for chunk in procedure_chunks),
            ("procedure_step", "procedure_step"),
        )
        self.assertEqual(
            tuple(chunk.metadata["procedure_step_index"] for chunk in procedure_chunks),
            (1, 2),
        )
        self.assertEqual(
            tuple(chunk.metadata["condition_subject"] for chunk in procedure_chunks),
            ("application_procedure", "application_procedure"),
        )

    def test_institutional_rules_deadline_clause_emits_time_constraint(self) -> None:
        record = _institutional_registry_record("official-web-regulation-appeal-deadline-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="official-web-regulation-appeal-deadline-test:unit-0011",
                    clean_text="学生应当在收到处理决定后5个工作日内提出申诉。",
                    anchor={
                        "section_path": ["第三章 申诉程序", "申诉期限"],
                        "article_label": "第十一条",
                        "provision_label": "（一）",
                    },
                    metadata={
                        "title": "示例大学学生申诉处理办法",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
                        "source_channel": "official_web",
                        "page_family": "article_detail",
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
        self.assertEqual(metadata["answer_role"], "time_constraint")
        self.assertEqual(metadata["condition_subject"], "deadline")
        self.assertEqual(metadata["claim_type"], "time_constraint")

    def test_institutional_rules_material_clause_emits_material_requirement(self) -> None:
        record = _institutional_registry_record("official-web-regulation-appeal-material-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="official-web-regulation-appeal-material-test:unit-0012",
                    clean_text="申诉申请应当提交书面申请、相关证明材料。",
                    anchor={
                        "section_path": ["第三章 申诉程序", "申诉材料"],
                        "article_label": "第十二条",
                        "provision_label": "（二）",
                    },
                    metadata={
                        "title": "示例大学学生申诉处理办法",
                        "content_role": "regulation_body",
                        "promotion_class": "formal_regulation",
                        "source_channel": "official_web",
                        "page_family": "article_detail",
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
        self.assertEqual(metadata["answer_role"], "material_requirement")
        self.assertEqual(metadata["condition_subject"], "material_requirement")

    def test_material_list_children_emit_material_requirement_answer_role(self) -> None:
        record = _registry_record_for_document("handbook:test-material-list-children")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-material-list",
                    clean_text="\n".join(
                        [
                            "申请材料如下:",
                            "1. 书面申请。",
                            "2. 相关证明材料。",
                        ]
                    ),
                    anchor={
                        "section_path": ["第三章 申诉材料"],
                        "article_label": "第三条",
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
            if chunk.metadata["display_text"] in {"1. 书面申请。", "2. 相关证明材料。"}
        ]
        self.assertEqual(len(material_chunks), 2)
        self.assertEqual(
            tuple(chunk.metadata["answer_role"] for chunk in material_chunks),
            ("material_requirement", "material_requirement"),
        )
        self.assertEqual(
            tuple(chunk.metadata["condition_subject"] for chunk in material_chunks),
            ("material_requirement", "material_requirement"),
        )
        self.assertEqual(
            tuple(chunk.metadata["condition_group_id"] for chunk in material_chunks),
            (
                "article-material-list:material_requirement",
                "article-material-list:material_requirement",
            ),
        )

        intro_chunks = [
            chunk for chunk in chunks if chunk.metadata["display_text"] == "申请材料如下:"
        ]
        self.assertEqual(len(intro_chunks), 1)
        intro_metadata = intro_chunks[0].metadata
        self.assertEqual(intro_metadata["answer_role"], "eligibility_intro")
        self.assertEqual(intro_metadata["intro_scope"], "material_list")
        self.assertEqual(intro_metadata["condition_subject"], "material_requirement")
        self.assertEqual(
            intro_metadata["introduced_condition_group_id"],
            "article-material-list:material_requirement",
        )
        self.assertEqual(intro_metadata["intro_target_roles"], ("material_requirement",))

    def test_time_list_children_emit_time_constraint_answer_role(self) -> None:
        record = _registry_record_for_document("handbook:test-time-list-children")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-time-list",
                    clean_text="\n".join(
                        [
                            "申诉期限如下:",
                            "1. 应在收到处理决定后5个工作日内提出申诉。",
                            "2. 公示期不少于3个工作日。",
                        ]
                    ),
                    anchor={
                        "section_path": ["第三章 申诉期限"],
                        "article_label": "第四条",
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
            }
        ]
        self.assertEqual(len(time_chunks), 2)
        self.assertEqual(
            tuple(chunk.metadata["answer_role"] for chunk in time_chunks),
            ("time_constraint", "time_constraint"),
        )
        self.assertEqual(
            tuple(chunk.metadata["condition_subject"] for chunk in time_chunks),
            ("deadline", "deadline"),
        )
        self.assertEqual(
            tuple(chunk.metadata["condition_group_id"] for chunk in time_chunks),
            ("article-time-list:deadline", "article-time-list:deadline"),
        )

        intro_chunks = [
            chunk for chunk in chunks if chunk.metadata["display_text"] == "申诉期限如下:"
        ]
        self.assertEqual(len(intro_chunks), 1)
        intro_metadata = intro_chunks[0].metadata
        self.assertEqual(intro_metadata["answer_role"], "eligibility_intro")
        self.assertEqual(intro_metadata["intro_scope"], "time_list")
        self.assertEqual(intro_metadata["condition_subject"], "deadline")
        self.assertEqual(
            intro_metadata["introduced_condition_group_id"],
            "article-time-list:deadline",
        )
        self.assertEqual(intro_metadata["intro_target_roles"], ("time_constraint",))


if __name__ == "__main__":
    unittest.main()
