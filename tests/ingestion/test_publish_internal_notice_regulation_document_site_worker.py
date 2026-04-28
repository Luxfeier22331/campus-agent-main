from __future__ import annotations

import copy
import importlib
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.notice_consumption_projection import (
    InMemoryNoticeConsumptionProjectionStore,
)

from tests.ingestion.authenticated_notice_import_test_support import (
    InMemoryDocumentRegistry,
    InMemoryRawAssetRegistry,
    _FakeObjectStore,
    _sample_export_manifest,
    _sample_notice_bundle,
    _write_json,
)

worker = importlib.import_module(
    "campus_ingestion_worker.publish_internal_notice_regulation_document_site"
)


class PublishInternalNoticeRegulationDocumentSiteWorkerTest(unittest.TestCase):
    def test_publish_requires_dry_run_then_imports_selected_regulation_into_docs_manifest(
        self,
    ) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            output_dir = root / "publish"
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            dry_run_report_path = root / "dry-run-report.json"

            bundle = _sample_regulation_notice_bundle()
            _write_json(bundle_path, bundle)
            manifest = _sample_export_manifest()
            manifest["filters"] = {
                **dict(manifest.get("filters") or {}),
                "selected_notice_ids": ["187233"],
            }
            _write_json(manifest_path, manifest)
            _write_json(
                dry_run_report_path,
                {
                    "schema_version": "internal_notice_regulation_document_site_dry_run.v1",
                    "selected_notice_ids": ["187233"],
                    "materialized_document_count": 1,
                    "ready_projection_entry_count": 1,
                    "reader_document_count": 1,
                    "query_serving_opened": False,
                    "rag_release_opened": False,
                },
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

            report = worker.publish_internal_notice_regulation_document_site(
                request=worker.InternalNoticeRegulationDocumentSitePublishRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    dry_run_report_path=dry_run_report_path,
                    output_dir=output_dir,
                    notice_ids=("187233",),
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                ),
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    "OBJECT_STORE_BUCKET_SOURCE": "campus-rag-source",
                    "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
                    "EMBEDDING_PROVIDER": "mock",
                    "EMBEDDING_MODEL": "mock-embedding-8d",
                    "SPARSE_PROVIDER": "mock",
                },
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                source_truth_inventory_store=inventory_store,
                consumption_projection_store=projection_store,
            )

            self.assertEqual(report["mode"], "dry_run_then_formal_import")
            self.assertEqual(report["selected_notice_ids"], ["187233"])
            self.assertEqual(report["source_truth_import"]["write_enabled"], True)
            self.assertEqual(report["materialized_document_count"], 1)
            self.assertEqual(report["reader_document_count"], 1)
            self.assertEqual(report["query_serving_opened"], False)
            self.assertEqual(report["rag_release_opened"], False)

            docs_manifest_path = Path(report["docs_read_model_manifest_path"])
            self.assertTrue(docs_manifest_path.exists())
            docs_manifest = json.loads(docs_manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(len(docs_manifest["documents"]), 1)
            self.assertEqual(
                docs_manifest["documents"][0]["title"],
                "中央民族大学采购工作管理办法",
            )
            self.assertIn("2021年修订", docs_manifest["documents"][0]["canonicalUrl"])
            self.assertEqual(
                docs_manifest["documentVersions"][0]["deliveryMode"],
                "gated_asset",
            )
            self.assertEqual(
                {
                    entry.notice_id
                    for entry in inventory_store.list_by_scope("campus_notices", "internal_notice")
                },
                {"187233"},
            )


def _sample_regulation_notice_bundle() -> list[dict[str, object]]:
    bundle = copy.deepcopy(_sample_notice_bundle())
    record = bundle[0]
    record["notice_id"] = 187233
    notice = record["notice"]
    if not isinstance(notice, dict):
        raise AssertionError("sample notice must contain notice object")
    notice["notice_id"] = 187233
    notice["notice_title"] = "关于修订《中央民族大学采购工作管理办法》的通知"
    notice["organization_name"] = "国有资产管理处"
    notice["notice_release_time"] = "2021-02-28 16:09"
    notice["notice_content"] = (
        "<h1>关于修订《中央民族大学采购工作管理办法》的通知</h1>"
        "<p>学校各单位：</p>"
        "<p>现将修订后的《中央民族大学采购工作管理办法》予以发布。</p>"
        "<p>第一条 为规范学校采购工作，制定本办法。</p>"
        "<p>第二条 本办法自2021年3月1日起施行。</p>"
    )
    notice["notice_link"] = "https://portal.example.edu/notice/187233"
    for category in notice.get("categories") or ():
        if isinstance(category, dict):
            category["notice_id"] = 187233
            category["notice_type"] = "6"
            category["notice_type_name"] = "行政通知"
    record["links"] = []
    record["notice_attachments"] = []
    record["attachments"] = []
    return bundle


if __name__ == "__main__":
    unittest.main()
