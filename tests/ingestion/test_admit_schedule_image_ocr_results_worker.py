from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from campus_ingestion_core.internal_notice_consumption_projection_routing import (
    parse_notice_attachment_document_id,
)
from campus_ingestion_core.internal_notice_schedule_image_ocr import (
    InMemoryScheduleImageOcrAttemptStore,
)
from campus_ingestion_worker.admit_schedule_image_ocr_results import (
    admit_schedule_image_ocr_results,
)

from tests.support.in_memory_registry import InMemoryDocumentRegistry


class AdmitScheduleImageOcrResultsWorkerTest(unittest.TestCase):
    def test_plan_reports_admitted_document_ids_without_writes(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_schedule_ocr_fixture(root)

            with patch(
                "campus_ingestion_worker.admit_schedule_image_ocr_results."
                "_assert_consumer_gate_allows"
            ):
                report = admit_schedule_image_ocr_results(
                    ocr_output_dir=root,
                    notice_ids=("355867",),
                    consumer_admission_manifest_path=root / "admission.json",
                    run_id="schedule-ocr-test",
                    generated_at="2026-04-28T08:56:20+08:00",
                    source_bucket="campus-rag-source",
                    derived_bucket="campus-rag-derived",
                    mode="plan",
                )

        document_id = "notice_attachment:muc_internal_portal:355867:attachment-0001:schedule-ocr"
        self.assertFalse(report["write_enabled"])
        self.assertEqual(report["admitted_document_count"], 1)
        self.assertEqual(report["admitted_document_ids"], [document_id])
        self.assertEqual(report["materialized_document_ids"], [])
        self.assertEqual(report["source_artifact_write_count"], 0)
        self.assertEqual(report["child_artifact_write_count"], 0)
        self.assertEqual(report["registry_upsert_count"], 0)

    def test_admits_selected_ocr_result_as_child_document(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_schedule_ocr_fixture(root)
            object_store = _FakeObjectStore()
            registry = InMemoryDocumentRegistry()
            attempt_store = InMemoryScheduleImageOcrAttemptStore()

            with patch(
                "campus_ingestion_worker.admit_schedule_image_ocr_results."
                "_assert_consumer_gate_allows"
            ):
                report = admit_schedule_image_ocr_results(
                    ocr_output_dir=root,
                    notice_ids=("355867",),
                    consumer_admission_manifest_path=root / "admission.json",
                    run_id="schedule-ocr-test",
                    generated_at="2026-04-28T08:56:20+08:00",
                    source_bucket="campus-rag-source",
                    derived_bucket="campus-rag-derived",
                    mode="admit_and_materialize",
                    object_store=object_store,
                    registry=registry,
                    attempt_store=attempt_store,
                )

        self.assertEqual(report["admitted_document_count"], 1)
        self.assertEqual(report["source_artifact_write_count"], 3)
        self.assertEqual(report["child_artifact_write_count"], 2)
        self.assertEqual(report["registry_upsert_count"], 1)
        self.assertEqual(len(object_store.put_calls), 5)
        self.assertEqual(len(attempt_store.attempts), 1)
        document_id = "notice_attachment:muc_internal_portal:355867:attachment-0001:schedule-ocr"
        self.assertEqual(report["admitted_document_ids"], [document_id])
        self.assertEqual(report["materialized_document_ids"], [document_id])
        self.assertEqual(len(registry.list_versions(document_id)), 1)

    def test_rejects_ocr_result_without_provider_or_model(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            _write_schedule_ocr_fixture(root)
            result_path = root / "355867" / "image-1" / "ocr-result.json"
            payload = json.loads(result_path.read_text(encoding="utf-8"))
            payload.pop("provider")
            payload.pop("model")
            _write_json(result_path, payload)

            with (
                patch(
                    "campus_ingestion_worker.admit_schedule_image_ocr_results."
                    "_assert_consumer_gate_allows"
                ),
                self.assertRaisesRegex(ValueError, "schedule OCR result missing provider"),
            ):
                admit_schedule_image_ocr_results(
                    ocr_output_dir=root,
                    notice_ids=("355867",),
                    consumer_admission_manifest_path=root / "admission.json",
                    run_id="schedule-ocr-test",
                    generated_at="2026-04-28T08:56:20+08:00",
                    source_bucket="campus-rag-source",
                    derived_bucket="campus-rag-derived",
                    mode="plan",
                )

    def test_attachment_lineage_parser_accepts_schedule_ocr_subtype(self) -> None:
        self.assertEqual(
            parse_notice_attachment_document_id(
                "notice_attachment:muc_internal_portal:355867:attachment-1:schedule-ocr"
            ),
            ("muc_internal_portal", "355867", "attachment-1"),
        )
        self.assertEqual(
            parse_notice_attachment_document_id(
                "notice_attachment:muc_internal_portal:355867:attachment-0001:schedule-ocr"
            ),
            ("muc_internal_portal", "355867", "attachment-0001"),
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


def _write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _write_schedule_ocr_fixture(root: Path) -> None:
    image_dir = root / "355867" / "image-1"
    image_dir.mkdir(parents=True)
    _write_json(
        image_dir / "manifest.json",
        {
            "notice_id": "355867",
            "notice_title": "关于两校区班车安排的通知",
            "release_time": "2026-04-25 13:11",
            "organization": "丰台校区管理委员会",
            "image_index": 1,
            "attachment_ref_id": "attachment-1",
            "filename": "table.png",
            "mime_type": "image/png",
            "byte_size": 123,
            "sha256": "f" * 64,
            "object_key": "authenticated_notice_portal/attachment/capture/table.png",
            "image_use": "schedule_table_image",
        },
    )
    _write_json(
        image_dir / "ocr-result.json",
        {
            "provider": "fixture-ocr",
            "model": "fixture-table-v1",
            "confidence": "medium",
            "extracted_text": "4月28日-5月5日 丰台校区至海淀校区 08:00",
            "tables": [
                [
                    ["日期", "线路", "发车时间"],
                    ["4月28日-5月5日", "丰台校区→海淀校区", "08:00"],
                ]
            ],
        },
    )


if __name__ == "__main__":
    unittest.main()
