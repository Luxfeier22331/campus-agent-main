from __future__ import annotations

import json
from pathlib import Path
import unittest

from campus_ingestion_core.curriculum_provider_normalize import normalize_curriculum_provider_result
from campus_ingestion_core.handbook_provider_normalize import normalize_handbook_provider_result


_FORBIDDEN_SOURCE_TRUTH_FIELDS = {"clean_text", "chunk_id", "doc_id", "document_id", "version_id", "semantic_confidence"}


def _handbook_batch(*pages: dict[str, object]) -> bytes:
    return (
        json.dumps(
            {
                "result": {
                    "dataInfo": {
                        "numPages": len(pages),
                        "pages": [{"width": 828, "height": 1151} for _ in pages],
                        "type": "pdf",
                    },
                    "layoutParsingResults": list(pages),
                },
            },
            ensure_ascii=False,
        )
        + "\n"
    ).encode("utf-8")


def _handbook_page(*blocks: dict[str, object]) -> dict[str, object]:
    return {
        "prunedResult": {
            "page_count": 1,
            "width": 828,
            "height": 1151,
            "parsing_res_list": list(blocks),
        }
    }


def _handbook_block(
    block_label: str,
    text: str,
    *,
    block_id: str,
    block_order: int,
    block_bbox: list[float],
) -> dict[str, object]:
    return {
        "block_id": block_id,
        "block_label": block_label,
        "block_content": text,
        "block_order": block_order,
        "block_bbox": block_bbox,
    }


def _curriculum_rows_from_payload(provider_payload: dict[str, object]) -> list[dict[str, object]]:
    return [
        json.loads(line)
        for line in normalize_curriculum_provider_result(
            provider_jsonl_bytes=(json.dumps(provider_payload, ensure_ascii=False) + "\n").encode("utf-8"),
            source_pdf="curriculum-plan.pdf",
            ocr_model="PaddleOCR-VL-1.5",
        ).decode("utf-8").splitlines()
        if line.strip()
    ]


