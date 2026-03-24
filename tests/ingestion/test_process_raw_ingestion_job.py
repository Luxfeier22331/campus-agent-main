from __future__ import annotations

import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest
from unittest.mock import patch

from campus_ingestion_core.handbook_cleanup import build_handbook_doc_id
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.object_store import (
    build_processed_artifact_key,
    build_processed_asset_artifact_key,
)
from campus_ingestion_core.registry import FileDocumentRegistry, FileRawAssetRegistry
from campus_ingestion_worker.process_raw_ingestion_job import (
    OnlineOcrProviderResult,
    process_raw_ingestion_job,
)

FIXTURE_DIR = Path(__file__).resolve().parents[1] / "fixtures" / "student_handbook"


class _FakeObjectStore:
    def __init__(self) -> None:
        self.uploads: list[dict[str, object]] = []
        self.objects: dict[tuple[str, str], bytes] = {}

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
        self.objects[(bucket, key)] = data

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]


class _FakeOnlineOcrClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
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
        return OnlineOcrProviderResult(
            provider_result_bytes=(json.dumps(provider_payload, ensure_ascii=False) + "\n").encode("utf-8"),
        )


class _VolatileFakeOnlineOcrClient:
    def __init__(self) -> None:
        self.counter = 0

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
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
        return OnlineOcrProviderResult(
            provider_result_bytes=(json.dumps(provider_payload, ensure_ascii=False) + "\n").encode("utf-8"),
        )


class _CurriculumPlanFakeOnlineOcrClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(pdf_path)
        provider_lines = [
            {
                "pageNumber": 1,
                "result": {
                    "layoutParsingResults": [
                        {
                            "blockType": "paragraph",
                            "blockId": "p1-body",
                            "readingOrder": 1,
                            "markdown": {"text": "Plan one text"},
                        }
                    ]
                },
                "logId": "log-001",
            },
            {
                "pageNumber": 2,
                "result": {
                    "layoutParsingResults": [
                        {
                            "blockType": "paragraph",
                            "blockId": "p2-body",
                            "readingOrder": 1,
                            "markdown": {"text": "Plan two text"},
                        }
                    ]
                },
                "logId": "log-002",
            },
        ]
        return OnlineOcrProviderResult(
            provider_result_bytes=(
                "\n".join(json.dumps(line, ensure_ascii=False) for line in provider_lines) + "\n"
            ).encode("utf-8"),
        )


class _StudentHandbookNormalizedFakeOnlineOcrClient:
    def __init__(self) -> None:
        self.calls: list[Path] = []

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(pdf_path)
        provider_lines = [
            {
                "result": {
                    "dataInfo": {
                        "numPages": 3,
                        "pages": [
                            {"width": 828, "height": 1151},
                            {"width": 828, "height": 1151},
                            {"width": 828, "height": 1151},
                        ],
                        "type": "pdf",
                    },
                    "layoutParsingResults": [
                        {
                            "prunedResult": {
                                "parsing_res_list": [
                                    {
                                        "blockType": "title",
                                        "blockId": "p1-title",
                                        "readingOrder": 1,
                                        "markdown": {"text": "中央民族大学奖学金评定办法"},
                                    },
                                    {
                                        "blockType": "paragraph",
                                        "blockId": "p1-body",
                                        "readingOrder": 2,
                                        "markdown": {"text": "第一条 奖学金评定坚持公开、公平、公正。"},
                                    },
                                ]
                            }
                        },
                        {
                            "prunedResult": {
                                "parsing_res_list": [
                                    {
                                        "blockType": "paragraph",
                                        "blockId": "p2-body",
                                        "readingOrder": 1,
                                        "markdown": {"text": "第二条 评定程序按照学校通知执行。"},
                                    }
                                ]
                            }
                        },
                        {
                            "prunedResult": {
                                "parsing_res_list": [
                                    {
                                        "blockType": "title",
                                        "blockId": "p3-title",
                                        "readingOrder": 1,
                                        "markdown": {"text": "中央民族大学学生违纪处分办法"},
                                    },
                                    {
                                        "blockType": "paragraph",
                                        "blockId": "p3-body",
                                        "readingOrder": 2,
                                        "markdown": {"text": "第一条 学生应当遵守校纪校规。"},
                                    },
                                ]
                            }
                        },
                    ],
                },
                "logId": "log-001",
            }
        ]
        return OnlineOcrProviderResult(
            provider_result_bytes=(
                "\n".join(json.dumps(line, ensure_ascii=False) for line in provider_lines) + "\n"
            ).encode("utf-8"),
        )


class _FixtureOnlineOcrClient:
    def __init__(self, fixture_name: str) -> None:
        self.calls: list[Path] = []
        self.fixture_name = fixture_name

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        self.calls.append(pdf_path)
        return OnlineOcrProviderResult(
            provider_result_bytes=(FIXTURE_DIR / self.fixture_name).read_bytes(),
        )


