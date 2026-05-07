from __future__ import annotations

import json
import unittest
from pathlib import Path
from unittest.mock import patch

from campus_ingestion_core.answer_ready_contract_quality import (
    evaluate_answer_ready_contract_metadata,
    is_answer_ready_contract_issue,
)
from campus_ingestion_core.chunking import ChunkProfile
from campus_ingestion_core.embed import MockEmbeddingSettings, build_mock_embedding_model
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.object_store import build_processed_artifact_key
from campus_ingestion_core.process import build_indexable_chunks_from_jsonl
from campus_ingestion_core.process_candidate_aggregation import (
    build_collection_semantic_metadata,
)
from campus_ingestion_core.process_candidate_postprocess import (
    build_student_rules_category_overview_candidate,
    build_student_rules_category_overview_candidates,
)
from campus_ingestion_core.regulation_answer_roles import decide_answer_role

from tests.ingestion._handbook_chunking_test_support import (
    build_hermetic_handbook_v3_chunk_profile,
)


def _registry_record() -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="handbook:test-doc",
        revision_track="source-faithful",
        version_id="v1:test-doc",
        source_uri="campus-agent://regulations/student_rules/docs/handbook:test-doc",
        content_hash="sha256:test-doc",
        corpus="regulations",
        collection="student_rules",
        cleaning_policy_version="student_rules_cleaning_v1",
        entitlement_groups=("students",),
        visibility_scope="main",
        status="active",
        ingestion_timestamp="2026-03-23T12:00:00+00:00",
        parser_version="paddleocr-vl-1.5",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="pdf_ocr",
        document_units_object_key=build_processed_artifact_key(
            corpus="regulations",
            collection="student_rules",
            document_id="handbook:test-doc",
            revision_track="source-faithful",
            version_id="v1:test-doc",
            title=None,
            year=None,
            filename="document-units.jsonl",
        ),
        processed_object_keys=(
            build_processed_artifact_key(
                corpus="regulations",
                collection="student_rules",
                document_id="handbook:test-doc",
                revision_track="source-faithful",
                version_id="v1:test-doc",
                title=None,
                year=None,
                filename="document-units.jsonl",
            ),
        ),
        import_source="raw_online_ocr",
    )


def _registry_record_for_document(document_id: str) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="source-faithful",
        version_id=f"v1:{document_id}",
        source_uri=f"campus-agent://regulations/student_rules/docs/{document_id}",
        content_hash=f"sha256:{document_id}",
        corpus="regulations",
        collection="student_rules",
        cleaning_policy_version="student_rules_cleaning_v1",
        entitlement_groups=("students",),
        visibility_scope="main",
        status="active",
        ingestion_timestamp="2026-03-23T12:00:00+00:00",
        parser_version="paddleocr-vl-1.5",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="pdf_ocr",
        import_source="raw_online_ocr",
    )


def _institutional_registry_record(document_id: str) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track="current-effective",
        version_id=f"owregver:{document_id}",
        source_uri=f"https://www.muc.edu.cn/{document_id}.htm",
        content_hash=f"sha256:{document_id}",
        corpus="regulations",
        collection="institutional_rules",
        cleaning_policy_version="institutional_rules_cleaning_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        status="active",
        ingestion_timestamp="2026-05-07T00:00:00+00:00",
        parser_version="official-web-regulation-source-truth-v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="official_web",
        import_source="official_web_regulation_source_truth_materialization",
    )


def _structured_row(
    *,
    doc_id: str = "handbook:test-doc",
    version_id: str = "v1:test-doc",
    unit_type: str,
    clean_text: str,
    root_unit_id: str,
    chunk_id: str | None = None,
    anchor: dict[str, object] | None = None,
    metadata: dict[str, object] | None = None,
) -> dict[str, object]:
    return {
        "doc_id": doc_id,
        "version_id": version_id,
        "chunk_id": chunk_id or root_unit_id,
        "unit_type": unit_type,
        "root_unit_id": root_unit_id,
        "clean_text": clean_text,
        "anchor": anchor or {"page_start": 1, "page_end": 1},
        "metadata": metadata or {},
        "acl": {"level": "public", "allow_groups": []},
    }


