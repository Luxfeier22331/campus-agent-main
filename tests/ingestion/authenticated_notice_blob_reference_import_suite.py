from __future__ import annotations

import unittest

from .authenticated_notice_import_test_support import *


class AuthenticatedNoticeBlobReferenceImportTest(unittest.TestCase):
    def test_import_authenticated_notice_export_requires_attachment_blob_root_for_blob_store_reference_batches(
        self,
    ) -> None:
        attachment_bytes = b"fake-inline-image-bytes-for-routing"
        bundle = _sample_inline_image_notice_bundle(attachment_bytes=attachment_bytes)

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            _write_json(bundle_path, bundle)
            _write_json(manifest_path, _sample_normalized_blob_store_manifest())

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

            with self.assertRaisesRegex(
                ValueError,
                "attachment_blob_root",
            ):
                import_authenticated_notice_export(
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
                    source_truth_inventory_store=inventory_store,
                )

    def test_import_authenticated_notice_export_allows_blob_store_reference_manifest_for_body_only_batches(
        self,
    ) -> None:
        bundle = _sample_notice_bundle()
        bundle[0]["links"] = []
        bundle[0]["notice_attachments"] = []
        bundle[0]["attachments"] = []

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            _write_json(bundle_path, bundle)
            _write_json(manifest_path, _sample_normalized_blob_store_manifest())

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
                    mode="admit_and_materialize",
                ),
                env=env,
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                source_truth_inventory_store=inventory_store,
            )

        self.assertEqual(report["errors"], [])
        self.assertNotIn("attachment_object_backfill", report)
        entries = inventory_store.list_by_scope("campus_notices", "internal_notice")
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].attachment_document_count, 0)


if __name__ == "__main__":
    unittest.main()
