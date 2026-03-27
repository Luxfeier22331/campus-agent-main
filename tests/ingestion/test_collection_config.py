from __future__ import annotations

from pathlib import Path
import unittest

from campus_ingestion_core.collection_config import resolve_collection_truth_config


class CollectionTruthConfigTest(unittest.TestCase):
    def test_resolve_student_handbook_collection_truth_uses_repo_tracked_paths(self) -> None:
        config = resolve_collection_truth_config("regulations", "student_handbook")

        self.assertEqual(config.corpus, "regulations")
        self.assertEqual(config.collection, "student_handbook")
        self.assertEqual(
            config.config_root,
            Path("configs/ingestion/regulations/student_handbook").resolve(),
        )
        self.assertEqual(config.split_manifest_path, config.config_root / "split-manifest.v1.json")
        self.assertEqual(config.source_projections_path, config.config_root / "source-projections.v1.json")
        self.assertEqual(config.runtime_profile_path, config.config_root / "runtime-profile.json")
        self.assertTrue(config.split_manifest_path.exists())
        self.assertTrue(config.source_projections_path.exists())


if __name__ == "__main__":
    unittest.main()
