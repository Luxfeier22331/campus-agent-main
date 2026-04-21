from __future__ import annotations

import unittest

from campus_ingestion_core.index_release import resolve_alias_target
from campus_ingestion_core.scope_alias import set_scope_release_alias
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models


class ScopeAliasTest(unittest.TestCase):
    def test_set_scope_release_alias_binds_existing_physical_collection(self) -> None:
        qdrant_client = QdrantClient(location=":memory:")
        qdrant_client.create_collection(
            collection_name="official_web_stable_reference__r20260404_204033",
            vectors_config=qdrant_models.VectorParams(
                size=1, distance=qdrant_models.Distance.COSINE
            ),
        )

        report = set_scope_release_alias(
            corpus="official_web",
            collection="stable_reference",
            qdrant_client=qdrant_client,
            physical_collection_name="official_web_stable_reference__r20260404_204033",
        )

        self.assertEqual(report.action, "publish")
        self.assertIsNone(report.previous_physical_collection_name)
        self.assertEqual(
            report.current_physical_collection_name,
            "official_web_stable_reference__r20260404_204033",
        )
        self.assertEqual(
            resolve_alias_target(
                qdrant_client=qdrant_client, alias_name="official_web_stable_reference"
            ),
            "official_web_stable_reference__r20260404_204033",
        )

    def test_set_scope_release_alias_can_unpublish_without_deleting_collections(self) -> None:
        qdrant_client = QdrantClient(location=":memory:")
        qdrant_client.create_collection(
            collection_name="muc_public_pages__r20260404_184508",
            vectors_config=qdrant_models.VectorParams(
                size=1, distance=qdrant_models.Distance.COSINE
            ),
        )
        qdrant_client.update_collection_aliases(
            [
                qdrant_models.CreateAliasOperation(
                    create_alias=qdrant_models.CreateAlias(
                        collection_name="muc_public_pages__r20260404_184508",
                        alias_name="muc_public_pages",
                    )
                )
            ]
        )

        report = set_scope_release_alias(
            corpus="official_web",
            collection="muc_public_pages",
            qdrant_client=qdrant_client,
            physical_collection_name=None,
        )

        self.assertEqual(report.action, "unpublish")
        self.assertEqual(
            report.previous_physical_collection_name, "muc_public_pages__r20260404_184508"
        )
        self.assertIsNone(report.current_physical_collection_name)
        self.assertIsNone(
            resolve_alias_target(qdrant_client=qdrant_client, alias_name="muc_public_pages")
        )
        self.assertTrue(qdrant_client.collection_exists("muc_public_pages__r20260404_184508"))


if __name__ == "__main__":
    unittest.main()
