from __future__ import annotations

import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from campus_ingestion_core.raw_ingestion import build_online_ocr_parse_result
from campus_ingestion_core.registry import FileDocumentRegistry, FileRawAssetRegistry
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
        return build_online_ocr_parse_result(
            pdf_path=pdf_path,
            provider_jsonl_bytes=(json.dumps(provider_payload, ensure_ascii=False) + "\n").encode("utf-8"),
            model="PaddleOCR-VL-1.5",
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
        return build_online_ocr_parse_result(
            pdf_path=pdf_path,
            provider_jsonl_bytes=(json.dumps(provider_payload, ensure_ascii=False) + "\n").encode("utf-8"),
            model="PaddleOCR-VL-1.5",
        )


class _CurriculumPlanFakeOnlineOcrClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrParseResult:
        self.calls.append(pdf_path)
        provider_payload = {"result": {"layoutParsingResults": [{"markdown": {"text": "page 1", "images": {}}}]}}
        structured_rows = [
            {
                "doc_id": "curriculum:full-run",
                "version_id": "v1:full-run",
                "chunk_id": "document-0000",
                "clean_text": "Plan one text\n\nPlan two text",
                "source_pdf": pdf_path.name,
                "source_url": None,
                "source_md": None,
                "source": {"id": str(pdf_path.resolve())},
                "page_start": 1,
                "page_end": 2,
                "acl": {"level": "public", "allow_groups": []},
            },
            {
                "doc_id": "curriculum:full-run",
                "version_id": "v1:full-run",
                "chunk_id": "page-0001",
                "clean_text": "Plan one text",
                "source_pdf": pdf_path.name,
                "source_url": None,
                "source_md": None,
                "source": {"id": str(pdf_path.resolve())},
                "page_start": 1,
                "page_end": 1,
                "acl": {"level": "public", "allow_groups": []},
            },
            {
                "doc_id": "curriculum:full-run",
                "version_id": "v1:full-run",
                "chunk_id": "page-0002",
                "clean_text": "Plan two text",
                "source_pdf": pdf_path.name,
                "source_url": None,
                "source_md": None,
                "source": {"id": str(pdf_path.resolve())},
                "page_start": 2,
                "page_end": 2,
                "acl": {"level": "public", "allow_groups": []},
            },
        ]
        return OnlineOcrParseResult(
            provider_result_bytes=(json.dumps(provider_payload, ensure_ascii=False) + "\n").encode("utf-8"),
            structured_result_bytes=(
                "\n".join(json.dumps(row, ensure_ascii=False) for row in structured_rows) + "\n"
            ).encode("utf-8"),
        )


class ProcessRawIngestionJobTest(unittest.TestCase):
    def test_process_raw_ingestion_job_provider_only_writes_raw_and_asset_level_provider_result(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_root = root / "raw"
            raw_root.mkdir(parents=True)
            raw_path = raw_root / "student-handbook.pdf"
            raw_bytes = b"%PDF-1.4 remote student handbook"
            raw_path.write_bytes(raw_bytes)
            object_store = _FakeObjectStore()
            online_ocr = _FakeOnlineOcrClient()
            registry = FileDocumentRegistry(root / "registry" / "student_handbook_documents.json")
            raw_asset_registry = FileRawAssetRegistry(root / "registry" / "student_handbook_raw_assets.json")

            report = process_raw_ingestion_job(
                env={
                    "CAMPUSRAG_RAW_ROOT": str(raw_root),
                    "RAW_INGESTION_ARTIFACT_MODE": "provider_only",
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "text-embedding-3-large",
                },
                object_store=object_store,
                online_ocr=online_ocr,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"student_handbook/assets/student-handbook-pdf/sha256/{raw_hash}/student-handbook.pdf"
            provider_key = (
                f"student_handbook/assets/student-handbook-pdf/sha256/{raw_hash}/provider-result.jsonl"
            )

            self.assertEqual(report.import_mode, "raw_ingestion")
            self.assertEqual(report.success_count, 1)
            self.assertEqual(report.skipped_count, 0)
            self.assertEqual(report.failed_count, 0)
            self.assertEqual(report.raw_uploaded_count, 1)
            self.assertEqual(report.raw_reused_count, 0)
            self.assertEqual(report.document_ids, ())
            self.assertEqual(online_ocr.calls, [raw_path])
            self.assertEqual(
                [upload["key"] for upload in object_store.uploads],
                [raw_key, provider_key],
            )

            self.assertFalse((root / "registry" / "student_handbook_documents.json").exists())
            raw_asset_registry_payload = json.loads(
                (root / "registry" / "student_handbook_raw_assets.json").read_text(encoding="utf-8")
            )
            self.assertEqual(
                raw_asset_registry_payload,
                {
                    f"asset:student-handbook-pdf::{raw_version_id}": {
                        "content_hash": raw_hash,
                        "corpus": "student_handbook",
                        "import_source": "raw_online_ocr",
                        "ingestion_timestamp": raw_asset_registry_payload[
                            f"asset:student-handbook-pdf::{raw_version_id}"
                        ]["ingestion_timestamp"],
                        "object_key": raw_key,
                        "raw_asset_id": "asset:student-handbook-pdf",
                        "raw_source_uri": f"file://{raw_path.resolve()}",
                        "raw_version_id": raw_version_id,
                        "source_filename": "student-handbook.pdf",
                    }
                },
            )

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
            registry = FileDocumentRegistry(root / "registry" / "student_handbook_documents.json")
            raw_asset_registry = FileRawAssetRegistry(root / "registry" / "student_handbook_raw_assets.json")

            report = process_raw_ingestion_job(
                env={
                    "CAMPUSRAG_RAW_ROOT": str(raw_root),
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "text-embedding-3-large",
                },
                object_store=object_store,
                online_ocr=online_ocr,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"student_handbook/assets/student-handbook-pdf/sha256/{raw_hash}/student-handbook.pdf"

            self.assertEqual(report.import_mode, "raw_ingestion")
            self.assertEqual(report.success_count, 1)
            self.assertEqual(report.failed_count, 0)
            self.assertEqual(report.raw_uploaded_count, 1)
            self.assertEqual(report.raw_reused_count, 0)
            self.assertEqual(report.document_ids, ("handbook:student-handbook",))
            self.assertEqual(online_ocr.calls, [raw_path])
            self.assertEqual(len(object_store.uploads), 3)
            self.assertEqual(object_store.uploads[0]["key"], raw_key)
            self.assertEqual(
                object_store.uploads[1]["key"],
                f"student_handbook/documents/handbook/student-handbook/sha256/{raw_hash}/provider-result.jsonl",
            )
            self.assertEqual(
                object_store.uploads[2]["key"],
                f"student_handbook/documents/handbook/student-handbook/sha256/{raw_hash}/structured.jsonl",
            )
            self.assertNotIn(b"provider_result", object_store.uploads[2]["data"])
            self.assertNotIn(b"provider_log_id", object_store.uploads[2]["data"])

            registry_payload = json.loads(
                (root / "registry" / "student_handbook_documents.json").read_text(encoding="utf-8")
            )
            saved = registry_payload[f"handbook:student-handbook::{raw_version_id}"]
            self.assertEqual(
                saved["raw_asset"],
                {
                    "raw_asset_id": "asset:student-handbook-pdf",
                    "raw_version_id": raw_version_id,
                    "page_start": 1,
                    "page_end": 1,
                },
            )
            self.assertEqual(
                saved["provider_result_object_key"],
                f"student_handbook/documents/handbook/student-handbook/sha256/{raw_hash}/provider-result.jsonl",
            )
            self.assertEqual(
                saved["structured_object_key"],
                f"student_handbook/documents/handbook/student-handbook/sha256/{raw_hash}/structured.jsonl",
            )
            self.assertEqual(
                saved["processed_object_keys"],
                [
                    f"student_handbook/documents/handbook/student-handbook/sha256/{raw_hash}/provider-result.jsonl",
                    f"student_handbook/documents/handbook/student-handbook/sha256/{raw_hash}/structured.jsonl",
                ],
            )
            self.assertEqual(saved["import_source"], "raw_online_ocr")
            self.assertEqual(saved["parser_version"], "paddleocr-vl-1.5")
            self.assertEqual(saved["cleaning_policy_version"], "student_handbook_cleaning_v1")
            raw_asset_registry_payload = json.loads(
                (root / "registry" / "student_handbook_raw_assets.json").read_text(encoding="utf-8")
            )
            self.assertEqual(
                raw_asset_registry_payload,
                {
                    f"asset:student-handbook-pdf::{raw_version_id}": {
                        "content_hash": raw_hash,
                        "corpus": "student_handbook",
                        "import_source": "raw_online_ocr",
                        "ingestion_timestamp": saved["ingestion_timestamp"],
                        "object_key": raw_key,
                        "raw_asset_id": "asset:student-handbook-pdf",
                        "raw_source_uri": f"file://{raw_path.resolve()}",
                        "raw_version_id": raw_version_id,
                        "source_filename": "student-handbook.pdf",
                    }
                },
            )

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
                "IMPORT_REPORT_DIR": str(root / "reports"),
                "INGESTION_EMBEDDING_MODEL": "text-embedding-3-large",
            }
            registry = FileDocumentRegistry(root / "registry" / "student_handbook_documents.json")
            raw_asset_registry = FileRawAssetRegistry(root / "registry" / "student_handbook_raw_assets.json")

            first = process_raw_ingestion_job(
                env=env,
                object_store=object_store,
                online_ocr=online_ocr,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )
            second = process_raw_ingestion_job(
                env=env,
                object_store=object_store,
                online_ocr=online_ocr,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(first.success_count, 1)
            self.assertEqual(second.success_count, 0)
            self.assertEqual(second.skipped_count, 1)
            self.assertEqual(second.raw_uploaded_count, 0)
            self.assertEqual(second.raw_reused_count, 1)
            self.assertEqual(len(object_store.uploads), 4)
            self.assertEqual(object_store.uploads[-1]["key"], object_store.uploads[1]["key"])

    def test_provider_only_reuses_raw_asset_but_rewrites_provider_result(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_root = root / "raw"
            raw_root.mkdir(parents=True)
            raw_path = raw_root / "volatile.pdf"
            raw_bytes = b"%PDF-1.4 volatile"
            raw_path.write_bytes(raw_bytes)
            object_store = _FakeObjectStore()
            online_ocr = _VolatileFakeOnlineOcrClient()
            env = {
                "CAMPUSRAG_RAW_ROOT": str(raw_root),
                "RAW_INGESTION_ARTIFACT_MODE": "provider_only",
                "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                "OCR_API_KEY": "token",
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "IMPORT_REPORT_DIR": str(root / "reports"),
                "INGESTION_EMBEDDING_MODEL": "text-embedding-3-large",
            }
            registry = FileDocumentRegistry(root / "registry" / "student_handbook_documents.json")
            raw_asset_registry = FileRawAssetRegistry(root / "registry" / "student_handbook_raw_assets.json")

            first = process_raw_ingestion_job(
                env=env,
                object_store=object_store,
                online_ocr=online_ocr,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )
            second = process_raw_ingestion_job(
                env=env,
                object_store=object_store,
                online_ocr=online_ocr,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            provider_key = f"student_handbook/assets/volatile-pdf/sha256/{raw_hash}/provider-result.jsonl"

            self.assertEqual(first.success_count, 1)
            self.assertEqual(second.success_count, 1)
            self.assertEqual(second.skipped_count, 0)
            self.assertEqual(second.raw_uploaded_count, 0)
            self.assertEqual(second.raw_reused_count, 1)
            self.assertEqual(len(object_store.uploads), 3)
            self.assertEqual(object_store.uploads[-1]["key"], provider_key)

    def test_provider_only_rejects_split_manifest(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_root = root / "raw"
            raw_root.mkdir(parents=True)
            raw_root.joinpath("student-handbook.pdf").write_bytes(b"%PDF-1.4 remote student handbook")
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "student_handbook",
                        "raw_asset_id": "asset:student-handbook-pdf",
                        "documents": [],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )

            with self.assertRaisesRegex(ValueError, "provider_only does not support split manifest ingestion"):
                process_raw_ingestion_job(
                    env={
                        "CAMPUSRAG_RAW_ROOT": str(raw_root),
                        "RAW_INGESTION_ARTIFACT_MODE": "provider_only",
                        "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                        "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                        "OCR_API_KEY": "token",
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                    },
                    object_store=_FakeObjectStore(),
                    online_ocr=_FakeOnlineOcrClient(),
                    registry=FileDocumentRegistry(root / "registry" / "student_handbook_documents.json"),
                    raw_asset_registry=FileRawAssetRegistry(
                        root / "registry" / "student_handbook_raw_assets.json"
                    ),
                )

    def test_process_raw_ingestion_job_supports_curriculum_plan_split_manifest(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_root = root / "raw"
            raw_root.mkdir(parents=True)
            raw_path = raw_root / "curriculum-plan.pdf"
            raw_bytes = b"%PDF-1.4 curriculum plan"
            raw_path.write_bytes(raw_bytes)
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_payload = {
                "manifest_version": "curriculum_plan_split_manifest_v1",
                "corpus": "curriculum_plan",
                "raw_asset_id": "asset:curriculum-plan-master-pdf",
                "documents": [
                    {
                        "document_id": "curriculum:plan-001",
                        "title": "Plan 001",
                        "page_start": 1,
                        "page_end": 1,
                        "source_uri": "https://campus.example/curriculum/plan-001",
                    },
                    {
                        "document_id": "curriculum:plan-002",
                        "title": "Plan 002",
                        "page_start": 2,
                        "page_end": 2,
                        "source_uri": "https://campus.example/curriculum/plan-002",
                        "acl_groups": ["students"],
                        "campus_scope": "main",
                    },
                ],
            }
            split_manifest_path.write_text(
                json.dumps(split_manifest_payload, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()
            online_ocr = _CurriculumPlanFakeOnlineOcrClient()
            registry = FileDocumentRegistry(root / "registry" / "curriculum_plan_documents.json")
            raw_asset_registry = FileRawAssetRegistry(root / "registry" / "curriculum_plan_raw_assets.json")

            report = process_raw_ingestion_job(
                env={
                    "CAMPUSRAG_RAW_ROOT": str(raw_root),
                    "INGESTION_CORPUS": "curriculum_plan",
                    "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_EMBEDDING_MODEL": "text-embedding-3-large",
                },
                object_store=object_store,
                online_ocr=online_ocr,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            digest_1 = hashlib.sha256(
                "|".join(
                    [raw_version_id, "curriculum_plan_split_manifest_v1", "curriculum:plan-001", "1", "1"]
                ).encode("utf-8")
            ).hexdigest()[:12]
            digest_2 = hashlib.sha256(
                "|".join(
                    [raw_version_id, "curriculum_plan_split_manifest_v1", "curriculum:plan-002", "2", "2"]
                ).encode("utf-8")
            ).hexdigest()[:12]

            self.assertEqual(report.success_count, 2)
            self.assertEqual(report.failed_count, 0)
            self.assertEqual(report.raw_uploaded_count, 1)
            self.assertEqual(report.raw_reused_count, 1)
            self.assertEqual(report.document_ids, ("curriculum:plan-001", "curriculum:plan-002"))
            self.assertEqual(online_ocr.calls, [raw_path])
            self.assertEqual(
                [upload["key"] for upload in object_store.uploads],
                [
                    f"curriculum_plan/assets/curriculum-plan-master-pdf/sha256/{raw_hash}/provider-result.jsonl",
                    f"curriculum_plan/assets/curriculum-plan-master-pdf/sha256/{raw_hash}/structured-full.jsonl",
                    f"curriculum_plan/assets/curriculum-plan-master-pdf/sha256/{raw_hash}/curriculum-plan.pdf",
                    f"curriculum_plan/documents/curriculum/plan-001/sha256/{raw_hash}/split/plan-001/{digest_1}/structured.jsonl",
                    f"curriculum_plan/documents/curriculum/plan-002/sha256/{raw_hash}/split/plan-002/{digest_2}/structured.jsonl",
                ],
            )

            registry_payload = json.loads(
                (root / "registry" / "curriculum_plan_documents.json").read_text(encoding="utf-8")
            )
            plan_001 = registry_payload[
                f"curriculum:plan-001::sha256:{raw_hash}:split:plan-001:{digest_1}"
            ]
            plan_002 = registry_payload[
                f"curriculum:plan-002::sha256:{raw_hash}:split:plan-002:{digest_2}"
            ]
            self.assertEqual(
                plan_001["provider_result_object_key"],
                f"curriculum_plan/assets/curriculum-plan-master-pdf/sha256/{raw_hash}/provider-result.jsonl",
            )
            self.assertEqual(
                plan_002["processed_object_keys"],
                [
                    f"curriculum_plan/assets/curriculum-plan-master-pdf/sha256/{raw_hash}/provider-result.jsonl",
                    f"curriculum_plan/documents/curriculum/plan-002/sha256/{raw_hash}/split/plan-002/{digest_2}/structured.jsonl",
                    f"curriculum_plan/assets/curriculum-plan-master-pdf/sha256/{raw_hash}/structured-full.jsonl",
                ],
            )
            self.assertEqual(plan_001["cleaning_policy_version"], "curriculum_plan_cleaning_v1")
            self.assertEqual(plan_002["cleaning_policy_version"], "curriculum_plan_cleaning_v1")
            self.assertEqual(plan_002["campus_scope"], "main")
            self.assertEqual(plan_002["acl_groups"], ["students"])

    def test_process_raw_ingestion_job_rejects_split_manifest_with_mismatched_corpus(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_root = root / "raw"
            raw_root.mkdir(parents=True)
            raw_root.joinpath("curriculum-plan.pdf").write_bytes(b"%PDF-1.4 curriculum plan")
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "curriculum_plan_split_manifest_v1",
                        "corpus": "curriculum_plan",
                        "raw_asset_id": "asset:curriculum-plan-master-pdf",
                        "documents": [
                            {
                                "document_id": "curriculum:plan-001",
                                "title": "Plan 001",
                                "page_start": 1,
                                "page_end": 1,
                                "source_uri": "https://campus.example/curriculum/plan-001",
                            },
                            {
                                "document_id": "curriculum:plan-002",
                                "title": "Plan 002",
                                "page_start": 2,
                                "page_end": 2,
                                "source_uri": "https://campus.example/curriculum/plan-002",
                                "acl_groups": ["students"],
                                "campus_scope": "main",
                            },
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()
            online_ocr = _CurriculumPlanFakeOnlineOcrClient()
            registry = FileDocumentRegistry(root / "registry" / "curriculum_plan_documents.json")
            raw_asset_registry = FileRawAssetRegistry(root / "registry" / "curriculum_plan_raw_assets.json")

            with self.assertRaisesRegex(ValueError, "split manifest corpus mismatch"):
                process_raw_ingestion_job(
                    env={
                        "CAMPUSRAG_RAW_ROOT": str(raw_root),
                        "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                        "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                        "OCR_API_KEY": "token",
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                        "INGESTION_EMBEDDING_MODEL": "text-embedding-3-large",
                    },
                    object_store=object_store,
                    online_ocr=online_ocr,
                    registry=registry,
                    raw_asset_registry=raw_asset_registry,
                )

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
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                        "INGESTION_EMBEDDING_MODEL": "text-embedding-3-large",
                    },
                    object_store=_FakeObjectStore(),
                    registry=FileDocumentRegistry(root / "registry" / "student_handbook_documents.json"),
                    raw_asset_registry=FileRawAssetRegistry(
                        root / "registry" / "student_handbook_raw_assets.json"
                    ),
                )


if __name__ == "__main__":
    unittest.main()
