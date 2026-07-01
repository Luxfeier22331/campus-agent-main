from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from tests.ingestion.authenticated_notice_import_export_suite_support import (
    AuthenticatedNoticeImportRequest,
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
    InMemoryDocumentRegistry,
    InMemoryRawAssetRegistry,
    _FakeObjectStore,
    _sample_export_manifest,
    _sample_inline_image_notice_bundle,
    _write_json,
    build_authenticated_notice_attachment_capture_key,
    hashlib,
    import_authenticated_notice_export,
)


class AuthenticatedNoticeImportExportTestPart04(unittest.TestCase):
    def test_import_authenticated_notice_export_with_attachment_blob_root_materializes_attachment_objects_for_inventory_routing(
        self,
    ) -> None:
        attachment_bytes = b"fake-inline-image-bytes-for-routing"
        bundle = _sample_inline_image_notice_bundle(attachment_bytes=attachment_bytes)
        attachment_sha256 = hashlib.sha256(attachment_bytes).hexdigest()
        expected_attachment_key = build_authenticated_notice_attachment_capture_key(
            content_sha256=attachment_sha256,
            filename="schedule.png",
            year="2026",
        )

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            blob_root = root / "blob-store"
            blob_path = blob_root / f"{attachment_sha256[:2]}/{attachment_sha256}/schedule.png"
            blob_path.parent.mkdir(parents=True, exist_ok=True)
            blob_path.write_bytes(attachment_bytes)
            _write_json(bundle_path, bundle)
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
                    site_id="example_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                    allow_local_fixture_import=True,
                    mode="admit_and_materialize",
                    attachment_blob_root=blob_root,
                ),
                env=env,
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                source_truth_inventory_store=inventory_store,
            )

        self.assertEqual(report["errors"], [])
        self.assertIn("attachment_object_backfill", report)
        self.assertEqual(report["attachment_object_backfill"]["uploaded_count"], 1)
        self.assertIn(
            expected_attachment_key, report["attachment_object_backfill"]["uploaded_object_keys"]
        )
        uploaded_keys = {entry["key"] for entry in object_store.uploads}
        self.assertIn(expected_attachment_key, uploaded_keys)

        entries = inventory_store.list_by_scope("campus_notices", "internal_notice")
        self.assertEqual(len(entries), 1)
        entry = entries[0]
        self.assertEqual(entry.notice_risk_label, "body_with_spatial_attachments")
        self.assertEqual(entry.multimodal_processing_required_count, 1)
        self.assertEqual(entry.ocr_required_count, 0)
        self.assertTrue(entry.has_spatial_attachment)
