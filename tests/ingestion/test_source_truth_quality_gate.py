from __future__ import annotations

import json
import unittest
from pathlib import Path

from campus_ingestion_core.handbook_provider_normalize import normalize_handbook_provider_result
from campus_ingestion_core.handbook_source_truth_validation import (
    FORBIDDEN_SOURCE_TRUTH_FIELDS as HANDBOOK_FORBIDDEN_SOURCE_TRUTH_FIELDS,
)
from campus_ingestion_core.handbook_source_truth_validation import (
    scan_handbook_source_truth_rows,
)

from tests.ingestion.source_truth_quality_gate_curriculum_suite import *


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


def _assert_no_forbidden_source_truth_fields(
    test_case: unittest.TestCase,
    rows: list[dict[str, object]],
    *,
    forbidden_fields: frozenset[str],
) -> None:
    for row in rows:
        test_case.assertFalse(forbidden_fields & set(row.keys()), row)


class SourceTruthQualityGateTest(unittest.TestCase):
    def test_handbook_quality_gate_covers_heading_repeat_page_number_and_table_hints(self) -> None:
        rows = normalize_handbook_provider_result(
            source_pdf="学生手册_2018.pdf",
            provider_jsonl_bytes=_handbook_batch(
                _handbook_page(
                    _handbook_block(
                        "doc_title",
                        "示例大学学生手册",
                        block_id="p1-title",
                        block_order=1,
                        block_bbox=[0, 140, 300, 180],
                    ),
                    _handbook_block(
                        "aside_text",
                        "学生手册",
                        block_id="p1-header",
                        block_order=2,
                        block_bbox=[0, 0, 120, 18],
                    ),
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
                    _handbook_block(
                        "number",
                        "12",
                        block_id="p1-page",
                        block_order=5,
                        block_bbox=[360, 1090, 420, 1130],
                    ),
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
                    _handbook_block(
                        "aside_text",
                        "学生手册",
                        block_id="p2-header",
                        block_order=3,
                        block_bbox=[0, 0, 120, 18],
                    ),
                ),
            ),
            ocr_provider="mineru_api",
            ocr_model="vlm",
        )

        _assert_no_forbidden_source_truth_fields(
            self,
            rows,
            forbidden_fields=HANDBOOK_FORBIDDEN_SOURCE_TRUTH_FIELDS,
        )
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

    def test_handbook_quality_gate_marks_repeated_margin_running_headers(self) -> None:
        rows = normalize_handbook_provider_result(
            source_pdf="学生手册_2018.pdf",
            provider_jsonl_bytes=_handbook_batch(
                _handbook_page(
                    _handbook_block(
                        "aside_text",
                        "学生手册",
                        block_id="p1-header",
                        block_order=1,
                        block_bbox=[39, 220, 68, 373],
                    ),
                    _handbook_block(
                        "text",
                        "第十二条 本科学生国家奖学金按以下程序进行评选:",
                        block_id="p1-body",
                        block_order=2,
                        block_bbox=[118, 190, 971, 328],
                    ),
                ),
                _handbook_page(
                    _handbook_block(
                        "aside_text",
                        "学生手册",
                        block_id="p2-header",
                        block_order=1,
                        block_bbox=[39, 220, 68, 373],
                    ),
                    _handbook_block(
                        "text",
                        "党委学生工作部、学生处组织学校评审委员会召开评审会进行评审。",
                        block_id="p2-body",
                        block_order=2,
                        block_bbox=[116, 188, 970, 330],
                    ),
                ),
            ),
            ocr_provider="mineru_api",
            ocr_model="vlm",
        )

        repeated_headers = [row for row in rows if row["text_normalized"] == "学生手册"]
        self.assertEqual(len(repeated_headers), 2)
        self.assertTrue(all(bool(row["is_repeated_candidate"]) for row in repeated_headers))
        self.assertTrue(all(row["repeat_position_band"] == "margin" for row in repeated_headers))
        self.assertTrue(all(row["repeat_frequency"] == 2 for row in repeated_headers))

    def test_handbook_quality_gate_real_fixture_regression(self) -> None:
        rows = normalize_handbook_provider_result(
            source_pdf="学生手册_2018.pdf",
            provider_jsonl_bytes=Path(
                "packages/ingestion-core/testdata/student_handbook/provider-result-updated.synthetic.jsonl"
            ).read_bytes(),
            ocr_provider="mineru_api",
            ocr_model="vlm",
        )

        _assert_no_forbidden_source_truth_fields(
            self,
            rows,
            forbidden_fields=HANDBOOK_FORBIDDEN_SOURCE_TRUTH_FIELDS,
        )
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["schema_version"], "student_handbook_layout_elements_v3")
        self.assertEqual(rows[0]["row_type"], "heading")
        self.assertEqual(rows[0]["text_normalized"], "示例奖学金评定办法")
        self.assertEqual(rows[1]["row_type"], "paragraph")
        self.assertEqual(
            rows[1]["text_normalized"], "第一条 奖学金评定坚持公开、公平、公正,并接受监督。"
        )

    def test_handbook_source_truth_validation_passes_mineru_fixture(self) -> None:
        rows = normalize_handbook_provider_result(
            source_pdf="学生手册_2018.pdf",
            provider_jsonl_bytes=_handbook_batch(
                _handbook_page(
                    _handbook_block(
                        "doc_title",
                        "示例大学学生手册",
                        block_id="p1-title",
                        block_order=1,
                        block_bbox=[0, 140, 300, 180],
                    ),
                    _handbook_block(
                        "aside_text",
                        "学生手册",
                        block_id="p1-header",
                        block_order=2,
                        block_bbox=[0, 0, 120, 18],
                    ),
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
                    _handbook_block(
                        "number",
                        "12",
                        block_id="p1-page",
                        block_order=5,
                        block_bbox=[360, 1090, 420, 1130],
                    ),
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
                    _handbook_block(
                        "aside_text",
                        "学生手册",
                        block_id="p2-header",
                        block_order=3,
                        block_bbox=[0, 0, 120, 18],
                    ),
                ),
            ),
            ocr_provider="mineru_api",
            ocr_model="vlm",
        )

        report = scan_handbook_source_truth_rows(rows)

        self.assertEqual(report.total_rows, 8)
        self.assertEqual(report.row_type_counts["heading"], 1)
        self.assertEqual(report.row_type_counts["page_number"], 1)
        self.assertEqual(report.row_type_counts["table"], 2)
        self.assertEqual(report.forbidden_field_count, 0)
        self.assertEqual(report.heading_role_conflict_count, 0)
        self.assertEqual(report.page_number_leak_count, 0)
        self.assertEqual(report.repeat_candidate_miss_count, 0)
        self.assertEqual(report.repeat_metadata_conflict_count, 0)
        self.assertEqual(report.table_semantics_conflict_count, 0)
        self.assertEqual(report.table_fragment_miss_count, 0)
        self.assertEqual(report.cross_page_continuation_miss_count, 0)
        self.assertEqual(report.unknown_row_type_count, 0)
        self.assertTrue(report.passed)

    def test_handbook_source_truth_validation_flags_structural_regressions(self) -> None:
        malformed_rows = [
            {
                "row_id": "row-001",
                "row_type": "heading",
                "block_role": "title",
                "heading_level": None,
                "text_normalized": "示例大学学生手册",
                "page_start": 1,
                "reading_order": 1,
            },
            {
                "row_id": "row-002",
                "row_type": "paragraph",
                "block_role": "body",
                "heading_level": None,
                "text_normalized": "12",
                "page_start": 1,
                "reading_order": 2,
                "bbox": [360, 1090, 420, 1130],
            },
            {
                "row_id": "row-003",
                "row_type": "paragraph",
                "block_role": "body",
                "heading_level": None,
                "text_normalized": "学生手册",
                "page_start": 1,
                "reading_order": 3,
                "bbox": [0, 0, 120, 18],
            },
            {
                "row_id": "row-004",
                "row_type": "paragraph",
                "block_role": "body",
                "heading_level": None,
                "text_normalized": "学生手册",
                "page_start": 2,
                "reading_order": 1,
                "bbox": [0, 0, 120, 18],
                "is_repeated_candidate": True,
                "repeat_frequency": 1,
                "repeat_cluster_id": "",
                "repeat_position_band": None,
            },
            {
                "row_id": "row-005",
                "row_type": "table",
                "block_role": "table",
                "heading_level": None,
                "text_normalized": "<table></table>",
                "page_start": 1,
                "page_end": 1,
                "reading_order": 4,
                "table_cells": [["单位名称", "电话号码"], ["校园110", "68932220"]],
                "table_header_rows": [["单位名称", "电话号码"]],
                "table_row_count": 1,
                "table_column_count": 2,
                "table_has_merged_cells": False,
            },
            {
                "row_id": "row-006",
                "row_type": "paragraph",
                "block_role": "body",
                "heading_level": None,
                "text_normalized": "续页过渡段。",
                "page_start": 2,
                "reading_order": 2,
                "continues_from_previous_page": True,
                "continues_to_next_page": False,
            },
            {
                "row_id": "row-007",
                "row_type": "table",
                "block_role": "table",
                "heading_level": None,
                "text_normalized": "<table></table>",
                "page_start": 2,
                "page_end": 2,
                "reading_order": 3,
                "table_cells": [["单位名称", "电话号码"], ["保卫处", "68930000"]],
                "table_header_rows": [["单位名称", "电话号码"]],
                "table_row_count": 2,
                "table_column_count": 2,
                "table_has_merged_cells": False,
            },
            {
                "row_id": "row-008",
                "row_type": "paragraph",
                "block_role": "body",
                "heading_level": None,
                "text_normalized": "第一条 学生应当遵守学校规定，",
                "page_start": 3,
                "reading_order": 1,
                "continues_to_next_page": False,
            },
            {
                "row_id": "row-009",
                "row_type": "paragraph",
                "block_role": "body",
                "heading_level": None,
                "text_normalized": "积极参与校园活动。",
                "page_start": 4,
                "reading_order": 1,
                "continues_from_previous_page": False,
            },
            {
                "row_id": "row-010",
                "row_type": "unknown",
                "block_role": "unknown",
                "heading_level": None,
                "text_normalized": "噪音块",
                "page_start": 5,
                "reading_order": 1,
                "clean_text": "forbidden",
            },
        ]

        report = scan_handbook_source_truth_rows(malformed_rows)

        self.assertEqual(report.forbidden_field_count, 1)
        self.assertEqual(report.heading_role_conflict_count, 1)
        self.assertEqual(report.page_number_leak_count, 1)
        self.assertEqual(report.repeat_candidate_miss_count, 1)
        self.assertEqual(report.repeat_metadata_conflict_count, 1)
        self.assertEqual(report.table_semantics_conflict_count, 1)
        self.assertEqual(report.table_fragment_miss_count, 1)
        self.assertEqual(report.cross_page_continuation_miss_count, 1)
        self.assertEqual(report.unknown_row_type_count, 1)
        self.assertFalse(report.passed)


if __name__ == "__main__":
    unittest.main()
