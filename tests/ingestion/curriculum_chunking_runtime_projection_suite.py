from __future__ import annotations

import unittest

from .curriculum_chunking_test_support import *


class CurriculumChunkingRuntimeProjectionTest(unittest.TestCase):
    def test_synthetic_curriculum_projection_can_chunk_after_split(self) -> None:
        _, chunks = _build_real_curriculum_projection_chunks(SYNTHETIC_PUBLIC_AFFAIRS_ID)

        self.assertGreater(len(chunks), 0)
        self.assertEqual(chunks[0].metadata["unit_type"], "section_text")
        self.assertEqual(chunks[0].anchor["page_start"], 278)
        self.assertIn(SYNTHETIC_PUBLIC_AFFAIRS_TITLE, chunks[0].text)

    def test_synthetic_curriculum_projection_keeps_course_setting_context_on_table_chunks(
        self,
    ) -> None:
        _, chunks = _build_real_curriculum_projection_chunks(SYNTHETIC_PUBLIC_AFFAIRS_ID)

        table_chunks = [chunk for chunk in chunks if chunk.metadata["unit_type"] == "table_unit"]
        self.assertGreaterEqual(len(table_chunks), 2)
        self.assertTrue(
            any(
                "五、课程设置和修读建议" in chunk.text
                and "2. 学科基础教育" in chunk.text
                and "课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期" in chunk.text
                and "SYN101 | 公共问题分析" in chunk.text
                for chunk in table_chunks
            )
        )
        self.assertTrue(
            any(
                "五、课程设置和修读建议" in chunk.text
                and "(三)个性化培养" in chunk.text
                and "建议课程清单:" in chunk.text
                and "SYN201 | 协同治理专题" in chunk.text
                for chunk in table_chunks
            )
        )

    def test_synthetic_curriculum_projection_repairs_parent_heading_context_for_subsection_chunks(
        self,
    ) -> None:
        _, chunks = _build_real_curriculum_projection_chunks(SYNTHETIC_DATA_SYSTEMS_ID)

        target_chunk = next(
            chunk
            for chunk in chunks
            if chunk.metadata["unit_type"] == "section_text" and "(二)知识要求" in chunk.text
        )

        self.assertTrue(target_chunk.text.startswith("一、培养目标\n\n(二)知识要求"))
        self.assertEqual(
            target_chunk.anchor["section_path"],
            [SYNTHETIC_DATA_SYSTEMS_TITLE, "一、培养目标", "(二)知识要求"],
        )

    def test_synthetic_curriculum_projection_does_not_emit_course_map_title_chunks(
        self,
    ) -> None:
        for document_id in (SYNTHETIC_PUBLIC_AFFAIRS_ID, SYNTHETIC_DATA_SYSTEMS_ID):
            _, chunks = _build_real_curriculum_projection_chunks(document_id)

            self.assertFalse(
                any(
                    chunk.metadata["unit_type"] == "section_text" and "课程结构拓扑图" in chunk.text
                    for chunk in chunks
                )
            )

    def test_synthetic_curriculum_answer_facts_are_marked_answer_bearing(self) -> None:
        _, chunks = _build_real_curriculum_projection_chunks(SYNTHETIC_PUBLIC_AFFAIRS_ID)

        section_chunk = next(
            chunk
            for chunk in chunks
            if chunk.metadata["unit_type"] == "section_text" and "(二)知识要求" in chunk.text
        )
        course_table_chunk = next(
            chunk
            for chunk in chunks
            if chunk.metadata["unit_type"] == "table_unit" and "SYN101 | 公共问题分析" in chunk.text
        )

        self.assertTrue(section_chunk.metadata["is_answer_bearing"])
        self.assertTrue(course_table_chunk.metadata["is_answer_bearing"])

    def test_build_indexable_chunks_from_jsonl_skips_course_map_navigation_noise(self) -> None:
        record = _make_curriculum_record()
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0600-block-0001",
                        "row_id": "page-0600-block-0001",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "六、课程地图",
                        "section_hint": "section",
                        "page_start": 600,
                        "page_end": 600,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0600-block-0002",
                        "row_id": "page-0600-block-0002",
                        "row_type": "heading",
                        "heading_level": 4,
                        "clean_text": "1. 哲学",
                        "section_hint": "numeric_heading",
                        "page_start": 600,
                        "page_end": 600,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0600-block-0003",
                        "row_id": "page-0600-block-0003",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "哲学专业本科课程结构拓扑图",
                        "section_hint": None,
                        "page_start": 600,
                        "page_end": 600,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0600-block-0004",
                        "row_id": "page-0600-block-0004",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "七、其他说明",
                        "section_hint": "section",
                        "page_start": 600,
                        "page_end": 600,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0600-block-0005",
                        "row_id": "page-0600-block-0005",
                        "row_type": "paragraph",
                        "clean_text": "允许国际学分转换。",
                        "page_start": 600,
                        "page_end": 600,
                        "acl": {"level": "public", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=build_hermetic_curriculum_chunk_profile(),
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].anchor["section_path"], ["七、其他说明"])
        self.assertNotIn("拓扑图", chunks[0].text)

    def test_runtime_v2_preserves_table_segment_metadata_when_absorbing_heading_context(
        self,
    ) -> None:
        record = _make_curriculum_record()
        table_cells = [
            {"row": 1, "col": 1, "text": "一级指标", "is_header": True},
            {"row": 1, "col": 2, "text": "二级指标", "is_header": True},
            {"row": 1, "col": 3, "text": "三级指标", "is_header": True},
        ]
        for row_index in range(2, 12):
            table_cells.extend(
                [
                    {
                        "row": row_index,
                        "col": 1,
                        "text": f"知识目标 {row_index - 1}",
                    },
                    {
                        "row": row_index,
                        "col": 2,
                        "text": f"{row_index - 1}-1 学科基础知识",
                    },
                    {
                        "row": row_index,
                        "col": 3,
                        "text": (
                            "掌握公共管理学科知识体系和分析方法，能够结合管理实践理解复杂公共问题。"
                            f"指标序号 {row_index - 1}。"
                        ),
                    },
                ]
            )
        structured_payload = "\n".join(
            [
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0315-block-0010",
                        "row_id": "page-0315-block-0010",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "二、毕业要求",
                        "page_start": 315,
                        "page_end": 315,
                    },
                    ensure_ascii=False,
                ),
                json.dumps(
                    {
                        "doc_id": record.document_id,
                        "version_id": record.version_id,
                        "chunk_id": "page-0315-block-0011",
                        "row_id": "page-0315-block-0011",
                        "row_type": "table",
                        "clean_text": "<table></table>",
                        "html": "<table></table>",
                        "table_cells": table_cells,
                        "page_start": 315,
                        "page_end": 316,
                        "continuation_group_id": "page-0315-block-0011",
                    },
                    ensure_ascii=False,
                ),
            ]
        ).encode("utf-8")

        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_payload,
            chunk_profile=ChunkProfile(
                chunk_size=96,
                max_chunk_size=128,
                chunk_overlap=16,
                min_chunk_size=24,
                chunk_policy_version="curriculum_plan_semantic_v1",
                cleaning_policy_version="curriculum_plan_cleaning_v1",
            ),
        )

        target_chunk = next(
            chunk
            for chunk in chunks
            if chunk.metadata["unit_type"] == "table_unit"
            and chunk.metadata.get("aggregation_mode")
            == "adjacent_curriculum_section_table_context"
            and "一级指标 | 二级指标 | 三级指标" in chunk.text
        )

        self.assertEqual(target_chunk.metadata["segment_index"], 1)
        self.assertGreater(target_chunk.metadata["member_segment_lineage"][-1]["segment_total"], 1)
        self.assertEqual(
            target_chunk.metadata["segment_total"],
            target_chunk.metadata["member_segment_lineage"][-1]["segment_total"],
        )
