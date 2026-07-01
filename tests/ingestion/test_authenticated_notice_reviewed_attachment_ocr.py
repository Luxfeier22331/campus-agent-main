from __future__ import annotations

import json
import unittest

from campus_ingestion_core.authenticated_notice_reviewed_attachment_ocr import (
    ReviewedAttachmentOcrEvidence,
    ReviewedAttachmentOcrResult,
    admit_reviewed_attachment_ocr_document,
    build_reviewed_attachment_ocr_registry_record,
    write_reviewed_attachment_ocr_artifacts,
)


class ReviewedAttachmentOcrAdmissionTest(unittest.TestCase):
    def test_admits_reviewed_pdf_layout_as_base_attachment_child_document(self) -> None:
        evidence = ReviewedAttachmentOcrEvidence(
            notice_id="245272",
            notice_title="关于2024年秋季学期两校区学生通勤班车运营的通知",
            release_time="2024-08-30 08:48",
            organization="丰台校区管理委员会",
            attachment_ref_id="attachment-0001",
            filename="附件：关于优化两校区学生通勤班车方案的通知（试行）.pdf",
            mime_type="application/pdf",
            byte_size=1526365,
            sha256="4ed7e142502d7141ff4551356310ef05c27e4fb10724ffb44c631a1e9faada95",
            object_key="authenticated_notice_portal/attachment-4ed7e142502d/2024/sha256/x/capture/file.pdf",
            source_url="https://portal.example.edu/comsys-portal-notice-web/download?id=x&notice_id=245272",
        )
        result = ReviewedAttachmentOcrResult(
            provider="operator-reviewed-pdf",
            model="manual-layout-v1",
            confidence="high",
            provider_response_bytes=_provider_response_bytes(),
            review_notes=("confirmed from rendered PDF pages",),
        )

        decision = admit_reviewed_attachment_ocr_document(
            evidence=evidence,
            result=result,
            generated_at="2026-04-28T13:40:00+08:00",
        )

        self.assertEqual(decision.status, "admitted")
        self.assertEqual(decision.reason, "reviewed_attachment_ocr_admitted")
        self.assertIsNotNone(decision.document)
        assert decision.document is not None
        self.assertEqual(
            decision.document.document_id,
            "notice_attachment:example_internal_portal:245272:attachment-0001",
        )
        units = [
            json.loads(line)
            for line in decision.document.document_units_bytes.decode("utf-8").splitlines()
            if line.strip()
        ]
        table_units = [unit for unit in units if unit.get("unit_type") == "table_unit"]
        self.assertTrue(table_units)
        self.assertEqual(
            table_units[0]["table_cells"][1],
            ["工作日", "海淀校区至丰台校区", "08:10", "学生", "48座"],
        )
        self.assertIn(
            "附件：关于优化两校区学生通勤班车方案的通知（试行）",
            decision.document.canonical_markdown_bytes.decode("utf-8"),
        )

        object_store = _FakeObjectStore()
        artifact_report = write_reviewed_attachment_ocr_artifacts(
            document=decision.document,
            object_store=object_store,
            derived_bucket="campus-agent-derived",
        )
        record = build_reviewed_attachment_ocr_registry_record(
            evidence=evidence,
            document=decision.document,
            artifact_report=artifact_report,
            generated_at="2026-04-28T13:40:00+08:00",
        )

        self.assertEqual(record.document_id, decision.document.document_id)
        self.assertEqual(record.import_source, "authenticated_notice_reviewed_attachment_ocr")
        self.assertEqual(record.source_channel, "authenticated_notice_portal")
        self.assertEqual(record.published_date, "2024-08-30")
        self.assertEqual(record.document_units_object_key, artifact_report.document_units_key)
        self.assertIn(artifact_report.canonical_markdown_key, object_store.objects)
        self.assertIn(artifact_report.document_units_key, object_store.objects)


def _provider_response_bytes() -> bytes:
    page_payload = {
        "blocks": [
            {
                "blockType": "doc_title",
                "markdown": {"text": "关于优化两校区学生通勤班车方案的通知（试行）"},
            },
            {
                "blockType": "paragraph",
                "markdown": {
                    "text": "PDF内文发布时间：2023年11月11日15:55；自2023年11月13日起试行。"
                },
            },
            {
                "blockType": "table",
                "tableCells": [
                    ["适用日期", "运行方向", "发车时间", "乘车人员", "座位数"],
                    ["工作日", "海淀校区至丰台校区", "08:10", "学生", "48座"],
                    ["工作日", "海淀校区至丰台校区", "17:20", "学生", "48座"],
                    ["工作日", "丰台校区至海淀校区", "08:10", "学生", "48座"],
                    ["工作日", "丰台校区至海淀校区", "17:20", "学生", "48座"],
                    ["周六、日及法定节假日", "海淀校区至丰台校区", "08:00", "学生", "48座"],
                    ["周六、日及法定节假日", "海淀校区至丰台校区", "12:30", "学生", "48座"],
                    ["周六、日及法定节假日", "海淀校区至丰台校区", "16:30", "学生", "48座"],
                    ["周六、日及法定节假日", "丰台校区至海淀校区", "08:00", "学生", "48座"],
                    ["周六、日及法定节假日", "丰台校区至海淀校区", "12:30", "学生", "48座"],
                    ["周六、日及法定节假日", "丰台校区至海淀校区", "18:10", "学生", "48座"],
                ],
            },
            {
                "blockType": "paragraph",
                "markdown": {
                    "text": "学生在服务门户填写《学生乘坐通勤班车申请》，学院辅导员审批通过后即可乘车。"
                },
            },
        ]
    }
    return (json.dumps(page_payload, ensure_ascii=False) + "\n").encode("utf-8")


class _FakeObjectStore:
    def __init__(self) -> None:
        self.objects: dict[str, bytes] = {}

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self.objects[key] = data


if __name__ == "__main__":
    unittest.main()
