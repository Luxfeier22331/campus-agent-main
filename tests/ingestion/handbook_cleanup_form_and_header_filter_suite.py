from __future__ import annotations

import unittest

from campus_ingestion_core.readable_text_normalization import normalize_readable_text

from .handbook_cleanup_test_support import *


class HandbookCleanupFormAndHeaderFilterTest(unittest.TestCase):
    def test_cleanup_drops_running_header_only_policy_page_before_articles(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    244,
                    "heading",
                    "中央民族大学助学贷款管理暂行办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(244, "paragraph", "民大校发[2012]358号"),
                _source_row(244, "paragraph", "第五章 贷款还款"),
                _source_row(244, "paragraph", "学生手册"),
                _source_row(244, "paragraph", "第九条 贷款学生应严格按贷款合同履行还贷义务。"),
            ],
            manifest_document=_manifest_document(
                244,
                244,
                title="中央民族大学助学贷款管理暂行办法",
                handbook_section="中央民族大学学生资助管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual([row["unit_type"] for row in result.document_units], ["article_body"])
        self.assertNotIn("学生手册", result.document_units[0]["clean_text"])

    def test_cleanup_drops_running_header_line_inside_article_body(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    177,
                    "heading",
                    "中央民族大学本科学生国家奖学金评审办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(177, "paragraph", "第九条 参评本科学生国家奖学金还须具备以下条件之一:"),
                _source_row(
                    177,
                    "paragraph",
                    "(一)学习成绩优异,所评学年学习成绩排名与综合测评排名均位于前10%以内。",
                ),
                _source_row(177, "paragraph", "学生手册"),
                _source_row(
                    177, "paragraph", "(二) 学习成绩排名或综合测评排名超出前10%,但均位于前30%。"
                ),
            ],
            manifest_document=_manifest_document(
                177,
                177,
                title="中央民族大学本科学生国家奖学金评审办法",
                handbook_section="中央民族大学学生奖励管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual([row["unit_type"] for row in result.document_units], ["article_body"])
        self.assertNotIn("学生手册", result.document_units[0]["clean_text"])
        self.assertIn(
            "(二) 学习成绩排名或综合测评排名超出前10%,但均位于前30%。",
            result.document_units[0]["clean_text"],
        )

    def test_cleanup_drops_appendix_header_only_policy_page_before_tables(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    214,
                    "heading",
                    "中央民族大学本科生家庭经济困难学生认定管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(214, "paragraph", "民大校发[2013]154号"),
                _source_row(214, "paragraph", "附件："),
                _source_row(214, "paragraph", "中央民族大学本科生家庭经济困难学生认定申请表"),
                _source_row(214, "paragraph", "中央民族大学本科学生及家庭情况调查表"),
                _source_row(214, "paragraph", "中央民族大学本科生家庭经济困难学生认定统计表"),
                _source_row(214, "paragraph", "学生手册"),
                _source_row(
                    214,
                    "table",
                    "<table></table>",
                    block_role="table",
                    html="<table><tr><td>姓名</td><td>院系</td></tr><tr><td>张三</td><td>文学院</td></tr></table>",
                    table_cells=[["姓名", "院系"], ["张三", "文学院"]],
                ),
            ],
            manifest_document=_manifest_document(
                214,
                214,
                title="中央民族大学本科生家庭经济困难学生认定管理办法",
                handbook_section="中央民族大学学生资助管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual(
            [row["unit_type"] for row in result.document_units],
            ["table", "table_unit"],
        )

    def test_cleanup_removes_form_placeholder_percent_artifacts_from_family_survey_table(
        self,
    ) -> None:
        table_html = (
            "<table><tr><td>影响家庭经济状况有关信息</td>"
            "<td>家庭人均年收入 (元)。学生本学年已获资助情况 0.00%。"
            "家庭遭受自然灾害情况: 0.00%。家庭遭受突发意外事件: 0.00%。"
            "家庭成员因残疾、年迈而劳动能力弱情况: 0.00%。"
            "家庭成员失业情况: 0.00%。家庭欠债情况: 0.00%。"
            "其他情况: 0.00%。</td></tr></table>"
        )

        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    214,
                    "heading",
                    "中央民族大学本科生家庭经济困难学生认定管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(214, "paragraph", "附表二:中央民族大学本科学生及家庭情况调查表"),
                _source_row(
                    214,
                    "table",
                    table_html,
                    block_role="table",
                    html=table_html,
                    table_cells=[
                        [
                            "影响家庭经济状况有关信息",
                            (
                                "家庭人均年收入 (元)。学生本学年已获资助情况 0.00%。"
                                "家庭遭受自然灾害情况: 0.00%。家庭遭受突发意外事件: 0.00%。"
                                "家庭成员因残疾、年迈而劳动能力弱情况: 0.00%。"
                                "家庭成员失业情况: 0.00%。家庭欠债情况: 0.00%。"
                                "其他情况: 0.00%。"
                            ),
                        ],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                214,
                214,
                title="中央民族大学本科生家庭经济困难学生认定管理办法",
                handbook_section="中央民族大学学生资助管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        table_unit = next(row for row in result.document_units if row["unit_type"] == "table")
        self.assertNotIn("0.00%", result.canonical_markdown)
        self.assertNotIn("0.00%", table_unit["clean_text"])
        self.assertNotIn("0.00%", str(table_unit.get("html") or ""))
        self.assertIn("学生本学年已获资助情况。", result.canonical_markdown)
        self.assertIn("家庭遭受自然灾害情况。", result.canonical_markdown)

    def test_cleanup_keeps_student_card_second_clause_from_multiline_list_item(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    163,
                    "heading",
                    "中央民族大学本科(预科)学生证管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    163,
                    "paragraph",
                    "为了加强我校学生的学生证管理,规范学生证办理使用工作程序,根据国家关于高等学校学生证管理的有关要求,结合学校实际,制定本办法。",
                ),
                _source_row(
                    163,
                    "list_item",
                    "\n".join(
                        (
                            "一、凡取得我校正式学籍的本科(预科)学生,均由学校统一发放学生证。",
                            "二、学生证是学生的身份证明,学生应妥善保管,爱护使用,谨防丢失。",
                            "三、学生证只限本人使用,不得转借他人。",
                        )
                    ),
                ),
                _source_row(
                    165,
                    "table",
                    "<table><tr><td>姓名</td><td></td></tr></table>",
                    block_role="table",
                    html="<table><tr><td>姓名</td><td></td></tr></table>",
                    table_cells=[["姓名", ""]],
                ),
            ],
            manifest_document=_manifest_document(
                163,
                165,
                title="中央民族大学本科(预科)学生证管理办法",
                handbook_section="中央民族大学学生日常管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertIn(
            "二、学生证是学生的身份证明，学生应妥善保管，爱护使用，谨防丢失。",
            result.canonical_markdown,
        )
        self.assertNotIn("## 二、学生证是", result.canonical_markdown)

    def test_cleanup_keeps_student_card_final_explanation_clause_as_body_text(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    163,
                    "heading",
                    "中央民族大学本科(预科)学生证管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    163,
                    "paragraph",
                    "为了加强我校学生的学生证管理,规范学生证办理使用工作程序,根据国家关于高等学校学生证管理的有关要求,结合学校实际,制定本办法。",
                ),
                _source_row(
                    163,
                    "list_item",
                    "\n".join(
                        (
                            "一、凡取得我校正式学籍的本科(预科)学生,均由学校统一发放学生证。",
                            "二、学生证是学生的身份证明,学生应妥善保管,爱护使用,谨防丢失。",
                            "三、学生证只限本人使用,不得转借他人。",
                            "十七、学生使用的学生证,只能由学生处统一制作、发放和管理。",
                        )
                    ),
                ),
                _source_row(
                    164,
                    "paragraph",
                    "十八、本办法由学生处负责解释。",
                ),
            ],
            manifest_document=_manifest_document(
                163,
                164,
                title="中央民族大学本科(预科)学生证管理办法",
                handbook_section="中央民族大学学生日常管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        canonical = result.canonical_markdown
        self.assertIn("十八、本办法由学生处负责解释。", canonical)
        self.assertNotIn("## 十八、本办法由学生处负责解释", canonical)
        terminal_unit = result.document_units[-1]
        self.assertEqual(terminal_unit["unit_type"], "policy_page")
        self.assertEqual(terminal_unit["anchor"]["provision_label"], "十八")
        self.assertEqual(terminal_unit["anchor"]["section_path"], [])

    def test_cleanup_keeps_known_punctuationless_final_numbered_clause_headings(self) -> None:
        cases = (
            (
                "中央民族大学关于加强学生宿舍电器使用管理的规定",
                "五、本规定自公布之日起实施",
            ),
            (
                "中央民族大学学生课堂行为规范及课堂秩序管理办法",
                "四、本办法由学生工作部(处)负责解释",
            ),
        )
        for title, final_heading in cases:
            with self.subTest(title=title):
                result = cleanup_handbook_document(
                    structured_rows=[
                        _source_row(
                            1,
                            "heading",
                            title,
                            block_role="title",
                            title_candidate_score=1.0,
                        ),
                        _source_row(1, "paragraph", "正文内容。"),
                        _source_row(
                            1,
                            "heading",
                            final_heading,
                            block_role="heading",
                            title_candidate_score=0.8,
                        ),
                    ],
                    manifest_document=_manifest_document(
                        1,
                        1,
                        title=title,
                        handbook_section="中央民族大学学生日常管理规定",
                    ),
                    source_doc="学生手册_2018.pdf",
                )

                self.assertIn(
                    f"## {normalize_readable_text(final_heading)}",
                    result.canonical_markdown,
                )

    def test_cleanup_preserves_article_table_interleaving_for_credit_reward_rules(
        self,
    ) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    32,
                    "heading",
                    "中央民族大学本科学分制实施办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(32, "paragraph", "第三章 创新奖励学分"),
                _source_row(32, "paragraph", "第十一条 创新奖励学分评分标准"),
                _source_row(
                    32,
                    "list_item",
                    "1. 每项创新成果一般奖励 0.5-4 个学分。具体评定时可参照下列条款进行:\n"
                    "(1)学生在学术期刊发表论文奖励学分标准:",
                ),
                _source_row(
                    32,
                    "table",
                    "<table><tr><td>作者排名</td><td>国际刊号ISSN</td></tr>"
                    "<tr><td>独立完成</td><td>4</td></tr></table>",
                    block_role="table",
                    html="<table><tr><td>作者排名</td><td>国际刊号ISSN</td></tr>"
                    "<tr><td>独立完成</td><td>4</td></tr></table>",
                    table_cells=[["作者排名", "国际刊号ISSN"], ["独立完成", "4"]],
                ),
                _source_row(32, "list_item", "(2)学生参加科研课题奖励学分标准:"),
                _source_row(
                    32,
                    "table",
                    "<table><tr><td>排名</td><td>国家级</td></tr>"
                    "<tr><td>第一</td><td>4</td></tr></table>",
                    block_role="table",
                    html="<table><tr><td>排名</td><td>国家级</td></tr>"
                    "<tr><td>第一</td><td>4</td></tr></table>",
                    table_cells=[["排名", "国家级"], ["第一", "4"]],
                ),
                _source_row(33, "list_item", "2. 各类活动的纪念奖不能申报创新奖励学分。"),
                _source_row(33, "paragraph", "第十二条 创新奖励学分的指标应列入奖学金评比条款。"),
            ],
            manifest_document=_manifest_document(
                32,
                33,
                title="中央民族大学本科学分制实施办法",
                handbook_section="中央民族大学学生教学管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        canonical = result.canonical_markdown
        self.assertLess(canonical.index("### 第十一条"), canonical.index("作者排名"))
        self.assertLess(
            canonical.index("（1）学生在学术期刊发表论文奖励学分标准："),
            canonical.index("作者排名"),
        )
        self.assertLess(
            canonical.index("作者排名"), canonical.index("（2）学生参加科研课题奖励学分标准：")
        )
        research_table_index = canonical.index("<td>排名</td><td>国家级</td>")
        self.assertLess(
            canonical.index("（2）学生参加科研课题奖励学分标准："), research_table_index
        )
        self.assertLess(
            research_table_index,
            canonical.index("2. 各类活动的纪念奖不能申报创新奖励学分。"),
        )
        self.assertLess(
            canonical.index("2. 各类活动的纪念奖不能申报创新奖励学分。"),
            canonical.index("### 第十二条"),
        )
        self.assertEqual(canonical.count("### 第十一条"), 1)
        article_units = [row for row in result.document_units if row["unit_type"] == "article_body"]
        self.assertTrue(
            all(row["anchor"]["article_label"] == "第十一条" for row in article_units[:3])
        )

    def test_cleanup_attaches_form_cover_line_to_following_table_instead_of_policy_page(
        self,
    ) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    162,
                    "heading",
                    "中央民族大学学院(系)学生基本情况周查月报制度",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(162, "paragraph", "民大校发[2016]201号"),
                _source_row(162, "paragraph", "附件1:"),
                _source_row(162, "paragraph", "1:《中央民族大学本(预)科生基本情况周查月报表》"),
                _source_row(
                    162,
                    "paragraph",
                    "学生手册中央民族大学本(预)科生基本情况周查月报表报送时间:年 月 日",
                ),
                _source_row(
                    162,
                    "table",
                    "<table></table>",
                    block_role="table",
                    html="<table><tr><td>学院</td><td>班级</td></tr><tr><td>文学院</td><td>2022级1班</td></tr></table>",
                    table_cells=[["学院", "班级"], ["文学院", "2022级1班"]],
                ),
            ],
            manifest_document=_manifest_document(
                162,
                162,
                title="中央民族大学学院(系)学生基本情况周查月报制度",
                handbook_section="中央民族大学学生管理制度",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual(
            [row["unit_type"] for row in result.document_units], ["table", "table_unit"]
        )
        table_unit = next(row for row in result.document_units if row["unit_type"] == "table_unit")
        self.assertIn("周查月报表报送时间", table_unit["anchor"]["table_context"])

    def test_cleanup_keeps_weekly_report_checklist_items_in_body(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    160,
                    "heading",
                    "中央民族大学学院(系)学生基本情况周查月报制度",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(160, "paragraph", "民大校发[2016]201号"),
                _source_row(160, "paragraph", "一、周查月报的主要内容"),
                _source_row(160, "paragraph", "(一)有无日常考勤异常学生。"),
                _source_row(160, "heading", "(二)有无学籍状态异常学生"),
                _source_row(160, "paragraph", "(三)有无违纪违法学生。"),
                _source_row(160, "heading", "(四)有无心理健康状况异常学生"),
                _source_row(160, "heading", "(五)其他需要报告的学生事务管理相关重要事项"),
                _source_row(160, "paragraph", "二、周查月报的基本程序"),
                _source_row(160, "paragraph", "(一)辅导员每周报送。"),
            ],
            manifest_document=_manifest_document(
                160,
                160,
                title="中央民族大学学院(系)学生基本情况周查月报制度",
                handbook_section="中央民族大学学生日常管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertIn("## 一、周查月报的主要内容", result.canonical_markdown)
        self.assertIn("（二）有无学籍状态异常学生", result.canonical_markdown)
        self.assertIn("（四）有无心理健康状况异常学生", result.canonical_markdown)
        self.assertIn("（五）其他需要报告的学生事务管理相关重要事项", result.canonical_markdown)
        self.assertIn("## 二、周查月报的基本程序", result.canonical_markdown)
        self.assertNotIn("## (二)有无学籍状态异常学生", result.canonical_markdown)
        self.assertNotIn("## (四)有无心理健康状况异常学生", result.canonical_markdown)
        self.assertNotIn(
            "## (五)其他需要报告的学生事务管理相关重要事项",
            result.canonical_markdown,
        )

    def test_cleanup_reattaches_split_appendix_label_to_weekly_report_form_title(
        self,
    ) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    162,
                    "heading",
                    "中央民族大学学院(系)学生基本情况周查月报制度",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(162, "paragraph", "民大校发[2016]201号"),
                _source_row(162, "paragraph", "四、相关说明"),
                _source_row(162, "paragraph", "附件1:"),
                _source_row(162, "paragraph", "1:《中央民族大学本(预)科生基本情况周查月报表》"),
                _source_row(
                    162,
                    "table",
                    "<table></table>",
                    block_role="table",
                    html="<table><tr><td>学院</td><td>班级</td></tr><tr><td>文学院</td><td>2022级1班</td></tr></table>",
                    table_cells=[["学院", "班级"], ["文学院", "2022级1班"]],
                ),
            ],
            manifest_document=_manifest_document(
                162,
                162,
                title="中央民族大学学院(系)学生基本情况周查月报制度",
                handbook_section="中央民族大学学生管理制度",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertIn(
            "## 附件1：中央民族大学本（预）科生基本情况周查月报表",
            result.canonical_markdown,
        )
        self.assertNotIn(
            "## 1:《中央民族大学本(预)科生基本情况周查月报表》", result.canonical_markdown
        )
        table_unit = next(row for row in result.document_units if row["unit_type"] == "table_unit")
        self.assertEqual(
            table_unit["anchor"]["section_path"],
            ["四、相关说明", "附件1:中央民族大学本(预)科生基本情况周查月报表"],
        )

    def test_cleanup_deduplicates_weekly_report_inline_and_repeated_appendix_cover(
        self,
    ) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    161,
                    "heading",
                    "中央民族大学学院(系)学生基本情况周查月报制度",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(161, "paragraph", "民大校发[2016]201号"),
                _source_row(161, "paragraph", "四、相关说明"),
                _source_row(161, "paragraph", "附件1:《中央民族大学本(预)科生基本情况周查月报表》"),
                _source_row(162, "paragraph", "附表1:"),
                _source_row(162, "heading", "中央民族大学本(预)科生基本情况周查月报表"),
                _source_row(162, "paragraph", "学生手册"),
                _source_row(
                    162,
                    "table",
                    "<table></table>",
                    block_role="table",
                    html="<table><tr><td>学院</td><td>班级</td></tr><tr><td>文学院</td><td>2022级1班</td></tr></table>",
                    table_cells=[["学院", "班级"], ["文学院", "2022级1班"]],
                ),
            ],
            manifest_document=_manifest_document(
                161,
                162,
                title="中央民族大学学院(系)学生基本情况周查月报制度",
                handbook_section="中央民族大学学生管理制度",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual(
            result.canonical_markdown.count("## 附件1：中央民族大学本（预）科生基本情况周查月报表"),
            1,
        )
        self.assertNotIn(
            "## 1:《中央民族大学本(预)科生基本情况周查月报表》", result.canonical_markdown
        )
        self.assertNotIn(
            "## 附表1:中央民族大学本(预)科生基本情况周查月报表",
            result.canonical_markdown,
        )
        table_unit = next(row for row in result.document_units if row["unit_type"] == "table_unit")
        self.assertEqual(
            table_unit["anchor"]["section_path"],
            ["四、相关说明", "附件1:中央民族大学本(预)科生基本情况周查月报表"],
        )

    def test_cleanup_binds_consecutive_appendix_form_titles_to_following_tables(
        self,
    ) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    213,
                    "heading",
                    "中央民族大学本科生家庭经济困难学生认定管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(213, "paragraph", "民大校发[2019]1号"),
                _source_row(213, "paragraph", "第五章 附则"),
                _source_row(213, "paragraph", "附表一:"),
                _source_row(213, "paragraph", "《中央民族大学本科生家庭经济困难学生认定申请表》"),
                _source_row(213, "paragraph", "附表二:"),
                _source_row(213, "paragraph", "《中央民族大学本科学生及家庭情况调查表》"),
                _source_row(213, "paragraph", "附表三:"),
                _source_row(213, "paragraph", "《中央民族大学本科生家庭经济困难学生认定统计表》"),
                _source_row(
                    214,
                    "table",
                    "<table><tr><td>学生陈述申请认定理由</td></tr></table>",
                    block_role="table",
                    html="<table><tr><td>学生陈述申请认定理由</td></tr></table>",
                    table_cells=[["学生陈述申请认定理由"]],
                ),
                _source_row(
                    215,
                    "table",
                    "<table><tr><td>家庭成员情况</td></tr></table>",
                    block_role="table",
                    html="<table><tr><td>家庭成员情况</td></tr></table>",
                    table_cells=[["家庭成员情况"]],
                ),
                _source_row(
                    216,
                    "table",
                    "<table><tr><td>序号</td></tr></table>",
                    block_role="table",
                    html="<table><tr><td>序号</td></tr></table>",
                    table_cells=[["序号"]],
                ),
            ],
            manifest_document=_manifest_document(
                213,
                216,
                title="中央民族大学本科生家庭经济困难学生认定管理办法",
                handbook_section="中央民族大学学生资助管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        canonical = result.canonical_markdown
        first_heading_index = canonical.index(
            "## 附表一：中央民族大学本科生家庭经济困难学生认定申请表"
        )
        first_table_index = canonical.index("学生陈述申请认定理由")
        second_heading_index = canonical.index("## 附表二：中央民族大学本科学生及家庭情况调查表")
        second_table_index = canonical.index("家庭成员情况")
        third_heading_index = canonical.index(
            "## 附表三：中央民族大学本科生家庭经济困难学生认定统计表"
        )
        third_table_index = canonical.index("序号")
        self.assertLess(first_heading_index, first_table_index)
        self.assertLess(first_table_index, second_heading_index)
        self.assertLess(second_heading_index, second_table_index)
        self.assertLess(second_table_index, third_heading_index)
        self.assertLess(third_heading_index, third_table_index)

        table_rows = [row for row in result.document_units if row["unit_type"] == "table"]
        self.assertEqual(
            [row["anchor"]["section_path"][-1] for row in table_rows],
            [
                "附表一:中央民族大学本科生家庭经济困难学生认定申请表",
                "附表二:中央民族大学本科学生及家庭情况调查表",
                "附表三:中央民族大学本科生家庭经济困难学生认定统计表",
            ],
        )

    def test_cleanup_drops_running_header_prefix_when_form_cover_repeats_attachment_title(
        self,
    ) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    162,
                    "heading",
                    "中央民族大学学院(系)学生基本情况周查月报制度",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(162, "paragraph", "民大校发[2016]201号"),
                _source_row(162, "paragraph", "四、相关说明"),
                _source_row(162, "paragraph", "1:《中央民族大学本(预)科生基本情况周查月报表》"),
                _source_row(162, "paragraph", "学生手册中央民族大学本(预)科生基本情况周查月报表"),
                _source_row(
                    162,
                    "table",
                    "<table></table>",
                    block_role="table",
                    html="<table><tr><td>学院</td><td>班级</td></tr><tr><td>文学院</td><td>2022级1班</td></tr></table>",
                    table_cells=[["学院", "班级"], ["文学院", "2022级1班"]],
                ),
            ],
            manifest_document=_manifest_document(
                162,
                162,
                title="中央民族大学学院(系)学生基本情况周查月报制度",
                handbook_section="中央民族大学学生管理制度",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertFalse(any(row["unit_type"] == "policy_page" for row in result.document_units))
        table_unit = next(row for row in result.document_units if row["unit_type"] == "table_unit")
        self.assertEqual(
            table_unit["anchor"]["section_path"],
            ["四、相关说明", "1:《中央民族大学本(预)科生基本情况周查月报表》"],
        )
        self.assertNotIn(
            "学生手册中央民族大学本(预)科生基本情况周查月报表", result.canonical_markdown
        )

    def test_cleanup_merges_split_group_label_before_repeated_rowspan_block(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    162,
                    "heading",
                    "中央民族大学学院(系)学生基本情况周查月报制度",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(162, "paragraph", "附件1:"),
                _source_row(
                    162, "paragraph", "中央民族大学本(预)科生基本情况周查月报表报送时间:年 月 日"
                ),
                _source_row(
                    162,
                    "table",
                    "表格文本",
                    block_role="table",
                    table_cells=[
                        ["类型", "原因", "学生基本信息(姓名、学号、起止时间)"],
                        ["有无日常", "本学期内未经请假擅自离校累计超过3天(含)", ""],
                        ["考勤异常学生", "请假逾期未归超过3天(含)", ""],
                        ["考勤异常学生", "本学期内累计旷课达16节", ""],
                        ["考勤异常学生", "其他需报告的重要情况", ""],
                        ["有无学籍状态异常学生", "休学期满逾期未办理复学手续", ""],
                        ["有无学籍状态异常学生", "开学两周后未注册且无正当理由", ""],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                162, 162, title="中央民族大学学院(系)学生基本情况周查月报制度"
            ),
            source_doc="学生手册_2018.pdf",
        )

        table_unit = next(row for row in result.document_units if row["unit_type"] == "table_unit")
        self.assertEqual(
            table_unit["metadata"]["table_row_lines"][0],
            "有无日常考勤异常学生 | 本学期内未经请假擅自离校累计超过3天(含) | ",
        )
        self.assertEqual(
            table_unit["metadata"]["table_row_lines"][1:],
            [
                "考勤异常学生 | 请假逾期未归超过3天(含) | ",
                "考勤异常学生 | 本学期内累计旷课达16节 | ",
                "考勤异常学生 | 其他需报告的重要情况 | ",
                "有无学籍状态异常学生 | 休学期满逾期未办理复学手续 | ",
                "有无学籍状态异常学生 | 开学两周后未注册且无正当理由 | ",
            ],
        )

    def test_cleanup_skips_form_like_attachment_table_unit(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    22,
                    "heading",
                    "中央民族大学本科生国家助学金评审办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    22,
                    "table",
                    "表格文本",
                    block_role="table",
                    table_cells=[
                        ["本人情况", "姓名", "性别", "照片"],
                        ["本人情况", "学号", "院系", "照片"],
                        ["家庭经济情况", "家庭住址", "", "邮政编码"],
                        ["家庭经济情况", "", "", ""],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                22, 22, title="中央民族大学本科生国家助学金评审办法"
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertTrue(any(row["unit_type"] == "table" for row in result.document_units))
        self.assertFalse(any(row["unit_type"] == "table_unit" for row in result.document_units))

    def test_cleanup_skips_decorative_student_card_form_table_unit(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    22,
                    "heading",
                    "中央民族大学本科(预科)学生证管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    22,
                    "table",
                    "表格文本",
                    block_role="table",
                    table_cells=[
                        ["姓名 / 学号", "", "学院(系)领导签字 / 家庭所在地", "学院(系)领导签字"],
                        ["民族", "", "火车到站站名", ""],
                        ["学院(系)", "", "照片", "照片"],
                        ["专业", "", "照片", "照片"],
                        ["学制", "", "(请在照片背面加盖骑缝章)", "(请在照片背面加盖骑缝章)"],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                22, 22, title="中央民族大学本科(预科)学生证管理办法"
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertTrue(any(row["unit_type"] == "table" for row in result.document_units))
        self.assertFalse(any(row["unit_type"] == "table_unit" for row in result.document_units))

    def test_cleanup_skips_checkbox_dense_family_difficulty_form_table_unit(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    22,
                    "heading",
                    "中央民族大学本科生家庭经济困难学生认定管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(22, "paragraph", "附件一:"),
                _source_row(22, "paragraph", "中央民族大学本科生家庭经济困难学生认定申请表"),
                _source_row(
                    22,
                    "table",
                    "表格文本",
                    block_role="table",
                    table_cells=[
                        [
                            "学生本人基本情况",
                            "姓名 / 身份证号码",
                            "性别 / 政治面貌",
                            "性别 / 政治面貌",
                            "出生年月 / 政治面貌",
                            "出生年月 / 家庭人均年收入",
                            "民族 / 元",
                        ],
                        ["学生本人基本情况", "学院", "系", "系", "系", "专业", ""],
                        [
                            "学生本人基本情况",
                            "年级",
                            "班",
                            "在校联系电话",
                            "在校联系电话",
                            "在校联系电话",
                            "在校联系电话",
                        ],
                        [
                            "学生陈述申请认定理由",
                            "学生签字: 年_月_日",
                            "学生签字: 年_月_日",
                            "学生签字: 年_月_日",
                            "学生签字: 年_月_日",
                            "学生签字: 年_月_日",
                            "学生签字: 年_月_日",
                        ],
                        [
                            "民主评议",
                            "推荐档次",
                            "A.家庭经济特别困难 ☐",
                            "A.家庭经济特别困难 ☐",
                            "",
                            "",
                            "",
                        ],
                        [
                            "民主评议",
                            "推荐档次",
                            "B.家庭经济困难 ☐",
                            "B.家庭经济困难 ☐",
                            "陈述理由",
                            "",
                            "",
                        ],
                        [
                            "民主评议",
                            "推荐档次",
                            "C.家庭经济不困难 ☐",
                            "C.家庭经济不困难 ☐",
                            "班长签字:",
                            "年_月_日",
                            "年_月_日",
                        ],
                        [
                            "认定决定",
                            "经班级评议小组推荐、本院系认真审核后,☐同意评议小组意见。☐不同意评议小组意见。调整为☐意见, ☐ ☐ ☐ ☐ ☐ ☐ ☐ ☐ ☐ ☐ ☐ ☐ ☐ ☐",
                            "",
                            "",
                            "",
                            "",
                            "",
                        ],
                        [
                            "报送日期:",
                            "报送日期:",
                            "报送日期:",
                            "报送日期:",
                            "报送日期:",
                            "报送日期:",
                            "报送日期:",
                        ],
                        [
                            "本人联系电话",
                            "家庭经济详细情况(贫困原因)",
                            "家庭经济详细情况(贫困原因)",
                            "家庭经济详细情况(贫困原因)",
                            "家庭经济详细情况(贫困原因)",
                            "家庭经济详细情况(贫困原因)",
                            "家庭经济详细情况(贫困原因)",
                        ],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                22, 22, title="中央民族大学本科生家庭经济困难学生认定管理办法"
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertTrue(any(row["unit_type"] == "table" for row in result.document_units))
        self.assertFalse(any(row["unit_type"] == "table_unit" for row in result.document_units))

    def test_cleanup_skips_repeated_contact_summary_form_table_unit(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    22,
                    "heading",
                    "中央民族大学本科生家庭经济困难学生认定管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(22, "paragraph", "附件三:"),
                _source_row(22, "paragraph", "中央民族大学家庭经济困难学生认定统计表"),
                _source_row(
                    22,
                    "table",
                    "表格文本",
                    block_role="table",
                    table_cells=[
                        [
                            "报送日期:",
                            "报送日期:",
                            "报送日期:",
                            "报送日期:",
                            "报送日期:",
                            "报送日期:",
                        ],
                        [
                            "本人联系电话",
                            "家庭经济详细情况(贫困原因)",
                            "家庭经济详细情况(贫困原因)",
                            "家庭经济详细情况(贫困原因)",
                            "家庭经济详细情况(贫困原因)",
                            "家庭经济详细情况(贫困原因)",
                        ],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                22, 22, title="中央民族大学本科生家庭经济困难学生认定管理办法"
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertTrue(any(row["unit_type"] == "table" for row in result.document_units))
        self.assertFalse(any(row["unit_type"] == "table_unit" for row in result.document_units))

    def test_cleanup_skips_signature_header_statistics_form_table_unit(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    22,
                    "heading",
                    "中央民族大学本科生家庭经济困难学生认定管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(22, "paragraph", "附件三:"),
                _source_row(22, "paragraph", "中央民族大学家庭经济困难学生认定统计表"),
                _source_row(
                    22,
                    "table",
                    "表格文本",
                    block_role="table",
                    table_cells=[
                        ["院系盖章:", "评议小组组长签字:", "院系领导签字:", "报送日期:"],
                        [
                            "序号",
                            "姓名",
                            "性别",
                            "民族",
                            "学号",
                            "院系",
                            "生源地",
                            "认定结果",
                            "户口类型",
                            "是否残疾",
                            "是否单亲",
                            "是否孤儿",
                            "是否低保户",
                            "本人联系电话",
                            "家庭经济详细情况(贫困原因)",
                        ],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                22, 22, title="中央民族大学本科生家庭经济困难学生认定管理办法"
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertTrue(any(row["unit_type"] == "table" for row in result.document_units))
        self.assertFalse(any(row["unit_type"] == "table_unit" for row in result.document_units))
