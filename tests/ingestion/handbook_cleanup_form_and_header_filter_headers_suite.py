from .handbook_cleanup_form_and_header_filter_support import *


class HandbookCleanupFormHeaderRemovalTest(HandbookCleanupFormAndHeaderFilterBaseTest):
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
