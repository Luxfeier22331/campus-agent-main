from __future__ import annotations

import unittest
from unittest.mock import patch

from campus_ingestion_core.collection_rename_registry_backfill import (
    REGULATIONS_CORPUS,
    resolve_registry_collection_rename_targets,
)
from campus_ingestion_core.registry import (
    DOCUMENT_REGISTRY_ENV_KEY,
    DOCUMENT_REGISTRY_OPERATOR_ENV_KEY,
    RAW_ASSET_REGISTRY_ENV_KEY,
    RAW_ASSET_REGISTRY_OPERATOR_ENV_KEY,
)


class CollectionRenameRegistryBackfillTest(unittest.TestCase):
    def test_resolve_targets_reads_registry_env_keys(self) -> None:
        env = {
            DOCUMENT_REGISTRY_ENV_KEY: "postgresql://runtime-document",
            RAW_ASSET_REGISTRY_ENV_KEY: "postgresql://runtime-raw",
            DOCUMENT_REGISTRY_OPERATOR_ENV_KEY: "postgresql://operator-document",
            RAW_ASSET_REGISTRY_OPERATOR_ENV_KEY: "postgresql://operator-raw",
        }

        with (
            patch(
                "campus_ingestion_core.collection_rename_registry_backfill.validate_persistent_postgres_runtime_url",
                side_effect=lambda value: value,
            ),
            patch(
                "campus_ingestion_core.collection_rename_registry_backfill.validate_operator_postgres_url",
                side_effect=lambda value: value,
            ),
            patch(
                "campus_ingestion_core.collection_rename_registry_backfill.normalize_postgres_connection_url",
                side_effect=lambda value: value,
            ),
        ):
            targets = resolve_registry_collection_rename_targets(env)

        self.assertEqual(len(targets), 4)
        self.assertEqual(
            tuple(target.target_names for target in targets),
            (
                ("operator_document_registry",),
                ("runtime_document_registry",),
                ("operator_raw_asset_registry",),
                ("runtime_raw_asset_registry",),
            ),
        )
        self.assertEqual(
            tuple(target.kind for target in targets),
            (
                "document_registry",
                "document_registry",
                "raw_asset_registry",
                "raw_asset_registry",
            ),
        )
        self.assertTrue(all(target.database_url.startswith("postgresql://") for target in targets))
        self.assertEqual(REGULATIONS_CORPUS, "regulations")


if __name__ == "__main__":
    unittest.main()
