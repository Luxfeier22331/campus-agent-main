from __future__ import annotations

import unittest
from unittest.mock import patch

from campus_ingestion_core.authenticated_notice_import_env import (
    _build_consumption_projection_store_from_env_if_configured,
    _build_inventory_store_from_env_if_configured,
    _build_read_model_store_from_env_if_configured,
)
from campus_ingestion_core.authenticated_notice_import_env_presence import (
    env_has_consumption_projection_config,
    env_has_inventory_store_config,
    env_has_read_model_config,
)


class AuthenticatedNoticeImportEnvTest(unittest.TestCase):
    def test_shared_operator_postgres_enables_downstream_materialization_stores(self) -> None:
        env = {"CAMPUS_SHARED_POSTGRES_OPERATOR_URL": "postgresql://example"}

        self.assertTrue(env_has_consumption_projection_config(env))
        self.assertTrue(env_has_read_model_config(env))

        with patch(
            "campus_ingestion_core.authenticated_notice_import_env."
            "build_notice_consumption_projection_store_from_env",
            return_value="projection-store",
        ) as build_projection_store:
            self.assertEqual(
                _build_consumption_projection_store_from_env_if_configured(env),
                "projection-store",
            )
        build_projection_store.assert_called_once_with(env, prefer_operator=True)

        with patch(
            "campus_ingestion_core.authenticated_notice_import_env."
            "build_internal_notice_read_model_store_from_env",
            return_value="read-model-store",
        ) as build_read_model_store:
            self.assertEqual(
                _build_read_model_store_from_env_if_configured(env),
                "read-model-store",
            )
        build_read_model_store.assert_called_once_with(env, prefer_operator=True)

    def test_registry_env_does_not_enable_source_truth_projection_or_read_model_stores(
        self,
    ) -> None:
        env = {
            "DOCUMENT_REGISTRY_DATABASE_URL": "postgresql://document-registry.example/postgres",
            "RAW_ASSET_REGISTRY_DATABASE_URL": "postgresql://raw-registry.example/postgres",
        }

        self.assertFalse(env_has_inventory_store_config(env))
        self.assertFalse(env_has_consumption_projection_config(env))
        self.assertFalse(env_has_read_model_config(env))
        self.assertIsNone(_build_inventory_store_from_env_if_configured(env))
        self.assertIsNone(_build_consumption_projection_store_from_env_if_configured(env))
        self.assertIsNone(_build_read_model_store_from_env_if_configured(env))


if __name__ == "__main__":
    unittest.main()