class HandbookChunkingPipelineTest(unittest.TestCase):
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

    def test_policy_page_fallback_keeps_token_guardrail_split_metadata(self) -> None:
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
        document_id = "handbook:55f7a1b27590bdc59c099f37d84cfa097356ce15"
        record = _registry_record_for_document(document_id)
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-001",
                    clean_text="第一条 国家奖学金每学年评审一次。",
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

        overview_chunks = [
            chunk for chunk in chunks if chunk.metadata.get("answer_role") == "category_overview"
        ]
        self.assertEqual(len(overview_chunks), 1)
        overview = overview_chunks[0]
        self.assertEqual(overview.metadata["unit_type"], "category_overview")
        self.assertEqual(overview.metadata["content_role"], "policy_list")
        self.assertEqual(overview.metadata["category_id"], "scholarship")
        self.assertEqual(overview.metadata["answer_role"], "category_overview")
        self.assertEqual(overview.metadata["category_audience"], "本科生")
        self.assertEqual(
            overview.metadata["parent_unit_id"],
            f"{document_id}:category-overview:scholarship",
        )
        self.assertEqual(
            overview.metadata["evidence_contract_version"],
            "answer_ready_evidence.v3",
        )
        self.assertGreaterEqual(len(overview.metadata["category_member_document_ids"]), 5)
        self.assertIn("本科生奖学金相关制度", overview.metadata["display_text"])
        self.assertIn("中央民族大学本科学生国家奖学金评审办法", overview.metadata["display_text"])
        self.assertIn(
            "中央民族大学本科学生国家励志奖学金评审办法",
            overview.metadata["display_text"],
        )
        self.assertIn("中央民族大学本科学生专业奖学金评定办法", overview.metadata["display_text"])
        self.assertIn("中央民族大学本科学生专项奖学金评定办法", overview.metadata["display_text"])
        self.assertIn("中央民族大学社会奖助学金管理办法", overview.metadata["display_text"])

    def test_student_rules_category_overview_is_not_duplicated_for_every_member(self) -> None:
        document_id = "handbook:1f17ba6234c15963648b3d74656d78621cad77a7"
        record = _registry_record_for_document(document_id)
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-001",
                    clean_text="第一条 国家励志奖学金每学年评审一次。",
                    metadata={"title": "中央民族大学本科学生国家励志奖学金评审办法"},
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
            "campus_shared.regulation_semantic_registry._load_student_rules_query_planning_config",
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
        record = _registry_record_for_document("handbook:e90f9707387f9e232ea88ce1c7f5328242e52389")

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
                    metadata={"title": "中央民族大学校级事项办理办法"},
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
                        "title": "中央民族大学本科学生国家奖学金评审办法",
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
                        "title": "中央民族大学信息公开实施细则",
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
                        "title": "中央民族大学信息公开实施细则",
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
                        "title": "中央民族大学信息公开实施细则",
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
                        "title": "中央民族大学学生申诉处理办法",
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
                        "title": "中央民族大学学生申诉处理办法",
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
                        "title": "中央民族大学学生申诉处理办法",
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
                    metadata={"title": "中央民族大学本科学生专业奖学金评定办法"},
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
                    metadata={"title": "中央民族大学本科创新教育实施办法"},
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
                    metadata={"title": "中央民族大学本科学生专业奖学金评定办法"},
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
        self.assertEqual(intro_chunks[0].metadata["answer_role"], "procedure_step")
        self.assertEqual(intro_chunks[0].metadata["content_role"], "procedure")

    def test_student_rules_as_below_procedure_text_is_not_treated_as_example_evidence(
        self,
    ) -> None:
        decision = decide_answer_role(
            text="(1)审核无误后,向全校进行公示。",
            prefix_text="按如下程序办理:",
        )

        self.assertEqual(decision["answer_role"], "procedure_step")
        self.assertEqual(decision["role_confidence"], "high")

    def test_student_rules_release_semantics_promotes_procedure_over_time_rule(
        self,
    ) -> None:
        metadata = build_collection_semantic_metadata(
            record=_registry_record_for_document("handbook:test-procedure-release"),
            unit_type="article_body",
            anchor={
                "section_path": ["第四章 专业方向调整"],
                "article_label": "第十五条",
            },
            metadata={"title": "中央民族大学本科生专业调整实施办法"},
            text=(
                "专业方向调整程序\n"
                "一、院系在学校开展转专业的时间内开展本单位内的专业方向调整工作,"
                "包括接受申请、审核、公示等。"
            ),
        )

        self.assertEqual(metadata["answer_role"], "procedure_step")
        self.assertEqual(metadata["content_role"], "procedure")
        self.assertEqual(metadata["semantic_role"], "procedure_step")
        self.assertEqual(metadata["claim_type"], "procedure")
        self.assertEqual(metadata["role_confidence"], "high")

    def test_student_rules_release_semantics_promotes_procedure_over_eligibility_example(
        self,
    ) -> None:
        metadata = build_collection_semantic_metadata(
            record=_registry_record_for_document("handbook:test-procedure-release-example"),
            unit_type="article_body",
            anchor={
                "section_path": ["第四章 推荐程序"],
                "article_label": "第十七条",
                "provision_label": "(1)",
            },
            metadata={"title": "中央民族大学推荐应届本科毕业生免试攻读硕士学位研究生管理办法"},
            text="(1)符合条件的申请人数不多于当年公布的名额数,审核无误后,向全校进行公示。",
        )

        self.assertEqual(metadata["answer_role"], "procedure_step")
        self.assertEqual(metadata["content_role"], "procedure")
        self.assertEqual(metadata["semantic_role"], "procedure_step")
        self.assertEqual(metadata["claim_type"], "procedure")
        self.assertEqual(metadata["role_confidence"], "high")

    def test_student_rules_release_semantics_marks_procedure_intro_as_procedure_step(
        self,
    ) -> None:
        metadata = build_collection_semantic_metadata(
            record=_registry_record_for_document("handbook:test-procedure-intro"),
            unit_type="article_body",
            anchor={
                "section_path": ["第四章 违规行为处理程序"],
                "article_label": "第十二条",
            },
            metadata={"title": "中央民族大学学生考试违规认定与处理办法"},
            text=(
                "学生在考试过程中实施违纪、作弊行为的,考试工作人员应及时予以纠正并如实记录,"
                "对学生用于作弊的材料、工具等,应予暂扣,并按如下程序办理:"
            ),
        )

        self.assertEqual(metadata["answer_role"], "procedure_step")
        self.assertEqual(metadata["content_role"], "procedure")
        self.assertEqual(metadata["semantic_role"], "procedure_step")
        self.assertEqual(metadata["claim_type"], "procedure")
        self.assertEqual(metadata["role_confidence"], "high")

    def test_student_rules_single_enumerated_procedure_step_keeps_procedure_role(self) -> None:
        record = _registry_record_for_document("handbook:test-single-enumerated-procedure")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-single-procedure",
                    clean_text="1. 学生本人提交解除处分申请材料。",
                    anchor={
                        "section_path": ["中央民族大学解除学生纪律处分实施办法", "解除程序"],
                        "article_label": "第三条",
                    },
                    metadata={"title": "中央民族大学解除学生纪律处分实施办法"},
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
        self.assertEqual(metadata["content_role"], "procedure")
        self.assertEqual(metadata["semantic_role"], "procedure_step")
        self.assertEqual(metadata["claim_type"], "procedure")
        self.assertEqual(metadata["condition_subject"], "application_procedure")
        self.assertEqual(metadata["clause_unit_id"], "article-single-procedure:1")
        self.assertEqual(metadata["procedure_action"], "submit_materials")
        self.assertEqual(metadata["procedure_actor"], "student")

    def test_student_rules_example_context_does_not_leak_into_following_procedure_list(
        self,
    ) -> None:
        record = _registry_record_for_document("handbook:test-example-then-procedure")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-example-then-procedure",
                    clean_text="\n".join(
                        [
                            "参评学生还须具备以下条件之一:",
                            "（1）在学术研究上取得显著成绩。",
                            "（2）在体育竞赛中取得显著成绩。",
                            "按如下程序办理:",
                            "1. 教务处汇总审核。",
                            "2. 公示期应不少于7天。",
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

        procedure_chunks = [
            chunk
            for chunk in chunks
            if "教务处汇总审核" in chunk.metadata["display_text"]
            or "公示期应不少于7天" in chunk.metadata["display_text"]
        ]
        self.assertEqual(len(procedure_chunks), 2)
        self.assertTrue(
            all(chunk.metadata["answer_role"] == "procedure_step" for chunk in procedure_chunks)
        )

    def test_student_rules_ordinary_but_clause_is_not_exception_rule(self) -> None:
        record = _registry_record_for_document("handbook:test-ordinary-but")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-condition",
                    clean_text="\n".join(
                        [
                            "申请专项奖学金应符合以下条件:",
                            "1. 品行端正,但仍需按学院要求提交证明材料。",
                            "2. 学习态度认真。",
                        ]
                    ),
                    metadata={"title": "中央民族大学本科学生专项奖学金评定办法"},
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
            chunk for chunk in chunks if "品行端正" in chunk.metadata["display_text"]
        ]
        self.assertEqual(len(condition_chunks), 1)
        self.assertEqual(condition_chunks[0].metadata["answer_role"], "eligibility_condition")
        self.assertEqual(condition_chunks[0].metadata["role_confidence"], "high")
        self.assertIn("eligibility_condition", condition_chunks[0].metadata["role_reason"])

    def test_student_rules_supporting_detail_has_low_confidence_reason(self) -> None:
        record = _registry_record_for_document("handbook:test-supporting-detail")
        structured_payload = (
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id="article-supporting-detail",
                    clean_text="\n".join(
                        [
                            "申请奖学金应符合以下条件:",
                            "1. 本办法自公布之日起施行。",
                            "2. 申请人应当品行端正。",
                        ]
                    ),
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

        detail_chunks = [
            chunk for chunk in chunks if "自公布之日起施行" in chunk.metadata["display_text"]
        ]
        self.assertEqual(len(detail_chunks), 1)
        self.assertEqual(detail_chunks[0].metadata["answer_role"], "supporting_detail")
        self.assertEqual(detail_chunks[0].metadata["role_confidence"], "low")
        self.assertEqual(detail_chunks[0].metadata["is_answer_bearing"], False)
        self.assertIn("no_answer_ready_marker", detail_chunks[0].metadata["role_reason"])

    def test_student_rules_aggregated_answer_bearing_chunk_gets_role_confidence(
        self,
    ) -> None:
        record = _registry_record_for_document("handbook:test-aggregated-answer-role")
        structured_payload = "\n".join(
            json.dumps(
                _structured_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    unit_type="article_body",
                    root_unit_id=f"article-00{index}",
                    clean_text=text,
                    anchor={
                        "section_path": ["第一章 总则"],
                        "article_label": f"第{index}条",
                        "page_start": 1,
                        "page_end": 1,
                    },
                    metadata={"title": "中央民族大学本科创新教育实施办法"},
                ),
                ensure_ascii=False,
            )
            for index, text in enumerate(
                (
                    "第一条 创新教育以加强学生的实践能力为先导，以拓展学生的发现能力为重点。",
                    "第二条 创新教育应贯穿于我校人才培养的每个教学环节。",
                    "第三条 课程建设是全面开展创新教育的基础。",
                    "第四条 学校鼓励学生积极参与科学研究活动和学科竞赛活动。",
                ),
                start=1,
            )
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertEqual(len(chunks), 1)
        metadata = chunks[0].metadata
        self.assertEqual(metadata["answer_role"], "supporting_detail")
        self.assertEqual(metadata["role_confidence"], "low")
        self.assertTrue(metadata["role_reason"])

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
        self.assertEqual(metadata["role_confidence"], "high")
        self.assertTrue(metadata["is_answer_bearing"])

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
