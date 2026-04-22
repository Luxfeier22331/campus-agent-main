from __future__ import annotations

import unittest

from .authenticated_notice_import_test_support import *  # noqa: F401,F403


class AuthenticatedNoticeImportInventoryTest(unittest.TestCase):
    def test_import_authenticated_notice_bundle_records_attachment_owner_expectation_when_relations_are_missing(
        self,
    ) -> None:
        bundle = _sample_notice_bundle()
        bundle[0]["notice"]["notice_title"] = (
            "关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知"
        )
        bundle[0]["notice"]["notice_content"] = (
            "<h1>关于发布《中央民族大学关于学生使用人工智能的指导意见（2026版）》的通知</h1>"
            "<p>各教学单位、各位同学：</p>"
            "<p>现将《中央民族大学关于学生使用人工智能的指导意见（2026版）》予以发布，请遵照执行。</p>"
            "<p>附件：中央民族大学关于学生使用人工智能的指导意见（2026版）</p>"
        )
        bundle[0]["links"] = []
        bundle[0]["notice_attachments"] = []
        bundle[0]["attachments"] = []

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            _write_json(bundle_path, bundle)
            _write_json(manifest_path, _sample_export_manifest())

            result = import_authenticated_notice_bundle(
                AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                )
            )

        imported = result.notice_imports[0]
        notice_manifest = json.loads(
            imported.source_truth_artifacts["source-truth/notice-manifest.json"].decode("utf-8")
        )
        self.assertEqual(notice_manifest["attachment_ref_count"], 0)
        self.assertEqual(notice_manifest["owner_expectation_count"], 1)
        self.assertEqual(imported.source_truth_artifacts["source-truth/attachment-refs.jsonl"], b"")
        owner_expectation = notice_manifest["owner_expectations"][0]
        self.assertEqual(owner_expectation["owner_kind"], "attachment_document")
        self.assertEqual(owner_expectation["relation_type"], "attachment_ref")
        self.assertEqual(
            owner_expectation["owner_title_hint"],
            "中央民族大学关于学生使用人工智能的指导意见（2026版）",
        )
        self.assertIn(
            "附件：中央民族大学关于学生使用人工智能的指导意见（2026版）",
            owner_expectation["evidence_text"],
        )

    def test_import_authenticated_notice_export_preserves_file_release_owner_expectation_in_inventory_snapshot(
        self,
    ) -> None:
        bundle = _sample_notice_bundle()
        bundle[0]["notice"]["notice_title"] = "关于《中央民族大学差旅费管理办法》发布实施的通知"
        bundle[0]["notice"]["notice_content"] = (
            "<p>各单位、各部门：</p>"
            "<p>为加强学校国内差旅费管理，学校对《中央民族大学差旅费管理办法》进行了修订，现已经审议通过，自2025年7月1日起实施。</p>"
            "<p>修订后的文件见信息门户-文件发布，请各单位自行下载参照执行。</p>"
        )
        bundle[0]["links"] = []
        bundle[0]["notice_attachments"] = []
        bundle[0]["attachments"] = []

        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
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
        self.assertEqual(entries[0].attachment_document_count, 0)
        self.assertEqual(entries[0].parent_snapshot["owner_expectation_count"], 1)
        owner_expectation = entries[0].parent_snapshot["owner_expectations"][0]
        self.assertEqual(owner_expectation["owner_kind"], "file_release_document")
        self.assertEqual(owner_expectation["relation_type"], "file_release_ref")
        self.assertEqual(owner_expectation["owner_title_hint"], "中央民族大学差旅费管理办法")
        self.assertIn("信息门户-文件发布", owner_expectation["evidence_text"])

    def test_import_authenticated_notice_export_builds_inventory_store_from_management_env(
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
            env = {
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL": "postgresql://example.test/management",
            }

            with patch(
                "campus_ingestion_core.authenticated_notice_import.build_authenticated_notice_source_truth_inventory_store_from_env",
                return_value=inventory_store,
            ) as build_inventory_store:
                report = import_authenticated_notice_export(
                    request=AuthenticatedNoticeImportRequest(
                        bundle_path=bundle_path,
                        export_manifest_path=manifest_path,
                        site_id="muc_internal_portal",
                        source_home_url="https://portal.example.edu/home",
                    ),
                    env=env,
                    object_store=object_store,
                    document_registry=document_registry,
                    raw_asset_registry=raw_asset_registry,
                )

        self.assertEqual(report["errors"], [])
        build_inventory_store.assert_called_once_with(env, prefer_operator=True)
        entries = inventory_store.list_by_scope("campus_notices", "internal_notice")
        self.assertEqual(len(entries), 1)
        self.assertEqual(entries[0].notice_id, "355119")

    def test_import_authenticated_notice_bundle_prefers_collector_export_contract_version(
        self,
    ) -> None:
        manifest = _sample_export_manifest()
        manifest["schema_version"] = "authenticated_notice_legacy_bootstrap_normalized_v1"
        manifest["collector"] = {
            "runtime_shell": "legacy_external_collector",
            "export_contract_version": "legacy_authenticated_notice_export_v3",
        }
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            _write_json(bundle_path, _sample_notice_bundle())
            _write_json(manifest_path, manifest)

            result = import_authenticated_notice_bundle(
                AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                )
            )

        imported = result.notice_imports[0]
        notice_manifest = json.loads(
            imported.source_truth_artifacts["source-truth/notice-manifest.json"].decode("utf-8")
        )
        self.assertEqual(
            notice_manifest["fetcher_version"],
            "authenticated_notice_legacy_bootstrap_normalized_v1",
        )
        self.assertEqual(
            notice_manifest["collector_version"],
            "legacy_authenticated_notice_export_v3",
        )

    def test_import_authenticated_notice_bundle_supports_reference_only_attachment_refs(
        self,
    ) -> None:
        bundle = _sample_notice_bundle()
        bundle[0]["notice"]["notice_content"] = (
            '<p>请下载<a href="https://portal.example.edu/files/application.docx">报名表.docx</a>。</p>'
        )
        bundle[0]["links"] = [
            {
                "id": 1,
                "notice_id": 355119,
                "run_id": None,
                "source": "content",
                "content_kind": "attachment_list",
                "url": "https://portal.example.edu/files/application.docx",
                "url_scheme": "https",
                "link_host": "portal.example.edu",
                "link_scope": "internal",
                "collect_policy": "reference_only",
                "skip_reason": None,
                "link_text": "报名表.docx",
                "final_url": "https://portal.example.edu/files/application.docx",
                "title": None,
                "status_code": None,
                "content_type": None,
                "downloaded": False,
                "download_path": None,
                "file_size": None,
                "fetched_at": "2026-04-02T23:58:26.053Z",
                "error_message": None,
            }
        ]
        bundle[0]["notice_attachments"] = [
            {
                "notice_id": 355119,
                "attachment_id": 1,
                "link_id": 1,
                "relation_source": "content",
                "resource_role": "attachment",
                "anchor_text": "报名表.docx",
                "discovered_at": "2026-04-02T23:58:26.053Z",
            }
        ]
        bundle[0]["attachments"] = [
            {
                "attachment_id": 1,
                "source_url": "https://portal.example.edu/files/application.docx",
                "normalized_source_url": "https://portal.example.edu/files/application.docx",
                "final_url": "https://portal.example.edu/files/application.docx",
                "original_filename": "application.docx",
                "mime_type": None,
                "byte_size": None,
                "sha256": None,
                "storage_provider": "reference_only",
                "bucket": None,
                "object_key": None,
                "etag": None,
                "version_id": None,
                "origin_url_scheme": "https",
                "origin_host": "portal.example.edu",
                "origin_scope": "internal",
                "provenance_status": "reference_only",
                "ingest_status": "reference_only",
                "local_path": None,
                "downloaded_at": None,
                "uploaded_at": None,
                "last_error": None,
                "created_at": "2026-04-02T23:58:26.053Z",
                "updated_at": "2026-04-02T23:58:26.053Z",
            }
        ]
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            _write_json(bundle_path, bundle)
            _write_json(manifest_path, _sample_export_manifest())

            result = import_authenticated_notice_bundle(
                AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                )
            )

        imported = result.notice_imports[0]
        attachment_refs = [
            json.loads(line)
            for line in imported.source_truth_artifacts["source-truth/attachment-refs.jsonl"]
            .decode("utf-8")
            .splitlines()
            if line.strip()
        ]
        self.assertEqual(len(attachment_refs), 1)
        self.assertIsNone(attachment_refs[0]["object_key"])
        self.assertEqual(
            attachment_refs[0]["normalized_source_url"],
            "https://portal.example.edu/files/application.docx",
        )
        self.assertEqual(attachment_refs[0]["resource_role"], "attachment")
