from __future__ import annotations

import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


class RunWithStagingIngestionEnvScriptTest(unittest.TestCase):
    def test_script_maps_explicit_staging_data_plane_env_without_using_app_api_db(
        self,
    ) -> None:
        source = (ROOT / "scripts" / "run-with-staging-ingestion-env.mjs").read_text(
            encoding="utf-8"
        )

        self.assertIn("STAGING_INGESTION_SHARED_POSTGRES_URL", source)
        self.assertIn("CAMPUS_SHARED_POSTGRES_URL", source)
        self.assertIn("STAGING_INGESTION_OBJECT_STORE_ENDPOINT", source)
        self.assertIn("OBJECT_STORE_ENDPOINT", source)
        self.assertNotIn("STAGING_INGESTION_QDRANT_URL", source)
        self.assertIn("STAGING_INGESTION_OBJECT_STORE_SOURCE_ACCESS_KEY", source)
        self.assertIn("OBJECT_STORE_SOURCE_ACCESS_KEY", source)
        self.assertIn("STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY", source)
        self.assertIn("OBJECT_STORE_DERIVED_ACCESS_KEY", source)
        self.assertNotIn("loadRepoEnvFile", source)
        self.assertIn("loadRepoStagingEnvFile", source)
        self.assertNotIn(".env.staging.local", source)
        self.assertNotIn("STAGING_APP_API_OPERATOR_DATABASE_URL", source)


if __name__ == "__main__":
    unittest.main()
