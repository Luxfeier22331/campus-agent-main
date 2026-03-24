from __future__ import annotations

import unittest

from campus_ingestion_core.object_store import (
    S3ObjectStoreClientFactory,
    build_processed_artifact_key,
    build_raw_asset_key,
)
from campus_ingestion_core.settings import ObjectStoreSettings


class ObjectStoreConfigTest(unittest.TestCase):
    def test_defaults_match_phase1_bucket_contract(self) -> None:
        settings = ObjectStoreSettings.from_env(
            {
                "OBJECT_STORE_ENDPOINT": "http://localhost:9000",
                "OBJECT_STORE_ACCESS_KEY": "minioadmin",
                "OBJECT_STORE_SECRET_KEY": "minioadmin",
            }
        )

        self.assertEqual(settings.region, "us-east-1")
        self.assertEqual(settings.bucket_raw, "campus-rag-raw")
        self.assertEqual(settings.bucket_processed, "campus-rag-processed")
        self.assertFalse(settings.secure)

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
            "pdf/student-handbook/undated/sha256/raw-001/student-handbook.pdf",
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

    def test_build_raw_asset_key_supports_curriculum_plan(self) -> None:
        object_key = build_raw_asset_key(
            corpus="curriculum",
            raw_asset_id="asset:curriculum-plan-master-pdf",
            raw_version_id="sha256:raw-001",
            filename="curriculum-plan.pdf",
        )

        self.assertEqual(
            object_key,
            "pdf/curriculum-plan-master/undated/sha256/raw-001/curriculum-plan.pdf",
        )

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


if __name__ == "__main__":
    unittest.main()
