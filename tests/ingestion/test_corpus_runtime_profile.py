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
        self.assertEqual(profile.phase1_stage, "query_serving")
        self.assertEqual(profile.allowed_artifact_modes, ("normalized", "provider_only"))
        self.assertTrue(profile.split_manifest_required)
        self.assertTrue(profile.retrieval_enabled)
        self.assertTrue(profile.default_query_enabled)
        self.assertEqual(profile.cleaning_policy_version, "student_handbook_cleaning_v1")

    def test_load_curriculum_plan_runtime_profile(self) -> None:
        profile = load_runtime_profile("curriculum", "curriculum_plan")

        self.assertEqual(profile.corpus, "curriculum")
        self.assertEqual(profile.collection, "curriculum_plan")
        self.assertEqual(profile.phase1_stage, "cleaned_ingestion")
        self.assertEqual(profile.allowed_artifact_modes, ("normalized", "provider_only"))
        self.assertTrue(profile.split_manifest_required)
        self.assertFalse(profile.retrieval_enabled)
        self.assertFalse(profile.default_query_enabled)
        self.assertEqual(profile.cleaning_policy_version, "curriculum_plan_cleaning_v1")

    def test_load_service_catalog_runtime_profile(self) -> None:
        profile = load_runtime_profile("campus_services", "service_catalog")

        self.assertEqual(profile.corpus, "campus_services")
        self.assertEqual(profile.collection, "service_catalog")
        self.assertEqual(profile.phase1_stage, "cleaned_ingestion")
        self.assertEqual(profile.allowed_artifact_modes, ("normalized", "provider_only"))
        self.assertFalse(profile.split_manifest_required)
        self.assertFalse(profile.retrieval_enabled)
        self.assertFalse(profile.default_query_enabled)
        self.assertEqual(profile.cleaning_policy_version, "service_catalog_cleaning_v1")

    def test_load_contact_directory_runtime_profile(self) -> None:
        profile = load_runtime_profile("campus_services", "contact_directory")

        self.assertEqual(profile.corpus, "campus_services")
        self.assertEqual(profile.collection, "contact_directory")
        self.assertEqual(profile.phase1_stage, "cleaned_ingestion")
        self.assertEqual(profile.allowed_artifact_modes, ("normalized", "provider_only"))
        self.assertFalse(profile.split_manifest_required)
        self.assertFalse(profile.retrieval_enabled)
        self.assertFalse(profile.default_query_enabled)
        self.assertEqual(profile.cleaning_policy_version, "contact_directory_cleaning_v1")

    def test_default_query_scopes_only_include_query_enabled_profiles(self) -> None:
        self.assertEqual(default_query_scopes(), (("regulations", "student_handbook"),))


if __name__ == "__main__":
    unittest.main()
