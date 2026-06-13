from __future__ import annotations

import unittest

from campus_ingestion_core.collection_ingestion_strategy import (
    COLLECTION_REPLAY_UNSUPPORTED_ERROR,
    RawSplitManifestBuildContext,
    ReplayDocumentBuildContext,
    resolve_collection_ingestion_strategy,
)
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.registry_scope_release_support import (
    resolve_release_chunk_quality_budget,
)


class CollectionIngestionStrategyTest(unittest.TestCase):
    def test_resolves_registered_raw_and_replay_strategies(self) -> None:
        strategy = resolve_collection_ingestion_strategy("regulations", "student_rules")

        self.assertEqual(strategy.strategy_name, "student_rules_ingestion_v1")
        self.assertTrue(strategy.supports_raw_split_manifest)
        self.assertTrue(strategy.supports_provider_response_replay)
        self.assertFalse(strategy.delete_primary_registry_scope_for_provider_replay)
        self.assertEqual(strategy.default_replay_source_pdf, "学生手册_2018.pdf")
        self.assertEqual(RawSplitManifestBuildContext.__name__, "RawSplitManifestBuildContext")
        self.assertEqual(ReplayDocumentBuildContext.__name__, "ReplayDocumentBuildContext")

    def test_unregistered_scope_fails_closed_for_provider_replay(self) -> None:
        strategy = resolve_collection_ingestion_strategy("official_web", "stable_reference")

        self.assertFalse(strategy.supports_provider_response_replay)
        with self.assertRaisesRegex(ValueError, COLLECTION_REPLAY_UNSUPPORTED_ERROR):
            strategy.require_provider_response_replay()

    def test_curriculum_replay_strategy_declares_projection_targets(self) -> None:
        strategy = resolve_collection_ingestion_strategy("curriculum", "curriculum_plan")

        self.assertEqual(
            strategy.provider_replay_qdrant_targets,
            (
                ("curriculum", "course_facts"),
                ("curriculum", "program_family_facts"),
                ("curriculum", "program_semester_facts"),
            ),
        )
        self.assertTrue(strategy.delete_primary_registry_scope_for_provider_replay)
        self.assertEqual(strategy.default_replay_source_pdf, "curriculum-plan.pdf")

    def test_release_chunk_budget_uses_collection_chunk_profile_defaults(self) -> None:
        student_budget = resolve_release_chunk_quality_budget(
            corpus="regulations",
            collection="student_rules",
            runtime_profile=load_runtime_profile("regulations", "student_rules"),
        )
        curriculum_budget = resolve_release_chunk_quality_budget(
            corpus="curriculum",
            collection="curriculum_plan",
            runtime_profile=load_runtime_profile("curriculum", "curriculum_plan"),
        )

        self.assertEqual(student_budget.max_token_count, 512)
        self.assertEqual(student_budget.source, "collection_chunk_profile")
        self.assertEqual(curriculum_budget.max_token_count, 640)
        self.assertEqual(curriculum_budget.max_token_count_by_unit_type, {"table_unit": 640})
        self.assertEqual(curriculum_budget.source, "collection_chunk_profile")


if __name__ == "__main__":
    unittest.main()
