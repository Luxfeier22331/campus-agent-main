from __future__ import annotations

import json
import unittest
from pathlib import Path

from campus_ingestion_contracts import (
    validate_canonical_document_unit,
    validate_canonical_document_units_jsonl,
    validate_ingestion_task_envelope,
    validate_ingestion_task_registry,
)

CONTRACTS_ROOT = Path(__file__).resolve().parents[1]
ASSERTION_ROOT = CONTRACTS_ROOT / "assertions"


def load_assertion(name: str) -> object:
    return json.loads((ASSERTION_ROOT / name).read_text(encoding="utf-8"))


class PythonIngestionContractsAdapterSmokeTest(unittest.TestCase):
    def test_python_schema_resources_match_canonical_schema_files(self) -> None:
        for name in (
            "canonical-document-units.v1.schema.json",
            "ingestion-task-envelope.v2.schema.json",
            "ingestion-task-registry.v2.schema.json",
        ):
            with self.subTest(schema=name):
                self.assertEqual(
                    (
                        CONTRACTS_ROOT / "src" / "campus_ingestion_contracts" / "schemas" / name
                    ).read_text(encoding="utf-8"),
                    (CONTRACTS_ROOT / "schemas" / name).read_text(encoding="utf-8"),
                )

    def test_python_adapter_validates_representative_payloads(self) -> None:
        valid_unit = {
            "anchor": {"source_uri": "s3://campus-agent-source/example/document.md"},
            "chunk_id": "unit-001",
            "clean_text": "第一段内容",
            "doc_id": "doc-001",
            "metadata": {"heading": "总则"},
            "root_unit_id": "root-001",
            "text": "第一段内容",
            "unit_type": "paragraph",
            "version_id": "version-001",
        }

        self.assertTrue(validate_canonical_document_unit(valid_unit).ok)
        self.assertTrue(
            validate_canonical_document_units_jsonl(
                f"{json.dumps(valid_unit, ensure_ascii=False)}\n"
            ).ok
        )
        self.assertTrue(
            validate_ingestion_task_envelope(load_assertion("task-envelope.valid.json")).ok
        )
        self.assertTrue(
            validate_ingestion_task_registry(load_assertion("task-registry.valid.json")).ok
        )

    def test_python_adapter_returns_stable_validation_errors(self) -> None:
        result = validate_canonical_document_unit(
            {
                "document_id": "doc-001",
                "metadata": {},
                "text": "legacy shape",
                "unit_id": "unit-001",
            }
        )
        self.assertFalse(result.ok)
        self.assertIn("doc_id is required", result.errors)
        self.assertIn("chunk_id is required", result.errors)
        self.assertIn("clean_text is required", result.errors)

        envelope_result = validate_ingestion_task_envelope(
            load_assertion("task-envelope.invalid-missing-idempotency.json")
        )
        self.assertFalse(envelope_result.ok)
        self.assertIn("idempotency_key is required", envelope_result.errors)

        registry_result = validate_ingestion_task_registry(
            load_assertion("task-registry.invalid-python-adapter.json")
        )
        self.assertFalse(registry_result.ok)
        self.assertIn(
            "tasks[0].executor_kind is not supported: python_adapter",
            registry_result.errors,
        )


if __name__ == "__main__":
    unittest.main()
