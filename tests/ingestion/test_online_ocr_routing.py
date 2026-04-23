from __future__ import annotations

import json
import unittest
import zipfile
from io import BytesIO

from campus_ingestion_core.file_asset_routing import (
    adapt_mineru_archive_to_canonical_provider_payload,
    select_online_ocr_routing,
)


def _build_mineru_archive_bytes() -> bytes:
    content_items = [
        {
            "type": "text",
            "text": "中央民族大学课程安排说明",
            "text_level": 1,
            "bbox": [10, 20, 300, 80],
            "page_idx": 0,
        },
        {
            "type": "table",
            "table_body": "<table><tr><td>课程</td><td>时间</td></tr><tr><td>民族学导论</td><td>周一</td></tr></table>",
            "bbox": [10, 100, 900, 900],
            "page_idx": 0,
        },
    ]
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("sample_content_list.json", json.dumps(content_items, ensure_ascii=False))
        archive.writestr(
            "full.md",
            "# 中央民族大学课程安排说明\n\n<table><tr><td>课程</td><td>时间</td></tr></table>\n",
        )
    return buffer.getvalue()


def _build_mineru_archive_with_page_marker_bytes() -> bytes:
    content_items = [
        {
            "type": "text",
            "text": "中央民族大学课程安排说明",
            "text_level": 1,
            "bbox": [10, 20, 300, 80],
            "page_idx": 0,
            "page_height": 1600,
        },
        {
            "type": "text",
            "text": "476",
            "text_level": 0,
            "bbox": [520, 1500, 580, 1540],
            "page_idx": 0,
            "page_height": 1600,
        },
    ]
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("sample_content_list.json", json.dumps(content_items, ensure_ascii=False))
        archive.writestr("full.md", "# 中央民族大学课程安排说明\n\n476\n")
    return buffer.getvalue()


def _build_mineru_archive_with_list_and_running_header_bytes() -> bytes:
    content_items = [
        {
            "type": "header",
            "text": "UNIVERSITY OF THE SANGHERS",
            "bbox": [40, 24, 320, 56],
            "page_idx": 0,
        },
        {
            "type": "aside_text",
            "text": "学生手册",
            "bbox": [36, 180, 72, 332],
            "page_idx": 0,
        },
        {
            "type": "text",
            "text": "第八条 临时困难补助对象包括：",
            "bbox": [148, 182, 822, 236],
            "page_idx": 0,
        },
        {
            "type": "list",
            "sub_type": "text",
            "list_items": [
                "（一）无经济来源的烈士子女和优抚家庭子女；",
                "（二）无经济来源的孤儿；",
            ],
            "bbox": [148, 248, 830, 440],
            "page_idx": 0,
        },
    ]
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("sample_content_list.json", json.dumps(content_items, ensure_ascii=False))
        archive.writestr(
            "full.md",
            (
                "UNIVERSITY OF THE SANGHERS\n\n"
                "学生手册\n\n"
                "第八条 临时困难补助对象包括：\n\n"
                "（一）无经济来源的烈士子女和优抚家庭子女；\n"
                "（二）无经济来源的孤儿；\n"
            ),
        )
    return buffer.getvalue()


