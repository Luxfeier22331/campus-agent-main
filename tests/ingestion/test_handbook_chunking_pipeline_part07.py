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
                    metadata={"title": "中央民族大学学生听证实施办法"},
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
                        "title": "中央民族大学本科学生学籍管理办法",
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
        self.assertGreaterEqual(len(config["policy_categories"]), 17)
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
