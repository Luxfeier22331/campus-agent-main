from __future__ import annotations

import json
import unittest
from pathlib import Path

from campus_ingestion_contracts import (
    validate_ingestion_task_envelope,
    validate_ingestion_task_registry,
)

FIXTURE_ROOT = Path(__file__).resolve().parents[2] / "packages" / "ingestion-contracts" / "fixtures"


def load_fixture(name: str) -> object:
    return json.loads((FIXTURE_ROOT / name).read_text(encoding="utf-8"))


class IngestionContractsSuite(unittest.TestCase):
    def test_accepts_valid_task_envelope_and_rejects_missing_idempotency(self) -> None:
        self.assertTrue(
            validate_ingestion_task_envelope(load_fixture("task-envelope.valid.json")).ok
        )

        result = validate_ingestion_task_envelope(
            load_fixture("task-envelope.invalid-missing-idempotency.json")
        )

        self.assertFalse(result.ok)
        self.assertIn("idempotency_key is required", result.errors)

    def test_accepts_active_registry_task_kinds_only(self) -> None:
        self.assertTrue(
            validate_ingestion_task_registry(load_fixture("task-registry.valid.json")).ok
        )

        result = validate_ingestion_task_registry(
            {
                "schema_version": "ingestion_task_registry.v1",
                "source_family": "curriculum",
                "corpus": "curriculum",
                "collection": "curriculum_plan",
                "tasks": [
                    {
                        "task_kind": "alias_publish",
                        "executor_kind": "ts_control",
                        "input_contract": "ingestion_release_manifest.v1",
                        "output_contract": "ingestion_alias_publish_closeout.v1",
                        "can_publish_alias": True,
                    }
                ],
            }
        )

        self.assertFalse(result.ok)
        self.assertIn("tasks[0].task_kind is not supported: alias_publish", result.errors)


if __name__ == "__main__":
    unittest.main()
