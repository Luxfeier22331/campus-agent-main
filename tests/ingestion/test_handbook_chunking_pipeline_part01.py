from __future__ import annotations

import unittest

from tests.ingestion.handbook_chunking_pipeline_support import (
    ChunkProfile,
    DocumentRegistryRecord,
    MockEmbeddingSettings,
    _institutional_registry_record,
    _registry_record,
    _registry_record_for_document,
    _structured_row,
    build_collection_semantic_metadata,
    build_hermetic_handbook_v3_chunk_profile,
    build_indexable_chunks_from_jsonl,
    build_mock_embedding_model,
    build_student_rules_category_overview_candidate,
    build_student_rules_category_overview_candidates,
    json,
    patch,
)


class HandbookChunkingPipelinePart01Test(unittest.TestCase):
    def test_build_indexable_chunks_rejects_mixed_document_units(self) -> None:
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_row(
                        unit_type="article_body",
                        clean_text="第一条 正文",
                        root_unit_id="article-001",
                    )
                ),
                json.dumps(
                    _structured_row(
                        doc_id="handbook:other-doc",
                        unit_type="article_body",
                        clean_text="第二条 正文",
                        root_unit_id="article-002",
                    )
                ),
            ]
        ).encode("utf-8")

        with self.assertRaises(ValueError):
            build_indexable_chunks_from_jsonl(
                record=_registry_record(),
                structured_jsonl_bytes=structured_payload,
            )

    def test_policy_page_chunk_keeps_token_guardrail_split_metadata(self) -> None:
        structured_payload = (
            json.dumps(
                _structured_row(
                    unit_type="policy_page",
                    clean_text=" ".join(f"token-{index:04d}" for index in range(480)),
                    root_unit_id="policy-page-001",
                )
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=_registry_record(),
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(),
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
        )

        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(chunk.metadata["unit_type"] == "policy_page" for chunk in chunks))
        self.assertTrue(
            all(chunk.metadata["split_reason"] == "token_guardrail" for chunk in chunks)
        )
        self.assertTrue(
            all(chunk.metadata["root_unit_id"] == "policy-page-001" for chunk in chunks)
        )

    def test_table_unit_becomes_primary_embeddable_evidence_unit(self) -> None:
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_row(
                        unit_type="table",
                        clean_text="单位名称\t电话号码\n校园110\t68932220",
                        root_unit_id="table-001",
                    )
                ),
                json.dumps(
                    _structured_row(
                        unit_type="table_unit",
                        clean_text="表格上下文: 校内常用电话\n单位名称 | 电话号码\n校园110 | 68932220",
                        root_unit_id="table-001",
                    )
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=_registry_record(),
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual([chunk.metadata["unit_type"] for chunk in chunks], ["table_unit"])
        self.assertEqual([chunk.metadata["root_unit_id"] for chunk in chunks], ["table-001"])

    def test_raw_handbook_table_is_not_embedded_without_table_unit(self) -> None:
        structured_payload = (
            json.dumps(
                _structured_row(
                    unit_type="table",
                    clean_text="<table><tr><td>姓名</td><td>照片</td></tr></table>",
                    root_unit_id="table-001",
                )
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=_registry_record(),
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(chunks, ())

    def test_oversize_article_body_keeps_root_segment_metadata(self) -> None:
        structured_payload = (
            json.dumps(
                _structured_row(
                    unit_type="article_body",
                    clean_text=" ".join(f"token-{index:04d}" for index in range(520)),
                    root_unit_id="article-001",
                )
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=_registry_record(),
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertGreater(len(chunks), 1)
        self.assertEqual(
            tuple(chunk.metadata["segment_index"] for chunk in chunks),
            tuple(range(1, len(chunks) + 1)),
        )
        self.assertTrue(all(chunk.metadata["segment_total"] == len(chunks) for chunk in chunks))
        self.assertTrue(
            all(chunk.metadata["split_reason"] == "token_guardrail" for chunk in chunks)
        )
        self.assertTrue(all(chunk.metadata["unit_type"] == "article_body" for chunk in chunks))
        self.assertTrue(all(chunk.metadata["root_unit_id"] == "article-001" for chunk in chunks))

    def test_student_rules_uses_regulation_aware_answer_ready_segments(self) -> None:
        record = _registry_record_for_document("handbook:test-national-scholarship")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-009",
                    clean_text="\n".join(
                        [
                            "参评本科学生国家奖学金还须具备以下条件之一:",
                            "（二）学习成绩排名或综合测评排名超出前10%,但均位于前30%,且单科成绩不低于80分,平均成绩不低于85分,必须在道德风尚、学术研究、学科竞赛、创新发明、社会实践、社会工作、体育竞赛、文艺比赛等某一方面表现特别优秀且可提供相应的证明材料。具体表现如下:",
                            "1. 在社会主义精神文明建设中表现突出。",
                            "2. 在学术研究上取得显著成绩,以第一作者发表高水平学术论文。",
                            "5. 在体育竞赛中取得显著成绩。",
                        ]
                    ),
                    anchor={
                        "section_path": ["第二章 评审条件"],
                        "article_label": "第九条",
                        "page_start": 1,
                        "page_end": 1,
                    },
                    metadata={"title": "示例大学本科学生国家奖学金评审办法"},
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

        rank_exception_chunks = [
            chunk
            for chunk in chunks
            if "学习成绩排名或综合测评排名超出前10%" in chunk.metadata["display_text"]
        ]
        self.assertEqual(len(rank_exception_chunks), 1)
        rank_exception = rank_exception_chunks[0]
        self.assertEqual(rank_exception.metadata["answer_role"], "exception_rule")
        self.assertEqual(rank_exception.metadata["condition_subject"], "rank_threshold")
        self.assertEqual(rank_exception.metadata["condition_polarity"], "positive")
        self.assertTrue(rank_exception.metadata["condition_group_id"].startswith("article-009:"))
        self.assertEqual(rank_exception.metadata["parent_unit_id"], "article-009")
        self.assertEqual(
            rank_exception.metadata["evidence_contract_version"],
            "answer_ready_evidence.v3",
        )
        self.assertEqual(rank_exception.metadata["content_role"], "eligibility")
        self.assertNotIn("在学术研究上", rank_exception.metadata["display_text"])
        self.assertNotIn("在体育竞赛中", rank_exception.metadata["display_text"])

        paper_chunks = [
            chunk
            for chunk in chunks
            if "在学术研究上取得显著成绩" in chunk.metadata["display_text"]
        ]
        self.assertEqual(len(paper_chunks), 1)
        paper_chunk = paper_chunks[0]
        self.assertEqual(paper_chunk.metadata["answer_role"], "example_evidence")
        self.assertEqual(paper_chunk.metadata["condition_subject"], "paper_or_publication")
        self.assertEqual(
            paper_chunk.metadata["condition_group_id"],
            rank_exception.metadata["condition_group_id"],
        )
        self.assertEqual(paper_chunk.metadata["parent_unit_id"], "article-009")
        self.assertEqual(paper_chunk.metadata["clause_unit_id"], "article-009:2")
        self.assertEqual(paper_chunk.metadata["provision_label"], "2.")
        self.assertNotIn("在体育竞赛中", paper_chunk.metadata["display_text"])

        intro_chunks = [
            chunk
            for chunk in chunks
            if chunk.metadata["display_text"] == "参评本科学生国家奖学金还须具备以下条件之一:"
        ]
        self.assertEqual(len(intro_chunks), 1)
        intro_chunk = intro_chunks[0]
        self.assertEqual(intro_chunk.metadata["answer_role"], "eligibility_intro")
        self.assertFalse(intro_chunk.metadata["is_answer_bearing"])
        self.assertEqual(intro_chunk.metadata["intro_scope"], "eligibility_group")
        self.assertEqual(intro_chunk.metadata["condition_subject"], "rank_threshold")
        self.assertEqual(
            intro_chunk.metadata["condition_subject_provenance"],
            "metadata:introduced_condition_subject",
        )
        self.assertEqual(
            intro_chunk.metadata["introduced_condition_group_id"],
            rank_exception.metadata["condition_group_id"],
        )
        self.assertEqual(
            intro_chunk.metadata["intro_target_roles"],
            ("exception_rule", "example_evidence"),
        )

    def test_same_parent_multiple_rank_groups_emit_distinct_condition_group_ids(self) -> None:
        record = _registry_record_for_document("handbook:test-multiple-rank-groups")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-020",
                    clean_text="\n".join(
                        [
                            "符合下列条件之一:",
                            "（一）学习成绩排名位于前10%。",
                            "（二）学习成绩排名超出前10%,但位于前30%,且在学术研究上取得显著成绩。",
                            "符合下列条件之一:",
                            "（三）学习成绩排名位于前10%,且在体育竞赛中取得显著成绩。",
                            "（四）学习成绩排名超出前10%,但位于前30%,且在文艺比赛中取得显著成绩。",
                        ]
                    ),
                    anchor={
                        "section_path": ["第二章 评审条件"],
                        "article_label": "第二十条",
                        "page_start": 1,
                        "page_end": 1,
                    },
                    metadata={"title": "示例大学本科学生综合奖励评审办法"},
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

        rank_group_chunks = [
            chunk for chunk in chunks if chunk.metadata.get("condition_subject") == "rank_threshold"
        ]
        self.assertGreaterEqual(len(rank_group_chunks), 4)
        self.assertEqual(
            tuple(
                chunk.metadata["clause_unit_id"]
                for chunk in rank_group_chunks
                if chunk.metadata.get("clause_unit_id")
            ),
            ("article-020:1", "article-020:2", "article-020:3", "article-020:4"),
        )
        self.assertEqual(
            len({chunk.metadata["condition_group_id"] for chunk in rank_group_chunks}),
            2,
        )

    def test_student_rules_category_members_get_registry_overview_chunks(self) -> None:
        document_id = "handbook:synthetic-scholarship-rule"
        record = _registry_record_for_document(document_id)
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-001",
                    clean_text="Article 1 Scholarship review runs once per academic year.",
                    metadata={"title": "Synthetic scholarship review rule"},
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

        overview_chunks = [
            chunk for chunk in chunks if chunk.metadata.get("answer_role") == "category_overview"
        ]
        self.assertEqual(len(overview_chunks), 1)
        overview = overview_chunks[0]
        self.assertEqual(overview.metadata["unit_type"], "category_overview")
        self.assertEqual(overview.metadata["content_role"], "policy_list")
        self.assertEqual(overview.metadata["category_id"], "scholarship")
        self.assertEqual(overview.metadata["answer_role"], "category_overview")
        self.assertEqual(overview.metadata["category_audience"], "students")
        self.assertEqual(
            overview.metadata["parent_unit_id"],
            f"{document_id}:category-overview:scholarship",
        )
        self.assertEqual(
            overview.metadata["evidence_contract_version"],
            "answer_ready_evidence.v3",
        )
        self.assertEqual(
            overview.metadata["condition_group_subject"],
            "audience_scope",
        )
        self.assertEqual(
            overview.metadata["condition_group_id"],
            f"{document_id}:category-overview:scholarship:audience_scope",
        )
        self.assertEqual(
            tuple(overview.metadata["category_member_document_ids"]),
            ("handbook:synthetic-scholarship-rule",),
        )
        self.assertIn("studentsScholarship相关制度", overview.metadata["display_text"])
        self.assertIn("Synthetic scholarship review rule", overview.metadata["display_text"])
        self.assertEqual(overview.metadata["answer_ready_contract_validation_status"], "passed")
        self.assertEqual(overview.metadata["answer_ready_contract_validation_issues"], ())

    def test_student_rules_category_overview_is_not_duplicated_for_every_member(self) -> None:
        document_id = "handbook:synthetic-student-card-rule"
        record = _registry_record_for_document(document_id)
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-001",
                    clean_text="Article 1 Student card replacement requires an application.",
                    metadata={"title": "Synthetic student card rule"},
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

        self.assertFalse(
            any(chunk.metadata.get("answer_role") == "category_overview" for chunk in chunks)
        )

    def test_student_rules_category_overview_uses_explicit_overview_document_id(self) -> None:
        primary_record = _registry_record_for_document("handbook:member-1")
        overview_record = _registry_record_for_document("handbook:member-2")
        config = {
            "policy_objects": [
                {"document_id": "handbook:member-1", "title": "成员制度一"},
                {"document_id": "handbook:member-2", "title": "成员制度二"},
            ],
            "policy_categories": [
                {
                    "category_id": "custom-category",
                    "display_name": "事项",
                    "aliases": ["事项"],
                    "audience": "本科生",
                    "member_policy_document_ids": ["handbook:member-1", "handbook:member-2"],
                    "overview_document_id": "handbook:member-2",
                }
            ],
        }

        with patch(
            "campus_regulation_semantics.regulation_semantic_registry._load_student_rules_query_planning_config",
            return_value=config,
        ):
            self.assertIsNone(
                build_student_rules_category_overview_candidate(
                    record=primary_record,
                    chunk_candidates=(),
                    chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
                )
            )
            overview = build_student_rules_category_overview_candidate(
                record=overview_record,
                chunk_candidates=(),
                chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
            )

        self.assertIsNotNone(overview)
        assert overview is not None
        self.assertEqual(overview.metadata["category_id"], "custom-category")
        self.assertIn("成员制度一", overview.piece.text)
        self.assertIn("成员制度二", overview.piece.text)

    def test_student_rules_document_can_emit_multiple_category_overviews(self) -> None:
        record = _registry_record_for_document("handbook:synthetic-student-status-rule")

        overviews = build_student_rules_category_overview_candidates(
            record=record,
            chunk_candidates=(),
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(
            tuple(candidate.metadata["category_id"] for candidate in overviews),
            ("student_status", "student_card_affairs"),
        )
        self.assertEqual(
            tuple(candidate.metadata["answer_role"] for candidate in overviews),
            ("category_overview", "category_overview"),
        )

    def test_institutional_rules_category_members_get_registry_overview_chunks(self) -> None:
        document_id = "official_web_regulation:synthetic-network-policy"
        record = _institutional_registry_record(document_id)
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="regulation_body",
                    root_unit_id=f"{document_id}:unit-0001",
                    clean_text="Article 1 This policy defines campus network service usage.",
                    anchor={
                        "section_path": ["第一章 总则"],
                        "provision_label": "第一条",
                    },
                    metadata={
                        "title": "Synthetic campus network policy",
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

        overview_chunks = [
            chunk for chunk in chunks if chunk.metadata.get("answer_role") == "category_overview"
        ]
        self.assertEqual(len(overview_chunks), 1)
        overview = overview_chunks[0]
        self.assertEqual(overview.metadata["unit_type"], "category_overview")
        self.assertEqual(overview.metadata["content_role"], "policy_list")
        self.assertEqual(overview.metadata["category_id"], "public_service")
        self.assertEqual(overview.metadata["category_audience"], "校园成员")
        self.assertEqual(
            overview.metadata["parent_unit_id"],
            f"{document_id}:category-overview:public_service",
        )
        self.assertEqual(
            overview.metadata["evidence_contract_version"],
            "answer_ready_evidence.v3",
        )
        self.assertEqual(
            overview.metadata["condition_group_subject"],
            "audience_scope",
        )
        self.assertEqual(
            overview.metadata["condition_group_id"],
            f"{document_id}:category-overview:public_service:audience_scope",
        )
        self.assertEqual(
            tuple(overview.metadata["category_member_document_ids"]),
            ("official_web_regulation:synthetic-network-policy",),
        )
        self.assertIn("校园成员Public Service Policies相关制度", overview.metadata["display_text"])
        self.assertIn("Synthetic campus network policy", overview.metadata["display_text"])
        self.assertEqual(overview.metadata["answer_ready_contract_validation_status"], "passed")
        self.assertEqual(overview.metadata["answer_ready_contract_validation_issues"], ())

    def test_regulation_semantics_are_not_limited_to_student_rules(self) -> None:
        record = DocumentRegistryRecord(
            document_id="regulation:test-institutional",
            revision_track="source-faithful",
            version_id="v1:institutional",
            source_uri="campus-agent://regulations/institutional_rules/docs/regulation:test-institutional",
            content_hash="sha256:institutional",
            corpus="regulations",
            collection="institutional_rules",
            cleaning_policy_version="institutional_rules_cleaning_v1",
            entitlement_groups=("students",),
            visibility_scope="main",
            status="active",
            ingestion_timestamp="2026-03-23T12:00:00+00:00",
            parser_version="paddleocr-vl-1.5",
            embedding_model="Qwen3-Embedding-4B",
            source_channel="official_web",
            import_source="official_web",
        )

        metadata = build_collection_semantic_metadata(
            record=record,
            unit_type="institutional_regulation_block",
            anchor={"section_path": ["第四章 办理程序"]},
            metadata={},
            text="1. 申请人提交申请材料。",
        )

        self.assertEqual(metadata["answer_role"], "procedure_step")
        self.assertEqual(metadata["content_role"], "procedure")
        self.assertEqual(metadata["semantic_role"], "procedure_step")
        self.assertEqual(metadata["claim_type"], "procedure")
        self.assertTrue(metadata["is_answer_bearing"])

    def test_institutional_rules_chunks_emit_reusable_answer_ready_contract(self) -> None:
        record = DocumentRegistryRecord(
            document_id="regulation:test-institutional-procedure",
            revision_track="source-faithful",
            version_id="v1:institutional-procedure",
            source_uri=(
                "campus-agent://regulations/institutional_rules/docs/"
                "regulation:test-institutional-procedure"
            ),
            content_hash="sha256:institutional-procedure",
            corpus="regulations",
            collection="institutional_rules",
            cleaning_policy_version="institutional_rules_cleaning_v1",
            entitlement_groups=("students",),
            visibility_scope="main",
            status="active",
            ingestion_timestamp="2026-03-23T12:00:00+00:00",
            parser_version="paddleocr-vl-1.5",
            embedding_model="Qwen3-Embedding-4B",
            source_channel="official_web",
            import_source="official_web",
        )
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="institutional_regulation_block",
                    root_unit_id="article-004",
                    clean_text="1. 申请人提交申请材料。",
                    anchor={"section_path": ["第四章 办理程序"]},
                    metadata={"title": "示例大学校级事项办理办法"},
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
        self.assertEqual(metadata["evidence_contract_version"], "answer_ready_evidence.v3")
        self.assertEqual(metadata["parent_unit_id"], "article-004")
        self.assertEqual(metadata["clause_unit_id"], "article-004:1")
        self.assertEqual(metadata["condition_subject"], "application_procedure")
        self.assertEqual(metadata["condition_subject_taxonomy_version"], "condition_subject.v1")
        self.assertEqual(
            metadata["condition_subject_provenance"],
            "answer_role:procedure_step",
        )
        self.assertEqual(metadata["condition_group_id"], "article-004:application_procedure")
        self.assertEqual(metadata["condition_polarity"], "positive")
        self.assertEqual(metadata["procedure_step_index"], 1)
        self.assertEqual(metadata["procedure_actor"], "applicant")
        self.assertEqual(metadata["procedure_action"], "submit_materials")
        self.assertEqual(metadata["procedure_action_provenance"], "keyword:提交+材料")


if __name__ == "__main__":
    unittest.main()
