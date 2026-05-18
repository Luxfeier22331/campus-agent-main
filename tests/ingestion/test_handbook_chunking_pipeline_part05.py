from __future__ import annotations

import unittest

from tests.ingestion.handbook_chunking_pipeline_support import (
    _institutional_registry_record,
    _registry_record_for_document,
    _structured_row,
    build_answer_ready_contract_metadata,
    build_hermetic_handbook_v3_chunk_profile,
    build_indexable_chunks_from_jsonl,
    evaluate_answer_ready_contract_metadata,
    json,
)


class HandbookChunkingPipelinePart05Test(unittest.TestCase):
    def test_student_rules_parenthesized_numeric_examples_do_not_mix_with_exception(
        self,
    ) -> None:
        record = _registry_record_for_document("handbook:test-parenthesized-examples")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-examples",
                    clean_text="\n".join(
                        [
                            "参评学生还须具备以下条件之一:",
                            "（二）学习成绩排名超出前10%,但位于前30%。具体表现如下:",
                            "（1）在学术研究上取得显著成绩。",
                            "（2）在体育竞赛中取得显著成绩。",
                        ]
                    ),
                    metadata={"title": "中央民族大学本科学生国家奖学金评审办法"},
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

        exception_chunks = [
            chunk for chunk in chunks if "学习成绩排名超出前10%" in chunk.metadata["display_text"]
        ]
        self.assertEqual(len(exception_chunks), 1)
        self.assertEqual(exception_chunks[0].metadata["answer_role"], "exception_rule")
        self.assertNotIn("在学术研究上", exception_chunks[0].metadata["display_text"])
        example_chunks = [
            chunk
            for chunk in chunks
            if "在学术研究上取得显著成绩" in chunk.metadata["display_text"]
        ]
        self.assertEqual(len(example_chunks), 1)
        self.assertEqual(example_chunks[0].metadata["answer_role"], "example_evidence")

    def test_student_rules_inline_example_tail_splits_from_main_exception_clause(self) -> None:
        record = _registry_record_for_document("handbook:test-inline-example-tail")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-inline-example",
                    clean_text="\n".join(
                        [
                            "参评学生还须具备以下条件之一:",
                            "（二）学习成绩排名超出前10%,但位于前30%,且在学术研究上取得显著成绩。",
                        ]
                    ),
                    metadata={"title": "中央民族大学本科学生国家奖学金评审办法"},
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

        exception_chunks = [
            chunk for chunk in chunks if "学习成绩排名超出前10%" in chunk.metadata["display_text"]
        ]
        self.assertEqual(len(exception_chunks), 1)
        exception_chunk = exception_chunks[0]
        self.assertEqual(exception_chunk.metadata["answer_role"], "exception_rule")
        self.assertEqual(exception_chunk.metadata["condition_subject"], "rank_threshold")
        self.assertEqual(exception_chunk.metadata["clause_unit_id"], "article-inline-example:2")
        self.assertNotIn("在学术研究上取得显著成绩", exception_chunk.metadata["display_text"])

        example_chunks = [
            chunk
            for chunk in chunks
            if "在学术研究上取得显著成绩" in chunk.metadata["display_text"]
        ]
        self.assertEqual(len(example_chunks), 1)
        example_chunk = example_chunks[0]
        self.assertEqual(example_chunk.metadata["answer_role"], "example_evidence")
        self.assertEqual(example_chunk.metadata["condition_subject"], "paper_or_publication")
        self.assertEqual(example_chunk.metadata["clause_unit_id"], "article-inline-example:2")
        self.assertEqual(
            example_chunk.metadata["condition_group_id"],
            exception_chunk.metadata["condition_group_id"],
        )
        self.assertNotIn("学习成绩排名超出前10%", example_chunk.metadata["display_text"])

    def test_student_rules_inline_multiple_example_tails_split_into_multiple_child_units(
        self,
    ) -> None:
        record = _registry_record_for_document("handbook:test-inline-multiple-example-tails")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-inline-multi-example",
                    clean_text="\n".join(
                        [
                            "参评学生还须具备以下条件之一:",
                            "（二）学习成绩排名超出前10%,但位于前30%,且在学术研究上取得显著成绩,在体育竞赛中取得显著成绩。",
                        ]
                    ),
                    metadata={"title": "中央民族大学本科学生国家奖学金评审办法"},
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

        exception_chunks = [
            chunk for chunk in chunks if "学习成绩排名超出前10%" in chunk.metadata["display_text"]
        ]
        self.assertEqual(len(exception_chunks), 1)
        exception_chunk = exception_chunks[0]
        self.assertEqual(exception_chunk.metadata["answer_role"], "exception_rule")

        example_chunks = [
            chunk for chunk in chunks if "取得显著成绩" in chunk.metadata["display_text"]
        ]
        self.assertEqual(len(example_chunks), 2)
        self.assertEqual(
            tuple(chunk.metadata["answer_role"] for chunk in example_chunks),
            ("example_evidence", "example_evidence"),
        )
        self.assertEqual(
            tuple(chunk.metadata["clause_unit_id"] for chunk in example_chunks),
            ("article-inline-multi-example:2", "article-inline-multi-example:2"),
        )
        self.assertTrue(
            all(
                chunk.metadata["condition_group_id"]
                == exception_chunk.metadata["condition_group_id"]
                for chunk in example_chunks
            )
        )
        self.assertEqual(
            tuple(chunk.metadata["display_text"] for chunk in example_chunks),
            ("且在学术研究上取得显著成绩", "在体育竞赛中取得显著成绩"),
        )

    def test_repeated_inline_example_groups_emit_distinct_group_ids(self) -> None:
        record = _registry_record_for_document("handbook:test-repeated-inline-example-groups")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-repeated-inline-example-groups",
                    clean_text="\n".join(
                        [
                            "符合下列条件之一:",
                            "（一）学习成绩排名超出前10%,但位于前30%,且在学术研究上取得显著成绩。",
                            "符合下列条件之一:",
                            "（二）学习成绩排名超出前10%,但位于前30%,且在体育竞赛中取得显著成绩。",
                        ]
                    ),
                    anchor={
                        "section_path": ["第二章 评审条件"],
                        "article_label": "第十二条",
                        "page_start": 1,
                        "page_end": 1,
                    },
                    metadata={"title": "中央民族大学本科学生综合奖励评审办法"},
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
            chunk for chunk in chunks if chunk.metadata["display_text"] == "符合下列条件之一:"
        ]
        self.assertEqual(len(intro_chunks), 2)
        self.assertEqual(
            tuple(chunk.metadata["introduced_condition_group_id"] for chunk in intro_chunks),
            (
                "article-repeated-inline-example-groups:group-01:rank_threshold",
                "article-repeated-inline-example-groups:group-02:rank_threshold",
            ),
        )
        self.assertEqual(
            tuple(chunk.metadata["intro_target_roles"] for chunk in intro_chunks),
            (
                ("exception_rule", "example_evidence"),
                ("exception_rule", "example_evidence"),
            ),
        )

        exception_chunks = [
            chunk for chunk in chunks if "学习成绩排名超出前10%" in chunk.metadata["display_text"]
        ]
        self.assertEqual(len(exception_chunks), 2)
        self.assertEqual(
            tuple(chunk.metadata["condition_group_id"] for chunk in exception_chunks),
            (
                "article-repeated-inline-example-groups:group-01:rank_threshold",
                "article-repeated-inline-example-groups:group-02:rank_threshold",
            ),
        )

        example_chunks = [
            chunk for chunk in chunks if "取得显著成绩" in chunk.metadata["display_text"]
        ]
        self.assertEqual(len(example_chunks), 2)
        self.assertEqual(
            tuple(chunk.metadata["condition_group_id"] for chunk in example_chunks),
            (
                "article-repeated-inline-example-groups:group-01:rank_threshold",
                "article-repeated-inline-example-groups:group-02:rank_threshold",
            ),
        )

    def test_mixed_condition_and_procedure_clause_uses_condition_group_anchor(self) -> None:
        record = _institutional_registry_record("official-web-regulation-mixed-group-anchor-test")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id="official-web-regulation-mixed-group-anchor-test:unit-0001",
                    clean_text="\n".join(
                        [
                            "符合下列条件之一:",
                            "（一）设备达到学校安全等级要求；核准后接入校园网。",
                        ]
                    ),
                    anchor={
                        "section_path": ["第二章 校园网络接入条件"],
                        "article_label": "第十二条",
                        "page_start": 1,
                        "page_end": 1,
                    },
                    metadata={
                        "title": "中央民族大学信息系统管理办法",
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

        intro_chunk = next(
            chunk for chunk in chunks if chunk.metadata["display_text"] == "符合下列条件之一:"
        )
        self.assertEqual(intro_chunk.metadata["answer_role"], "eligibility_intro")
        self.assertEqual(intro_chunk.metadata["intro_scope"], "eligibility_group")
        self.assertEqual(
            intro_chunk.metadata["intro_target_roles"],
            ("eligibility_condition", "procedure_step"),
        )
        self.assertEqual(
            intro_chunk.metadata["introduced_condition_group_id"],
            "official-web-regulation-mixed-group-anchor-test:unit-0001:security_or_confidentiality_requirement",
        )

        condition_chunk = next(
            chunk for chunk in chunks if "达到学校安全等级要求" in chunk.metadata["display_text"]
        )
        self.assertEqual(condition_chunk.metadata["answer_role"], "eligibility_condition")
        self.assertEqual(
            condition_chunk.metadata["condition_group_id"],
            "official-web-regulation-mixed-group-anchor-test:unit-0001:security_or_confidentiality_requirement",
        )

        procedure_chunk = next(
            chunk for chunk in chunks if "核准后接入校园网" in chunk.metadata["display_text"]
        )
        self.assertEqual(procedure_chunk.metadata["answer_role"], "procedure_step")
        self.assertEqual(procedure_chunk.metadata["condition_subject"], "application_procedure")
        self.assertEqual(
            procedure_chunk.metadata["condition_group_id"],
            condition_chunk.metadata["condition_group_id"],
        )
        self.assertEqual(
            procedure_chunk.metadata["condition_group_subject"],
            "security_or_confidentiality_requirement",
        )
        self.assertEqual(
            evaluate_answer_ready_contract_metadata(
                corpus=record.corpus,
                collection=record.collection,
                metadata=procedure_chunk.metadata,
                anchor=procedure_chunk.anchor,
            ).status,
            "passed",
        )

    def test_directed_written_application_step_contract_has_applicant_actor(self) -> None:
        contract = build_answer_ready_contract_metadata(
            text=(
                "向校医院提出书面申请,经批准后方可报销休学期间医药费。"
                "休学一年以上者不再享受公费医疗。"
            ),
            metadata={
                "answer_role": "procedure_step",
                "provision_label": "9.",
                "parent_unit_id": "policy-page-medical",
            },
            root_unit_id="policy-page-medical",
        )

        self.assertEqual(contract["procedure_actor"], "applicant")
        self.assertEqual(contract["procedure_action"], "apply")
        self.assertEqual(contract["condition_subject"], "application_procedure")
        self.assertEqual(
            contract["condition_group_id"], "policy-page-medical:application_procedure"
        )
        self.assertEqual(
            evaluate_answer_ready_contract_metadata(
                corpus="regulations",
                collection="student_rules",
                metadata={**contract, "answer_role": "procedure_step"},
            ).status,
            "passed",
        )

    def test_single_enumerated_answer_ready_clause_keeps_clause_unit_identity(self) -> None:
        record = _registry_record_for_document("handbook:test-single-answer-ready-clause")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-single-clause",
                    clean_text="\n".join(
                        [
                            "参评学生还须具备以下条件之一:",
                            "（二）学习成绩排名位于前10%。",
                        ]
                    ),
                    metadata={"title": "中央民族大学本科学生国家奖学金评审办法"},
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
            if chunk.metadata["display_text"] == "参评学生还须具备以下条件之一:"
        ]
        self.assertEqual(len(intro_chunks), 1)
        self.assertEqual(intro_chunks[0].metadata["answer_role"], "eligibility_intro")

        condition_chunks = [
            chunk for chunk in chunks if "学习成绩排名位于前10%" in chunk.metadata["display_text"]
        ]
        self.assertEqual(len(condition_chunks), 1)
        condition_chunk = condition_chunks[0]
        self.assertEqual(condition_chunk.metadata["answer_role"], "eligibility_condition")
        self.assertEqual(condition_chunk.metadata["condition_subject"], "rank_threshold")
        self.assertEqual(condition_chunk.metadata["clause_unit_id"], "article-single-clause:2")
        self.assertEqual(
            condition_chunk.metadata["condition_group_id"],
            "article-single-clause:rank_threshold",
        )

    def test_shared_intro_context_is_preserved_for_following_atomic_eligibility_clauses(
        self,
    ) -> None:
        record = _registry_record_for_document("handbook:test-shared-intro-atomic-clauses")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-shared-intro-atomic-clauses",
                    clean_text="\n".join(
                        [
                            "符合下列条件之一:",
                            "（一）学习成绩排名位于前10%。",
                            "（二）综合测评成绩位于前10%。",
                        ]
                    ),
                    anchor={
                        "section_path": ["第二章 评审条件"],
                        "article_label": "第十条",
                        "page_start": 1,
                        "page_end": 1,
                    },
                    metadata={"title": "中央民族大学本科学生综合奖励评审办法"},
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

        condition_chunks = [
            chunk for chunk in chunks if "位于前10%" in chunk.metadata["display_text"]
        ]
        self.assertEqual(len(condition_chunks), 2)
        self.assertEqual(
            tuple(chunk.metadata["answer_role"] for chunk in condition_chunks),
            ("eligibility_condition", "eligibility_condition"),
        )
        self.assertEqual(
            tuple(chunk.metadata["clause_unit_id"] for chunk in condition_chunks),
            (
                "article-shared-intro-atomic-clauses:1",
                "article-shared-intro-atomic-clauses:2",
            ),
        )
        self.assertEqual(
            tuple(chunk.metadata["condition_subject"] for chunk in condition_chunks),
            ("rank_threshold", "rank_threshold"),
        )
        self.assertEqual(
            tuple(chunk.metadata["condition_group_id"] for chunk in condition_chunks),
            (
                "article-shared-intro-atomic-clauses:rank_threshold",
                "article-shared-intro-atomic-clauses:rank_threshold",
            ),
        )

    def test_shared_exclusion_intro_preserves_child_exclusion_clauses(self) -> None:
        record = _registry_record_for_document("handbook:test-shared-exclusion-clauses")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-shared-exclusion-clauses",
                    clean_text="\n".join(
                        [
                            "有下列情形之一的，不予解除处分:",
                            "（一）受到留校察看处分。",
                            "（二）受到开除学籍处分。",
                        ]
                    ),
                    anchor={
                        "section_path": ["第二章 处分限制"],
                        "article_label": "第十一条",
                        "page_start": 1,
                        "page_end": 1,
                    },
                    metadata={"title": "中央民族大学学生管理规定"},
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

        exclusion_chunks = [
            chunk for chunk in chunks if chunk.metadata["display_text"].startswith("（")
        ]
        self.assertEqual(len(exclusion_chunks), 2)
        self.assertEqual(
            tuple(chunk.metadata["answer_role"] for chunk in exclusion_chunks),
            ("exclusion_rule", "exclusion_rule"),
        )
        self.assertEqual(
            tuple(chunk.metadata["clause_unit_id"] for chunk in exclusion_chunks),
            (
                "article-shared-exclusion-clauses:1",
                "article-shared-exclusion-clauses:2",
            ),
        )
        self.assertEqual(
            tuple(chunk.metadata["condition_subject"] for chunk in exclusion_chunks),
            ("discipline_relief_exclusion", "discipline_relief_exclusion"),
        )

    def test_atomic_exclusion_children_inherit_discipline_relief_context_from_intro(self) -> None:
        record = _registry_record_for_document("handbook:test-shared-exclusion-context")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-shared-exclusion-context",
                    clean_text="\n".join(
                        [
                            "有下列情形之一的，不予解除处分:",
                            "（一）考察期未满。",
                            "（二）仍未完成后续教育。",
                        ]
                    ),
                    anchor={
                        "section_path": ["第三章 限制情形"],
                        "article_label": "第十二条",
                        "page_start": 1,
                        "page_end": 1,
                    },
                    metadata={"title": "中央民族大学学生管理规定"},
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

        exclusion_chunks = [
            chunk for chunk in chunks if chunk.metadata["display_text"].startswith("（")
        ]
        self.assertEqual(len(exclusion_chunks), 2)
        self.assertEqual(
            tuple(chunk.metadata["answer_role"] for chunk in exclusion_chunks),
            ("exclusion_rule", "exclusion_rule"),
        )
        self.assertEqual(
            tuple(chunk.metadata["condition_subject"] for chunk in exclusion_chunks),
            ("discipline_relief_exclusion", "discipline_relief_exclusion"),
        )

    def test_student_rules_table_chunks_get_answer_ready_fact_metadata(self) -> None:
        record = _registry_record_for_document("handbook:test-table")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="table_unit",
                    root_unit_id="table-scholarship-quota",
                    clean_text=(
                        "表格上下文: 专业奖学金等级和金额\n"
                        "奖学金等级 | 奖励金额 | 名额\n"
                        "一等奖 | 3000元 | 10人\n"
                        "二等奖 | 1500元 | 20人"
                    ),
                    anchor={
                        "page_start": 1,
                        "page_end": 1,
                        "table_context": "专业奖学金等级和金额",
                    },
                    metadata={
                        "title": "中央民族大学本科学生专业奖学金评定办法",
                        "caption_lines": ["专业奖学金等级和金额"],
                        "table_header_line": "奖学金等级 | 奖励金额 | 名额",
                        "table_row_lines": ["一等奖 | 3000元 | 10人", "二等奖 | 1500元 | 20人"],
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
        self.assertEqual(metadata["content_role"], "table_fact")
        self.assertEqual(metadata["semantic_role"], "table_fact")
        self.assertEqual(metadata["claim_type"], "amount_or_quota")
        self.assertEqual(metadata["table_fact_type"], "amount_or_quota")
        self.assertEqual(metadata["condition_polarity"], "positive")
        self.assertEqual(
            metadata["condition_group_id"],
            "table-scholarship-quota:amount_or_quota",
        )
        self.assertEqual(metadata["role_confidence"], "high")
        self.assertTrue(metadata["is_answer_bearing"])


if __name__ == "__main__":
    unittest.main()
