from __future__ import annotations

import json
import unittest
from pathlib import Path

from campus_ingestion_contracts import validate_ingestion_task_registry

REPO_ROOT = Path(__file__).resolve().parents[2]


class IngestionTaskRegistryConfigsSuite(unittest.TestCase):
    def test_config_only_ingestion_collection_dirs_do_not_declare_task_registry(self) -> None:
        config_only_dirs = {
            "configs/ingestion/campus_services/transport_schedule",
            "configs/ingestion/curriculum/course_facts",
            "configs/ingestion/curriculum/program_family_facts",
            "configs/ingestion/curriculum/program_semester_facts",
        }
        offenders = [
            path.relative_to(REPO_ROOT).as_posix()
            for path in (REPO_ROOT / "configs/ingestion").glob("*/*")
            if path.is_dir()
            and path.relative_to(REPO_ROOT).as_posix() in config_only_dirs
            and (path / "task-registry.v2.json").is_file()
        ]

        self.assertEqual(offenders, [])

    def test_reference_data_does_not_declare_ingestion_runtime_profiles(self) -> None:
        reference_root = REPO_ROOT / "configs/reference-data"
        offenders = [
            path.relative_to(REPO_ROOT).as_posix()
            for path in reference_root.rglob("*")
            if path.name in {"task-registry.v2.json", "runtime-profile.json", "chunk-profile.json"}
        ]

        self.assertEqual(offenders, [])

    def test_all_task_registries_are_valid(self) -> None:
        registry_paths = tuple(
            sorted((REPO_ROOT / "configs/ingestion").glob("*/*/task-registry.v2.json"))
        )
        registry_relpaths = {path.relative_to(REPO_ROOT).as_posix() for path in registry_paths}

        self.assertIn(
            "configs/ingestion/campus_notices/internal_notice/task-registry.v2.json",
            registry_relpaths,
        )
        self.assertIn(
            "configs/ingestion/official_web/stable_reference/task-registry.v2.json",
            registry_relpaths,
        )
        for path in registry_paths:
            relative_path = path.relative_to(REPO_ROOT).as_posix()
            with self.subTest(relative_path=relative_path):
                payload = json.loads(path.read_text(encoding="utf-8"))
                result = validate_ingestion_task_registry(payload)
                self.assertTrue(result.ok, result.errors)


if __name__ == "__main__":
    unittest.main()
