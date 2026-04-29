from __future__ import annotations

import json
import unittest

from campus_ingestion_core.handbook_provider_normalize import (
    normalize_handbook_provider_result,
    serialize_handbook_layout_elements,
)


def _provider_page(
    page_number: int,
    *blocks: dict[str, object],
) -> str:
    return json.dumps(
        {
            "pageNumber": page_number,
            "result": {
                "layoutParsingResults": list(blocks),
            },
        },
        ensure_ascii=False,
    )


def _provider_batch(*pages: dict[str, object]) -> str:
    return json.dumps(
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


def _provider_block(
    block_type: str,
    text: str,
    *,
    block_id: str,
    html: str | None = None,
    table_cells: list[list[str]] | None = None,
    heading_level: int | None = None,
) -> dict[str, object]:
    payload: dict[str, object] = {
        "blockType": block_type,
        "blockId": block_id,
        "confidence": 0.98,
        "bbox": [0, 0, 100, 20],
        "markdown": {
            "text": text,
            "html": html,
        },
    }
    if table_cells is not None:
        payload["tableCells"] = table_cells
    if heading_level is not None:
        payload["headingLevel"] = heading_level
    return payload


def _provider_pruned_page(
    *blocks: dict[str, object], markdown_text: str | None = None
) -> dict[str, object]:
    page: dict[str, object] = {
        "prunedResult": {
            "page_count": 1,
            "width": 828,
            "height": 1151,
            "parsing_res_list": list(blocks),
        }
    }
    if markdown_text is not None:
        page["markdown"] = {"text": markdown_text}
    return page


def _provider_parsing_block(
    block_label: str,
    content: str,
    *,
    block_id: str,
    block_order: int | None = None,
    block_bbox: list[float] | None = None,
) -> dict[str, object]:
    return {
        "block_id": block_id,
        "block_label": block_label,
        "block_content": content,
        "block_order": block_order,
        "block_bbox": block_bbox or [0, 0, 100, 20],
    }


class HandbookProviderNormalizeTest(unittest.TestCase):
    def test_normalize_rejects_non_json_line(self) -> None:
        with self.assertRaisesRegex(ValueError, "JSON"):
            normalize_handbook_provider_result(
                source_pdf="学生手册_2018.pdf",
                provider_jsonl_bytes=(
                    _provider_batch(
                        _provider_pruned_page(
                            _provider_parsing_block("text", "第一页正文", block_id="b-1"),
                        )
                    )
                    + "\nnot-json\n"
                ).encode("utf-8"),
                ocr_provider="paddleocr_async",
                ocr_model="PaddleOCR-VL-1.5",
            )

    def test_normalize_rejects_malformed_batch_page_count(self) -> None:
        provider_jsonl = json.dumps(
            {
                "result": {
                    "dataInfo": {
                        "numPages": 2,
                        "pages": [{"width": 828, "height": 1151}],
                        "type": "pdf",
                    },
                    "layoutParsingResults": [
                        _provider_pruned_page(
                            _provider_parsing_block("text", "page one", block_id="b-1"),
                        )
                    ],
                }
            },
            ensure_ascii=False,
        ).encode("utf-8")

        with self.assertRaisesRegex(ValueError, "page count"):
            normalize_handbook_provider_result(
                source_pdf="学生手册_2018.pdf",
                provider_jsonl_bytes=provider_jsonl,
                ocr_provider="paddleocr_async",
                ocr_model="PaddleOCR-VL-1.5",
            )

    def test_normalize_emits_at_least_one_row_per_page(self) -> None:
        provider_jsonl = (
            _provider_batch(
                _provider_pruned_page(
                    _provider_parsing_block("text", "第一页正文", block_id="b-1")
                ),
                _provider_pruned_page(
                    _provider_parsing_block("text", "第二页正文", block_id="b-2")
                ),
            )
            + "\n"
        ).encode("utf-8")

        rows = normalize_handbook_provider_result(
            source_pdf="学生手册_2018.pdf",
            provider_jsonl_bytes=provider_jsonl,
            ocr_provider="paddleocr_async",
            ocr_model="PaddleOCR-VL-1.5",
        )

        self.assertEqual(len(rows), 2)
        self.assertEqual([row["provider_page_id"] for row in rows], [1, 2])
        self.assertEqual([row["page_start"] for row in rows], [1, 2])
        self.assertEqual([row["page_end"] for row in rows], [1, 2])

    def test_normalize_rows_include_required_fields(self) -> None:
        provider_jsonl = (
            _provider_batch(
                _provider_pruned_page(
                    _provider_parsing_block("text", "  第 一 条 \n\n 内容  ", block_id="b-1")
                )
            )
            + "\n"
        ).encode("utf-8")

        rows = normalize_handbook_provider_result(
            source_pdf="学生手册_2018.pdf",
            provider_jsonl_bytes=provider_jsonl,
            ocr_provider="paddleocr_async",
            ocr_model="PaddleOCR-VL-1.5",
        )

        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(
            {
                "source_pdf",
                "page_start",
                "page_end",
                "row_type",
                "text_raw",
                "text_normalized",
                "provider_page_id",
                "ocr_provider",
                "ocr_model",
            }
            - set(row.keys()),
            set(),
        )
        self.assertEqual(row["text_raw"], "  第 一 条 \n\n 内容  ")
        self.assertEqual(row["text_normalized"], "第 一 条\n\n内容")
        self.assertEqual(row["schema_version"], "student_handbook_layout_elements_v3")
        self.assertEqual(row["corpus"], "regulations")
        self.assertEqual(row["collection"], "student_rules")
        self.assertIn("classification_confidence", row)
        self.assertIn("classification_reason", row)
        self.assertIn("repeat_cluster_id", row)
        self.assertIn("repeat_frequency", row)
        self.assertIn("repeat_position_band", row)
        self.assertIn("continues_from_previous_page", row)
        self.assertIn("continues_to_next_page", row)
        self.assertIn("table_fragment_id", row)
        self.assertIn("table_header_rows", row)
        self.assertIn("table_row_count", row)
        self.assertIn("table_column_count", row)
        self.assertIn("table_has_merged_cells", row)
        self.assertNotIn("doc_id", row)
        self.assertNotIn("version_id", row)
        self.assertEqual(
            serialize_handbook_layout_elements(rows).decode("utf-8"),
            json.dumps(row, ensure_ascii=False) + "\n",
        )

    def test_normalize_preserves_heading_and_table_semantics(self) -> None:
        provider_jsonl = (
            _provider_batch(
                _provider_pruned_page(
                    _provider_parsing_block("doc_title", "学生手册", block_id="b-1", block_order=1),
                    _provider_parsing_block(
                        "table",
                        "<table><tr><td>项目</td><td>说明</td></tr></table>",
                        block_id="b-2",
                        block_order=2,
                    ),
                ),
            )
            + "\n"
        ).encode("utf-8")

        rows = normalize_handbook_provider_result(
            source_pdf="学生手册_2018.pdf",
            provider_jsonl_bytes=provider_jsonl,
            ocr_provider="paddleocr_async",
            ocr_model="PaddleOCR-VL-1.5",
        )

        self.assertEqual([row["row_type"] for row in rows], ["heading", "table"])
        self.assertEqual(rows[0]["block_role"], "title")
        self.assertEqual(rows[0]["heading_level"], 1)
        self.assertEqual(rows[1]["block_role"], "table")
        self.assertEqual(rows[1]["table_cells"], [["项目", "说明"]])
        self.assertEqual(rows[1]["html"], "<table><tr><td>项目</td><td>说明</td></tr></table>")
        self.assertEqual(rows[1]["table_row_count"], 1)
        self.assertEqual(rows[1]["table_column_count"], 2)
        self.assertEqual(rows[1]["table_header_rows"], [["项目", "说明"]])
        self.assertIsNone(rows[1]["table_fragment_id"])

    def test_normalize_repairs_credit_rule_table_row_split(self) -> None:
        provider_jsonl = (
            _provider_batch(
                _provider_pruned_page(
                    _provider_parsing_block(
                        "table",
                        '<table><tr><td colspan="2">专业类别</td><td>学分要求</td><td></td><td></td></tr>'
                        '<tr><td colspan="2">教育学</td><td>体育类</td><td>145学分</td><td></td></tr></table>',
                        block_id="b-1",
                        block_order=1,
                    ),
                ),
            )
            + "\n"
        ).encode("utf-8")

        rows = normalize_handbook_provider_result(
            source_pdf="学生手册_2018.pdf",
            provider_jsonl_bytes=provider_jsonl,
            ocr_provider="mineru_api",
            ocr_model="vlm",
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["row_type"], "table")
        self.assertIn(
            '<tr><td colspan="2">教育学</td><td>145学分</td><td></td><td></td></tr>',
            rows[0]["html"],
        )
        self.assertIn(
            '<tr><td colspan="2">体育类</td><td>145学分</td><td></td><td></td></tr>',
            rows[0]["html"],
        )
        self.assertNotIn(
            '<tr><td colspan="2">教育学</td><td>体育类</td><td>145学分</td><td></td></tr>',
            rows[0]["html"],
        )

    def test_normalize_demotes_empty_provider_table_block_out_of_table_lane(self) -> None:
        provider_jsonl = (
            _provider_batch(
                _provider_pruned_page(
                    _provider_parsing_block("table", "", block_id="b-1", block_order=1),
                ),
            )
            + "\n"
        ).encode("utf-8")

        rows = normalize_handbook_provider_result(
            source_pdf="学生手册_2018.pdf",
            provider_jsonl_bytes=provider_jsonl,
            ocr_provider="mineru_api",
            ocr_model="vlm",
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["row_type"], "image")
        self.assertEqual(rows[0]["block_role"], "image")
        self.assertIsNone(rows[0]["table_cells"])
        self.assertIsNone(rows[0]["html"])

    def test_normalize_rejects_removed_legacy_single_page_payload(self) -> None:
        with self.assertRaisesRegex(ValueError, "batch provider payload"):
            normalize_handbook_provider_result(
                source_pdf="学生手册_2018.pdf",
                provider_jsonl_bytes=(
                    _provider_page(1, _provider_block("text", "第一页正文", block_id="b-1")) + "\n"
                ).encode("utf-8"),
                ocr_provider="paddleocr_async",
                ocr_model="PaddleOCR-VL-1.5",
            )

    def test_normalize_expands_batch_result_into_contiguous_pages(self) -> None:
        provider_jsonl = (
            _provider_batch(
                _provider_pruned_page(
                    _provider_parsing_block(
                        "doc_title", "第一页标题", block_id="p1-title", block_order=1
                    ),
                    _provider_parsing_block(
                        "text", "第一页正文", block_id="p1-body", block_order=2
                    ),
                ),
                _provider_pruned_page(
                    _provider_parsing_block(
                        "paragraph_title", "第二页小节", block_id="p2-heading", block_order=1
                    ),
                    _provider_parsing_block(
                        "text", "第二页正文", block_id="p2-body", block_order=2
                    ),
                ),
            )
            + "\n"
        ).encode("utf-8")

        rows = normalize_handbook_provider_result(
            source_pdf="学生手册_2018.pdf",
            provider_jsonl_bytes=provider_jsonl,
            ocr_provider="paddleocr_async",
            ocr_model="PaddleOCR-VL-1.5",
        )

        self.assertEqual([row["provider_page_id"] for row in rows], [1, 1, 2, 2])
        self.assertEqual(
            [row["row_type"] for row in rows], ["heading", "paragraph", "heading", "paragraph"]
        )
        self.assertEqual(rows[0]["block_role"], "title")
        self.assertEqual(rows[2]["block_role"], "heading")

    def test_normalize_classifies_bottom_band_numeric_text_as_page_number_for_mineru_adapted_rows(
        self,
    ) -> None:
        provider_jsonl = (
            _provider_batch(
                _provider_pruned_page(
                    _provider_parsing_block(
                        "text",
                        "114",
                        block_id="p1-page",
                        block_order=1,
                        block_bbox=[360, 1090, 420, 1130],
                    ),
                    _provider_parsing_block(
                        "text",
                        "第一页正文",
                        block_id="p1-body",
                        block_order=2,
                        block_bbox=[0, 120, 300, 180],
                    ),
                ),
            )
            + "\n"
        ).encode("utf-8")

        rows = normalize_handbook_provider_result(
            source_pdf="学生手册_2018.pdf",
            provider_jsonl_bytes=provider_jsonl,
            ocr_provider="mineru_api",
            ocr_model="vlm",
        )

        page_row = next(row for row in rows if row["provider_block_id"] == "p1-page")
        body_row = next(row for row in rows if row["provider_block_id"] == "p1-body")

        self.assertEqual(page_row["row_type"], "page_number")
        self.assertEqual(page_row["block_role"], "page_number")
        self.assertEqual(body_row["row_type"], "paragraph")

    def test_normalize_prefers_pruned_blocks_over_page_markdown(self) -> None:
        provider_jsonl = (
            _provider_batch(
                _provider_pruned_page(
                    _provider_parsing_block(
                        "doc_title", "制度标题", block_id="p1-title", block_order=1
                    ),
                    _provider_parsing_block(
                        "text", "第一条 正文", block_id="p1-body", block_order=2
                    ),
                    markdown_text="# 整页 markdown 不应直接作为单段正文",
                )
            )
            + "\n"
        ).encode("utf-8")

        rows = normalize_handbook_provider_result(
            source_pdf="学生手册_2018.pdf",
            provider_jsonl_bytes=provider_jsonl,
            ocr_provider="paddleocr_async",
            ocr_model="PaddleOCR-VL-1.5",
        )

        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["text_normalized"], "制度标题")
        self.assertEqual(rows[1]["text_normalized"], "第一条 正文")

    def test_normalize_maps_real_provider_labels_and_table_html(self) -> None:
        provider_jsonl = (
            _provider_batch(
                _provider_pruned_page(
                    _provider_parsing_block(
                        "aside_text", "学生手册", block_id="p1-aside", block_order=1
                    ),
                    _provider_parsing_block(
                        "number",
                        "261",
                        block_id="p1-no",
                        block_order=2,
                        block_bbox=[360, 1090, 420, 1130],
                    ),
                    _provider_parsing_block(
                        "paragraph_title",
                        "中央民族大学校内常用电话",
                        block_id="p1-title",
                        block_order=3,
                    ),
                    _provider_parsing_block(
                        "table",
                        "<table><tr><td>单位名称</td><td>电话号码</td></tr><tr><td>校园110</td><td>68932220</td></tr></table>",
                        block_id="p1-table",
                        block_order=4,
                    ),
                )
            )
            + "\n"
        ).encode("utf-8")

        rows = normalize_handbook_provider_result(
            source_pdf="学生手册_2018.pdf",
            provider_jsonl_bytes=provider_jsonl,
            ocr_provider="paddleocr_async",
            ocr_model="PaddleOCR-VL-1.5",
        )

        self.assertEqual(
            [row["row_type"] for row in rows], ["paragraph", "page_number", "heading", "table"]
        )
        self.assertEqual(rows[2]["block_role"], "heading")
        self.assertEqual(
            rows[3]["table_cells"], [["单位名称", "电话号码"], ["校园110", "68932220"]]
        )

    def test_normalize_marks_repeated_header_candidates_via_cross_page_frequency(self) -> None:
        provider_jsonl = (
            _provider_batch(
                _provider_pruned_page(
                    _provider_parsing_block(
                        "aside_text",
                        "学生手册",
                        block_id="p1-header",
                        block_order=1,
                        block_bbox=[0, 0, 120, 18],
                    ),
                    _provider_parsing_block(
                        "text",
                        "第一页正文",
                        block_id="p1-body",
                        block_order=2,
                        block_bbox=[0, 120, 300, 180],
                    ),
                ),
                _provider_pruned_page(
                    _provider_parsing_block(
                        "aside_text",
                        "学生手册",
                        block_id="p2-header",
                        block_order=1,
                        block_bbox=[0, 0, 120, 18],
                    ),
                    _provider_parsing_block(
                        "text",
                        "第二页正文",
                        block_id="p2-body",
                        block_order=2,
                        block_bbox=[0, 120, 300, 180],
                    ),
                ),
            )
            + "\n"
        ).encode("utf-8")

        rows = normalize_handbook_provider_result(
            source_pdf="学生手册_2018.pdf",
            provider_jsonl_bytes=provider_jsonl,
            ocr_provider="paddleocr_async",
            ocr_model="PaddleOCR-VL-1.5",
        )

        header_rows = [row for row in rows if row["text_normalized"] == "学生手册"]
        self.assertEqual(len(header_rows), 2)
        self.assertTrue(all(bool(row["is_repeated_candidate"]) for row in header_rows))
        self.assertTrue(all(row["repeat_frequency"] == 2 for row in header_rows))
        self.assertTrue(all(row["repeat_position_band"] == "top" for row in header_rows))
        self.assertTrue(
            all(
                isinstance(row["repeat_cluster_id"], str) and row["repeat_cluster_id"]
                for row in header_rows
            )
        )

    def test_normalize_marks_repeated_margin_running_headers_via_cross_page_frequency(self) -> None:
        provider_jsonl = (
            _provider_batch(
                _provider_pruned_page(
                    _provider_parsing_block(
                        "aside_text",
                        "学生手册",
                        block_id="p1-header",
                        block_order=1,
                        block_bbox=[39, 220, 68, 373],
                    ),
                    _provider_parsing_block(
                        "text",
                        "第十二条 本科学生国家奖学金按以下程序进行评选:",
                        block_id="p1-body",
                        block_order=2,
                        block_bbox=[118, 190, 971, 328],
                    ),
                ),
                _provider_pruned_page(
                    _provider_parsing_block(
                        "aside_text",
                        "学生手册",
                        block_id="p2-header",
                        block_order=1,
                        block_bbox=[39, 220, 68, 373],
                    ),
                    _provider_parsing_block(
                        "text",
                        "党委学生工作部、学生处组织学校评审委员会召开评审会进行评审。",
                        block_id="p2-body",
                        block_order=2,
                        block_bbox=[116, 188, 970, 330],
                    ),
                ),
            )
            + "\n"
        ).encode("utf-8")

        rows = normalize_handbook_provider_result(
            source_pdf="学生手册_2018.pdf",
            provider_jsonl_bytes=provider_jsonl,
            ocr_provider="paddleocr_async",
            ocr_model="PaddleOCR-VL-1.5",
        )

        header_rows = [row for row in rows if row["text_normalized"] == "学生手册"]
        self.assertEqual(len(header_rows), 2)
        self.assertTrue(all(bool(row["is_repeated_candidate"]) for row in header_rows))
        self.assertTrue(all(row["repeat_frequency"] == 2 for row in header_rows))
        self.assertTrue(all(row["repeat_position_band"] == "margin" for row in header_rows))
        self.assertTrue(
            all(
                isinstance(row["repeat_cluster_id"], str) and row["repeat_cluster_id"]
                for row in header_rows
            )
        )

    def test_normalize_does_not_force_number_into_page_number_when_not_bottom_aligned(self) -> None:
        provider_jsonl = (
            _provider_batch(
                _provider_pruned_page(
                    _provider_parsing_block(
                        "number",
                        "2024",
                        block_id="p1-number",
                        block_order=2,
                        block_bbox=[120, 300, 180, 340],
                    ),
                )
            )
            + "\n"
        ).encode("utf-8")

        rows = normalize_handbook_provider_result(
            source_pdf="学生手册_2018.pdf",
            provider_jsonl_bytes=provider_jsonl,
            ocr_provider="paddleocr_async",
            ocr_model="PaddleOCR-VL-1.5",
        )

        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["row_type"], "paragraph")
        self.assertEqual(rows[0]["block_role"], "body")
        self.assertFalse(bool(rows[0]["is_repeated_candidate"]))

    def test_normalize_sets_continuation_hints_for_cross_page_sentence(self) -> None:
        provider_jsonl = (
            _provider_batch(
                _provider_pruned_page(
                    _provider_parsing_block(
                        "text",
                        "第一条 学生应当遵守学校规定，",
                        block_id="p1-body",
                        block_order=1,
                        block_bbox=[0, 120, 300, 180],
                    ),
                ),
                _provider_pruned_page(
                    _provider_parsing_block(
                        "text",
                        "积极参与校园活动。",
                        block_id="p2-body",
                        block_order=1,
                        block_bbox=[0, 120, 300, 180],
                    ),
                ),
            )
            + "\n"
        ).encode("utf-8")

        rows = normalize_handbook_provider_result(
            source_pdf="学生手册_2018.pdf",
            provider_jsonl_bytes=provider_jsonl,
            ocr_provider="paddleocr_async",
            ocr_model="PaddleOCR-VL-1.5",
        )

        self.assertTrue(bool(rows[0]["continues_to_next_page"]))
        self.assertTrue(bool(rows[1]["continues_from_previous_page"]))


if __name__ == "__main__":
    unittest.main()
