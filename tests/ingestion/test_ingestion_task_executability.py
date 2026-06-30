from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from scripts.check_ingestion_task_executability import (
    IngestionTaskExecutabilityIssue,
    audit_ingestion_task_executability,
    classify_ingestion_task_executability,
)

REPO_ROOT = Path(__file__).resolve().parents[2]


class IngestionTaskExecutabilitySuite(unittest.TestCase):
    def test_current_registry_tasks_are_executable(self) -> None:
        issues = audit_ingestion_task_executability(root=REPO_ROOT)

        self.assertEqual(issues, ())

    def test_current_registry_classification_only_contains_executable_tasks(self) -> None:
        classifications = classify_ingestion_task_executability(root=REPO_ROOT)
        by_identity = {item.identity: item.status for item in classifications}

        self.assertEqual({item.status for item in classifications}, {"executable"})
        self.assertEqual(
            by_identity[
                "authenticated_notice/campus_notices/internal_notice/source_truth_materialize"
            ],
            "executable",
        )
        self.assertEqual(
            by_identity["rust_kernel:validate-document-units"],
            "executable",
        )

    def test_audit_rejects_new_ts_task_without_explicit_executability_status(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            registry = root / "configs/ingestion/custom/new_collection/task-registry.v1.json"
            _write_registry(
                registry,
                {
                    "schema_version": "ingestion_task_registry.v1",
                    "source_family": "custom_family",
                    "corpus": "custom",
                    "collection": "new_collection",
                    "tasks": [
                        {
                            "task_kind": "source_truth_materialize",
                            "executor_kind": "ts_control",
                            "input_contract": "custom_source_truth.v1",
                            "output_contract": "custom_operator_projection.v1",
                            "can_publish_alias": False,
                        }
                    ],
                },
            )

            issues = audit_ingestion_task_executability(root=root)

        self.assertEqual(
            issues,
            (
                IngestionTaskExecutabilityIssue(
                    path="configs/ingestion/custom/new_collection/task-registry.v1.json",
                    task="custom_family/custom/new_collection/source_truth_materialize",
                    message="registry-declared ts_control task has no default handler",
                ),
            ),
        )

    def test_audit_rejects_rust_task_without_kernel_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            registry = root / "configs/ingestion/custom/new_collection/task-registry.v1.json"
            _write_registry(
                registry,
                {
                    "schema_version": "ingestion_task_registry.v1",
                    "source_family": "custom_family",
                    "corpus": "custom",
                    "collection": "new_collection",
                    "tasks": [
                        {
                            "task_kind": "document_units_validate",
                            "executor_kind": "rust_kernel",
                            "input_contract": "canonical_document_units.v1",
                            "output_contract": "document_units_validation_report.v1",
                            "can_publish_alias": False,
                        }
                    ],
                },
            )

            issues = audit_ingestion_task_executability(root=root)

        self.assertEqual(
            issues,
            (
                IngestionTaskExecutabilityIssue(
                    path="configs/ingestion/custom/new_collection/task-registry.v1.json",
                    task="custom_family/custom/new_collection/document_units_validate",
                    message="registry-declared rust_kernel task is missing kernel_id",
                ),
            ),
        )


def _write_registry(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")
