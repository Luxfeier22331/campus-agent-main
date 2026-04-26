from .curriculum_provider_normalize_structure_support import *


class CurriculumProviderNormalizeStructureFixturesTest(
    CurriculumProviderNormalizeStructureBaseTest
):
    def test_normalize_curriculum_provider_result_splits_inline_discipline_metadata_value(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-008f",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "paragraph_title",
                                    "block_content": "文物与博物馆学本科第二学士学位人才培养方案",
                                    "block_id": 10,
                                    "block_order": 1,
                                },
                                {
                                    "block_label": "text",
                                    "block_content": "三、主干学科 考古学、历史学",
                                    "block_id": 11,
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

        self.assertEqual(
            [row["text_normalized"] for row in rows],
            [
                "文物与博物馆学本科第二学士学位人才培养方案",
                "三、主干学科",
                "考古学、历史学",
            ],
        )
        self.assertEqual(rows[1]["row_type"], "heading")
        self.assertEqual(rows[1]["heading_level"], 2)
        self.assertEqual(rows[2]["row_type"], "paragraph")
        self.assertEqual(rows[2]["heading_level"], None)

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
