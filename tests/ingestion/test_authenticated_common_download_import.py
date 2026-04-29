from __future__ import annotations

import copy
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.authenticated_common_download_import import (
    AuthenticatedCommonDownloadImportRequest,
    import_authenticated_common_download_export,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)

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


def _common_download_manifest(
    *,
    full_scope_requested: bool = False,
    full_scope_completed: bool = False,
    page_budget_exhausted: bool = False,
) -> dict[str, object]:
    manifest = copy.deepcopy(_sample_export_manifest())
    manifest["schema_version"] = "authenticated_notice_collector_export_v2"
    manifest["source_channel"] = "authenticated_notice_portal"
    manifest["source_surface"] = "notice"
    manifest["full_scope_requested"] = full_scope_requested
    manifest["full_scope_completed"] = full_scope_completed
    manifest["page_budget_exhausted"] = page_budget_exhausted
    manifest["filters"] = {
        "collection_mode": "backfill",
        "max_notices": None,
        "notice_types": ["9982"],
    }
    return manifest


class AuthenticatedCommonDownloadImportTest(unittest.TestCase):
    def test_request_rejects_non_common_download_holding_scope(self) -> None:
        with self.assertRaisesRegex(
            ValueError,
            "authenticated common-download imports must target authenticated_documents/common_download_source",
        ):
            AuthenticatedCommonDownloadImportRequest(
                bundle_path=Path("/tmp/notices-bundle.json"),
                manifest_path=Path("/tmp/export-manifest.json"),
                site_id="muc_internal_portal",
                source_home_url="https://portal.example.edu/",
                corpus="campus_notices",
                collection="internal_notice",
            )

    def test_import_rejects_non_common_download_notice_manifest(self) -> None:
        bundle = _common_download_bundle()
        manifest = _common_download_manifest()
        manifest["filters"] = {
            "collection_mode": "backfill",
            "max_notices": None,
            "notice_types": ["6"],
        }

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            _write_json(bundle_path, bundle)
            _write_json(manifest_path, manifest)

            with self.assertRaisesRegex(
                ValueError,
                "common-download import requires manifest notice_types=\\['9982'\\]",
            ):
                import_authenticated_common_download_export(
                    request=AuthenticatedCommonDownloadImportRequest(
                        bundle_path=bundle_path,
                        manifest_path=manifest_path,
                        site_id="muc_internal_portal",
                        source_home_url="https://portal.example.edu/",
                    ),
                    env={
                        "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                        "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                        "OBJECT_STORE_SECRET_KEY": "minioadmin",
                    },
                    object_store=_FakeObjectStore(),
                    document_registry=InMemoryDocumentRegistry(),
                    raw_asset_registry=InMemoryRawAssetRegistry(),
                    source_truth_inventory_store=InMemoryAuthenticatedNoticeSourceTruthInventoryStore(),
                )

    def test_import_materializes_common_download_holding_scope_and_auto_replaces_full_scope(
        self,
    ) -> None:
        bundle = _common_download_bundle()
        manifest = _common_download_manifest(
            full_scope_requested=True,
            full_scope_completed=True,
        )

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            _write_json(bundle_path, bundle)
            _write_json(manifest_path, manifest)

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

            report = import_authenticated_common_download_export(
                request=AuthenticatedCommonDownloadImportRequest(
                    bundle_path=bundle_path,
                    manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/",
                    mode="admit_and_materialize",
                ),
                env=env,
                object_store=object_store,
                document_registry=document_registry,
                raw_asset_registry=raw_asset_registry,
                source_truth_inventory_store=inventory_store,
            )

        self.assertEqual(report["errors"], [])
        self.assertTrue(report["source_truth_only"])
        self.assertTrue(report["replace_scope"])
        self.assertEqual(report["scope_write_mode"], "replace_scope")
        self.assertEqual(report["selected_notice_ids"], [])
        self.assertEqual(
            report["created_document_ids"],
            ["notice:muc_internal_portal:355119"],
        )
        entries = inventory_store.list_by_scope("authenticated_documents", "common_download_source")
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].notice_id, "355119")
        uploaded_keys = {upload["key"] for upload in object_store.uploads}
        self.assertTrue(
            any(key.endswith("/source-truth/notice-manifest.json") for key in uploaded_keys)
        )


if __name__ == "__main__":
    unittest.main()
