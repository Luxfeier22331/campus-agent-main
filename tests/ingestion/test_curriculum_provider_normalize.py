from __future__ import annotations

import json
import unittest
from pathlib import Path

from campus_ingestion_core.curriculum_provider_normalize import normalize_curriculum_provider_result
from campus_ingestion_core.curriculum_provider_normalize_shared import (
    _repair_ethnology_second_bachelor_table_artifact,
    _repair_minority_preparatory_program_artifacts,
    _repair_paleography_program_table_artifacts,
)

from tests.ingestion.curriculum_provider_normalize_structure_suite import *


class CurriculumProviderNormalizeTest(unittest.TestCase):
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

    def test_normalize_curriculum_provider_result_repairs_summary_stage_table_artifacts(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-summary-stage-repair",
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
                                        "<table><tr><td>培养阶段</td><td>板块名称</td><td>类别</td></tr>"
                                        "<tr><td>大类培养</td><td>通识教育</td><td>思政课</td></tr>"
                                        "<tr><td></td><td>学科基础教育</td><td>学科基础课</td></tr>"
                                        "<tr><td>专业</td><td>专业教育</td><td>专业核心课</td></tr>"
                                        "<tr><td>培养</td><td></td><td>专业选修课</td></tr>"
                                        "</table>"
                                    ),
                                    "block_id": 43,
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
        self.assertIn(
            "<tr><td>大类培养</td><td>学科基础教育</td><td>学科基础课</td></tr>",
            html,
        )
        self.assertIn(
            "<tr><td>专业培养</td><td>专业教育</td><td>专业核心课</td></tr>",
            html,
        )
        self.assertIn(
            "<tr><td>专业培养</td><td>专业教育</td><td>专业选修课</td></tr>",
            html,
        )
        self.assertNotIn("<td>专业</td><td>专业教育</td>", html)
        self.assertNotIn("<td>培养</td><td></td>", html)

    def test_normalize_curriculum_provider_result_repairs_personalized_guidance_intro(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-personalized-guidance-intro-repair",
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
                                        "为充分对接学生未来发展、满足学生个性化选择,设置本硕贯通课程、跨学科交叉课程、"
                                        "全球胜任力培养课程和行业领域协同育人课程,学生可根据未来发展意向选择修读相关课程,"
                                        "此部分至少修读6学分。修读建议拟继续深造学生建议选择修读本硕贯通专业选修课程。"
                                        "免试推荐攻读本校研究生的本科生可提前学习研究生课程,并计入研究生学分。"
                                    ),
                                    "block_id": 431,
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

        paragraph = next(row for row in rows if row["row_type"] == "paragraph")
        text = str(paragraph["text_normalized"])
        self.assertIn(
            "此部分至少修读6学分。修读建议如下:拟继续深造学生建议选择修读本硕贯通专业选修课程。",
            text,
        )
        self.assertNotIn("修读建议拟继续深造学生建议", text)

    def test_normalize_curriculum_provider_result_repairs_design_summary_major_split(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-design-summary-major-split-repair",
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
                                        '<table><tr><td>培养阶段</td><td>板块名称</td><td colspan="2">类别</td><td>学分设置</td><td>修读性质</td><td>总学时</td><td>理论学时</td><td>实践学时</td></tr>'
                                        '<tr><td rowspan="7">专业培养</td><td rowspan="7">专业教育</td><td rowspan="2">视觉传达设计</td><td>专业核心课</td><td>33</td><td>必修</td><td>1188</td><td>/</td><td>1188</td></tr>'
                                        "<tr><td>专业选修课</td><td>14</td><td>选修</td><td>/</td><td>/</td><td>/</td></tr>"
                                        '<tr><td rowspan="2">视觉传达设计(影像设计)</td><td>专业核心课</td><td>33</td><td>必修</td><td>1152</td><td>36</td><td>1116</td></tr>'
                                        "<tr><td>专业选修课</td><td>14</td><td>选修</td><td>/</td><td>/</td><td>/</td></tr>"
                                        '<tr><td rowspan="2">环境设计</td><td>专业核心课</td><td>33</td><td>必修</td><td>1152</td><td>36</td><td>1116</td></tr>'
                                        "<tr><td>专业选修课</td><td>7</td><td>选修</td><td>/</td><td>/</td><td>/</td></tr>"
                                        "<tr><td>服装与服饰设</td><td>专业核心课</td><td>33</td><td>必修</td><td>1116</td><td>72</td><td>1044</td></tr>"
                                        "<tr><td></td><td></td><td>计</td><td>专业选修课</td><td>5</td><td>选修</td><td>/</td><td>/</td><td>/</td></tr>"
                                        "</table>"
                                    ),
                                    "block_id": 432,
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
        self.assertIn('<tr><td rowspan="8">专业培养</td><td rowspan="8">专业教育</td>', html)
        self.assertIn(
            '<tr><td rowspan="2">服装与服饰设计</td><td>专业核心课</td><td>33</td><td>必修</td><td>1116</td><td>72</td><td>1044</td></tr>',
            html,
        )
        self.assertIn(
            "<tr><td>专业选修课</td><td>5</td><td>选修</td><td>/</td><td>/</td><td>/</td></tr>",
            html,
        )
        self.assertNotIn("<tr><td>服装与服饰设</td>", html)
        self.assertNotIn("<td>计</td><td>专业选修课</td>", html)

    def test_normalize_curriculum_provider_result_repairs_global_competence_placeholder_row(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-global-competence-placeholder-row-repair",
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
                                        "<table><tr><td>课程类</td><td>课程号</td><td>课程名称</td><td>学分</td><td>学时</td><td>实践学时</td><td>开设学期</td><td>备注</td></tr>"
                                        "<tr><td>全球胜任力课程</td><td>学校通开的全球胜任力培养课程</td><td>学校通开的全球胜任力培养课程</td><td>学校通开的全球胜任力培养课程</td><td>学校通开的全球胜任力培养课程</td><td>学校通开的全球胜任力培养课程</td><td>学校通开的全球胜任力培养课程</td><td>建议出国深造学生选修</td></tr>"
                                        "</table>"
                                    ),
                                    "block_id": 44,
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
        self.assertIn(
            "<tr><td>全球胜任力课程</td><td></td><td>学校通开的全球胜任力培养课程</td><td></td><td></td><td></td><td></td><td>建议出国深造学生选修</td></tr>",
            html,
        )
        self.assertEqual(html.count("学校通开的全球胜任力培养课程"), 1)

    def test_normalize_curriculum_provider_result_repairs_industry_label_split(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-industry-label-split-repair",
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
                                        "<table><tr><td>课程类</td><td>课程号</td><td>课程名称</td><td>学分</td><td>学时</td><td>实践学时</td><td>开设学期</td><td>备注</td></tr>"
                                        "<tr><td>行业领域</td><td>新开课</td><td>社会工作实务</td><td>2</td><td>36</td><td>/</td><td>5</td><td>/</td></tr>"
                                        '<tr><td rowspan="2">协同育人课程</td><td>新开课</td><td>选调生与基层治理</td><td>2</td><td>36</td><td>/</td><td>6</td><td>/</td></tr>'
                                        "<tr><td>新开课</td><td>公共政策虚拟仿真</td><td>2</td><td>36</td><td>/</td><td>7</td><td>/</td></tr>"
                                        "</table>"
                                    ),
                                    "block_id": 45,
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
        self.assertIn(
            '<tr><td rowspan="3">行业领域协同育人课程</td><td>新开课</td><td>社会工作实务</td>',
            html,
        )
        self.assertIn(
            "<tr><td>新开课</td><td>选调生与基层治理</td><td>2</td><td>36</td><td>/</td><td>6</td><td>/</td></tr>",
            html,
        )
        self.assertNotIn("<td>行业领域</td>", html)
        self.assertNotIn(">协同育人课程</td>", html)

    def test_normalize_curriculum_provider_result_repairs_biology_cross_course_table(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-biology-table-repair",
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
                                        "<table><tr><td>课程类</td><td>课程号</td><td>课程名称</td><td>学分</td><td>学时</td><td>实践学时</td><td>开设学期</td><td>备注</td></tr>"
                                        '<tr><td rowspan="2">跨学科交叉课程</td><td>1043040223</td><td>民族生物资源与传统知识</td><td>2</td><td>36</td><td>/</td><td>7</td><td rowspan="2">学生可选择修读建议列表中课程,也可根据个人兴趣选择其他专业的</td></tr>'
                                        "<tr><td>1043040194</td><td>民族植物学</td><td>2</td><td>36</td><td>/</td><td>6</td></tr>"
                                        "<tr><td></td><td>1043040603</td><td>化学生物学</td><td>2</td><td>36</td><td>/</td><td>6</td><td>其他课程。此模块建议所有学生选修至少2学分</td></tr>"
                                        "</table>"
                                    ),
                                    "block_id": 42,
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
        self.assertIn('<td rowspan="3">跨学科交叉课程</td>', html)
        self.assertIn(
            '<td rowspan="3">学生可选择修读建议列表中课程,也可根据个人兴趣选择其他专业的其他课程。此模块建议所有学生选修至少2学分</td>',
            html,
        )
        self.assertIn(
            "<tr><td>1043040603</td><td>化学生物学</td><td>2</td><td>36</td><td>/</td><td>6</td></tr>",
            html,
        )
        self.assertNotIn("其他专业的</td>", html)
        self.assertNotIn("<td></td><td>1043040603</td>", html)

    def test_normalize_curriculum_provider_result_repairs_global_competence_label_split(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-global-competence-label-split",
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
                                        "<table><tr><td>课程模块</td><td>课程编号</td><td>课程名称</td><td>学分</td><td>总学时</td><td>实践学时</td><td>开课学期</td><td>备注</td></tr>"
                                        '<tr><td rowspan="2">全球胜任力培</td><td>新开课</td><td>数学专业英语</td><td>2</td><td>36</td><td>/</td><td>6</td><td></td></tr>'
                                        "<tr><td>新开课</td><td>中西方文化</td><td>2</td><td>36</td><td>/</td><td>7</td><td></td></tr>"
                                        '<tr><td rowspan="2">养课程</td><td>新开课</td><td>科技前沿讲座</td><td>1</td><td>18</td><td>/</td><td>7</td><td></td></tr>'
                                        '<tr><td colspan="7">学校相关选修课</td></tr></table>'
                                    ),
                                    "block_id": 88,
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
        self.assertIn('<td rowspan="4">全球胜任力培养课程</td>', html)
        self.assertNotIn(">全球胜任力培<", html)
        self.assertNotIn(">养课程<", html)

    def test_normalize_curriculum_provider_result_merges_cross_page_bridge_row_into_next_paragraph(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-cross-page-bridge-row",
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
                                    "block_bbox": [10, 20, 260, 42],
                                },
                                {
                                    "block_label": "text",
                                    "block_content": "其他页面复现的页眉桥接词。",
                                    "block_id": 2,
                                    "block_order": 2,
                                    "block_bbox": [10, 44, 240, 72],
                                },
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    },
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "text",
                                    "block_content": "为充分对接学生未来发展,此部分至少修读6学分。修读建议",
                                    "block_id": 3,
                                    "block_order": 1,
                                    "block_bbox": [10, 700, 560, 760],
                                },
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    },
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "text",
                                    "block_content": "如下:",
                                    "block_id": 4,
                                    "block_order": 1,
                                    "block_bbox": [10, 20, 80, 42],
                                },
                                {
                                    "block_label": "text",
                                    "block_content": "拟继续深造学生建议选择修读本硕贯通专业选修课程。",
                                    "block_id": 5,
                                    "block_order": 2,
                                    "block_bbox": [10, 60, 420, 110],
                                },
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    },
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "text",
                                    "block_content": "如下:",
                                    "block_id": 6,
                                    "block_order": 1,
                                    "block_bbox": [10, 20, 80, 42],
                                },
                                {
                                    "block_label": "text",
                                    "block_content": "本页正文独立结束。",
                                    "block_id": 7,
                                    "block_order": 2,
                                    "block_bbox": [10, 60, 220, 110],
                                },
                            ]
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    },
                ]
            },
        }

        rows = self._normalize_rows(provider_payload)

        page2_row = next(row for row in rows if row["row_id"].endswith("block-3-0001"))
        bridge_row = next(row for row in rows if row["row_id"].endswith("block-4-0001"))
        merged_row = next(row for row in rows if row["row_id"].endswith("block-5-0002"))
        unrelated_page4_row = next(row for row in rows if row["row_id"].endswith("block-7-0002"))

        self.assertTrue(bridge_row["is_repeated_candidate"])
        self.assertTrue(page2_row["continues_to_next_page"])
        self.assertTrue(merged_row["continues_from_previous_page"])
        self.assertEqual(
            merged_row["text_normalized"],
            "如下:拟继续深造学生建议选择修读本硕贯通专业选修课程。",
        )
        self.assertEqual(unrelated_page4_row["text_normalized"], "本页正文独立结束。")

    def test_normalize_curriculum_provider_result_repairs_public_management_round8_artifacts(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-public-management-round8",
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
                                        "<table><tr><td>一级指标</td><td>二级指标</td><td>三级指标</td></tr>"
                                        '<tr><td rowspan="8">素养目标</td><td>3-3职业素养</td>'
                                        "<td>3-3-1热忱对待公共管理事业,对国家与社会发展</td></tr>"
                                        '<tr><td rowspan="8"></td><td rowspan="2"></td><td>有责任心</td></tr>'
                                        "<tr><td>3-3-2 乐于、甘于投身祖国的公共管理事业</td></tr>"
                                        '<tr><td rowspan="3">2-4沟通与合作能够力</td>'
                                        "<td>2-4-3能够初步地进行专业领域的国际交流</td></tr>"
                                        '<tr><td rowspan="3">2-5批判性思维和创新能力</td>'
                                        "<td>2-5-3形成公共管理学专业所需的人文关怀和实践创新能力</td></tr>"
                                        '<tr><td rowspan="4">3-1政治素养</td>'
                                        "<td>3-1-4具有维护民族团结和祖国统一的使命感和中华民族共同体意识</td></tr>"
                                        '<tr><td rowspan="3">3-2公众素养</td>'
                                        "<td>3-2-3积极践行社会主义核心价值观</td></tr></table>"
                                    ),
                                    "block_id": 1,
                                    "block_order": 1,
                                },
                                {
                                    "block_label": "text",
                                    "block_content": (
                                        "选修列表中的所有课程,原则上两个专业学生均可选修。为区分专业"
                                    ),
                                    "block_id": 2,
                                    "block_order": 2,
                                },
                                {
                                    "block_label": "text",
                                    "block_content": "拟出国学生建议选择修读全球胜任力培养客户。",
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

        table_row = next(row for row in rows if row["row_type"] == "table")
        self.assertIn("2-4沟通与合作能力", table_row["text_normalized"])
        self.assertNotIn("2-4沟通与合作能够力", table_row["text_normalized"])
        self.assertIn(
            "3-3-1 热忱对待公共管理事业,对国家与社会发展有责任心",
            table_row["text_normalized"],
        )
        self.assertNotIn("<td>有责任心</td></tr>", table_row["text_normalized"])
        self.assertIn('rowspan="2">3-3职业素养</td>', table_row["text_normalized"])
        self.assertIn("2-4-3 能够初步地进行专业领域的国际交流", table_row["text_normalized"])
        self.assertIn(
            "2-5-3 形成公共管理学专业所需的人文关怀和实践创新能力",
            table_row["text_normalized"],
        )
        self.assertIn(
            "3-1-4 具有维护民族团结和祖国统一的使命感和中华民族共同体意识",
            table_row["text_normalized"],
        )
        self.assertIn("3-2-3 积极践行社会主义核心价值观", table_row["text_normalized"])
        self.assertEqual(
            rows[1]["text_normalized"],
            "选修列表中的所有课程,原则上两个专业学生均可选修。",
        )
        self.assertEqual(
            rows[2]["text_normalized"],
            "拟出国学生建议选择修读全球胜任力培养课程。",
        )

    def test_normalize_curriculum_provider_result_repairs_basic_literacy_label_split(
        self,
    ) -> None:
        provider_payload = {
            "logId": "log-basic-literacy-split",
            "errorCode": 0,
            "errorMsg": "Success",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_label": "text",
                                    "block_content": "通识教育板块应修学分49学分。",
                                    "block_id": 1,
                                    "block_order": 1,
                                },
                                {
                                    "block_label": "table",
                                    "block_content": (
                                        "<table><tr><td>类别</td><td>课程号</td></tr>"
                                        "<tr><td>基本素</td><td>1042010079</td></tr>"
                                        '<tr><td rowspan="14">养课</td><td>1042010080</td></tr></table>'
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

        self.assertEqual(rows[0]["text_normalized"], "通识教育板块应修49学分。")
        self.assertIn('rowspan="15">基本素养课</td>', rows[1]["text_normalized"])
        self.assertNotIn(">基本素</td>", rows[1]["text_normalized"])
        self.assertNotIn(">养课</td>", rows[1]["text_normalized"])

    def test_repair_minority_preparatory_program_artifacts_fixes_phrases_and_table_groups(
        self,
    ) -> None:
        summary_bad = (
            '<table><tr><td rowspan="2" colspan="2">类别</td><td rowspan="2">学时</td><td colspan="2">各学期周学时分配计划</td></tr>'
            '<tr><td>第一学期</td><td>第二学期</td></tr><tr><td rowspan="2">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr>'
            '<tr><td>主干课</td><td>468</td><td>14</td><td>12</td></tr><tr><td colspan="2">限选课</td><td>144</td><td>4</td><td>4</td></tr>'
            '<tr><td colspan="2">合计</td><td>828</td><td>26</td><td>20</td></tr><tr><td>第一学期</td><td>第二学期</td></tr>'
            '<tr><td rowspan="3">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr><tr><td>主干课</td><td>540</td><td>16</td><td>14</td></tr>'
            '<tr><td>基础课</td><td>144</td><td>4</td><td>4</td></tr><tr><td colspan="2">限选课</td><td>144</td><td>4</td><td>4</td></tr>'
            '<tr><td colspan="2">合计</td><td>1044</td><td>32</td><td>26</td></tr></table>'
        )
        summary_wenke_fragment_bad = (
            '<table><tr><td rowspan="2" colspan="2">类别</td><td rowspan="2">学时</td><td colspan="2">各学期周学时分配计划</td></tr>'
            '<tr><td>第一学期</td><td>第二学期</td></tr><tr><td rowspan="2">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr>'
            '<tr><td>主干课</td><td>468</td><td>14</td><td>12</td></tr><tr><td colspan="2">限选课</td><td>144</td><td>4</td><td>4</td></tr>'
            '<tr><td colspan="2">合计</td><td>828</td><td>26</td><td>20</td></tr></table>'
        )
        summary_like_fragment_bad = (
            '<table><tr><td rowspan="2" colspan="2">类别</td><td rowspan="2">学时</td><td colspan="2">各学期周学时分配计划</td></tr>'
            '<tr><td>第一学期</td><td>第二学期</td></tr><tr><td rowspan="3">必修课</td><td>通识教育课</td><td>216</td><td>8</td><td>4</td></tr>'
            "<tr><td>主干课</td><td>540</td><td>16</td><td>14</td></tr><tr><td>基础课</td><td>144</td><td>4</td><td>4</td></tr>"
            '<tr><td colspan="2">限选课</td><td>144</td><td>4</td><td>4</td></tr><tr><td colspan="2">合计</td><td>1044</td><td>32</td><td>26</td></tr></table>'
        )
        detail_bad = (
            '<table><tr><td rowspan="2">课程类别</td><td rowspan="2">课程编号</td><td rowspan="2">课程名称</td><td rowspan="2">学分</td><td colspan="2">学时</td><td colspan="2">各学期周学时分配</td><td rowspan="2">备注</td></tr>'
            '<tr><td>总计</td><td>其中实践</td><td>1</td><td>2</td></tr><tr><td rowspan="8">通识教育课</td><td>1037010044</td><td>中华民族共同体概论</td><td>2</td><td>36</td><td>/</td><td>2</td><td>/</td><td rowspan="8">必修</td></tr>'
            "<tr><td>1037010040</td><td>形势与政策</td><td>/</td><td>8</td><td>/</td><td>√</td><td>/</td></tr><tr><td>1044020003</td><td>信息素养(一)</td><td>2</td><td>54</td><td>36</td><td>2</td><td>/</td></tr>"
            "<tr><td>1044020004</td><td>信息素养(二)</td><td>2</td><td>54</td><td>36</td><td>/</td><td>2</td></tr><tr><td>1049020001</td><td>大学体育(一)</td><td>1</td><td>36</td><td>36</td><td>2</td><td>/</td></tr>"
            "<tr><td>1049020002</td><td>大学体育(二)</td><td>1</td><td>36</td><td>36</td><td>/</td><td>2</td></tr><tr><td>000000006</td><td>心理健康</td><td>0</td><td>36</td><td>16</td><td>2</td><td>/</td></tr>"
            '<tr><td>0011010036</td><td>劳动教育</td><td>/</td><td>10</td><td>10</td><td>√</td><td>√</td></tr><tr><td rowspan="7">主干课</td><td>1052030033</td><td>大学语文(一)</td><td>4</td><td>72</td><td>12</td><td>4</td><td>/</td><td rowspan="7">必修</td></tr>'
            "<tr><td>1052030034</td><td>大学语文(二)</td><td>4</td><td>72</td><td>12</td><td>/</td><td>4</td></tr><tr><td>1052030068</td><td>实用写作</td><td>2</td><td>36</td><td>8</td><td>2</td><td>/</td></tr>"
            "<tr><td>1052030031</td><td>高等数学(一)</td><td>4</td><td>72</td><td>12</td><td>4</td><td>/</td></tr><tr><td>1052030032</td><td>高等数学(二)</td><td>4</td><td>72</td><td>12</td><td>/</td><td>4</td></tr>"
            '<tr><td>1042010079</td><td>大学英语(一)</td><td>2</td><td>72</td><td>36</td><td>4</td><td>/</td></tr><tr><td>1042010080</td><td>大学英语(二)</td><td>2</td><td>72</td><td>36</td><td>/</td><td>4</td></tr><tr><td rowspan="3">语文限选课</td><td>1052040014</td><td>中国古代文学经典选读</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td><td rowspan="3">选修:每学期选一门,两学期不得重复选修同一门课。</td></tr>'
            "<tr><td>1052040015</td><td>文学鉴赏与写作</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr><tr><td>1052040012</td><td>普通话语音辨正</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr>"
            '<tr><td rowspan="3">英语限选课</td><td>1052030049</td><td>英语视听说</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td><td rowspan="3">选修:每学期选一门,两学期不得重复选修同一门课。</td></tr><tr><td>1052030050</td><td>英语阅读训练</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr>'
            '<tr><td>1052030051</td><td>英语实用写作</td><td>2</td><td>36</td><td>/</td><td>2</td><td>2</td></tr><tr><td rowspan="3">任选课</td><td>1052040016</td><td>小说创作</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td rowspan="3">选修:根据兴趣及需求选修,可多选</td></tr>'
            "<tr><td>1052040017</td><td>唐诗名家十五讲</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr><tr><td>1052040018</td><td>文学与人生</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td></tr><tr><td></td><td>1052040019</td><td>中西文化专题</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td></td></tr>"
            "<tr><td></td><td>1052040020</td><td>神话导读</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td></td></tr><tr><td></td><td>1052040021</td><td>大学数学导引</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td></td></tr><tr><td></td><td>1052030054</td><td>英语语音语调</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td></td></tr>"
            "<tr><td></td><td>1052040013</td><td>英语语法基础与提高</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td></td></tr><tr><td></td><td>1052040022</td><td>英美原著选读</td><td>2</td><td>36</td><td>/</td><td>/</td><td>/</td><td></td></tr></table>"
        )
        detail_second_table_bad = (
            '<table><tr><td rowspan="2">课程类别</td><td rowspan="2">课程编号</td>'
            '<td rowspan="2">课程名称</td><td rowspan="2">学分</td><td colspan="2">学时</td>'
            '<td colspan="2">各学期周学时分配</td><td rowspan="2">备注</td></tr>'
            "<tr><td>总计</td><td>其中实践</td><td>1</td><td>2</td></tr>"
            '<tr><td rowspan="2">基础课</td><td>1052030065</td><td>普通化学</td><td></td>'
            '<td>72</td><td>18</td><td>4</td><td>/</td><td rowspan="2">必修(实验18学时)</td></tr>'
            "<tr><td>1052030066</td><td>大学物理</td><td></td><td>72</td><td>18</td><td>/</td><td>4</td></tr></table>"
        )

        repaired = _repair_minority_preparatory_program_artifacts(
            "\n".join(
                [
                    "融合课堂教学、自主学习、实践活动、指导帮扶、文化引领为一体、根据教学内容和学生特点",
                    "大学体育、心理健康主干课程:大学语文、实用写作、高等数学、大学英语",
                    "基础课程:理科班增设普通化学和大学物理",
                    "大学体育、心理健康主干课程:大学语文、实用写作、高等数学、大学英语基础课程:理科班增设普通化学和大学物理",
                    summary_bad,
                    detail_bad,
                    detail_second_table_bad,
                ]
            )
        )

        self.assertIn("文化引领为一体,根据教学内容和学生特点", repaired)
        self.assertIn(
            "大学体育、心理健康。主干课程:大学语文、实用写作、高等数学、大学英语。基础课程:理科班增设普通化学和大学物理。",
            repaired,
        )
        self.assertIn(
            "大学体育、心理健康。主干课程:大学语文、实用写作、高等数学、大学英语。", repaired
        )
        self.assertIn("基础课程:理科班增设普通化学和大学物理。", repaired)
        self.assertIn('<td colspan="5">文科班</td>', repaired)
        self.assertIn('<td colspan="5">理科班</td>', repaired)
        self.assertIn('<td colspan="9">文科班</td>', repaired)
        self.assertEqual(repaired.count('<td colspan="9">理科班</td>'), 1)
        self.assertNotIn("文化引领为一体、根据教学内容和学生特点", repaired)
        self.assertNotIn("大学体育、心理健康主干课程", repaired)

        split_repaired = _repair_minority_preparatory_program_artifacts(
            "\n".join([summary_wenke_fragment_bad, summary_like_fragment_bad])
        )
        self.assertEqual(split_repaired.count('<td colspan="5">文科班</td>'), 1)
        self.assertEqual(split_repaired.count('<td colspan="5">理科班</td>'), 1)

    def test_repair_ethnology_second_bachelor_table_artifact_fixes_rowspan_and_header_noise(
        self,
    ) -> None:
        owner_repaired = _repair_ethnology_second_bachelor_table_artifact(
            "<table>"
            '<tr><td rowspan="2" colspan="2">课程类别</td><td rowspan="2">课程编号</td><td rowspan="2">课程名称</td><td rowspan="2">学分</td><td colspan="2">学时</td><td colspan="4">各学期周学时分配</td></tr>'
            "<tr><td>总计</td><td>其中实践</td><td>1</td><td>2</td><td>3</td><td>4</td></tr>"
            '<tr><td rowspan="13">专业教育</td><td rowspan="13">专业必修课共30学分</td><td>民族学理论与方法</td></tr>'
            "</table>"
        )
        continuation_input = (
            "<table>"
            '<tr><td rowspan="3">课程类别</td><td rowspan="2">课程编号</td><td rowspan="2">课程名称</td><td rowspan="2">学分</td><td colspan="2">学时</td><td colspan="4">各学期周学时分配</td></tr>'
            "<tr><td>总计</td><td>其中实践</td><td>1</td><td>2</td><td>3</td><td>4</td></tr>"
            "<tr><td>1026030062</td><td>经济人类学(全英文)</td><td>2</td><td>36</td><td></td><td></td><td>2</td><td></td><td></td></tr>"
            "<tr><td>专业选修课须修满12学分</td><td>1026040121</td></tr>"
            "</table>"
        )
        continuation_repaired = _repair_ethnology_second_bachelor_table_artifact(continuation_input)

        self.assertIn(
            'rowspan="34">专业教育</td><td rowspan="14">专业必修课共30学分</td>',
            owner_repaired,
        )
        self.assertNotIn(
            'rowspan="13">专业教育</td><td rowspan="13">专业必修课共30学分</td>',
            owner_repaired,
        )
        self.assertEqual(continuation_repaired, continuation_input)

    def test_repair_paleography_program_table_artifacts_fixes_bad_label_and_hours(
        self,
    ) -> None:
        repaired = _repair_paleography_program_table_artifacts(
            "<table>"
            "<tr><td>类别</td><td>说明</td></tr>"
            "<tr><td>全球胜任力培养</td><td>建议修读</td></tr>"
            "<tr><td>思政课</td><td>19</td><td>必修</td><td>370</td><td>350</td><td>120</td></tr>"
            "</table>"
        )

        self.assertIn(">全球胜任力培养课程<", repaired)
        self.assertIn(
            "<td>思政课</td><td>19</td><td>必修</td><td>370</td><td>250</td><td>120</td>", repaired
        )
        self.assertNotIn(">全球胜任力培养<", repaired)
        self.assertNotIn("<td>370</td><td>350</td><td>120</td>", repaired)

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


if __name__ == "__main__":
    unittest.main()
