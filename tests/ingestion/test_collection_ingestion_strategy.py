from __future__ import annotations

import unittest

from campus_ingestion_core.collection_ingestion_strategy import (
    RawSplitManifestBuildContext,
    resolve_collection_ingestion_strategy,
)


class CollectionIngestionStrategyTest(unittest.TestCase):
    def test_resolves_registered_raw_student_rules_strategy(self) -> None:
        strategy = resolve_collection_ingestion_strategy("regulations", "student_rules")

        self.assertEqual(strategy.strategy_name, "student_rules_ingestion_v1")
        self.assertTrue(strategy.supports_raw_split_manifest)
        self.assertIsNotNone(strategy.build_raw_split_manifest_documents)
        self.assertEqual(RawSplitManifestBuildContext.__name__, "RawSplitManifestBuildContext")

    def test_resolves_registered_raw_curriculum_strategy(self) -> None:
        strategy = resolve_collection_ingestion_strategy("curriculum", "curriculum_plan")

        self.assertEqual(strategy.strategy_name, "curriculum_plan_ingestion_v1")
        self.assertTrue(strategy.supports_raw_split_manifest)
        self.assertIsNotNone(strategy.build_raw_split_manifest_documents)

    def test_unregistered_scope_fails_closed_for_raw_split_manifest(self) -> None:
        strategy = resolve_collection_ingestion_strategy("official_web", "stable_reference")

        self.assertTrue(strategy.supports_raw_split_manifest)
        self.assertIsNotNone(strategy.build_raw_split_manifest_documents)


if __name__ == "__main__":
    unittest.main()
