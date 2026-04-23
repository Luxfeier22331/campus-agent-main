from __future__ import annotations

import json
import unittest
from pathlib import Path

from campus_ingestion_core.curriculum_provider_normalize import normalize_curriculum_provider_result


class CurriculumProviderNormalizeStructureTest(unittest.TestCase):
    def _normalize_fixture_rows(self, fixture_path: str) -> list[dict[str, object]]:
        structured_bytes = normalize_curriculum_provider_result(
            provider_jsonl_bytes=Path(fixture_path).read_bytes(),
            source_pdf="curriculum-plan-2022.pdf",
            ocr_provider="mineru_api",
            ocr_model="vlm",
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
            ocr_provider="mineru_api",
            ocr_model="vlm",
        )
        return [
            json.loads(line)
            for line in structured_bytes.decode("utf-8").splitlines()
            if line.strip()
        ]

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
                            ]
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
