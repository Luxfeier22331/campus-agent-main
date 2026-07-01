from __future__ import annotations

import copy
import hashlib
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.authenticated_common_download_import import (
    AuthenticatedCommonDownloadImportRequest,
    import_authenticated_common_download_export,
)
from campus_ingestion_core.authenticated_document_holding_status import (
    build_authenticated_document_holding_status_report,
)
from campus_ingestion_core.authenticated_notice_file_release_import import (
    AuthenticatedNoticeFileReleaseImportRequest,
    import_authenticated_notice_file_release_export,
)
from campus_ingestion_core.authenticated_notice_file_release_inventory import (
    InMemoryAuthenticatedNoticeFileReleaseInventoryStore,
)
from campus_ingestion_core.authenticated_notice_file_release_inventory_backfill import (
    inventory_entry_from_file_release_bundle_record,
)
from campus_ingestion_core.authenticated_notice_import import (
    AuthenticatedNoticeImportRequest,
    import_authenticated_notice_export,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.internal_notice_read_model import InternalNoticeReadModelEntry
from campus_ingestion_core.internal_notice_read_model_memory import (
    InMemoryInternalNoticeReadModelStore,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_ANSWERABILITY_REFERENCE_ONLY,
    NOTICE_COMPLETENESS_REFERENCE_ONLY,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_DEFAULT_AGENT_NOTICE,
    NOTICE_PRIMARY_ROLE_ATTACHMENT_FORM_TEMPLATE,
    NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
    NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TEMPORAL_POLICY_STANDING_UNTIL_REPLACED,
    NoticeConsumptionProjectionEntry,
)
from campus_ingestion_core.notice_consumption_projection_memory import (
    InMemoryNoticeConsumptionProjectionStore,
)
from campus_ingestion_core.settings import DEFAULT_BUCKET_SOURCE

from tests.ingestion.authenticated_notice_import_test_support import (
    _FakeObjectStore,
    _sample_export_manifest,
    _sample_notice_bundle,
)
from tests.ingestion.test_authenticated_notice_file_release_owner_recovery import (
    _bundle_record,
    _export_manifest,
)
from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry


def _write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _common_download_bundle() -> list[dict[str, object]]:
    bundle = copy.deepcopy(_sample_notice_bundle())
    bundle[0]["notice"]["categories"] = [
        {
            "notice_id": 355119,
            "notice_type": "9982",
            "notice_type_name": "常用下载",
            "category_first_seen_at": "2026-04-02T18:49:00.000Z",
            "category_last_seen_at": "2026-04-02T18:49:00.000Z",
            "category_last_run_id": 14,
        }
    ]
    return bundle


def _common_download_manifest() -> dict[str, object]:
    manifest = copy.deepcopy(_sample_export_manifest())
    manifest["schema_version"] = "authenticated_notice_collector_export_v2"
    manifest["source_channel"] = "authenticated_notice_portal"
    manifest["source_surface"] = "notice"
    manifest["full_scope_requested"] = True
    manifest["full_scope_completed"] = True
    manifest["page_budget_exhausted"] = False
    manifest["filters"] = {
        "collection_mode": "backfill",
        "max_notices": None,
        "notice_types": ["9982"],
    }
    return manifest


class AuthenticatedDocumentHoldingStatusTest(unittest.TestCase):
    def test_common_download_whole_scope_ignores_non_common_download_internal_notice_rows(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            _write_json(bundle_path, _sample_notice_bundle())
            _write_json(manifest_path, _sample_export_manifest())

            object_store = _FakeObjectStore()
            document_registry = InMemoryDocumentRegistry()
            raw_asset_registry = InMemoryRawAssetRegistry()
            inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
            projection_store = InMemoryNoticeConsumptionProjectionStore()
            read_model_store = InMemoryInternalNoticeReadModelStore()
            env = {
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
            }

            import_authenticated_notice_export(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="example_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                    allow_local_fixture_import=True,
                    corpus="campus_notices",
                    collection="internal_notice",
                    mode="admit_and_materialize",
                    source_truth_only=True,
                ),
                env=env,
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                source_truth_inventory_store=inventory_store,
            )

        projection_store.upsert_many(
            (
                NoticeConsumptionProjectionEntry(
                    source_family=NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
                    source_corpus="campus_notices",
                    source_collection="internal_notice",
                    source_notice_id="355119",
                    unit_id="notice:355119",
                    primary_role=NOTICE_PRIMARY_ROLE_ATTACHMENT_FORM_TEMPLATE,
                    semantic_owner=NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
                    default_agent=NOTICE_DEFAULT_AGENT_NOTICE,
                    target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
                    temporal_policy=NOTICE_TEMPORAL_POLICY_STANDING_UNTIL_REPLACED,
                    completeness_status=NOTICE_COMPLETENESS_REFERENCE_ONLY,
                    answerability=NOTICE_ANSWERABILITY_REFERENCE_ONLY,
                    consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
                    source_notice_document_id="notice:example_internal_portal:355119",
                ),
            )
        )
        read_model_store.upsert_many(
            (
                InternalNoticeReadModelEntry(
                    source_family=NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
                    source_corpus="campus_notices",
                    source_collection="internal_notice",
                    source_notice_id="355119",
                    unit_id="notice:355119",
                    primary_role=NOTICE_PRIMARY_ROLE_ATTACHMENT_FORM_TEMPLATE,
                    target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
                    consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
                    queryable=True,
                    title="教学通知",
                ),
            )
        )

        report = build_authenticated_document_holding_status_report(
            source_corpus="authenticated_documents",
            source_collection="common_download_source",
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            source_truth_inventory_store=inventory_store,
            file_release_inventory_store=InMemoryAuthenticatedNoticeFileReleaseInventoryStore(),
            projection_store=projection_store,
            read_model_store=read_model_store,
            object_store=object_store,
            source_bucket=DEFAULT_BUCKET_SOURCE,
        )

        self.assertEqual(report.scope_unit_count, 0)
        self.assertEqual(report.action_required_count, 0)
        self.assertEqual(report.holding_inventory_count, 0)
        self.assertEqual(report.wrong_scope_inventory_count, 0)
        self.assertEqual(report.downstream_projection_count, 0)
        self.assertEqual(report.downstream_read_model_count, 0)
        self.assertEqual(report.rows, ())

    def test_common_download_status_flags_wrong_scope_and_downstream_contamination(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            _write_json(bundle_path, _common_download_bundle())
            _write_json(manifest_path, _common_download_manifest())

            object_store = _FakeObjectStore()
            document_registry = InMemoryDocumentRegistry()
            raw_asset_registry = InMemoryRawAssetRegistry()
            inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
            projection_store = InMemoryNoticeConsumptionProjectionStore()
            read_model_store = InMemoryInternalNoticeReadModelStore()
            env = {
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
            }

            import_authenticated_notice_export(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="example_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                    allow_local_fixture_import=True,
                    corpus="campus_notices",
                    collection="internal_notice",
                    mode="admit_and_materialize",
                    source_truth_only=True,
                ),
                env=env,
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                source_truth_inventory_store=inventory_store,
            )
            import_authenticated_common_download_export(
                request=AuthenticatedCommonDownloadImportRequest(
                    bundle_path=bundle_path,
                    manifest_path=manifest_path,
                    site_id="example_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                    mode="admit_and_materialize",
                ),
                env=env,
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                source_truth_inventory_store=inventory_store,
            )

        projection_store.upsert_many(
            (
                NoticeConsumptionProjectionEntry(
                    source_family=NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
                    source_corpus="campus_notices",
                    source_collection="internal_notice",
                    source_notice_id="355119",
                    unit_id="notice:355119",
                    primary_role=NOTICE_PRIMARY_ROLE_ATTACHMENT_FORM_TEMPLATE,
                    semantic_owner=NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
                    default_agent=NOTICE_DEFAULT_AGENT_NOTICE,
                    target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
                    temporal_policy=NOTICE_TEMPORAL_POLICY_STANDING_UNTIL_REPLACED,
                    completeness_status=NOTICE_COMPLETENESS_REFERENCE_ONLY,
                    answerability=NOTICE_ANSWERABILITY_REFERENCE_ONLY,
                    consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
                    source_notice_document_id="notice:example_internal_portal:355119",
                ),
            )
        )
        read_model_store.upsert_many(
            (
                InternalNoticeReadModelEntry(
                    source_family=NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
                    source_corpus="campus_notices",
                    source_collection="internal_notice",
                    source_notice_id="355119",
                    unit_id="notice:355119",
                    primary_role=NOTICE_PRIMARY_ROLE_ATTACHMENT_FORM_TEMPLATE,
                    target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
                    consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
                    queryable=True,
                    title="常用下载测试通知",
                ),
            )
        )

        report = build_authenticated_document_holding_status_report(
            source_corpus="authenticated_documents",
            source_collection="common_download_source",
            notice_ids=("355119",),
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            source_truth_inventory_store=inventory_store,
            file_release_inventory_store=InMemoryAuthenticatedNoticeFileReleaseInventoryStore(),
            projection_store=projection_store,
            read_model_store=read_model_store,
            object_store=object_store,
            source_bucket=DEFAULT_BUCKET_SOURCE,
        )

        self.assertEqual(report.scope_unit_count, 1)
        self.assertEqual(report.action_required_count, 1)
        self.assertEqual(report.reason_counts["downstream_contamination"], 1)
        self.assertEqual(report.reason_counts["wrong_scope_residue"], 1)
        self.assertEqual(report.rows[0].unit_id, "355119")
        self.assertIn("downstream_contamination", report.rows[0].reason_codes)
        self.assertIn("wrong_scope_residue", report.rows[0].reason_codes)

    def test_common_download_whole_scope_reports_common_download_contamination_without_holding(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            _write_json(bundle_path, _common_download_bundle())
            _write_json(manifest_path, _common_download_manifest())

            object_store = _FakeObjectStore()
            document_registry = InMemoryDocumentRegistry()
            raw_asset_registry = InMemoryRawAssetRegistry()
            inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
            projection_store = InMemoryNoticeConsumptionProjectionStore()
            read_model_store = InMemoryInternalNoticeReadModelStore()
            env = {
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
            }

            import_authenticated_notice_export(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="example_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                    allow_local_fixture_import=True,
                    corpus="campus_notices",
                    collection="internal_notice",
                    mode="admit_and_materialize",
                    source_truth_only=True,
                ),
                env=env,
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                source_truth_inventory_store=inventory_store,
            )

        projection_store.upsert_many(
            (
                NoticeConsumptionProjectionEntry(
                    source_family=NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
                    source_corpus="campus_notices",
                    source_collection="internal_notice",
                    source_notice_id="355119",
                    unit_id="notice:355119",
                    primary_role=NOTICE_PRIMARY_ROLE_ATTACHMENT_FORM_TEMPLATE,
                    semantic_owner=NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
                    default_agent=NOTICE_DEFAULT_AGENT_NOTICE,
                    target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
                    temporal_policy=NOTICE_TEMPORAL_POLICY_STANDING_UNTIL_REPLACED,
                    completeness_status=NOTICE_COMPLETENESS_REFERENCE_ONLY,
                    answerability=NOTICE_ANSWERABILITY_REFERENCE_ONLY,
                    consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
                    source_notice_document_id="notice:example_internal_portal:355119",
                ),
            )
        )
        read_model_store.upsert_many(
            (
                InternalNoticeReadModelEntry(
                    source_family=NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
                    source_corpus="campus_notices",
                    source_collection="internal_notice",
                    source_notice_id="355119",
                    unit_id="notice:355119",
                    primary_role=NOTICE_PRIMARY_ROLE_ATTACHMENT_FORM_TEMPLATE,
                    target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
                    consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
                    queryable=True,
                    title="常用下载测试通知",
                ),
            )
        )

        report = build_authenticated_document_holding_status_report(
            source_corpus="authenticated_documents",
            source_collection="common_download_source",
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            source_truth_inventory_store=inventory_store,
            file_release_inventory_store=InMemoryAuthenticatedNoticeFileReleaseInventoryStore(),
            projection_store=projection_store,
            read_model_store=read_model_store,
            object_store=object_store,
            source_bucket=DEFAULT_BUCKET_SOURCE,
        )

        self.assertEqual(report.scope_unit_count, 1)
        self.assertEqual(report.action_required_count, 1)
        self.assertEqual(report.holding_inventory_count, 0)
        self.assertEqual(report.wrong_scope_inventory_count, 1)
        self.assertEqual(report.downstream_projection_count, 1)
        self.assertEqual(report.downstream_read_model_count, 1)
        self.assertEqual(report.reason_counts["missing_holding_inventory"], 1)
        self.assertEqual(report.reason_counts["wrong_scope_residue"], 1)
        self.assertEqual(report.reason_counts["downstream_contamination"], 1)
        self.assertEqual(report.rows[0].unit_id, "355119")
        self.assertEqual(
            report.rows[0].reason_codes,
            (
                "missing_holding_inventory",
                "wrong_scope_residue",
                "downstream_contamination",
            ),
        )

    def test_file_release_status_is_clean_when_holding_scope_is_complete(self) -> None:
        source_bytes = b"%PDF-1.4\nfile release source\n"
        source_sha256 = hashlib.sha256(source_bytes).hexdigest()
        bundle = (
            _bundle_record(
                file_release_id=646,
                filename="示例大学差旅费管理办法.pdf",
                sha256=source_sha256,
            ),
        )
        bundle[0]["released_file"]["byte_size"] = len(source_bytes)
        manifest = _export_manifest()

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "file-releases-bundle.json"
            manifest_path = root / "file-releases-manifest.json"
            _write_json(bundle_path, list(bundle))
            _write_json(manifest_path, manifest)

            object_store = _FakeObjectStore()
            object_store.put_bytes(
                bucket=str(bundle[0]["released_file"]["bucket"]),
                key=str(bundle[0]["released_file"]["object_key"]),
                data=source_bytes,
                content_type="application/pdf",
            )
            object_store.uploads.clear()
            document_registry = InMemoryDocumentRegistry()
            raw_asset_registry = InMemoryRawAssetRegistry()
            inventory_store = InMemoryAuthenticatedNoticeFileReleaseInventoryStore()
            env = {
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
            }

            import_authenticated_notice_file_release_export(
                request=AuthenticatedNoticeFileReleaseImportRequest(
                    bundle_path=bundle_path,
                    manifest_path=manifest_path,
                    site_id="example_internal_portal",
                    source_home_url="https://portal.example.edu/",
                    allow_local_fixture_import=True,
                    mode="admit_and_materialize",
                ),
                env=env,
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                inventory_store=inventory_store,
            )

        report = build_authenticated_document_holding_status_report(
            source_corpus="authenticated_documents",
            source_collection="file_release_source",
            file_release_ids=(646,),
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            source_truth_inventory_store=InMemoryAuthenticatedNoticeSourceTruthInventoryStore(),
            file_release_inventory_store=inventory_store,
            projection_store=InMemoryNoticeConsumptionProjectionStore(),
            read_model_store=InMemoryInternalNoticeReadModelStore(),
            object_store=object_store,
            source_bucket=DEFAULT_BUCKET_SOURCE,
        )

        self.assertEqual(report.scope_unit_count, 1)
        self.assertEqual(report.action_required_count, 0)
        self.assertEqual(report.holding_stage_counts["imported_holding"], 1)
        self.assertEqual(report.rows[0].unit_id, "646")
        self.assertEqual(report.rows[0].holding_stage, "imported_holding")
        self.assertEqual(report.rows[0].reason_codes, ())

    def test_file_release_status_distinguishes_capture_only_and_source_ready(self) -> None:
        source_bytes = b"%PDF-1.4\nsource ready\n"
        source_sha256 = hashlib.sha256(source_bytes).hexdigest()
        capture_only = inventory_entry_from_file_release_bundle_record(
            record=_bundle_record(
                file_release_id=646,
                filename="示例大学差旅费管理办法.pdf",
                storage_provider="reference_only",
                bucket=None,
                object_key=None,
                sha256=None,
                ingest_status="reference_only",
                provenance_status="reference_only",
            ),
            export_scope="file-release-20260412T003300Z",
            site_id="example_internal_portal",
            source_home_url="https://portal.example.edu/",
            collector_contract_version="authenticated_notice_file_release_export_v1",
        )
        source_ready_record = _bundle_record(
            file_release_id=647,
            filename="示例大学合同管理办法.pdf",
            sha256=source_sha256,
        )
        source_ready_record["released_file"]["byte_size"] = len(source_bytes)
        source_ready = inventory_entry_from_file_release_bundle_record(
            record=source_ready_record,
            export_scope="file-release-20260412T003300Z",
            site_id="example_internal_portal",
            source_home_url="https://portal.example.edu/",
            collector_contract_version="authenticated_notice_file_release_export_v1",
        )
        object_store = _FakeObjectStore()
        object_store.put_bytes(
            bucket=str(source_ready_record["released_file"]["bucket"]),
            key=str(source_ready_record["released_file"]["object_key"]),
            data=source_bytes,
            content_type="application/pdf",
        )
        inventory_store = InMemoryAuthenticatedNoticeFileReleaseInventoryStore()
        inventory_store.upsert_many((capture_only, source_ready))

        report = build_authenticated_document_holding_status_report(
            source_corpus="authenticated_documents",
            source_collection="file_release_source",
            file_release_ids=(646, 647),
            document_registry=InMemoryDocumentRegistry(),
            raw_asset_registry=InMemoryRawAssetRegistry(),
            source_truth_inventory_store=InMemoryAuthenticatedNoticeSourceTruthInventoryStore(),
            file_release_inventory_store=inventory_store,
            projection_store=InMemoryNoticeConsumptionProjectionStore(),
            read_model_store=InMemoryInternalNoticeReadModelStore(),
            object_store=object_store,
            source_bucket=DEFAULT_BUCKET_SOURCE,
        )

        rows_by_id = {row.unit_id: row for row in report.rows}
        self.assertEqual(rows_by_id["646"].holding_stage, "captured_only")
        self.assertIn("captured_only_without_source_bytes", rows_by_id["646"].reason_codes)
        self.assertEqual(rows_by_id["647"].holding_stage, "object_backed_source_ready")
        self.assertIn("not_imported_to_holding", rows_by_id["647"].reason_codes)
        self.assertEqual(report.holding_stage_counts["captured_only"], 1)
        self.assertEqual(report.holding_stage_counts["object_backed_source_ready"], 1)

    def test_file_release_status_flags_downstream_admitted(self) -> None:
        source_bytes = b"%PDF-1.4\nfile release source\n"
        source_sha256 = hashlib.sha256(source_bytes).hexdigest()
        bundle = (
            _bundle_record(
                file_release_id=646,
                filename="示例大学差旅费管理办法.pdf",
                sha256=source_sha256,
            ),
        )
        bundle[0]["released_file"]["byte_size"] = len(source_bytes)
        manifest = _export_manifest()

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "file-releases-bundle.json"
            manifest_path = root / "file-releases-manifest.json"
            _write_json(bundle_path, list(bundle))
            _write_json(manifest_path, manifest)

            object_store = _FakeObjectStore()
            object_store.put_bytes(
                bucket=str(bundle[0]["released_file"]["bucket"]),
                key=str(bundle[0]["released_file"]["object_key"]),
                data=source_bytes,
                content_type="application/pdf",
            )
            object_store.uploads.clear()
            document_registry = InMemoryDocumentRegistry()
            raw_asset_registry = InMemoryRawAssetRegistry()
            inventory_store = InMemoryAuthenticatedNoticeFileReleaseInventoryStore()

            import_authenticated_notice_file_release_export(
                request=AuthenticatedNoticeFileReleaseImportRequest(
                    bundle_path=bundle_path,
                    manifest_path=manifest_path,
                    site_id="example_internal_portal",
                    source_home_url="https://portal.example.edu/",
                    allow_local_fixture_import=True,
                    mode="admit_and_materialize",
                ),
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                },
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                inventory_store=inventory_store,
            )

        projection_store = InMemoryNoticeConsumptionProjectionStore()
        projection_store.upsert_many(
            (
                NoticeConsumptionProjectionEntry(
                    source_family=NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
                    source_corpus="authenticated_documents",
                    source_collection="file_release_source",
                    source_notice_id="646",
                    unit_id="file_release:646",
                    primary_role=NOTICE_PRIMARY_ROLE_ATTACHMENT_FORM_TEMPLATE,
                    semantic_owner=NOTICE_SEMANTIC_OWNER_NOTICE_BODY,
                    default_agent=NOTICE_DEFAULT_AGENT_NOTICE,
                    target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
                    temporal_policy=NOTICE_TEMPORAL_POLICY_STANDING_UNTIL_REPLACED,
                    completeness_status=NOTICE_COMPLETENESS_REFERENCE_ONLY,
                    answerability=NOTICE_ANSWERABILITY_REFERENCE_ONLY,
                    consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
                    source_notice_document_id="file-release:example_internal_portal:646",
                ),
            )
        )
        read_model_store = InMemoryInternalNoticeReadModelStore()
        read_model_store.upsert_many(
            (
                InternalNoticeReadModelEntry(
                    source_family=NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
                    source_corpus="authenticated_documents",
                    source_collection="file_release_source",
                    source_notice_id="646",
                    unit_id="file_release:646",
                    primary_role=NOTICE_PRIMARY_ROLE_ATTACHMENT_FORM_TEMPLATE,
                    target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
                    consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
                    queryable=True,
                    title="示例大学差旅费管理办法.pdf",
                ),
            )
        )

        report = build_authenticated_document_holding_status_report(
            source_corpus="authenticated_documents",
            source_collection="file_release_source",
            file_release_ids=(646,),
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            source_truth_inventory_store=InMemoryAuthenticatedNoticeSourceTruthInventoryStore(),
            file_release_inventory_store=inventory_store,
            projection_store=projection_store,
            read_model_store=read_model_store,
            object_store=object_store,
            source_bucket=DEFAULT_BUCKET_SOURCE,
        )

        self.assertEqual(report.rows[0].holding_stage, "downstream_admitted")
        self.assertIn("downstream_admitted", report.rows[0].reason_codes)
        self.assertEqual(report.downstream_projection_count, 1)
        self.assertEqual(report.downstream_read_model_count, 1)
        self.assertEqual(report.holding_stage_counts["downstream_admitted"], 1)


if __name__ == "__main__":
    unittest.main()
