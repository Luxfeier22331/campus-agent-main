from __future__ import annotations

from tests.ingestion._handbook_chunking_test_support import (
    build_hermetic_handbook_v3_chunk_profile,
)

from .chunking_policy_test_support import *


class ChunkingPolicyStructureTest(_ChunkingPolicyTestCase):
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
        self.assertEqual(
            tuple(piece.segment_index for piece in pieces), tuple(range(1, len(pieces) + 1))
        )
        self.assertTrue(all(piece.segment_total == len(pieces) for piece in pieces))
        self.assertTrue(all(piece.split_reason == "token_guardrail" for piece in pieces))
        self.assertTrue(
            all(estimate_token_count(piece.text) <= DEFAULT_MAX_CHUNK_SIZE for piece in pieces)
        )

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
            chunk_profile=ChunkProfile(
                chunk_size=16, max_chunk_size=25, chunk_overlap=4, min_chunk_size=8
            ),
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
                text="\n".join(
                    [preamble, base_one, base_two, secondary_intro, extra_one, extra_two]
                ),
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
        self.assertTrue(
            any(secondary_intro in piece.text and extra_one in piece.text for piece in pieces)
        )
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
        self.assertFalse(
            any(piece.text.startswith("1. 笔试主要为外语综合能力测试") for piece in pieces)
        )

    def test_article_structure_boundary_carries_parent_context_for_nested_subclause_segments(
        self,
    ) -> None:
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
            chunk_profile=build_hermetic_handbook_v3_chunk_profile(),
        )

        self.assertGreaterEqual(len(pieces), 2)
        self.assertTrue(all(piece.split_reason == "structure_boundary" for piece in pieces))
        self.assertTrue(all(piece.boundary_rule == "article_structure_block" for piece in pieces))
        self.assertTrue(
            any(
                "转专业程序" in piece.text
                and "(五)考核及确定名单" in piece.text
                and "3. 确定面试名单的原则" in piece.text
                and "(2)确定面试名单时" in piece.text
                for piece in pieces
            )
        )
        self.assertFalse(any(piece.text.startswith("转专业程序\n(2)") for piece in pieces))

    def test_chunking_structure_module_repairs_numeric_subclause_parent_context(self) -> None:
        repaired = repair_article_subclause_boundary_context_from_structure_module(
            (
                "(五)考核及确定名单\n1. 考核方式由各院系确定。",
                "2. 面试人数原则上按接收计划数的150%确定。",
            ),
            display_budget=types.SimpleNamespace(max_tokens=64),
            count_tokens=RegexApproxTokenCounter().count,
        )

        self.assertEqual(
            repaired[1],
            "(五)考核及确定名单\n2. 面试人数原则上按接收计划数的150%确定。",
        )

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
            chunk_profile=ChunkProfile(
                chunk_size=10, max_chunk_size=16, chunk_overlap=4, min_chunk_size=6
            ),
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

    def test_article_body_falls_back_to_token_guardrail_when_clause_lines_exceed_max_chunk_size(
        self,
    ) -> None:
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
            chunk_profile=ChunkProfile(
                chunk_size=16, max_chunk_size=25, chunk_overlap=4, min_chunk_size=8
            ),
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

    def test_token_guardrail_expands_final_overlap_to_avoid_short_tail(self) -> None:
        unit = StructuredUnitChunkInput(
            unit_type="article_body",
            root_unit_id="article-009",
            text=(
                "北京市委、市政府一直高度重视结核病防控工作，不断完善结核病防治服务体系建设，"
                "大力保障结核病防治工作经费，在全市构建了政府主导、部门协同、专业机构分工负责、"
                "社会共同参与的综合防治机制。北京市目前有北京结核病控制研究与防治所、北京胸科医院、"
                "北京老年医院、解放军总医院第八医学中心、北京儿童医院、北京佑安医院、北京地坛医院共7家"
                "市级结核病定点医疗机构，以及18家区级结核病定点医疗机构，实现对耐药、疑难病例、危急重症、"
                "TB/HIV双重感染、儿童、孕产妇等人群肺结核患者规范治疗管理全覆盖。结核病纳入本市基本医疗保险，"
                "患者发生的相关医疗费用，大部分可以按相关政策予以报销。2020年将耐多药肺结核纳入本市基本医疗保险门诊特殊疾病范围。"
            ),
        )

        pieces = chunk_structured_unit(
            unit=unit,
            chunk_profile=ChunkProfile(
                chunk_size=260,
                max_chunk_size=296,
                chunk_overlap=32,
                min_chunk_size=48,
                strategy=None,
                strategy_name="generic_token_budget",
            ),
        )

        self.assertGreaterEqual(len(pieces), 2)
        self.assertTrue(all(piece.split_reason == "token_guardrail" for piece in pieces))
        self.assertGreaterEqual(
            estimate_token_count(pieces[-1].text),
            48,
        )
        self.assertIn("2020年将耐多药肺结核纳入本市基本医疗保险门诊特殊疾病范围。", pieces[-1].text)

    def test_chunking_token_window_module_rebalances_short_tail(self) -> None:
        display_budget = types.SimpleNamespace(
            max_tokens=24,
            target_tokens=18,
            min_tokens=10,
            overlap_tokens=4,
        )
        counter = RegexApproxTokenCounter().count
        text = "\n".join(
            [
                "第一段说明甲乙丙丁戊己庚辛壬癸。",
                "第二段说明甲乙丙丁戊己庚辛壬癸。",
                "第三段说明甲乙丙丁戊己庚辛壬癸。",
            ]
        )

        token_spans = tokenize_text(text)
        boundary_indexes = collect_soft_boundary_indexes(text=text, token_spans=token_spans)
        windows = split_token_windows(
            text=text,
            token_spans=token_spans,
            display_budget=display_budget,
            count_tokens=counter,
        )
        rebalanced = merge_short_tail(
            windows,
            text=text,
            token_spans=token_spans,
            boundary_indexes=boundary_indexes,
            display_budget=display_budget,
            count_tokens=counter,
        )

        self.assertGreaterEqual(len(windows), 2)
        self.assertGreaterEqual(counter(rebalanced[-1][2]), display_budget.min_tokens)
        self.assertLessEqual(counter(rebalanced[-1][2]), display_budget.max_tokens)
        self.assertIn("第三段说明", rebalanced[-1][2])

    def test_structure_boundary_prefers_target_budget_over_max_budget_when_grouping_clauses(
        self,
    ) -> None:
        lines = [
            f"({marker}) " + " ".join(f"甲{index}" for index in range(18))
            for marker in ("一", "二", "三", "四", "五")
        ]
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
                "title": "示例大学学生课堂行为规范及课堂秩序管理办法",
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

    def test_policy_page_falls_back_to_token_guardrail_when_roster_lines_exceed_max_chunk_size(
        self,
    ) -> None:
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
            chunk_profile=ChunkProfile(
                chunk_size=12, max_chunk_size=18, chunk_overlap=4, min_chunk_size=6
            ),
        )

        self.assertGreater(len(pieces), 2)
        self.assertTrue(all(piece.split_reason == "token_guardrail" for piece in pieces))
        self.assertTrue(all(estimate_token_count(piece.text) <= 18 for piece in pieces))

    def test_generic_chunk_profile_without_handbook_strategy_falls_back_to_token_guardrail(
        self,
    ) -> None:
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