def _real_curriculum_fixture_rows() -> list[dict[str, object]]:
    fixture_path = Path("tests/fixtures/curriculum_plan/structured-full.pages-278-297.jsonl")
    return [json.loads(line) for line in fixture_path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _assert_no_forbidden_source_truth_fields(test_case: unittest.TestCase, rows: list[dict[str, object]]) -> None:
    for row in rows:
        test_case.assertFalse(_FORBIDDEN_SOURCE_TRUTH_FIELDS & set(row.keys()), row)


class SourceTruthQualityGateTest(unittest.TestCase):
    def test_handbook_quality_gate_covers_heading_repeat_page_number_and_table_hints(self) -> None:
        rows = normalize_handbook_provider_result(
            source_pdf="学生手册_2018.pdf",
            provider_jsonl_bytes=_handbook_batch(
                _handbook_page(
                    _handbook_block("doc_title", "中央民族大学学生手册", block_id="p1-title", block_order=1, block_bbox=[0, 140, 300, 180]),
                    _handbook_block("aside_text", "学生手册", block_id="p1-header", block_order=2, block_bbox=[0, 0, 120, 18]),
                    _handbook_block(
                        "text",
                        "第一条 学生应当遵守学校规定，",
                        block_id="p1-body",
                        block_order=3,
                        block_bbox=[0, 220, 420, 280],
                    ),
                    _handbook_block(
                        "table",
                        "<table><tr><td>单位名称</td><td>电话号码</td></tr><tr><td>校园110</td><td>68932220</td></tr></table>",
                        block_id="p1-table",
                        block_order=4,
                        block_bbox=[0, 320, 500, 520],
                    ),
                    _handbook_block("number", "12", block_id="p1-page", block_order=5, block_bbox=[360, 1090, 420, 1130]),
                ),
                _handbook_page(
                    _handbook_block(
                        "text",
                        "积极参与校园活动。",
                        block_id="p2-body",
                        block_order=1,
                        block_bbox=[0, 140, 420, 200],
                    ),
                    _handbook_block(
                        "table",
                        "<table><tr><td>单位名称</td><td>电话号码</td></tr><tr><td>保卫处</td><td>68930000</td></tr></table>",
                        block_id="p2-table",
                        block_order=2,
                        block_bbox=[0, 250, 500, 450],
                    ),
                    _handbook_block("aside_text", "学生手册", block_id="p2-header", block_order=3, block_bbox=[0, 0, 120, 18]),
                ),
            ),
            ocr_provider="paddleocr_async",
            ocr_model="PaddleOCR-VL-1.5",
        )

        _assert_no_forbidden_source_truth_fields(self, rows)
        title_row = next(row for row in rows if row["block_role"] == "title")
        repeated_headers = [row for row in rows if row["text_normalized"] == "学生手册"]
        page_number_row = next(row for row in rows if row["row_type"] == "page_number")
        first_table = next(row for row in rows if row["provider_block_id"] == "p1-table")
        second_table = next(row for row in rows if row["provider_block_id"] == "p2-table")
        first_paragraph = next(row for row in rows if row["provider_block_id"] == "p1-body")
        second_paragraph = next(row for row in rows if row["provider_block_id"] == "p2-body")

        self.assertEqual(title_row["row_type"], "heading")
        self.assertEqual(title_row["heading_level"], 1)
        self.assertEqual(len(repeated_headers), 2)
        self.assertTrue(all(bool(row["is_repeated_candidate"]) for row in repeated_headers))
        self.assertTrue(all(row["repeat_position_band"] == "top" for row in repeated_headers))
        self.assertTrue(all(row["repeat_frequency"] == 2 for row in repeated_headers))
        self.assertEqual(page_number_row["block_role"], "page_number")
        self.assertEqual(first_table["table_header_rows"], [["单位名称", "电话号码"]])
        self.assertEqual(first_table["table_row_count"], 2)
        self.assertEqual(first_table["table_column_count"], 2)
        self.assertEqual(first_table["table_fragment_id"], second_table["table_fragment_id"])
        self.assertTrue(bool(first_paragraph["continues_to_next_page"]))
        self.assertTrue(bool(second_paragraph["continues_from_previous_page"]))

    def test_handbook_quality_gate_real_fixture_regression(self) -> None:
        rows = normalize_handbook_provider_result(
            source_pdf="学生手册_2018.pdf",
            provider_jsonl_bytes=Path("tests/fixtures/student_handbook/provider-result-updated.jsonl").read_bytes(),
            ocr_provider="paddleocr_async",
            ocr_model="PaddleOCR-VL-1.5",
        )

        _assert_no_forbidden_source_truth_fields(self, rows)
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["schema_version"], "student_handbook_layout_elements_v3")
        self.assertEqual(rows[0]["row_type"], "heading")
        self.assertEqual(rows[0]["text_normalized"], "中央民族大学奖学金评定办法")
        self.assertEqual(rows[1]["row_type"], "paragraph")
        self.assertEqual(rows[1]["text_normalized"], "第一条 奖学金评定坚持公开、公平、公正,并接受监督。")

    def test_curriculum_quality_gate_covers_heading_repeat_footer_and_table_semantics(self) -> None:
        rows = _curriculum_rows_from_payload(
            {
                "logId": "quality-gate-curriculum",
                "result": {
                    "layoutParsingResults": [
                        {
                            "prunedResult": {
                                "height": 1000,
                                "parsing_res_list": [
                                    {
                                        "block_label": "paragraph_title",
                                        "block_content": "一、培养目标",
                                        "block_id": 11,
                                        "block_order": 1,
                                        "block_bbox": [10, 20, 260, 60],
                                    },
                                    {
                                        "block_label": "figure_title",
                                        "block_content": "表 1 课程设置",
                                        "block_id": 13,
                                        "block_order": 2,
                                        "block_bbox": [10, 120, 220, 150],
                                    },
                                    {
                                        "block_label": "table",
                                        "block_content": (
                                            "<table>"
                                            "<tr><th>类别</th><th>课程</th><th>学分</th></tr>"
                                            "<tr><td rowspan=\"2\">核心课</td><td>微观经济学</td><td>3</td></tr>"
                                            "</table>"
                                        ),
                                        "block_id": 14,
                                        "block_order": 3,
                                        "block_bbox": [10, 180, 520, 400],
                                    },
                                    {
                                        "block_label": "footer",
                                        "block_content": "中央民族大学教务处",
                                        "block_id": 15,
                                        "block_order": 4,
                                        "block_bbox": [20, 920, 220, 950],
                                    },
                                ],
                            },
                            "markdown": {"text": "ignored", "images": {}},
                        },
                        {
                            "prunedResult": {
                                "height": 1000,
                                "parsing_res_list": [
                                    {
                                        "block_label": "figure_title",
                                        "block_content": "续表 1 课程设置",
                                        "block_id": 22,
                                        "block_order": 1,
                                        "block_bbox": [10, 120, 220, 150],
                                    },
                                    {
                                        "block_label": "table",
                                        "block_content": (
                                            "<table>"
                                            "<tr><th>类别</th><th>课程</th><th>学分</th></tr>"
                                            "<tr><td>核心课</td><td>宏观经济学</td><td>3</td></tr>"
                                            "</table>"
                                        ),
                                        "block_id": 23,
                                        "block_order": 2,
                                        "block_bbox": [10, 180, 520, 360],
                                    },
                                    {
                                        "block_label": "vision_footnote",
                                        "block_content": "备注：实验班学生必修。",
                                        "block_id": 24,
                                        "block_order": 3,
                                        "block_bbox": [10, 380, 520, 420],
                                    },
                                    {
                                        "block_label": "footer",
                                        "block_content": "中央民族大学教务处",
                                        "block_id": 25,
                                        "block_order": 4,
                                        "block_bbox": [20, 920, 220, 950],
                                    },
                                ],
                            },
                            "markdown": {"text": "ignored", "images": {}},
                        },
                    ]
                },
            }
        )

        _assert_no_forbidden_source_truth_fields(self, rows)
        heading_row = next(row for row in rows if row["provider_block_id"] == "11")
        first_table = next(row for row in rows if row["provider_block_id"] == "14")
        second_caption = next(row for row in rows if row["provider_block_id"] == "22")
        second_table = next(row for row in rows if row["provider_block_id"] == "23")
        note_row = next(row for row in rows if row["provider_block_id"] == "24")
        repeated_rows = [row for row in rows if row["text_normalized"] == "中央民族大学教务处"]

        self.assertEqual(heading_row["row_type"], "heading")
        self.assertEqual(heading_row["heading_level"], 2)
        self.assertEqual(len(repeated_rows), 2)
        self.assertTrue(all(bool(row["is_repeated_candidate"]) for row in repeated_rows))
        self.assertTrue(all(row["repeat_position_band"] == "bottom" for row in repeated_rows))
        self.assertEqual(first_table["table_header_rows"], [["类别", "课程", "学分"]])
        self.assertEqual(first_table["table_row_count"], 2)
        self.assertEqual(first_table["table_column_count"], 3)
        self.assertTrue(bool(first_table["table_has_merged_cells"]))
        self.assertEqual(second_caption["relation_type"], "caption_of")
        self.assertEqual(second_table["relation_type"], "table_continuation")
        self.assertEqual(second_table["owner_row_id"], first_table["row_id"])
        self.assertEqual(second_table["continuation_group_id"], first_table["row_id"])
        self.assertEqual(second_table["table_fragment_id"], first_table["table_fragment_id"])
        self.assertEqual(note_row["relation_type"], "note_of")
        self.assertEqual(note_row["owner_row_id"], second_table["row_id"])

    def test_curriculum_quality_gate_covers_cross_page_continuation_hint(self) -> None:
        rows = _curriculum_rows_from_payload(
            {
                "logId": "quality-gate-curriculum-continuation",
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
                                        "block_bbox": [10, 80, 520, 140],
                                    }
                                ],
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
                                        "block_bbox": [10, 30, 520, 90],
                                    }
                                ],
                            },
                            "markdown": {"text": "ignored", "images": {}},
                        },
                    ]
                },
            }
        )

        _assert_no_forbidden_source_truth_fields(self, rows)
        self.assertTrue(bool(rows[0]["continues_to_next_page"]))
        self.assertTrue(bool(rows[1]["continues_from_previous_page"]))

    def test_curriculum_quality_gate_real_fixture_regression(self) -> None:
        rows = _real_curriculum_fixture_rows()

        _assert_no_forbidden_source_truth_fields(self, rows)
        self.assertTrue(rows)
        self.assertTrue(all(row["schema_version"] == "curriculum_layout_elements_v3" for row in rows))
        self.assertGreaterEqual(sum(row["row_type"] == "heading" for row in rows), 10)
        self.assertGreaterEqual(sum(bool(row["is_repeated_candidate"]) for row in rows), 2)
        self.assertGreaterEqual(sum(bool(row.get("table_fragment_id")) for row in rows), 2)
        self.assertTrue(any(row.get("parent_heading_hint") == "(一)素质要求" for row in rows))
        self.assertTrue(any(row.get("section_hint") == "section" for row in rows))
        self.assertTrue(any(row.get("section_hint") == "subsection" for row in rows))


if __name__ == "__main__":
    unittest.main()
