from __future__ import annotations

import unittest

from tests.ingestion.handbook_chunking_pipeline_support import (
    Path,
    _registry_record_for_document,
    _structured_row,
    build_hermetic_handbook_v3_chunk_profile,
    build_indexable_chunks_from_jsonl,
    evaluate_answer_ready_contract_metadata,
    infer_condition_polarity,
    json,
)


class HandbookChunkingPipelinePart07Test(unittest.TestCase):
    def test_student_rules_hearing_procedure_intro_emits_typed_intro_not_step(self) -> None:
        record = _registry_record_for_document("handbook:test-hearing-procedure-intro")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-hearing",
                    clean_text="\n".join(
                        [
                            "听证会应当按照下列程序进行:",
                            "（一）调查人员提出当事人违法、违纪或者违规的事实、证据和处分建议;",
                            "（二）拟被处分学生或者其代理人进行陈述和申辩;",
                            "（三）听证结束。",
                        ]
                    ),
                    anchor={
                        "section_path": ["第三章 听证程序"],
                        "article_label": "第十二条",
                    },
                    metadata={"title": "示例大学学生听证实施办法"},
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
            if chunk.metadata["display_text"] == "听证会应当按照下列程序进行:"
        )
        self.assertEqual(intro_chunk.metadata["answer_role"], "eligibility_intro")
        self.assertEqual(intro_chunk.metadata["intro_scope"], "procedure_list")
        self.assertEqual(intro_chunk.metadata["intro_target_roles"], ("procedure_step",))
        self.assertEqual(
            intro_chunk.metadata["answer_ready_contract_validation_status"],
            "passed",
        )

        step_chunks = [
            chunk
            for chunk in chunks
            if chunk.metadata["display_text"]
            in {
                "（一）调查人员提出当事人违法、违纪或者违规的事实、证据和处分建议;",
                "（二）拟被处分学生或者其代理人进行陈述和申辩;",
                "（三）听证结束。",
            }
        ]
        self.assertEqual(len(step_chunks), 3)
        self.assertTrue(
            all(chunk.metadata["answer_role"] == "procedure_step" for chunk in step_chunks)
        )
        self.assertTrue(
            all(
                chunk.metadata["answer_ready_contract_validation_status"] == "passed"
                for chunk in step_chunks
            )
        )

    def test_definition_and_table_fact_default_to_neutral_condition_polarity(self) -> None:
        self.assertEqual(
            infer_condition_polarity(metadata={"answer_role": "definition"}),
            "neutral",
        )
        self.assertEqual(
            infer_condition_polarity(
                metadata={"answer_role": "table_fact", "table_fact_type": "generic_policy_table"}
            ),
            "neutral",
        )

    def test_typed_table_fact_polarity_is_positive_for_amount_and_timeline_queries(self) -> None:
        self.assertEqual(
            infer_condition_polarity(
                metadata={"answer_role": "table_fact", "table_fact_type": "amount_or_quota"}
            ),
            "positive",
        )
        self.assertEqual(
            infer_condition_polarity(
                metadata={"answer_role": "table_fact", "table_fact_type": "timeline_or_deadline"}
            ),
            "positive",
        )
        self.assertEqual(
            infer_condition_polarity(
                metadata={"answer_role": "table_fact", "table_fact_type": "required_materials"}
            ),
            "positive",
        )

    def test_hearing_application_deadline_keeps_positive_time_constraint_metadata(
        self,
    ) -> None:
        record = _registry_record_for_document("handbook:test-hearing-application-deadline")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-hearing-application",
                    clean_text=(
                        "学生要求听证的,应在收到拟处分或处理告知书后10日内提交书面听证申请。"
                    ),
                    anchor={
                        "section_path": ["第二章 听证申请"],
                        "article_label": "第十条",
                    },
                    metadata={"title": "示例大学学生听证实施办法"},
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
        self.assertEqual(metadata["content_role"], "deadline")
        self.assertEqual(metadata["semantic_role"], "time_constraint")
        self.assertEqual(metadata["claim_type"], "time_constraint")
        self.assertEqual(metadata["polarity"], "positive")
        self.assertEqual(metadata["condition_subject"], "deadline")
        self.assertEqual(metadata["condition_polarity"], "positive")
        self.assertEqual(
            metadata["answer_ready_contract_validation_status"],
            "passed",
        )
        self.assertEqual(metadata["procedure_actor"], "student")
        self.assertEqual(metadata["procedure_action"], "apply")
        self.assertEqual(metadata["procedure_action_taxonomy_version"], "procedure_action.v1")

    def test_appeal_deadline_and_late_consequence_emit_separate_answer_ready_contracts(
        self,
    ) -> None:
        record = _registry_record_for_document("handbook:test-appeal-deadline-consequence")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-appeal-deadline",
                    clean_text=(
                        "学生对学校的处理或者处分决定有异议的,可以在接到学校处理或者"
                        "处分决定书之日起10日内,向学校学生申诉处理委员会提出书面申诉。\n"
                        "学生在申诉期内未提出申诉的视为放弃申诉,学校不再受理。\n"
                        "最长不得超过6个月。"
                    ),
                    anchor={
                        "section_path": ["第三章 申诉申请"],
                        "article_label": "第十条",
                    },
                    metadata={"title": "示例大学学生申诉管理办法"},
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
        chunks_by_text = {chunk.metadata["display_text"]: chunk.metadata for chunk in chunks}

        deadline_text = (
            "学生对学校的处理或者处分决定有异议的,可以在接到学校处理或者"
            "处分决定书之日起10日内,向学校学生申诉处理委员会提出书面申诉。"
        )
        self.assertIn(deadline_text, chunks_by_text)
        deadline = chunks_by_text[deadline_text]
        self.assertEqual(deadline["answer_role"], "time_constraint")
        self.assertEqual(deadline["semantic_role"], "time_constraint")
        self.assertEqual(deadline["claim_type"], "time_constraint")
        self.assertEqual(deadline["polarity"], "positive")
        self.assertEqual(deadline["condition_subject"], "deadline")
        self.assertEqual(deadline["condition_polarity"], "positive")
        self.assertEqual(deadline["procedure_actor"], "student")
        self.assertEqual(deadline["procedure_action"], "appeal")
        self.assertEqual(
            deadline["procedure_action_taxonomy_version"],
            "procedure_action.v1",
        )
        self.assertEqual(
            deadline["answer_ready_contract_validation_status"],
            "passed",
        )

        consequence = chunks_by_text["学生在申诉期内未提出申诉的视为放弃申诉,学校不再受理。"]
        self.assertEqual(consequence["answer_role"], "exclusion_rule")
        self.assertEqual(consequence["polarity"], "negative")
        self.assertEqual(consequence["condition_polarity"], "negative")

    def test_student_card_report_loss_and_reissue_deadlines_keep_procedure_metadata(
        self,
    ) -> None:
        record = _registry_record_for_document("handbook:test-student-card-reissue")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-student-card-report-loss",
                    clean_text=(
                        "六、学生如将学生证遗失或损坏,应及时到学院(系)挂失,"
                        "写明遗失或损坏的原因、时间、地点等,并报学生处备案。"
                    ),
                    anchor={
                        "section_path": ["学生证补办"],
                        "article_label": "第六条",
                    },
                    metadata={"title": "示例大学本科(预科)学生证管理办法"},
                ),
                ensure_ascii=False,
            )
            + "\n"
            + json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-student-card-reissue",
                    clean_text=(
                        "八、学生补办学生证,必须提出书面申请,并填写"
                        "《示例大学补办学生证申请表》。申请表经学院(系)"
                        "领导审批后,到学生处办理补办手续。学生证集中补办时间为每周四下午。"
                    ),
                    anchor={
                        "section_path": ["学生证补办"],
                        "article_label": "第八条",
                    },
                    metadata={"title": "示例大学本科(预科)学生证管理办法"},
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
        chunks_by_text = {chunk.metadata["display_text"]: chunk.metadata for chunk in chunks}

        report_loss = chunks_by_text[
            "六、学生如将学生证遗失或损坏,应及时到学院(系)挂失,"
            "写明遗失或损坏的原因、时间、地点等,并报学生处备案。"
        ]
        self.assertEqual(report_loss["answer_role"], "time_constraint")
        self.assertEqual(report_loss["condition_subject"], "deadline")
        self.assertEqual(report_loss["procedure_step_index"], 6)
        self.assertEqual(report_loss["procedure_actor"], "student")
        self.assertEqual(report_loss["procedure_action"], "report_loss")
        self.assertEqual(
            report_loss["procedure_action_taxonomy_version"],
            "procedure_action.v1",
        )

        reissue = chunks_by_text[
            "八、学生补办学生证,必须提出书面申请,并填写"
            "《示例大学补办学生证申请表》。申请表经学院(系)"
            "领导审批后,到学生处办理补办手续。学生证集中补办时间为每周四下午。"
        ]
        self.assertEqual(reissue["answer_role"], "time_constraint")
        self.assertEqual(reissue["condition_subject"], "deadline")
        self.assertEqual(reissue["procedure_step_index"], 8)
        self.assertEqual(reissue["procedure_actor"], "student")
        self.assertEqual(reissue["procedure_action"], "reissue")
        self.assertEqual(
            reissue["procedure_action_taxonomy_version"],
            "procedure_action.v1",
        )

    def test_generic_policy_table_chunk_gets_non_empty_condition_subject(self) -> None:
        record = _registry_record_for_document("handbook:test-gpa-table")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="table_unit",
                    root_unit_id="table-gpa-conversion",
                    clean_text=(
                        "表格上下文: 成绩与平均学分绩点对照表\n"
                        "百分制成绩 | 平均学分绩点\n"
                        "90-100 | 4.0\n"
                        "80-89 | 3.0"
                    ),
                    anchor={
                        "page_start": 1,
                        "page_end": 1,
                        "table_context": "成绩与平均学分绩点对照表",
                    },
                    metadata={
                        "title": "示例大学本科学生学籍管理办法",
                        "caption_lines": ["成绩与平均学分绩点对照表"],
                        "table_header_line": "百分制成绩 | 平均学分绩点",
                        "table_row_lines": ["90-100 | 4.0", "80-89 | 3.0"],
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
        self.assertEqual(metadata["answer_role"], "table_fact")
        self.assertEqual(metadata["table_fact_type"], "generic_policy_table")
        self.assertEqual(metadata["condition_subject"], "rank_threshold")
        self.assertEqual(metadata["condition_polarity"], "neutral")
        self.assertEqual(
            evaluate_answer_ready_contract_metadata(
                corpus=record.corpus,
                collection=record.collection,
                metadata=metadata,
                anchor=chunks[0].anchor,
            ).status,
            "passed",
        )

    def test_student_rules_registry_covers_all_manifest_documents(self) -> None:
        config_path = Path("configs/ingestion/regulations/student_rules/query-planning.json")
        manifest_path = Path("configs/ingestion/regulations/student_rules/split-manifest.v1.json")
        config = json.loads(config_path.read_text(encoding="utf-8"))
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))

        manifest_ids = {str(document["document_id"]).strip() for document in manifest["documents"]}
        object_ids = {
            str(policy_object["document_id"]).strip() for policy_object in config["policy_objects"]
        }
        category_member_ids = {
            str(document_id).strip()
            for category in config["policy_categories"]
            for document_id in category["member_policy_document_ids"]
        }

        self.assertEqual(object_ids, manifest_ids)
        self.assertEqual(category_member_ids, manifest_ids)
        self.assertEqual(len(config["policy_categories"]), 6)
        self.assertTrue(
            all(
                isinstance(category.get("overview_document_id"), str)
                and category["overview_document_id"].strip()
                and category["overview_document_id"] in category["member_policy_document_ids"]
                for category in config["policy_categories"]
            )
        )


if __name__ == "__main__":
    unittest.main()
