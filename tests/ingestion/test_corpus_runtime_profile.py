from __future__ import annotations

import unittest

from campus_ingestion_core import (
    default_query_scopes,
    load_runtime_profile,
)


class CorpusRuntimeProfileTest(unittest.TestCase):
    def test_load_student_handbook_runtime_profile_requires_split_manifest(self) -> None:
        profile = load_runtime_profile("regulations", "student_handbook")

        self.assertEqual(profile.corpus, "regulations")
        self.assertEqual(profile.collection, "student_handbook")
        self.assertEqual(profile.serving_stage, "query_serving")
        self.assertEqual(profile.allowed_artifact_modes, ("normalized", "source_truth_only"))
        self.assertTrue(profile.split_manifest_required)
        self.assertTrue(profile.retrieval_enabled)
        self.assertTrue(profile.query_enabled_by_default)
        self.assertTrue(profile.current_only)
        self.assertEqual(profile.serving_revision_tracks, ("current-effective", "source-faithful"))
        self.assertEqual(profile.no_hit_min_top_score, 0.6)
        self.assertEqual(profile.no_hit_min_score_gap, 0.1)
        self.assertEqual(profile.cleaning_policy_version, "student_handbook_cleaning_v1")
        self.assertEqual(profile.chunk_profile_version, "student_handbook_semantic_v3")
        self.assertEqual(profile.qdrant_index_binding.alias_name, "student_handbook")
        self.assertEqual(profile.qdrant_index_binding.collection_prefix, "student_handbook")

    def test_load_curriculum_plan_runtime_profile(self) -> None:
        profile = load_runtime_profile("curriculum", "curriculum_plan")

        self.assertEqual(profile.corpus, "curriculum")
        self.assertEqual(profile.collection, "curriculum_plan")
        self.assertEqual(profile.serving_stage, "query_serving")
        self.assertEqual(profile.allowed_artifact_modes, ("normalized", "source_truth_only"))
        self.assertTrue(profile.split_manifest_required)
        self.assertTrue(profile.retrieval_enabled)
        self.assertTrue(profile.query_enabled_by_default)
        self.assertFalse(profile.current_only)
        self.assertEqual(profile.serving_revision_tracks, ("source-faithful",))
        self.assertIsNone(profile.no_hit_min_top_score)
        self.assertIsNone(profile.no_hit_min_score_gap)
        self.assertEqual(profile.cleaning_policy_version, "curriculum_plan_cleaning_v1")
        self.assertEqual(profile.chunk_profile_version, "curriculum_plan_semantic_v2")
        self.assertEqual(profile.qdrant_index_binding.alias_name, "curriculum_plan")
        self.assertEqual(profile.qdrant_index_binding.collection_prefix, "curriculum_plan")

    def test_load_service_catalog_runtime_profile(self) -> None:
        profile = load_runtime_profile("campus_services", "service_catalog")

        self.assertEqual(profile.corpus, "campus_services")
        self.assertEqual(profile.collection, "service_catalog")
        self.assertEqual(profile.serving_stage, "offline_preparation")
        self.assertEqual(profile.allowed_artifact_modes, ("normalized", "source_truth_only"))
        self.assertFalse(profile.split_manifest_required)
        self.assertFalse(profile.retrieval_enabled)
        self.assertFalse(profile.query_enabled_by_default)
        self.assertFalse(profile.current_only)
        self.assertEqual(profile.serving_revision_tracks, ())
        self.assertIsNone(profile.no_hit_min_top_score)
        self.assertIsNone(profile.no_hit_min_score_gap)
        self.assertEqual(profile.cleaning_policy_version, "service_catalog_cleaning_v1")
        self.assertEqual(profile.chunk_profile_version, "service_catalog_semantic_v1")
        self.assertEqual(profile.qdrant_index_binding.alias_name, "service_catalog")
        self.assertEqual(profile.qdrant_index_binding.collection_prefix, "service_catalog")

    def test_load_contact_directory_runtime_profile(self) -> None:
        profile = load_runtime_profile("campus_services", "contact_directory")

        self.assertEqual(profile.corpus, "campus_services")
        self.assertEqual(profile.collection, "contact_directory")
        self.assertEqual(profile.serving_stage, "offline_preparation")
        self.assertEqual(profile.allowed_artifact_modes, ("normalized", "source_truth_only"))
        self.assertFalse(profile.split_manifest_required)
        self.assertFalse(profile.retrieval_enabled)
        self.assertFalse(profile.query_enabled_by_default)
        self.assertFalse(profile.current_only)
        self.assertEqual(profile.serving_revision_tracks, ())
        self.assertIsNone(profile.no_hit_min_top_score)
        self.assertIsNone(profile.no_hit_min_score_gap)
        self.assertEqual(profile.cleaning_policy_version, "contact_directory_cleaning_v1")
        self.assertEqual(profile.chunk_profile_version, "contact_directory_semantic_v1")
        self.assertEqual(profile.qdrant_index_binding.alias_name, "contact_directory")
        self.assertEqual(profile.qdrant_index_binding.collection_prefix, "contact_directory")

    def test_default_query_scopes_include_all_query_enabled_profiles(self) -> None:
        self.assertEqual(
            default_query_scopes(),
            (
                ("curriculum", "curriculum_plan"),
                ("regulations", "student_handbook"),
            ),
        )


if __name__ == "__main__":
    unittest.main()
