from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.authenticated_notice_file_release_import import (
    AuthenticatedNoticeFileReleaseImportRequest,
    import_authenticated_notice_file_release_export,
)
from campus_ingestion_core.authenticated_notice_import import (
    AuthenticatedNoticeImportRequest,
    import_authenticated_notice_export,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.internal_notice_read_model_memory import (
    InMemoryInternalNoticeReadModelStore,
)
from campus_ingestion_core.notice_consumption_projection_memory import (
    InMemoryNoticeConsumptionProjectionStore,
)

from tests.ingestion.authenticated_notice_import_test_support import (
    _FakeObjectStore,
    _sample_export_manifest,
    _sample_notice_bundle,
    _write_json,
)
from tests.ingestion.test_authenticated_notice_file_release_owner_recovery import (
    _bundle_record,
    _export_manifest,
)
from tests.support.in_memory_registry import (
    InMemoryDocumentRegistry,
    InMemoryRawAssetRegistry,
)


def _json_bytes(payload: object) -> bytes:
    return json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")


class AuthenticatedNoticeObjectRefImportTest(unittest.TestCase):
    def test_notice_import_plan_loads_bundle_and_manifest_from_object_refs(self) -> None:
        object_store = _FakeObjectStore()
        bucket = "campus-rag-source"
        bundle_key = "authenticated_notice/exports/run-1/notices-bundle.json"
        manifest_key = "authenticated_notice/exports/run-1/export-manifest.json"
        object_store.put_bytes(
            bucket=bucket,
            key=bundle_key,
            data=_json_bytes(_sample_notice_bundle()),
            content_type="application/json",
        )
        object_store.put_bytes(
            bucket=bucket,
            key=manifest_key,
            data=_json_bytes(_sample_export_manifest()),
            content_type="application/json",
        )

        report = import_authenticated_notice_export(
            request=AuthenticatedNoticeImportRequest(
                source_bucket=bucket,
                bundle_object_key=bundle_key,
                manifest_object_key=manifest_key,
                site_id="muc_internal_portal",
                source_home_url="https://portal.example.edu/home",
                mode="plan",
            ),
            object_store=object_store,
        )

        self.assertEqual(report["notice_count"], 1)
        self.assertEqual(report["selected_notice_ids"], ["355119"])

    def test_notice_import_rejects_missing_bundle_object_with_reason_code(self) -> None:
        object_store = _FakeObjectStore()
        bucket = "campus-rag-source"
        bundle_key = "authenticated_notice/exports/run-1/notices-bundle.json"
        manifest_key = "authenticated_notice/exports/run-1/export-manifest.json"
        object_store.put_bytes(
            bucket=bucket,
            key=manifest_key,
            data=_json_bytes(_sample_export_manifest()),
            content_type="application/json",
        )

        with self.assertRaisesRegex(ValueError, "missing_bundle_object"):
            import_authenticated_notice_export(
                request=AuthenticatedNoticeImportRequest(
                    source_bucket=bucket,
                    bundle_object_key=bundle_key,
                    manifest_object_key=manifest_key,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                    mode="plan",
                ),
                object_store=object_store,
            )

    def test_notice_import_rejects_missing_manifest_object_with_reason_code(self) -> None:
        object_store = _FakeObjectStore()
        bucket = "campus-rag-source"
        bundle_key = "authenticated_notice/exports/run-1/notices-bundle.json"
        manifest_key = "authenticated_notice/exports/run-1/export-manifest.json"
        object_store.put_bytes(
            bucket=bucket,
            key=bundle_key,
            data=_json_bytes(_sample_notice_bundle()),
            content_type="application/json",
        )

        with self.assertRaisesRegex(ValueError, "missing_manifest_object"):
            import_authenticated_notice_export(
                request=AuthenticatedNoticeImportRequest(
                    source_bucket=bucket,
                    bundle_object_key=bundle_key,
                    manifest_object_key=manifest_key,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                    mode="plan",
                ),
                object_store=object_store,
            )

    def test_notice_import_rejects_bundle_checksum_mismatch_with_reason_code(self) -> None:
        object_store = _FakeObjectStore()
        bucket = "campus-rag-source"
        bundle_key = "authenticated_notice/exports/run-1/notices-bundle.json"
        manifest_key = "authenticated_notice/exports/run-1/export-manifest.json"
        object_store.put_bytes(
            bucket=bucket,
            key=bundle_key,
            data=_json_bytes(_sample_notice_bundle()),
            content_type="application/json",
        )
        object_store.put_bytes(
            bucket=bucket,
            key=manifest_key,
            data=_json_bytes(_sample_export_manifest()),
            content_type="application/json",
        )

        with self.assertRaisesRegex(ValueError, "checksum_mismatch"):
            import_authenticated_notice_export(
                request=AuthenticatedNoticeImportRequest(
                    source_bucket=bucket,
                    bundle_object_key=bundle_key,
                    manifest_object_key=manifest_key,
                    bundle_content_sha256="0" * 64,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                    mode="plan",
                ),
                object_store=object_store,
            )

    def test_notice_import_rejects_manifest_size_mismatch_with_reason_code(self) -> None:
        object_store = _FakeObjectStore()
        bucket = "campus-rag-source"
        bundle_key = "authenticated_notice/exports/run-1/notices-bundle.json"
        manifest_key = "authenticated_notice/exports/run-1/export-manifest.json"
        manifest_bytes = _json_bytes(_sample_export_manifest())
        object_store.put_bytes(
            bucket=bucket,
            key=bundle_key,
            data=_json_bytes(_sample_notice_bundle()),
            content_type="application/json",
        )
        object_store.put_bytes(
            bucket=bucket,
            key=manifest_key,
            data=manifest_bytes,
            content_type="application/json",
        )

        with self.assertRaisesRegex(ValueError, "size_mismatch"):
            import_authenticated_notice_export(
                request=AuthenticatedNoticeImportRequest(
                    source_bucket=bucket,
                    bundle_object_key=bundle_key,
                    manifest_object_key=manifest_key,
                    manifest_byte_size=len(manifest_bytes) + 1,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                    mode="plan",
                ),
                object_store=object_store,
            )

    def test_notice_missing_bundle_object_leaves_injected_stores_unwritten(self) -> None:
        object_store = _FakeObjectStore()
        bucket = "campus-rag-source"
        bundle_key = "authenticated_notice/exports/run-1/notices-bundle.json"
        manifest_key = "authenticated_notice/exports/run-1/export-manifest.json"
        object_store.put_bytes(
            bucket=bucket,
            key=manifest_key,
            data=_json_bytes(_sample_export_manifest()),
            content_type="application/json",
        )
        object_store.uploads.clear()
        document_registry = InMemoryDocumentRegistry()
        raw_asset_registry = InMemoryRawAssetRegistry()
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        projection_store = InMemoryNoticeConsumptionProjectionStore()
        read_model_store = InMemoryInternalNoticeReadModelStore()

        with self.assertRaisesRegex(ValueError, "missing_bundle_object"):
            import_authenticated_notice_export(
                request=AuthenticatedNoticeImportRequest(
                    source_bucket=bucket,
                    bundle_object_key=bundle_key,
                    manifest_object_key=manifest_key,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                    mode="admit_and_materialize",
                ),
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                source_truth_inventory_store=inventory_store,
                consumption_projection_store=projection_store,
                read_model_store=read_model_store,
            )

        self.assertEqual(object_store.uploads, [])
        self.assertEqual(
            document_registry.list_by_scope("campus_notices", "internal_notice"),
            (),
        )
        self.assertEqual(
            raw_asset_registry.list_by_scope("campus_notices", "internal_notice"),
            (),
        )
        self.assertEqual(
            inventory_store.list_by_scope("campus_notices", "internal_notice"),
            (),
        )
        self.assertEqual(
            projection_store.list_by_scope("campus_notices", "internal_notice"),
            (),
        )
        self.assertEqual(
            read_model_store.list_by_scope("campus_notices", "internal_notice"),
            (),
        )

    def test_notice_import_plan_does_not_write_injected_stores(self) -> None:
        object_store = _FakeObjectStore()
        bucket = "campus-rag-source"
        bundle_key = "authenticated_notice/exports/run-1/notices-bundle.json"
        manifest_key = "authenticated_notice/exports/run-1/export-manifest.json"
        object_store.put_bytes(
            bucket=bucket,
            key=bundle_key,
            data=_json_bytes(_sample_notice_bundle()),
            content_type="application/json",
        )
        object_store.put_bytes(
            bucket=bucket,
            key=manifest_key,
            data=_json_bytes(_sample_export_manifest()),
            content_type="application/json",
        )
        object_store.uploads.clear()
        document_registry = InMemoryDocumentRegistry()
        raw_asset_registry = InMemoryRawAssetRegistry()
        inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
        projection_store = InMemoryNoticeConsumptionProjectionStore()
        read_model_store = InMemoryInternalNoticeReadModelStore()

        report = import_authenticated_notice_export(
            request=AuthenticatedNoticeImportRequest(
                source_bucket=bucket,
                bundle_object_key=bundle_key,
                manifest_object_key=manifest_key,
                site_id="muc_internal_portal",
                source_home_url="https://portal.example.edu/home",
                mode="plan",
            ),
            object_store=object_store,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            source_truth_inventory_store=inventory_store,
            consumption_projection_store=projection_store,
            read_model_store=read_model_store,
        )

        self.assertFalse(report["write_enabled"])
        self.assertEqual(object_store.uploads, [])
        self.assertEqual(
            document_registry.list_by_scope("campus_notices", "internal_notice"),
            (),
        )
        self.assertEqual(
            raw_asset_registry.list_by_scope("campus_notices", "internal_notice"),
            (),
        )
        self.assertEqual(
            inventory_store.list_by_scope("campus_notices", "internal_notice"),
            (),
        )
        self.assertEqual(
            projection_store.list_by_scope("campus_notices", "internal_notice"),
            (),
        )
        self.assertEqual(
            read_model_store.list_by_scope("campus_notices", "internal_notice"),
            (),
        )

    def test_notice_request_rejects_bare_local_bundle_without_fixture_guard(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            _write_json(bundle_path, _sample_notice_bundle())
            _write_json(manifest_path, _sample_export_manifest())

            with self.assertRaisesRegex(ValueError, "allow_local_fixture_import"):
                AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                )

    def test_file_release_import_plan_loads_bundle_and_manifest_from_object_refs(self) -> None:
        object_store = _FakeObjectStore()
        bucket = "campus-rag-source"
        bundle_key = "authenticated_notice/file_release_exports/run-1/bundle.json"
        manifest_key = "authenticated_notice/file_release_exports/run-1/manifest.json"
        manifest = _export_manifest()
        manifest["filters"]["target_file_release_id"] = 646
        object_store.put_bytes(
            bucket=bucket,
            key=bundle_key,
            data=_json_bytes(
                [
                    _bundle_record(
                        file_release_id=646,
                        filename="中央民族大学差旅费管理办法.pdf",
                    )
                ]
            ),
            content_type="application/json",
        )
        object_store.put_bytes(
            bucket=bucket,
            key=manifest_key,
            data=_json_bytes(manifest),
            content_type="application/json",
        )

        report = import_authenticated_notice_file_release_export(
            request=AuthenticatedNoticeFileReleaseImportRequest(
                source_bucket=bucket,
                bundle_object_key=bundle_key,
                manifest_object_key=manifest_key,
                site_id="muc_internal_portal",
                source_home_url="https://portal.example.edu/",
                mode="plan",
            ),
            object_store=object_store,
        )

        self.assertEqual(report["file_release_count"], 1)
        self.assertEqual(report["selected_file_release_ids"], [646])

    def test_file_release_request_rejects_bare_local_paths_without_fixture_guard(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "file-releases-bundle.json"
            manifest_path = root / "file-releases-manifest.json"
            _write_json(
                bundle_path,
                [
                    _bundle_record(
                        file_release_id=646,
                        filename="中央民族大学差旅费管理办法.pdf",
                    )
                ],
            )
            _write_json(manifest_path, _export_manifest())

            with self.assertRaisesRegex(ValueError, "allow_local_fixture_import"):
                AuthenticatedNoticeFileReleaseImportRequest(
                    bundle_path=bundle_path,
                    manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/",
                )


if __name__ == "__main__":
    unittest.main()
