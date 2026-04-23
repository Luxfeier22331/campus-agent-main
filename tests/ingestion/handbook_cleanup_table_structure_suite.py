from __future__ import annotations

import unittest

from .handbook_cleanup_test_support import *


class HandbookCleanupTableStructureTest(unittest.TestCase):
    def test_cleanup_excludes_table_cells_from_body_clean_text(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    12,
                    "heading",
                    "中央民族大学奖学金评定办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(12, "paragraph", "第一条 奖学金评定坚持公开、公平、公正。"),
                _source_row(
                    12,
                    "table",
                    "项目 | 说明",
                    block_role="table",
                    table_cells=[["项目", "说明"], ["等级", "一等奖"]],
                    html="<table><tr><td>项目</td><td>说明</td></tr></table>",
                ),
            ],
            manifest_document=_manifest_document(
                12,
                12,
                title="中央民族大学奖学金评定办法",
                handbook_section="中央民族大学学生奖励管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        article_units = [row for row in result.document_units if row["unit_type"] == "article_body"]
        table_units = [row for row in result.document_units if row["unit_type"] == "table"]

        self.assertEqual(len(article_units), 1)
        self.assertEqual(len(table_units), 1)
        self.assertNotIn("等级", article_units[0]["clean_text"])
        self.assertEqual(table_units[0]["table_cells"], [["项目", "说明"], ["等级", "一等奖"]])

    def test_cleanup_builds_table_unit_from_rowspan_html(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    20,
                    "heading",
                    "中央民族大学校内常用电话",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    20,
                    "table",
                    "<table></table>",
                    block_role="table",
                    html=(
                        "<table>"
                        "<tr><td>单位名称</td><td>电话号码</td><td>单位名称</td><td>电话号码</td></tr>"
                        '<tr><td rowspan="2">校园110</td><td rowspan="2">68932220</td><td>研究生院(学位办)</td><td></td></tr>'
                        "<tr><td>办公室</td><td>68932649</td></tr>"
                        "</table>"
                    ),
                    table_cells=[
                        ["单位名称", "电话号码", "单位名称", "电话号码"],
                        ["校园110", "68932220", "研究生院(学位办)"],
                        ["办公室", "68932649"],
                    ],
                ),
            ],
            manifest_document=_manifest_document(20, 20, title="中央民族大学校内常用电话"),
            source_doc="学生手册_2018.pdf",
        )

        table_unit = next(row for row in result.document_units if row["unit_type"] == "table_unit")
        self.assertEqual(
            table_unit["metadata"]["table_row_lines"],
            [
                "校园110 | 68932220 | 研究生院(学位办) | ",
                "校园110 | 68932220 | 办公室 | 68932649",
            ],
        )

    def test_cleanup_pads_table_unit_rows_to_header_width(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    21,
                    "heading",
                    "中央民族大学校内常用电话",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    21,
                    "table",
                    "表格文本",
                    block_role="table",
                    table_cells=[
                        ["单位名称", "电话号码", "单位名称", "电话号码"],
                        ["学生处(学生工作部)", "保卫武装部"],
                    ],
                ),
            ],
            manifest_document=_manifest_document(21, 21, title="中央民族大学校内常用电话"),
            source_doc="学生手册_2018.pdf",
        )

        table_unit = next(row for row in result.document_units if row["unit_type"] == "table_unit")
        self.assertEqual(
            table_unit["metadata"]["table_row_lines"],
            ["学生处(学生工作部) | 保卫武装部 |  | "],
        )

    def test_cleanup_builds_compound_header_line_for_table_unit_when_needed(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    22,
                    "heading",
                    "中央民族大学本科学生综合素质测评办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    22,
                    "table",
                    "表格文本",
                    block_role="table",
                    table_cells=[
                        ["奖项级别", "国家级", "国家级", "省部级", "省部级"],
                        ["奖项级别", "个人", "集体", "个人", "集体"],
                        ["第一名(一等奖)", "1.7", "1.5", "1.1", "1.1"],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                22, 22, title="中央民族大学本科学生综合素质测评办法"
            ),
            source_doc="学生手册_2018.pdf",
        )

        table_unit = next(row for row in result.document_units if row["unit_type"] == "table_unit")
        self.assertEqual(
            table_unit["metadata"]["table_header_line"],
            "奖项级别 | 国家级 / 个人 | 国家级 / 集体 | 省部级 / 个人 | 省部级 / 集体",
        )
        self.assertNotIn("列=", table_unit["clean_text"])

    def test_cleanup_infers_project_label_for_blank_first_table_header(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    22,
                    "heading",
                    "中央民族大学本科学生综合素质测评办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    22,
                    "table",
                    "表格文本",
                    block_role="table",
                    table_cells=[
                        ["", "具体测评内容和分值", "学生民主互评", "测评小组评定"],
                        ["思想政治表现(30分)", "拥护党的领导", "", ""],
                        ["学习态度(20分)", "刻苦钻研", "", ""],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                22, 22, title="中央民族大学本科学生综合素质测评办法"
            ),
            source_doc="学生手册_2018.pdf",
        )

        table_unit = next(row for row in result.document_units if row["unit_type"] == "table_unit")
        self.assertTrue(table_unit["metadata"]["table_header_line"].startswith("项目 | "))
        self.assertNotIn("未命名列", table_unit["clean_text"])

    def test_cleanup_attaches_table_anchor_to_current_article_context(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    23,
                    "heading",
                    "中央民族大学本科学生学籍管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    23,
                    "heading",
                    "第三章 考核与成绩记载",
                    block_role="heading",
                    title_candidate_score=0.8,
                ),
                _source_row(
                    23,
                    "paragraph",
                    "第十六条 为了反映学生学习的质和量，学校采用学分绩点的评定办法。",
                ),
                _source_row(23, "paragraph", "（一）考核成绩与绩点的关系："),
                _source_row(
                    23,
                    "table",
                    "等级 | 考核成绩 | 绩点数",
                    block_role="table",
                    table_cells=[
                        ["等级", "考核成绩", "绩点数"],
                        ["优", "90-100", "4.0-5.0"],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                23,
                23,
                title="中央民族大学本科学生学籍管理办法",
                handbook_section="中央民族大学学生教学管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        table_units = [row for row in result.document_units if row["unit_type"] == "table"]
        self.assertEqual(len(table_units), 1)
        self.assertEqual(table_units[0]["anchor"]["article_label"], "第十六条")
        self.assertEqual(table_units[0]["anchor"]["section_path"], ["第三章 考核与成绩记载"])
        self.assertEqual(table_units[0]["anchor"]["table_context"], "(一)考核成绩与绩点的关系:")

    def test_cleanup_attaches_table_unit_to_current_article_context(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    24,
                    "heading",
                    "中央民族大学本科学生学籍管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    24,
                    "heading",
                    "第三章 考核与成绩记载",
                    block_role="heading",
                    title_candidate_score=0.8,
                ),
                _source_row(
                    24,
                    "paragraph",
                    "第十六条 为了反映学生学习的质和量，学校采用学分绩点的评定办法。",
                ),
                _source_row(24, "paragraph", "（一）考核成绩与绩点的关系："),
                _source_row(
                    24,
                    "table",
                    "等级 | 考核成绩 | 绩点数",
                    block_role="table",
                    table_cells=[
                        ["等级", "考核成绩", "绩点数"],
                        ["优", "90-100", "4.0-5.0"],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                24,
                24,
                title="中央民族大学本科学生学籍管理办法",
                handbook_section="中央民族大学学生教学管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        table_unit = next(row for row in result.document_units if row["unit_type"] == "table_unit")
        self.assertEqual(table_unit["anchor"]["article_label"], "第十六条")
        self.assertEqual(table_unit["anchor"]["table_context"], "(一)考核成绩与绩点的关系:")

    def test_cleanup_attaches_sentence_style_table_context_when_following_table(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    79,
                    "heading",
                    "中央民族大学本科生境外留学管理办法",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    79,
                    "heading",
                    "第三章 学籍管理",
                    block_role="heading",
                    title_candidate_score=0.8,
                ),
                _source_row(79, "paragraph", "第十一条 课程、学分与成绩认定"),
                _source_row(
                    79, "heading", "(四)成绩认定", block_role="heading", title_candidate_score=0.7
                ),
                _source_row(
                    79,
                    "paragraph",
                    "1. 成绩认定采用对应原则,境外课程的成绩以学校百分制成绩、成绩等级、学分绩点相对应的方式进行认定。",
                ),
                _source_row(
                    80,
                    "paragraph",
                    "2. 境外课程以百分制记载的成绩,转换时仍按对方学校给出的百分制成绩认定。",
                ),
                _source_row(
                    80,
                    "paragraph",
                    "3. 境外课程以非百分制方式记载的成绩,按以下方式转换成我校百分制成绩予以认定。",
                ),
                _source_row(
                    80,
                    "table",
                    "等级 | 百分制",
                    block_role="table",
                    table_cells=[
                        ["等级", "百分制"],
                        ["A+", "95"],
                    ],
                ),
                _source_row(
                    80, "heading", "(五)认定程序", block_role="heading", title_candidate_score=0.7
                ),
            ],
            manifest_document=_manifest_document(
                79,
                80,
                title="中央民族大学本科生境外留学管理办法",
                handbook_section="中央民族大学学生教学管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        table_unit = next(row for row in result.document_units if row["unit_type"] == "table_unit")
        self.assertEqual(
            table_unit["anchor"]["table_context"],
            "3. 境外课程以非百分制方式记载的成绩,按以下方式转换成我校百分制成绩予以认定。",
        )
        self.assertEqual(
            table_unit["metadata"]["caption_lines"],
            ["3. 境外课程以非百分制方式记载的成绩,按以下方式转换成我校百分制成绩予以认定。"],
        )

    def test_cleanup_projects_phone_table_into_semantic_policy_pages(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    261,
                    "heading",
                    "中央民族大学校内常用电话",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    261,
                    "table",
                    "电话表",
                    block_role="table",
                    table_cells=[
                        ["单位名称", "电话号码", "单位名称", "电话号码"],
                        ["校园110", "68932220", "研究生院(学位办)", ""],
                        ["", "", "办公室", "68932649"],
                        ["学生处(学生工作部)", "", "保卫武装部", ""],
                        ["办公室", "68932204", "办公室", "68932434"],
                        ["就业工作处", "", "公寓管理部", "68933547"],
                        ["就业指导、就业派遣", "68932410", "餐饮服务部", "68933180"],
                        ["就业信息管理", "68932640", "电工班", "68932331"],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                261,
                261,
                title="中央民族大学校内常用电话",
                handbook_section="中央民族大学公寓及公费医疗管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        policy_units = [row for row in result.document_units if row["unit_type"] == "policy_page"]
        self.assertGreaterEqual(len(policy_units), 4)
        self.assertEqual(policy_units[0]["anchor"]["section_path"], ["校级办公与公共服务"])
        self.assertIn("研究生院(学位办)办公室 68932649", policy_units[0]["clean_text"])
        self.assertEqual(policy_units[1]["anchor"]["section_path"], ["学生事务与安保服务"])
        self.assertIn("学生处(学生工作部)办公室 68932204", policy_units[1]["clean_text"])
        self.assertIn("保卫武装部办公室 68932434", policy_units[1]["clean_text"])
        self.assertEqual(policy_units[2]["anchor"]["section_path"], ["就业工作处"])
        self.assertIn("就业指导、就业派遣 68932410", policy_units[2]["clean_text"])
        self.assertEqual(policy_units[3]["anchor"]["section_path"], ["后勤产业集团"])
        self.assertIn("公寓管理部 68933547", policy_units[3]["clean_text"])

    def test_cleanup_keeps_original_table_unit_when_projecting_phone_table_semantics(self) -> None:
        result = cleanup_handbook_document(
            structured_rows=[
                _source_row(
                    261,
                    "heading",
                    "中央民族大学校内常用电话",
                    block_role="title",
                    title_candidate_score=1.0,
                ),
                _source_row(
                    261,
                    "table",
                    "电话表",
                    block_role="table",
                    table_cells=[
                        ["单位名称", "电话号码", "单位名称", "电话号码"],
                        ["校园110", "68932220", "研究生院(学位办)", ""],
                        ["", "", "办公室", "68932649"],
                    ],
                ),
            ],
            manifest_document=_manifest_document(
                261,
                261,
                title="中央民族大学校内常用电话",
                handbook_section="中央民族大学公寓及公费医疗管理规定",
            ),
            source_doc="学生手册_2018.pdf",
        )

        self.assertTrue(any(row["unit_type"] == "table" for row in result.document_units))
        self.assertTrue(any(row["unit_type"] == "table_unit" for row in result.document_units))
        self.assertFalse(any(row["unit_type"] == "table_row" for row in result.document_units))
