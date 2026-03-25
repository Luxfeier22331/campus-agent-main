from __future__ import annotations

import unittest

from campus_ingestion_core.chunking import (
    DEFAULT_CHUNK_OVERLAP,
    DEFAULT_CHUNK_POLICY_VERSION,
    DEFAULT_CHUNK_SIZE,
    DEFAULT_CLEANING_POLICY_VERSION,
    DEFAULT_MAX_CHUNK_SIZE,
    DEFAULT_MIN_CHUNK_SIZE,
    HANDBOOK_V3_CHUNK_POLICY_VERSION,
    TABLE_PLACEHOLDER,
    ChunkProfile,
    RegexApproxTokenCounter,
    StructuredUnitChunkInput,
    StudentHandbookChunkingStrategy,
    StudentHandbookChunkingStrategyV2,
    build_student_handbook_chunk_profile,
    chunk_structured_unit,
    clean_structured_text,
    estimate_token_count,
)


class ChunkingPolicyTest(unittest.TestCase):
    def test_default_profile_matches_legacy_v1_budget_defaults(self) -> None:
        profile = ChunkProfile()

        self.assertEqual(profile.chunk_size, DEFAULT_CHUNK_SIZE)
        self.assertEqual(profile.max_chunk_size, DEFAULT_MAX_CHUNK_SIZE)
        self.assertEqual(profile.chunk_overlap, DEFAULT_CHUNK_OVERLAP)
        self.assertEqual(profile.min_chunk_size, DEFAULT_MIN_CHUNK_SIZE)
        self.assertEqual(profile.split_strategy, "structure_first")
        self.assertEqual(profile.chunk_policy_version, DEFAULT_CHUNK_POLICY_VERSION)
        self.assertEqual(profile.cleaning_policy_version, DEFAULT_CLEANING_POLICY_VERSION)

    def test_chunk_profile_rejects_invalid_boundaries(self) -> None:
        with self.assertRaises(ValueError):
            ChunkProfile(chunk_size=0)
        with self.assertRaises(ValueError):
            ChunkProfile(chunk_size=64, max_chunk_size=63)
        with self.assertRaises(ValueError):
            ChunkProfile(max_chunk_size=64, chunk_overlap=64)
        with self.assertRaises(ValueError):
            ChunkProfile(min_chunk_size=0)
        with self.assertRaises(ValueError):
            ChunkProfile(max_chunk_size=64, min_chunk_size=64)
        with self.assertRaises(ValueError):
            ChunkProfile(split_strategy="unknown")  # type: ignore[arg-type]

    def test_student_handbook_strategy_is_explicit_runtime_default(self) -> None:
        profile = ChunkProfile()

        self.assertEqual(profile.strategy_name, "student_handbook_structure")
        self.assertIsInstance(profile.strategy, StudentHandbookChunkingStrategy)

    def test_build_student_handbook_chunk_profile_v2_uses_current_runtime_budget(self) -> None:
        profile = build_student_handbook_chunk_profile(
            profile_version="student_handbook_semantic_v2",
            model_name="Qwen3-Embedding-4B",
        )

        self.assertEqual(profile.chunk_size, 384)
        self.assertEqual(profile.max_chunk_size, 512)
        self.assertEqual(profile.chunk_overlap, 64)
        self.assertEqual(profile.min_chunk_size, 96)
        self.assertEqual(profile.chunk_policy_version, "student_handbook_semantic_v2")
        self.assertIn("Qwen3-Embedding-4B", profile.tokenizer_name)

    def test_build_student_handbook_chunk_profile_v3_uses_qwen_tokenizer_and_final_text_budgeting(self) -> None:
        profile = build_student_handbook_chunk_profile(
            profile_version=HANDBOOK_V3_CHUNK_POLICY_VERSION,
            model_name="Qwen3-Embedding-4B",
        )

        self.assertEqual(profile.chunk_size, 384)
        self.assertEqual(profile.max_chunk_size, 512)
        self.assertEqual(profile.chunk_overlap, 64)
        self.assertEqual(profile.min_chunk_size, 96)
        self.assertEqual(profile.chunk_policy_version, HANDBOOK_V3_CHUNK_POLICY_VERSION)
        self.assertTrue(profile.final_text_aware)
        self.assertEqual(profile.safety_margin, 16)
        self.assertEqual(profile.strategy_name, "student_handbook_structure_v3")
        self.assertEqual(profile.tokenizer_name, "hf:Qwen/Qwen3-Embedding-4B")

    def test_clean_structured_text_strips_parent_html_table_and_keeps_placeholder(self) -> None:
        cleaned = clean_structured_text(
            unit_type="article_body",
            text=(
                "Library opening hours are listed below.\n"
                "<table><tr><td>Mon</td><td>08:00-22:00</td></tr></table>\n"
                "The library remains open for regular student use."
            ),
        )

        self.assertNotIn("<table>", cleaned)
        self.assertIn(TABLE_PLACEHOLDER, cleaned)
        self.assertIn("library remains open", cleaned.lower())

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
            chunk_profile=ChunkProfile(chunk_size=50, max_chunk_size=80, chunk_overlap=8, min_chunk_size=20),
        )

        self.assertGreater(len(pieces), 1)
        self.assertTrue(all(piece.unit_type == "table_unit" for piece in pieces))
        self.assertTrue(all(piece.split_reason == "table_row_window" for piece in pieces))
        self.assertTrue(all("等级 | 分数" in piece.text for piece in pieces))

    def test_article_body_splits_oversized_text_with_runtime_metadata(self) -> None:
        unit = StructuredUnitChunkInput(
            unit_type="article_body",
            root_unit_id="article-001",
            text=" ".join(f"token-{index:04d}" for index in range(520)),
        )

        pieces = chunk_structured_unit(unit=unit, chunk_profile=ChunkProfile())

        self.assertGreater(len(pieces), 1)
        self.assertTrue(all(piece.root_unit_id == "article-001" for piece in pieces))
        self.assertTrue(all(piece.unit_type == "article_body" for piece in pieces))
        self.assertEqual(tuple(piece.segment_index for piece in pieces), tuple(range(1, len(pieces) + 1)))
        self.assertTrue(all(piece.segment_total == len(pieces) for piece in pieces))
        self.assertTrue(all(piece.split_reason == "token_guardrail" for piece in pieces))
        self.assertTrue(all(estimate_token_count(piece.text) <= DEFAULT_MAX_CHUNK_SIZE for piece in pieces))

    def test_article_body_prefers_clause_boundaries_before_token_guardrail(self) -> None:
        line_one = "(一) " + " ".join(f"a{index}" for index in range(8))
        line_two = "(二) " + " ".join(f"b{index}" for index in range(8))
        line_three = "(三) " + " ".join(f"c{index}" for index in range(8))
        unit = StructuredUnitChunkInput(
            unit_type="article_body",
            root_unit_id="article-002",
            text="\n".join([line_one, line_two, line_three]),
        )

        pieces = chunk_structured_unit(
            unit=unit,
            chunk_profile=ChunkProfile(chunk_size=16, max_chunk_size=25, chunk_overlap=4, min_chunk_size=8),
        )

        self.assertEqual(len(pieces), 2)
        self.assertEqual(pieces[0].text, f"{line_one}\n{line_two}")
        self.assertEqual(pieces[1].text, line_three)
        self.assertTrue(all(piece.split_reason == "structure_boundary" for piece in pieces))
        self.assertTrue(all(piece.boundary_rule == "clause_line" for piece in pieces))

    def test_article_body_with_preamble_prefers_clause_blocks_before_token_guardrail(self) -> None:
        preamble = "优秀本科毕业生评选条件如下:"
        line_one = "(一) " + " ".join(f"a{index}" for index in range(10))
        line_two = "(二) " + " ".join(f"b{index}" for index in range(10))
        line_three = "(三) " + " ".join(f"c{index}" for index in range(10))

        pieces = chunk_structured_unit(
            unit=StructuredUnitChunkInput(
                unit_type="article_body",
                root_unit_id="article-005",
                text="\n".join([preamble, line_one, line_two, line_three]),
            ),
            chunk_profile=ChunkProfile(
                chunk_size=18,
                max_chunk_size=28,
                chunk_overlap=4,
                min_chunk_size=8,
                chunk_policy_version="student_handbook_semantic_v2",
                strategy_name="student_handbook_structure_v2",
                strategy=StudentHandbookChunkingStrategyV2(),
            ),
        )

        self.assertGreaterEqual(len(pieces), 2)
        self.assertTrue(pieces[0].text.startswith(f"{preamble}\n{line_one}"))
        self.assertIn(line_two, "\n".join(piece.text for piece in pieces))
        self.assertIn(line_three, "\n".join(piece.text for piece in pieces))
        self.assertTrue(all(piece.text.startswith(preamble) for piece in pieces))
        self.assertTrue(all(piece.split_reason == "structure_boundary" for piece in pieces))
        self.assertTrue(all(piece.boundary_rule == "clause_block" for piece in pieces))

    def test_article_body_preserves_secondary_clause_group_intro_when_split(self) -> None:
        preamble = "校级优秀本科毕业生须具备以下基本条件:"
        base_one = "(一) " + " ".join(f"a{index}" for index in range(6))
        base_two = "(二) " + " ".join(f"b{index}" for index in range(6))
        secondary_intro = "同时,还须具备以下条件之一:"
        extra_one = "(一) " + " ".join(f"c{index}" for index in range(6))
        extra_two = "(二) " + " ".join(f"d{index}" for index in range(6))

        pieces = chunk_structured_unit(
            unit=StructuredUnitChunkInput(
                unit_type="article_body",
                root_unit_id="article-006",
                text="\n".join([preamble, base_one, base_two, secondary_intro, extra_one, extra_two]),
            ),
            chunk_profile=ChunkProfile(
                chunk_size=24,
                max_chunk_size=52,
                chunk_overlap=4,
                min_chunk_size=8,
                chunk_policy_version="student_handbook_semantic_v2",
                strategy_name="student_handbook_structure_v2",
                strategy=StudentHandbookChunkingStrategyV2(),
            ),
        )

        joined = "\n".join(piece.text for piece in pieces)
        self.assertIn(secondary_intro, joined)
        self.assertTrue(any(secondary_intro in piece.text and extra_one in piece.text for piece in pieces))
        self.assertTrue(all(piece.split_reason == "structure_boundary" for piece in pieces))
        self.assertTrue(all(piece.boundary_rule == "clause_block" for piece in pieces))

    def test_policy_page_prefers_roster_line_boundaries_before_token_guardrail(self) -> None:
        lines = [
            "校园110 68932220",
            "学校办公室 68932442",
            "宣传部 68932451",
            "校团委 68932322",
            "财务处 68932453",
            "校图书馆 68932489",
        ]
        unit = StructuredUnitChunkInput(
            unit_type="policy_page",
            root_unit_id="policy-page-002",
            text="\n".join(lines),
        )

        pieces = chunk_structured_unit(
            unit=unit,
            chunk_profile=ChunkProfile(chunk_size=10, max_chunk_size=16, chunk_overlap=4, min_chunk_size=6),
        )

        self.assertEqual(len(pieces), 2)
        self.assertEqual(pieces[0].text, "\n".join(lines[:3]))
        self.assertEqual(pieces[1].text, "\n".join(lines[3:]))
        self.assertTrue(all(piece.split_reason == "structure_boundary" for piece in pieces))
        self.assertTrue(all(piece.boundary_rule == "roster_line" for piece in pieces))

    def test_policy_page_prefers_enumerated_list_blocks_before_token_guardrail(self) -> None:
        lines = [
            "注册志愿者应满足以下条件:",
            "(一) " + " ".join(f"a{index}" for index in range(8)),
            "1. " + " ".join(f"b{index}" for index in range(8)),
            "(二) " + " ".join(f"c{index}" for index in range(8)),
            "1. " + " ".join(f"d{index}" for index in range(8)),
        ]

        pieces = chunk_structured_unit(
            unit=StructuredUnitChunkInput(
                unit_type="policy_page",
                root_unit_id="policy-page-004",
                text="\n".join(lines),
            ),
            chunk_profile=ChunkProfile(
                chunk_size=18,
                max_chunk_size=40,
                chunk_overlap=4,
                min_chunk_size=8,
                chunk_policy_version="student_handbook_semantic_v2",
                strategy_name="student_handbook_structure_v2",
                strategy=StudentHandbookChunkingStrategyV2(),
            ),
        )

        self.assertGreaterEqual(len(pieces), 2)
        self.assertTrue(pieces[0].text.startswith(lines[0]))
        self.assertTrue(all(piece.text.startswith(lines[0]) for piece in pieces))
        self.assertTrue(all(piece.split_reason == "structure_boundary" for piece in pieces))
        self.assertTrue(all(piece.boundary_rule == "enumerated_list_block" for piece in pieces))

    def test_article_body_falls_back_to_token_guardrail_when_clause_lines_exceed_max_chunk_size(self) -> None:
        lines = [
            "(一) " + " ".join(f"a{index}" for index in range(40)),
            "(二) " + " ".join(f"b{index}" for index in range(40)),
        ]
        pieces = chunk_structured_unit(
            unit=StructuredUnitChunkInput(
                unit_type="article_body",
                root_unit_id="article-004",
                text="\n".join(lines),
            ),
            chunk_profile=ChunkProfile(chunk_size=16, max_chunk_size=25, chunk_overlap=4, min_chunk_size=8),
        )

        self.assertGreater(len(pieces), 2)
        self.assertTrue(all(piece.split_reason == "token_guardrail" for piece in pieces))
        self.assertTrue(all(estimate_token_count(piece.text) <= 25 for piece in pieces))

    def test_token_guardrail_restart_aligns_to_latest_boundary_within_overlap(self) -> None:
        unit = StructuredUnitChunkInput(
            unit_type="policy_page",
            root_unit_id="policy-page-005",
            text="\n".join(f"{index}. 甲乙丙丁。" for index in range(1, 9)),
        )

        pieces = chunk_structured_unit(
            unit=unit,
            chunk_profile=ChunkProfile(
                chunk_size=28,
                max_chunk_size=35,
                chunk_overlap=15,
                min_chunk_size=8,
                strategy=None,
                strategy_name="generic_token_budget",
            ),
        )

        self.assertGreaterEqual(len(pieces), 2)
        self.assertEqual(pieces[0].text.splitlines()[0], "1. 甲乙丙丁。")
        self.assertTrue(pieces[1].text.startswith("5. 甲乙丙丁。"))

    def test_structure_boundary_prefers_target_budget_over_max_budget_when_grouping_clauses(self) -> None:
        lines = [f"({marker}) " + " ".join(f"甲{index}" for index in range(18)) for marker in ("一", "二", "三", "四", "五")]
        pieces = chunk_structured_unit(
            unit=StructuredUnitChunkInput(
                unit_type="article_body",
                root_unit_id="article-008",
                text="\n".join(lines),
            ),
            chunk_profile=ChunkProfile(
                chunk_size=48,
                max_chunk_size=80,
                chunk_overlap=8,
                min_chunk_size=16,
                chunk_policy_version="student_handbook_semantic_v2",
                strategy_name="student_handbook_structure_v2",
                strategy=StudentHandbookChunkingStrategyV2(),
            ),
        )

        self.assertGreaterEqual(len(pieces), 3)
        self.assertTrue(all(piece.split_reason == "structure_boundary" for piece in pieces))
        self.assertTrue(all(piece.boundary_rule == "clause_block" for piece in pieces))
        self.assertTrue(all(estimate_token_count(piece.text) <= 64 for piece in pieces[:-1]))

    def test_final_text_aware_budget_splits_when_required_header_consumes_budget(self) -> None:
        unit = StructuredUnitChunkInput(
            unit_type="article_body",
            root_unit_id="article-007",
            text="甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉",
            anchor={
                "section_path": ["学生管理规定", "课堂纪律"],
                "article_label": "第十六条",
            },
            metadata={
                "title": "中央民族大学学生课堂行为规范及课堂秩序管理办法",
                "policy_doc_no": "民大校发〔2007〕282号",
            },
        )

        pieces = chunk_structured_unit(
            unit=unit,
            chunk_profile=ChunkProfile(
                chunk_size=24,
                max_chunk_size=48,
                chunk_overlap=4,
                min_chunk_size=8,
                chunk_policy_version=HANDBOOK_V3_CHUNK_POLICY_VERSION,
                strategy_name="student_handbook_structure_v3",
                strategy=StudentHandbookChunkingStrategyV2(),
                token_counter=RegexApproxTokenCounter(name="regex_test"),
                tokenizer_name="regex_test",
                final_text_aware=True,
                safety_margin=4,
            ),
        )

        self.assertGreater(len(pieces), 1)
        self.assertTrue(all(piece.split_reason == "token_guardrail" for piece in pieces))

    def test_policy_page_falls_back_to_token_guardrail_when_roster_lines_exceed_max_chunk_size(self) -> None:
        lines = [
            "校园110 " + " ".join(f"6893{index:04d}" for index in range(20)),
            "学校办公室 " + " ".join(f"6894{index:04d}" for index in range(20)),
        ]
        pieces = chunk_structured_unit(
            unit=StructuredUnitChunkInput(
                unit_type="policy_page",
                root_unit_id="policy-page-003",
                text="\n".join(lines),
            ),
            chunk_profile=ChunkProfile(chunk_size=12, max_chunk_size=18, chunk_overlap=4, min_chunk_size=6),
        )

        self.assertGreater(len(pieces), 2)
        self.assertTrue(all(piece.split_reason == "token_guardrail" for piece in pieces))
        self.assertTrue(all(estimate_token_count(piece.text) <= 18 for piece in pieces))

    def test_generic_chunk_profile_without_handbook_strategy_falls_back_to_token_guardrail(self) -> None:
        line_one = "(一) " + " ".join(f"a{index}" for index in range(8))
        line_two = "(二) " + " ".join(f"b{index}" for index in range(8))
        line_three = "(三) " + " ".join(f"c{index}" for index in range(8))
        unit = StructuredUnitChunkInput(
            unit_type="article_body",
            root_unit_id="article-003",
            text="\n".join([line_one, line_two, line_three]),
        )

        pieces = chunk_structured_unit(
            unit=unit,
            chunk_profile=ChunkProfile(
                chunk_size=16,
                max_chunk_size=25,
                chunk_overlap=4,
                min_chunk_size=8,
                strategy=None,
                strategy_name="generic_token_budget",
            ),
        )

        self.assertEqual(len(pieces), 2)
        self.assertTrue(all(piece.split_reason == "token_guardrail" for piece in pieces))
        self.assertTrue(all(piece.boundary_rule is None for piece in pieces))


if __name__ == "__main__":
    unittest.main()
