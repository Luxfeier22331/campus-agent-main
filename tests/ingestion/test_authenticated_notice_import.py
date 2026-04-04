from __future__ import annotations

import hashlib
import json
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION
from campus_ingestion_core.authenticated_notice_import import (
    AuthenticatedNoticeImportRequest,
    import_authenticated_notice_bundle,
    import_authenticated_notice_export,
)
from tests.support.in_memory_registry import InMemoryDocumentRegistry, InMemoryRawAssetRegistry


def _write_json(path: Path, payload: object) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")


def _sample_notice_bundle() -> list[dict[str, object]]:
    return [
        {
            "notice_id": 355119,
            "notice": {
                "notice_id": 355119,
                "notice_title": "关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知",
                "organization_name": "教务处",
                "organization_id": "00001",
                "notice_release_time": "2026-04-02 18:49",
                "notice_create_time": "2026-04-02 18:40",
                "notice_first_time": "2026-04-02 18:40",
                "notice_content": (
                    "<h1>关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知</h1>"
                    "<p>请同学们于4月10日前完成报名。</p>"
                    "<p>附件1：报名表.docx</p>"
                ),
                "notice_link": "https://portal.example.edu/notice/355119",
                "notice_source": 1,
                "notice_link_state": 0,
                "notice_state": 1,
                "notice_stick": 0,
                "categories": [
                    {
                        "notice_id": 355119,
                        "notice_type": "6",
                        "notice_type_name": "教学通知",
                        "category_first_seen_at": "2026-04-02T18:49:00.000Z",
                        "category_last_seen_at": "2026-04-02T18:49:00.000Z",
                        "category_last_run_id": 14,
                    }
                ],
            },
            "links": [
                {
                    "id": 34,
                    "notice_id": 355119,
                    "run_id": 14,
                    "source": "content",
                    "content_kind": "attachment_list",
                    "url": "https://portal.example.edu/files/application.docx",
                    "url_scheme": "https",
                    "link_host": "portal.example.edu",
                    "link_scope": "internal",
                    "collect_policy": "fetch",
                    "skip_reason": None,
                    "link_text": "报名表.docx",
                    "final_url": "https://portal.example.edu/files/application.docx",
                    "title": None,
                    "status_code": 200,
                    "content_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "downloaded": True,
                    "download_path": None,
                    "file_size": 15905,
                    "fetched_at": "2026-04-02T23:58:26.053Z",
                    "error_message": None,
                }
            ],
            "notice_attachments": [
                {
                    "notice_id": 355119,
                    "attachment_id": 1,
                    "link_id": 34,
                    "relation_source": "content",
                    "resource_role": "attachment",
                    "anchor_text": "报名表.docx",
                    "discovered_at": "2026-04-02T23:58:26.053Z",
                }
            ],
            "attachments": [
                {
                    "attachment_id": 1,
                    "source_url": "https://portal.example.edu/files/application.docx",
                    "normalized_source_url": "https://portal.example.edu/files/application.docx",
                    "final_url": "https://portal.example.edu/files/application.docx",
                    "original_filename": "application.docx",
                    "mime_type": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                    "byte_size": 15905,
                    "sha256": "5e7a0c7675fc8dfe814e74ed3206dd461b7cac88f324a6436dfd490b2f6dd152",
                    "storage_provider": "local",
                    "bucket": None,
                    "object_key": "5e/5e7a0c7675fc8dfe814e74ed3206dd461b7cac88f324a6436dfd490b2f6dd152/application.docx",
                    "etag": None,
                    "version_id": None,
                    "origin_url_scheme": "https",
                    "origin_host": "portal.example.edu",
                    "origin_scope": "internal",
                    "provenance_status": "collected_internal",
                    "ingest_status": "downloaded",
                    "local_path": None,
                    "downloaded_at": "2026-04-02T23:58:26.053Z",
                    "uploaded_at": None,
                    "last_error": None,
                    "created_at": "2026-04-02T23:58:26.053Z",
                    "updated_at": "2026-04-02T23:58:26.053Z",
                }
            ],
        }
    ]


