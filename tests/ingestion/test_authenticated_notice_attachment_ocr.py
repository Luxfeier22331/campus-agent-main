from __future__ import annotations

import json
import unittest

from campus_ingestion_core.authenticated_notice_attachment_ocr import (
    build_authenticated_notice_ocr_attachment_artifacts,
)


def _jsonl_bytes(payload: object) -> bytes:
    return (json.dumps(payload, ensure_ascii=False) + "\n").encode("utf-8")


class AuthenticatedNoticeAttachmentOcrArtifactsTest(unittest.TestCase):
    def test_materializes_table_when_provider_only_returns_html_in_block_content(self) -> None:
        payload = {
            "result": {
                "layoutParsingResults": [
                    {
                        "markdown": {
                            "text": (
                                "<table border=1><tr><td>楼名</td><td>房间号</td></tr>"
                                "<tr><td>综合楼</td><td>109 室</td></tr></table>"
                            )
                        },
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_id": 0,
                                    "block_label": "table",
                                    "block_content": (
                                        "<table><tr><td>楼名</td><td>房间号</td></tr>"
                                        "<tr><td>综合楼</td><td>109 室</td></tr></table>"
                                    ),
                                }
                            ]
                        },
                    }
                ]
            }
        }

        artifacts = build_authenticated_notice_ocr_attachment_artifacts(
            document_id="notice_attachment:muc_internal_portal:351886:attachment-0001",
            version_id="sha256:test",
            source_uri="campusnotice://muc_internal_portal/notice/351886",
            title="测试附件",
            attachment_ref_id="attachment-0001",
            provider_response_bytes=_jsonl_bytes(payload),
            metadata={"source_resource_role": "inline_image"},
        )

        self.assertIsNotNone(artifacts)
        assert artifacts is not None

        layout_rows = [
            json.loads(line)
            for line in artifacts.layout_elements_bytes.decode("utf-8").splitlines()
            if line.strip()
        ]
        self.assertEqual(layout_rows[0]["row_type"], "table")
        self.assertEqual(layout_rows[0]["table_cells"], [["楼名", "房间号"], ["综合楼", "109 室"]])

        unit_rows = [
            json.loads(line)
            for line in artifacts.document_units_bytes.decode("utf-8").splitlines()
            if line.strip()
        ]
        self.assertIn("table", {row["unit_type"] for row in unit_rows})
        self.assertIn("table_unit", {row["unit_type"] for row in unit_rows})
        self.assertIn("综合楼", artifacts.body_markdown)

    def test_still_returns_none_for_heading_only_qr_like_output(self) -> None:
        payload = {
            "result": {
                "layoutParsingResults": [
                    {
                        "markdown": {"text": "## 回"},
                        "prunedResult": {
                            "parsing_res_list": [
                                {
                                    "block_id": 0,
                                    "block_label": "paragraph_title",
                                    "block_content": "回",
                                }
                            ]
                        },
                    }
                ]
            }
        }

        artifacts = build_authenticated_notice_ocr_attachment_artifacts(
            document_id="notice_attachment:muc_internal_portal:352633:attachment-0001",
            version_id="sha256:test",
            source_uri="campusnotice://muc_internal_portal/notice/352633",
            title="测试二维码",
            attachment_ref_id="attachment-0001",
            provider_response_bytes=_jsonl_bytes(payload),
            metadata={"source_resource_role": "inline_image"},
        )

        self.assertIsNone(artifacts)
