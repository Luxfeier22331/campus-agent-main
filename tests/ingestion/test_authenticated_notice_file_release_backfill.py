from __future__ import annotations

import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.authenticated_notice_file_release_inventory import (
    InMemoryAuthenticatedNoticeFileReleaseInventoryStore,
)
from campus_ingestion_core.authenticated_notice_file_release_inventory_backfill import (
    AuthenticatedNoticeFileReleaseInventoryBackfillRequest,
    backfill_authenticated_notice_file_release_inventory,
    inventory_entry_from_file_release_bundle_record,
)

from tests.ingestion.test_authenticated_notice_file_release_owner_recovery import (
    _bundle_record,
    _export_manifest,
)
from tests.support.in_memory_registry import InMemoryRawAssetRegistry


def _write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


class AuthenticatedNoticeFileReleaseBackfillTest(unittest.TestCase):
    def test_backfill_full_export_replaces_scope_and_upserts_raw_assets(self) -> None:
        bundle = (
            _bundle_record(
                file_release_id=646,
                filename="中央民族大学差旅费管理办法.pdf",
            ),
            _bundle_record(
                file_release_id=647,
                filename="中央民族大学合同管理办法.pdf",
            ),
        )
        manifest = _export_manifest()

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "file-releases-bundle.json"
            manifest_path = root / "file-releases-manifest.json"
            _write_json(bundle_path, list(bundle))
            _write_json(manifest_path, manifest)

            inventory_store = InMemoryAuthenticatedNoticeFileReleaseInventoryStore()
            inventory_store.upsert_many(
                (
                    inventory_entry_from_file_release_bundle_record(
                        record=_bundle_record(
                            file_release_id=700,
                            filename="旧制度.pdf",
                        ),
                        export_scope="old-export",
                        site_id="muc_internal_portal",
                        source_home_url="https://portal.example.edu/",
                        collector_contract_version="authenticated_notice_file_release_export_v1",
                    ),
                )
            )
            raw_asset_registry = InMemoryRawAssetRegistry()

            report = backfill_authenticated_notice_file_release_inventory(
                request=AuthenticatedNoticeFileReleaseInventoryBackfillRequest(
                    bundle_path=bundle_path,
                    manifest_path=manifest_path,
                ),
                inventory_store=inventory_store,
                raw_asset_registry=raw_asset_registry,
            )

        self.assertFalse(report.targeted_upsert)
        self.assertEqual(report.inventory_upsert_count, 2)
        self.assertEqual(report.raw_asset_upsert_count, 2)
        self.assertEqual(
            [
                item.file_release_id
                for item in inventory_store.list_by_scope("campus_notices", "file_release_capture")
            ],
            [646, 647],
        )
        self.assertEqual(
            len(raw_asset_registry.list_by_scope("campus_notices", "file_release_capture")),
            2,
        )

    def test_backfill_targeted_export_upserts_without_replacing_existing_scope(self) -> None:
        bundle = (
            _bundle_record(
                file_release_id=646,
                filename="中央民族大学差旅费管理办法.pdf",
            ),
        )
        manifest = _export_manifest()
        manifest["export_scope"] = "file-release-target-646-20260421T121246Z"
        manifest["filters"]["target_file_release_id"] = 646

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "file-releases-bundle.json"
            manifest_path = root / "file-releases-manifest.json"
            _write_json(bundle_path, list(bundle))
            _write_json(manifest_path, manifest)

            inventory_store = InMemoryAuthenticatedNoticeFileReleaseInventoryStore()
            inventory_store.upsert_many(
                (
                    inventory_entry_from_file_release_bundle_record(
                        record=_bundle_record(
                            file_release_id=700,
                            filename="旧制度.pdf",
                        ),
                        export_scope="old-export",
                        site_id="muc_internal_portal",
                        source_home_url="https://portal.example.edu/",
                        collector_contract_version="authenticated_notice_file_release_export_v1",
                    ),
                )
            )
            raw_asset_registry = InMemoryRawAssetRegistry()

            report = backfill_authenticated_notice_file_release_inventory(
                request=AuthenticatedNoticeFileReleaseInventoryBackfillRequest(
                    bundle_path=bundle_path,
                    manifest_path=manifest_path,
                ),
                inventory_store=inventory_store,
                raw_asset_registry=raw_asset_registry,
            )

        self.assertTrue(report.targeted_upsert)
        self.assertEqual(
            [
                item.file_release_id
                for item in inventory_store.list_by_scope("campus_notices", "file_release_capture")
            ],
            [646, 700],
        )
        self.assertEqual(
            len(raw_asset_registry.list_by_scope("campus_notices", "file_release_capture")),
            1,
        )

    def test_backfill_reference_only_row_does_not_create_raw_asset_record(self) -> None:
        bundle = (
            _bundle_record(
                file_release_id=646,
                filename="中央民族大学差旅费管理办法.pdf",
                storage_provider="reference_only",
                bucket=None,
                object_key=None,
                sha256=None,
                ingest_status="reference_only",
                provenance_status="reference_only",
            ),
        )
        manifest = _export_manifest()
        manifest["collector"]["file_storage_mode"] = "reference_only"

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "file-releases-bundle.json"
            manifest_path = root / "file-releases-manifest.json"
            _write_json(bundle_path, list(bundle))
            _write_json(manifest_path, manifest)

            inventory_store = InMemoryAuthenticatedNoticeFileReleaseInventoryStore()
            raw_asset_registry = InMemoryRawAssetRegistry()

            report = backfill_authenticated_notice_file_release_inventory(
                request=AuthenticatedNoticeFileReleaseInventoryBackfillRequest(
                    bundle_path=bundle_path,
                    manifest_path=manifest_path,
                ),
                inventory_store=inventory_store,
                raw_asset_registry=raw_asset_registry,
            )

        self.assertEqual(report.inventory_upsert_count, 1)
        self.assertEqual(report.raw_asset_upsert_count, 0)
        self.assertEqual(
            len(raw_asset_registry.list_by_scope("campus_notices", "file_release_capture")),
            0,
        )

    def test_backfill_fails_when_object_store_manifest_row_is_missing_locator(self) -> None:
        bundle = (
            _bundle_record(
                file_release_id=646,
                filename="中央民族大学差旅费管理办法.pdf",
                bucket=None,
                object_key=None,
                sha256=None,
            ),
        )
        manifest = _export_manifest()

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "file-releases-bundle.json"
            manifest_path = root / "file-releases-manifest.json"
            _write_json(bundle_path, list(bundle))
            _write_json(manifest_path, manifest)

            with self.assertRaisesRegex(
                ValueError,
                "object_store_write",
            ):
                backfill_authenticated_notice_file_release_inventory(
                    request=AuthenticatedNoticeFileReleaseInventoryBackfillRequest(
                        bundle_path=bundle_path,
                        manifest_path=manifest_path,
                    ),
                    inventory_store=InMemoryAuthenticatedNoticeFileReleaseInventoryStore(),
                    raw_asset_registry=InMemoryRawAssetRegistry(),
                )


if __name__ == "__main__":
    unittest.main()
