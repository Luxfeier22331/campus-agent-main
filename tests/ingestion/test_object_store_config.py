from __future__ import annotations

import unittest

from campus_ingestion_core.object_store import (
    S3ObjectStoreClientFactory,
    build_object_key,
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

    def test_build_object_key_uses_stable_phase1_path_shape(self) -> None:
        object_key = build_object_key(
            corpus="student_handbook",
            document_id="handbook:test-001",
            version_id="v1:test-001",
            layer="processed",
            filename="structured.jsonl",
        )

        self.assertEqual(
            object_key,
            "student_handbook/handbook:test-001/v1:test-001/processed/structured.jsonl",
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
