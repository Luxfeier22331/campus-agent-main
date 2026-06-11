from __future__ import annotations

import unittest

from campus_ingestion_core.raw_ingestion_split_manifest_curriculum import (
    CURRICULUM_SPLIT_MANIFEST_ROW_POLICY,
)

from .curriculum_chunking_test_support import *


class CurriculumChunkingSectionAndTableUnitsTest(unittest.TestCase):
    def test_build_indexable_chunks_from_jsonl_uses_curriculum_section_and_table_units(
        self,
    ) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0001",
                        "row_id": "page-0020-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "一、培养目标",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0002",
                        "row_id": "page-0020-block-0002",
                        "row_type": "paragraph",
                        "clean_text": "培养具有国际视野、系统分析能力和跨学科协同能力的复合型人才。",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0003",
                        "row_id": "page-0020-block-0003",
                        "row_type": "paragraph",
                        "clean_text": "学生应掌握宏观经济分析、政策研判和数据建模方法。",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0004",
                        "row_id": "page-0020-block-0004",
                        "row_type": "table_caption",
                        "clean_text": "表 1 核心课程设置",
                        "page_start": 20,
                        "page_end": 20,
                        "owner_row_id": "page-0020-block-0005",
                        "relation_type": "caption_of",
                        "continuation_group_id": "page-0020-block-0005",
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0005",
                        "row_id": "page-0020-block-0005",
                        "row_type": "table",
                        "clean_text": "<table><tr><td>课程</td><td>学分</td></tr></table>",
                        "html": "<table><tr><td>课程</td><td>学分</td></tr></table>",
                        "table_cells": [
                            {
                                "row": 1,
                                "col": 1,
                                "text": "课程",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 1,
                                "col": 2,
                                "text": "学分",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 2,
                                "col": 1,
                                "text": "宏观经济学原理",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 2,
                                "col": 2,
                                "text": "3",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 3,
                                "col": 1,
                                "text": "国际贸易理论",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 3,
                                "col": 2,
                                "text": "3",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 4,
                                "col": 1,
                                "text": "计量经济学方法",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 4,
                                "col": 2,
                                "text": "4",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 5,
                                "col": 1,
                                "text": "政策评估工作坊",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 5,
                                "col": 2,
                                "text": "2",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 6,
                                "col": 1,
                                "text": "跨文化商务沟通",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 6,
                                "col": 2,
                                "text": "2",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                        ],
                        "page_start": 20,
                        "page_end": 20,
                        "continuation_group_id": "page-0020-block-0005",
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0021-block-0001",
                        "row_id": "page-0021-block-0001",
                        "row_type": "note",
                        "clean_text": "备注：实践类课程不少于 8 学分。",
                        "page_start": 21,
                        "page_end": 21,
                        "owner_row_id": "page-0020-block-0005",
                        "relation_type": "note_of",
                        "continuation_group_id": "page-0020-block-0005",
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=24,
                max_chunk_size=30,
                chunk_overlap=4,
                min_chunk_size=8,
                chunk_policy_version="curriculum_plan_semantic_v1",
                cleaning_policy_version="curriculum_plan_cleaning_v1",
            ),
        )

        self.assertGreaterEqual(len(chunks), 3)
        self.assertEqual(chunks[0].metadata["unit_type"], "section_text")
        self.assertEqual(chunks[0].metadata["root_unit_id"], "page-0020-block-0001")
        self.assertEqual(chunks[0].anchor["page_start"], 20)
        self.assertEqual(chunks[0].anchor["page_end"], 20)
        self.assertEqual(chunks[0].anchor["section_path"], ["一、培养目标"])

        table_chunks = [chunk for chunk in chunks if chunk.metadata["unit_type"] == "table_unit"]
        self.assertGreaterEqual(len(table_chunks), 2)
        self.assertTrue(
            all(chunk.metadata["root_unit_id"] == "page-0020-block-0005" for chunk in table_chunks)
        )
        self.assertTrue(
            all(chunk.metadata["split_reason"] == "table_row_window" for chunk in table_chunks)
        )
        self.assertTrue(all(chunk.anchor["page_start"] == 20 for chunk in table_chunks))
        self.assertTrue(all(chunk.anchor["page_end"] == 21 for chunk in table_chunks))
        self.assertTrue(all("表 1 核心课程设置" in chunk.text for chunk in table_chunks))
        self.assertTrue(all("课程 | 学分" in chunk.text for chunk in table_chunks))
        self.assertTrue(
            any("备注：实践类课程不少于 8 学分。" in chunk.text for chunk in table_chunks)
        )

    def test_build_indexable_chunks_from_jsonl_requires_row_id_for_curriculum_document_units(
        self,
    ) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "一、培养目标",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                )
            ]
        ).encode("utf-8")

        with self.assertRaisesRegex(ValueError, "missing row_id"):
            build_indexable_chunks_from_jsonl(
                record=record,
                structured_jsonl_bytes=structured_payload,
                chunk_profile=ChunkProfile(
                    chunk_size=24,
                    max_chunk_size=30,
                    chunk_overlap=4,
                    min_chunk_size=8,
                    chunk_policy_version="curriculum_plan_semantic_v1",
                    cleaning_policy_version="curriculum_plan_cleaning_v1",
                ),
            )

    def test_build_indexable_chunks_from_jsonl_rejects_heading_without_heading_level(self) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0020-block-0001",
                        "row_id": "page-0020-block-0001",
                        "row_type": "heading",
                        "clean_text": "一、培养目标",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                )
            ]
        ).encode("utf-8")

        with self.assertRaisesRegex(ValueError, "heading_level"):
            build_indexable_chunks_from_jsonl(
                record=record,
                structured_jsonl_bytes=structured_payload,
                chunk_profile=ChunkProfile(
                    chunk_size=24,
                    max_chunk_size=30,
                    chunk_overlap=4,
                    min_chunk_size=8,
                    chunk_policy_version="curriculum_plan_semantic_v1",
                    cleaning_policy_version="curriculum_plan_cleaning_v1",
                ),
            )

    def test_build_indexable_chunks_from_jsonl_keeps_non_table_notes_in_section_text(self) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0337-block-0001",
                        "row_id": "page-0337-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "四、各学期课程修读说明",
                        "page_start": 337,
                        "page_end": 337,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0337-block-0002",
                        "row_id": "page-0337-block-0002",
                        "row_type": "paragraph",
                        "clean_text": "第一学年以通识课和学科基础课为主。",
                        "page_start": 337,
                        "page_end": 337,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0337-block-0003",
                        "row_id": "page-0337-block-0003",
                        "row_type": "note",
                        "clean_text": "通识课和学科基础课为主",
                        "page_start": 337,
                        "page_end": 337,
                        "owner_row_id": "page-0337-block-0002",
                        "relation_type": "note_of",
                        "continuation_group_id": "page-0337-block-0002",
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=360,
                max_chunk_size=540,
                chunk_overlap=72,
                min_chunk_size=50,
                chunk_policy_version="curriculum_plan_semantic_v1",
                cleaning_policy_version="curriculum_plan_cleaning_v1",
            ),
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].metadata["unit_type"], "section_text")
        self.assertIn("第一学年以通识课和学科基础课为主。", chunks[0].text)
        self.assertIn("通识课和学科基础课为主", chunks[0].text)

    def test_build_indexable_chunks_from_jsonl_merges_curriculum_subsection_marker_into_following_table_chunk(
        self,
    ) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0300-block-0001",
                        "row_id": "page-0300-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "二、课程设计",
                        "page_start": 300,
                        "page_end": 300,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0300-block-0002",
                        "row_id": "page-0300-block-0002",
                        "row_type": "heading",
                        "heading_level": 3,
                        "clean_text": "(三) 学时学分设置",
                        "page_start": 300,
                        "page_end": 300,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0300-block-0003",
                        "row_id": "page-0300-block-0003",
                        "row_type": "table",
                        "clean_text": "<table><tr><td>课程名称</td><td>学分</td></tr><tr><td>马克思主义基本原理</td><td>3</td></tr></table>",
                        "html": "<table><tr><td>课程名称</td><td>学分</td></tr><tr><td>马克思主义基本原理</td><td>3</td></tr></table>",
                        "table_cells": [
                            {
                                "row": 1,
                                "col": 1,
                                "text": "课程名称",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 1,
                                "col": 2,
                                "text": "学分",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 2,
                                "col": 1,
                                "text": "马克思主义基本原理",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 2,
                                "col": 2,
                                "text": "3",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                        ],
                        "page_start": 300,
                        "page_end": 300,
                        "continuation_group_id": "page-0300-block-0003",
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=360,
                max_chunk_size=540,
                chunk_overlap=72,
                min_chunk_size=50,
                chunk_policy_version="curriculum_plan_semantic_v1",
                cleaning_policy_version="curriculum_plan_cleaning_v1",
            ),
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].metadata["unit_type"], "table_unit")
        self.assertTrue(chunks[0].text.startswith("二、课程设计\n\n(三) 学时学分设置"))
        self.assertEqual(chunks[0].text.count("(三) 学时学分设置"), 1)
        self.assertIn("课程名称 | 学分", chunks[0].text)

    def test_build_indexable_chunks_from_jsonl_merges_curriculum_subsection_marker_with_following_same_parent_items(
        self,
    ) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0301-block-0001",
                        "row_id": "page-0301-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "二、毕业要求",
                        "page_start": 301,
                        "page_end": 301,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0301-block-0002",
                        "row_id": "page-0301-block-0002",
                        "row_type": "heading",
                        "heading_level": 3,
                        "clean_text": "(二)知识要求",
                        "page_start": 301,
                        "page_end": 301,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0301-block-0003",
                        "row_id": "page-0301-block-0003",
                        "row_type": "heading",
                        "heading_level": 3,
                        "clean_text": "1. 跨学科基础和理论。",
                        "page_start": 301,
                        "page_end": 301,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0301-block-0004",
                        "row_id": "page-0301-block-0004",
                        "row_type": "heading",
                        "heading_level": 3,
                        "clean_text": "2. 核心知识。",
                        "page_start": 301,
                        "page_end": 301,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=360,
                max_chunk_size=540,
                chunk_overlap=72,
                min_chunk_size=50,
                chunk_policy_version="curriculum_plan_semantic_v1",
                cleaning_policy_version="curriculum_plan_cleaning_v1",
            ),
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].metadata["unit_type"], "section_text")
        self.assertTrue(chunks[0].text.startswith("二、毕业要求\n\n(二)知识要求"))
        self.assertEqual(chunks[0].text.count("二、毕业要求"), 1)
        self.assertIn("1. 跨学科基础和理论。", chunks[0].text)
        self.assertIn("2. 核心知识。", chunks[0].text)

    def test_build_indexable_chunks_from_jsonl_merges_short_curriculum_items_under_same_parent(
        self,
    ) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0302-block-0001",
                        "row_id": "page-0302-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "七、其他说明",
                        "page_start": 302,
                        "page_end": 302,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0302-block-0002",
                        "row_id": "page-0302-block-0002",
                        "row_type": "heading",
                        "heading_level": 3,
                        "clean_text": "6. 讲座报告。第 1-6 学期每学期至少参加 2 次本专业组织的讲座。",
                        "page_start": 302,
                        "page_end": 302,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0302-block-0003",
                        "row_id": "page-0302-block-0003",
                        "row_type": "heading",
                        "heading_level": 3,
                        "clean_text": "7. 学年论文以及毕业论文由专业分流后的导师具体负责指导。",
                        "page_start": 302,
                        "page_end": 302,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=360,
                max_chunk_size=540,
                chunk_overlap=72,
                min_chunk_size=50,
                chunk_policy_version="curriculum_plan_semantic_v1",
                cleaning_policy_version="curriculum_plan_cleaning_v1",
            ),
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].metadata["unit_type"], "section_text")
        self.assertEqual(chunks[0].text.count("七、其他说明"), 1)
        self.assertIn(
            "6. 讲座报告。第 1-6 学期每学期至少参加 2 次本专业组织的讲座。", chunks[0].text
        )
        self.assertIn("7. 学年论文以及毕业论文由专业分流后的导师具体负责指导。", chunks[0].text)

    def test_build_indexable_chunks_from_jsonl_canonicalizes_root_title_anchor(self) -> None:
        raw_version_id = "sha256:test-curriculum-root-title"
        document_input = _build_split_manifest_document_input(
            raw_asset_record=type(
                "RawAssetRecordProxy",
                (),
                {
                    "raw_asset_id": "asset:curriculum-plan-2022",
                    "raw_version_id": raw_version_id,
                    "corpus": "curriculum",
                    "collection": "curriculum_plan",
                    "raw_source_uri": "file:///tmp/curriculum-plan-2022.pdf",
                    "content_hash": raw_version_id.removeprefix("sha256:"),
                    "source_filename": "curriculum-plan-2022.pdf",
                    "object_key": "official_pdf/curriculum-plan/2022/sha256/test/capture/curriculum-plan-2022.pdf",
                    "ingestion_timestamp": "2026-03-28T10:00:00+00:00",
                    "import_source": "raw_online_ocr",
                },
            )(),
            manifest_version="curriculum_plan_split_manifest_v1",
            manifest_document=SplitManifestDocument(
                document_id="curriculum:民族学本科第二学士学位人才培养方案",
                title="民族学本科第二学士学位人才培养方案",
                page_start=100,
                page_end=101,
                status="active",
            ),
            structured_rows=[
                {
                    "row_id": "page-0100-block-0001",
                    "row_type": "heading",
                    "block_role": "doc_title",
                    "heading_level": 1,
                    "text_normalized": "民族学本科第二学士学位人才培养方案(2020 版)",
                    "page_start": 100,
                    "page_end": 100,
                },
                {
                    "row_id": "page-0100-block-0002",
                    "row_type": "heading",
                    "heading_level": 2,
                    "text_normalized": "一、培养目标",
                    "page_start": 100,
                    "page_end": 100,
                },
                {
                    "row_id": "page-0100-block-0003",
                    "row_type": "paragraph",
                    "text_normalized": "培养具备民族学基础理论与方法的复合型人才。",
                    "page_start": 100,
                    "page_end": 100,
                },
            ],
            provider_response_key="official_pdf/curriculum-plan/2022/sha256/test/provider/vlm/provider-response.jsonl",
            layout_elements_key="official_pdf/curriculum-plan/2022/sha256/test/source-truth/layout-elements.jsonl",
            default_visibility_scope="main",
            corpus="curriculum",
            collection="curriculum_plan",
            row_policy=CURRICULUM_SPLIT_MANIFEST_ROW_POLICY,
        )
        record = DocumentRegistryRecord(
            document_id="curriculum:民族学本科第二学士学位人才培养方案",
            revision_track="source-faithful",
            version_id=str(document_input.metadata["version_id"]),
            source_uri=str(
                document_input.metadata.get("source_url")
                or document_input.metadata.get("source_id")
                or ""
            ),
            content_hash=hashlib.sha256(document_input.document_units_bytes).hexdigest(),
            corpus="curriculum",
            collection="curriculum_plan",
            cleaning_policy_version="curriculum_plan_cleaning_v1",
            entitlement_groups=tuple(document_input.metadata.get("entitlement_groups") or ()),
            visibility_scope="main",
            status=str(document_input.metadata.get("status") or "active"),
            ingestion_timestamp="2026-03-28T10:00:00+00:00",
            parser_version="mineru-vlm-adapted-v2",
            embedding_model="Qwen3-Embedding-4B",
            source_channel="pdf_ocr",
            is_current=True,
            document_units_object_key="curriculum/documents/tmp/document-units.jsonl",
            import_source="raw_online_ocr",
        )

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=document_input.document_units_bytes,
            chunk_profile=ChunkProfile(
                chunk_size=360,
                max_chunk_size=540,
                chunk_overlap=72,
                min_chunk_size=50,
                chunk_policy_version="curriculum_plan_semantic_v1",
                cleaning_policy_version="curriculum_plan_cleaning_v1",
            ),
        )

        self.assertGreaterEqual(len(chunks), 1)
        self.assertEqual(
            chunks[0].anchor["section_path"],
            ["民族学本科第二学士学位人才培养方案", "一、培养目标"],
        )
        self.assertNotIn("(2020 版)", chunks[0].text)
        self.assertNotIn("(2020 版)", "\n".join(chunks[0].anchor["section_path"]))
