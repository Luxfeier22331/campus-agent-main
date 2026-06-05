from __future__ import annotations

from .chunking_policy_test_support import *


class ChunkingPolicyTableTest(_ChunkingPolicyTestCase):
    def test_table_units_are_not_resplit_even_when_token_budget_is_large(self) -> None:
        unit = StructuredUnitChunkInput(
            unit_type="table_row",
            root_unit_id="table-001",
            text=" ".join(f"cell-{index}" for index in range(500)),
        )

        pieces = chunk_structured_unit(unit=unit, chunk_profile=ChunkProfile())

        self.assertEqual(len(pieces), 1)
        self.assertEqual(pieces[0].unit_type, "table_row")
        self.assertEqual(pieces[0].segment_index, 1)
        self.assertEqual(pieces[0].segment_total, 1)
        self.assertIsNone(pieces[0].split_reason)

    def test_table_unit_splits_by_row_window_when_body_rows_exceed_budget(self) -> None:
        unit = StructuredUnitChunkInput(
            unit_type="table_unit",
            root_unit_id="table-001",
            text="表格上下文: 奖励标准\n等级 | 分数\n优 | 90-100",
            metadata={
                "table_header_line": "等级 | 分数",
                "table_row_lines": [
                    "优秀一等奖 | " + "甲" * 40,
                    "优秀二等奖 | " + "乙" * 40,
                    "优秀三等奖 | " + "丙" * 40,
                ],
                "caption_lines": ["表格上下文: 奖励标准"],
            },
        )

        pieces = chunk_structured_unit(
            unit=unit,
            chunk_profile=ChunkProfile(
                chunk_size=50, max_chunk_size=80, chunk_overlap=8, min_chunk_size=20
            ),
        )

        self.assertGreater(len(pieces), 1)
        self.assertTrue(all(piece.unit_type == "table_unit" for piece in pieces))
        self.assertTrue(all(piece.split_reason == "table_row_window" for piece in pieces))
        self.assertTrue(all("等级 | 分数" in piece.text for piece in pieces))

    def test_table_row_window_respects_final_contextual_token_budget(self) -> None:
        row_lines = [
            "高等学校学费 | 元/人 | 见文件 | 学生 | 国家教委、国家计委、财政部 教财[1996]101号",
            "教育部、国家发展改革委、财政部 教财[2003]4号 | | | |",
            "国家计委、财政部 计价格[2002]838号 | | | |",
            "国家计委、财政部、教育部 计价格[2002]665号 | | | |",
            "教育部、国家发展改革委、财政部 教财[2006]2号 | | | |",
            "普通高校重点学校一般专业本专科学费 | 元/生.学年 | 不超过5000 (具体按备案标准) | | 北京市物价局、财政局、教委 京价(收)字[2000]217号",
            "普通高校重点学校理工科专业本专科学费 | 元/生.学年 | 不超过5500 (具体按备案标准) | | 北京市物价局、财政局、教委 京价(收)字[2000]217号",
            "普通高校重点学校外语医科类本专科学费 | 元/生.学年 | 不超过6000 (具体按备案标准) | | 北京市物价局、财政局、教委 京价(收)字[2000]217号",
            "普通高校艺术类专业本专科学费 | 元/生.学年 | 不超过10000 (具体按备案标准) | | 北京市物价局、财政局、教委 京价(收)字[2000]217号",
        ]
        unit = StructuredUnitChunkInput(
            unit_type="table_unit",
            root_unit_id="table-fees",
            text="中央民族大学大学教育收费公示表\n"
            "收费项目 | 计费单位 | 收费标准 | 收费范围 收费对象 | 批准收费的机关及文号\n"
            + "\n".join(row_lines),
            anchor={"table_context": "中央民族大学大学教育收费公示表"},
            metadata={
                "title": "中央民族大学大学教育收费公示表",
                "page_family": "directory_page",
                "serving_intent": "promotable",
                "caption_lines": ["中央民族大学大学教育收费公示表"],
                "table_header_line": "收费项目 | 计费单位 | 收费标准 | 收费范围 收费对象 | 批准收费的机关及文号",
                "table_row_lines": row_lines,
            },
        )
        chunk_profile = ChunkProfile(
            chunk_size=288,
            max_chunk_size=384,
            chunk_overlap=48,
            min_chunk_size=72,
            final_text_aware=True,
            safety_margin=8,
        )

        pieces = chunk_structured_unit(unit=unit, chunk_profile=chunk_profile)

        self.assertGreater(len(pieces), 1)
        self.assertTrue(all(piece.split_reason == "table_row_window" for piece in pieces))
        for piece in pieces:
            assembly = assemble_chunk_text(
                display_text=piece.text,
                context_plan=build_chunk_text_context(
                    anchor=unit.anchor,
                    metadata=unit.metadata,
                ),
                chunk_profile=chunk_profile,
            )
            self.assertLessEqual(assembly.total_token_count, chunk_profile.max_chunk_size)

    def test_chunking_tables_module_splits_table_rows_by_window(self) -> None:
        specs = build_table_piece_specs_from_table_module(
            unit=types.SimpleNamespace(
                unit_type="table_unit",
                text="表格上下文: 奖励标准\n等级 | 分数\n优 | 90-100",
                metadata={
                    "table_header_line": "等级 | 分数",
                    "table_row_lines": [
                        "优秀一等奖 | " + "甲" * 40,
                        "优秀二等奖 | " + "乙" * 40,
                        "优秀三等奖 | " + "丙" * 40,
                    ],
                    "caption_lines": ["表格上下文: 奖励标准"],
                },
            ),
            chunk_profile=types.SimpleNamespace(max_chunk_size=80),
            count_tokens=RegexApproxTokenCounter().count,
            clean_text=lambda unit_type, text: text.strip(),
            resolve_display_budget=lambda unit, chunk_profile: types.SimpleNamespace(
                max_tokens=80,
                target_tokens=50,
                min_tokens=20,
                overlap_tokens=8,
            ),
        )

        self.assertGreater(len(specs), 1)
        self.assertTrue(all(spec.split_reason == "table_row_window" for spec in specs))
        self.assertTrue(all("等级 | 分数" in spec.text for spec in specs))

    def test_table_unit_without_row_lines_splits_oversized_table_text(self) -> None:
        unit = StructuredUnitChunkInput(
            unit_type="table_unit",
            root_unit_id="table-002",
            text="\n".join(f"第{index}行 | {'甲' * 24}" for index in range(1, 40)),
        )

        pieces = chunk_structured_unit(
            unit=unit,
            chunk_profile=ChunkProfile(
                chunk_size=50, max_chunk_size=80, chunk_overlap=8, min_chunk_size=20
            ),
        )

        self.assertGreater(len(pieces), 1)
        self.assertTrue(all(piece.unit_type == "table_unit" for piece in pieces))
        self.assertEqual(
            tuple(piece.segment_index for piece in pieces),
            tuple(range(1, len(pieces) + 1)),
        )
        self.assertTrue(all(piece.segment_total == len(pieces) for piece in pieces))
        self.assertTrue(all(piece.split_reason == "token_guardrail" for piece in pieces))
        self.assertTrue(all(estimate_token_count(piece.text) <= 80 for piece in pieces))
