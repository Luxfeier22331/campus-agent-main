from __future__ import annotations

import unittest
from dataclasses import replace

from .processing_pipeline_test_support import *


class ProcessingPipelinePolicyChunkingStructureTest(unittest.TestCase):
    def test_build_indexable_chunks_splits_regulation_body_against_contextualized_budget(
        self,
    ) -> None:
        base_record = _make_registry_record()
        record = replace(
            base_record,
            document_id="official_web_regulation:context-budget",
            revision_track="current-effective",
            version_id="owregver:context-budget",
            source_uri="https://info.example.edu/info/1198/6451.htm",
            content_hash="sha256:context-budget",
            corpus="regulations",
            collection="institutional_rules",
            entitlement_groups=(),
            visibility_scope=None,
            visibility_level="public",
            cleaning_policy_version="institutional_rules_cleaning_v1",
            source_channel="official_web",
            is_current=True,
            import_source="official_web_regulation_source_truth_materialization",
        )
        metadata = {
            "title": "示例大学事业发展“十三五”规划",
            "title_base": "示例大学事业发展“十三五”规划",
            "promotion_class": "formal_regulation",
            "content_role": "regulation_body",
            "source_channel": "official_web",
            "page_family": "article_detail",
        }
        body_text = "\n".join(
            [
                "1、" + "事业发展目标。" * 8,
                "2、" + "事业发展任务。" * 8,
            ]
        )
        structured_payload = (
            json.dumps(
                _structured_unit_row(
                    doc_id=record.document_id,
                    version_id=record.version_id,
                    chunk_id="official-web-regulation-body-001",
                    unit_type="regulation_body",
                    root_unit_id="official-web-regulation-body-001",
                    clean_text=body_text,
                    anchor={"section_path": ["第一章 发展基础"]},
                    metadata=metadata,
                ),
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=50,
                max_chunk_size=70,
                chunk_overlap=0,
                min_chunk_size=8,
                final_text_aware=True,
                safety_margin=0,
            ),
        )

        self.assertGreater(len(chunks), 1)
        self.assertTrue(all(int(chunk.metadata["final_token_count"]) <= 70 for chunk in chunks))
        self.assertTrue(all(chunk.metadata["contextualized_text"] for chunk in chunks))

    def test_build_indexable_chunks_merges_first_article_even_when_only_first_has_preface_text(
        self,
    ) -> None:
        record = _make_registry_record()
        base_metadata = {
            "title": "示例大学学生资助管理工作暂行办法",
            "policy_doc_no": "民大校发〔2012〕357号",
        }
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-001",
                        unit_type="article_body",
                        root_unit_id="article-001",
                        clean_text="坚持公平、公开、公正原则,合理分配资助资源。",
                        anchor={
                            "section_path": ["第一章 总则"],
                            "article_label": "第一条",
                            "page_start": 1,
                            "page_end": 1,
                        },
                        metadata={
                            **base_metadata,
                            "preface_text": "为规范学校学生资助工作,制定本办法。",
                        },
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-002",
                        unit_type="article_body",
                        root_unit_id="article-002",
                        clean_text="坚持资助与解困、助学与育人相结合的原则。",
                        anchor={
                            "section_path": ["第一章 总则"],
                            "article_label": "第二条",
                            "page_start": 1,
                            "page_end": 1,
                        },
                        metadata=base_metadata,
                    ),
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=128,
                max_chunk_size=192,
                chunk_overlap=16,
                min_chunk_size=32,
                final_text_aware=True,
                safety_margin=16,
            ),
        )

        self.assertEqual(len(chunks), 1)
        chunk = chunks[0]
        self.assertEqual(chunk.anchor["article_label"], "第一条-第二条")
        self.assertEqual(chunk.metadata["aggregation_mode"], "adjacent_short_textual_units")
        self.assertNotIn("preface_text", chunk.metadata)
        self.assertIn("第一条 坚持公平、公开、公正原则", chunk.metadata["display_text"])
        self.assertIn(
            "第二条 坚持资助与解困、助学与育人相结合的原则。", chunk.metadata["display_text"]
        )

    def test_build_indexable_chunks_merges_short_policy_page_siblings_under_shared_parent(
        self,
    ) -> None:
        record = _make_registry_record()
        metadata = {
            "title": "示例大学学生志愿服务管理办法",
            "policy_doc_no": "民大团发〔2010〕14号",
        }
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-010",
                        unit_type="policy_page",
                        root_unit_id="policy-010",
                        clean_text="志愿服务认证是针对注册志愿服务组织、志愿者组织和参加的各项志愿服务活动而定期开展的志愿服务评定工作。",
                        anchor={
                            "section_path": ["第二章 分则", "第二部分 认证"],
                            "page_start": 3,
                            "page_end": 3,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-011",
                        unit_type="policy_page",
                        root_unit_id="policy-011",
                        clean_text="(一)每学年第一学期,针对全体注册志愿者开展志愿服务认证。",
                        anchor={
                            "section_path": ["第二章 分则", "第二部分 认证", "一、认证时间"],
                            "page_start": 3,
                            "page_end": 3,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-012",
                        unit_type="policy_page",
                        root_unit_id="policy-012",
                        clean_text="共青团示例大学委员会(青年志愿者工作部)。",
                        anchor={
                            "section_path": ["第二章 分则", "第二部分 认证", "三、认证程序"],
                            "page_start": 3,
                            "page_end": 3,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=128,
                max_chunk_size=192,
                chunk_overlap=16,
                min_chunk_size=32,
                final_text_aware=True,
                safety_margin=16,
            ),
        )

        self.assertEqual(len(chunks), 1)
        chunk = chunks[0]
        self.assertEqual(chunk.metadata["aggregation_mode"], "adjacent_short_textual_units")
        self.assertEqual(chunk.metadata["member_unit_count"], 3)
        self.assertEqual(chunk.anchor["section_path"], ["第二章 分则", "第二部分 认证"])
        self.assertIn("第二部分 认证", chunk.text)
        self.assertIn(
            "(一)每学年第一学期,针对全体注册志愿者开展志愿服务认证。",
            chunk.metadata["display_text"],
        )
        self.assertIn("共青团示例大学委员会(青年志愿者工作部)。", chunk.metadata["display_text"])
        self.assertNotIn("一、认证时间 (一)每学年第一学期", chunk.metadata["display_text"])
        self.assertNotIn("三、认证程序 共青团示例大学委员会", chunk.metadata["display_text"])

    def test_build_indexable_chunks_does_not_repeat_policy_section_heading_inside_display_text(
        self,
    ) -> None:
        record = _make_registry_record()
        metadata = {
            "title": "示例大学学生课堂行为规范及课堂秩序管理办法",
            "policy_doc_no": "民大校发[2007]282号",
        }
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-020",
                        unit_type="policy_page",
                        root_unit_id="policy-020",
                        clean_text="12、学生课堂行为规范和秩序的管理依照“全员参与、分级管理”的原则进行。",
                        anchor={
                            "section_path": ["三、学生课堂秩序管理"],
                            "page_start": 3,
                            "page_end": 3,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-021",
                        unit_type="policy_page",
                        root_unit_id="policy-021",
                        clean_text="四、本办法由学生工作部(处)负责解释。",
                        anchor={
                            "section_path": ["三、学生课堂秩序管理"],
                            "provision_label": "四",
                            "page_start": 3,
                            "page_end": 3,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=128,
                max_chunk_size=512,
                chunk_overlap=16,
                min_chunk_size=32,
                final_text_aware=True,
                safety_margin=16,
            ),
        )

        self.assertEqual(len(chunks), 1)
        chunk = chunks[0]
        self.assertEqual(chunk.metadata["aggregation_mode"], "adjacent_short_textual_units")
        self.assertIn("12、学生课堂行为规范和秩序的管理依照", chunk.metadata["display_text"])
        self.assertNotIn("三、学生课堂秩序管理 12、", chunk.metadata["display_text"])
        self.assertIn("\n\n四、本办法由学生工作部(处)负责解释。", chunk.metadata["display_text"])
        self.assertNotIn("三、学生课堂秩序管理 12、", chunk.text)

    def test_build_indexable_chunks_does_not_merge_policy_procedure_block_with_closing_provisions(
        self,
    ) -> None:
        record = _make_registry_record()
        metadata = {
            "title": "示例大学全日制本科学生学士学位授予规定",
            "policy_doc_no": "民大校发[2009]90号",
        }
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-030",
                        unit_type="policy_page",
                        root_unit_id="policy-030",
                        clean_text="\n".join(
                            [
                                "1. 学生本人提出申请,填报学士学位申请表。",
                                "2. 院(系)学位委员会对提出申请授予学士学位的学生进行审核,提出建议授予学士学位名单和不授予学士学位名单。",
                                "3. 教务处审核全部学生材料并负责向校学位委员会提出召开学士学位评定委员会会议。",
                                "4. 校学位委员会审查通过获得学士学位的学生名单。",
                            ]
                        ),
                        anchor={
                            "section_path": ["三、学士学位授予程序"],
                            "page_start": 3,
                            "page_end": 3,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-031",
                        unit_type="policy_page",
                        root_unit_id="policy-031",
                        clean_text="四、学士学位证书遗失不予补发。如遗失或者损坏,经本人申请,学校核实后出具相应的证明书。证明书与原证书具有同等效力。",
                        anchor={
                            "provision_label": "四",
                            "page_start": 3,
                            "page_end": 3,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-032",
                        unit_type="policy_page",
                        root_unit_id="policy-032",
                        clean_text="五、本规定自2009年3月17日起实施。",
                        anchor={
                            "provision_label": "五",
                            "page_start": 3,
                            "page_end": 3,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-033",
                        unit_type="policy_page",
                        root_unit_id="policy-033",
                        clean_text="六、本规定由教务处负责解释。",
                        anchor={
                            "provision_label": "六",
                            "page_start": 3,
                            "page_end": 3,
                        },
                        metadata=metadata,
                    ),
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=128,
                max_chunk_size=512,
                chunk_overlap=16,
                min_chunk_size=32,
                final_text_aware=True,
                safety_margin=16,
            ),
        )

        procedure_chunks = [
            chunk for chunk in chunks if chunk.metadata.get("answer_role") == "procedure_step"
        ]
        exclusion_chunks = [
            chunk
            for chunk in chunks
            if chunk.metadata["display_text"].startswith("四、学士学位证书遗失不予补发")
        ]
        closing_chunks = [
            chunk
            for chunk in chunks
            if chunk.metadata.get("aggregation_mode") == "adjacent_short_textual_units"
            and "五、本规定自2009年3月17日起实施。" in chunk.metadata["display_text"]
        ]
        self.assertEqual(len(procedure_chunks), 4)
        self.assertEqual(len(exclusion_chunks), 1)
        self.assertEqual(len(closing_chunks), 1)
        self.assertFalse(
            any(
                "四、学士学位证书遗失不予补发" in chunk.metadata["display_text"]
                for chunk in procedure_chunks
            )
        )
        self.assertEqual(exclusion_chunks[0].anchor["provision_label"], "四")
        self.assertEqual(exclusion_chunks[0].metadata["provision_label"], "四")
        self.assertEqual(exclusion_chunks[0].metadata["answer_role"], "exclusion_rule")
        self.assertEqual(closing_chunks[0].anchor["provision_label"], "五-六")
        self.assertEqual(closing_chunks[0].metadata["provision_label"], "五-六")
        self.assertEqual(
            closing_chunks[0].metadata["aggregation_mode"],
            "adjacent_short_textual_units",
        )
        self.assertIn("六、本规定由教务处负责解释。", closing_chunks[0].metadata["display_text"])
        self.assertNotIn("三、学士学位授予程序", closing_chunks[0].text)

    def test_build_indexable_chunks_marks_time_rule_policy_page_as_answer_bearing(self) -> None:
        record = _make_registry_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-time-rule",
                        unit_type="policy_page",
                        root_unit_id="policy-time-rule",
                        clean_text="冬季作息时间为周日至周四23:00熄灯，周五至周六23:30熄灯。",
                        anchor={
                            "section_path": ["一、时间安排"],
                            "page_start": 12,
                            "page_end": 12,
                        },
                        metadata={"title": "示例大学学生宿舍管理规定"},
                    ),
                    ensure_ascii=False,
                )
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=128, max_chunk_size=256, chunk_overlap=16, min_chunk_size=32
            ),
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
        )

        self.assertEqual(len(chunks), 1)
        chunk = chunks[0]
        self.assertEqual(chunk.metadata["detail_label"], "一、时间安排")
        self.assertEqual(chunk.metadata["content_role"], "time_rule")
        self.assertTrue(chunk.metadata["is_answer_bearing"])

    def test_build_indexable_chunks_marks_scope_rule_policy_page_as_non_answer_bearing(
        self,
    ) -> None:
        record = _make_registry_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    _structured_unit_row(
                        doc_id=record.document_id,
                        version_id=record.version_id,
                        chunk_id="legacy-scope-rule",
                        unit_type="policy_page",
                        root_unit_id="policy-scope-rule",
                        clean_text="本规定适用于全日制本科生在校期间的住宿管理。",
                        anchor={
                            "provision_label": "三",
                            "page_start": 12,
                            "page_end": 12,
                        },
                        metadata={"title": "示例大学学生宿舍管理规定"},
                    ),
                    ensure_ascii=False,
                )
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=128, max_chunk_size=256, chunk_overlap=16, min_chunk_size=32
            ),
            embedding_model=build_mock_embedding_model(MockEmbeddingSettings(embed_dim=8)),
        )

        self.assertEqual(len(chunks), 1)
        chunk = chunks[0]
        self.assertEqual(chunk.metadata["detail_label"], "三")
        self.assertEqual(chunk.metadata["content_role"], "scope_rule")
        self.assertFalse(chunk.metadata["is_answer_bearing"])
