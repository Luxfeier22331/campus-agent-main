from __future__ import annotations

from .curriculum_provider_normalize_test_support import *


class CurriculumProviderNormalizeTextRepairsTest(CurriculumProviderNormalizeTestSupport):
    def test_normalize_curriculum_provider_result_preserves_layout_structure(self) -> None:
        provider_payload = {
            "logId": "log-001",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "paragraph_title",
                                    "block_content": "一、指导思想",
                                    "block_id": 11,
                                    "block_order": 1,
                                    "block_bbox": [10, 20, 200, 40],
                                },
                                {
                                    "block_label": "text",
                                    "block_content": "培养学生的系统能力。",
                                    "block_id": 12,
                                    "block_order": 2,
                                    "block_bbox": [10, 50, 500, 120],
                                },
                                {
                                    "block_label": "figure_title",
                                    "block_content": "表 1 课程设置",
                                    "block_id": 13,
                                    "block_order": None,
                                    "block_bbox": [10, 130, 220, 150],
                                },
                                {
                                    "block_label": "table",
                                    "block_content": "<table><tr><td>课程</td><td>学分</td></tr></table>",
                                    "block_id": 14,
                                    "block_order": None,
                                    "block_bbox": [10, 160, 520, 420],
                                },
                                {
                                    "block_label": "number",
                                    "block_content": "12",
                                    "block_id": 15,
                                    "block_order": None,
                                    "block_bbox": [550, 760, 565, 780],
                                },
                                {
                                    "block_label": "vision_footnote",
                                    "block_content": "备注：正常转入研究生阶段学生免修。",
                                    "block_id": 16,
                                    "block_order": None,
                                    "block_bbox": [10, 430, 520, 470],
                                },
                                {
                                    "block_label": "image",
                                    "block_content": "",
                                    "block_id": 17,
                                    "block_order": None,
                                    "block_bbox": [30, 500, 230, 650],
                                },
                            ]
                        },
                        "markdown": {"text": "fallback page 1", "images": {}},
                    },
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "content",
                                    "block_content": "社会学类本科人才培养方案.....47",
                                    "block_id": 21,
                                    "block_order": 1,
                                    "block_bbox": [10, 20, 400, 40],
                                },
                                {
                                    "block_label": "text",
                                    "block_content": "（一）课程目标",
                                    "block_id": 22,
                                    "block_order": 2,
                                    "block_bbox": [10, 50, 260, 70],
                                },
                            ]
                        },
                        "markdown": {"text": "fallback page 2", "images": {}},
                    },
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        self.assertEqual(len(rows), 9)
        self.assertTrue(all("doc_id" not in row for row in rows))
        self.assertTrue(all("version_id" not in row for row in rows))
        self.assertEqual(rows[0]["provider_page_id"], 1)
        self.assertEqual(rows[-1]["provider_page_id"], 2)
        self.assertEqual(rows[0]["row_type"], "heading")
        self.assertEqual(rows[0]["heading_level"], 2)
        self.assertEqual(rows[1]["row_type"], "paragraph")
        self.assertEqual(rows[2]["row_type"], "table_caption")
        self.assertEqual(rows[3]["row_type"], "table")
        self.assertEqual(rows[5]["row_type"], "note")
        self.assertEqual(rows[6]["row_type"], "image")
        self.assertEqual(rows[7]["row_type"], "toc_entry")
        self.assertEqual(rows[8]["row_type"], "heading")
        self.assertEqual(rows[8]["heading_level"], 3)
        self.assertEqual(rows[4]["row_type"], "page_number")
        self.assertEqual(rows[0]["schema_version"], "curriculum_layout_elements_v3")
        self.assertEqual(rows[0]["ocr_provider"], "mineru_api")
        self.assertEqual(rows[0]["source_pdf"], "curriculum-plan.pdf")
        self.assertEqual(rows[0]["page_start"], 1)
        self.assertEqual(rows[8]["page_start"], 2)
        self.assertEqual(rows[3]["html"], "<table><tr><td>课程</td><td>学分</td></tr></table>")
        self.assertEqual(rows[5]["text_normalized"], "备注:正常转入研究生阶段学生免修。")
        self.assertTrue(rows[0]["row_id"].startswith("page-0001-block-"))
        self.assertTrue(rows[7]["row_id"].startswith("page-0002-block-"))
        self.assertEqual(rows[2]["provider_block_id"], "13")
        self.assertEqual(rows[3]["bbox"], [10, 160, 520, 420])
        self.assertIn("classification_confidence", rows[0])
        self.assertIn("classification_reason", rows[0])
        self.assertIn("repeat_cluster_id", rows[0])
        self.assertIn("repeat_frequency", rows[0])
        self.assertIn("repeat_position_band", rows[0])
        self.assertIn("parent_heading_hint", rows[0])
        self.assertIn("list_level_hint", rows[0])
        self.assertIn("continues_from_previous_page", rows[0])
        self.assertIn("continues_to_next_page", rows[0])
        self.assertIn("table_fragment_id", rows[0])
        self.assertIn("table_header_rows", rows[0])
        self.assertIn("table_row_count", rows[0])
        self.assertIn("table_column_count", rows[0])
        self.assertIn("table_has_merged_cells", rows[0])
        self.assertIn("table_caption_hint", rows[0])

    def test_normalize_curriculum_provider_result_repairs_museum_second_bachelor_terms(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-museum-second-bachelor-repair",
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
                                        "系统的文学、博物馆学知识和技能。"
                                        "掌握文学、博物馆学、考古学基础知识。"
                                        "了解国内外文博界重要动态具有进一步进行文物与博物馆研究的基础。"
                                    ),
                                    "block_id": 1,
                                    "block_order": 1,
                                },
                                {
                                    "block_label": "table",
                                    "block_content": (
                                        "<table><tr><td>课程编号</td><td>课程名称</td></tr>"
                                        "<tr><td>1026030032</td><td>文物理学概论</td></tr></table>"
                                    ),
                                    "block_id": 2,
                                    "block_order": 2,
                                },
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        texts = [str(row.get("text_normalized") or "") for row in rows]
        self.assertIn(
            "系统的文物学、博物馆学知识和技能。"
            "掌握文物学、博物馆学、考古学基础知识。"
            "了解国内外文博界重要动态,具有进一步进行文物与博物馆研究的基础。",
            texts,
        )
        self.assertIn(
            "<table><tr><td>课程编号</td><td>课程名称</td></tr>"
            "<tr><td>1026030032</td><td>文物学概论</td></tr></table>",
            texts,
        )

    def test_normalize_curriculum_provider_result_repairs_museum_major_text_and_course_terms(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-museum-major-text-course-repair",
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
                                        "毕业后能能够胜任民族学、人类学、社会学、考古学等相关领域研究。"
                                        "文物保护修复等文学、博物馆学基础知识。"
                                        "将考古方法运用于文学学研究,培养文学、博物馆学的综合研究方法。"
                                    ),
                                    "block_id": 1,
                                    "block_order": 1,
                                },
                                {
                                    "block_label": "table",
                                    "block_content": (
                                        "<table><tr><td>课程号</td><td>课程名称</td></tr>"
                                        "<tr><td>0651-2-05-01</td><td>文学研究</td></tr>"
                                        "<tr><td>0651-2-05-01</td><td>文生物学研究</td></tr></table>"
                                    ),
                                    "block_id": 2,
                                    "block_order": 2,
                                },
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        texts = [str(row.get("text_normalized") or "") for row in rows]
        self.assertIn(
            "毕业后能够胜任民族学、人类学、社会学、考古学等相关领域研究。"
            "文物保护修复等文物学、博物馆学基础知识。"
            "将考古方法运用于文物学研究,培养文物学、博物馆学的综合研究方法。",
            texts,
        )
        self.assertIn(
            "<table><tr><td>课程号</td><td>课程名称</td></tr>"
            "<tr><td>0651-2-05-01</td><td>文物学研究</td></tr>"
            "<tr><td>0651-2-05-01</td><td>文物学研究</td></tr></table>",
            texts,
        )

    def test_normalize_curriculum_provider_result_repairs_art_program_requirement_artifacts(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-art-program-repair",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "paragraph_title",
                                    "block_content": "(三)要求能力",
                                    "block_id": 1,
                                    "block_order": 1,
                                },
                                {
                                    "block_label": "text",
                                    "block_content": (
                                        "1. 政治素质:具备政治素养。\n"
                                        "2. 思想品德:践行核心价值观。\n"
                                        "3 职业素养:坚定文化自信。"
                                    ),
                                    "block_id": 2,
                                    "block_order": 2,
                                },
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        texts = [str(row.get("text_normalized") or "") for row in rows]
        self.assertIn("(三)能力要求", texts)
        self.assertIn(
            "1. 政治素质:具备政治素养。\n2. 思想品德:践行核心价值观。\n3. 职业素养:坚定文化自信。",
            texts,
        )

    def test_normalize_curriculum_provider_result_repairs_spaced_cooperation_ability_typo(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-cooperation-ability-repair",
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
                                        "<table><tr><td>能力目标</td>"
                                        "<td>2-4 沟通与合作能够力</td></tr></table>"
                                    ),
                                    "block_id": 1,
                                    "block_order": 1,
                                },
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        self.assertIn(
            "<table><tr><td>能力目标</td><td>2-4 沟通与合作能力</td></tr></table>",
            [str(row.get("text_normalized") or "") for row in rows],
        )

    def test_normalize_curriculum_provider_result_repairs_split_global_competence_table_label(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-global-competence-table-label-repair",
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
                                        "<table><tr><td>课程类</td><td>课程号</td><td>课程名称</td>"
                                        "<td>学分</td><td>学时</td><td>实践学时</td><td>开设学期</td><td>备注</td></tr>"
                                        "<tr><td>全球胜任</td><td>1045040362</td><td>微纳光子学(全英文)</td>"
                                        "<td>2</td><td>36</td><td>/</td><td>6</td><td></td></tr>"
                                        '<tr><td rowspan="2">力培养课 程</td><td colspan="6">'
                                        "学校开设的全球胜任力培养课程</td><td></td></tr>"
                                        "<tr><td>新开课</td><td>科技前沿讲座</td><td>1</td>"
                                        "<td>18</td><td>/</td><td>6</td><td></td></tr>"
                                        '<tr><td rowspan="3">行业领域 协同育人 课程</td>'
                                        "<td>1045030298</td><td>企业课程</td><td>1</td>"
                                        "<td>18</td><td>/</td><td>6</td><td></td></tr></table>"
                                    ),
                                    "block_id": 1,
                                    "block_order": 1,
                                },
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        table = rows[0]
        self.assertEqual(table["row_type"], "table")
        self.assertIn('rowspan="3">全球胜任力培养课程</td>', table["html"])
        self.assertIn('rowspan="3">行业领域协同育人课程</td>', table["html"])
        self.assertNotIn("<td>全球胜任</td>", table["html"])
        self.assertNotIn("力培养课 程", table["html"])
        self.assertNotIn("行业领域 协同育人 课程", table["html"])

    def test_normalize_curriculum_provider_result_repairs_university_math_module_rowspan(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-university-math-table-repair",
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
                                        "<table><tr><td>类别</td><td>课程设置</td><td>学分</td>"
                                        "<td>学时</td><td>学期</td><td>备注</td></tr>"
                                        '<tr><td rowspan="3">大学数学(三)</td>'
                                        "<td>高等数学(三)上</td><td>4</td><td>72</td><td>1</td>"
                                        '<td rowspan="3">/</td></tr>'
                                        "<tr><td>高等数学(三)下</td><td>4</td><td>72</td><td>2</td></tr>"
                                        "<tr><td>线性代数</td><td>3</td><td>54</td><td>2</td></tr>"
                                        "<tr><td></td><td>概率论与数理统计</td><td>3</td>"
                                        "<td>54</td><td>3</td><td></td></tr></table>"
                                    ),
                                    "block_id": 1,
                                    "block_order": 1,
                                },
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        table_html = rows[0]["html"]
        self.assertIn('rowspan="4">大学数学(三)</td>', table_html)
        self.assertIn('rowspan="4">/</td>', table_html)
        self.assertIn(
            "<tr><td>概率论与数理统计</td><td>3</td><td>54</td><td>3</td></tr>", table_html
        )
        self.assertNotIn("<tr><td></td><td>概率论与数理统计", table_html)

    def test_normalize_curriculum_provider_result_repairs_chinese_international_personalized_table(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-chinese-international-table-repair",
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
                                        "<table><tr><td>课程类</td><td>模块</td><td>课程号</td>"
                                        "<td>课程名称</td></tr>"
                                        '<tr><td rowspan="2">本硕贯通课程</td>'
                                        '<td rowspan="2">模块一:\n文化传播类课程语</td>'
                                        "<td>0453-2-24-50</td><td>中华文化传播</td></tr>"
                                        "<tr><td>0453-2-24-41</td><td>中美跨文化交际(全英)</td></tr>"
                                        '<tr><td rowspan="9"></td><td rowspan="6">模块二:汉语教学类课程</td>'
                                        "<td>0453-2-24-49</td><td>国际汉语教学法及案例分析</td></tr>"
                                        "<tr><td>0453-2-24-35</td><td>线上汉语教学</td></tr>"
                                        "<tr><td>0453-2-24-29</td><td>汉语作为第二语言教学</td></tr>"
                                        "<tr><td>0453-2-24-08</td><td>汉语教学技能训练</td></tr>"
                                        "<tr><td>0453-2-24-52</td><td>汉语课堂教学设计</td></tr>"
                                        "<tr><td>0453-2-24-53</td><td>教学测试与评估</td></tr>"
                                        '<tr><td rowspan="3">模块三:第二语言习得类课程</td>'
                                        "<td>0453-2-24-40</td><td>第二语言习得研究(双语)</td></tr>"
                                        "<tr><td>0453-2-24-63</td><td>汉语国际教育研究方法</td></tr>"
                                        "<tr><td>0453-2-24-64</td><td>汉语国际教育论文写作</td></tr></table>"
                                    ),
                                    "block_id": 1,
                                    "block_order": 1,
                                },
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        table_html = rows[0]["html"]
        self.assertIn('rowspan="11">本硕贯通课程</td>', table_html)
        self.assertIn('rowspan="2">模块一:文化传播类课程</td>', table_html)
        self.assertNotIn("文化传播类课程语", table_html)
        self.assertNotIn('<td rowspan="9"></td>', table_html)

    def test_normalize_curriculum_provider_result_repairs_missing_teaching_hours_heading(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-section-repair",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "paragraph_title",
                                    "block_content": "三、学制、总学分和学位授予",
                                    "block_id": 1,
                                    "block_order": 1,
                                },
                                {
                                    "block_label": "text",
                                    "block_content": (
                                        "授予学位:工学学士将本科修读阶段分为大类培养、"
                                        "专业培养和个性化培养三个阶段。"
                                    ),
                                    "block_id": 2,
                                    "block_order": 2,
                                },
                                {
                                    "block_label": "table",
                                    "block_content": (
                                        "<table><tr><td>培养阶段</td><td>学分设置</td></tr>"
                                        "<tr><td>大类培养</td><td>83.5</td></tr></table>"
                                    ),
                                    "block_id": 3,
                                    "block_order": 3,
                                },
                                {
                                    "block_label": "paragraph_title",
                                    "block_content": "五、课程设置和修读建议",
                                    "block_id": 4,
                                    "block_order": 4,
                                },
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        texts = [str(row.get("text_normalized") or "") for row in rows]
        self.assertIn("授予学位:工学学士", texts)
        self.assertIn("四、各教学环节学时学分", texts)
        self.assertIn("将本科修读阶段分为大类培养、专业培养和个性化培养三个阶段。", texts)
        heading = rows[texts.index("四、各教学环节学时学分")]
        self.assertEqual(heading["row_type"], "heading")
        self.assertEqual(heading["heading_level"], 2)
        self.assertEqual(heading["section_hint"], "section")
        self.assertIn("insert_missing_section_four", heading["classification_reason"])

    def test_normalize_curriculum_provider_result_splits_inline_parenthesized_enum_boundaries(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-inline-enum",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "paragraph_title",
                                    "block_content": "纳米材料与技术本科人才培养方案",
                                    "block_id": 1,
                                    "block_order": 1,
                                },
                                {
                                    "block_label": "text",
                                    "block_content": (
                                        "(一)工程知识:能够解决复杂问题。"
                                        "(二)问题分析:能够识别并表达复杂问题。"
                                        "(三)设计/开发解决方案:能够提出方案。"
                                    ),
                                    "block_id": 2,
                                    "block_order": 2,
                                },
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        paragraph = next(row for row in rows if row["row_type"] == "paragraph")
        self.assertEqual(
            paragraph["text_normalized"],
            "\n".join(
                [
                    "(一)工程知识:能够解决复杂问题。",
                    "(二)问题分析:能够识别并表达复杂问题。",
                    "(三)设计/开发解决方案:能够提出方案。",
                ]
            ),
        )
        self.assertIn(
            "split_inline_parenthesized_enum_boundaries",
            paragraph["classification_reason"],
        )
