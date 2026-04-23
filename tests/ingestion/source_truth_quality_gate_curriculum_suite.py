from __future__ import annotations

import json
import unittest
from pathlib import Path

from campus_ingestion_core.curriculum_provider_normalize import normalize_curriculum_provider_result
from campus_ingestion_core.curriculum_source_truth_validation import (
    FORBIDDEN_SOURCE_TRUTH_FIELDS as CURRICULUM_FORBIDDEN_SOURCE_TRUTH_FIELDS,
)
from campus_ingestion_core.curriculum_source_truth_validation import (
    scan_curriculum_source_truth_rows,
)


def _curriculum_rows_from_payload(provider_payload: dict[str, object]) -> list[dict[str, object]]:
    return [
        json.loads(line)
        for line in normalize_curriculum_provider_result(
            provider_jsonl_bytes=(json.dumps(provider_payload, ensure_ascii=False) + "\n").encode(
                "utf-8"
            ),
            source_pdf="curriculum-plan.pdf",
            ocr_provider="mineru_api",
            ocr_model="vlm",
        )
        .decode("utf-8")
        .splitlines()
        if line.strip()
    ]


def _real_curriculum_fixture_rows() -> list[dict[str, object]]:
    fixture_path = Path("tests/fixtures/curriculum_plan/layout-elements.pages-278-297.jsonl")
    return [
        json.loads(line)
        for line in fixture_path.read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def _provider_curriculum_fixture_rows() -> list[dict[str, object]]:
    fixture_path = Path("tests/fixtures/curriculum_plan/provider-result-sample.jsonl")
    return [
        json.loads(line)
        for line in normalize_curriculum_provider_result(
            provider_jsonl_bytes=fixture_path.read_bytes(),
            source_pdf="curriculum-plan-2022.pdf",
            ocr_provider="mineru_api",
            ocr_model="vlm",
        )
        .decode("utf-8")
        .splitlines()
        if line.strip()
    ]


def _assert_no_forbidden_source_truth_fields(
    test_case: unittest.TestCase,
    rows: list[dict[str, object]],
    *,
    forbidden_fields: frozenset[str],
) -> None:
    for row in rows:
        test_case.assertFalse(forbidden_fields & set(row.keys()), row)


class SourceTruthQualityGateCurriculumTest(unittest.TestCase):

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
                                            '<tr><td rowspan="2">核心课</td><td>微观经济学</td><td>3</td></tr>'
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

        _assert_no_forbidden_source_truth_fields(
            self,
            rows,
            forbidden_fields=CURRICULUM_FORBIDDEN_SOURCE_TRUTH_FIELDS,
        )
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

        _assert_no_forbidden_source_truth_fields(
            self,
            rows,
            forbidden_fields=CURRICULUM_FORBIDDEN_SOURCE_TRUTH_FIELDS,
        )
        self.assertTrue(bool(rows[0]["continues_to_next_page"]))
        self.assertTrue(bool(rows[1]["continues_from_previous_page"]))

    def test_curriculum_quality_gate_real_fixture_regression(self) -> None:
        rows = _real_curriculum_fixture_rows()

        _assert_no_forbidden_source_truth_fields(
            self,
            rows,
            forbidden_fields=CURRICULUM_FORBIDDEN_SOURCE_TRUTH_FIELDS,
        )
        self.assertTrue(rows)
        self.assertTrue(
            all(row["schema_version"] == "curriculum_layout_elements_v3" for row in rows)
        )
        self.assertGreaterEqual(sum(row["row_type"] == "heading" for row in rows), 10)
        self.assertGreaterEqual(sum(bool(row["is_repeated_candidate"]) for row in rows), 2)
        self.assertGreaterEqual(sum(bool(row.get("table_fragment_id")) for row in rows), 2)
        self.assertTrue(any(row.get("parent_heading_hint") == "(一)素质要求" for row in rows))
        self.assertTrue(any(row.get("section_hint") == "section" for row in rows))
        self.assertTrue(any(row.get("section_hint") == "subsection" for row in rows))

    def test_curriculum_quality_gate_provider_fixture_regression(self) -> None:
        rows = _provider_curriculum_fixture_rows()

        _assert_no_forbidden_source_truth_fields(
            self,
            rows,
            forbidden_fields=CURRICULUM_FORBIDDEN_SOURCE_TRUTH_FIELDS,
        )
        self.assertEqual(len(rows), 21)
        self.assertEqual(sum(row["row_type"] == "footer" for row in rows), 4)
        self.assertEqual(sum(row["row_type"] == "table" for row in rows), 2)
        self.assertEqual(sum(row["row_type"] == "table_caption" for row in rows), 2)
        self.assertTrue(any(bool(row.get("continues_to_next_page")) for row in rows))
        self.assertTrue(any(bool(row.get("continues_from_previous_page")) for row in rows))
        self.assertTrue(any(row.get("section_hint") == "section" for row in rows))
        self.assertTrue(any(row.get("section_hint") == "subsection" for row in rows))

    def test_curriculum_source_truth_validation_passes_provider_fixture(self) -> None:
        report = scan_curriculum_source_truth_rows(_provider_curriculum_fixture_rows())

        self.assertEqual(report.total_rows, 21)
        self.assertEqual(report.row_type_counts["table"], 2)
        self.assertEqual(report.row_type_counts["footer"], 4)
        self.assertEqual(report.forbidden_field_count, 0)
        self.assertEqual(report.heading_role_conflict_count, 0)
        self.assertEqual(report.page_number_leak_count, 0)
        self.assertEqual(report.footer_leak_count, 0)
        self.assertEqual(report.orphan_caption_count, 0)
        self.assertEqual(report.orphan_note_count, 0)
        self.assertEqual(report.broken_table_continuation_count, 0)
        self.assertEqual(report.cross_page_continuation_miss_count, 0)
        self.assertEqual(report.section_hint_missing_count, 0)
        self.assertEqual(report.parent_heading_hint_missing_count, 0)
        self.assertEqual(report.reading_order_gap_count, 0)
        self.assertTrue(report.passed)

    def test_curriculum_source_truth_validation_flags_structural_regressions(self) -> None:
        malformed_rows = [
            {
                "row_id": "row-001",
                "row_type": "heading",
                "block_role": "paragraph_title",
                "heading_level": None,
                "text_normalized": "一、培养目标",
                "page_start": 1,
                "reading_order": 1,
                "section_hint": None,
            },
            {
                "row_id": "row-002",
                "row_type": "paragraph",
                "block_role": "number",
                "heading_level": None,
                "text_normalized": "12",
                "page_start": 1,
                "reading_order": 3,
            },
            {
                "row_id": "row-003",
                "row_type": "table_caption",
                "block_role": "figure_title",
                "heading_level": None,
                "text_normalized": "表 1 课程设置",
                "page_start": 1,
                "reading_order": 4,
                "relation_type": "caption_of",
                "owner_row_id": "missing-row",
                "continuation_group_id": "missing-row",
            },
            {
                "row_id": "row-004",
                "row_type": "table",
                "block_role": "table",
                "heading_level": None,
                "text_normalized": "<table></table>",
                "page_start": 2,
                "reading_order": 1,
                "relation_type": "table_continuation",
                "owner_row_id": "missing-row",
                "continuation_group_id": "wrong-group",
            },
            {
                "row_id": "row-005",
                "row_type": "paragraph",
                "block_role": "text",
                "heading_level": None,
                "text_normalized": "培养具备扎实基础和创新能力，",
                "page_start": 3,
                "reading_order": 1,
                "continues_to_next_page": False,
                "list_level_hint": 1,
                "parent_heading_hint": None,
                "clean_text": "forbidden",
            },
            {
                "row_id": "row-006",
                "row_type": "paragraph",
                "block_role": "text",
                "heading_level": None,
                "text_normalized": "能够服务国家战略与社会发展。",
                "page_start": 4,
                "reading_order": 1,
                "continues_from_previous_page": False,
            },
        ]

        report = scan_curriculum_source_truth_rows(malformed_rows)

        self.assertEqual(report.forbidden_field_count, 1)
        self.assertEqual(report.heading_role_conflict_count, 1)
        self.assertEqual(report.page_number_leak_count, 1)
        self.assertEqual(report.orphan_caption_count, 1)
        self.assertEqual(report.broken_table_continuation_count, 1)
        self.assertEqual(report.cross_page_continuation_miss_count, 1)
        self.assertEqual(report.section_hint_missing_count, 1)
        self.assertEqual(report.parent_heading_hint_missing_count, 1)
        self.assertEqual(report.reading_order_gap_count, 1)
        self.assertFalse(report.passed)

    def test_curriculum_provider_normalize_rejects_source_truth_validation_failures(self) -> None:
        provider_payload = {
            "logId": "quality-gate-invalid-curriculum",
            "result": {
                "layoutParsingResults": [
                    {
                        "prunedResult": {
                            "height": 1000,
                            "parsing_res_list": [
                                {
                                    "block_label": "number",
                                    "block_content": "12",
                                    "block_id": 11,
                                    "block_order": 1,
                                    "block_bbox": [200, 200, 240, 240],
                                }
                            ],
                        },
                        "markdown": {"text": "ignored", "images": {}},
                    }
                ]
            },
        }

        with self.assertRaisesRegex(ValueError, "curriculum source truth validation failed"):
            normalize_curriculum_provider_result(
                provider_jsonl_bytes=(json.dumps(provider_payload, ensure_ascii=False) + "\n").encode(
                    "utf-8"
                ),
                source_pdf="curriculum-plan.pdf",
                ocr_provider="mineru_api",
                ocr_model="vlm",
            )


if __name__ == "__main__":
    unittest.main()
