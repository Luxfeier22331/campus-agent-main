from __future__ import annotations

import unittest

from campus_ingestion_core import (
    default_query_corpora,
    load_corpus_runtime_profile,
)


class CorpusRuntimeProfileTest(unittest.TestCase):
    def test_load_curriculum_plan_runtime_profile(self) -> None:
        profile = load_corpus_runtime_profile("curriculum_plan")

        self.assertEqual(profile.corpus, "curriculum_plan")
        self.assertEqual(profile.phase1_stage, "cleaned_ingestion")
        self.assertEqual(profile.allowed_artifact_modes, ("normalized",))
        self.assertTrue(profile.split_manifest_required)
        self.assertFalse(profile.retrieval_enabled)
        self.assertFalse(profile.default_query_enabled)
        self.assertEqual(profile.cleaning_policy_version, "curriculum_plan_cleaning_v1")

    def test_default_query_corpora_only_include_query_enabled_profiles(self) -> None:
        self.assertEqual(default_query_corpora(), ("student_handbook",))


if __name__ == "__main__":
    unittest.main()