def _build_mineru_fallback_archive_with_nested_content_bytes() -> bytes:
    content_items = [
        [
            {
                "type": "page_header",
                "content": {
                    "page_header_content": [
                        {"type": "text", "content": "UNIVERSITY OF THE SANGHERS"}
                    ]
                },
                "bbox": [40, 24, 320, 56],
            },
            {
                "type": "page_aside_text",
                "content": {
                    "page_aside_text_content": [{"type": "text", "content": "学生手册"}]
                },
                "bbox": [36, 180, 72, 332],
            },
            {
                "type": "paragraph",
                "content": {
                    "paragraph_content": [{"type": "text", "content": "第八条 临时困难补助对象包括："}]
                },
                "bbox": [148, 182, 822, 236],
            },
            {
                "type": "list",
                "content": {
                    "list_type": "text_list",
                    "list_items": [
                        {
                            "item_type": "text",
                            "item_content": [
                                {
                                    "type": "text",
                                    "content": "（一）无经济来源的烈士子女和优抚家庭子女；",
                                }
                            ],
                        },
                        {
                            "item_type": "text",
                            "item_content": [{"type": "text", "content": "（二）无经济来源的孤儿；"}],
                        },
                    ],
                },
                "bbox": [148, 248, 830, 440],
            },
        ]
    ]
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("content_list_v2.json", json.dumps(content_items, ensure_ascii=False))
        archive.writestr(
            "full.md",
            (
                "UNIVERSITY OF THE SANGHERS\n\n"
                "学生手册\n\n"
                "第八条 临时困难补助对象包括：\n\n"
                "（一）无经济来源的烈士子女和优抚家庭子女；\n"
                "（二）无经济来源的孤儿；\n"
            ),
        )
    return buffer.getvalue()


def _build_mineru_archive_prefers_content_list_v2_bytes() -> bytes:
    sparse_items = [
        {
            "type": "text",
            "text": "纳米材料与技术本科人才培养方案",
            "text_level": 1,
            "bbox": [270, 101, 736, 128],
            "page_idx": 0,
        },
        {
            "type": "list_item",
            "text": "",
            "bbox": [131, 160, 873, 890],
            "page_idx": 1,
        },
    ]
    rich_pages = [
        [
            {
                "type": "title",
                "content": {
                    "title_content": [{"type": "text", "content": "纳米材料与技术本科人才培养方案"}],
                    "level": 1,
                },
                "bbox": [270, 101, 736, 128],
            }
        ],
        [
            {
                "type": "list",
                "content": {
                    "list_type": "text_list",
                    "list_items": [
                        {
                            "item_type": "text",
                            "item_content": [
                                {
                                    "type": "text",
                                    "content": "（二）问题分析：具备利用自然科学原理理解纳米材料与技术工程问题的能力。",
                                }
                            ],
                        },
                        {
                            "item_type": "text",
                            "item_content": [
                                {
                                    "type": "text",
                                    "content": "（三）设计/开发解决方案：能够针对纳米材料与技术领域中的复杂问题设计具体方案。",
                                }
                            ],
                        },
                    ],
                },
                "bbox": [131, 160, 873, 890],
            }
        ],
    ]
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("sample_content_list.json", json.dumps(sparse_items, ensure_ascii=False))
        archive.writestr("content_list_v2.json", json.dumps(rich_pages, ensure_ascii=False))
        archive.writestr(
            "full.md",
            (
                "纳米材料与技术本科人才培养方案\n\n"
                "（二）问题分析：具备利用自然科学原理理解纳米材料与技术工程问题的能力。\n"
                "（三）设计/开发解决方案：能够针对纳米材料与技术领域中的复杂问题设计具体方案。\n"
            ),
        )
    return buffer.getvalue()


def _build_mineru_archive_with_paginated_content_list_v2_bytes() -> bytes:
    content_pages = [
        [
            {
                "type": "title",
                "content": {"title_content": [{"type": "text", "content": "第一页标题"}], "level": 1},
                "bbox": [100, 80, 300, 120],
            }
        ],
        [
            {
                "type": "paragraph",
                "content": {
                    "paragraph_content": [{"type": "text", "content": "第二页正文"}]
                },
                "bbox": [100, 120, 700, 180],
            }
        ],
    ]
    buffer = BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("content_list_v2.json", json.dumps(content_pages, ensure_ascii=False))
        archive.writestr("full.md", "第一页标题\n\n第二页正文\n")
    return buffer.getvalue()


