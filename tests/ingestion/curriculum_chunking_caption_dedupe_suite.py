from __future__ import annotations

import unittest

from .curriculum_chunking_test_support import *


class CurriculumChunkingCaptionDedupeTest(unittest.TestCase):
    def test_build_indexable_chunks_from_jsonl_promotes_structural_table_caption_to_table_section(
        self,
    ) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0610-block-0001",
                        "row_id": "page-0610-block-0001",
                        "row_type": "heading",
                        "heading_level": 1,
                        "clean_text": "八、教学进程计划表",
                        "section_hint": "section",
                        "page_start": 610,
                        "page_end": 610,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0610-block-0002",
                        "row_id": "page-0610-block-0002",
                        "row_type": "note",
                        "clean_text": "专业代码:060104",
                        "page_start": 610,
                        "page_end": 610,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0610-block-0003",
                        "row_id": "page-0610-block-0003",
                        "row_type": "table",
                        "clean_text": "<table><tr><td>课程类别</td><td>课程名称</td></tr><tr><td>专业基础课</td><td>文物学概论</td></tr></table>",
                        "html": "<table><tr><td>课程类别</td><td>课程名称</td></tr><tr><td>专业基础课</td><td>文物学概论</td></tr></table>",
                        "table_cells": [
                            {
                                "row": 1,
                                "col": 1,
                                "text": "课程类别",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 1,
                                "col": 2,
                                "text": "课程名称",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 2,
                                "col": 1,
                                "text": "专业基础课",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 2,
                                "col": 2,
                                "text": "文物学概论",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                        ],
                        "page_start": 610,
                        "page_end": 610,
                        "continuation_group_id": "page-0610-block-0003",
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0611-block-0001",
                        "row_id": "page-0611-block-0001",
                        "row_type": "table_caption",
                        "clean_text": "九、实践教学环节安排表",
                        "page_start": 611,
                        "page_end": 611,
                        "owner_row_id": "page-0611-block-0002",
                        "relation_type": "caption_of",
                        "continuation_group_id": "page-0611-block-0002",
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0611-block-0002",
                        "row_id": "page-0611-block-0002",
                        "row_type": "table",
                        "clean_text": "<table><tr><td>实践教学环节</td><td>学分</td></tr><tr><td>毕业论文</td><td>6</td></tr></table>",
                        "html": "<table><tr><td>实践教学环节</td><td>学分</td></tr><tr><td>毕业论文</td><td>6</td></tr></table>",
                        "table_cells": [
                            {
                                "row": 1,
                                "col": 1,
                                "text": "实践教学环节",
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
                                "text": "毕业论文",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 2,
                                "col": 2,
                                "text": "6",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                        ],
                        "page_start": 611,
                        "page_end": 611,
                        "continuation_group_id": "page-0611-block-0002",
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0611-block-0003",
                        "row_id": "page-0611-block-0003",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "十、有关说明",
                        "section_hint": "section",
                        "page_start": 611,
                        "page_end": 611,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0611-block-0004",
                        "row_id": "page-0611-block-0004",
                        "row_type": "paragraph",
                        "clean_text": "允许使用案例分析作为毕业论文形式。",
                        "page_start": 611,
                        "page_end": 611,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record, structured_jsonl_bytes=structured_payload
        )

        target_table_chunk = next(
            chunk
            for chunk in chunks
            if chunk.metadata["unit_type"] == "table_unit" and "毕业论文" in chunk.text
        )
        trailing_section_chunk = next(
            chunk
            for chunk in chunks
            if chunk.metadata["unit_type"] == "section_text"
            and chunk.text.startswith("十、有关说明")
        )

        self.assertEqual(target_table_chunk.anchor["section_path"], ["九、实践教学环节安排表"])
        self.assertTrue(target_table_chunk.text.startswith("九、实践教学环节安排表"))
        self.assertNotIn("八、教学进程计划表\n\n", trailing_section_chunk.text)

    def test_build_indexable_chunks_from_jsonl_dedupes_repeated_structural_caption_heading(
        self,
    ) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0620-block-0001",
                        "row_id": "page-0620-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "七、各教学环节学时学分分配表",
                        "section_hint": "section",
                        "page_start": 620,
                        "page_end": 620,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0620-block-0002",
                        "row_id": "page-0620-block-0002",
                        "row_type": "table_caption",
                        "clean_text": "七、各教学环节学时学分分配表",
                        "page_start": 620,
                        "page_end": 620,
                        "owner_row_id": "page-0620-block-0003",
                        "relation_type": "caption_of",
                        "continuation_group_id": "page-0620-block-0003",
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0620-block-0003",
                        "row_id": "page-0620-block-0003",
                        "row_type": "table",
                        "clean_text": "<table><tr><td>类别</td><td>学分</td></tr><tr><td>专业教育</td><td>54</td></tr></table>",
                        "html": "<table><tr><td>类别</td><td>学分</td></tr><tr><td>专业教育</td><td>54</td></tr></table>",
                        "table_cells": [
                            {
                                "row": 1,
                                "col": 1,
                                "text": "类别",
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
                                "text": "专业教育",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 2,
                                "col": 2,
                                "text": "54",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                        ],
                        "page_start": 620,
                        "page_end": 620,
                        "continuation_group_id": "page-0620-block-0003",
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record, structured_jsonl_bytes=structured_payload
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(
            chunks[0].text.count("七、各教学环节学时学分分配表"),
            1,
        )
