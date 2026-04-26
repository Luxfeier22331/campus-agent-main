from .handbook_cleanup_form_and_header_filter_support import *


class HandbookCleanupFormTableSkipTest(HandbookCleanupFormAndHeaderFilterBaseTest):
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