def _sample_export_manifest() -> dict[str, object]:
    return {
        "schema_version": "v3",
        "exported_at": "2026-04-02T23:59:19.838Z",
        "export_date": "20260403",
        "export_scope": "run-14",
        "filters": {
            "run_id": 14,
            "since": None,
            "until": None,
        },
        "run": {
            "id": 14,
            "mode": "backfill",
            "status": "success",
            "started_at": "2026-04-02T23:50:17.023Z",
            "finished_at": "2026-04-02T23:57:57.563Z",
            "pages_fetched": 337,
            "items_seen": 6694,
            "items_inserted": 6454,
            "items_updated": 0,
            "errors": 0,
            "error_message": None,
        },
    }


class _FakeObjectStore:
    def __init__(self) -> None:
        self.uploads: list[dict[str, object]] = []
        self.objects: dict[tuple[str, str], bytes] = {}

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self.uploads.append(
            {
                "bucket": bucket,
                "key": key,
                "content_type": content_type,
            }
        )
        self.objects[(bucket, key)] = data

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]


class AuthenticatedNoticeImportTest(unittest.TestCase):
    def test_import_authenticated_notice_bundle_builds_source_truth_and_restricted_document_input(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            _write_json(bundle_path, _sample_notice_bundle())
            _write_json(manifest_path, _sample_export_manifest())

            result = import_authenticated_notice_bundle(
                AuthenticatedNoticeImportRequest(
                    bundle_path=bundle_path,
                    export_manifest_path=manifest_path,
                    site_id="muc_internal_portal",
                    source_home_url="https://portal.example.edu/home",
                )
            )

        self.assertEqual(result.notice_count, 1)
        self.assertEqual(len(result.notice_imports), 1)
        imported = result.notice_imports[0]
        self.assertEqual(imported.raw_asset_id, "asset:authenticated-notice:muc_internal_portal:355119")

        version_payload = json.dumps(
            {
                "title": "关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知",
                "html": (
                    "<h1>关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知</h1>"
                    "<p>请同学们于4月10日前完成报名。</p>"
                    "<p>附件1：报名表.docx</p>"
                ),
                "categories": [("6", "教学通知")],
                "attachments": [("https://portal.example.edu/files/application.docx", "attachment")],
            },
            ensure_ascii=False,
            sort_keys=True,
        ).encode("utf-8")
        expected_version = f"sha256:{hashlib.sha256(version_payload).hexdigest()}"
        self.assertEqual(imported.raw_version_id, expected_version)

        manifest = json.loads(imported.source_truth_artifacts["source-truth/notice-manifest.json"].decode("utf-8"))
        self.assertEqual(manifest["source_channel"], "authenticated_notice_portal")
        self.assertEqual(manifest["site_id"], "muc_internal_portal")
        self.assertEqual(manifest["notice_id"], "355119")
        self.assertEqual(manifest["raw_asset_id"], imported.raw_asset_id)
        self.assertEqual(manifest["raw_version_id"], imported.raw_version_id)
        self.assertEqual(manifest["notice_type_ids"], ["6"])
        self.assertEqual(manifest["notice_type_names"], ["教学通知"])
        self.assertEqual(manifest["attachment_ref_count"], 1)
        self.assertEqual(manifest["link_count"], 1)
        self.assertEqual(manifest["source_home_url"], "https://portal.example.edu/home")

        content_blocks = [
            json.loads(line)
            for line in imported.source_truth_artifacts["source-truth/content-blocks.jsonl"].decode("utf-8").splitlines()
            if line.strip()
        ]
        self.assertEqual(content_blocks[0]["block_role"], "title")
        self.assertIn("请同学们于4月10日前完成报名。", [row["text_normalized"] for row in content_blocks])

        attachment_refs = [
            json.loads(line)
            for line in imported.source_truth_artifacts["source-truth/attachment-refs.jsonl"].decode("utf-8").splitlines()
            if line.strip()
        ]
        self.assertEqual(len(attachment_refs), 1)
        self.assertEqual(attachment_refs[0]["resource_role"], "attachment")
        self.assertEqual(
            attachment_refs[0]["object_key"],
            "5e/5e7a0c7675fc8dfe814e74ed3206dd461b7cac88f324a6436dfd490b2f6dd152/application.docx",
        )

        document = imported.document_import
        self.assertEqual(document.source_channel, "authenticated_notice_portal")
        self.assertEqual(document.corpus, "campus_notices")
        self.assertEqual(document.collection, "internal_notice")
        self.assertEqual(document.revision_track, "source-faithful")
        self.assertEqual(document.raw_asset_id, imported.raw_asset_id)
        self.assertEqual(document.raw_version_id, imported.raw_version_id)
        self.assertEqual(document.metadata["document_id"], "notice:muc_internal_portal:355119")
        self.assertEqual(document.metadata["version_id"], imported.raw_version_id)
        self.assertEqual(document.metadata["visibility_level"], "restricted")
        self.assertEqual(document.metadata["visibility_scope"], "campus")
        self.assertEqual(document.metadata["entitlement_groups"], ["campus_members"])
        self.assertEqual(
            document.metadata["policy_projection_version"],
            DEFAULT_POLICY_PROJECTION_VERSION,
        )
        self.assertIn("document-units.jsonl", document.additional_processed_object_keys)
        self.assertIn("source-truth/notice-manifest.json", document.additional_processed_object_keys)

    def test_import_authenticated_notice_export_persists_source_artifacts_and_restricted_registry_records(self) -> None:
        with TemporaryDirectory() as temp_dir:
            root = Path(temp_dir)
            bundle_path = root / "notices-bundle.json"
            manifest_path = root / "export-manifest.json"
            _write_json(bundle_path, _sample_notice_bundle())
            _write_json(manifest_path, _sample_export_manifest())

            object_store = _FakeObjectStore()
            document_registry = InMemoryDocumentRegistry(backing_path=root / "registry" / "documents.json")
            raw_asset_registry = InMemoryRawAssetRegistry(backing_path=root / "registry" / "raw-assets.json")
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
            )

        self.assertEqual(report["notice_count"], 1)
        self.assertEqual(report["created_document_ids"], ["notice:muc_internal_portal:355119"])
        self.assertEqual(report["errors"], [])

        raw_records = raw_asset_registry.list_by_scope("campus_notices", "internal_notice")
        self.assertEqual(len(raw_records), 1)
        self.assertEqual(raw_records[0].raw_asset_id, "asset:authenticated-notice:muc_internal_portal:355119")
        self.assertEqual(raw_records[0].object_key.split("/")[-1], "detail-response.json")

        document_records = document_registry.list_by_scope("campus_notices", "internal_notice")
        self.assertEqual(len(document_records), 1)
        self.assertEqual(document_records[0].document_id, "notice:muc_internal_portal:355119")
        self.assertEqual(document_records[0].source_channel, "authenticated_notice_portal")
        self.assertEqual(document_records[0].visibility_level, "restricted")
        self.assertEqual(document_records[0].entitlement_groups, ("campus_members",))
        self.assertTrue(
            any(
                key.endswith("/source-truth/notice-manifest.json")
                for key in document_records[0].processed_object_keys
            )
        )

        uploaded_keys = {entry["key"] for entry in object_store.uploads}
        self.assertTrue(any(key.endswith("/capture/detail-response.json") for key in uploaded_keys))
        self.assertTrue(any(key.endswith("/source-truth/notice-manifest.json") for key in uploaded_keys))
        self.assertTrue(any(key.endswith("/document-units.jsonl") for key in uploaded_keys))

    def test_import_authenticated_notice_bundle_supports_reference_only_attachment_refs(self) -> None:
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
            for line in imported.source_truth_artifacts["source-truth/attachment-refs.jsonl"].decode("utf-8").splitlines()
            if line.strip()
        ]
        self.assertEqual(len(attachment_refs), 1)
        self.assertIsNone(attachment_refs[0]["object_key"])
        self.assertEqual(
            attachment_refs[0]["normalized_source_url"],
            "https://portal.example.edu/files/application.docx",
        )
        self.assertEqual(attachment_refs[0]["resource_role"], "attachment")


if __name__ == "__main__":
    unittest.main()
