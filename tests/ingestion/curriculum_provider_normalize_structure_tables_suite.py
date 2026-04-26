from .curriculum_provider_normalize_structure_support import *


class CurriculumProviderNormalizeStructureTablesTest(CurriculumProviderNormalizeStructureBaseTest):
    def test_normalize_curriculum_provider_result_recognizes_bottom_band_numeric_text_as_page_number(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-003b",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "height": 1600,
                            "parsing_res_list": [
                                {
                                    "block_label": "text",
                                    "block_content": "476",
                                    "block_id": 1,
                                    "block_order": 1,
                                    "block_bbox": [520, 1500, 580, 1540],
                                },
                                {
                                    "block_label": "text",
                                    "block_content": "课程说明",
                                    "block_id": 2,
                                    "block_order": 2,
                                    "block_bbox": [100, 200, 600, 260],
                                },
                            ],
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        page_marker = next(row for row in rows if row["provider_block_id"] == "1")
        body_row = next(row for row in rows if row["provider_block_id"] == "2")

        self.assertEqual(page_marker["row_type"], "page_number")
        self.assertEqual(page_marker["block_role"], "page_number")
        self.assertEqual(body_row["row_type"], "paragraph")

    def test_normalize_curriculum_provider_result_binds_caption_and_note_to_table(self) -> None:
        provider_payload = {
            "logId": "log-004",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "figure_title",
                                    "block_content": "表 1 课程设置",
                                    "block_id": 11,
                                    "block_order": 1,
                                },
                                {
                                    "block_label": "table",
                                    "block_content": "<table><tr><td>课程</td></tr></table>",
                                    "block_id": 12,
                                    "block_order": 2,
                                },
                                {
                                    "block_label": "vision_footnote",
                                    "block_content": "备注：实验班学生必修。",
                                    "block_id": 13,
                                    "block_order": 3,
                                },
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        caption_row = rows[0]
        table_row = rows[1]
        note_row = rows[2]

        self.assertEqual(caption_row["row_type"], "table_caption")
        self.assertEqual(caption_row["owner_row_id"], table_row["row_id"])
        self.assertEqual(caption_row["relation_type"], "caption_of")
        self.assertEqual(caption_row["continuation_group_id"], table_row["row_id"])
        self.assertEqual(note_row["row_type"], "note")
        self.assertEqual(note_row["owner_row_id"], table_row["row_id"])
        self.assertEqual(note_row["relation_type"], "note_of")
        self.assertEqual(note_row["continuation_group_id"], table_row["row_id"])
        self.assertEqual(table_row["continuation_group_id"], table_row["row_id"])

    def test_normalize_curriculum_provider_result_extracts_minimal_table_cells_contract(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-004b",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "table",
                                    "block_content": (
                                        "<table>"
                                        "<tr><th>类别</th><th>课程</th><th>学分</th></tr>"
                                        '<tr><td rowspan="2">核心课</td><td>微观经济学</td><td>3</td></tr>'
                                        '<tr><td colspan="2">宏观经济学 / 3</td></tr>'
                                        "</table>"
                                    ),
                                    "block_id": 31,
                                    "block_order": 1,
                                }
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["row_type"], "table")
        self.assertEqual(
            rows[0]["table_cells"],
            [
                {"row": 1, "col": 1, "text": "类别", "rowspan": 1, "colspan": 1, "is_header": True},
                {"row": 1, "col": 2, "text": "课程", "rowspan": 1, "colspan": 1, "is_header": True},
                {"row": 1, "col": 3, "text": "学分", "rowspan": 1, "colspan": 1, "is_header": True},
                {
                    "row": 2,
                    "col": 1,
                    "text": "核心课",
                    "rowspan": 2,
                    "colspan": 1,
                    "is_header": False,
                },
                {
                    "row": 2,
                    "col": 2,
                    "text": "微观经济学",
                    "rowspan": 1,
                    "colspan": 1,
                    "is_header": False,
                },
                {"row": 2, "col": 3, "text": "3", "rowspan": 1, "colspan": 1, "is_header": False},
                {
                    "row": 3,
                    "col": 2,
                    "text": "宏观经济学 / 3",
                    "rowspan": 1,
                    "colspan": 2,
                    "is_header": False,
                },
            ],
        )

    def test_normalize_curriculum_provider_result_repairs_mineru_latex_comparison_symbols(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-004c",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "text",
                                    "block_content": (
                                        "未修过高等数学(或微积分、数学分析,\\geq 4学分)、"
                                        "概率论与数理统计(\\leq 3学分)。"
                                    ),
                                    "block_id": 31,
                                    "block_order": 1,
                                }
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        self.assertEqual(
            rows[0]["text_normalized"],
            "未修过高等数学(或微积分、数学分析,≥ 4学分)、概率论与数理统计(≤ 3学分)。",
        )
        self.assertNotIn("\\geq", rows[0]["text_normalized"])
        self.assertNotIn("\\leq", rows[0]["text_normalized"])

    def test_normalize_curriculum_provider_result_demotes_body_th_cells_to_td(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-004d",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "table",
                                    "block_content": (
                                        "<table><tr><th>培养阶段</th><th>类别</th>"
                                        "<th>学分</th></tr><tr><td>实践环节</td>"
                                        "<th>社会实践</th><th>2</th></tr></table>"
                                    ),
                                    "block_id": 31,
                                    "block_order": 1,
                                }
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        self.assertIn("<td>社会实践</td><td>2</td>", rows[0]["html"])
        self.assertNotIn("<th>社会实践</th>", rows[0]["html"])
        body_cells = [cell for cell in rows[0]["table_cells"] if cell["row"] == 2]
        self.assertTrue(all(not cell["is_header"] for cell in body_cells))

    def test_normalize_curriculum_provider_result_repairs_translation_workshop_ocr_error(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-translation-workshop-repair",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "table",
                                    "block_content": (
                                        "<table><tr><td>课程号</td><td>课程名称</td></tr>"
                                        "<tr><td>055121312</td><td>笔试工作坊（一）</td></tr>"
                                        "<tr><td>050211377</td><td>文化专题口译</td></tr></table>"
                                    ),
                                    "block_id": 32,
                                    "block_order": 1,
                                }
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        html = str(rows[0]["text_normalized"])
        self.assertIn("笔译工作坊(一)", html)
        self.assertNotIn("笔试工作坊", html)
        self.assertIn(
            {
                "row": 2,
                "col": 2,
                "text": "笔译工作坊(一)",
                "rowspan": 1,
                "colspan": 1,
                "is_header": False,
            },
            rows[0]["table_cells"],
        )

    def test_normalize_curriculum_provider_result_repairs_split_course_word_inside_table(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-split-course-word-repair",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "table",
                                    "block_content": (
                                        "<table><tr><td>课程类</td><td>备注</td></tr>"
                                        "<tr><td>本硕贯通课程</td>"
                                        "<td>硕士生培养方案一年级课 程</td></tr></table>"
                                    ),
                                    "block_id": 33,
                                    "block_order": 1,
                                }
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        html = str(rows[0]["text_normalized"])
        self.assertIn("一年级课程", html)
        self.assertNotIn("课 程", html)
        self.assertIn(
            {
                "row": 2,
                "col": 2,
                "text": "硕士生培养方案一年级课程",
                "rowspan": 1,
                "colspan": 1,
                "is_header": False,
            },
            rows[0]["table_cells"],
        )

    def test_normalize_curriculum_provider_result_repairs_repeated_student_direction_phrase(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-repeated-student-direction-repair",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "text",
                                    "block_content": (
                                        "纳米材料与技术专业学生方向学生参见"
                                        "纳米材料与技术专业人才培养方案。"
                                    ),
                                    "block_id": 34,
                                    "block_order": 1,
                                }
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        self.assertEqual(
            rows[0]["text_normalized"],
            "纳米材料与技术专业方向学生参见纳米材料与技术专业人才培养方案。",
        )
        self.assertNotIn("专业学生方向学生", rows[0]["text_normalized"])

    def test_normalize_curriculum_provider_result_merges_blank_category_rowspan_continuations(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-blank-category-rowspan-repair",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "table",
                                    "block_content": (
                                        "<table>"
                                        "<tr><td>课程类</td><td>模块</td><td>课程号</td></tr>"
                                        '<tr><td rowspan="2">跨学科交叉课程</td>'
                                        '<td rowspan="2">模块三</td><td>A</td></tr>'
                                        "<tr><td>B</td></tr>"
                                        '<tr><td rowspan="2"></td><td rowspan="2"></td><td>C</td></tr>'
                                        "<tr><td>D</td></tr>"
                                        "</table>"
                                    ),
                                    "block_id": 31,
                                    "block_order": 1,
                                }
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        self.assertEqual(len(rows), 1)
        html = str(rows[0]["text_normalized"])
        self.assertIn('<td rowspan="4">跨学科交叉课程</td>', html)
        self.assertIn('<td rowspan="4">模块三</td>', html)
        self.assertNotIn('<td rowspan="2"></td>', html)

    def test_normalize_curriculum_provider_result_merges_duplicate_category_rowspans(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-duplicate-category-rowspan-repair",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "table",
                                    "block_content": (
                                        "<table>"
                                        "<tr><td>课程类</td><td>课程号</td></tr>"
                                        '<tr><td rowspan="2">跨学科交叉课程</td><td>A</td></tr>'
                                        "<tr><td>B</td></tr>"
                                        '<tr><td rowspan="2">跨学科交叉课程</td><td>C</td></tr>'
                                        "<tr><td>D</td></tr>"
                                        '<tr><td rowspan="2"></td><td>E</td></tr>'
                                        "<tr><td>F</td></tr>"
                                        "</table>"
                                    ),
                                    "block_id": 41,
                                    "block_order": 1,
                                }
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        self.assertEqual(len(rows), 1)
        html = str(rows[0]["text_normalized"])
        self.assertIn('<td rowspan="6">跨学科交叉课程</td>', html)
        self.assertEqual(html.count("跨学科交叉课程"), 1)
        self.assertNotIn('<td rowspan="2"></td>', html)

    def test_normalize_curriculum_provider_result_merges_split_rowspan_category_label(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-split-category-rowspan-repair",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "table",
                                    "block_content": (
                                        "<table><tr><td>专业(方向)名称</td><td>课程号</td></tr>"
                                        '<tr><td rowspan="2">中国少数民族语言文学(蒙古语言</td>'
                                        "<td>1027030002</td></tr><tr><td>1027030003</td></tr>"
                                        '<tr><td rowspan="4">文学、藏语言文学、维吾尔语言文学、'
                                        "哈萨克语言文学、朝鲜语言文学)</td><td>1027030004</td></tr>"
                                        "</table>"
                                    ),
                                    "block_id": 41,
                                    "block_order": 1,
                                }
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        html = str(rows[0]["text_normalized"])
        self.assertIn(
            '<td rowspan="6">中国少数民族语言文学(蒙古语言文学、藏语言文学、'
            "维吾尔语言文学、哈萨克语言文学、朝鲜语言文学)</td>",
            html,
        )
        self.assertNotIn('rowspan="2">中国少数民族语言文学(蒙古语言', html)
        self.assertNotIn('rowspan="4">文学、藏语言文学', html)

    def test_normalize_curriculum_provider_result_merges_blank_colspan_summary_rows(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-blank-colspan-summary-row-repair",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "table",
                                    "block_content": (
                                        "<table>"
                                        "<tr><td>培养阶段</td><td>板块名称</td><td>类别</td></tr>"
                                        '<tr><td colspan="2">实践环节</td><td>创新创业实践</td></tr>'
                                        '<tr><td colspan="2" rowspan="2"></td><td>专业实践</td></tr>'
                                        "<tr><td>社会实践</td></tr>"
                                        "</table>"
                                    ),
                                    "block_id": 51,
                                    "block_order": 1,
                                }
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        self.assertEqual(len(rows), 1)
        html = str(rows[0]["text_normalized"])
        self.assertIn('<td rowspan="3" colspan="2">实践环节</td>', html)
        self.assertNotIn('<td colspan="2" rowspan="2"></td>', html)
