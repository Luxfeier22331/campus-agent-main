from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from tests.ingestion.authenticated_notice_import_export_suite_support import (
    NOTICE_PRIMARY_ROLE_NOTICE_WINDOW,
    AuthenticatedNoticeImportRequest,
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
    InMemoryDocumentRegistry,
    InMemoryNoticeConsumptionProjectionStore,
    InMemoryRawAssetRegistry,
    _FakeObjectStore,
    _sample_export_manifest,
    _sample_notice_bundle,
    _sample_notice_bundle_with_id,
    _write_consumer_manifest,
    _write_json,
    import_authenticated_notice_export,
)


class AuthenticatedNoticeImportExportTestPart02(unittest.TestCase):
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
                    allow_local_fixture_import=True,
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

    def test_import_authenticated_notice_export_reports_ready_typed_materialization_candidates(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            consumer_manifest_path = root / "consumer-admission-manifest.json"
            bundle = _sample_notice_bundle_with_id(
                355867,
                title="关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知",
                content=(
                    "<h1>关于4月27日-5月5日期间两校区班车及地铁接驳车安排的通知</h1>"
                    "<p>根据学校近期相关安排，现将4月27日-5月5日期间两校区班车及地铁接驳车运营安排通知如下。</p>"
                    "<p>一、4月27日两校区班车安排。</p>"
                    "<p>二、4月28日-5月5日两校区班车及地铁接驳车安排。</p>"
                ),
            )
            _write_json(bundle_path, bundle)
            _write_json(manifest_path, _sample_export_manifest())
            _write_consumer_manifest(
                consumer_manifest_path,
                bundle_records=bundle,
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
                    allow_local_fixture_import=True,
                    mode="admit_and_materialize",
                ),
                env=env,
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                source_truth_inventory_store=inventory_store,
                consumption_projection_store=projection_store,
            )

        self.assertEqual(report["typed_materialization_candidate_count"], 1)
        self.assertEqual(
            report["typed_materialization_candidate_kind_counts"],
            {"transport_schedule": 1},
        )

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
                        allow_local_fixture_import=True,
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
                    allow_local_fixture_import=True,
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
                        allow_local_fixture_import=True,
                        mode="admit_and_materialize",
                    ),
                    env=env,
                    object_store=object_store,
                    document_registry=document_registry,
                    raw_asset_registry=raw_asset_registry,
                    source_truth_inventory_store=inventory_store,
                    consumption_projection_store=projection_store,
                )
