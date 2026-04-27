from __future__ import annotations

import copy
import unittest
from pathlib import Path

from campus_ingestion_core.authenticated_notice_attachment_fetch_status import (
    FETCH_STATUS_COLLECTED_INTERNAL,
    FETCH_STATUS_TERMINAL_UNAVAILABLE,
    TERMINAL_REASON_HTTP_404,
    InMemoryAuthenticatedNoticeAttachmentFetchStatusStore,
)
from campus_ingestion_core.authenticated_notice_notice_family import (
    load_authenticated_notice_notice_family_config,
)
from campus_ingestion_core.internal_notice_consumer_admission_builder import (
    build_internal_notice_consumer_admission_manifest_from_bundle_records,
)
from campus_ingestion_core.internal_notice_consumer_admission_manifest import (
    write_internal_notice_consumer_admission_manifest,
)
from campus_ingestion_core.internal_notice_read_model import InMemoryInternalNoticeReadModelStore
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
    InMemoryNoticeConsumptionProjectionStore,
)

from .authenticated_notice_import_test_support import *


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

    def test_import_authenticated_notice_export_can_rebuild_consumption_projection_for_imported_notices(
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
                    mode="admit_and_materialize",
                ),
                env=env,
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                source_truth_inventory_store=inventory_store,
                consumption_projection_store=projection_store,
            )

        self.assertEqual(report["errors"], [])
        self.assertGreaterEqual(report["consumption_projection_entry_count"], 1)
        entries = projection_store.list_by_scope(
            "campus_notices",
            "internal_notice",
            notice_ids=("355119",),
        )
        self.assertIn(NOTICE_PRIMARY_ROLE_NOTICE_WINDOW, {entry.primary_role for entry in entries})

    def test_import_authenticated_notice_export_does_not_expand_projection_scope_to_manifest(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            first_bundle_path = root / "notices-bundle-first.json"
            second_bundle_path = root / "notices-bundle-second.json"
            first_manifest_path = root / "export-manifest-first.json"
            second_manifest_path = root / "export-manifest-second.json"
            consumer_manifest_path = root / "consumer-admission-manifest.json"
            first_bundle = _sample_notice_bundle()
            second_bundle = _sample_notice_bundle_with_id(
                355120,
                title="第二条类型补宽通知",
                content="<p>第二条类型补宽通知正文</p>",
            )
            _write_json(first_bundle_path, first_bundle)
            _write_json(second_bundle_path, second_bundle)
            _write_json(first_manifest_path, _sample_export_manifest())
            _write_json(second_manifest_path, _sample_export_manifest())
            _write_consumer_manifest(
                consumer_manifest_path,
                bundle_records=first_bundle + second_bundle,
                selection_path=str(root / "broad-selection.json"),
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
            env = {
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
            }
            shared_kwargs = {
                "env": env,
                "object_store": object_store,
                "document_registry": document_registry,
                "raw_asset_registry": raw_asset_registry,
                "source_truth_inventory_store": inventory_store,
            }
            for bundle_path, manifest_path in (
                (first_bundle_path, first_manifest_path),
                (second_bundle_path, second_manifest_path),
            ):
                import_authenticated_notice_export(
                    request=AuthenticatedNoticeImportRequest(
                        bundle_path=bundle_path,
                        export_manifest_path=manifest_path,
                        site_id="muc_internal_portal",
                        source_home_url="https://portal.example.edu/home",
                        mode="admit_and_materialize",
                    ),
                    **shared_kwargs,
                )

            report = import_authenticated_notice_export(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=first_bundle_path,
                    export_manifest_path=first_manifest_path,
                    consumer_admission_manifest_path=consumer_manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                    mode="admit_and_materialize",
                ),
                consumption_projection_store=projection_store,
                **shared_kwargs,
            )

        self.assertEqual(report["errors"], [])
        entries = projection_store.list_by_scope("campus_notices", "internal_notice")
        self.assertEqual({entry.source_notice_id for entry in entries}, {"355119"})

    def test_import_authenticated_notice_export_requires_consumer_manifest_for_projection_writes(
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
            env = {
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
            }

            with self.assertRaisesRegex(ValueError, "consumer admission manifest"):
                import_authenticated_notice_export(
                    request=AuthenticatedNoticeImportRequest(
                        bundle_path=bundle_path,
                        export_manifest_path=manifest_path,
                        site_id="muc_internal_portal",
                        source_home_url="https://portal.example.edu/home",
                        mode="admit_and_materialize",
                    ),
                    env=env,
                    object_store=object_store,
                    document_registry=document_registry,
                    raw_asset_registry=raw_asset_registry,
                    source_truth_inventory_store=inventory_store,
                    consumption_projection_store=projection_store,
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


def _write_consumer_manifest(
    path: Path,
    *,
    bundle_records: list[dict[str, object]],
    selection_path: str,
) -> None:
    config = load_authenticated_notice_notice_family_config(
        Path(
            "configs/ingestion/campus_notices/internal_notice/notice-family-classification.v1.json"
        )
    )
    manifest = build_internal_notice_consumer_admission_manifest_from_bundle_records(
        bundle_records=bundle_records,
        config=config,
        admission_run_id="consumer-admission-test",
        selection_source="bundle_dry_run",
        selection_path=selection_path,
        site_id="muc_internal_portal",
        created_at="2026-04-27T00:00:00+00:00",
    )
    write_internal_notice_consumer_admission_manifest(path, manifest)


def _sample_notice_bundle_with_id(
    notice_id: int,
    *,
    title: str,
    content: str,
) -> list[dict[str, object]]:
    bundle = copy.deepcopy(_sample_notice_bundle())
    bundle[0]["notice_id"] = notice_id
    notice = bundle[0]["notice"]
    if isinstance(notice, dict):
        notice["notice_id"] = notice_id
        notice["notice_title"] = title
        notice["notice_content"] = content
        for category in notice.get("categories") or ():
            if isinstance(category, dict):
                category["notice_id"] = notice_id
    for relation_key in ("links", "notice_attachments"):
        for relation in bundle[0].get(relation_key) or ():
            if isinstance(relation, dict):
                relation["notice_id"] = notice_id
    return bundle
