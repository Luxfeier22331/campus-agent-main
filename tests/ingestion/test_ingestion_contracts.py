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

    def test_prevents_rust_kernels_from_owning_alias_publish(self) -> None:
        self.assertTrue(
            validate_ingestion_task_registry(load_fixture("task-registry.valid.json")).ok
        )

        result = validate_ingestion_task_registry(
            load_fixture("task-registry.invalid-alias-kernel.json")
        )

        self.assertFalse(result.ok)
        self.assertIn("tasks[0] alias_publish cannot be executed by rust_kernel", result.errors)


if __name__ == "__main__":
    unittest.main()
