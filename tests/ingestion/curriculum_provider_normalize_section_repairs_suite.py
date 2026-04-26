from __future__ import annotations

from .curriculum_provider_normalize_test_support import *


class CurriculumProviderNormalizeSectionRepairsTest(CurriculumProviderNormalizeTestSupport):
    def test_normalize_curriculum_provider_result_splits_inline_arabic_parenthesized_enum_boundaries(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-inline-arabic-enum",
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
                                        "(1) 第一层次强调基础课程;"
                                        "(2) 第二层次强调专业核心课程;"
                                        "(3) 第三层次强调实践课程。"
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

        paragraph = next(row for row in rows if row["row_type"] == "paragraph")
        self.assertEqual(
            paragraph["text_normalized"],
            "\n".join(
                [
                    "(1) 第一层次强调基础课程;",
                    "(2) 第二层次强调专业核心课程;",
                    "(3) 第三层次强调实践课程。",
                ]
            ),
        )
        self.assertIn(
            "split_inline_parenthesized_enum_boundaries",
            paragraph["classification_reason"],
        )

    def test_normalize_curriculum_provider_result_splits_inline_bare_arabic_enum_boundaries(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-inline-bare-arabic-enum",
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
                                        "1)文献资料的查阅与分析应用;"
                                        "2)学习新技术、新方法;"
                                        "3)实验方案确定,实验装置的设计与建立。"
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

        paragraph = next(row for row in rows if row["row_type"] == "paragraph")
        self.assertEqual(
            paragraph["text_normalized"],
            "\n".join(
                [
                    "1)文献资料的查阅与分析应用;",
                    "2)学习新技术、新方法;",
                    "3)实验方案确定,实验装置的设计与建立。",
                ]
            ),
        )
        self.assertIn(
            "split_inline_parenthesized_enum_boundaries",
            paragraph["classification_reason"],
        )

    def test_normalize_curriculum_provider_result_repairs_design_personalized_heading_gap(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-design-personalized-heading",
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
                                        "2. 视觉传达设计(影像设计)专业个性化培养至少选择修读6学分,"
                                        "建议课程清单:"
                                    ),
                                    "block_id": 1,
                                    "block_order": 1,
                                },
                                {
                                    "block_label": "table",
                                    "block_content": (
                                        "<table><tr><td>课程类</td><td>课程名称</td></tr>"
                                        "<tr><td>跨学科交叉课程</td><td>中国画欣赏</td></tr>"
                                        "<tr><td>行业领域协同育人课程</td><td>传播学概论</td></tr></table>"
                                    ),
                                    "block_id": 2,
                                    "block_order": 2,
                                },
                                {
                                    "block_label": "table",
                                    "block_content": (
                                        "<table><tr><td>课程类</td><td>课程名称</td></tr>"
                                        "<tr><td>跨学科交叉课程</td><td>平面设计</td></tr>"
                                        "<tr><td>行业领域协同育人课程</td><td>室内设计快题与预算</td></tr>"
                                        "<tr><td>行业领域协同育人课程</td><td>行业协同专题设计(三)</td></tr></table>"
                                    ),
                                    "block_id": 3,
                                    "block_order": 3,
                                },
                                {
                                    "block_label": "text",
                                    "block_content": (
                                        "4. 服装与服饰设计专业个性化培养至少选择修读15学分,"
                                        "建议课程清单:"
                                    ),
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

        inserted_text = "3. 环境设计专业个性化培养至少选择修读13学分,建议课程清单:"
        self.assertIn(inserted_text, texts)
        inserted_index = texts.index(inserted_text)
        self.assertLess(
            inserted_index, next(i for i, text in enumerate(texts) if "平面设计" in text)
        )
        self.assertIn(
            "insert_design_environment_personalized_heading",
            str(rows[inserted_index]["classification_reason"]),
        )

    def test_normalize_curriculum_provider_result_repairs_misnumbered_graduation_requirements(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-graduation-section-repair",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "paragraph_title",
                                    "block_content": "一、培养目标",
                                    "block_id": 1,
                                    "block_order": 1,
                                },
                                {
                                    "block_label": "text",
                                    "block_content": "培养经济金融相关领域人才。",
                                    "block_id": 2,
                                    "block_order": 2,
                                },
                                {
                                    "block_label": "paragraph_title",
                                    "block_content": "三、毕业要求",
                                    "block_id": 3,
                                    "block_order": 3,
                                },
                                {
                                    "block_label": "text",
                                    "block_content": "政治素质:牢固树立正确的国家观。",
                                    "block_id": 4,
                                    "block_order": 4,
                                },
                                {
                                    "block_label": "paragraph_title",
                                    "block_content": "三、学制、总学分和学位授予",
                                    "block_id": 5,
                                    "block_order": 5,
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
        self.assertIn("二、毕业要求", texts)
        self.assertNotIn("三、毕业要求", texts)
        heading = rows[texts.index("二、毕业要求")]
        self.assertEqual(heading["row_type"], "heading")
        self.assertEqual(heading["heading_level"], 2)
        self.assertIn("renumber_graduation_requirements_section", heading["classification_reason"])

    def test_normalize_curriculum_provider_result_repairs_course_settings_parenthesized_heading_sequence(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-course-settings-sequence-repair",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "paragraph_title",
                                    "block_content": "五、课程设置和修读建议",
                                    "block_id": 1,
                                    "block_order": 1,
                                },
                                {
                                    "block_label": "paragraph_title",
                                    "block_content": "(一) 语言课",
                                    "block_id": 2,
                                    "block_order": 2,
                                },
                                {
                                    "block_label": "paragraph_title",
                                    "block_content": "(二) 通识课",
                                    "block_id": 3,
                                    "block_order": 3,
                                },
                                {
                                    "block_label": "paragraph_title",
                                    "block_content": "(二)专业教育",
                                    "block_id": 4,
                                    "block_order": 4,
                                },
                                {
                                    "block_label": "paragraph_title",
                                    "block_content": "(四)实践环节",
                                    "block_id": 5,
                                    "block_order": 5,
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
        self.assertIn("(三)专业教育", texts)
        self.assertNotIn("(二)专业教育", texts)
        repaired = rows[texts.index("(三)专业教育")]
        self.assertIn(
            "renumber_course_settings_parenthesized_heading",
            repaired["classification_reason"],
        )

    def test_normalize_curriculum_provider_result_repairs_repeated_ordered_list_markers(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-list-sequence-repair",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "paragraph_title",
                                    "block_content": "(一)素质要求",
                                    "block_id": 1,
                                    "block_order": 1,
                                },
                                {
                                    "block_label": "text",
                                    "block_content": (
                                        "1. 政治素质:具有坚定正确的政治方向。\n"
                                        "2.思想品德:自觉践行社会主义核心价值观。\n"
                                        "2. 综合素养:具有基本的现代信息素养。\n"
                                        "3. 职业素养:遵守职业道德和相关规范。\n"
                                        "4. 国际视野:具有宽广的国际视野。"
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
            (
                "1. 政治素质:具有坚定正确的政治方向。\n"
                "2. 思想品德:自觉践行社会主义核心价值观。\n"
                "3. 综合素养:具有基本的现代信息素养。\n"
                "4. 职业素养:遵守职业道德和相关规范。\n"
                "5. 国际视野:具有宽广的国际视野。"
            ),
        )
        self.assertIn(
            "renumber_repeated_ordered_list_markers",
            paragraph["classification_reason"],
        )

    def test_normalize_curriculum_provider_result_splits_inline_decimal_outcome_markers(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-decimal-markers",
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
                                        "2.3 掌握文献检索、分析和归纳方法。"
                                        "2.4 能够针对复杂工程问题提出有效解决方法。"
                                    ),
                                    "block_id": 21,
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
            ("2.3 掌握文献检索、分析和归纳方法。\n2.4 能够针对复杂工程问题提出有效解决方法。"),
        )

    def test_normalize_curriculum_provider_result_repairs_mineru_text_artifacts(self) -> None:
        provider_payload = {
            "logId": "log-mineru-text-repair",
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
                                        "1. 政治素质:牢固树立正确的祖国观。\n"
                                        "2公民素养:具有良好的思想道德品质。\n"
                                        "3. 职业素养:热忱对待音乐事业。\n"
                                        "总学分:138- 139 学分\n"
                                        "备注:建议续深造学生选修。\n"
                                        "课程名称:高光谱成像级应用\n"
                                        "培养具备马克主义世界观和价值观。\n"
                                        "本专业培养具备具有坚定的理想信念。\n"
                                        "3. 跨学科知识:具有宽广的人文和社会科学知识,形成跨学科知识结构。\n"
                                        "构,能够进行跨学科思考。"
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
            (
                "1. 政治素质:牢固树立正确的祖国观。\n"
                "2. 公民素养:具有良好的思想道德品质。\n"
                "3. 职业素养:热忱对待音乐事业。\n"
                "总学分:138-139 学分\n"
                "备注:建议继续深造学生选修。\n"
                "课程名称:高光谱成像及应用\n"
                "培养具备马克思主义世界观和价值观。\n"
                "本专业培养具备坚定的理想信念。\n"
                "3. 跨学科知识:具有宽广的人文和社会科学知识,形成跨学科知识结构,能够进行跨学科思考。"
            ),
        )

    def test_normalize_curriculum_provider_result_repairs_cross_block_duplicate_tail_wrap(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-cross-block-tail-wrap-repair",
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
                                        "3. 跨学科知识:具有宽广的人文和社会科学知识,"
                                        "形成跨学科知识结构。"
                                    ),
                                    "block_id": 1,
                                    "block_order": 1,
                                },
                                {
                                    "block_label": "text",
                                    "block_content": "构,能够进行跨学科思考。",
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
            "3. 跨学科知识:具有宽广的人文和社会科学知识,形成跨学科知识结构,能够进行跨学科思考。",
            texts,
        )
        self.assertNotIn("构,能够进行跨学科思考。", texts)
        repaired = rows[
            texts.index(
                "3. 跨学科知识:具有宽广的人文和社会科学知识,形成跨学科知识结构,能够进行跨学科思考。"
            )
        ]
        self.assertIn("merge_cross_block_duplicate_tail_wrap", repaired["classification_reason"])

    def test_normalize_curriculum_provider_result_repairs_cross_block_duplicate_tail_wrap_inside_multiline_list(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-cross-block-tail-wrap-multiline-list-repair",
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
                                        "1. 理论知识:初步掌握语言研究方法。\n"
                                        "2. 专业核心知识:系统掌握俄语语言知识。\n"
                                        "3. 跨学科知识:具有宽广的人文和社会科学知识,"
                                        "形成跨学科知识结构。"
                                    ),
                                    "block_id": 1,
                                    "block_order": 1,
                                },
                                {
                                    "block_label": "number",
                                    "block_content": "203",
                                    "block_id": 2,
                                    "block_order": 2,
                                    "block_bbox": [540, 780, 560, 800],
                                },
                                {
                                    "block_label": "text",
                                    "block_content": "构，能够进行跨学科思考。",
                                    "block_id": 3,
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

        texts = [str(row.get("text_normalized") or "") for row in rows]
        self.assertEqual(len(texts), 2)
        self.assertIn("203", texts)
        paragraph = next(row for row in rows if row["row_type"] == "paragraph")
        self.assertEqual(
            paragraph["text_normalized"],
            (
                "1. 理论知识:初步掌握语言研究方法。\n"
                "2. 专业核心知识:系统掌握俄语语言知识。\n"
                "3. 跨学科知识:具有宽广的人文和社会科学知识,形成跨学科知识结构,能够进行跨学科思考。"
            ),
        )
        self.assertNotIn("构,能够进行跨学科思考。", texts)
        self.assertIn(
            "merge_cross_block_duplicate_tail_wrap",
            paragraph["classification_reason"],
        )

    def test_normalize_curriculum_provider_result_splits_trailing_course_list_intro_before_table(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-trailing-course-list-intro",
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
                                        "通识教育板块应修52学分。其中必修44学分,包括思政课19学分、"
                                        "基本素养课23学分,劳动教育2学分;选修8学分。课程清单如下:"
                                    ),
                                    "block_id": 21,
                                    "block_order": 1,
                                },
                                {
                                    "block_label": "table",
                                    "block_content": (
                                        "<table><tr><td>课程</td><td>学分</td></tr>"
                                        "<tr><td>马克思主义基本原理</td><td>3</td></tr></table>"
                                    ),
                                    "block_id": 22,
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
            "通识教育板块应修52学分。其中必修44学分,包括思政课19学分、"
            "基本素养课23学分,劳动教育2学分;选修8学分。",
            texts,
        )
        self.assertIn("课程清单如下:", texts)
        self.assertNotIn("选修8学分。课程清单如下:", texts)

    def test_normalize_curriculum_provider_result_repairs_split_global_competence_table_cells(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-global-competence-table-repair",
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
                                        "<table><tr><td>课程类</td><td>课程名称</td><td>备注</td></tr>"
                                        "<tr><td>全球胜</td><td>国际组织与全球治理</td><td>建议拟出国学</td></tr>"
                                        '<tr><td rowspan="3">任力培养课程</td><td>英语演讲与演示</td><td rowspan="3">生选修</td></tr>'
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

        table = next(row for row in rows if row["row_type"] == "table")
        html = str(table["html"])
        self.assertIn(">全球胜任力培养课程<", html)
        self.assertIn(">建议拟出国学生选修<", html)
        self.assertNotIn(">全球胜<", html)
        self.assertNotIn(">任力培养课程<", html)
        self.assertNotIn(">建议拟出国学<", html)
        self.assertNotIn(">生选修<", html)
