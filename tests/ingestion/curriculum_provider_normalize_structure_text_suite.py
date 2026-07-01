from .curriculum_provider_normalize_structure_support import *


class CurriculumProviderNormalizeStructureTextTest(CurriculumProviderNormalizeStructureBaseTest):
    def test_normalize_curriculum_provider_result_marks_continued_tables_with_shared_group(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-005",
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
                                    "block_content": "<table><tr><td>课程</td><td>学分</td></tr></table>",
                                    "block_id": 12,
                                    "block_order": 2,
                                },
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    },
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "figure_title",
                                    "block_content": "续表 1 课程设置",
                                    "block_id": 21,
                                    "block_order": 1,
                                },
                                {
                                    "block_label": "table",
                                    "block_content": "<table><tr><td>课程</td><td>学分</td></tr><tr><td>实践</td><td>4</td></tr></table>",
                                    "block_id": 22,
                                    "block_order": 2,
                                },
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    },
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        first_table = rows[1]
        second_caption = rows[2]
        second_table = rows[3]

        self.assertEqual(first_table["row_type"], "table")
        self.assertEqual(second_caption["owner_row_id"], second_table["row_id"])
        self.assertEqual(second_table["relation_type"], "table_continuation")
        self.assertEqual(second_table["owner_row_id"], first_table["row_id"])
        self.assertEqual(second_table["continuation_group_id"], first_table["row_id"])
        self.assertEqual(second_caption["continuation_group_id"], first_table["row_id"])
        self.assertEqual(first_table["table_column_count"], 2)
        self.assertEqual(second_table["table_column_count"], 2)
        self.assertEqual(first_table["table_fragment_id"], second_table["table_fragment_id"])

    def test_normalize_curriculum_provider_result_marks_cross_page_repeated_candidates(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-009a",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "height": 1000,
                            "parsing_res_list": [
                                {
                                    "block_label": "text",
                                    "block_content": "示例大学教务处",
                                    "block_id": 11,
                                    "block_order": 1,
                                    "block_bbox": [20, 920, 220, 950],
                                }
                            ],
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    },
                    {
                        "prunedResult": {
                            "height": 1000,
                            "parsing_res_list": [
                                {
                                    "block_label": "text",
                                    "block_content": "示例大学教务处",
                                    "block_id": 21,
                                    "block_order": 1,
                                    "block_bbox": [20, 920, 220, 950],
                                }
                            ],
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    },
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        self.assertEqual(len(rows), 2)
        self.assertTrue(all(bool(row["is_repeated_candidate"]) for row in rows))
        self.assertTrue(all(row["repeat_frequency"] == 2 for row in rows))
        self.assertTrue(all(row["repeat_position_band"] == "bottom" for row in rows))

    def test_normalize_curriculum_provider_result_marks_cross_page_continuation_hints(self) -> None:
        provider_payload = {
            "logId": "log-009b",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "text",
                                    "block_content": "培养具备扎实基础和创新能力，",
                                    "block_id": 11,
                                    "block_order": 1,
                                }
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    },
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "text",
                                    "block_content": "能够服务国家战略与社会发展。",
                                    "block_id": 21,
                                    "block_order": 1,
                                }
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    },
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        self.assertTrue(bool(rows[0]["continues_to_next_page"]))
        self.assertTrue(bool(rows[1]["continues_from_previous_page"]))

    def test_normalize_curriculum_provider_result_keeps_long_numeric_requirement_as_paragraph(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-006",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "text",
                                    "block_content": "1. 具备扎实的数理基础，能够开展复杂工程分析并形成系统判断。",
                                    "block_id": 11,
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

        self.assertEqual(rows[0]["row_type"], "paragraph")
        self.assertEqual(rows[0]["heading_level"], None)
        self.assertEqual(rows[0]["block_role"], "text")
        self.assertEqual(rows[0]["title_candidate_score"], 0.0)

    def test_normalize_curriculum_provider_result_repairs_sentence_wraps_inside_paragraph(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-007",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "text",
                                    "block_content": "培养德智体美劳全面发展的社会主义建\n设者和接班人。",
                                    "block_id": 11,
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
            rows[0]["text_normalized"], "培养德智体美劳全面发展的社会主义建设者和接班人。"
        )

    def test_normalize_curriculum_provider_result_keeps_short_subsection_marker_as_heading(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-008",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "text",
                                    "block_content": "（一）课程目标",
                                    "block_id": 11,
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

        self.assertEqual(rows[0]["row_type"], "heading")
        self.assertEqual(rows[0]["heading_level"], 3)
        self.assertEqual(rows[0]["section_hint"], "subsection")

    def test_normalize_curriculum_provider_result_keeps_provider_subsection_hint_with_punctuation(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-008b",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "paragraph_title",
                                    "block_content": "(四)探索类型丰富、层次清晰的交叉培养机制",
                                    "block_id": 11,
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

        self.assertEqual(rows[0]["row_type"], "heading")
        self.assertEqual(rows[0]["heading_level"], 3)
        self.assertEqual(rows[0]["section_hint"], "subsection")

    def test_normalize_curriculum_provider_result_keeps_provider_numeric_heading_hint_with_punctuation(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-008c",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "paragraph_title",
                                    "block_content": "2.音乐表演(管弦、钢琴)",
                                    "block_id": 11,
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

        self.assertEqual(rows[0]["row_type"], "heading")
        self.assertEqual(rows[0]["heading_level"], 4)
        self.assertEqual(rows[0]["section_hint"], "numeric_heading")

    def test_normalize_curriculum_provider_result_splits_inline_course_list_intro_after_numeric_heading(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-008d",
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
                                    "block_id": 10,
                                    "block_order": 1,
                                },
                                {
                                    "block_label": "paragraph_title",
                                    "block_content": "(一)专业教育",
                                    "block_id": 11,
                                    "block_order": 2,
                                },
                                {
                                    "block_label": "text",
                                    "block_content": (
                                        "1. 专业必修课共开设 15 门课程, 40 学分。课程清单如下:"
                                    ),
                                    "block_id": 12,
                                    "block_order": 3,
                                },
                                {
                                    "block_label": "table",
                                    "block_content": (
                                        "<table><tr><td>课程号</td><td>课程名称</td></tr>"
                                        "<tr><td>1036030166</td><td>习近平法治思想概论</td></tr></table>"
                                    ),
                                    "block_id": 13,
                                    "block_order": 4,
                                },
                                {
                                    "block_label": "paragraph_title",
                                    "block_content": "2.专业选修课程",
                                    "block_id": 14,
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

        self.assertEqual(
            [row["text_normalized"] for row in rows[:5]],
            [
                "五、课程设置和修读建议",
                "(一)专业教育",
                "1. 专业必修课共开设 15 门课程, 40 学分",
                "课程清单如下:",
                "<table><tr><td>课程号</td><td>课程名称</td></tr>"
                "<tr><td>1036030166</td><td>习近平法治思想概论</td></tr></table>",
            ],
        )
        self.assertEqual(rows[2]["row_type"], "heading")
        self.assertEqual(rows[2]["heading_level"], 4)
        self.assertEqual(rows[2]["section_hint"], "numeric_heading")
        self.assertEqual(rows[3]["row_type"], "paragraph")
        self.assertEqual(rows[3]["heading_level"], None)
        self.assertEqual(rows[5]["row_type"], "heading")
        self.assertEqual(rows[5]["section_hint"], "numeric_heading")

    def test_normalize_curriculum_provider_result_splits_inline_section_metadata_value(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-008e",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "paragraph_title",
                                    "block_content": "民族学本科第二学士学位人才培养方案",
                                    "block_id": 10,
                                    "block_order": 1,
                                },
                                {
                                    "block_label": "text",
                                    "block_content": "五、学制 两年",
                                    "block_id": 11,
                                    "block_order": 2,
                                },
                                {
                                    "block_label": "text",
                                    "block_content": "六、授予学位 法学学士",
                                    "block_id": 12,
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

        self.assertEqual(
            [row["text_normalized"] for row in rows],
            [
                "民族学本科第二学士学位人才培养方案",
                "五、学制",
                "两年",
                "六、授予学位",
                "法学学士",
            ],
        )
        self.assertEqual(rows[1]["row_type"], "heading")
        self.assertEqual(rows[1]["heading_level"], 2)
        self.assertEqual(rows[1]["section_hint"], "section")
        self.assertEqual(rows[2]["row_type"], "paragraph")
        self.assertEqual(rows[2]["heading_level"], None)
        self.assertEqual(rows[3]["row_type"], "heading")
        self.assertEqual(rows[4]["row_type"], "paragraph")