class OnlineOcrRoutingTest(unittest.TestCase):
    def test_select_online_ocr_routing_prefers_mineru_for_pdf_when_available(self) -> None:
        decision = select_online_ocr_routing(
            asset_kind="document",
            asset_subkind="pdf",
            mineru_available=True,
        )

        self.assertTrue(decision.canonical_allowed)
        self.assertEqual(decision.route_id, "pdf_mineru_primary_with_paddle_fallback")
        self.assertEqual(decision.canonical_provider, "mineru_api")
        self.assertEqual(decision.fallback_provider, "paddleocr_async_jobs")
        self.assertEqual(decision.parser_version, "mineru-vlm-adapted-v2")
        self.assertTrue(decision.persist_raw_provider_artifact)

    def test_select_online_ocr_routing_keeps_paddle_for_generic_image(self) -> None:
        decision = select_online_ocr_routing(
            asset_kind="image",
            asset_subkind="generic_image",
            mineru_available=True,
        )

        self.assertTrue(decision.canonical_allowed)
        self.assertEqual(decision.route_id, "generic_image_paddle_primary")
        self.assertEqual(decision.canonical_provider, "paddleocr_async_jobs")
        self.assertIsNone(decision.fallback_provider)
        self.assertEqual(decision.parser_version, "paddleocr-vl-1.5")

    def test_select_online_ocr_routing_defers_office_documents(self) -> None:
        decision = select_online_ocr_routing(
            asset_kind="document",
            asset_subkind="office_document",
            mineru_available=True,
        )

        self.assertFalse(decision.canonical_allowed)
        self.assertIsNone(decision.canonical_provider)
        self.assertIn("office_document_deferred", decision.reason_codes)

    def test_select_online_ocr_routing_defers_semantic_images_from_canonical_ocr(self) -> None:
        decision = select_online_ocr_routing(
            asset_kind="image",
            asset_subkind="semantic_image",
            mineru_available=True,
        )

        self.assertFalse(decision.canonical_allowed)
        self.assertEqual(decision.route_id, "semantic_image_deferred")
        self.assertIsNone(decision.canonical_provider)
        self.assertIsNone(decision.fallback_provider)
        self.assertIn("semantic_image_deferred", decision.reason_codes)

    def test_adapt_mineru_archive_to_canonical_provider_payload_builds_paddle_shaped_jsonl(
        self,
    ) -> None:
        payload = adapt_mineru_archive_to_canonical_provider_payload(_build_mineru_archive_bytes())
        lines = [line for line in payload.decode("utf-8").splitlines() if line.strip()]

        self.assertEqual(len(lines), 1)
        result = json.loads(lines[0])["result"]
        self.assertEqual(result["dataInfo"]["numPages"], 1)
        page_payload = result["layoutParsingResults"][0]
        blocks = page_payload["prunedResult"]["parsing_res_list"]
        self.assertEqual(blocks[0]["block_label"], "doc_title")
        self.assertEqual(blocks[0]["block_content"], "中央民族大学课程安排说明")
        self.assertEqual(blocks[1]["block_label"], "table")
        self.assertIn("<table>", blocks[1]["block_content"])

    def test_adapt_mineru_archive_to_canonical_provider_payload_preserves_page_height_and_page_marker_hints(
        self,
    ) -> None:
        payload = adapt_mineru_archive_to_canonical_provider_payload(
            _build_mineru_archive_with_page_marker_bytes()
        )

        result = json.loads(payload.decode("utf-8").splitlines()[0])["result"]
        page_payload = result["layoutParsingResults"][0]
        blocks = page_payload["prunedResult"]["parsing_res_list"]

        self.assertEqual(page_payload["pageInfo"]["height"], 1600)
        self.assertEqual(page_payload["prunedResult"]["height"], 1600)
        self.assertEqual(blocks[1]["block_label"], "number")
        self.assertEqual(blocks[1]["block_content"], "476")
        self.assertEqual(blocks[1]["mineru_item_type"], "text")
        self.assertEqual(blocks[1]["mineru_text_level"], 0)
        self.assertEqual(blocks[1]["mineru_page_idx"], 0)

    def test_adapt_mineru_archive_to_canonical_provider_payload_preserves_list_content_and_running_header_labels(
        self,
    ) -> None:
        payload = adapt_mineru_archive_to_canonical_provider_payload(
            _build_mineru_archive_with_list_and_running_header_bytes()
        )

        result = json.loads(payload.decode("utf-8").splitlines()[0])["result"]
        page_payload = result["layoutParsingResults"][0]
        blocks = page_payload["prunedResult"]["parsing_res_list"]

        self.assertEqual(blocks[0]["block_label"], "header")
        self.assertEqual(blocks[0]["block_content"], "UNIVERSITY OF THE SANGHERS")
        self.assertEqual(blocks[1]["block_label"], "aside_text")
        self.assertEqual(blocks[1]["block_content"], "学生手册")
        self.assertEqual(blocks[3]["block_label"], "list_item")
        self.assertEqual(
            blocks[3]["block_content"],
            "（一）无经济来源的烈士子女和优抚家庭子女；\n（二）无经济来源的孤儿；",
        )

    def test_adapt_mineru_archive_to_canonical_provider_payload_extracts_nested_fallback_content(
        self,
    ) -> None:
        payload = adapt_mineru_archive_to_canonical_provider_payload(
            _build_mineru_fallback_archive_with_nested_content_bytes()
        )

        result = json.loads(payload.decode("utf-8").splitlines()[0])["result"]
        page_payload = result["layoutParsingResults"][0]
        blocks = page_payload["prunedResult"]["parsing_res_list"]

        self.assertEqual(blocks[0]["block_label"], "header")
        self.assertEqual(blocks[0]["block_content"], "UNIVERSITY OF THE SANGHERS")
        self.assertEqual(blocks[1]["block_label"], "aside_text")
        self.assertEqual(blocks[1]["block_content"], "学生手册")
        self.assertEqual(blocks[2]["block_content"], "第八条 临时困难补助对象包括：")
        self.assertEqual(blocks[3]["block_label"], "list_item")
        self.assertEqual(
            blocks[3]["block_content"],
            "（一）无经济来源的烈士子女和优抚家庭子女；\n（二）无经济来源的孤儿；",
        )

    def test_adapt_mineru_archive_to_canonical_provider_payload_prefers_richer_content_list_v2(
        self,
    ) -> None:
        payload = adapt_mineru_archive_to_canonical_provider_payload(
            _build_mineru_archive_prefers_content_list_v2_bytes()
        )

        result = json.loads(payload.decode("utf-8").splitlines()[0])["result"]
        self.assertEqual(result["dataInfo"]["numPages"], 2)
        page_payload = result["layoutParsingResults"][1]
        blocks = page_payload["prunedResult"]["parsing_res_list"]

        self.assertEqual(blocks[0]["block_label"], "list_item")
        self.assertEqual(
            blocks[0]["block_content"],
            "（二）问题分析：具备利用自然科学原理理解纳米材料与技术工程问题的能力。\n"
            "（三）设计/开发解决方案：能够针对纳米材料与技术领域中的复杂问题设计具体方案。",
        )

    def test_adapt_mineru_archive_to_canonical_provider_payload_preserves_paginated_content_list_v2_boundaries(
        self,
    ) -> None:
        payload = adapt_mineru_archive_to_canonical_provider_payload(
            _build_mineru_archive_with_paginated_content_list_v2_bytes()
        )

        result = json.loads(payload.decode("utf-8").splitlines()[0])["result"]
        self.assertEqual(result["dataInfo"]["numPages"], 2)
        first_page_blocks = result["layoutParsingResults"][0]["prunedResult"]["parsing_res_list"]
        second_page_blocks = result["layoutParsingResults"][1]["prunedResult"]["parsing_res_list"]

        self.assertEqual(first_page_blocks[0]["block_content"], "第一页标题")
        self.assertEqual(first_page_blocks[0]["mineru_page_idx"], 0)
        self.assertEqual(second_page_blocks[0]["block_content"], "第二页正文")
        self.assertEqual(second_page_blocks[0]["mineru_page_idx"], 1)


if __name__ == "__main__":
    unittest.main()
