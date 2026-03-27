from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import sys
import threading
import time
import types
import unittest
from unittest import mock

import campus_ingestion_core.tokenizer_cache as tokenizer_cache
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
    _load_hf_tokenizer,
    assemble_chunk_text,
    build_student_handbook_chunk_profile,
    build_chunk_text_context,
    chunk_structured_unit,
    clean_structured_text,
    estimate_token_count,
)
from campus_ingestion_core.handbook_article_structure import normalize_article_body_structure


class ChunkingPolicyTest(unittest.TestCase):
    def tearDown(self) -> None:
        _load_hf_tokenizer.cache_clear()

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

    def test_resolve_prefetched_hf_tokenizer_path_requires_local_cache(self) -> None:
        with mock.patch(
            "campus_ingestion_core.tokenizer_cache._snapshot_download",
            side_effect=RuntimeError("cache miss"),
        ) as snapshot_download:
            with self.assertRaisesRegex(RuntimeError, "prefetch"):
                tokenizer_cache.resolve_prefetched_hf_tokenizer_path("Qwen/Qwen3-Embedding-4B")

        snapshot_download.assert_called_once_with(
            "Qwen/Qwen3-Embedding-4B",
            allow_patterns=tokenizer_cache.HF_TOKENIZER_ALLOW_PATTERNS,
            local_files_only=True,
        )

    def test_prefetch_hf_tokenizer_downloads_expected_tokenizer_files(self) -> None:
        with mock.patch(
            "campus_ingestion_core.tokenizer_cache._snapshot_download",
            return_value="/tmp/qwen-tokenizer",
        ) as snapshot_download:
            result = tokenizer_cache.prefetch_hf_tokenizer("Qwen/Qwen3-Embedding-4B")

        self.assertEqual(result, "/tmp/qwen-tokenizer")
        snapshot_download.assert_called_once_with(
            "Qwen/Qwen3-Embedding-4B",
            allow_patterns=tokenizer_cache.HF_TOKENIZER_ALLOW_PATTERNS,
        )

    def test_load_hf_tokenizer_uses_resolved_local_snapshot_only(self) -> None:
        fake_tokenizer = object()
        fake_transformers = types.SimpleNamespace(
            AutoTokenizer=types.SimpleNamespace(
                from_pretrained=mock.Mock(return_value=fake_tokenizer)
            )
        )
        with mock.patch(
            "campus_ingestion_core.chunking.resolve_prefetched_hf_tokenizer_path",
            return_value="/tmp/qwen-tokenizer",
        ) as resolve_path:
            with mock.patch.dict(sys.modules, {"transformers": fake_transformers}):
                result = _load_hf_tokenizer("Qwen/Qwen3-Embedding-4B")

        self.assertIs(result, fake_tokenizer)
        resolve_path.assert_called_once_with("Qwen/Qwen3-Embedding-4B")
        fake_transformers.AutoTokenizer.from_pretrained.assert_called_once_with(
            "/tmp/qwen-tokenizer",
            local_files_only=True,
        )

    def test_load_hf_tokenizer_initializes_once_under_concurrent_calls(self) -> None:
        _load_hf_tokenizer.cache_clear()
        call_count = [0]
        call_lock = threading.Lock()

        def fake_from_pretrained(path: str, *, local_files_only: bool = True) -> object:
            self.assertEqual(path, "/tmp/qwen-tokenizer")
            self.assertTrue(local_files_only)
            with call_lock:
                call_count[0] += 1
            time.sleep(0.05)
            return object()

        fake_transformers = types.SimpleNamespace(
            AutoTokenizer=types.SimpleNamespace(from_pretrained=fake_from_pretrained)
        )

        with mock.patch(
            "campus_ingestion_core.chunking.resolve_prefetched_hf_tokenizer_path",
            return_value="/tmp/qwen-tokenizer",
        ):
            with mock.patch.dict(sys.modules, {"transformers": fake_transformers}):
                with ThreadPoolExecutor(max_workers=8) as executor:
                    results = list(
                        executor.map(
                            lambda _: _load_hf_tokenizer("Qwen/Qwen3-Embedding-4B"),
                            range(8),
                        )
                    )

        self.assertEqual(call_count[0], 1)
        self.assertEqual(len({id(result) for result in results}), 1)

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

    def test_assemble_chunk_text_prefers_compact_header_for_short_deeply_nested_text(self) -> None:
        context_plan = build_chunk_text_context(
            anchor={
                "section_path": ["第二章 分则", "第一部分 注册", "四、权利", "(二) 注册志愿服务组织"],
            },
            metadata={
                "title": "中央民族大学学生志愿服务管理办法",
                "policy_doc_no": "民大团发〔2010〕14号",
            },
        )

        assembly = assemble_chunk_text(
            display_text="1. 组织开展符合组织宗旨的志愿服务活动的权利。",
            context_plan=context_plan,
            chunk_profile=ChunkProfile(
                chunk_size=128,
                max_chunk_size=192,
                chunk_overlap=16,
                min_chunk_size=32,
                final_text_aware=True,
                safety_margin=16,
            ),
        )

        self.assertNotEqual(assembly.header_mode, "full_path")
        self.assertLess(assembly.header_token_count, 50)
        self.assertIn("注册志愿服务组织", assembly.text)

    def test_build_chunk_text_context_title_only_variant_keeps_title_when_section_path_exists(self) -> None:
        context_plan = build_chunk_text_context(
            anchor={
                "section_path": ["第五章 奖励分测评"],
                "article_label": "第十九条",
            },
            metadata={
                "title": "中央民族大学本科学生综合素质测评办法",
                "policy_doc_no": "民大校发[2018]323号",
            },
        )

        title_only = next(
            variant for variant in context_plan.preferred_variants if variant.mode == "title_only"
        )

        self.assertEqual(
            title_only.joined_text(),
            "中央民族大学本科学生综合素质测评办法\n文号：民大校发[2018]323号",
        )

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

    def test_normalize_article_body_structure_keeps_soft_wrap_recoveries_as_single_body_lines(self) -> None:
        normalized = normalize_article_body_structure(
            "\n".join(
                [
                    "(三)须向学校足额缴纳学费及其他相关费用。",
                    "(四)能较熟练掌握对方学校所在地区的语言,具备交流、沟通能力。",
                    "1. 委托院系选拔方式,主要适用于只涉及1个学院的项目。",
                ]
            )
        )

        self.assertIn("(三)须向学校足额缴纳学费及其他相关费用。", normalized)
        self.assertIn("(四)能较熟练掌握对方学校所在地区的语言,具备交流、沟通能力。", normalized)
        self.assertIn("1. 委托院系选拔方式,主要适用于只涉及1个学院的项目。", normalized)
        self.assertNotIn("(三)须向\n学校足额缴纳", normalized)
        self.assertNotIn("(四)能较熟练掌握对方\n学校所在地区", normalized)
        self.assertNotIn("1. 委托\n院系选拔方式", normalized)

    def test_normalize_article_body_structure_splits_long_clause_heading_from_body(self) -> None:
        normalized = normalize_article_body_structure(
            "\n".join(
                [
                    "(一)确定项目选拔条件与年度选拔计划国际合作处(港澳台事务办公室)确定各留学项目等相关事宜,包括名额、专业、学术或学业要求、留学期限及选拔时限等项目选拔条件与要求,函告教务处。",
                    "(二)发布选拔要求与通知教务处根据项目要求,发布具体选拔通知,视项目情况,可采取委托院系选拔或学校统一组织选拔两种方式。",
                    "(一)科研项目奖励(总分1.5分)参与科研项目且已在所评学年内结项的,按以下标准分别依次给予奖励加分,所评学年内未结项的不予加分;",
                ]
            )
        )

        self.assertIn("(一)确定项目选拔条件与年度选拔计划\n国际合作处(港澳台事务办公室)确定各留学项目等相关事宜", normalized)
        self.assertIn("(二)发布选拔要求与通知\n教务处根据项目要求,发布具体选拔通知", normalized)
        self.assertIn("(一)科研项目奖励(总分1.5分)\n参与科研项目且已在所评学年内结项", normalized)

    def test_normalize_article_body_structure_splits_title_note_glue(self) -> None:
        normalized = normalize_article_body_structure(
            "\n".join(
                [
                    "发表一般文章、专著奖励标准备注:学校官方微信即中央民族大学微信公众号",
                    "参加社会实践、主题活动奖励标准备注:志愿服务活动须经学校团委认定为准。",
                ]
            )
        )

        self.assertIn("发表一般文章、专著奖励标准\n备注:学校官方微信即中央民族大学微信公众号", normalized)
        self.assertIn("参加社会实践、主题活动奖励标准\n备注:志愿服务活动须经学校团委认定为准。", normalized)

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

    def test_article_body_structure_split_keeps_nested_subclauses_with_parent_heading(self) -> None:
        lines = [
            "选拔程序与要求",
            "(四)选拔考核方式",
            "1. 学校统一组织选拔的项目,选拔考核方式包括笔试、面试等两个环节。",
            "2. 委托院系选拔的项目,选拔考核方式由委托院系自行确定并公告学生。",
            "(五)笔试考核",
            "1. 笔试主要为外语综合能力测试,试题内容主要包括外语写作、翻译等。",
            "2. 笔试试卷命题和阅卷教师由相关外语专业所在院系推荐。",
            "(六)面试考核",
            "1. 面试主要考核申请者的口语表达能力和综合素质。",
            "2. 面试将根据项目需要成立面试考官组。",
        ]

        pieces = chunk_structured_unit(
            unit=StructuredUnitChunkInput(
                unit_type="article_body",
                root_unit_id="article-009",
                text="\n".join(lines),
            ),
            chunk_profile=ChunkProfile(
                chunk_size=48,
                max_chunk_size=96,
                chunk_overlap=8,
                min_chunk_size=12,
                chunk_policy_version=HANDBOOK_V3_CHUNK_POLICY_VERSION,
                strategy_name="student_handbook_structure_v3",
                strategy=StudentHandbookChunkingStrategyV2(),
            ),
        )

        self.assertGreaterEqual(len(pieces), 2)
        self.assertTrue(all(piece.split_reason == "structure_boundary" for piece in pieces))
        self.assertTrue(all(piece.boundary_rule == "article_structure_block" for piece in pieces))
        self.assertTrue(
            any(
                "(五)笔试考核" in piece.text
                and "1. 笔试主要为外语综合能力测试" in piece.text
                and "2. 笔试试卷命题和阅卷教师" in piece.text
                for piece in pieces
            )
        )
        self.assertFalse(any(piece.text.startswith("1. 笔试主要为外语综合能力测试") for piece in pieces))

    def test_article_structure_boundary_carries_parent_context_for_nested_subclause_segments(self) -> None:
        lines = [
            "转专业程序",
            "(一)制定并提交专业接收计划",
            "1. 各院系根据本单位的师资、学生规模等实际情况和专业特点,确定各专业拟接收人数、考试科目以及考核方式等并报教务处。",
            "2. 各院系原则上每次转专业都应提交接收计划,接收有兴趣、有能力的学生转专业,但接收计划数应与现有学生数及两次转专业接收人数进行综合考虑,不另行开班。",
            "3. 考试科目原则上应为该学期本专业开设的两门专业基础课程,考试难易度与期末考试相当。",
            "(二)学生申请",
            "本科学生根据学校公布的转专业计划提出转专业申请。符合转专业申请条件的学生将申请表交所在院系。每个学生1次只允许申请转1个专业,凡申请转多个专业的学生申请表予以作废。",
            "(三)院系审核",
            "各院系根据转专业的原则和条件对申请学生进行审核,并将合格的学生申请材料及汇总表统一报教务处,逾期不再受理。",
            "(四)公布参加转专业考试学生名单及考试具体安排",
            "教务处对所有转专业学生申请材料进行复核,并公布参加转专业考试的学生名单及考试安排。",
            "(五)考核及确定名单",
            "1. 考核方式考核形式由各院系确定,原则上考核包括笔试和面试。笔试由教务处统一组织,试题由教务处委托院系命题或由教务处从历年试题库中随机抽取,考核试卷保存5年;面试由院系自行组织。",
            "2. 面试人数原则上按各专业接收计划数的150%确定面试人数。",
            "3. 确定面试名单的原则",
            "(1)根据笔试总成绩从高到低排序,按接收计划数的150%确定面试名单。",
            "(2)确定面试名单时,优先考虑两门专业课程笔试成绩均合格的学生。两门专业课程笔试均合格的学生人数未达到计划数的150%时,所缺名额从剩余的报考学生中,按笔试总成绩从高到低确定。",
            "(3)单科笔试成绩为0分的学生不能参加面试。",
            "4. 面试要求",
            "(1)需面试的院系,按教务处提交的名单自行组织面试。",
            "(2)面试原则上应由3名及以上具有副高职称或教学经验丰富的教师组成。",
            "(3)院系要制定面试要求和标准,做好面试的相关记录并保存5年。",
            "5. 拟接收名单的确定院系按照笔试和面试总成绩从高到低排序(不需要面试的院系直接按笔试成绩排序),再根据各专业的专业计划数确定拟接收学生名单,并报教务处。",
            "6.院系对接收计划进行相应调整时,须报教务处批准。",
            "(六)公示",
            "教务处根据院系拟定的接收名单报经学校批准后进行公示,公示时间不少于5个工作日。",
        ]

        pieces = chunk_structured_unit(
            unit=StructuredUnitChunkInput(
                unit_type="article_body",
                root_unit_id="article-010",
                text="\n".join(lines),
            ),
            chunk_profile=build_student_handbook_chunk_profile(
                profile_version=HANDBOOK_V3_CHUNK_POLICY_VERSION,
                model_name="Qwen3-Embedding-4B",
            ),
        )

        self.assertGreaterEqual(len(pieces), 2)
        self.assertTrue(all(piece.split_reason == "structure_boundary" for piece in pieces))
        self.assertTrue(all(piece.boundary_rule == "article_structure_block" for piece in pieces))
        self.assertTrue(any(piece.text.startswith("转专业程序\n(五)考核及确定名单\n3. 确定面试名单的原则") for piece in pieces))
        self.assertFalse(any(piece.text.startswith("转专业程序\n(2)") for piece in pieces))

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

    def test_policy_page_arabic_list_keeps_prefix_when_split_by_structure_boundary(self) -> None:
        lines = [
            "附:有下列情况之一者,不属于享受公费医疗范围:",
            "1. " + " ".join(f"a{index}" for index in range(10)),
            "2. " + " ".join(f"b{index}" for index in range(10)),
            "3. " + " ".join(f"c{index}" for index in range(10)),
            "4. " + " ".join(f"d{index}" for index in range(10)),
        ]

        pieces = chunk_structured_unit(
            unit=StructuredUnitChunkInput(
                unit_type="policy_page",
                root_unit_id="policy-page-006",
                text="\n".join(lines),
            ),
            chunk_profile=ChunkProfile(
                chunk_size=18,
                max_chunk_size=44,
                chunk_overlap=4,
                min_chunk_size=8,
                chunk_policy_version=HANDBOOK_V3_CHUNK_POLICY_VERSION,
                strategy_name="student_handbook_structure_v3",
                strategy=StudentHandbookChunkingStrategyV2(),
            ),
        )

        self.assertGreaterEqual(len(pieces), 2)
        self.assertTrue(all(piece.text.startswith(lines[0]) for piece in pieces))
        self.assertTrue(all(piece.split_reason == "structure_boundary" for piece in pieces))
        self.assertTrue(all(piece.boundary_rule == "enumerated_list_block" for piece in pieces))
        self.assertTrue(any("4." in piece.text for piece in pieces))

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
