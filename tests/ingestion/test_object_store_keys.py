from __future__ import annotations

import unittest

from campus_ingestion_core.object_store import (
    build_document_artifact_key,
    build_official_web_run_artifact_key,
    build_reader_asset_artifact_key,
)


class ObjectStoreKeyBuilderTest(unittest.TestCase):
    def test_build_regulation_document_artifact_key_uses_current_document_path_contract(
        self,
    ) -> None:
        key = build_document_artifact_key(
            corpus="regulations",
            collection="institutional_rules",
            document_id="institutional_regulation:muc:中央民族大学党建经费管理办法:b77c7a48bd4e",
            revision_track="current-effective",
            version_id="sha256:sample",
            filename="canonical.md",
            title="中央民族大学党建经费管理办法",
            year=None,
        )

        self.assertEqual(
            key,
            "regulations/documents/institutional_rules/"
            "中央民族大学党建经费管理办法--b77c7a48/"
            "current-effective/undated/canonical.md",
        )

    def test_build_reader_asset_artifact_key_uses_document_prefix(self) -> None:
        key = build_reader_asset_artifact_key(
            corpus="curriculum",
            collection="curriculum_plan",
            document_id="curriculum:law-ethnic-class-program",
            revision_track="current-effective",
            version_id="ver_2026_01",
            asset_name="reader.json",
            title="法学与民族班培养方案",
            year="2026",
        )

        self.assertEqual(
            key,
            "curriculum/documents/curriculum_plan/法学与民族班培养方案--law-ethnic-class-program/current-effective/2026/reader-assets/reader.json",
        )

    def test_build_reader_asset_artifact_key_rejects_unknown_asset_name(self) -> None:
        with self.assertRaisesRegex(ValueError, "unsupported reader asset name"):
            build_reader_asset_artifact_key(
                corpus="curriculum",
                collection="curriculum_plan",
                document_id="curriculum:law-ethnic-class-program",
                revision_track="current-effective",
                version_id="ver_2026_01",
                asset_name="content.json",
                title="法学与民族班培养方案",
                year="2026",
            )

    def test_build_official_web_run_artifact_key_uses_run_namespace(self) -> None:
        key = build_official_web_run_artifact_key(
            site_id="muc_public",
            run_id="owrun_01JQTEST",
            artifact_name="crawl-run.json",
        )

        self.assertEqual(
            key,
            "official_web/muc_public/runs/owrun_01JQTEST/crawl-run.json",
        )


if __name__ == "__main__":
    unittest.main()
