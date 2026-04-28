from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from campus_ingestion_worker.admit_reviewed_attachment_ocr_results import (
    admit_reviewed_attachment_ocr_results,
)

from tests.support.in_memory_registry import InMemoryDocumentRegistry


class AdmitReviewedAttachmentOcrWorkerTest(unittest.TestCase):
    def test_admits_selected_reviewed_pdf_attachment(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            review_path = root / "review.json"
            _write_review_fixture(review_path)
            object_store = _FakeObjectStore()
            registry = InMemoryDocumentRegistry()

            with patch(
                "campus_ingestion_worker.admit_reviewed_attachment_ocr_results."
                "_assert_consumer_gate_allows"
            ):
                report = admit_reviewed_attachment_ocr_results(
                    review_input_path=review_path,
                    notice_ids=("245272",),
                    consumer_admission_manifest_path=root / "admission.json",
                    run_id="reviewed-pdf-test",
                    generated_at="2026-04-28T13:40:00+08:00",
                    derived_bucket="campus-rag-derived",
                    mode="admit_and_materialize",
                    object_store=object_store,
                    registry=registry,
                )

        document_id = "notice_attachment:muc_internal_portal:245272:attachment-0001"
        self.assertTrue(report["write_enabled"])
        self.assertEqual(report["admitted_document_ids"], [document_id])
        self.assertEqual(report["materialized_document_ids"], [document_id])
        self.assertEqual(report["artifact_write_count"], 4)
        self.assertEqual(report["registry_upsert_count"], 1)
        self.assertEqual(len(object_store.put_calls), 4)
        self.assertEqual(len(registry.list_versions(document_id)), 1)


def _write_review_fixture(path: Path) -> None:
    path.write_text(
        json.dumps(
            {
                "schema_version": "authenticated_notice_reviewed_attachment_ocr.v1",
                "items": [
                    {
                        "notice_id": "245272",
                        "notice_title": "关于2024年秋季学期两校区学生通勤班车运营的通知",
                        "release_time": "2024-08-30 08:48",
                        "organization": "丰台校区管理委员会",
                        "attachment_ref_id": "attachment-1",
                        "filename": "附件：关于优化两校区学生通勤班车方案的通知（试行）.pdf",
                        "mime_type": "application/pdf",
                        "byte_size": 1526365,
                        "sha256": "4ed7e142502d7141ff4551356310ef05c27e4fb10724ffb44c631a1e9faada95",
                        "object_key": "authenticated_notice_portal/attachment/capture/file.pdf",
                        "source_url": "https://my.muc.edu.cn/download?notice_id=245272",
                        "provider": "operator-reviewed-pdf",
                        "model": "manual-layout-v1",
                        "confidence": "high",
                        "review_notes": ["confirmed from rendered PDF pages"],
                        "provider_response_lines": [
                            {
                                "blocks": [
                                    {
                                        "blockType": "doc_title",
                                        "markdown": {
                                            "text": "关于优化两校区学生通勤班车方案的通知（试行）"
                                        },
                                    },
                                    {
                                        "blockType": "table",
                                        "tableCells": [
                                            ["适用日期", "运行方向", "发车时间", "乘车人员"],
                                            ["工作日", "海淀校区至丰台校区", "08:10", "学生"],
                                        ],
                                    },
                                ]
                            }
                        ],
                    }
                ],
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


class _FakeObjectStore:
    def __init__(self) -> None:
        self.put_calls: list[tuple[str, str, bytes, str]] = []

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self.put_calls.append((bucket, key, data, content_type))


if __name__ == "__main__":
    unittest.main()
