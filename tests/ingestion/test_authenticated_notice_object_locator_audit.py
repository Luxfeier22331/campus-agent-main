from __future__ import annotations

import hashlib
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

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
from campus_ingestion_core.authenticated_notice_object_locator_audit import (
    AuthenticatedNoticeObjectLocatorAuditRequest,
    audit_authenticated_notice_object_locators,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    InMemoryAuthenticatedNoticeSourceTruthInventoryStore,
)

from tests.ingestion.authenticated_notice_import_test_support import (
    _FakeObjectStore,
    _sample_export_manifest,
    _sample_notice_bundle,
    _write_json,
)
from tests.ingestion.test_authenticated_notice_file_release_owner_recovery import (
    _bundle_record,
)
from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry


class AuthenticatedNoticeObjectLocatorAuditTest(unittest.TestCase):
    def test_audit_reports_missing_notice_source_truth_artifact_without_writes(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            _write_json(bundle_path, _sample_notice_bundle())
            _write_json(manifest_path, _sample_export_manifest())

            object_store = _FakeObjectStore()
            inventory_store = InMemoryAuthenticatedNoticeSourceTruthInventoryStore()
            import_authenticated_notice_export(
                request=AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="example_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                    allow_local_fixture_import=True,
                    mode="admit_and_materialize",
                    source_truth_only=True,
                ),
                env={
                    "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                    "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                    "OBJECT_STORE_SECRET_KEY": "minioadmin",
                },
                object_store=object_store,
                document_registry=InMemoryDocumentRegistry(),
                raw_asset_registry=InMemoryRawAssetRegistry(),
                source_truth_inventory_store=inventory_store,
            )
            inventory_entry = inventory_store.list_by_scope(
                "campus_notices",
                "internal_notice",
            )[0]
            missing_key = inventory_entry.notice_manifest_key
            object_store.delete_object(bucket="campus-agent-source", key=missing_key)
            object_store.uploads.clear()

            report = audit_authenticated_notice_object_locators(
                request=AuthenticatedNoticeObjectLocatorAuditRequest(
                    source_bucket="campus-agent-source",
                    notice_ids=("355119",),
                ),
                object_store=object_store,
                source_truth_inventory_store=inventory_store,
                file_release_inventory_store=InMemoryAuthenticatedNoticeFileReleaseInventoryStore(),
            )

        missing_rows = [row for row in report["rows"] if row["status"] == "missing_object"]
        self.assertEqual(len(missing_rows), 1)
        self.assertEqual(missing_rows[0]["object_key"], missing_key)
        self.assertEqual(missing_rows[0]["reason_code"], "missing_source_artifact")
        self.assertEqual(report["missing_object_count"], 1)
        self.assertEqual(object_store.uploads, [])

    def test_audit_reports_file_release_source_bytes_health(self) -> None:
        source_bytes = b"%PDF-1.4\nfile release source\n"
        source_sha256 = hashlib.sha256(source_bytes).hexdigest()
        ready_record = _bundle_record(
            file_release_id=646,
            filename="示例大学差旅费管理办法.pdf",
            sha256=source_sha256,
        )
        ready_record["released_file"]["byte_size"] = len(source_bytes)
        missing_record = _bundle_record(
            file_release_id=647,
            filename="示例大学合同管理办法.pdf",
            object_key=(
                "authenticated_notice_portal/file-release-647/2025/sha256-deadbeef/capture/file.pdf"
            ),
        )
        inventory_store = InMemoryAuthenticatedNoticeFileReleaseInventoryStore()
        inventory_store.upsert_many(
            (
                inventory_entry_from_file_release_bundle_record(
                    record=ready_record,
                    export_scope="file-release-20260412T003300Z",
                    site_id="example_internal_portal",
                    source_home_url="https://portal.example.edu/",
                    collector_contract_version="authenticated_notice_file_release_export_v1",
                ),
                inventory_entry_from_file_release_bundle_record(
                    record=missing_record,
                    export_scope="file-release-20260412T003300Z",
                    site_id="example_internal_portal",
                    source_home_url="https://portal.example.edu/",
                    collector_contract_version="authenticated_notice_file_release_export_v1",
                ),
            )
        )
        object_store = _FakeObjectStore()
        object_store.put_bytes(
            bucket=str(ready_record["released_file"]["bucket"]),
            key=str(ready_record["released_file"]["object_key"]),
            data=source_bytes,
            content_type="application/pdf",
        )
        object_store.uploads.clear()

        report = audit_authenticated_notice_object_locators(
            request=AuthenticatedNoticeObjectLocatorAuditRequest(
                source_bucket="campus-agent-source",
                include_notice=False,
                file_release_ids=(646, 647),
            ),
            object_store=object_store,
            source_truth_inventory_store=InMemoryAuthenticatedNoticeSourceTruthInventoryStore(),
            file_release_inventory_store=inventory_store,
        )

        rows_by_unit_and_status = {(row["unit_id"], row["status"]): row for row in report["rows"]}
        self.assertIn(("646", "verified"), rows_by_unit_and_status)
        self.assertEqual(
            rows_by_unit_and_status[("647", "missing_object")]["reason_code"],
            "missing_source_bytes",
        )
        self.assertEqual(report["verified_object_count"], 1)
        self.assertEqual(report["missing_object_count"], 1)
        self.assertEqual(object_store.uploads, [])

    def test_audit_writes_json_report_when_output_path_is_supplied(self) -> None:
        with TemporaryDirectory() as temp_dir:
            report_path = Path(temp_dir) / "object-locator-audit.json"
            report = audit_authenticated_notice_object_locators(
                request=AuthenticatedNoticeObjectLocatorAuditRequest(
                    source_bucket="campus-agent-source",
                    output_path=report_path,
                ),
                object_store=_FakeObjectStore(),
                source_truth_inventory_store=InMemoryAuthenticatedNoticeSourceTruthInventoryStore(),
                file_release_inventory_store=InMemoryAuthenticatedNoticeFileReleaseInventoryStore(),
            )

            persisted = json.loads(report_path.read_text(encoding="utf-8"))

        self.assertEqual(persisted["schema_version"], report["schema_version"])
        self.assertEqual(persisted["total_locator_count"], 0)


if __name__ == "__main__":
    unittest.main()
