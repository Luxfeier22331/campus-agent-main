from __future__ import annotations

import unittest

from tests.ingestion.handbook_chunking_pipeline_support import (
    StructuredUnit,
    _registry_record_for_document,
    _structured_row,
    build_answer_ready_contract_metadata,
    build_hermetic_handbook_v3_chunk_profile,
    build_indexable_chunks_from_jsonl,
    build_regulation_unit_pieces,
    infer_condition_group_id,
    json,
)


class HandbookChunkingPipelinePart06Test(unittest.TestCase):
    def test_student_rules_narrative_amount_clause_can_emit_answer_ready_fact_metadata(
        self,
    ) -> None:
        record = _registry_record_for_document("handbook:test-narrative-amount")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-amount-fact",
                    clean_text=(
                        "学校为本科学生专业奖学金获得者颁发荣誉证书和奖金。"
                        "其中,专业一等奖学奖金奖励标准为2000元,专业二等奖学奖金奖励标准为1200元。"
                    ),
                    anchor={
                        "page_start": 1,
                        "page_end": 1,
                        "section_path": ["第六章 表彰奖励"],
                        "article_label": "第十六条",
                    },
                    metadata={
                        "title": "中央民族大学本科学生专业奖学金评定办法",
                        "policy_doc_no": "民大校发[2018]326号",
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

        fact_chunk = next(
            (
                chunk
                for chunk in chunks
                if "2000元" in chunk.metadata.get("display_text", "")
                and chunk.metadata.get("answer_role") == "table_fact"
            ),
            None,
        )
        self.assertIsNotNone(fact_chunk)
        assert fact_chunk is not None
        metadata = fact_chunk.metadata
        self.assertEqual(metadata["content_role"], "table_fact")
        self.assertEqual(metadata["semantic_role"], "table_fact")
        self.assertEqual(metadata["claim_type"], "amount_or_quota")
        self.assertEqual(metadata["table_fact_type"], "amount_or_quota")
        self.assertEqual(metadata["condition_subject"], "amount_or_quota")
        self.assertEqual(metadata["condition_polarity"], "positive")
        self.assertEqual(
            metadata["condition_group_id"],
            "article-amount-fact:amount_or_quota",
        )
        self.assertTrue(metadata["is_answer_bearing"])

    def test_material_requirement_condition_group_id_is_emitted_for_answer_ready_contract(
        self,
    ) -> None:
        group_id = infer_condition_group_id(
            text="申诉申请应当提交书面申请、相关证明材料。",
            metadata={
                "answer_role": "material_requirement",
                "condition_subject": "material_requirement",
                "parent_unit_id": "doc-b:article-12",
            },
            root_unit_id="doc-b:article-12",
        )

        self.assertEqual(group_id, "doc-b:article-12:material_requirement")

    def test_table_fact_condition_group_id_uses_shared_subject_resolution(self) -> None:
        group_id = infer_condition_group_id(
            text="公示期限 | 5个工作日",
            metadata={
                "answer_role": "table_fact",
                "table_fact_type": "timeline_or_deadline",
                "parent_unit_id": "doc-b:table-1",
            },
            root_unit_id="doc-b:table-1",
        )

        self.assertEqual(group_id, "doc-b:table-1:deadline")

    def test_contract_builder_ignores_bridge_condition_group_key_in_final_metadata(self) -> None:
        contract = build_answer_ready_contract_metadata(
            text="综合测评成绩排名应位于前10%。",
            metadata={
                "answer_role": "eligibility_condition",
                "condition_subject": "rank_threshold",
                "condition_group_key": "group-01:rank_threshold",
                "parent_unit_id": "doc-b:article-12",
            },
            root_unit_id="doc-b:article-12",
        )

        self.assertEqual(contract["condition_group_id"], "doc-b:article-12:rank_threshold")

    def test_contract_builder_recomputes_incompatible_group_subject_for_procedure_step(
        self,
    ) -> None:
        contract = build_answer_ready_contract_metadata(
            text="2. 双向选择项目系由本校教师或院系提出项目,由学生提出立项申请,经专家组审核后纳入本科生研究训练计划的项目;",
            metadata={
                "answer_role": "procedure_step",
                "condition_group_subject": "generic_condition",
                "condition_group_id": "article-0010:generic_condition",
                "procedure_actor": "instructor",
                "procedure_action": "review",
                "provision_label": "2.",
                "parent_unit_id": "article-0010",
                "section_path": ["一、总则"],
            },
            root_unit_id="article-0010",
        )

        self.assertEqual(contract["condition_subject"], "application_procedure")
        self.assertEqual(contract["condition_group_subject"], "application_procedure")
        self.assertEqual(contract["condition_group_id"], "article-0010:application_procedure")

    def test_contract_builder_recomputes_deadline_group_subject_for_non_procedure_clause(
        self,
    ) -> None:
        contract = build_answer_ready_contract_metadata(
            text="5. 每年9月份和3月份为项目启动时间。",
            metadata={
                "answer_role": "eligibility_condition",
                "condition_group_subject": "application_procedure",
                "condition_group_id": "article-0018:application_procedure",
                "provision_label": "5.",
                "parent_unit_id": "article-0018",
                "section_path": ["一、总则"],
            },
            root_unit_id="article-0018",
        )

        self.assertEqual(contract["condition_subject"], "deadline")
        self.assertEqual(contract["condition_group_subject"], "deadline")
        self.assertEqual(contract["condition_group_id"], "article-0018:deadline")

    def test_contract_builder_ignores_bridge_intro_group_key_in_final_metadata(self) -> None:
        contract = build_answer_ready_contract_metadata(
            text="申请材料如下:",
            metadata={
                "answer_role": "eligibility_intro",
                "introduced_condition_subject": "material_requirement",
                "introduced_condition_group_key": "group-01:material_requirement",
                "intro_target_roles": ["material_requirement"],
                "parent_unit_id": "doc-b:article-13",
                "is_answer_bearing": False,
            },
            root_unit_id="doc-b:article-13",
        )

        self.assertEqual(
            contract["introduced_condition_group_id"],
            "doc-b:article-13:material_requirement",
        )
        self.assertEqual(contract["condition_group_id"], "doc-b:article-13:material_requirement")

    def test_procedure_context_does_not_upgrade_eligibility_statement_to_procedure_step(
        self,
    ) -> None:
        record = _registry_record_for_document("handbook:test-procedure-context-no-upgrade")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-procedure-context-no-upgrade",
                    clean_text="\n".join(
                        [
                            "（一）提出申请。",
                            "（二）在同一学年内,申请国家助学金的家庭经济困难学生可同时申请并获得国家奖学金或国家励志奖学金。",
                        ]
                    ),
                    anchor={
                        "section_path": ["四、评审要求与程序"],
                        "article_label": "第十条",
                        "page_start": 1,
                        "page_end": 1,
                    },
                    metadata={
                        "title": "中央民族大学国家助学金评审办法",
                        "content_role": "regulation_body",
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

        target = next(
            chunk
            for chunk in chunks
            if "在同一学年内,申请国家助学金" in chunk.metadata["display_text"]
        )
        self.assertEqual(target.metadata["answer_role"], "eligibility_condition")
        self.assertNotEqual(target.metadata["condition_subject"], "application_procedure")

    def test_procedure_context_heading_only_review_topic_does_not_upgrade_to_procedure_step(
        self,
    ) -> None:
        record = _registry_record_for_document("handbook:test-procedure-heading-review-topic")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-procedure-heading-review-topic",
                    clean_text="\n".join(
                        [
                            "（四）选拔考核方式",
                            "1.学校统一组织选拔的项目,选拔考核方式包括笔试、面试等两个环节。",
                            "（五）笔试考核",
                            "（六）面试考核",
                        ]
                    ),
                    anchor={
                        "section_path": ["第二章 申请与选拔"],
                        "article_label": "第八条",
                        "page_start": 1,
                        "page_end": 1,
                    },
                    metadata={
                        "title": "中央民族大学本科生境外留学管理办法",
                        "content_role": "regulation_body",
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
        self.assertIn("选拔考核方式", metadata["display_text"])
        self.assertNotEqual(metadata["answer_role"], "procedure_step")

    def test_answer_ready_piece_without_enough_list_members_does_not_emit_false_procedure_steps(
        self,
    ) -> None:
        unit = StructuredUnit(
            unit_index=1,
            document_id="handbook:test-assessment-heading-pieces",
            version_id="v1:test-assessment-heading-pieces",
            text="\n".join(
                [
                    "（四）选拔考核方式",
                    "1.学校统一组织选拔的项目,选拔考核方式包括笔试、面试等两个环节。",
                    "（五）笔试考核",
                    "（六）面试考核",
                ]
            ),
            source_chunk_id=None,
            anchor={
                "section_path": ["第二章 申请与选拔"],
                "article_label": "第八条",
                "page_start": 1,
                "page_end": 1,
            },
            visibility_level="public",
            unit_type="article_body",
            root_unit_id="article-assessment-heading-pieces",
            metadata={
                "title": "中央民族大学本科生境外留学管理办法",
                "content_role": "regulation_body",
            },
        )

        pieces = build_regulation_unit_pieces(
            unit,
            build_hermetic_handbook_v3_chunk_profile(),
            answer_ready_roles=True,
        )

        self.assertEqual(len(pieces), 1)
        self.assertEqual(pieces[0].text, unit.text)
        self.assertEqual(pieces[0].metadata, {})

    def test_transfer_major_intro_with_article_prefixed_children_emits_typed_intro_target_roles(
        self,
    ) -> None:
        record = _registry_record_for_document("handbook:test-transfer-major-intro-merge")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-transfer-major-intro-merge",
                    clean_text="\n".join(
                        [
                            "第三条 本章所述的转专业是指从招生录取专业调整到其他不同专业进行培养的专业调整方式。",
                            "第四条 (一)具备以下条件的学生可申请转专业:",
                            "第四条 1.在籍在校的一年级本科学生。",
                            "第四条 2.对转入专业有兴趣,转专业之后更能发挥所长者。",
                            "第四条 3.身体条件符合拟转入专业要求者。",
                        ]
                    ),
                    anchor={
                        "section_path": ["第二章 转专业"],
                        "article_label": "第三条",
                        "page_start": 1,
                        "page_end": 1,
                    },
                    metadata={
                        "title": "中央民族大学本科生学籍管理规定",
                        "content_role": "regulation_body",
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

        intro_chunk = next(
            chunk
            for chunk in chunks
            if "具备以下条件的学生可申请转专业" in chunk.metadata["display_text"]
        )
        self.assertEqual(intro_chunk.metadata["answer_role"], "eligibility_intro")
        self.assertEqual(intro_chunk.metadata["intro_target_roles"], ("eligibility_condition",))
        self.assertEqual(intro_chunk.metadata["intro_scope"], "eligibility_group")
        self.assertEqual(
            intro_chunk.metadata["introduced_condition_group_id"],
            "article-transfer-major-intro-merge:generic_condition",
        )
        self.assertEqual(
            intro_chunk.metadata["answer_ready_contract_validation_status"],
            "passed",
        )

    def test_definition_chunk_does_not_merge_into_following_intro_with_nested_children(
        self,
    ) -> None:
        record = _registry_record_for_document("handbook:test-transfer-major-real-doc")
        structured_payload = (
            "\n".join(
                (
                    json.dumps(
                        _structured_row(
                            doc_id=record.document_id,
                            version_id=record.version_id,
                            unit_type="article_body",
                            root_unit_id="article-0003",
                            clean_text="本章所述的转专业是指从招生录取专业调整到其他不同专业进行培养的专业调整方式。",
                            anchor={
                                "section_path": ["第二章 转专业"],
                                "article_label": "第三条",
                                "page_start": 68,
                                "page_end": 68,
                            },
                            metadata={
                                "title": "中央民族大学本科生专业调整实施办法",
                                "content_role": "regulation_body",
                            },
                        ),
                        ensure_ascii=False,
                    ),
                    json.dumps(
                        _structured_row(
                            doc_id=record.document_id,
                            version_id=record.version_id,
                            unit_type="article_body",
                            root_unit_id="article-0004",
                            clean_text="\n".join(
                                [
                                    "转专业条件",
                                    "(一)具备以下条件的学生可申请转专业:",
                                    "1.在籍在校的一年级本科学生。",
                                    "2.对转入专业有兴趣,转专业之后更能发挥所长者。",
                                    "3.身体条件符合拟转入专业要求者。",
                                    "(二)有下列情况之一者,不允许申请转专业:",
                                    "1.身体条件不符合申请转入专业的体检标准者。",
                                    "2.学校在招生录取时有明确限定者。",
                                    "3.艺术类、体育类专业的学生。",
                                ]
                            ),
                            anchor={
                                "section_path": ["第二章 转专业"],
                                "article_label": "第四条",
                                "page_start": 68,
                                "page_end": 69,
                            },
                            metadata={
                                "title": "中央民族大学本科生专业调整实施办法",
                                "content_role": "regulation_body",
                            },
                        ),
                        ensure_ascii=False,
                    ),
                )
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
            if chunk.metadata["display_text"] == "(一)具备以下条件的学生可申请转专业:"
        )
        self.assertEqual(intro_chunk.metadata["answer_role"], "eligibility_intro")
        self.assertEqual(intro_chunk.metadata["intro_target_roles"], ("eligibility_condition",))
        self.assertEqual(intro_chunk.metadata["intro_scope"], "eligibility_group")
        self.assertEqual(
            intro_chunk.metadata["introduced_condition_group_id"],
            "article-0004:generic_condition",
        )
        self.assertEqual(
            intro_chunk.metadata["answer_ready_contract_validation_status"],
            "passed",
        )

        mixed_definition_chunk = next(
            chunk
            for chunk in chunks
            if "本章所述的转专业是指从招生录取专业调整到其他不同专业进行培养的专业调整方式。"
            in chunk.metadata["display_text"]
        )
        self.assertNotEqual(
            mixed_definition_chunk.metadata["answer_role"],
            "eligibility_intro",
        )

    def test_answer_ready_piece_metadata_emits_group_ids_before_contract_builder(self) -> None:
        unit = StructuredUnit(
            unit_index=1,
            document_id="handbook:test-piece-group-id",
            version_id="v1:test-piece-group-id",
            text="\n".join(
                [
                    "申请材料如下:",
                    "1. 书面申请。",
                    "2. 相关证明材料。",
                ]
            ),
            source_chunk_id=None,
            anchor={
                "section_path": ["第三章 申诉材料"],
                "article_label": "第三条",
                "page_start": 1,
                "page_end": 1,
            },
            visibility_level="public",
            unit_type="article_body",
            root_unit_id="article-piece-group-id",
            metadata={
                "title": "中央民族大学学生申诉处理办法",
                "content_role": "regulation_body",
            },
        )

        pieces = build_regulation_unit_pieces(
            unit,
            build_hermetic_handbook_v3_chunk_profile(),
            answer_ready_roles=True,
        )

        intro_piece = next(piece for piece in pieces if piece.text == "申请材料如下:")
        self.assertEqual(
            intro_piece.metadata["introduced_condition_group_id"],
            "article-piece-group-id:material_requirement",
        )
        child_pieces = [
            piece for piece in pieces if piece.text in {"1. 书面申请。", "2. 相关证明材料。"}
        ]
        self.assertEqual(len(child_pieces), 2)
        self.assertEqual(
            tuple(piece.metadata["condition_group_id"] for piece in child_pieces),
            (
                "article-piece-group-id:material_requirement",
                "article-piece-group-id:material_requirement",
            ),
        )
        self.assertNotIn("introduced_condition_group_key", intro_piece.metadata)
        self.assertTrue(
            all("condition_group_key" not in piece.metadata for piece in child_pieces),
        )

    def test_student_rules_exclusion_group_with_disbursement_prefix_does_not_degrade_to_procedure(
        self,
    ) -> None:
        record = _registry_record_for_document("handbook:test-aid-exclusion-group")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-aid-exclusion",
                    clean_text="\n".join(
                        [
                            "出现下列情形之一的,由院系核实并报学校助学服务中心备案,从当月起中止其助学金发放:",
                            "（一）因违纪受到学校处分的;",
                            "（二）申请材料弄虚作假的;",
                            "（三）有吸烟习惯的;",
                        ]
                    ),
                    anchor={
                        "section_path": ["第四章 发放与中止", "中止发放"],
                        "article_label": "第十条",
                    },
                    metadata={"title": "中央民族大学本科生国家助学金评审办法"},
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
            == "出现下列情形之一的,由院系核实并报学校助学服务中心备案,从当月起中止其助学金发放:"
        )
        self.assertEqual(intro_chunk.metadata["answer_role"], "eligibility_intro")
        self.assertEqual(intro_chunk.metadata["intro_target_roles"], ("exclusion_rule",))
        self.assertEqual(
            intro_chunk.metadata["introduced_condition_group_id"],
            "article-aid-exclusion:generic_condition",
        )
        self.assertEqual(
            intro_chunk.metadata["answer_ready_contract_validation_status"],
            "passed",
        )

        child_chunks = [
            chunk
            for chunk in chunks
            if chunk.metadata["display_text"]
            in {
                "（一）因违纪受到学校处分的;",
                "（二）申请材料弄虚作假的;",
                "（三）有吸烟习惯的;",
            }
        ]
        self.assertEqual(len(child_chunks), 3)
        self.assertTrue(
            all(chunk.metadata["answer_role"] == "exclusion_rule" for chunk in child_chunks)
        )
        self.assertTrue(
            all(
                chunk.metadata["condition_subject"] != "application_procedure"
                for chunk in child_chunks
            )
        )
        self.assertTrue(
            all(
                chunk.metadata["answer_ready_contract_validation_status"] == "passed"
                for chunk in child_chunks
            )
        )


if __name__ == "__main__":
    unittest.main()
