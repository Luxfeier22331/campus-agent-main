from .handbook_cleanup_form_and_header_filter_support import *


class HandbookCleanupFormAppendixTest(HandbookCleanupFormAndHeaderFilterBaseTest):
    def test_cleanup_preserves_article_table_interleaving_for_credit_reward_rules(
        self,
    ) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    32,
                    "heading",
                    "示例大学本科学分制实施办法",
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
                title="示例大学本科学分制实施办法",
                handbook_section="示例大学学生教学管理规定",
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
                    "示例大学学院(系)学生基本情况周查月报制度",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(162, "paragraph", "民大校发[2016]201号"),
                _source_row(162, "paragraph", "附件1:"),
                _source_row(162, "paragraph", "1:《示例大学本(预)科生基本情况周查月报表》"),
                _source_row(
                    162,
                    "paragraph",
                    "学生手册示例大学本(预)科生基本情况周查月报表报送时间:年 月 日",
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
                title="示例大学学院(系)学生基本情况周查月报制度",
                handbook_section="示例大学学生管理制度",
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
                    "示例大学学院(系)学生基本情况周查月报制度",
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
                title="示例大学学院(系)学生基本情况周查月报制度",
                handbook_section="示例大学学生日常管理规定",
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
                    "示例大学学院(系)学生基本情况周查月报制度",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(162, "paragraph", "民大校发[2016]201号"),
                _source_row(162, "paragraph", "四、相关说明"),
                _source_row(162, "paragraph", "附件1:"),
                _source_row(162, "paragraph", "1:《示例大学本(预)科生基本情况周查月报表》"),
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
                title="示例大学学院(系)学生基本情况周查月报制度",
                handbook_section="示例大学学生管理制度",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertIn(
            "## 附件1：示例大学本（预）科生基本情况周查月报表",
            result.canonical_markdown,
        )
        self.assertNotIn("## 1:《示例大学本(预)科生基本情况周查月报表》", result.canonical_markdown)
        table_unit = next(row for row in result.document_units if row["unit_type"] == "table_unit")
        self.assertEqual(
            table_unit["anchor"]["section_path"],
            ["四、相关说明", "附件1:示例大学本(预)科生基本情况周查月报表"],
        )

    def test_cleanup_deduplicates_weekly_report_inline_and_repeated_appendix_cover(
        self,
    ) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    161,
                    "heading",
                    "示例大学学院(系)学生基本情况周查月报制度",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(161, "paragraph", "民大校发[2016]201号"),
                _source_row(161, "paragraph", "四、相关说明"),
                _source_row(161, "paragraph", "附件1:《示例大学本(预)科生基本情况周查月报表》"),
                _source_row(162, "paragraph", "附表1:"),
                _source_row(162, "heading", "示例大学本(预)科生基本情况周查月报表"),
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
                title="示例大学学院(系)学生基本情况周查月报制度",
                handbook_section="示例大学学生管理制度",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertEqual(
            result.canonical_markdown.count("## 附件1：示例大学本（预）科生基本情况周查月报表"),
            1,
        )
        self.assertNotIn("## 1:《示例大学本(预)科生基本情况周查月报表》", result.canonical_markdown)
        self.assertNotIn(
            "## 附表1:示例大学本(预)科生基本情况周查月报表",
            result.canonical_markdown,
        )
        table_unit = next(row for row in result.document_units if row["unit_type"] == "table_unit")
        self.assertEqual(
            table_unit["anchor"]["section_path"],
            ["四、相关说明", "附件1:示例大学本(预)科生基本情况周查月报表"],
        )

    def test_cleanup_binds_consecutive_appendix_form_titles_to_following_tables(
        self,
    ) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    213,
                    "heading",
                    "示例大学本科生家庭经济困难学生认定管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(213, "paragraph", "民大校发[2019]1号"),
                _source_row(213, "paragraph", "第五章 附则"),
                _source_row(213, "paragraph", "附表一:"),
                _source_row(213, "paragraph", "《示例大学本科生家庭经济困难学生认定申请表》"),
                _source_row(213, "paragraph", "附表二:"),
                _source_row(213, "paragraph", "《示例大学本科学生及家庭情况调查表》"),
                _source_row(213, "paragraph", "附表三:"),
                _source_row(213, "paragraph", "《示例大学本科生家庭经济困难学生认定统计表》"),
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
                title="示例大学本科生家庭经济困难学生认定管理办法",
                handbook_section="示例大学学生资助管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        canonical = result.canonical_markdown
        first_heading_index = canonical.index("## 附表一：示例大学本科生家庭经济困难学生认定申请表")
        first_table_index = canonical.index("学生陈述申请认定理由")
        second_heading_index = canonical.index("## 附表二：示例大学本科学生及家庭情况调查表")
        second_table_index = canonical.index("家庭成员情况")
        third_heading_index = canonical.index("## 附表三：示例大学本科生家庭经济困难学生认定统计表")
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
                "附表一:示例大学本科生家庭经济困难学生认定申请表",
                "附表二:示例大学本科学生及家庭情况调查表",
                "附表三:示例大学本科生家庭经济困难学生认定统计表",
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
                    "示例大学学院(系)学生基本情况周查月报制度",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(162, "paragraph", "民大校发[2016]201号"),
                _source_row(162, "paragraph", "四、相关说明"),
                _source_row(162, "paragraph", "1:《示例大学本(预)科生基本情况周查月报表》"),
                _source_row(162, "paragraph", "学生手册示例大学本(预)科生基本情况周查月报表"),
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
                title="示例大学学院(系)学生基本情况周查月报制度",
                handbook_section="示例大学学生管理制度",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertFalse(any(row["unit_type"] == "policy_page" for row in result.document_units))
        table_unit = next(row for row in result.document_units if row["unit_type"] == "table_unit")
        self.assertEqual(
            table_unit["anchor"]["section_path"],
            ["四、相关说明", "1:《示例大学本(预)科生基本情况周查月报表》"],
        )
        self.assertNotIn("学生手册示例大学本(预)科生基本情况周查月报表", result.canonical_markdown)
