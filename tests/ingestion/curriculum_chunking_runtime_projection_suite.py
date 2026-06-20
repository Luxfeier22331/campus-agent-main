from __future__ import annotations

import unittest

from .curriculum_chunking_test_support import *


class CurriculumChunkingRuntimeProjectionTest(unittest.TestCase):
    def test_real_curriculum_projection_can_chunk_after_split(self) -> None:
        _, chunks = _build_real_curriculum_projection_chunks(
            "curriculum:国际经济与贸易本科人才培养方案"
        )

        self.assertGreater(len(chunks), 0)
        self.assertEqual(chunks[0].metadata["unit_type"], "section_text")
        self.assertEqual(chunks[0].anchor["page_start"], 278)
        self.assertIn("国际经济与贸易本科人才培养方案", chunks[0].text)

    def test_real_curriculum_projection_absorbs_short_intro_and_table_cue_into_table_chunk(
        self,
    ) -> None:
        _, chunks = _build_real_curriculum_projection_chunks(
            "curriculum:国际经济与贸易本科人才培养方案"
        )

        self.assertFalse(any(chunk.text.strip() == "建议课程清单:" for chunk in chunks))
        self.assertFalse(
            any(
                chunk.metadata["unit_type"] == "section_text"
                and "国际经济与贸易专业选修课程至少任选 7 门课程,完成 14 学分。" in chunk.text
                for chunk in chunks
            )
        )
        self.assertTrue(
            any(
                chunk.metadata["unit_type"] == "table_unit"
                and "国际经济与贸易专业选修课程至少任选 7 门课程,完成 14 学分。" in chunk.text
                and "课程清单如下:" in chunk.text
                and "课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 开设学期" in chunk.text
                for chunk in chunks
            )
        )
        self.assertTrue(
            any(
                chunk.metadata["unit_type"] == "table_unit"
                and "建议课程清单:" in chunk.text
                and "课程类 | 课程号 | 课程名称 | 学分" in chunk.text
                for chunk in chunks
            )
        )

    def test_real_curriculum_projection_merges_weak_single_row_table_into_previous_table_context(
        self,
    ) -> None:
        _, chunks = _build_real_curriculum_projection_chunks(
            "curriculum:国际经济与贸易本科人才培养方案"
        )

        self.assertFalse(
            any(
                chunk.metadata["unit_type"] == "table_unit"
                and chunk.text.strip()
                == "1034030154 | 国际商务案例分析(实训) | 1 | 36 | 18 | 理论部分第6学期1-9周/实践部分5-6小学期"
                for chunk in chunks
            )
        )
        self.assertTrue(
            any(
                chunk.metadata["unit_type"] == "table_unit"
                and "1034030154 | 国际商务案例分析(实训) | 1 | 36 | 18 | 理论部分第6学期1-9周/实践部分5-6小学期"
                in chunk.text
                and "课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期" in chunk.text
                for chunk in chunks
            )
        )

    def test_real_curriculum_projection_repairs_parent_heading_context_for_subsection_chunks(
        self,
    ) -> None:
        _, chunks = _build_real_curriculum_projection_chunks(
            "curriculum:国际经济与贸易本科人才培养方案"
        )

        self.assertFalse(
            any(
                chunk.metadata["unit_type"] == "section_text"
                and chunk.text.startswith("(二)知识要求")
                for chunk in chunks
            )
        )
        self.assertTrue(
            any(
                chunk.metadata["unit_type"] == "section_text"
                and chunk.text.startswith("二、毕业要求\n\n(二)知识要求")
                for chunk in chunks
            )
        )

    def test_runtime_v2_does_not_duplicate_leaf_heading_when_prepending_parent_context(
        self,
    ) -> None:
        _, chunks = _build_real_curriculum_runtime_chunks("经济学拔尖人才创新班人才培养方案")

        target_chunk = next(
            chunk
            for chunk in chunks
            if chunk.metadata["unit_type"] == "section_text"
            and chunk.anchor["section_path"]
            == [
                "经济学拔尖人才创新班人才培养方案",
                "二、毕业要求",
                "(二)知识要求",
            ]
        )

        self.assertTrue(target_chunk.text.startswith("二、毕业要求\n\n(二)知识要求"))
        self.assertNotIn("(二)知识要求\n\n(二)知识要求", target_chunk.text)

    def test_runtime_v2_does_not_duplicate_leaf_heading_on_historical_curriculum_chunks(
        self,
    ) -> None:
        _, chunks = _build_real_curriculum_runtime_chunks(
            "中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案"
        )

        self.assertFalse(
            any(
                chunk.metadata["unit_type"] == "section_text"
                and "2. 专业选修课程\n\n2. 专业选修课程" in chunk.text
                for chunk in chunks
            )
        )

    def test_real_curriculum_projection_does_not_emit_orphan_heading_only_section_chunk(
        self,
    ) -> None:
        _, chunks = _build_real_curriculum_projection_chunks(
            "curriculum:国际经济与贸易本科人才培养方案"
        )

        self.assertFalse(
            any(
                chunk.metadata["unit_type"] == "section_text"
                and chunk.text.strip() == "(二)专业教育"
                for chunk in chunks
            )
        )

    def test_real_curriculum_projection_repairs_course_setting_parent_context_for_section_and_table_chunks(
        self,
    ) -> None:
        _, chunks = _build_real_curriculum_projection_chunks(
            "curriculum:国际经济与贸易本科人才培养方案"
        )

        self.assertTrue(
            any(
                chunk.metadata["unit_type"] == "section_text"
                and "2. 学科基础教育" in chunk.text
                and chunk.text.startswith(
                    "五、课程设置和修读建议\n\n(一) 大类培养\n\n2. 学科基础教育"
                )
                for chunk in chunks
            )
        )
        self.assertTrue(
            any(
                chunk.metadata["unit_type"] == "table_unit"
                and "课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期" in chunk.text
                and chunk.text.startswith(
                    "五、课程设置和修读建议\n\n(一) 大类培养\n\n2. 学科基础教育"
                )
                for chunk in chunks
            )
        )

    def test_curriculum_answer_facts_are_marked_answer_bearing(self) -> None:
        _, chunks = _build_real_curriculum_projection_chunks(
            "curriculum:国际经济与贸易本科人才培养方案"
        )

        graduation_requirement_chunk = next(
            chunk
            for chunk in chunks
            if chunk.metadata["unit_type"] == "section_text"
            and "二、毕业要求" in chunk.text
            and "(二)知识要求" in chunk.text
        )
        course_table_chunk = next(
            chunk
            for chunk in chunks
            if chunk.metadata["unit_type"] == "table_unit"
            and "课程号 | 课程名称 | 学分 | 学时 | 实践学时 | 修读学期" in chunk.text
        )

        self.assertTrue(graduation_requirement_chunk.metadata["is_answer_bearing"])
        self.assertTrue(course_table_chunk.metadata["is_answer_bearing"])

    def test_real_curriculum_projection_keeps_structural_context_on_high_token_table_chunks(
        self,
    ) -> None:
        for document_id in (
            "curriculum:国际经济与贸易本科人才培养方案",
            "curriculum:经济学拔尖人才创新班人才培养方案",
        ):
            _, chunks = _build_real_curriculum_projection_chunks(document_id)

            self.assertFalse(
                any(
                    chunk.metadata["unit_type"] == "table_unit"
                    and "五、课程设置和修读建议" in chunk.anchor["section_path"]
                    and chunk.metadata["final_token_count"] >= 500
                    and not any(
                        heading in chunk.text for heading in chunk.anchor["section_path"][1:]
                    )
                    for chunk in chunks
                )
            )

    def test_runtime_v2_keeps_intermediate_course_setting_heading_on_high_token_table_chunks(
        self,
    ) -> None:
        _, chunks = _build_real_curriculum_runtime_chunks("经济学拔尖人才创新班人才培养方案")

        target_chunk = next(
            chunk
            for chunk in chunks
            if chunk.metadata["unit_type"] == "table_unit"
            and chunk.anchor["section_path"]
            == [
                "经济学拔尖人才创新班人才培养方案",
                "五、课程设置和修读建议",
                "(一) 大类培养",
                "1. 通识教育",
            ]
            and int(chunk.metadata["final_token_count"]) >= 600
        )

        self.assertIn("五、课程设置和修读建议", target_chunk.text)
        self.assertIn("(一) 大类培养", target_chunk.text)
        self.assertIn("1. 通识教育", target_chunk.text)

    def test_runtime_v2_keeps_leaf_professional_education_heading_on_large_historical_table_chunks(
        self,
    ) -> None:
        _, chunks = _build_real_curriculum_runtime_chunks("孝通实验班本科人才培养方案")

        target_chunk = next(
            chunk
            for chunk in chunks
            if chunk.metadata["unit_type"] == "table_unit"
            and chunk.anchor["section_path"]
            == [
                "孝通实验班本科人才培养方案",
                "五、课程设置和修读建议",
                "(二)专业教育",
            ]
            and "老龄化与健康" in chunk.text
        )

        self.assertIn("五、课程设置和修读建议", target_chunk.text)
        self.assertIn("(二)专业教育", target_chunk.text)

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

    def test_runtime_v2_does_not_bleed_previous_section_into_degree_section_for_historical_curriculum(
        self,
    ) -> None:
        _, chunks = _build_real_curriculum_runtime_chunks("财政学本科人才培养方案")

        target_chunk = next(
            chunk
            for chunk in chunks
            if chunk.metadata["unit_type"] == "section_text"
            and chunk.anchor["section_path"]
            == [
                "财政学本科人才培养方案",
                "三、学制、总学分和学位授予",
            ]
        )

        self.assertTrue(target_chunk.text.startswith("三、学制、总学分和学位授予"))
        self.assertNotIn("二、毕业要求\n\n", target_chunk.text)

    def test_runtime_v2_does_not_bleed_previous_section_into_degree_section_for_mixed_heading_historical_curriculum(
        self,
    ) -> None:
        _, chunks = _build_real_curriculum_runtime_chunks("中国少数民族语言文学本科人才培养方案")

        target_chunk = next(
            chunk
            for chunk in chunks
            if chunk.metadata["unit_type"] == "section_text"
            and chunk.anchor["section_path"]
            == [
                "中国少数民族语言文学本科人才培养方案",
                "三、学制、总学分和学位授予",
            ]
        )

        self.assertTrue(target_chunk.text.startswith("三、学制、总学分和学位授予"))
        self.assertNotIn("二、毕业要求\n\n", target_chunk.text)

    def test_runtime_v2_absorbs_short_parent_intro_into_following_child_section(self) -> None:
        _, chunks = _build_real_curriculum_runtime_chunks(
            "中央民族大学通识课程思想政治理论课教学计划"
        )

        self.assertFalse(
            any(
                chunk.metadata["unit_type"] == "section_text"
                and chunk.anchor["section_path"]
                == [
                    "中央民族大学通识课程思想政治理论课教学计划",
                    "二、课程设置及培养要求",
                ]
                and chunk.text
                == "二、课程设置及培养要求\n\n课程模式包括大学体育课程和第二课堂实践活动。"
                for chunk in chunks
            )
        )
        target_chunk = next(
            chunk
            for chunk in chunks
            if chunk.metadata["unit_type"] == "section_text"
            and "课程模式包括大学体育课程和第二课堂实践活动。" in chunk.text
            and "(一)大学体育课程" in chunk.text
        )

        self.assertTrue(target_chunk.text.startswith("二、课程设置及培养要求"))

    def test_runtime_v2_excludes_course_map_section_chunks_from_query_serving(self) -> None:
        _, chunks = _build_real_curriculum_runtime_chunks("经济学拔尖人才创新班人才培养方案")
        self.assertFalse(
            any(
                chunk.metadata["unit_type"] == "section_text"
                and chunk.anchor["section_path"]
                == [
                    "经济学拔尖人才创新班人才培养方案",
                    "六、课程地图",
                ]
                for chunk in chunks
            )
        )

    def test_runtime_v2_does_not_leave_course_map_title_card_on_previous_section(self) -> None:
        _, chunks = _build_real_curriculum_runtime_chunks(
            "中国少数民族语言文学（古文字学方向）强基计划本科人才培养方案"
        )

        self.assertFalse(
            any(
                "拓扑图" in chunk.text
                for chunk in chunks
                if (chunk.anchor.get("section_path") or [])[-1:] != ["六、课程地图"]
            )
        )

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
                        "heading_level": 4,
                        "clean_text": "2. 宗教学",
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
                        "chunk_id": "page-0600-block-0005",
                        "row_id": "page-0600-block-0005",
                        "row_type": "heading",
                        "heading_level": 2,
                        "clean_text": "宗教学专业本科课程结构拓扑图",
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
                        "chunk_id": "page-0600-block-0006",
                        "row_id": "page-0600-block-0006",
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
                        "chunk_id": "page-0600-block-0007",
                        "row_id": "page-0600-block-0007",
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
            record=record, structured_jsonl_bytes=structured_payload
        )

        self.assertEqual(len(chunks), 1)
        self.assertEqual(chunks[0].anchor["section_path"], ["七、其他说明"])
        self.assertNotIn("拓扑图", chunks[0].text)
