from __future__ import annotations

import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from campus_ingestion_worker.import_campusrag_existing_ocr import import_campusrag_existing_ocr


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


class ImportCampusRagExistingOcrTest(unittest.TestCase):
    def test_import_writes_processed_object_and_registry_record(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            ocr_root = root / "ocr" / "by_doc" / "handbook_abc"
            ocr_root.mkdir(parents=True)
            jsonl_path = ocr_root / "v1_abc.jsonl"
            jsonl_path.write_text(
                json.dumps(
                    {
                        "doc_id": "handbook:abc",
                        "version_id": "v1:abc",
                        "chunk_id": "chunk-001",
                        "clean_text": "library hours text",
                        "source_url": None,
                        "source_md": "E:/Code/sideProject/campusRag/rag-data/canonical/student_handbook/docs/library-hours.md",
                        "source": {
                            "id": "E:/Code/sideProject/campusRag/rag-data/canonical/student_handbook/docs/library-hours.md"
                        },
                        "acl": {"level": "public", "allow_groups": []},
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            object_store = _FakeObjectStore()

            report = import_campusrag_existing_ocr(
                env={
                    "CAMPUSRAG_OCR_ROOT": str(root / "ocr"),
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "DOCUMENT_REGISTRY_PATH": str(root / "registry" / "student_handbook.json"),
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_PARSER_VERSION": "campusrag-import-v1",
                    "INGESTION_EMBEDDING_MODEL": "text-embedding-3-large",
                    "DEFAULT_CAMPUS_SCOPE": "",
                },
                object_store=object_store,
            )

            self.assertEqual(report.import_mode, "existing_ocr")
            self.assertEqual(report.success_count, 1)
            self.assertEqual(report.skipped_count, 0)
            self.assertEqual(report.failed_count, 0)
            self.assertEqual(report.raw_uploaded_count, 0)
            self.assertEqual(report.raw_reused_count, 0)
            self.assertEqual(report.unresolved_source_pdfs, ())
            self.assertEqual(report.document_ids, ("handbook:abc",))
            self.assertEqual(len(object_store.uploads), 1)
            self.assertEqual(object_store.uploads[0]["bucket"], "campus-rag-processed")
            self.assertEqual(
                object_store.uploads[0]["key"],
                "student_handbook/handbook:abc/v1:abc/processed/structured.jsonl",
            )

            registry_payload = json.loads(
                (root / "registry" / "student_handbook.json").read_text(encoding="utf-8")
            )
            saved = registry_payload["handbook:abc::v1:abc"]
            self.assertIsNone(saved["raw_object_key"])
            self.assertEqual(
                saved["processed_object_keys"],
                ["student_handbook/handbook:abc/v1:abc/processed/structured.jsonl"],
            )
            self.assertEqual(saved["import_source"], "campusrag_existing_ocr")
            self.assertEqual(saved["source_uri"], "campusrag://canonical/student_handbook/docs/library-hours.md")

    def test_import_with_raw_root_uploads_shared_pdf_once_and_records_provenance(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            raw_root = root / "raw"
            raw_root.mkdir(parents=True)
            raw_bytes = b"%PDF-1.4 student handbook raw"
            raw_path = raw_root / "student-handbook.pdf"
            raw_path.write_bytes(raw_bytes)

            doc_one = root / "ocr" / "by_doc" / "handbook_abc"
            doc_two = root / "ocr" / "by_doc" / "handbook_def"
            doc_one.mkdir(parents=True)
            doc_two.mkdir(parents=True)
            (doc_one / "v1_abc.jsonl").write_text(
                json.dumps(
                    {
                        "doc_id": "handbook:abc",
                        "version_id": "v1:abc",
                        "chunk_id": "chunk-001",
                        "clean_text": "library hours text",
                        "source_pdf": "学生手册.pdf",
                        "page_start": 18,
                        "page_end": 19,
                        "source_md": "/home/reptilian/code/campusRag/rag-data/canonical/student_handbook/docs/library-hours.md",
                        "source": {"id": None},
                        "acl": {"level": "public", "allow_groups": []},
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            (doc_two / "v1_def.jsonl").write_text(
                json.dumps(
                    {
                        "doc_id": "handbook:def",
                        "version_id": "v1:def",
                        "chunk_id": "chunk-001",
                        "clean_text": "student policy text",
                        "source_pdf": "学生手册.pdf",
                        "page_start": 20,
                        "page_end": 24,
                        "source_md": "/home/reptilian/code/campusRag/rag-data/canonical/student_handbook/docs/student-policy.md",
                        "source": {"id": None},
                        "acl": {"level": "authenticated", "allow_groups": ["students"]},
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )

            object_store = _FakeObjectStore()
            report = import_campusrag_existing_ocr(
                env={
                    "CAMPUSRAG_OCR_ROOT": str(root / "ocr"),
                    "CAMPUSRAG_RAW_ROOT": str(raw_root),
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "DOCUMENT_REGISTRY_PATH": str(root / "registry" / "student_handbook.json"),
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_PARSER_VERSION": "campusrag-import-v1",
                    "INGESTION_EMBEDDING_MODEL": "text-embedding-3-large",
                },
                object_store=object_store,
            )

            raw_hash = hashlib.sha256(raw_bytes).hexdigest()
            raw_key = (
                "student_handbook/raw-source:student-handbook-pdf/"
                f"sha256:{raw_hash}/raw/student-handbook.pdf"
            )

            self.assertEqual(report.import_mode, "existing_ocr")
            self.assertEqual(report.success_count, 2)
            self.assertEqual(report.raw_uploaded_count, 1)
            self.assertEqual(report.raw_reused_count, 1)
            self.assertEqual(len(object_store.uploads), 3)
            self.assertEqual(object_store.uploads[0]["bucket"], "campus-rag-raw")
            self.assertEqual(object_store.uploads[0]["key"], raw_key)

            registry_payload = json.loads(
                (root / "registry" / "student_handbook.json").read_text(encoding="utf-8")
            )
            saved_one = registry_payload["handbook:abc::v1:abc"]
            saved_two = registry_payload["handbook:def::v1:def"]
            self.assertEqual(saved_one["raw_object_key"], raw_key)
            self.assertEqual(saved_one["raw_content_hash"], raw_hash)
            self.assertEqual(saved_one["raw_source_filename"], "student-handbook.pdf")
            self.assertEqual(saved_one["raw_page_start"], 18)
            self.assertEqual(saved_one["raw_page_end"], 19)
            self.assertEqual(saved_two["raw_object_key"], raw_key)
            self.assertEqual(saved_two["raw_content_hash"], raw_hash)
            self.assertEqual(saved_two["raw_page_start"], 20)
            self.assertEqual(saved_two["raw_page_end"], 24)

    def test_duplicate_import_is_skipped(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            ocr_root = root / "ocr" / "by_doc" / "handbook_dup"
            ocr_root.mkdir(parents=True)
            jsonl_path = ocr_root / "v1_dup.jsonl"
            payload = json.dumps(
                {
                    "doc_id": "handbook:dup",
                    "version_id": "v1:dup",
                    "chunk_id": "chunk-001",
                    "clean_text": "duplicate text",
                    "source_pdf": "学生手册.pdf",
                    "page_start": 30,
                    "page_end": 31,
                    "source_url": "https://campus.example/dup",
                    "source_md": None,
                    "source": {"id": None},
                    "acl": {"level": "authenticated", "allow_groups": ["students"]},
                },
                ensure_ascii=False,
            )
            jsonl_path.write_text(payload, encoding="utf-8")
            raw_root = root / "raw"
            raw_root.mkdir(parents=True)
            raw_root.joinpath("student-handbook.pdf").write_bytes(b"%PDF-1.4 duplicate")
            env = {
                "CAMPUSRAG_OCR_ROOT": str(root / "ocr"),
                "CAMPUSRAG_RAW_ROOT": str(raw_root),
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "DOCUMENT_REGISTRY_PATH": str(root / "registry" / "student_handbook.json"),
                "IMPORT_REPORT_DIR": str(root / "reports"),
                "INGESTION_PARSER_VERSION": "campusrag-import-v1",
                "INGESTION_EMBEDDING_MODEL": "text-embedding-3-large",
            }
            object_store = _FakeObjectStore()

            first = import_campusrag_existing_ocr(env=env, object_store=object_store)
            second = import_campusrag_existing_ocr(env=env, object_store=object_store)

            self.assertEqual(first.success_count, 1)
            self.assertEqual(second.success_count, 0)
            self.assertEqual(second.skipped_count, 1)
            self.assertEqual(first.raw_uploaded_count, 1)
            self.assertEqual(second.raw_uploaded_count, 0)
            self.assertEqual(second.raw_reused_count, 1)
            self.assertEqual(len(object_store.uploads), 2)

    def test_import_report_is_written_with_counts(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            ocr_root = root / "ocr" / "by_doc" / "handbook_bad"
            ocr_root.mkdir(parents=True)
            (ocr_root / "v1_bad.jsonl").write_text('{"invalid": true}\n', encoding="utf-8")

            report = import_campusrag_existing_ocr(
                env={
                    "CAMPUSRAG_OCR_ROOT": str(root / "ocr"),
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "DOCUMENT_REGISTRY_PATH": str(root / "registry" / "student_handbook.json"),
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_PARSER_VERSION": "campusrag-import-v1",
                    "INGESTION_EMBEDDING_MODEL": "text-embedding-3-large",
                },
                object_store=_FakeObjectStore(),
            )

            self.assertEqual(report.import_mode, "existing_ocr")
            self.assertEqual(report.success_count, 0)
            self.assertEqual(report.failed_count, 1)
            self.assertTrue(report.errors)
            self.assertTrue(Path(report.report_path).exists())

    def test_import_fails_closed_when_raw_root_configured_but_source_pdf_cannot_be_resolved(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            ocr_root = root / "ocr" / "by_doc" / "handbook_missing_raw"
            ocr_root.mkdir(parents=True)
            (ocr_root / "v1_missing_raw.jsonl").write_text(
                json.dumps(
                    {
                        "doc_id": "handbook:missing-raw",
                        "version_id": "v1:missing-raw",
                        "chunk_id": "chunk-001",
                        "clean_text": "missing raw source",
                        "source_pdf": "unknown.pdf",
                        "page_start": 1,
                        "page_end": 2,
                        "source_md": "/home/reptilian/code/campusRag/rag-data/canonical/student_handbook/docs/missing-raw.md",
                        "source": {"id": None},
                        "acl": {"level": "public", "allow_groups": []},
                    },
                    ensure_ascii=False,
                ),
                encoding="utf-8",
            )
            raw_root = root / "raw"
            raw_root.mkdir(parents=True)
            raw_root.joinpath("student-handbook.pdf").write_bytes(b"%PDF-1.4 available but different")
            object_store = _FakeObjectStore()

            report = import_campusrag_existing_ocr(
                env={
                    "CAMPUSRAG_OCR_ROOT": str(root / "ocr"),
                    "CAMPUSRAG_RAW_ROOT": str(raw_root),
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "DOCUMENT_REGISTRY_PATH": str(root / "registry" / "student_handbook.json"),
                    "IMPORT_REPORT_DIR": str(root / "reports"),
                    "INGESTION_PARSER_VERSION": "campusrag-import-v1",
                    "INGESTION_EMBEDDING_MODEL": "text-embedding-3-large",
                },
                object_store=object_store,
            )

            self.assertEqual(report.import_mode, "existing_ocr")
            self.assertEqual(report.success_count, 0)
            self.assertEqual(report.skipped_count, 0)
            self.assertEqual(report.failed_count, 1)
            self.assertEqual(report.raw_uploaded_count, 0)
            self.assertEqual(report.raw_reused_count, 0)
            self.assertEqual(report.unresolved_source_pdfs, ("unknown.pdf",))
            self.assertEqual(object_store.uploads, [])
            self.assertFalse((root / "registry" / "student_handbook.json").exists())


if __name__ == "__main__":
    unittest.main()
