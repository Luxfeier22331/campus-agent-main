from __future__ import annotations

import json
import unittest
from pathlib import Path

from campus_ingestion_contracts import validate_ingestion_task_registry

REPO_ROOT = Path(__file__).resolve().parents[2]


class IngestionTaskRegistryConfigsSuite(unittest.TestCase):
    def test_curriculum_and_student_rules_task_registries_are_valid(self) -> None:
        for relative_path in (
            "configs/ingestion/curriculum/curriculum_plan/task-registry.v1.json",
            "configs/ingestion/regulations/student_rules/task-registry.v1.json",
        ):
            with self.subTest(relative_path=relative_path):
                payload = json.loads((REPO_ROOT / relative_path).read_text(encoding="utf-8"))
                result = validate_ingestion_task_registry(payload)
                self.assertTrue(result.ok, result.errors)


if __name__ == "__main__":
    unittest.main()
