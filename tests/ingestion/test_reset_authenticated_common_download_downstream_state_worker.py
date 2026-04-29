from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.authenticated_common_download_downstream_reset import (
    reset_authenticated_common_download_downstream_state,
)
from campus_ingestion_core.authenticated_common_download_import import (
    AuthenticatedCommonDownloadImportRequest,
    import_authenticated_common_download_export,
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
from campus_ingestion_core.settings import DEFAULT_BUCKET_DERIVED, DEFAULT_BUCKET_SOURCE

from tests.ingestion.authenticated_notice_import_test_support import (
    _FakeObjectStore,
    _sample_export_manifest,
    _sample_notice_bundle,
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


class ResetAuthenticatedCommonDownloadDownstreamStateTest(unittest.TestCase):
    def test_reset_removes_internal_notice_contamination_and_preserves_holding_scope(self) -> None:
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
                    site_id="muc_internal_portal",
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
                    source_notice_document_id="notice:muc_internal_portal:355119",
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

        report = reset_authenticated_common_download_downstream_state(
            site_id="muc_internal_portal",
            notice_ids=("355119",),
            source_truth_inventory_store=inventory_store,
            document_registry=document_registry,
            raw_asset_registry=raw_asset_registry,
            projection_store=projection_store,
            read_model_store=read_model_store,
            object_store=object_store,
            source_bucket=DEFAULT_BUCKET_SOURCE,
            derived_bucket=DEFAULT_BUCKET_DERIVED,
        )

        self.assertEqual(report.purged_notice_ids, ("355119",))
        self.assertGreater(report.source_artifact_removed_count, 0)
        self.assertEqual(
            len(
                inventory_store.list_by_scope(
                    "campus_notices", "internal_notice", notice_ids=("355119",)
                )
            ),
            0,
        )
        self.assertEqual(
            len(document_registry.list_by_scope("campus_notices", "internal_notice")),
            0,
        )
        self.assertEqual(
            len(raw_asset_registry.list_by_scope("campus_notices", "internal_notice")),
            0,
        )
        self.assertEqual(
            len(
                projection_store.list_by_scope(
                    "campus_notices", "internal_notice", notice_ids=("355119",)
                )
            ),
            0,
        )
        self.assertEqual(
            len(
                read_model_store.list_by_scope(
                    "campus_notices", "internal_notice", notice_ids=("355119",)
                )
            ),
            0,
        )
        self.assertEqual(
            len(
                inventory_store.list_by_scope(
                    "authenticated_documents",
                    "common_download_source",
                    notice_ids=("355119",),
                )
            ),
            1,
        )
        self.assertEqual(
            len(
                document_registry.list_by_scope("authenticated_documents", "common_download_source")
            ),
            1,
        )
        self.assertEqual(
            len(
                raw_asset_registry.list_by_scope(
                    "authenticated_documents", "common_download_source"
                )
            ),
            1,
        )


if __name__ == "__main__":
    unittest.main()
