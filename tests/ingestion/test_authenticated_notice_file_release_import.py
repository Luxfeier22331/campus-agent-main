from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from types import SimpleNamespace
from unittest.mock import patch

from campus_ingestion_core.authenticated_notice_file_release_import import (
    AuthenticatedNoticeFileReleaseImportRequest,
    import_authenticated_notice_file_release_export,
)
from campus_ingestion_core.authenticated_notice_file_release_inventory import (
    InMemoryAuthenticatedNoticeFileReleaseInventoryStore,
)

from tests.ingestion.authenticated_notice_import_test_support import _FakeObjectStore
from tests.ingestion.test_authenticated_notice_file_release_owner_recovery import (
    _bundle_record,
    _export_manifest,
)
from tests.support.in_memory_registry import (
    InMemoryDocumentRegistry,
    InMemoryRawAssetRegistry,
)


def _write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


class AuthenticatedNoticeFileReleaseImportTest(unittest.TestCase):
    def test_request_rejects_non_file_release_holding_scope(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "authenticated notice file-release imports must target authenticated_documents/file_release_source",
        ):
            AuthenticatedNoticeFileReleaseImportRequest(
                bundle_path=Path("/tmp/file-releases-bundle.json"),
                manifest_path=Path("/tmp/file-releases-manifest.json"),
                site_id="muc_internal_portal",
                source_home_url="https://portal.example.edu/",
                corpus="campus_notices",
                collection="internal_notice",
            )

    def test_import_materializes_file_release_into_authenticated_documents_holding_scope(
        self,
    ) -> None:
        bundle = (
            _bundle_record(
                file_release_id=646,
                filename="中央民族大学差旅费管理办法.pdf",
            ),
        )
        manifest = _export_manifest()

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "file-releases-bundle.json"
            manifest_path = root / "file-releases-manifest.json"
            _write_json(bundle_path, list(bundle))
            _write_json(manifest_path, manifest)

            object_store = _FakeObjectStore()
            document_registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "raw-assets.json"
            )
            inventory_store = InMemoryAuthenticatedNoticeFileReleaseInventoryStore()
            env = {
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
            }

            report = import_authenticated_notice_file_release_export(
                request=AuthenticatedNoticeFileReleaseImportRequest(
                    bundle_path=bundle_path,
                    manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/",
                    mode="admit_and_materialize",
                ),
                env=env,
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                inventory_store=inventory_store,
            )

        self.assertEqual(report["errors"], [])
        self.assertEqual(report["file_release_count"], 1)
        self.assertEqual(
            report["created_document_ids"],
            ["file-release:muc_internal_portal:646"],
        )
        raw_records = raw_asset_registry.list_by_scope(
            "authenticated_documents", "file_release_source"
        )
        self.assertEqual(len(raw_records), 1)
        self.assertEqual(raw_records[0].object_key, bundle[0]["released_file"]["object_key"])
        entries = inventory_store.list_by_scope("authenticated_documents", "file_release_source")
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].file_release_id, 646)
        self.assertEqual(entries[0].record["file_release"]["source_surface"], "file_release")
        uploaded_keys = {upload["key"] for upload in object_store.uploads}
        self.assertTrue(
            any(key.endswith("/source-truth/file-release-manifest.json") for key in uploaded_keys)
        )

    def test_import_plan_auto_detects_full_scope_replace_from_manifest(self) -> None:
        bundle = (
            _bundle_record(
                file_release_id=646,
                filename="中央民族大学差旅费管理办法.pdf",
            ),
        )
        manifest = _export_manifest()
        manifest["filters"]["target_file_release_id"] = None

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "file-releases-bundle.json"
            manifest_path = root / "file-releases-manifest.json"
            _write_json(bundle_path, list(bundle))
            _write_json(manifest_path, manifest)

            report = import_authenticated_notice_file_release_export(
                request=AuthenticatedNoticeFileReleaseImportRequest(
                    bundle_path=bundle_path,
                    manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/",
                    mode="plan",
                )
            )

        self.assertTrue(report["replace_scope"])
        self.assertEqual(report["scope_write_mode"], "replace_scope")
        self.assertEqual(report["selected_file_release_ids"], [])

    def test_import_plan_reports_selected_file_release_ids_for_targeted_manifest(self) -> None:
        bundle = (
            _bundle_record(
                file_release_id=646,
                filename="中央民族大学差旅费管理办法.pdf",
            ),
        )
        manifest = _export_manifest()
        manifest["filters"]["target_file_release_id"] = 646

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "file-releases-bundle.json"
            manifest_path = root / "file-releases-manifest.json"
            _write_json(bundle_path, list(bundle))
            _write_json(manifest_path, manifest)

            report = import_authenticated_notice_file_release_export(
                request=AuthenticatedNoticeFileReleaseImportRequest(
                    bundle_path=bundle_path,
                    manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/",
                    mode="plan",
                )
            )

        self.assertFalse(report["replace_scope"])
        self.assertEqual(report["scope_write_mode"], "upsert_selected")
        self.assertEqual(report["selected_file_release_ids"], [646])

    def test_import_uses_runtime_profile_cleaning_policy_for_holding_scope(self) -> None:
        bundle = (
            _bundle_record(
                file_release_id=646,
                filename="中央民族大学差旅费管理办法.pdf",
            ),
        )
        manifest = _export_manifest()

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "file-releases-bundle.json"
            manifest_path = root / "file-releases-manifest.json"
            _write_json(bundle_path, list(bundle))
            _write_json(manifest_path, manifest)

            object_store = _FakeObjectStore()
            document_registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "raw-assets.json"
            )
            inventory_store = InMemoryAuthenticatedNoticeFileReleaseInventoryStore()
            env = {
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
            }

            with patch(
                "campus_ingestion_core.authenticated_notice_file_release_import.load_runtime_profile",
                create=True,
                return_value=SimpleNamespace(
                    cleaning_policy_version="authenticated_documents_holding_v2"
                ),
            ):
                import_authenticated_notice_file_release_export(
                    request=AuthenticatedNoticeFileReleaseImportRequest(
                        bundle_path=bundle_path,
                        manifest_path=manifest_path,
                        site_id="muc_internal_portal",
                        source_home_url="https://portal.example.edu/",
                        mode="admit_and_materialize",
                    ),
                    env=env,
                    object_store=object_store,
                    document_registry=document_registry,
                    raw_asset_registry=raw_asset_registry,
                    inventory_store=inventory_store,
                )

        records = document_registry.list_by_scope("authenticated_documents", "file_release_source")
        self.assertEqual(len(records), 1)
        self.assertEqual(
            records[0].cleaning_policy_version,
            "authenticated_documents_holding_v2",
        )

    def test_import_rejects_reference_only_file_release_rows_without_source_bytes(self) -> None:
        bundle = (
            _bundle_record(
                file_release_id=646,
                filename="中央民族大学差旅费管理办法.pdf",
                storage_provider="reference_only",
                bucket=None,
                object_key=None,
                sha256=None,
                ingest_status="reference_only",
                provenance_status="reference_only",
            ),
        )
        manifest = _export_manifest()
        manifest["collector"]["file_storage_mode"] = "reference_only"

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "file-releases-bundle.json"
            manifest_path = root / "file-releases-manifest.json"
            _write_json(bundle_path, list(bundle))
            _write_json(manifest_path, manifest)

            with self.assertRaisesRegex(ValueError, "source bytes"):
                import_authenticated_notice_file_release_export(
                    request=AuthenticatedNoticeFileReleaseImportRequest(
                        bundle_path=bundle_path,
                        manifest_path=manifest_path,
                        site_id="muc_internal_portal",
                        source_home_url="https://portal.example.edu/",
                        mode="admit_and_materialize",
                    ),
                    env={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    },
                    object_store=_FakeObjectStore(),
                    document_registry=InMemoryDocumentRegistry(),
                    raw_asset_registry=InMemoryRawAssetRegistry(),
                    inventory_store=InMemoryAuthenticatedNoticeFileReleaseInventoryStore(),
                )


if __name__ == "__main__":
    unittest.main()
