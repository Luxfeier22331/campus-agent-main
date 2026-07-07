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

ASSERTION_ROOT = (
    Path(__file__).resolve().parents[2] / "packages" / "ingestion-contracts" / "assertions"
)
CONTRACTS_ROOT = Path(__file__).resolve().parents[2] / "packages" / "ingestion-contracts"


def load_assertion(name: str) -> object:
    return json.loads((ASSERTION_ROOT / name).read_text(encoding="utf-8"))


class IngestionContractsSuite(unittest.TestCase):
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

    def test_validates_canonical_document_units_with_shared_schema(self) -> None:
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

    def test_accepts_valid_task_envelope_and_rejects_missing_idempotency(self) -> None:
        self.assertTrue(
            validate_ingestion_task_envelope(load_assertion("task-envelope.valid.json")).ok
        )

        result = validate_ingestion_task_envelope(
            load_assertion("task-envelope.invalid-missing-idempotency.json")
        )

        self.assertFalse(result.ok)
        self.assertIn("idempotency_key is required", result.errors)

    def test_accepts_active_registry_task_kinds_only(self) -> None:
        self.assertTrue(
            validate_ingestion_task_registry(load_assertion("task-registry.valid.json")).ok
        )

        result = validate_ingestion_task_registry(
            {
                "schema_version": "ingestion_task_registry.v2",
                "source_family": "curriculum",
                "corpus": "curriculum",
                "collection": "curriculum_plan",
                "tasks": [
                    {
                        "registry_task_id": "alias_publish",
                        "task_kind": "alias_publish",
                        "executor_kind": "ts_control",
                        "input_contract": "ingestion_release_manifest.v1",
                        "output_contract": "ingestion_alias_publish_closeout.v1",
                    }
                ],
            }
        )

        self.assertFalse(result.ok)
        self.assertIn("tasks[0].task_kind is not supported: alias_publish", result.errors)

    def test_rejects_unwired_collector_and_provider_registry_declarations(self) -> None:
        for task_kind, executor_kind in (
            ("source_" + "capture", "crawlee_" + "collector"),
            ("provider_" + "extract", "provider_" + "activity"),
        ):
            result = validate_ingestion_task_registry(
                {
                    "schema_version": "ingestion_task_registry.v2",
                    "source_family": "custom_family",
                    "corpus": "custom",
                    "collection": "new_collection",
                    "tasks": [
                        {
                            "registry_task_id": task_kind,
                            "task_kind": task_kind,
                            "executor_kind": executor_kind,
                            "input_contract": "custom_input.v1",
                            "output_contract": "custom_output.v1",
                        }
                    ],
                }
            )

            self.assertFalse(result.ok)
            self.assertIn(f"tasks[0].task_kind is not supported: {task_kind}", result.errors)
            self.assertIn(
                f"tasks[0].executor_kind is not supported: {executor_kind}",
                result.errors,
            )

    def test_rejects_post_source_materialization_task_kinds(self) -> None:
        registry = {
            "schema_version": "ingestion_task_registry.v2",
            "source_family": "authenticated_notice",
            "corpus": "campus_notices",
            "collection": "internal_notice",
            "tasks": [
                {
                    "registry_task_id": "document_projection_materialize",
                    "task_kind": "document_projection_materialize",
                    "executor_kind": "ts_control",
                    "input_contract": "authenticated_notice_source_truth.v1",
                    "output_contract": "authenticated_notice_document_projection.v1",
                },
                {
                    "registry_task_id": "read_model_materialize",
                    "task_kind": "read_model_materialize",
                    "executor_kind": "ts_control",
                    "input_contract": "authenticated_notice_document_projection.v1",
                    "output_contract": "internal_notice_read_model_projection.v1",
                },
                {
                    "registry_task_id": "derived_scope_materialize",
                    "task_kind": "derived_scope_materialize",
                    "executor_kind": "ts_control",
                    "input_contract": "authenticated_notice_source_truth.v1",
                    "output_contract": "institutional_regulations_candidate_scope.v1",
                },
            ],
        }

        result = validate_ingestion_task_registry(registry)

        self.assertFalse(result.ok)
        self.assertIn(
            "tasks[0].task_kind is not supported: document_projection_materialize",
            result.errors,
        )
        self.assertIn(
            "tasks[1].task_kind is not supported: read_model_materialize",
            result.errors,
        )
        self.assertIn(
            "tasks[2].task_kind is not supported: derived_scope_materialize",
            result.errors,
        )


if __name__ == "__main__":
    unittest.main()
