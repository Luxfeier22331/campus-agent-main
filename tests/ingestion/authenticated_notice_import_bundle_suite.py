from __future__ import annotations

import unittest

from .authenticated_notice_import_test_support import *  # noqa: F401,F403


class AuthenticatedNoticeImportBundleTest(unittest.TestCase):
    def test_import_authenticated_notice_bundle_builds_source_truth_and_restricted_document_input(
        self,
    ) -> None:
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
        self.assertEqual(
            imported.raw_asset_id, "asset:authenticated-notice:muc_internal_portal:355119"
        )

        version_payload = json.dumps(
            {
                "title": "关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知",
                "html": (
                    "<h1>关于开放2025年度拔尖创新人才“证书项目”第二轮报名的通知</h1>"
                    "<p>请同学们于4月10日前完成报名。</p>"
                    "<p>附件1：报名表.docx</p>"
                ),
                "categories": [("6", "教学通知")],
                "attachments": [
                    ("https://portal.example.edu/files/application.docx", "attachment")
                ],
            },
            ensure_ascii=False,
            sort_keys=True,
        ).encode("utf-8")
        expected_version = f"sha256:{hashlib.sha256(version_payload).hexdigest()}"
        self.assertEqual(imported.raw_version_id, expected_version)

        manifest = json.loads(
            imported.source_truth_artifacts["source-truth/notice-manifest.json"].decode("utf-8")
        )
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
            for line in imported.source_truth_artifacts["source-truth/content-blocks.jsonl"]
            .decode("utf-8")
            .splitlines()
            if line.strip()
        ]
        self.assertEqual(content_blocks[0]["block_role"], "title")
        self.assertIn(
            "请同学们于4月10日前完成报名。", [row["text_normalized"] for row in content_blocks]
        )

        attachment_refs = [
            json.loads(line)
            for line in imported.source_truth_artifacts["source-truth/attachment-refs.jsonl"]
            .decode("utf-8")
            .splitlines()
            if line.strip()
        ]
        self.assertEqual(len(attachment_refs), 1)
        self.assertEqual(attachment_refs[0]["resource_role"], "attachment")
        self.assertEqual(attachment_refs[0]["original_filename"], "application.docx")
        self.assertEqual(
            attachment_refs[0]["object_key"],
            "authenticated_notice_portal/attachment-5e7a0c7675fc/2026/sha256/5e7a0c7675fc8dfe814e74ed3206dd461b7cac88f324a6436dfd490b2f6dd152/capture/application.docx",
        )
        attachment_observations = [
            json.loads(line)
            for line in imported.provider_artifacts["provider/attachment-observations.jsonl"]
            .decode("utf-8")
            .splitlines()
            if line.strip()
        ]
        self.assertEqual(len(attachment_observations), 1)
        self.assertEqual(
            attachment_observations[0]["object_key"],
            "authenticated_notice_portal/attachment-5e7a0c7675fc/2026/sha256/5e7a0c7675fc8dfe814e74ed3206dd461b7cac88f324a6436dfd490b2f6dd152/capture/application.docx",
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
        document_units = [
            json.loads(line)
            for line in document.document_units_bytes.decode("utf-8").splitlines()
            if line.strip()
        ]
        self.assertNotIn("attachment_ref", [row["unit_type"] for row in document_units])
        canonical_markdown = document.canonical_markdown_bytes.decode("utf-8")
        self.assertNotIn("## 附件", canonical_markdown)
        self.assertTrue(
            any(
                key.endswith("/source-truth/notice-manifest.json")
                for key in document.additional_processed_object_keys
            )
        )
        self.assertTrue(
            str(document.provider_response_object_key).endswith(
                "/provider/bundle-import-v1/normalized-notice.json"
            )
        )
        self.assertNotIn("document-units.jsonl", document.additional_processed_object_keys)
        self.assertNotIn(
            "provider/normalized-notice.json", document.additional_processed_object_keys
        )

    def test_import_authenticated_notice_export_persists_source_artifacts_and_restricted_registry_records(
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
        self.assertEqual(
            raw_records[0].raw_asset_id, "asset:authenticated-notice:muc_internal_portal:355119"
        )
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
        self.assertTrue(
            any(
                key.endswith("/provider/bundle-import-v1/normalized-notice.json")
                for key in document_records[0].processed_object_keys
            )
        )
        self.assertNotIn("document-units.jsonl", document_records[0].processed_object_keys)
        self.assertNotIn(
            "provider/normalized-notice.json", document_records[0].processed_object_keys
        )

        uploaded_keys = {entry["key"] for entry in object_store.uploads}
        self.assertTrue(any(key.endswith("/capture/detail-response.json") for key in uploaded_keys))
        self.assertTrue(
            any(key.endswith("/source-truth/notice-manifest.json") for key in uploaded_keys)
        )
        self.assertTrue(any(key.endswith("/document-units.jsonl") for key in uploaded_keys))
