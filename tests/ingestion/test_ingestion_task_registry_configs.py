from __future__ import annotations

import json
import unittest
from pathlib import Path

from campus_ingestion_contracts import validate_ingestion_task_registry

REPO_ROOT = Path(__file__).resolve().parents[2]


class IngestionTaskRegistryConfigsSuite(unittest.TestCase):
    def test_all_task_registries_are_valid(self) -> None:
        registry_paths = tuple(
            sorted((REPO_ROOT / "configs/ingestion").glob("*/*/task-registry.v1.json"))
        )
        registry_relpaths = {path.relative_to(REPO_ROOT).as_posix() for path in registry_paths}

        self.assertIn(
            "configs/ingestion/campus_notices/internal_notice/task-registry.v1.json",
            registry_relpaths,
        )
        self.assertIn(
            "configs/ingestion/official_web/stable_reference/task-registry.v1.json",
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
