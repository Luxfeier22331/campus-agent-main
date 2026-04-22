from __future__ import annotations

import unittest

from .authenticated_notice_import_test_support import *  # noqa: F401,F403


class AuthenticatedNoticeImportExportTest(unittest.TestCase):
    def test_import_authenticated_notice_export_replaces_source_truth_inventory_scope(self) -> None:
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
                ),
                env=env,
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                source_truth_inventory_store=inventory_store,
            )

        self.assertEqual(report["errors"], [])
        entries = inventory_store.list_by_scope("campus_notices", "internal_notice")
        self.assertEqual(len(entries), 1)
        entry = entries[0]
        self.assertEqual(entry.notice_id, "355119")
        self.assertEqual(entry.site_id, "muc_internal_portal")
        self.assertEqual(entry.document_id, "notice:muc_internal_portal:355119")
        self.assertEqual(
            entry.raw_asset_id,
            "asset:authenticated-notice:muc_internal_portal:355119",
        )
        self.assertEqual(entry.source_home_url, "https://portal.example.edu/home")
        self.assertEqual(entry.attachment_document_count, 1)
        self.assertGreaterEqual(entry.planning_weight, 1)
        self.assertTrue(entry.notice_manifest_key.endswith("/source-truth/notice-manifest.json"))
        self.assertTrue(entry.content_blocks_key.endswith("/source-truth/content-blocks.jsonl"))
        self.assertTrue(entry.attachment_refs_key.endswith("/source-truth/attachment-refs.jsonl"))
        self.assertEqual(entry.parent_snapshot["notice_release_time"], "2026-04-02 18:49")

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
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
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
        self.assertEqual(entry.manual_review_required_count, 1)
        self.assertEqual(entry.ocr_required_count, 0)
        self.assertTrue(entry.has_spatial_attachment)

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
