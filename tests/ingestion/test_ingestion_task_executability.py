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
    def test_python_guard_does_not_own_default_executor_inventory(self) -> None:
        guard_source = (REPO_ROOT / "scripts/check_ingestion_task_executability.py").read_text(
            encoding="utf-8"
        )

        self.assertNotIn("EXECUTABLE_TS_TASKS", guard_source)
        self.assertNotIn("EXECUTABLE_RUST_KERNELS", guard_source)
        self.assertNotIn(
            "official_web/official_web/stable_reference/source_truth_materialize",
            guard_source,
        )
        self.assertNotIn("validate-document-units", guard_source)

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
            _copy_default_executor_inventory(root)
            registry = root / "configs/ingestion/custom/new_collection/task-registry.v2.json"
            _write_registry(
                registry,
                {
                    "schema_version": "ingestion_task_registry.v2",
                    "source_family": "custom_family",
                    "corpus": "custom",
                    "collection": "new_collection",
                    "tasks": [
                        {
                            "registry_task_id": "custom_source_truth_materialize",
                            "task_kind": "source_truth_materialize",
                            "executor_kind": "ts_control",
                            "input_contract": "custom_source_truth.v1",
                            "output_contract": "custom_operator_projection.v1",
                        }
                    ],
                },
            )

            issues = audit_ingestion_task_executability(root=root)

        self.assertEqual(
            issues,
            (
                IngestionTaskExecutabilityIssue(
                    path="configs/ingestion/custom/new_collection/task-registry.v2.json",
                    task="custom_family/custom/new_collection/custom_source_truth_materialize",
                    message="registry-declared ts_control task has no default handler",
                ),
            ),
        )

    def test_audit_rejects_config_only_registry_reintroduction(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            _copy_default_executor_inventory(root)
            registry = (
                root / "configs/ingestion/campus_services/transport_schedule/task-registry.v2.json"
            )
            _write_registry(
                registry,
                {
                    "schema_version": "ingestion_task_registry.v2",
                    "source_family": "authenticated_notice",
                    "corpus": "campus_services",
                    "collection": "transport_schedule",
                    "tasks": [],
                },
            )

            issues = audit_ingestion_task_executability(root=root)

        self.assertIn(
            IngestionTaskExecutabilityIssue(
                path="configs/ingestion/campus_services/transport_schedule/task-registry.v2.json",
                task="<registry>",
                message=(
                    "config-only ingestion collection must not declare active "
                    "task-registry.v2.json without a real collection-specific handler"
                ),
            ),
            issues,
        )

    def test_audit_rejects_generic_materialization_handler_reintroduction(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            _copy_default_executor_inventory(root)
            handler = root / "apps/ingestion-control/src/default-handlers.ts"
            handler.parent.mkdir(parents=True, exist_ok=True)
            handler.write_text(
                "const token = 'createReportMaterializeHandler';\n",
                encoding="utf-8",
            )

            issues = audit_ingestion_task_executability(root=root)

        self.assertEqual(
            issues,
            (
                IngestionTaskExecutabilityIssue(
                    path="apps/ingestion-control/src/default-handlers.ts",
                    task="<generic-materialization-handler>",
                    message=(
                        "removed generic materialization token is not allowed: "
                        "createReportMaterializeHandler"
                    ),
                ),
            ),
        )

    def test_audit_rejects_custom_registry_task_without_default_handler(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            _copy_default_executor_inventory(root)
            registry = root / "configs/ingestion/custom/new_collection/task-registry.v2.json"
            _write_registry(
                registry,
                {
                    "schema_version": "ingestion_task_registry.v2",
                    "source_family": "custom_family",
                    "corpus": "custom",
                    "collection": "new_collection",
                    "tasks": [
                        {
                            "registry_task_id": "custom_source_truth_materialize",
                            "task_kind": "source_truth_materialize",
                            "executor_kind": "ts_control",
                            "input_contract": "custom_source_truth_bundle.v1",
                            "output_contract": "custom_source_truth.v1",
                        }
                    ],
                },
            )

            issues = audit_ingestion_task_executability(root=root)

        self.assertEqual(
            issues,
            (
                IngestionTaskExecutabilityIssue(
                    path="configs/ingestion/custom/new_collection/task-registry.v2.json",
                    task="custom_family/custom/new_collection/custom_source_truth_materialize",
                    message="registry-declared ts_control task has no default handler",
                ),
            ),
        )

    def test_audit_rejects_default_executor_contract_mismatch(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            _copy_default_executor_inventory(root)
            registry = (
                root / "configs/ingestion/official_web/stable_reference/task-registry.v2.json"
            )
            _write_registry(
                registry,
                {
                    "schema_version": "ingestion_task_registry.v2",
                    "source_family": "official_web",
                    "corpus": "official_web",
                    "collection": "stable_reference",
                    "tasks": [
                        {
                            "registry_task_id": "source_truth_materialize",
                            "task_kind": "source_truth_materialize",
                            "executor_kind": "ts_control",
                            "input_contract": "wrong_input.v1",
                            "output_contract": "official_web_stable_reference_source_truth.v1",
                        },
                        {
                            "registry_task_id": "chunk_prepare",
                            "task_kind": "chunk_prepare",
                            "executor_kind": "rust_kernel",
                            "kernel_id": "chunk-document-units",
                            "input_contract": "canonical_document_units.v1",
                            "output_contract": "wrong_output.v1",
                        },
                    ],
                },
            )

            issues = audit_ingestion_task_executability(root=root)

        self.assertEqual(
            issues,
            (
                IngestionTaskExecutabilityIssue(
                    path="configs/ingestion/official_web/stable_reference/task-registry.v2.json",
                    task="official_web/official_web/stable_reference/source_truth_materialize",
                    message=(
                        "registry-declared ts_control task contract does not match default handler"
                    ),
                ),
                IngestionTaskExecutabilityIssue(
                    path="configs/ingestion/official_web/stable_reference/task-registry.v2.json",
                    task="rust_kernel:chunk-document-units",
                    message=(
                        "registry-declared rust_kernel task contract does not match "
                        "default kernel bridge"
                    ),
                ),
            ),
        )

    def test_audit_rejects_rust_task_without_kernel_id(self) -> None:
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            _copy_default_executor_inventory(root)
            registry = root / "configs/ingestion/custom/new_collection/task-registry.v2.json"
            _write_registry(
                registry,
                {
                    "schema_version": "ingestion_task_registry.v2",
                    "source_family": "custom_family",
                    "corpus": "custom",
                    "collection": "new_collection",
                    "tasks": [
                        {
                            "registry_task_id": "document_units_validate",
                            "task_kind": "document_units_validate",
                            "executor_kind": "rust_kernel",
                            "input_contract": "canonical_document_units.v1",
                            "output_contract": "document_units_validation_report.v1",
                        }
                    ],
                },
            )

            issues = audit_ingestion_task_executability(root=root)

        self.assertEqual(
            issues,
            (
                IngestionTaskExecutabilityIssue(
                    path="configs/ingestion/custom/new_collection/task-registry.v2.json",
                    task="custom_family/custom/new_collection/document_units_validate",
                    message="registry-declared rust_kernel task is missing kernel_id",
                ),
            ),
        )

    def test_audit_rejects_removed_capture_executor_kind(self) -> None:
        task_kind = "source_" + "capture"
        executor_kind = "crawlee_" + "collector"
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            _copy_default_executor_inventory(root)
            registry = root / "configs/ingestion/custom/new_collection/task-registry.v2.json"
            _write_registry(
                registry,
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
                            "input_contract": "custom_capture_request.v1",
                            "output_contract": "custom_capture_release.v1",
                        }
                    ],
                },
            )

            issues = audit_ingestion_task_executability(root=root)

        self.assertEqual(
            issues,
            (
                IngestionTaskExecutabilityIssue(
                    path="configs/ingestion/custom/new_collection/task-registry.v2.json",
                    task=f"custom_family/custom/new_collection/{task_kind}",
                    message=f"unsupported ingestion task executor_kind: {executor_kind}",
                ),
            ),
        )

    def test_audit_rejects_removed_provider_executor_kind(self) -> None:
        task_kind = "provider_" + "extract"
        executor_kind = "provider_" + "activity"
        with tempfile.TemporaryDirectory() as tmp_dir:
            root = Path(tmp_dir)
            _copy_default_executor_inventory(root)
            registry = root / "configs/ingestion/custom/new_collection/task-registry.v2.json"
            _write_registry(
                registry,
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
                            "input_contract": "custom_provider_request.v1",
                            "output_contract": "custom_provider_result.v1",
                        }
                    ],
                },
            )

            issues = audit_ingestion_task_executability(root=root)

        self.assertEqual(
            issues,
            (
                IngestionTaskExecutabilityIssue(
                    path="configs/ingestion/custom/new_collection/task-registry.v2.json",
                    task=f"custom_family/custom/new_collection/{task_kind}",
                    message=f"unsupported ingestion task executor_kind: {executor_kind}",
                ),
            ),
        )


def _write_registry(path: Path, payload: object) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload), encoding="utf-8")


def _copy_default_executor_inventory(root: Path) -> None:
    source = REPO_ROOT / "packages/ingest-core/src/default-executor-inventory.v1.json"
    target = root / "packages/ingest-core/src/default-executor-inventory.v1.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
