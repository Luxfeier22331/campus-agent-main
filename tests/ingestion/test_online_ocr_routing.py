from __future__ import annotations

from io import BytesIO
import json
import unittest
import zipfile

from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.online_ocr_routing import (
    adapt_mineru_archive_to_canonical_provider_payload,
    select_online_ocr_routing,
)


def _build_raw_asset_record(
    *,
    source_filename: str,
    asset_kind: str,
    asset_subkind: str,
) -> RawAssetRecord:
    return RawAssetRecord(
        raw_asset_id="asset:test",
        raw_version_id="sha256:test",
        corpus="curriculum",
        collection="curriculum_plan",
        raw_source_uri=f"file:///{source_filename}",
        content_hash="deadbeef",
        source_filename=source_filename,
        object_key=f"official_pdf/test/undated/sha256/deadbeef/capture/{source_filename}",
        ingestion_timestamp="2026-04-12T00:00:00+08:00",
        import_source="seed",
        asset_kind=asset_kind,
        asset_subkind=asset_subkind,
        classification_confidence=1.0,
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


class OnlineOcrRoutingTest(unittest.TestCase):
    def test_select_online_ocr_routing_prefers_mineru_for_pdf_when_available(self) -> None:
        decision = select_online_ocr_routing(
            raw_asset_record=_build_raw_asset_record(
                source_filename="sample.pdf",
                asset_kind="document",
                asset_subkind="pdf",
            ),
            mineru_available=True,
        )

        self.assertTrue(decision.canonical_allowed)
        self.assertEqual(decision.route_id, "pdf_mineru_primary_with_paddle_fallback")
        self.assertEqual(decision.canonical_provider, "mineru_api")
        self.assertEqual(decision.fallback_provider, "paddleocr_async_jobs")
        self.assertEqual(decision.parser_version, "mineru-vlm-adapted-v1")
        self.assertTrue(decision.persist_raw_provider_artifact)

    def test_select_online_ocr_routing_keeps_paddle_for_generic_image(self) -> None:
        decision = select_online_ocr_routing(
            raw_asset_record=_build_raw_asset_record(
                source_filename="sample.png",
                asset_kind="image",
                asset_subkind="generic_image",
            ),
            mineru_available=True,
        )

        self.assertTrue(decision.canonical_allowed)
        self.assertEqual(decision.route_id, "generic_image_paddle_primary")
        self.assertEqual(decision.canonical_provider, "paddleocr_async_jobs")
        self.assertIsNone(decision.fallback_provider)
        self.assertEqual(decision.parser_version, "paddleocr-vl-1.5")

    def test_select_online_ocr_routing_defers_office_documents(self) -> None:
        decision = select_online_ocr_routing(
            raw_asset_record=_build_raw_asset_record(
                source_filename="sample.docx",
                asset_kind="document",
                asset_subkind="office_document",
            ),
            mineru_available=True,
        )

        self.assertFalse(decision.canonical_allowed)
        self.assertIsNone(decision.canonical_provider)
        self.assertIn("office_document_deferred", decision.reason_codes)

    def test_adapt_mineru_archive_to_canonical_provider_payload_builds_paddle_shaped_jsonl(self) -> None:
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


if __name__ == "__main__":
    unittest.main()
