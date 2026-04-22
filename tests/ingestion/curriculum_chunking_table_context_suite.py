from __future__ import annotations

import unittest

from .curriculum_chunking_test_support import *  # noqa: F401,F403


class CurriculumChunkingTableContextTest(unittest.TestCase):
    def test_build_indexable_chunks_from_jsonl_moves_table_lead_in_into_table_chunk(self) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0532-block-0001",
                        "row_id": "page-0532-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "五、课程设置和修读建议",
                        "page_start": 532,
                        "page_end": 532,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0532-block-0002",
                        "row_id": "page-0532-block-0002",
                        "row_type": "heading",
                        "heading_level": 3,
                        "clean_text": "1. 专业核心课程",
                        "page_start": 532,
                        "page_end": 532,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0532-block-0003",
                        "row_id": "page-0532-block-0003",
                        "row_type": "paragraph",
                        "clean_text": "(1)音乐表演(声乐)专业必修的专业核心课程 30 学分。",
                        "page_start": 532,
                        "page_end": 532,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0532-block-0004",
                        "row_id": "page-0532-block-0004",
                        "row_type": "paragraph",
                        "clean_text": "课程清单如下:",
                        "page_start": 532,
                        "page_end": 532,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0532-block-0005",
                        "row_id": "page-0532-block-0005",
                        "row_type": "table",
                        "clean_text": "<table><tr><td>专业名称</td><td>课程号</td></tr><tr><td>音乐表演(声乐)</td><td>1048030493</td></tr></table>",
                        "html": "<table><tr><td>专业名称</td><td>课程号</td></tr><tr><td>音乐表演(声乐)</td><td>1048030493</td></tr></table>",
                        "table_cells": [
                            {
                                "row": 1,
                                "col": 1,
                                "text": "专业名称",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 1,
                                "col": 2,
                                "text": "课程号",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 2,
                                "col": 1,
                                "text": "音乐表演(声乐)",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 2,
                                "col": 2,
                                "text": "1048030493",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                        ],
                        "page_start": 532,
                        "page_end": 532,
                        "continuation_group_id": "page-0532-block-0005",
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
        self.assertTrue(chunks[0].text.startswith("五、课程设置和修读建议\n\n1. 专业核心课程"))
        self.assertIn("(1)音乐表演(声乐)专业必修的专业核心课程 30 学分。", chunks[0].text)
        self.assertIn("课程清单如下:", chunks[0].text)
        self.assertIn("专业名称 | 课程号", chunks[0].text)

    def test_build_indexable_chunks_from_jsonl_detaches_heading_like_note_from_table_chunk(
        self,
    ) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0559-block-0001",
                        "row_id": "page-0559-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "五、课程设置和修读建议",
                        "page_start": 559,
                        "page_end": 559,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0559-block-0002",
                        "row_id": "page-0559-block-0002",
                        "row_type": "table",
                        "clean_text": "<table><tr><td>专业名称</td><td>课程号</td></tr><tr><td>舞蹈表演(民族英才班)</td><td>1047030278</td></tr></table>",
                        "html": "<table><tr><td>专业名称</td><td>课程号</td></tr><tr><td>舞蹈表演(民族英才班)</td><td>1047030278</td></tr></table>",
                        "table_cells": [
                            {
                                "row": 1,
                                "col": 1,
                                "text": "专业名称",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 1,
                                "col": 2,
                                "text": "课程号",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 2,
                                "col": 1,
                                "text": "舞蹈表演(民族英才班)",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 2,
                                "col": 2,
                                "text": "1047030278",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                        ],
                        "page_start": 559,
                        "page_end": 559,
                        "continuation_group_id": "page-0559-block-0002",
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0560-block-0001",
                        "row_id": "page-0560-block-0001",
                        "row_type": "note",
                        "clean_text": "(3)舞蹈学专业必修的专业核心课程 50 学分。",
                        "page_start": 560,
                        "page_end": 560,
                        "owner_row_id": "page-0559-block-0002",
                        "relation_type": "note_of",
                        "continuation_group_id": "page-0559-block-0002",
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

        self.assertEqual(len(chunks), 2)
        self.assertEqual(chunks[0].metadata["unit_type"], "table_unit")
        self.assertTrue(chunks[0].text.startswith("五、课程设置和修读建议"))
        self.assertNotIn("(3)舞蹈学专业必修的专业核心课程 50 学分。", chunks[0].text)
        self.assertEqual(chunks[1].metadata["unit_type"], "section_text")
        self.assertIn("(3)舞蹈学专业必修的专业核心课程 50 学分。", chunks[1].text)

    def test_build_indexable_chunks_from_jsonl_renders_rowspan_and_colspan_rows_readably(
        self,
    ) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0021-block-0001",
                        "row_id": "page-0021-block-0001",
                        "row_type": "table",
                        "clean_text": '<table><tr><td>培养阶段</td><td>板块名称</td><td>类别</td><td>学分</td></tr><tr><td rowspan="2">大类培养</td><td rowspan="2">通识教育</td><td>人文素养类</td><td>2</td></tr><tr><td colspan="2">创新创业素养类 / 2</td></tr></table>',
                        "html": '<table><tr><td>培养阶段</td><td>板块名称</td><td>类别</td><td>学分</td></tr><tr><td rowspan="2">大类培养</td><td rowspan="2">通识教育</td><td>人文素养类</td><td>2</td></tr><tr><td colspan="2">创新创业素养类 / 2</td></tr></table>',
                        "table_cells": [
                            {
                                "row": 1,
                                "col": 1,
                                "text": "培养阶段",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 1,
                                "col": 2,
                                "text": "板块名称",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 1,
                                "col": 3,
                                "text": "类别",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 1,
                                "col": 4,
                                "text": "学分",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": True,
                            },
                            {
                                "row": 2,
                                "col": 1,
                                "text": "大类培养",
                                "rowspan": 2,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 2,
                                "col": 2,
                                "text": "通识教育",
                                "rowspan": 2,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 2,
                                "col": 3,
                                "text": "人文素养类",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 2,
                                "col": 4,
                                "text": "2",
                                "rowspan": 1,
                                "colspan": 1,
                                "is_header": False,
                            },
                            {
                                "row": 3,
                                "col": 3,
                                "text": "创新创业素养类 / 2",
                                "rowspan": 1,
                                "colspan": 2,
                                "is_header": False,
                            },
                        ],
                        "page_start": 21,
                        "page_end": 21,
                        "continuation_group_id": "page-0021-block-0001",
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                )
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
        self.assertIn("培养阶段 | 板块名称 | 类别 | 学分", chunks[0].text)
        self.assertIn("大类培养 | 通识教育 | 人文素养类 | 2", chunks[0].text)
        self.assertIn("大类培养 | 通识教育 | 创新创业素养类 / 2", chunks[0].text)
        self.assertNotIn("\n| ", chunks[0].text)