def _handbook_raw_asset_record(
    *,
    raw_asset_id: str,
    raw_version_id: str,
    raw_source_uri: str,
    content_hash: str,
    source_filename: str,
    object_key: str,
) -> RawAssetRecord:
    return RawAssetRecord(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        corpus="regulations",
        collection="student_handbook",
        raw_source_uri=raw_source_uri,
        content_hash=content_hash,
        source_filename=source_filename,
        object_key=object_key,
        ingestion_timestamp="2026-03-23T00:00:00+00:00",
        import_source="seed",
    )


def _curriculum_raw_asset_record(
    *,
    raw_asset_id: str,
    raw_version_id: str,
    raw_source_uri: str,
    content_hash: str,
    source_filename: str,
    object_key: str,
) -> RawAssetRecord:
    return RawAssetRecord(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        corpus="curriculum",
        collection="curriculum_plan",
        raw_source_uri=raw_source_uri,
        content_hash=content_hash,
        source_filename=source_filename,
        object_key=object_key,
        ingestion_timestamp="2026-03-23T00:00:00+00:00",
        import_source="seed",
    )


def _student_handbook_manifest_payload(*, title: str = "中央民族大学奖学金评定办法") -> dict[str, object]:
    return {
        "manifest_version": "student_handbook_split_manifest_v1",
        "corpus": "regulations",
        "collection": "student_handbook",
        "raw_asset_id": "asset:student-handbook-master-pdf",
        "documents": [
            {
                "document_id": "manifest:scholarship-policy",
                "title": title,
                "handbook_section": "中央民族大学学生奖励管理规定",
                "page_start": 1,
                "page_end": 1,
                "source_uri": "https://campus.example/handbook/scholarship-policy",
            }
        ],
    }


