from __future__ import annotations

import copy
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from tests.ingestion.authenticated_notice_import_export_suite_support import (
    FETCH_STATUS_COLLECTED_INTERNAL,
    FETCH_STATUS_TERMINAL_UNAVAILABLE,
    TERMINAL_REASON_HTTP_404,
    AuthenticatedNoticeImportRequest,
    InMemoryAuthenticatedNoticeAttachmentFetchStatusStore,
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
    InMemoryDocumentRegistry,
    InMemoryRawAssetRegistry,
    _FakeObjectStore,
    _sample_export_manifest,
    _sample_notice_bundle,
    _write_json,
    import_authenticated_notice_export,
)


class AuthenticatedNoticeImportExportTestPart01(unittest.TestCase):
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
                    allow_local_fixture_import=True,
                    mode="admit_and_materialize",
                    replace_scope=True,
                ),
                env=env,
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                source_truth_inventory_store=inventory_store,
            )

        self.assertEqual(report["errors"], [])
        self.assertEqual(report["selected_notice_ids"], [])
        self.assertNotIn("selected_notices", report)
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
        self.assertEqual(
            entry.parent_snapshot["portal_print_url"],
            "https://portal.example.edu/#/print?type=6&notice_id=355119&show_type=1",
        )
        self.assertEqual(
            entry.parent_snapshot["notice_browser_url"],
            "https://portal.example.edu/notice/355119",
        )
        self.assertEqual(entry.parent_snapshot["notice_browser_url_source"], "api_notice_link")
        self.assertEqual(entry.attachment_document_count, 1)
        self.assertGreaterEqual(entry.planning_weight, 1)
        self.assertTrue(entry.notice_manifest_key.endswith("/source-truth/notice-manifest.json"))
        self.assertTrue(entry.content_blocks_key.endswith("/source-truth/content-blocks.jsonl"))
        self.assertTrue(entry.attachment_refs_key.endswith("/source-truth/attachment-refs.jsonl"))
        self.assertEqual(entry.parent_snapshot["notice_release_time"], "2026-04-02 18:49")

    def test_incremental_notice_type_import_upserts_without_shrinking_existing_scope(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            existing_bundle_path = root / "notices-bundle-existing.json"
            existing_manifest_path = root / "export-manifest-existing.json"
            incremental_bundle_path = root / "notices-bundle-incremental.json"
            incremental_manifest_path = root / "export-manifest-incremental.json"

            existing_bundle = _sample_notice_bundle()
            existing_manifest = _sample_export_manifest()
            existing_manifest["filters"] = {
                **dict(existing_manifest["filters"]),
                "selected_notice_ids": ["355119"],
            }

            incremental_bundle = copy.deepcopy(_sample_notice_bundle())
            incremental_bundle[0]["notice_id"] = 355120
            incremental_bundle[0]["notice"]["notice_id"] = 355120
            incremental_bundle[0]["notice"]["notice_title"] = "第二条类型补宽通知"
            incremental_bundle[0]["notice"]["notice_content"] = "<p>第二条类型补宽通知正文</p>"
            incremental_bundle[0]["notice"]["categories"][0]["notice_id"] = 355120
            for relation in incremental_bundle[0]["notice_attachments"]:
                relation["notice_id"] = 355120
            for link in incremental_bundle[0]["links"]:
                link["notice_id"] = 355120

            incremental_manifest = _sample_export_manifest()
            incremental_manifest["filters"] = {
                "collection_mode": "incremental",
                "max_notices": None,
                "notice_types": ["6"],
            }

            _write_json(existing_bundle_path, existing_bundle)
            _write_json(existing_manifest_path, existing_manifest)
            _write_json(incremental_bundle_path, incremental_bundle)
            _write_json(incremental_manifest_path, incremental_manifest)

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

            import_authenticated_notice_export(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=existing_bundle_path,
                    export_manifest_path=existing_manifest_path,
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
            incremental_report = import_authenticated_notice_export(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=incremental_bundle_path,
                    export_manifest_path=incremental_manifest_path,
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

        self.assertEqual(incremental_report["errors"], [])
        self.assertEqual(incremental_report["scope_write_mode"], "upsert_selected")
        self.assertEqual(incremental_report["selected_notice_ids"], ["355120"])
        self.assertEqual(
            tuple(
                entry.notice_id
                for entry in inventory_store.list_by_scope("campus_notices", "internal_notice")
            ),
            ("355119", "355120"),
        )
        self.assertEqual(
            sorted(
                record.document_id
                for record in document_registry.list_by_scope("campus_notices", "internal_notice")
                if record.document_id.startswith("notice:")
            ),
            [
                "notice:muc_internal_portal:355119",
                "notice:muc_internal_portal:355120",
            ],
        )

    def test_selected_import_upserts_source_truth_inventory_without_shrinking_existing_scope(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            first_bundle_path = root / "notices-bundle-first.json"
            first_manifest_path = root / "export-manifest-first.json"
            selected_bundle_path = root / "notices-bundle-selected.json"
            selected_manifest_path = root / "export-manifest-selected.json"

            first_bundle = _sample_notice_bundle()
            selected_bundle = copy.deepcopy(_sample_notice_bundle())
            selected_bundle[0]["notice_id"] = 355120
            selected_bundle[0]["notice"]["notice_id"] = 355120
            selected_bundle[0]["notice"]["notice_title"] = "第二条历史通知"
            selected_bundle[0]["notice"]["notice_content"] = "<p>第二条历史通知正文</p>"
            selected_bundle[0]["notice"]["categories"][0]["notice_id"] = 355120
            for relation in selected_bundle[0]["notice_attachments"]:
                relation["notice_id"] = 355120
            for link in selected_bundle[0]["links"]:
                link["notice_id"] = 355120

            selected_manifest = _sample_export_manifest()
            selected_manifest["filters"] = {
                **dict(selected_manifest["filters"]),
                "selected_notice_ids": ["355120"],
            }
            _write_json(first_bundle_path, first_bundle)
            _write_json(first_manifest_path, _sample_export_manifest())
            _write_json(selected_bundle_path, selected_bundle)
            _write_json(selected_manifest_path, selected_manifest)

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

            first_report = import_authenticated_notice_export(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=first_bundle_path,
                    export_manifest_path=first_manifest_path,
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
            selected_report = import_authenticated_notice_export(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=selected_bundle_path,
                    export_manifest_path=selected_manifest_path,
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

        self.assertEqual(first_report["errors"], [])
        self.assertEqual(selected_report["errors"], [])
        self.assertEqual(selected_report["selected_notice_ids"], ["355120"])
        self.assertEqual(
            selected_report["selected_notices"],
            [{"notice_id": "355120", "title": "第二条历史通知"}],
        )
        self.assertEqual(
            tuple(
                entry.notice_id
                for entry in inventory_store.list_by_scope("campus_notices", "internal_notice")
            ),
            ("355119", "355120"),
        )
        self.assertEqual(
            sorted(
                record.document_id
                for record in document_registry.list_by_scope("campus_notices", "internal_notice")
                if record.document_id.startswith("notice:")
            ),
            [
                "notice:muc_internal_portal:355119",
                "notice:muc_internal_portal:355120",
            ],
        )

    def test_import_authenticated_notice_export_records_attachment_fetch_status(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            bundle = _sample_notice_bundle()
            bundle[0]["attachments"].append(
                {
                    **dict(bundle[0]["attachments"][0]),
                    "attachment_id": 2,
                    "source_url": "https://portal.example.edu/files/missing.pdf",
                    "normalized_source_url": "https://portal.example.edu/files/missing.pdf",
                    "final_url": "https://portal.example.edu/files/missing.pdf",
                    "original_filename": "missing.pdf",
                    "mime_type": None,
                    "byte_size": None,
                    "sha256": None,
                    "storage_provider": "reference_only",
                    "bucket": None,
                    "object_key": None,
                    "provenance_status": "reference_only",
                    "ingest_status": "reference_only",
                    "downloaded_at": None,
                    "uploaded_at": None,
                    "last_error": "downloadAttachment failed: 404 ",
                }
            )
            bundle[0]["notice_attachments"].append(
                {
                    "notice_id": 355119,
                    "attachment_id": 2,
                    "link_id": None,
                    "relation_source": "detail_api",
                    "resource_role": "attachment",
                    "anchor_text": "missing.pdf",
                    "discovered_at": "2026-04-02T23:58:26.053Z",
                }
            )
            _write_json(bundle_path, bundle)
            _write_json(manifest_path, _sample_export_manifest())

            object_store = _FakeObjectStore()
            document_registry = InMemoryDocumentRegistry(
                backing_path=root / "registry" / "documents.json"
            )
            raw_asset_registry = InMemoryRawAssetRegistry(
                backing_path=root / "registry" / "raw-assets.json"
            )
            fetch_status_store = InMemoryAuthenticatedNoticeAttachmentFetchStatusStore()
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
                attachment_fetch_status_store=fetch_status_store,
            )

        self.assertEqual(report["errors"], [])
        records = fetch_status_store.list_by_notice_ids(
            site_id="muc_internal_portal",
            notice_ids=("355119",),
        )
        self.assertEqual(len(records), 2)
        by_ref_id = {record.attachment_ref_id: record for record in records}
        self.assertEqual(
            by_ref_id["attachment-0001"].fetch_status,
            FETCH_STATUS_COLLECTED_INTERNAL,
        )
        self.assertEqual(
            by_ref_id["attachment-0001"].object_key,
            "5e/5e7a0c7675fc8dfe814e74ed3206dd461b7cac88f324a6436dfd490b2f6dd152/application.docx",
        )
        self.assertEqual(
            by_ref_id["attachment-0002"].fetch_status,
            FETCH_STATUS_TERMINAL_UNAVAILABLE,
        )
        self.assertEqual(by_ref_id["attachment-0002"].terminal_reason, TERMINAL_REASON_HTTP_404)
        self.assertEqual(by_ref_id["attachment-0002"].last_http_status, 404)
