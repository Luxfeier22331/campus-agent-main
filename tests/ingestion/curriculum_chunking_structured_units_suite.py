from __future__ import annotations

import unittest

from .curriculum_chunking_test_support import *  # noqa: F401,F403


class CurriculumChunkingStructuredUnitsTest(unittest.TestCase):
    def test_build_curriculum_structured_units_drops_numeric_only_page_marker_rows(self) -> None:
        record = _make_curriculum_record()
        structured_payload = json.dumps(
            {
                "doc_id": record.document_id,
                "version_id": record.version_id,
                "chunk_id": "page-0020-block-0001",
                "row_id": "page-0020-block-0001",
                "row_type": "paragraph",
                "clean_text": "15",
                "page_start": 20,
                "page_end": 20,
                "acl": {"level": "public", "allow_groups": ["students"]},
            },
            ensure_ascii=False,
        ).encode("utf-8")

        units = build_curriculum_structured_units(
            record=record, structured_jsonl_bytes=structured_payload
        )

        self.assertEqual(units, ())

    def test_build_curriculum_structured_units_strips_numeric_only_page_marker_from_section_body(
        self,
    ) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0340-block-0001",
                        "row_id": "page-0340-block-0001",
                        "row_type": "heading",
                        "heading_level": 3,
                        "clean_text": "(二)知识",
                        "page_start": 340,
                        "page_end": 340,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0340-block-0002",
                        "row_id": "page-0340-block-0002",
                        "row_type": "paragraph",
                        "clean_text": "335",
                        "page_start": 340,
                        "page_end": 340,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0341-block-0001",
                        "row_id": "page-0341-block-0001",
                        "row_type": "paragraph",
                        "clean_text": "究。",
                        "page_start": 341,
                        "page_end": 341,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        units = build_curriculum_structured_units(
            record=record, structured_jsonl_bytes=structured_payload
        )

        self.assertEqual(len(units), 1)
        self.assertEqual(units[0].anchor["section_path"], ["(二)知识"])
        self.assertEqual(units[0].text, "(二)知识\n\n究。")

    def test_build_indexable_chunks_from_jsonl_skips_course_map_subtree_units(self) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0063-block-0001",
                        "row_id": "page-0063-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "六、课程地图",
                        "section_hint": "section",
                        "page_start": 63,
                        "page_end": 63,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0063-block-0002",
                        "row_id": "page-0063-block-0002",
                        "row_type": "heading",
                        "heading_level": 4,
                        "clean_text": "1.社会学",
                        "page_start": 63,
                        "page_end": 63,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0063-block-0003",
                        "row_id": "page-0063-block-0003",
                        "row_type": "paragraph",
                        "clean_text": "58",
                        "page_start": 63,
                        "page_end": 63,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0063-block-0004",
                        "row_id": "page-0063-block-0004",
                        "row_type": "heading",
                        "heading_level": 4,
                        "clean_text": "2. 社会工作",
                        "page_start": 63,
                        "page_end": 63,
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

        self.assertEqual(chunks, ())

    def test_build_indexable_chunks_from_jsonl_uses_canonical_curriculum_row_visibility(
        self,
    ) -> None:
        record = _make_public_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0001-block-0001",
                        "row_id": "page-0001-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "一、培养目标",
                        "page_start": 1,
                        "page_end": 1,
                        "visibility_level": "restricted",
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0001-block-0002",
                        "row_id": "page-0001-block-0002",
                        "row_type": "paragraph",
                        "clean_text": "仅对受限用户可见的课程说明。",
                        "page_start": 1,
                        "page_end": 1,
                        "visibility_level": "restricted",
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
        self.assertEqual(chunks[0].entitlement_groups, ())
        self.assertEqual(chunks[0].visibility_level, "restricted")

    def test_build_curriculum_contextual_text_only_prepends_missing_parent_headings(self) -> None:
        contextual_text = _build_curriculum_contextual_text(
            unit_type="section_text",
            section_path=[
                "经济学拔尖人才创新班人才培养方案",
                "二、毕业要求",
                "(二)知识要求",
            ],
            piece_text=(
                "(二)知识要求\n"
                "1. 通识性知识:掌握文学、历史、哲学、艺术、管理、法律、社会、写作等方面的知识。"
            ),
            chunk_profile=ChunkProfile(
                chunk_size=360,
                max_chunk_size=540,
                chunk_overlap=72,
                min_chunk_size=50,
                chunk_policy_version="curriculum_plan_semantic_v1",
                cleaning_policy_version="curriculum_plan_cleaning_v1",
            ),
        )

        self.assertEqual(
            contextual_text,
            (
                "二、毕业要求\n\n"
                "(二)知识要求\n"
                "1. 通识性知识:掌握文学、历史、哲学、艺术、管理、法律、社会、写作等方面的知识。"
            ),
        )

    def test_build_curriculum_structured_units_flushes_section_before_advancing_parent_heading(
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
                        "clean_text": "二、毕业要求",
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
                        "row_type": "heading",
                        "heading_level": 3,
                        "clean_text": "(二)知识要求",
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
                        "clean_text": "1. 通识性知识:掌握文学、历史、哲学、艺术、管理、法律、社会、写作等方面的知识。",
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
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "三、学制、总学分和学位授予",
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
                        "chunk_id": "page-0020-block-0005",
                        "row_id": "page-0020-block-0005",
                        "row_type": "paragraph",
                        "clean_text": "学制:4年",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        units = build_curriculum_structured_units(
            record=record, structured_jsonl_bytes=structured_payload
        )

        self.assertEqual(len(units), 2)
        self.assertEqual(
            units[0].anchor["section_path"],
            ["二、毕业要求", "(二)知识要求"],
        )
        self.assertTrue(units[0].text.startswith("二、毕业要求\n\n(二)知识要求"))
        self.assertNotIn("三、学制、总学分和学位授予", units[0].text)
        self.assertEqual(
            units[1].anchor["section_path"],
            ["三、学制、总学分和学位授予"],
        )
        self.assertEqual(units[1].text, "三、学制、总学分和学位授予\n\n学制:4年")

    def test_build_curriculum_structured_units_flushes_same_level_heading_only_section_before_next_section(
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
                        "clean_text": "六、课程地图",
                        "section_hint": "section",
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
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "国际经济与贸易专业本科课程结构拓扑图",
                        "section_hint": None,
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
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "七、其他说明",
                        "section_hint": "section",
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
                        "row_type": "paragraph",
                        "clean_text": "允许国际学分、在线课程学分等学分转换。",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        units = build_curriculum_structured_units(
            record=record, structured_jsonl_bytes=structured_payload
        )

        self.assertEqual(len(units), 2)
        self.assertEqual(units[0].anchor["section_path"], ["六、课程地图"])
        self.assertEqual(
            units[0].text,
            "六、课程地图\n\n国际经济与贸易专业本科课程结构拓扑图",
        )
        self.assertEqual(units[1].anchor["section_path"], ["七、其他说明"])
        self.assertEqual(
            units[1].text,
            "七、其他说明\n\n允许国际学分、在线课程学分等学分转换。",
        )

    def test_build_curriculum_structured_units_flushes_consecutive_same_level_structural_headings(
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
                        "clean_text": "六、课程地图",
                        "section_hint": "section",
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
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "七、其他说明",
                        "section_hint": "section",
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
                        "clean_text": "允许国际学分、在线课程学分等学分转换。",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        units = build_curriculum_structured_units(
            record=record, structured_jsonl_bytes=structured_payload
        )

        self.assertEqual(len(units), 2)
        self.assertEqual(units[0].anchor["section_path"], ["六、课程地图"])
        self.assertEqual(units[0].text, "六、课程地图")
        self.assertEqual(units[1].anchor["section_path"], ["七、其他说明"])
        self.assertEqual(
            units[1].text,
            "七、其他说明\n\n允许国际学分、在线课程学分等学分转换。",
        )

    def test_build_curriculum_structured_units_flushes_heading_only_mixed_levels_before_new_parent_heading(
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
                        "clean_text": "二、毕业要求",
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
                        "row_type": "heading",
                        "heading_level": 3,
                        "clean_text": "(一)素质要求",
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
                        "row_type": "heading",
                        "heading_level": 4,
                        "clean_text": "1. 政治素质",
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
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "三、学制、总学分和学位授予",
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
                        "chunk_id": "page-0020-block-0005",
                        "row_id": "page-0020-block-0005",
                        "row_type": "heading",
                        "heading_level": 3,
                        "clean_text": "学制:4年",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        units = build_curriculum_structured_units(
            record=record, structured_jsonl_bytes=structured_payload
        )

        self.assertEqual(len(units), 2)
        self.assertEqual(
            units[0].anchor["section_path"], ["二、毕业要求", "(一)素质要求", "1. 政治素质"]
        )
        self.assertTrue(units[0].text.startswith("二、毕业要求\n\n(一)素质要求\n\n1. 政治素质"))
        self.assertNotIn("三、学制、总学分和学位授予", units[0].text)
        self.assertEqual(
            units[1].anchor["section_path"], ["三、学制、总学分和学位授予", "学制:4年"]
        )
        self.assertTrue(units[1].text.startswith("三、学制、总学分和学位授予\n\n学制:4年"))

    def test_build_indexable_chunks_from_jsonl_uses_runtime_curriculum_chunk_profile_by_default(
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
                        "row_type": "paragraph",
                        "clean_text": "培养具有系统分析能力的经济学人才。",
                        "page_start": 20,
                        "page_end": 20,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                )
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record, structured_jsonl_bytes=structured_payload
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].metadata["chunk_policy_version"], "curriculum_plan_semantic_v2")
        self.assertEqual(
            chunks[0].metadata["cleaning_policy_version"], "curriculum_plan_cleaning_v1"
        )
        self.assertEqual(chunks[0].metadata["strategy_name"], "curriculum_plan_structure_v2")
        self.assertEqual(chunks[0].metadata["unit_type"], "section_text")
