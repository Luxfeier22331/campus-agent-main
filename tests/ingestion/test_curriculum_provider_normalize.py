from __future__ import annotations

import json
import unittest
from pathlib import Path

from campus_ingestion_core.curriculum_provider_normalize import normalize_curriculum_provider_result


class CurriculumProviderNormalizeTest(unittest.TestCase):
    def _normalize_fixture_rows(self, fixture_path: str) -> list[dict[str, object]]:
        structured_bytes = normalize_curriculum_provider_result(
            provider_jsonl_bytes=Path(fixture_path).read_bytes(),
            source_pdf="curriculum-plan-2022.pdf",
            ocr_provider="paddleocr_async",
            ocr_model="PaddleOCR-VL-1.5",
        )
        return [
            json.loads(line)
            for line in structured_bytes.decode("utf-8").splitlines()
            if line.strip()
        ]

    def _normalize_rows(self, provider_payload: dict[str, object]) -> list[dict[str, object]]:
        structured_bytes = normalize_curriculum_provider_result(
            provider_jsonl_bytes=(json.dumps(provider_payload, ensure_ascii=False) + "\n").encode(
                "utf-8"
            ),
            source_pdf="curriculum-plan.pdf",
            ocr_provider="paddleocr_vl_service",
            ocr_model="PaddleOCR-VL-1.5",
        )
        return [
            json.loads(line)
            for line in structured_bytes.decode("utf-8").splitlines()
            if line.strip()
        ]

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
        self.assertEqual(rows[0]["ocr_provider"], "paddleocr_vl_service")
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

    def test_normalize_curriculum_provider_result_falls_back_to_markdown_when_block_list_missing(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-002",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "markdown": {"text": "纯 markdown 回退文本", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["row_type"], "paragraph")
        self.assertEqual(rows[0]["text_normalized"], "纯 markdown 回退文本")
        self.assertEqual(rows[0]["provider_page_id"], 1)

    def test_normalize_curriculum_provider_result_keeps_unique_row_ids_when_provider_block_ids_repeat(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-003",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "paragraph_title",
                                    "block_content": "目录",
                                    "block_id": 1,
                                    "block_order": 1,
                                },
                                {
                                    "block_label": "content",
                                    "block_content": "社会学类本科人才培养方案.....47",
                                    "block_id": 1,
                                    "block_order": 2,
                                },
                                {
                                    "block_label": "number",
                                    "block_content": "1",
                                    "block_id": 1,
                                    "block_order": None,
                                },
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        self.assertEqual(len(rows), 3)
        self.assertEqual(len({row["row_id"] for row in rows}), 3)

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
                                    "block_content": "中央民族大学教务处",
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
                                    "block_content": "中央民族大学教务处",
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

    def test_normalize_curriculum_provider_result_demotes_sentence_like_subsection_to_paragraph(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-009",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "text",
                                    "block_content": "（一）工程知识：能够将数学、自然科学、工程基础和专业知识用于解决复杂工程问题。",
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
        self.assertEqual(rows[0]["title_candidate_score"], 0.0)

    def test_normalize_curriculum_provider_result_repairs_cross_page_merged_table_placeholders(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-010",
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
                                        '<tr><td rowspan="4">基本素养课</td><td>大学英语(一)</td><td>2</td></tr>'
                                        "<tr><td>大学英语(二)</td><td>2</td></tr>"
                                        "<tr><td>大学英语(三)</td><td>2</td></tr>"
                                        "</table>"
                                    ),
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
                                    "block_label": "table",
                                    "block_content": (
                                        "<table>"
                                        '<tr><td rowspan="1"></td><td>大学英语(四)</td><td>2</td></tr>'
                                        "</table>"
                                    ),
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

        first_table = next(row for row in rows if row["provider_block_id"] == "11")
        second_table = next(row for row in rows if row["provider_block_id"] == "21")

        self.assertEqual(second_table["relation_type"], "table_continuation")
        self.assertEqual(second_table["owner_row_id"], first_table["row_id"])
        self.assertIn(">基本素养课<", second_table["html"])
        self.assertEqual(second_table["table_cells"][0]["text"], "基本素养课")
        self.assertEqual(second_table["table_cells"][0]["rowspan"], 1)

    def test_normalize_curriculum_provider_result_provider_fixture_regression(self) -> None:
        rows = self._normalize_fixture_rows(
            "tests/fixtures/curriculum_plan/provider-result-sample.jsonl"
        )

        self.assertEqual(len(rows), 21)
        self.assertEqual(sum(row["row_type"] == "heading" for row in rows), 4)
        self.assertEqual(sum(row["row_type"] == "paragraph" for row in rows), 4)
        self.assertEqual(sum(row["row_type"] == "table_caption" for row in rows), 2)
        self.assertEqual(sum(row["row_type"] == "table" for row in rows), 2)
        self.assertEqual(sum(row["row_type"] == "note" for row in rows), 1)
        self.assertEqual(sum(row["row_type"] == "footer" for row in rows), 4)
        self.assertEqual(sum(row["row_type"] == "page_number" for row in rows), 2)
        self.assertEqual(sum(row["row_type"] == "toc_entry" for row in rows), 1)
        self.assertEqual(sum(row["row_type"] == "image" for row in rows), 1)

        repeated_footers = [row for row in rows if row["row_type"] == "footer"]
        self.assertEqual(len(repeated_footers), 4)
        self.assertTrue(all(bool(row["is_repeated_candidate"]) for row in repeated_footers))
        self.assertTrue(all(row["repeat_position_band"] == "bottom" for row in repeated_footers))

        first_table = next(row for row in rows if row["provider_block_id"] == "14")
        second_caption = next(row for row in rows if row["provider_block_id"] == "22")
        second_table = next(row for row in rows if row["provider_block_id"] == "23")
        note_row = next(row for row in rows if row["provider_block_id"] == "15")
        first_continuation_paragraph = next(row for row in rows if row["provider_block_id"] == "21")
        second_continuation_paragraph = next(
            row for row in rows if row["provider_block_id"] == "31"
        )

        self.assertEqual(first_table["table_header_rows"], [["类别", "课程", "学分"]])
        self.assertTrue(bool(first_table["table_has_merged_cells"]))
        self.assertEqual(second_table["relation_type"], "table_continuation")
        self.assertEqual(second_table["owner_row_id"], first_table["row_id"])
        self.assertEqual(second_table["continuation_group_id"], first_table["row_id"])
        self.assertEqual(second_table["table_fragment_id"], first_table["table_fragment_id"])
        self.assertEqual(second_caption["relation_type"], "caption_of")
        self.assertEqual(second_caption["continuation_group_id"], first_table["row_id"])
        self.assertEqual(note_row["relation_type"], "note_of")
        self.assertEqual(note_row["owner_row_id"], first_table["row_id"])
        self.assertTrue(bool(first_continuation_paragraph["continues_to_next_page"]))
        self.assertTrue(bool(second_continuation_paragraph["continues_from_previous_page"]))


if __name__ == "__main__":
    unittest.main()
