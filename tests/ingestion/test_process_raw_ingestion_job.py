from __future__ import annotations

import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from campus_ingestion_worker.process_raw_ingestion_job import (
    OnlineOcrParseResult,
    process_raw_ingestion_job,
)


class _FakeObjectStore:
    def __init__(self) -> None:
        self.uploads: list[dict[str, object]] = []

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self.uploads.append(
            {
                "bucket": bucket,
                "key": key,
                "data": data,
                "content_type": content_type,
            }
        )


class _FakeOnlineOcrClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrParseResult:
        self.calls.append(pdf_path)
        provider_payload = {
            "result": {
                "layoutParsingResults": [
                    {
                        "markdown": {
                            "text": "remote ocr text",
                            "images": {},
                        }
                    }
                ]
            },
            "logId": "log-001",
        }
        structured_payload = {
            "doc_id": "handbook:remote-student-handbook",
            "version_id": "v1:remote-student-handbook",
            "chunk_id": "document-0000",
            "clean_text": "remote ocr text",
            "source_pdf": pdf_path.name,
            "source_url": None,
            "source_md": None,
            "source": {"id": None},
            "acl": {"level": "public", "allow_groups": []},
        }
        return OnlineOcrParseResult(
            provider_result_bytes=(json.dumps(provider_payload, ensure_ascii=False) + "\n").encode("utf-8"),
            structured_result_bytes=(json.dumps(structured_payload, ensure_ascii=False) + "\n").encode("utf-8"),
        )


class _VolatileFakeOnlineOcrClient:
    def __init__(self) -> None:
        self.counter = 0

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrParseResult:
        self.counter += 1
        provider_payload = {
            "result": {
                "layoutParsingResults": [
                    {
                        "markdown": {
                            "text": "same normalized text",
                            "images": {},
                        }
                    }
                ]
            },
            "logId": f"log-{self.counter:03d}",
        }
        structured_payload = {
            "doc_id": "handbook:volatile",
            "version_id": "v1:volatile",
            "chunk_id": "document-0000",
            "clean_text": "same normalized text",
            "source_pdf": pdf_path.name,
            "source_url": None,
            "source_md": None,
            "source": {"id": None},
            "acl": {"level": "public", "allow_groups": []},
        }
        return OnlineOcrParseResult(
            provider_result_bytes=(json.dumps(provider_payload, ensure_ascii=False) + "\n").encode("utf-8"),
            structured_result_bytes=(json.dumps(structured_payload, ensure_ascii=False) + "\n").encode("utf-8"),
        )


