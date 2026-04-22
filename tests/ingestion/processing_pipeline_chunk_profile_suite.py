from __future__ import annotations

import unittest

from .processing_pipeline_test_support import *  # noqa: F401,F403


class ProcessingPipelineChunkProfileTest(unittest.TestCase):
    def test_default_chunk_profile_matches_generic_structure_first_defaults(self) -> None:
        profile = ChunkProfile()

        self.assertEqual(profile.chunk_size, DEFAULT_CHUNK_SIZE)
        self.assertEqual(profile.chunk_overlap, DEFAULT_CHUNK_OVERLAP)
        self.assertEqual(profile.split_strategy, "structure_first")
        self.assertEqual(profile.chunk_policy_version, DEFAULT_CHUNK_POLICY_VERSION)
        self.assertEqual(profile.cleaning_policy_version, DEFAULT_CLEANING_POLICY_VERSION)
        self.assertEqual(profile.strategy_name, "structure_first_default_v1")
        self.assertIsInstance(profile.strategy, StudentHandbookChunkingStrategy)

    def test_build_curriculum_chunk_profile_matches_runtime_truth(self) -> None:
        profile = build_curriculum_chunk_profile(model_name="Qwen3-Embedding-4B")

        self.assertEqual(profile.chunk_size, 360)
        self.assertEqual(profile.max_chunk_size, 540)
        self.assertEqual(profile.chunk_overlap, 72)
        self.assertEqual(profile.min_chunk_size, 50)
        self.assertEqual(profile.chunk_policy_version, CURRICULUM_V2_CHUNK_POLICY_VERSION)
        self.assertEqual(profile.cleaning_policy_version, CURRICULUM_CLEANING_POLICY_VERSION)
        self.assertEqual(profile.strategy_name, "curriculum_plan_structure_v2")

    def test_build_curriculum_chunk_profile_v2_uses_balanced_table_budget_for_table_units(
        self,
    ) -> None:
        profile = build_curriculum_chunk_profile(
            profile_version=CURRICULUM_V2_CHUNK_POLICY_VERSION,
            model_name="Qwen3-Embedding-4B",
            unit_type="table_unit",
        )

        self.assertEqual(profile.chunk_size, 420)
        self.assertEqual(profile.max_chunk_size, 640)
        self.assertEqual(profile.chunk_overlap, 72)
        self.assertEqual(profile.min_chunk_size, 64)
        self.assertEqual(profile.chunk_policy_version, CURRICULUM_V2_CHUNK_POLICY_VERSION)
        self.assertEqual(profile.strategy_name, "curriculum_plan_structure_v2")