class ProcessRawIngestionJobTest(unittest.TestCase):
    def _build_curriculum_source_locator(
        self,
        *,
        raw_hash: str,
        page_start: int,
        page_end: int,
    ) -> str:
        return (
            "campusrag://source/curriculum/"
            f"curriculum-plan-master-pdf/sha256/{raw_hash}/pages/{page_start}-{page_end}"
        )

    def test_process_raw_ingestion_job_requires_registered_raw_asset_identity(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)

            with self.assertRaisesRegex(ValueError, "RAW_ASSET_ID and RAW_VERSION_ID"):
                process_raw_ingestion_job(
                    env={
                        "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                        "OCR_API_KEY": "token",
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "RAW_ASSET_REGISTRY_DATABASE_URL": "postgresql://raw-registry.example/postgres",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                    },
                    object_store=_FakeObjectStore(),
                    online_ocr=_FakeOnlineOcrClient(),
                )

    def test_process_raw_ingestion_job_provider_only_reads_registered_raw_asset_from_object_store(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 remote student handbook"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"pdf/student-handbook/undated/sha256/{raw_hash}/student-handbook.pdf"
            provider_key = build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:student-handbook-pdf",
                raw_version_id=raw_version_id,
                filename="provider-response.jsonl",
            )
            object_store = _FakeObjectStore()
            object_store.objects[("campus-rag-raw", raw_key)] = raw_bytes
            online_ocr = _FakeOnlineOcrClient()
            registry = FileDocumentRegistry(root / "registry" / "student_handbook_documents.json")
            raw_asset_registry = FileRawAssetRegistry(root / "registry" / "student_handbook_raw_assets.json")
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-raw/pdf/student-handbook/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:student-handbook-pdf",
                    "RAW_VERSION_ID": raw_version_id,
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

            self.assertEqual(report.import_mode, "raw_ingestion")
            self.assertEqual(report.success_count, 1)
            self.assertEqual(report.skipped_count, 0)
            self.assertEqual(report.failed_count, 0)
            self.assertEqual(report.raw_uploaded_count, 0)
            self.assertEqual(report.raw_reused_count, 1)
            self.assertEqual(report.document_ids, ())
            self.assertEqual(len(online_ocr.calls), 1)
            self.assertEqual(online_ocr.calls[0].name, "student-handbook.pdf")
            self.assertEqual([upload["key"] for upload in object_store.uploads], [provider_key])
            self.assertFalse((root / "registry" / "student_handbook_documents.json").exists())

    def test_student_handbook_normalized_raw_ingestion_requires_split_manifest(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 remote student handbook"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"pdf/student-handbook/undated/sha256/{raw_hash}/student-handbook.pdf"
            object_store = _FakeObjectStore()
            object_store.objects[("campus-rag-raw", raw_key)] = raw_bytes
            raw_asset_registry = FileRawAssetRegistry(root / "registry" / "student_handbook_raw_assets.json")
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-raw/pdf/student-handbook/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                )
            )

            with self.assertRaisesRegex(ValueError, "INGESTION_SPLIT_MANIFEST_PATH is required"):
                process_raw_ingestion_job(
                    env={
                        "RAW_ASSET_ID": "asset:student-handbook-pdf",
                        "RAW_VERSION_ID": raw_version_id,
                        "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                        "OCR_API_KEY": "token",
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                        "INGESTION_EMBEDDING_MODEL": "text-embedding-3-large",
                    },
                    object_store=object_store,
                    online_ocr=_FakeOnlineOcrClient(),
                    registry=FileDocumentRegistry(root / "registry" / "student_handbook_documents.json"),
                    raw_asset_registry=raw_asset_registry,
                )

    def test_process_raw_ingestion_job_normalizes_student_handbook_provider_result_into_logical_documents(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 remote student handbook"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"pdf/student-handbook-master/undated/sha256/{raw_hash}/student-handbook.pdf"
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:student-handbook-master-pdf",
                        "documents": [
                            {
                                "document_id": "manifest:scholarship-policy",
                                "title": "中央民族大学奖学金评定办法",
                                "handbook_section": "中央民族大学学生奖励管理规定",
                                "page_start": 1,
                                "page_end": 2,
                                "source_uri": "https://campus.example/handbook/scholarship-policy",
                            },
                            {
                                "document_id": "manifest:discipline-policy",
                                "title": "中央民族大学学生违纪处分办法",
                                "handbook_section": "中央民族大学学生日常管理规定",
                                "page_start": 3,
                                "page_end": 3,
                                "source_uri": "https://campus.example/handbook/discipline-policy",
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
            object_store.objects[("campus-rag-raw", raw_key)] = raw_bytes
            online_ocr = _StudentHandbookNormalizedFakeOnlineOcrClient()
            registry = FileDocumentRegistry(root / "registry" / "student_handbook_documents.json")
            raw_asset_registry = FileRawAssetRegistry(root / "registry" / "student_handbook_raw_assets.json")
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-master-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-raw/pdf/student-handbook-master/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:student-handbook-master-pdf",
                    "RAW_VERSION_ID": raw_version_id,
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

            provider_key = build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:student-handbook-master-pdf",
                raw_version_id=raw_version_id,
                filename="provider-response.jsonl",
            )
            structured_full_key = build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:student-handbook-master-pdf",
                raw_version_id=raw_version_id,
                filename="layout-elements.jsonl",
            )
            scholarship_doc_id = build_handbook_doc_id("中央民族大学奖学金评定办法")
            discipline_doc_id = build_handbook_doc_id("中央民族大学学生违纪处分办法")

            self.assertEqual(report.success_count, 2)
            self.assertEqual(report.failed_count, 0)
            self.assertEqual(report.raw_uploaded_count, 0)
            self.assertEqual(report.raw_reused_count, 0)
            self.assertEqual(report.document_ids, (scholarship_doc_id, discipline_doc_id))
            self.assertEqual(len(online_ocr.calls), 1)
            self.assertEqual(online_ocr.calls[0].name, "student-handbook.pdf")

            upload_keys = [str(upload["key"]) for upload in object_store.uploads]
            self.assertEqual(upload_keys[0:2], [provider_key, structured_full_key])
            self.assertEqual(len([key for key in upload_keys if key.endswith("/document-units.jsonl")]), 2)
            self.assertEqual(len([key for key in upload_keys if key.endswith("/canonical.md")]), 2)
            self.assertNotIn(raw_key, upload_keys)

            registry_payload = json.loads(
                (root / "registry" / "student_handbook_documents.json").read_text(encoding="utf-8")
            )
            self.assertEqual(len(registry_payload), 2)
            scholarship_record = next(
                payload for payload in registry_payload.values() if payload["document_id"] == scholarship_doc_id
            )
            discipline_record = next(
                payload for payload in registry_payload.values() if payload["document_id"] == discipline_doc_id
            )
            self.assertEqual(scholarship_record["provider_response_object_key"], provider_key)
            self.assertEqual(discipline_record["provider_response_object_key"], provider_key)
            self.assertIn(structured_full_key, scholarship_record["processed_object_keys"])
            self.assertIn(structured_full_key, discipline_record["processed_object_keys"])
            self.assertTrue(scholarship_record["canonical_markdown_object_key"].endswith("/canonical.md"))
            self.assertTrue(discipline_record["canonical_markdown_object_key"].endswith("/canonical.md"))
            self.assertEqual(scholarship_record["raw_asset"]["page_start"], 1)
            self.assertEqual(scholarship_record["raw_asset"]["page_end"], 2)
            self.assertEqual(discipline_record["raw_asset"]["page_start"], 3)
            self.assertEqual(discipline_record["raw_asset"]["page_end"], 3)
            self.assertEqual(scholarship_record["source_uri"], "https://campus.example/handbook/scholarship-policy")
            self.assertEqual(discipline_record["source_uri"], "https://campus.example/handbook/discipline-policy")
            self.assertEqual(discipline_record["acl_groups"], ["students"])
            self.assertEqual(discipline_record["campus_scope"], "main")
            self.assertEqual(scholarship_record["cleaning_policy_version"], "student_handbook_cleaning_v1")
            self.assertEqual(discipline_record["cleaning_policy_version"], "student_handbook_cleaning_v1")
            self.assertEqual(scholarship_record["parser_version"], "paddleocr-vl-1.5")
            self.assertEqual(discipline_record["parser_version"], "paddleocr-vl-1.5")
            self.assertEqual(scholarship_record["embedding_model"], "text-embedding-3-large")
            self.assertEqual(discipline_record["embedding_model"], "text-embedding-3-large")

    def test_process_raw_ingestion_job_rejects_split_manifest_with_mismatched_raw_asset_id(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 remote student handbook"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"pdf/student-handbook-master/undated/sha256/{raw_hash}/student-handbook.pdf"
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:wrong-handbook-pdf",
                        "documents": [
                            {
                                "document_id": "manifest:scholarship-policy",
                                "title": "中央民族大学奖学金评定办法",
                                "handbook_section": "中央民族大学学生奖励管理规定",
                                "page_start": 1,
                                "page_end": 2,
                                "source_uri": "https://campus.example/handbook/scholarship-policy",
                            }
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()
            object_store.objects[("campus-rag-raw", raw_key)] = raw_bytes
            raw_asset_registry = FileRawAssetRegistry(root / "registry" / "student_handbook_raw_assets.json")
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-master-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-raw/pdf/student-handbook-master/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                )
            )

            with self.assertRaisesRegex(ValueError, "split manifest raw_asset_id mismatch"):
                process_raw_ingestion_job(
                    env={
                        "RAW_ASSET_ID": "asset:student-handbook-master-pdf",
                        "RAW_VERSION_ID": raw_version_id,
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
                    online_ocr=_StudentHandbookNormalizedFakeOnlineOcrClient(),
                    registry=FileDocumentRegistry(root / "registry" / "student_handbook_documents.json"),
                    raw_asset_registry=raw_asset_registry,
                )

    def test_process_raw_ingestion_job_records_manifest_title_mismatch_without_persisting_document(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 remote student handbook"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"pdf/student-handbook-master/undated/sha256/{raw_hash}/student-handbook.pdf"
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:student-handbook-master-pdf",
                        "documents": [
                            {
                                "document_id": "manifest:scholarship-policy",
                                "title": "中央民族大学奖学金评定办法",
                                "handbook_section": "中央民族大学学生奖励管理规定",
                                "page_start": 1,
                                "page_end": 2,
                                "source_uri": "https://campus.example/handbook/scholarship-policy",
                            },
                            {
                                "document_id": "manifest:discipline-policy",
                                "title": "错误的标题",
                                "handbook_section": "中央民族大学学生日常管理规定",
                                "page_start": 3,
                                "page_end": 3,
                                "source_uri": "https://campus.example/handbook/discipline-policy",
                            },
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()
            object_store.objects[("campus-rag-raw", raw_key)] = raw_bytes
            registry = FileDocumentRegistry(root / "registry" / "student_handbook_documents.json")
            raw_asset_registry = FileRawAssetRegistry(root / "registry" / "student_handbook_raw_assets.json")
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-master-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-raw/pdf/student-handbook-master/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:student-handbook-master-pdf",
                    "RAW_VERSION_ID": raw_version_id,
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
                online_ocr=_StudentHandbookNormalizedFakeOnlineOcrClient(),
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            scholarship_doc_id = build_handbook_doc_id("中央民族大学奖学金评定办法")
            self.assertEqual(report.success_count, 1)
            self.assertEqual(report.failed_count, 1)
            self.assertEqual(report.document_ids, (scholarship_doc_id,))
            self.assertIn("manifest title mismatch", report.errors[0])
            self.assertIn("manifest:discipline-policy", report.errors[0])

            registry_payload = json.loads(
                (root / "registry" / "student_handbook_documents.json").read_text(encoding="utf-8")
            )
            self.assertEqual(len(registry_payload), 1)
            stored_record = next(iter(registry_payload.values()))
            self.assertEqual(stored_record["document_id"], scholarship_doc_id)

    def test_process_raw_ingestion_job_skips_unchanged_handbook_reingestion(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 remote student handbook stable"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"pdf/student-handbook-master/undated/sha256/{raw_hash}/student-handbook.pdf"
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(_student_handbook_manifest_payload(), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()
            object_store.objects[("campus-rag-raw", raw_key)] = raw_bytes
            registry = FileDocumentRegistry(root / "registry" / "student_handbook_documents.json")
            raw_asset_registry = FileRawAssetRegistry(root / "registry" / "student_handbook_raw_assets.json")
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-master-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-raw/pdf/student-handbook-master/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                )
            )
            env = {
                "RAW_ASSET_ID": "asset:student-handbook-master-pdf",
                "RAW_VERSION_ID": raw_version_id,
                "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                "OCR_API_KEY": "token",
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "IMPORT_REPORT_DIR": str(root / "reports"),
                "INGESTION_EMBEDDING_MODEL": "text-embedding-3-large",
            }

            first = process_raw_ingestion_job(
                env=env,
                object_store=object_store,
                online_ocr=_FixtureOnlineOcrClient("provider-result-stable.jsonl"),
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )
            second = process_raw_ingestion_job(
                env=env,
                object_store=object_store,
                online_ocr=_FixtureOnlineOcrClient("provider-result-stable.jsonl"),
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            document_id = build_handbook_doc_id("中央民族大学奖学金评定办法")
            self.assertEqual(first.success_count, 1)
            self.assertEqual(first.created_document_ids, (document_id,))
            self.assertEqual(first.updated_document_ids, ())
            self.assertEqual(first.skipped_document_ids, ())
            self.assertEqual(second.success_count, 0)
            self.assertEqual(second.skipped_count, 1)
            self.assertEqual(second.created_document_ids, ())
            self.assertEqual(second.updated_document_ids, ())
            self.assertEqual(second.skipped_document_ids, (document_id,))
            self.assertEqual(second.document_ids, ())

            report_payload = json.loads(Path(second.report_path).read_text(encoding="utf-8"))
            self.assertEqual(report_payload["created_document_ids"], [])
            self.assertEqual(report_payload["updated_document_ids"], [])
            self.assertEqual(report_payload["skipped_document_ids"], [document_id])

    def test_process_raw_ingestion_job_records_updated_document_ids_for_changed_handbook_content(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            stable_bytes = b"%PDF-1.4 remote student handbook stable"
            updated_bytes = b"%PDF-1.4 remote student handbook updated"
            stable_hash = hashlib.sha256(stable_bytes).hexdigest()
            updated_hash = hashlib.sha256(updated_bytes).hexdigest()
            stable_version_id = f"sha256:{stable_hash}"
            updated_version_id = f"sha256:{updated_hash}"
            stable_key = f"pdf/student-handbook-master/undated/sha256/{stable_hash}/student-handbook.pdf"
            updated_key = f"pdf/student-handbook-master/undated/sha256/{updated_hash}/student-handbook.pdf"
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(_student_handbook_manifest_payload(), ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()
            object_store.objects[("campus-rag-raw", stable_key)] = stable_bytes
            object_store.objects[("campus-rag-raw", updated_key)] = updated_bytes
            registry = FileDocumentRegistry(root / "registry" / "student_handbook_documents.json")
            raw_asset_registry = FileRawAssetRegistry(root / "registry" / "student_handbook_raw_assets.json")
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-master-pdf",
                    raw_version_id=stable_version_id,
                    raw_source_uri="s3://campus-rag-raw/pdf/student-handbook-master/student-handbook.pdf",
                    content_hash=stable_hash,
                    source_filename="student-handbook.pdf",
                    object_key=stable_key,
                )
            )
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-master-pdf",
                    raw_version_id=updated_version_id,
                    raw_source_uri="s3://campus-rag-raw/pdf/student-handbook-master/student-handbook.pdf",
                    content_hash=updated_hash,
                    source_filename="student-handbook.pdf",
                    object_key=updated_key,
                )
            )

            first = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:student-handbook-master-pdf",
                    "RAW_VERSION_ID": stable_version_id,
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
                online_ocr=_FixtureOnlineOcrClient("provider-result-stable.jsonl"),
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )
            second = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:student-handbook-master-pdf",
                    "RAW_VERSION_ID": updated_version_id,
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
                online_ocr=_FixtureOnlineOcrClient("provider-result-updated.jsonl"),
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            document_id = build_handbook_doc_id("中央民族大学奖学金评定办法")
            self.assertEqual(first.created_document_ids, (document_id,))
            self.assertEqual(second.success_count, 1)
            self.assertEqual(second.created_document_ids, ())
            self.assertEqual(second.updated_document_ids, (document_id,))
            self.assertEqual(second.skipped_document_ids, ())
            self.assertEqual(second.document_ids, (document_id,))

            registry_payload = json.loads(
                (root / "registry" / "student_handbook_documents.json").read_text(encoding="utf-8")
            )
            versions = [
                payload["version_id"]
                for payload in registry_payload.values()
                if payload["document_id"] == document_id
            ]
            self.assertEqual(len(versions), 2)
            self.assertEqual(len(set(versions)), 2)

            report_payload = json.loads(Path(second.report_path).read_text(encoding="utf-8"))
            self.assertEqual(report_payload["created_document_ids"], [])
            self.assertEqual(report_payload["updated_document_ids"], [document_id])
            self.assertEqual(report_payload["skipped_document_ids"], [])

    def test_provider_only_reuses_registered_raw_asset_but_rewrites_provider_result(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 volatile"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"pdf/volatile/undated/sha256/{raw_hash}/volatile.pdf"
            provider_key = build_processed_asset_artifact_key(
                corpus="regulations",
                raw_asset_id="asset:volatile-pdf",
                raw_version_id=raw_version_id,
                filename="provider-response.jsonl",
            )
            object_store = _FakeObjectStore()
            object_store.objects[("campus-rag-raw", raw_key)] = raw_bytes
            online_ocr = _VolatileFakeOnlineOcrClient()
            env = {
                "RAW_ASSET_ID": "asset:volatile-pdf",
                "RAW_VERSION_ID": raw_version_id,
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
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:volatile-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-raw/pdf/volatile/volatile.pdf",
                    content_hash=raw_hash,
                    source_filename="volatile.pdf",
                    object_key=raw_key,
                )
            )

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
            self.assertEqual(second.success_count, 1)
            self.assertEqual(second.skipped_count, 0)
            self.assertEqual(second.raw_uploaded_count, 0)
            self.assertEqual(second.raw_reused_count, 1)
            self.assertEqual(len(object_store.uploads), 2)
            self.assertEqual(object_store.uploads[-1]["key"], provider_key)

    def test_provider_only_rejects_split_manifest(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 remote student handbook"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"pdf/student-handbook/undated/sha256/{raw_hash}/student-handbook.pdf"
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "student_handbook_split_manifest_v1",
                        "corpus": "regulations",
                        "collection": "student_handbook",
                        "raw_asset_id": "asset:student-handbook-pdf",
                        "documents": [],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()
            object_store.objects[("campus-rag-raw", raw_key)] = raw_bytes
            raw_asset_registry = FileRawAssetRegistry(root / "registry" / "student_handbook_raw_assets.json")
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-raw/pdf/student-handbook/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                )
            )

            with self.assertRaisesRegex(ValueError, "provider_only does not support split manifest ingestion"):
                process_raw_ingestion_job(
                    env={
                        "RAW_ASSET_ID": "asset:student-handbook-pdf",
                        "RAW_VERSION_ID": raw_version_id,
                        "RAW_INGESTION_ARTIFACT_MODE": "provider_only",
                        "INGESTION_SPLIT_MANIFEST_PATH": str(split_manifest_path),
                        "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                        "OCR_API_KEY": "token",
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                    },
                    object_store=object_store,
                    online_ocr=_FakeOnlineOcrClient(),
                    registry=FileDocumentRegistry(root / "registry" / "student_handbook_documents.json"),
                    raw_asset_registry=raw_asset_registry,
                )

    def test_process_raw_ingestion_job_supports_curriculum_plan_split_manifest(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 curriculum plan"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"pdf/curriculum-plan-master/undated/sha256/{raw_hash}/curriculum-plan.pdf"
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_payload = {
                "manifest_version": "curriculum_plan_split_manifest_v1",
                "corpus": "curriculum",
                "collection": "curriculum_plan",
                "raw_asset_id": "asset:curriculum-plan-master-pdf",
                "documents": [
                    {
                        "document_id": "curriculum:plan-001",
                        "title": "Plan 001",
                        "page_start": 1,
                        "page_end": 1,
                    },
                    {
                        "document_id": "curriculum:plan-002",
                        "title": "Plan 002",
                        "page_start": 2,
                        "page_end": 2,
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
            object_store.objects[("campus-rag-raw", raw_key)] = raw_bytes
            online_ocr = _CurriculumPlanFakeOnlineOcrClient()
            registry = FileDocumentRegistry(root / "registry" / "curriculum_plan_documents.json")
            raw_asset_registry = FileRawAssetRegistry(root / "registry" / "curriculum_plan_raw_assets.json")
            raw_asset_registry.upsert(
                _curriculum_raw_asset_record(
                    raw_asset_id="asset:curriculum-plan-master-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-raw/pdf/curriculum-plan-master/curriculum-plan.pdf",
                    content_hash=raw_hash,
                    source_filename="curriculum-plan.pdf",
                    object_key=raw_key,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:curriculum-plan-master-pdf",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "curriculum",
                    "INGESTION_COLLECTION": "curriculum_plan",
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
            source_uri_1 = self._build_curriculum_source_locator(raw_hash=raw_hash, page_start=1, page_end=1)
            source_uri_2 = self._build_curriculum_source_locator(raw_hash=raw_hash, page_start=2, page_end=2)
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
            self.assertEqual(report.raw_uploaded_count, 0)
            self.assertEqual(report.raw_reused_count, 0)
            self.assertEqual(report.document_ids, ("curriculum:plan-001", "curriculum:plan-002"))
            self.assertEqual(len(online_ocr.calls), 1)
            self.assertEqual(online_ocr.calls[0].name, "curriculum-plan.pdf")
            self.assertEqual(
                [upload["key"] for upload in object_store.uploads],
                [
                    build_processed_asset_artifact_key(
                        corpus="curriculum",
                        raw_asset_id="asset:curriculum-plan-master-pdf",
                        raw_version_id=raw_version_id,
                        filename="provider-response.jsonl",
                    ),
                    build_processed_asset_artifact_key(
                        corpus="curriculum",
                        raw_asset_id="asset:curriculum-plan-master-pdf",
                        raw_version_id=raw_version_id,
                        filename="layout-elements.jsonl",
                    ),
                    build_processed_artifact_key(
                        corpus="curriculum",
                        collection="curriculum_plan",
                        document_id="curriculum:plan-001",
                        revision_track="source-faithful",
                        version_id=f"sha256:{raw_hash}:split:plan-001:{digest_1}",
                        title="Plan 001",
                        year=None,
                        filename="document-units.jsonl",
                    ),
                    build_processed_artifact_key(
                        corpus="curriculum",
                        collection="curriculum_plan",
                        document_id="curriculum:plan-002",
                        revision_track="source-faithful",
                        version_id=f"sha256:{raw_hash}:split:plan-002:{digest_2}",
                        title="Plan 002",
                        year=None,
                        filename="document-units.jsonl",
                    ),
                ],
            )

            registry_payload = json.loads(
                (root / "registry" / "curriculum_plan_documents.json").read_text(encoding="utf-8")
            )
            plan_001 = registry_payload[
                f"curriculum:plan-001::source-faithful::sha256:{raw_hash}:split:plan-001:{digest_1}"
            ]
            plan_002 = registry_payload[
                f"curriculum:plan-002::source-faithful::sha256:{raw_hash}:split:plan-002:{digest_2}"
            ]
            self.assertEqual(
                plan_001["provider_response_object_key"],
                build_processed_asset_artifact_key(
                    corpus="curriculum",
                    raw_asset_id="asset:curriculum-plan-master-pdf",
                    raw_version_id=raw_version_id,
                    filename="provider-response.jsonl",
                ),
            )
            self.assertEqual(
                plan_002["processed_object_keys"],
                [
                    build_processed_asset_artifact_key(
                        corpus="curriculum",
                        raw_asset_id="asset:curriculum-plan-master-pdf",
                        raw_version_id=raw_version_id,
                        filename="provider-response.jsonl",
                    ),
                    build_processed_artifact_key(
                        corpus="curriculum",
                        collection="curriculum_plan",
                        document_id="curriculum:plan-002",
                        revision_track="source-faithful",
                        version_id=f"sha256:{raw_hash}:split:plan-002:{digest_2}",
                        title="Plan 002",
                        year=None,
                        filename="document-units.jsonl",
                    ),
                    build_processed_asset_artifact_key(
                        corpus="curriculum",
                        raw_asset_id="asset:curriculum-plan-master-pdf",
                        raw_version_id=raw_version_id,
                        filename="layout-elements.jsonl",
                    ),
                ],
            )
            self.assertEqual(plan_001["cleaning_policy_version"], "curriculum_plan_cleaning_v1")
            self.assertEqual(plan_002["cleaning_policy_version"], "curriculum_plan_cleaning_v1")
            self.assertEqual(plan_002["campus_scope"], "main")
            self.assertEqual(plan_002["acl_groups"], ["students"])
            self.assertEqual(plan_001["revision_track"], "source-faithful")
            self.assertEqual(plan_001["source_channel"], "pdf_ocr")
            self.assertEqual(plan_001["source_uri"], source_uri_1)
            self.assertEqual(plan_002["source_uri"], source_uri_2)

    def test_process_raw_ingestion_job_supports_curriculum_plan_provider_only_presplit(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 curriculum plan"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"pdf/curriculum-plan/undated/sha256/{raw_hash}/curriculum-plan.pdf"
            object_store = _FakeObjectStore()
            object_store.objects[("campus-rag-raw", raw_key)] = raw_bytes
            online_ocr = _CurriculumPlanFakeOnlineOcrClient()
            registry = FileDocumentRegistry(root / "registry" / "curriculum_plan_documents.json")
            raw_asset_registry = FileRawAssetRegistry(root / "registry" / "curriculum_plan_raw_assets.json")
            raw_asset_registry.upsert(
                _curriculum_raw_asset_record(
                    raw_asset_id="asset:curriculum-plan-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-raw/pdf/curriculum-plan/curriculum-plan.pdf",
                    content_hash=raw_hash,
                    source_filename="curriculum-plan.pdf",
                    object_key=raw_key,
                )
            )

            report = process_raw_ingestion_job(
                env={
                    "RAW_ASSET_ID": "asset:curriculum-plan-pdf",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "curriculum",
                    "INGESTION_COLLECTION": "curriculum_plan",
                    "RAW_INGESTION_ARTIFACT_MODE": "provider_only",
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                },
                object_store=object_store,
                online_ocr=online_ocr,
                registry=registry,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(report.success_count, 1)
            self.assertEqual(report.failed_count, 0)
            self.assertEqual(report.raw_uploaded_count, 0)
            self.assertEqual(report.raw_reused_count, 1)
            self.assertEqual(report.document_ids, ())
            self.assertEqual(len(online_ocr.calls), 1)
            self.assertEqual(online_ocr.calls[0].name, "curriculum-plan.pdf")
            self.assertEqual(
                [upload["key"] for upload in object_store.uploads],
                [
                    build_processed_asset_artifact_key(
                        corpus="curriculum",
                        raw_asset_id="asset:curriculum-plan-pdf",
                        raw_version_id=raw_version_id,
                        filename="provider-response.jsonl",
                    ),
                ],
            )
            self.assertFalse((root / "registry" / "curriculum_plan_documents.json").exists())

            raw_asset_payload = json.loads(
                (root / "registry" / "curriculum_plan_raw_assets.json").read_text(encoding="utf-8")
            )
            self.assertEqual(len(raw_asset_payload), 1)

    def test_process_raw_ingestion_job_provider_only_uses_dedicated_raw_asset_registry_env(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 curriculum plan"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"pdf/curriculum-plan/undated/sha256/{raw_hash}/curriculum-plan.pdf"
            object_store = _FakeObjectStore()
            object_store.objects[("campus-rag-raw", raw_key)] = raw_bytes

            with patch(
                "campus_ingestion_core.raw_ingestion.build_raw_asset_registry_from_env"
            ) as build_registry:
                raw_asset_registry = FileRawAssetRegistry(root / "registry" / "curriculum_plan_raw_assets.json")
                build_registry.return_value = raw_asset_registry
                raw_asset_registry.upsert(
                    _curriculum_raw_asset_record(
                        raw_asset_id="asset:curriculum-plan-pdf",
                        raw_version_id=raw_version_id,
                        raw_source_uri="s3://campus-rag-raw/pdf/curriculum-plan/curriculum-plan.pdf",
                        content_hash=raw_hash,
                        source_filename="curriculum-plan.pdf",
                        object_key=raw_key,
                    )
                )

                process_raw_ingestion_job(
                    env={
                        "RAW_ASSET_ID": "asset:curriculum-plan-pdf",
                        "RAW_VERSION_ID": raw_version_id,
                        "INGESTION_CORPUS": "curriculum",
                        "INGESTION_COLLECTION": "curriculum_plan",
                        "RAW_INGESTION_ARTIFACT_MODE": "provider_only",
                        "RAW_ASSET_REGISTRY_DATABASE_URL": "postgresql://raw-registry.example/postgres",
                        "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                        "OCR_API_KEY": "token",
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                    },
                    object_store=object_store,
                    online_ocr=_FakeOnlineOcrClient(),
                )

            build_registry.assert_called_once_with(
                {
                    "RAW_ASSET_ID": "asset:curriculum-plan-pdf",
                    "RAW_VERSION_ID": raw_version_id,
                    "INGESTION_CORPUS": "curriculum",
                    "INGESTION_COLLECTION": "curriculum_plan",
                    "RAW_INGESTION_ARTIFACT_MODE": "provider_only",
                    "RAW_ASSET_REGISTRY_DATABASE_URL": "postgresql://raw-registry.example/postgres",
                    "OCR_BASE_URL": "https://paddleocr.example/api/v2/ocr/jobs",
                    "OCR_API_KEY": "token",
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                }
            )

    def test_process_raw_ingestion_job_rejects_split_manifest_with_mismatched_corpus(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_bytes = b"%PDF-1.4 curriculum plan"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"pdf/curriculum-plan-master/undated/sha256/{raw_hash}/curriculum-plan.pdf"
            split_manifest_path = root / "configs" / "split-manifest.v1.json"
            split_manifest_path.parent.mkdir(parents=True)
            split_manifest_path.write_text(
                json.dumps(
                    {
                        "manifest_version": "curriculum_plan_split_manifest_v1",
                        "corpus": "curriculum",
                        "collection": "curriculum_plan",
                        "raw_asset_id": "asset:curriculum-plan-master-pdf",
                        "documents": [
                            {
                                "document_id": "curriculum:plan-001",
                                "title": "Plan 001",
                                "page_start": 1,
                                "page_end": 1,
                            },
                        ],
                    },
                    ensure_ascii=False,
                    indent=2,
                ),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()
            object_store.objects[("campus-rag-raw", raw_key)] = raw_bytes
            online_ocr = _CurriculumPlanFakeOnlineOcrClient()
            registry = FileDocumentRegistry(root / "registry" / "curriculum_plan_documents.json")
            raw_asset_registry = FileRawAssetRegistry(root / "registry" / "curriculum_plan_raw_assets.json")
            raw_asset_registry.upsert(
                RawAssetRecord(
                    raw_asset_id="asset:curriculum-plan-master-pdf",
                    raw_version_id=raw_version_id,
                    corpus="regulations",
                    collection="student_handbook",
                    raw_source_uri="s3://campus-rag-raw/pdf/curriculum-plan-master/curriculum-plan.pdf",
                    content_hash=raw_hash,
                    source_filename="curriculum-plan.pdf",
                    object_key=raw_key,
                    ingestion_timestamp="2026-03-23T00:00:00+00:00",
                    import_source="seed",
                )
            )

            with self.assertRaisesRegex(ValueError, "split manifest corpus mismatch"):
                process_raw_ingestion_job(
                    env={
                        "RAW_ASSET_ID": "asset:curriculum-plan-master-pdf",
                        "RAW_VERSION_ID": raw_version_id,
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
            raw_bytes = b"%PDF-1.4 remote student handbook"
            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_version_id = f"sha256:{raw_hash}"
            raw_key = f"pdf/student-handbook/undated/sha256/{raw_hash}/student-handbook.pdf"
            object_store = _FakeObjectStore()
            object_store.objects[("campus-rag-raw", raw_key)] = raw_bytes
            raw_asset_registry = FileRawAssetRegistry(root / "registry" / "student_handbook_raw_assets.json")
            raw_asset_registry.upsert(
                _handbook_raw_asset_record(
                    raw_asset_id="asset:student-handbook-pdf",
                    raw_version_id=raw_version_id,
                    raw_source_uri="s3://campus-rag-raw/pdf/student-handbook/student-handbook.pdf",
                    content_hash=raw_hash,
                    source_filename="student-handbook.pdf",
                    object_key=raw_key,
                )
            )

            with self.assertRaisesRegex(ValueError, "OCR_BASE_URL and OCR_API_KEY"):
                process_raw_ingestion_job(
                    env={
                        "RAW_ASSET_ID": "asset:student-handbook-pdf",
                        "RAW_VERSION_ID": raw_version_id,
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                        "IMPORT_REPORT_DIR": str(root / "reports"),
                        "INGESTION_EMBEDDING_MODEL": "text-embedding-3-large",
                    },
                    object_store=object_store,
                    registry=FileDocumentRegistry(root / "registry" / "student_handbook_documents.json"),
                    raw_asset_registry=raw_asset_registry,
                )


if __name__ == "__main__":
    unittest.main()
