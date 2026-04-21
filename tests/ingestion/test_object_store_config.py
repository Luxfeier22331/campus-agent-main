from __future__ import annotations

import unittest

from botocore.config import Config
from campus_ingestion_core.object_store import (
    S3ObjectStoreClientFactory,
    build_processed_artifact_key,
    build_processed_asset_artifact_key,
    build_raw_asset_key,
    build_source_projection_artifact_key,
    parse_source_object_key,
)
from campus_ingestion_core.settings import ObjectStoreSettings, resolve_object_store_bucket_names


class ObjectStoreConfigTest(unittest.TestCase):
    def test_bucket_scoped_credentials_can_replace_shared_credentials(self) -> None:
        settings = ObjectStoreSettings.from_env(
            {
                "OBJECT_STORE_ENDPOINT": "https://s3.cstcloud.cn",
                "OBJECT_STORE_SOURCE_ACCESS_KEY": "source-ak",
                "OBJECT_STORE_SOURCE_SECRET_KEY": "source-sk",
                "OBJECT_STORE_DERIVED_ACCESS_KEY": "derived-ak",
                "OBJECT_STORE_DERIVED_SECRET_KEY": "derived-sk",
                "OBJECT_STORE_SECURE": "true",
            }
        )

        self.assertEqual(settings.endpoint, "https://s3.cstcloud.cn")
        self.assertTrue(settings.secure)
        self.assertEqual(settings.source_access_key, "source-ak")
        self.assertEqual(settings.source_secret_key, "source-sk")
        self.assertEqual(settings.derived_access_key, "derived-ak")
        self.assertEqual(settings.derived_secret_key, "derived-sk")

    def test_defaults_match_phase1_bucket_contract(self) -> None:
        settings = ObjectStoreSettings.from_env(
            {
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
            }
        )

        self.assertEqual(settings.region, "us-east-1")
        self.assertEqual(settings.bucket_source, "campus-rag-source")
        self.assertEqual(settings.bucket_derived, "campus-rag-derived")
        self.assertFalse(settings.secure)

    def test_legacy_bucket_envs_no_longer_override_source_and_derived_fields(self) -> None:
        settings = ObjectStoreSettings.from_env(
            {
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
                "OBJECT_STORE_BUCKET_RAW": "legacy-raw",
                "OBJECT_STORE_BUCKET_PROCESSED": "legacy-processed",
            }
        )

        self.assertEqual(settings.bucket_source, "campus-rag-source")
        self.assertEqual(settings.bucket_derived, "campus-rag-derived")

    def test_bucket_name_resolution_ignores_legacy_envs_without_full_settings(self) -> None:
        bucket_source, bucket_derived = resolve_object_store_bucket_names(
            {
                "OBJECT_STORE_BUCKET_RAW": "legacy-raw",
                "OBJECT_STORE_BUCKET_PROCESSED": "legacy-processed",
            }
        )

        self.assertEqual(bucket_source, "campus-rag-source")
        self.assertEqual(bucket_derived, "campus-rag-derived")

    def test_rejects_local_directory_fallback_endpoint(self) -> None:
        with self.assertRaises(ValueError):
            ObjectStoreSettings.from_env(
                {
                    "OBJECT_STORE_ENDPOINT": "/tmp/minio",
                    "OBJECT_STORE_ACCESS_KEY": "key",
                    "OBJECT_STORE_SECRET_KEY": "secret",
                }
            )

    def test_build_processed_artifact_key_uses_document_namespace(self) -> None:
        object_key = build_processed_artifact_key(
            corpus="regulations",
            collection="student_handbook",
            document_id="handbook:test-001",
            revision_track="source-faithful",
            version_id="v1:test-001",
            filename="document-units.jsonl",
        )

        self.assertEqual(
            object_key,
            "regulations/documents/student_handbook/test-001--test-001/source-faithful/undated/document-units.jsonl",
        )

    def test_build_raw_asset_key_uses_asset_namespace(self) -> None:
        object_key = build_raw_asset_key(
            corpus="regulations",
            raw_asset_id="asset:student-handbook-pdf",
            raw_version_id="sha256:raw-001",
            filename="student-handbook.pdf",
        )

        self.assertEqual(
            object_key,
            "official_pdf/student-handbook/undated/sha256/raw-001/capture/student-handbook.pdf",
        )

    def test_build_processed_artifact_key_supports_curriculum_plan(self) -> None:
        object_key = build_processed_artifact_key(
            corpus="curriculum",
            collection="curriculum_plan",
            document_id="curriculum:plan-001",
            revision_track="source-faithful",
            version_id="sha256:raw-001:split:plan-001",
            filename="document-units.jsonl",
        )

        self.assertEqual(
            object_key,
            "curriculum/documents/curriculum_plan/plan-001--plan-001/source-faithful/undated/document-units.jsonl",
        )

    def test_build_processed_artifact_key_distinguishes_internal_notice_attachment_documents(
        self,
    ) -> None:
        title = "关于两校区通勤班车新增班次的通知 / 附件 1 / 班次表.jpg"
        first_key = build_processed_artifact_key(
            corpus="campus_notices",
            collection="internal_notice",
            document_id="notice_attachment:muc_internal_portal:353901:attachment-0001",
            revision_track="source-faithful",
            version_id="sha256:attachment-a",
            filename="document-units.jsonl",
            title=title,
            year="2025",
        )
        second_key = build_processed_artifact_key(
            corpus="campus_notices",
            collection="internal_notice",
            document_id="notice_attachment:muc_internal_portal:354270:attachment-0001",
            revision_track="source-faithful",
            version_id="sha256:attachment-b",
            filename="document-units.jsonl",
            title=title,
            year="2025",
        )

        self.assertNotEqual(first_key, second_key)

    def test_build_raw_asset_key_supports_curriculum_plan(self) -> None:
        object_key = build_raw_asset_key(
            corpus="curriculum",
            raw_asset_id="asset:curriculum-plan-master-pdf",
            raw_version_id="sha256:raw-001",
            filename="curriculum-plan.pdf",
        )

        self.assertEqual(
            object_key,
            "official_pdf/curriculum-plan-master/undated/sha256/raw-001/capture/curriculum-plan.pdf",
        )

    def test_build_processed_asset_artifact_key_uses_source_stage_namespace(self) -> None:
        provider_key = build_processed_asset_artifact_key(
            corpus="regulations",
            raw_asset_id="asset:student-handbook-pdf",
            raw_version_id="sha256:raw-001",
            filename="provider-response.jsonl",
        )
        layout_key = build_processed_asset_artifact_key(
            corpus="regulations",
            raw_asset_id="asset:student-handbook-pdf",
            raw_version_id="sha256:raw-001",
            filename="layout-elements.jsonl",
        )

        self.assertEqual(
            provider_key,
            "official_pdf/student-handbook/undated/sha256/raw-001/provider/paddleocr-vl-1-5/provider-response.jsonl",
        )
        self.assertEqual(
            layout_key,
            "official_pdf/student-handbook/undated/sha256/raw-001/source-truth/layout-elements.jsonl",
        )

    def test_parse_source_object_key_supports_provider_stage(self) -> None:
        parsed = parse_source_object_key(
            "official_pdf/student-handbook/2018/sha256/raw-001/provider/paddleocr-vl-1-5/provider-response.jsonl"
        )

        self.assertEqual(parsed["source_channel"], "official_pdf")
        self.assertEqual(parsed["source_asset_slug"], "student-handbook")
        self.assertEqual(parsed["year"], "2018")
        self.assertEqual(parsed["raw_version_id"], "sha256:raw-001")
        self.assertEqual(parsed["stage"], "provider")
        self.assertEqual(parsed["model_slug"], "paddleocr-vl-1-5")

    def test_parse_source_object_key_supports_projection_stage(self) -> None:
        key = build_source_projection_artifact_key(
            raw_asset_id="asset:student-handbook-pdf",
            raw_version_id="sha256:raw-001",
            projection_name="handbook_navigation_service_catalog",
            filename="flow-graph.json",
            year="2018",
        )

        parsed = parse_source_object_key(key)

        self.assertEqual(
            key,
            "official_pdf/student-handbook/2018/sha256/raw-001/projection/handbook_navigation_service_catalog/flow-graph.json",
        )
        self.assertEqual(parsed["raw_version_id"], "sha256:raw-001")
        self.assertEqual(parsed["stage"], "projection")
        self.assertEqual(parsed["projection_name"], "handbook_navigation_service_catalog")
        self.assertIsNone(parsed["model_slug"])

    def test_factory_exposes_s3_compatible_client_config_only(self) -> None:
        settings = ObjectStoreSettings.from_env(
            {
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
            }
        )
        factory = S3ObjectStoreClientFactory(settings)

        config = factory.client_config()

        self.assertEqual(config["endpoint_url"], "http://localhost:9000")
        self.assertEqual(config["region_name"], "us-east-1")
        self.assertEqual(config["aws_access_key_id"], "minioadmin")
        self.assertEqual(config["aws_secret_access_key"], "minioadmin")
        self.assertFalse(config["use_ssl"])
        self.assertIsInstance(config["config"], Config)
        self.assertEqual(config["config"].s3.get("addressing_style"), "path")

    def test_factory_resolves_bucket_specific_credentials(self) -> None:
        settings = ObjectStoreSettings.from_env(
            {
                "OBJECT_STORE_ENDPOINT": "https://s3.cstcloud.cn",
                "OBJECT_STORE_ACCESS_KEY": "shared-ak",
                "OBJECT_STORE_SECRET_KEY": "shared-sk",
                "OBJECT_STORE_SOURCE_ACCESS_KEY": "source-ak",
                "OBJECT_STORE_SOURCE_SECRET_KEY": "source-sk",
                "OBJECT_STORE_DERIVED_ACCESS_KEY": "derived-ak",
                "OBJECT_STORE_DERIVED_SECRET_KEY": "derived-sk",
            }
        )
        factory = S3ObjectStoreClientFactory(settings)

        source_config = factory.client_config(bucket=settings.bucket_source)
        derived_config = factory.client_config(bucket=settings.bucket_derived)
        fallback_config = factory.client_config(bucket="other-bucket")

        self.assertEqual(source_config["aws_access_key_id"], "source-ak")
        self.assertEqual(source_config["aws_secret_access_key"], "source-sk")
        self.assertEqual(derived_config["aws_access_key_id"], "derived-ak")
        self.assertEqual(derived_config["aws_secret_access_key"], "derived-sk")
        self.assertEqual(fallback_config["aws_access_key_id"], "shared-ak")
        self.assertEqual(fallback_config["aws_secret_access_key"], "shared-sk")


if __name__ == "__main__":
    unittest.main()
