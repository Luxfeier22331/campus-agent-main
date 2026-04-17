from __future__ import annotations

import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from campus_ingestion_worker.register_raw_asset import build_parser
from campus_ingestion_worker.register_raw_asset import register_raw_asset as _register_raw_asset
from tests.support.in_memory_registry import InMemoryRawAssetRegistry


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


def register_raw_asset(**kwargs):
    env = kwargs.get("env") or {}
    return _register_raw_asset(
        corpus=kwargs.pop("corpus", (env.get("INGESTION_CORPUS") or "").strip()),
        collection=kwargs.pop("collection", (env.get("INGESTION_COLLECTION") or "").strip()),
        **kwargs,
    )


class RegisterRawAssetTest(unittest.TestCase):
    def test_build_parser_accepts_file_path_and_legacy_pdf_path(self) -> None:
        parser = build_parser()

        file_args = parser.parse_args(
            [
                "--file-path",
                "student-handbook.pdf",
                "--raw-source-uri",
                "https://campus.example/student-handbook.pdf",
                "--corpus",
                "regulations",
                "--collection",
                "student_handbook",
            ]
        )
        legacy_args = parser.parse_args(
            [
                "--pdf-path",
                "student-handbook.pdf",
                "--raw-source-uri",
                "https://campus.example/student-handbook.pdf",
                "--corpus",
                "regulations",
                "--collection",
                "student_handbook",
            ]
        )

        self.assertEqual(file_args.file_path, "student-handbook.pdf")
        self.assertEqual(legacy_args.file_path, "student-handbook.pdf")

    def test_register_raw_asset_uses_filename_derived_identity_and_reuses_existing_record(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            pdf_path = root / "student-handbook.pdf"
            pdf_bytes = b"%PDF-1.4 handbook source"
            pdf_path.write_bytes(pdf_bytes)

            raw_asset_registry = InMemoryRawAssetRegistry(backing_path=root / "registry" / "raw_assets.json")
            object_store = _FakeObjectStore()
            env = {
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "INGESTION_CORPUS": "regulations",
                "INGESTION_COLLECTION": "student_handbook",
            }

            first = register_raw_asset(
                pdf_path=pdf_path,
                raw_source_uri="https://campus.example/student-handbook.pdf",
                corpus="regulations",
                collection="student_handbook",
                env=env,
                object_store=object_store,
                raw_asset_registry=raw_asset_registry,
            )
            second = register_raw_asset(
                pdf_path=pdf_path,
                raw_source_uri="https://campus.example/student-handbook.pdf",
                corpus="regulations",
                collection="student_handbook",
                env=env,
                object_store=object_store,
                raw_asset_registry=raw_asset_registry,
            )

            raw_hash = hashlib.sha256(pdf_bytes).hexdigest()
            self.assertEqual(first.raw_asset_id, "asset:student-handbook-pdf")
            self.assertEqual(first.raw_version_id, f"sha256:{raw_hash}")
            self.assertEqual(second.raw_asset_id, first.raw_asset_id)
            self.assertEqual(second.raw_version_id, first.raw_version_id)
            self.assertTrue(first.uploaded)
            self.assertFalse(second.uploaded)
            self.assertEqual(len(object_store.uploads), 1)
            self.assertEqual(
                object_store.uploads[0]["key"],
                f"official_pdf/student-handbook/undated/sha256/{raw_hash}/capture/student-handbook.pdf",
            )

            registry_payload = json.loads((root / "registry" / "raw_assets.json").read_text(encoding="utf-8"))
            self.assertEqual(len(registry_payload), 1)
            stored = next(iter(registry_payload.values()))
            self.assertEqual(stored["raw_asset_id"], "asset:student-handbook-pdf")
            self.assertEqual(stored["raw_version_id"], f"sha256:{raw_hash}")
            self.assertEqual(stored["source_filename"], "student-handbook.pdf")

    def test_register_raw_asset_keeps_filename_identity_but_advances_version_for_changed_bytes(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            pdf_path = root / "student-handbook.pdf"
            raw_asset_registry = InMemoryRawAssetRegistry(backing_path=root / "registry" / "raw_assets.json")
            object_store = _FakeObjectStore()
            env = {
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "INGESTION_CORPUS": "regulations",
                "INGESTION_COLLECTION": "student_handbook",
            }

            first_bytes = b"%PDF-1.4 handbook source v1"
            second_bytes = b"%PDF-1.4 handbook source v2"
            pdf_path.write_bytes(first_bytes)
            first = register_raw_asset(
                pdf_path=pdf_path,
                raw_source_uri="https://campus.example/student-handbook.pdf",
                corpus="regulations",
                collection="student_handbook",
                env=env,
                object_store=object_store,
                raw_asset_registry=raw_asset_registry,
            )

            pdf_path.write_bytes(second_bytes)
            second = register_raw_asset(
                pdf_path=pdf_path,
                raw_source_uri="https://campus.example/student-handbook.pdf",
                corpus="regulations",
                collection="student_handbook",
                env=env,
                object_store=object_store,
                raw_asset_registry=raw_asset_registry,
            )

            self.assertEqual(first.raw_asset_id, "asset:student-handbook-pdf")
            self.assertEqual(second.raw_asset_id, "asset:student-handbook-pdf")
            self.assertNotEqual(first.raw_version_id, second.raw_version_id)
            self.assertEqual(len(object_store.uploads), 2)

            registry_payload = json.loads((root / "registry" / "raw_assets.json").read_text(encoding="utf-8"))
            self.assertEqual(len(registry_payload), 2)
            self.assertEqual(
                {payload["raw_asset_id"] for payload in registry_payload.values()},
                {"asset:student-handbook-pdf"},
            )


if __name__ == "__main__":
    unittest.main()
