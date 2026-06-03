from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

from tests.ingestion.authenticated_notice_import_export_suite_support import (
    AuthenticatedNoticeImportRequest,
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
    InMemoryDocumentRegistry,
    InMemoryInternalNoticeReadModelStore,
    InMemoryNoticeConsumptionProjectionStore,
    InMemoryRawAssetRegistry,
    _FakeObjectStore,
    _persisted_attachment_record,
    _sample_export_manifest,
    _sample_notice_bundle,
    _write_consumer_manifest,
    _write_json,
    import_authenticated_notice_export,
)


class AuthenticatedNoticeImportExportTestPart03(unittest.TestCase):
    def test_import_authenticated_notice_export_source_truth_only_skips_projection_and_read_model_materialization(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            _write_json(bundle_path, _sample_notice_bundle())
            _write_json(manifest_path, _sample_export_manifest())

            object_store = _FakeObjectStore()
            document_registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "raw-assets.json"
            )
            inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
            projection_store = InMemoryNoticeConsumptionProjectionStore()
            read_model_store = InMemoryInternalNoticeReadModelStore()
            env = {
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
            }

            with (
                patch(
                    "campus_ingestion_core.authenticated_notice_import.rebuild_internal_notice_consumption_projection"
                ) as rebuild_projection,
                patch(
                    "campus_ingestion_core.authenticated_notice_import.rebuild_internal_notice_read_model"
                ) as rebuild_read_model,
            ):
                report = import_authenticated_notice_export(
                    request=AuthenticatedNoticeImportRequest(
                        bundle_path=bundle_path,
                        export_manifest_path=manifest_path,
                        site_id="muc_internal_portal",
                        source_home_url="https://portal.example.edu/home",
                        allow_local_fixture_import=True,
                        mode="admit_and_materialize",
                        source_truth_only=True,
                    ),
                    env=env,
                    object_store=object_store,
                    document_registry=document_registry,
                    raw_asset_registry=raw_asset_registry,
                    source_truth_inventory_store=inventory_store,
                    consumption_projection_store=projection_store,
                    read_model_store=read_model_store,
                )

        self.assertEqual(report["errors"], [])
        self.assertNotIn("consumption_projection_entry_count", report)
        self.assertNotIn("internal_notice_read_model_entry_count", report)
        rebuild_projection.assert_not_called()
        rebuild_read_model.assert_not_called()
        self.assertEqual(
            len(projection_store.list_by_scope("campus_notices", "internal_notice")),
            0,
        )
        self.assertEqual(
            read_model_store.search(
                source_families=("internal_notice_restricted",),
                query_text="证书项目",
                max_results=5,
            ),
            (),
        )

    def test_import_authenticated_notice_export_can_materialize_common_download_holding_scope(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            _write_json(bundle_path, _sample_notice_bundle())
            _write_json(manifest_path, _sample_export_manifest())

            object_store = _FakeObjectStore()
            document_registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "raw-assets.json"
            )
            inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
            env = {
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
            }

            report = import_authenticated_notice_export(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                    allow_local_fixture_import=True,
                    corpus="authenticated_documents",
                    collection="common_download_source",
                    mode="admit_and_materialize",
                    source_truth_only=True,
                ),
                env=env,
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                source_truth_inventory_store=inventory_store,
            )

        self.assertEqual(report["errors"], [])
        self.assertNotIn("consumption_projection_entry_count", report)
        self.assertNotIn("internal_notice_read_model_entry_count", report)
        entries = inventory_store.list_by_scope("authenticated_documents", "common_download_source")
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].notice_id, "355119")
        records = document_registry.list_by_scope(
            "authenticated_documents", "common_download_source"
        )
        self.assertEqual(
            [record.document_id for record in records if record.document_id.startswith("notice:")],
            ["notice:muc_internal_portal:355119"],
        )

    def test_import_authenticated_notice_export_can_rebuild_read_model_for_imported_notices(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            consumer_manifest_path = root / "consumer-admission-manifest.json"
            _write_json(bundle_path, _sample_notice_bundle())
            _write_json(manifest_path, _sample_export_manifest())
            _write_consumer_manifest(
                consumer_manifest_path,
                bundle_records=_sample_notice_bundle(),
                selection_path=str(bundle_path),
            )

            object_store = _FakeObjectStore()
            document_registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "raw-assets.json"
            )
            inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
            projection_store = InMemoryNoticeConsumptionProjectionStore()
            read_model_store = InMemoryInternalNoticeReadModelStore()
            env = {
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
            }

            report = import_authenticated_notice_export(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    consumer_admission_manifest_path=consumer_manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                    allow_local_fixture_import=True,
                    mode="admit_and_materialize",
                ),
                env=env,
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                source_truth_inventory_store=inventory_store,
                consumption_projection_store=projection_store,
                read_model_store=read_model_store,
            )

        self.assertEqual(report["errors"], [])
        self.assertGreaterEqual(report["internal_notice_read_model_entry_count"], 1)
        rows = read_model_store.search(
            source_families=("internal_notice_restricted",),
            query_text="证书项目",
            max_results=5,
        )
        self.assertGreaterEqual(len(rows), 1)
        self.assertEqual(rows[0].source_notice_id, "355119")
        self.assertTrue(rows[0].canonical_markdown_object_key)

    def test_import_authenticated_notice_export_preserves_existing_attachment_scope_records(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            _write_json(bundle_path, _sample_notice_bundle())
            _write_json(manifest_path, _sample_export_manifest())

            object_store = _FakeObjectStore()
            attachment_record = _persisted_attachment_record()
            document_registry = InMemoryDocumentRegistry(
                records=(attachment_record,),
                backing_path=root / "registry" / "documents.json",
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "raw-assets.json"
            )
            env = {
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
            }

            report = import_authenticated_notice_export(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                    allow_local_fixture_import=True,
                    mode="admit_and_materialize",
                ),
                env=env,
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
            )

        self.assertEqual(report["errors"], [])
        document_ids = {
            record.document_id
            for record in document_registry.list_by_scope("campus_notices", "internal_notice")
        }
        self.assertEqual(
            document_ids,
            {
                "notice:muc_internal_portal:355119",
                "notice_attachment:muc_internal_portal:355119:attachment-0001",
            },
        )