class ProcessRawIngestionJobTest(unittest.TestCase):
    def test_process_raw_ingestion_job_writes_raw_provider_and_structured_artifacts(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_root = root / "raw"
            raw_root.mkdir(parents=True)
            raw_path = raw_root / "student-handbook.pdf"
            raw_bytes = b"%PDF-1.4 remote student handbook"
            raw_path.write_bytes(raw_bytes)
            object_store = _FakeObjectStore()
            online_ocr = _FakeOnlineOcrClient()

            report = process_raw_ingestion_job(
                env={
                    "CAMPUSRAG_RAW_ROOT": str(raw_root),
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "DOCUMENT_REGISTRY_PATH": str(root / "registry" / "student_handbook.json"),
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_PARSER_VERSION": "paddleocr-vl-1.5",
                    "INGESTION_EMBEDDING_MODEL": "text-embedding-3-large",
                },
                object_store=object_store,
                online_ocr=online_ocr,
            )

            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_key = (
                "student_handbook/raw-source:student-handbook-pdf/"
                f"sha256:{raw_hash}/raw/student-handbook.pdf"
            )

            self.assertEqual(report.import_mode, "raw_ingestion")
            self.assertEqual(report.success_count, 1)
            self.assertEqual(report.failed_count, 0)
            self.assertEqual(report.raw_uploaded_count, 1)
            self.assertEqual(report.raw_reused_count, 0)
            self.assertEqual(report.document_ids, ("handbook:remote-student-handbook",))
            self.assertEqual(online_ocr.calls, [raw_path])
            self.assertEqual(len(object_store.uploads), 3)
            self.assertEqual(object_store.uploads[0]["key"], raw_key)
            self.assertEqual(
                object_store.uploads[1]["key"],
                "student_handbook/handbook:remote-student-handbook/v1:remote-student-handbook/processed/provider-result.jsonl",
            )
            self.assertEqual(
                object_store.uploads[2]["key"],
                "student_handbook/handbook:remote-student-handbook/v1:remote-student-handbook/processed/structured.jsonl",
            )
            self.assertNotIn(b"provider_result", object_store.uploads[2]["data"])
            self.assertNotIn(b"provider_log_id", object_store.uploads[2]["data"])

            registry_payload = json.loads(
                (root / "registry" / "student_handbook.json").read_text(encoding="utf-8")
            )
            saved = registry_payload["handbook:remote-student-handbook::v1:remote-student-handbook"]
            self.assertEqual(saved["raw_object_key"], raw_key)
            self.assertEqual(saved["raw_source_filename"], "student-handbook.pdf")
            self.assertEqual(
                saved["provider_result_object_key"],
                "student_handbook/handbook:remote-student-handbook/v1:remote-student-handbook/processed/provider-result.jsonl",
            )
            self.assertEqual(
                saved["structured_object_key"],
                "student_handbook/handbook:remote-student-handbook/v1:remote-student-handbook/processed/structured.jsonl",
            )
            self.assertEqual(
                saved["processed_object_keys"],
                [
                    "student_handbook/handbook:remote-student-handbook/v1:remote-student-handbook/processed/provider-result.jsonl",
                    "student_handbook/handbook:remote-student-handbook/v1:remote-student-handbook/processed/structured.jsonl",
                ],
            )
            self.assertEqual(saved["import_source"], "raw_online_ocr")

    def test_duplicate_raw_ingestion_skips_when_provider_raw_result_changes_but_normalized_output_is_stable(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_root = root / "raw"
            raw_root.mkdir(parents=True)
            raw_root.joinpath("volatile.pdf").write_bytes(b"%PDF-1.4 volatile")
            object_store = _FakeObjectStore()
            online_ocr = _VolatileFakeOnlineOcrClient()
            env = {
                "CAMPUSRAG_RAW_ROOT": str(raw_root),
                "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                "OCR_API_KEY": "token",
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "DOCUMENT_REGISTRY_PATH": str(root / "registry" / "student_handbook.json"),
                "IMPORT_REPORT_DIR": str(root / "reports"),
                "INGESTION_PARSER_VERSION": "paddleocr-vl-1.5",
                "INGESTION_EMBEDDING_MODEL": "text-embedding-3-large",
            }

            first = process_raw_ingestion_job(env=env, object_store=object_store, online_ocr=online_ocr)
            second = process_raw_ingestion_job(env=env, object_store=object_store, online_ocr=online_ocr)

            self.assertEqual(first.success_count, 1)
            self.assertEqual(second.success_count, 0)
            self.assertEqual(second.skipped_count, 1)

    def test_process_raw_ingestion_job_requires_ocr_credentials(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_root = root / "raw"
            raw_root.mkdir(parents=True)
            raw_root.joinpath("student-handbook.pdf").write_bytes(b"%PDF-1.4 remote student handbook")

            with self.assertRaisesRegex(ValueError, "OCR_BASE_URL and OCR_API_KEY"):
                process_raw_ingestion_job(
                    env={
                        "CAMPUSRAG_RAW_ROOT": str(raw_root),
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "DOCUMENT_REGISTRY_PATH": str(root / "registry" / "student_handbook.json"),
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                        "INGESTION_PARSER_VERSION": "paddleocr-vl-1.5",
                        "INGESTION_EMBEDDING_MODEL": "text-embedding-3-large",
                    },
                    object_store=_FakeObjectStore(),
                )


if __name__ == "__main__":
    unittest.main()
