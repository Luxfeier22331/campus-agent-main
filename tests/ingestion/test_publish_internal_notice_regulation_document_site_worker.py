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
from campus_ingestion_core.models import DocumentRegistryRecord
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
            existing_record = _existing_scoped_rule_record()
            document_registry.upsert(existing_record)
            object_store.put_bytes(
                bucket="campus-rag-derived",
                key=existing_record.document_units_object_key or "",
                data=_document_units_jsonl(existing_record, "既有服务管理细则").encode("utf-8"),
                content_type="application/x-ndjson",
            )
            object_store.put_bytes(
                bucket="campus-rag-derived",
                key=existing_record.canonical_markdown_object_key or "",
                data="# 既有服务管理细则\n\n第一条 本细则继续有效。\n".encode(),
                content_type="text/markdown",
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
            self.assertEqual(
                report["target_scope_snapshot_document_counts"],
                {
                    "regulations/institutional_rules": 1,
                    "regulations/scoped_rules": 1,
                },
            )
            self.assertEqual(
                report["reader_publish_scope_document_counts"],
                {"regulations/institutional_rules": 1},
            )
            self.assertEqual(
                report["docs_read_model_scope_write_mode"],
                "replace_manifest_scopes_with_full_current_target_snapshot",
            )
            self.assertEqual(report["docs_only_opened"], True)
            self.assertEqual(report["query_serving_opened"], False)
            self.assertEqual(report["rag_release_opened"], False)

            docs_manifest_path = Path(report["docs_read_model_manifest_path"])
            self.assertTrue(docs_manifest_path.exists())
            docs_manifest = json.loads(docs_manifest_path.read_text(encoding="utf-8"))
            self.assertEqual(len(docs_manifest["documents"]), 1)
            collections_by_scope = {
                f"{collection['corpus']}/{collection['collection']}": collection
                for collection in docs_manifest["collections"]
            }
            self.assertEqual(
                collections_by_scope["regulations/institutional_rules"]["displayName"],
                "校级规章",
            )
            self.assertNotIn("regulations/scoped_rules", collections_by_scope)
            documents_by_title = {
                document["title"]: document for document in docs_manifest["documents"]
            }
            self.assertEqual(
                documents_by_title["中央民族大学采购工作管理办法"]["documentSlug"],
                "中央民族大学采购工作管理办法",
            )
            self.assertEqual(
                documents_by_title["中央民族大学采购工作管理办法"]["canonicalUrl"],
                "/docs/regulations/institutional_rules/中央民族大学采购工作管理办法",
            )
            self.assertNotIn("既有服务管理细则", documents_by_title)
            versions_by_doc_id = {
                version["docId"]: version for version in docs_manifest["documentVersions"]
            }
            self.assertEqual(
                versions_by_doc_id[documents_by_title["中央民族大学采购工作管理办法"]["docId"]][
                    "versionSlug"
                ],
                "effective-2021-03-01",
            )
            self.assertTrue(
                all(
                    version["deliveryMode"] == "gated_asset"
                    for version in docs_manifest["documentVersions"]
                )
            )
            self.assertNotIn(
                "2021年修订",
                "\n".join(
                    str(value)
                    for asset in docs_manifest["readerAssets"]
                    for value in list(asset["sourceObjects"].values())
                    + list(asset["targetObjects"].values())
                ),
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


def _existing_scoped_rule_record() -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id="regulation:scoped:existing-service-rule",
        revision_track="current-effective",
        version_id="ver_existing_service_rule",
        source_uri="campus-agent://regulations/scoped_rules/existing-service-rule",
        content_hash="sha256:existing-service-rule",
        corpus="regulations",
        collection="scoped_rules",
        cleaning_policy_version="internal_notice_regulation_materialization_v1",
        entitlement_groups=("campus_members",),
        visibility_scope="campus",
        visibility_level="restricted",
        status="active",
        ingestion_timestamp="2026-04-28T08:00:00+00:00",
        parser_version="internal_notice_regulation_materialization_v1",
        embedding_model="Qwen3-Embedding-4B",
        source_channel="authenticated_notice_portal",
        is_current=True,
        effective_date="2026-04-01",
        published_date="2026-04-01",
        document_units_object_key=(
            "regulations/documents/scoped_rules/"
            "existing-service-rule--existing/current-effective/2026/document-units.jsonl"
        ),
        canonical_markdown_object_key=(
            "regulations/documents/scoped_rules/"
            "existing-service-rule--existing/current-effective/2026/canonical.md"
        ),
        processed_object_keys=(
            "regulations/documents/scoped_rules/"
            "existing-service-rule--existing/current-effective/2026/document-units.jsonl",
            "regulations/documents/scoped_rules/"
            "existing-service-rule--existing/current-effective/2026/canonical.md",
        ),
        import_source="internal_notice_regulation_document_site_test",
    )


def _document_units_jsonl(record: DocumentRegistryRecord, title: str) -> str:
    rows = [
        {
            "doc_id": record.document_id,
            "version_id": record.version_id,
            "chunk_id": f"{record.document_id}:chunk-001",
            "root_unit_id": f"{record.document_id}:root-001",
            "unit_type": "heading",
            "text": title,
            "anchor": {"section_path": [title], "page_start": 1, "page_end": 1},
            "metadata": {"title": title, "heading_level": 1},
        },
        {
            "doc_id": record.document_id,
            "version_id": record.version_id,
            "chunk_id": f"{record.document_id}:chunk-002",
            "root_unit_id": f"{record.document_id}:root-002",
            "unit_type": "paragraph",
            "text": "第一条 本细则继续有效。",
            "anchor": {"section_path": [title], "page_start": 1, "page_end": 1},
        },
    ]
    return "\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n"


if __name__ == "__main__":
    unittest.main()
