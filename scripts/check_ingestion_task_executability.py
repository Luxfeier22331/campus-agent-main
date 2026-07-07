from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

CONFIG_ONLY_COLLECTION_DIRS = frozenset(
    {
        "configs/ingestion/campus_services/transport_schedule",
        "configs/ingestion/curriculum/course_facts",
        "configs/ingestion/curriculum/program_family_facts",
        "configs/ingestion/curriculum/program_semester_facts",
    }
)

REMOVED_GENERIC_MATERIALIZATION_HANDLER_FILES = (
    "apps/ingestion-control/src/materialization-report.ts",
)

REMOVED_GENERIC_MATERIALIZATION_TOKENS = (
    "createReportMaterializeHandler",
    "ingestion_materialization_report.v1",
    "materializationObjectStore",
)


@dataclass(frozen=True, slots=True)
class IngestionTaskExecutabilityIssue:
    path: str
    task: str
    message: str


@dataclass(frozen=True, slots=True)
class IngestionTaskExecutabilityClassification:
    path: str
    identity: str
    executor_kind: str
    status: str


def repo_root() -> Path:
    return Path(__file__).resolve().parents[1]


def classify_ingestion_task_executability(
    *, root: Path | None = None
) -> tuple[IngestionTaskExecutabilityClassification, ...]:
    base = root or repo_root()
    inventory = _load_default_executor_inventory(base)
    classifications: list[IngestionTaskExecutabilityClassification] = []
    for registry_path in _registry_paths(base):
        registry = _load_json_object(registry_path)
        source_family = str(registry.get("source_family", ""))
        corpus = str(registry.get("corpus", ""))
        collection = str(registry.get("collection", ""))
        tasks = registry.get("tasks", [])
        if not isinstance(tasks, list):
            continue
        for task in tasks:
            if not isinstance(task, dict):
                continue
            registry_task_id = str(task.get("registry_task_id", ""))
            executor_kind = str(task.get("executor_kind", ""))
            input_contract = str(task.get("input_contract", ""))
            output_contract = str(task.get("output_contract", ""))
            identity = _task_identity(
                source_family=source_family,
                corpus=corpus,
                collection=collection,
                registry_task_id=registry_task_id,
            )
            classifications.append(
                IngestionTaskExecutabilityClassification(
                    path=registry_path.relative_to(base).as_posix(),
                    identity=_classification_identity(
                        identity=identity,
                        executor_kind=executor_kind,
                        kernel_id=_string_or_none(task.get("kernel_id")),
                    ),
                    executor_kind=executor_kind,
                    status=_task_status(
                        inventory=inventory,
                        identity=identity,
                        executor_kind=executor_kind,
                        kernel_id=_string_or_none(task.get("kernel_id")),
                        input_contract=input_contract,
                        output_contract=output_contract,
                    ),
                )
            )
    return tuple(classifications)


def audit_ingestion_task_executability(
    *, root: Path | None = None
) -> tuple[IngestionTaskExecutabilityIssue, ...]:
    base = root or repo_root()
    inventory = _load_default_executor_inventory(base)
    issues: list[IngestionTaskExecutabilityIssue] = []
    issues.extend(_audit_config_only_collection_dirs(base))
    issues.extend(_audit_removed_generic_materialization_handler(base))
    for registry_path in _registry_paths(base):
        registry = _load_json_object(registry_path)
        source_family = str(registry.get("source_family", ""))
        corpus = str(registry.get("corpus", ""))
        collection = str(registry.get("collection", ""))
        tasks = registry.get("tasks", [])
        if not isinstance(tasks, list):
            issues.append(
                IngestionTaskExecutabilityIssue(
                    path=registry_path.relative_to(base).as_posix(),
                    task=_task_identity(
                        source_family=source_family,
                        corpus=corpus,
                        collection=collection,
                        registry_task_id="<registry>",
                    ),
                    message="ingestion task registry tasks must be a list",
                )
            )
            continue
        for task in tasks:
            if not isinstance(task, dict):
                continue
            registry_task_id = str(task.get("registry_task_id", ""))
            executor_kind = str(task.get("executor_kind", ""))
            input_contract = str(task.get("input_contract", ""))
            output_contract = str(task.get("output_contract", ""))
            kernel_id = _string_or_none(task.get("kernel_id"))
            identity = _task_identity(
                source_family=source_family,
                corpus=corpus,
                collection=collection,
                registry_task_id=registry_task_id,
            )
            issue = _audit_task(
                inventory=inventory,
                identity=identity,
                executor_kind=executor_kind,
                input_contract=input_contract,
                kernel_id=kernel_id,
                output_contract=output_contract,
                path=registry_path.relative_to(base).as_posix(),
            )
            if issue:
                issues.append(issue)
    return tuple(issues)


def _audit_config_only_collection_dirs(
    root: Path,
) -> tuple[IngestionTaskExecutabilityIssue, ...]:
    issues: list[IngestionTaskExecutabilityIssue] = []
    for relative_dir in sorted(CONFIG_ONLY_COLLECTION_DIRS):
        registry_path = root / relative_dir / "task-registry.v2.json"
        if not registry_path.exists():
            continue
        issues.append(
            IngestionTaskExecutabilityIssue(
                path=registry_path.relative_to(root).as_posix(),
                task="<registry>",
                message=(
                    "config-only ingestion collection must not declare active "
                    "task-registry.v2.json without a real collection-specific handler"
                ),
            )
        )
    return tuple(issues)


def _audit_removed_generic_materialization_handler(
    root: Path,
) -> tuple[IngestionTaskExecutabilityIssue, ...]:
    issues: list[IngestionTaskExecutabilityIssue] = []
    for relative_file in REMOVED_GENERIC_MATERIALIZATION_HANDLER_FILES:
        path = root / relative_file
        if path.exists():
            issues.append(
                IngestionTaskExecutabilityIssue(
                    path=relative_file,
                    task="<generic-materialization-handler>",
                    message=(
                        "generic materialization report handlers must stay removed; "
                        "add a collection-specific handler with contract artifacts instead"
                    ),
                )
            )
    source_root = root / "apps/ingestion-control/src"
    if not source_root.exists():
        return tuple(issues)
    for path in sorted(source_root.rglob("*.ts")):
        text = path.read_text(encoding="utf-8")
        for token in REMOVED_GENERIC_MATERIALIZATION_TOKENS:
            if token not in text:
                continue
            issues.append(
                IngestionTaskExecutabilityIssue(
                    path=path.relative_to(root).as_posix(),
                    task="<generic-materialization-handler>",
                    message=f"removed generic materialization token is not allowed: {token}",
                )
            )
    return tuple(issues)


def _audit_task(
    *,
    inventory: _DefaultExecutorInventory,
    identity: str,
    executor_kind: str,
    input_contract: str,
    kernel_id: str | None,
    output_contract: str,
    path: str,
) -> IngestionTaskExecutabilityIssue | None:
    if executor_kind == "ts_control":
        contract = inventory.ts_tasks.get(identity)
        if contract == _TaskContract(
            input_contract=input_contract, output_contract=output_contract
        ):
            return None
        if contract is not None:
            return IngestionTaskExecutabilityIssue(
                path=path,
                task=identity,
                message="registry-declared ts_control task contract does not match default handler",
            )
        return IngestionTaskExecutabilityIssue(
            path=path,
            task=identity,
            message="registry-declared ts_control task has no default handler",
        )
    if executor_kind == "rust_kernel":
        if not kernel_id:
            return IngestionTaskExecutabilityIssue(
                path=path,
                task=identity,
                message="registry-declared rust_kernel task is missing kernel_id",
            )
        contract = inventory.rust_kernels.get(kernel_id)
        if contract == _TaskContract(
            input_contract=input_contract, output_contract=output_contract
        ):
            return None
        if contract is not None:
            return IngestionTaskExecutabilityIssue(
                path=path,
                task=f"rust_kernel:{kernel_id}",
                message=(
                    "registry-declared rust_kernel task contract does not match "
                    "default kernel bridge"
                ),
            )
        return IngestionTaskExecutabilityIssue(
            path=path,
            task=f"rust_kernel:{kernel_id}",
            message="registry-declared rust_kernel task has no default kernel bridge",
        )
    return IngestionTaskExecutabilityIssue(
        path=path,
        task=identity,
        message=f"unsupported ingestion task executor_kind: {executor_kind}",
    )


def _task_status(
    *,
    inventory: _DefaultExecutorInventory,
    identity: str,
    executor_kind: str,
    input_contract: str,
    kernel_id: str | None,
    output_contract: str,
) -> str:
    if executor_kind == "ts_control":
        contract = inventory.ts_tasks.get(identity)
        if contract == _TaskContract(
            input_contract=input_contract, output_contract=output_contract
        ):
            return "executable"
        return "invalid_registry"
    if executor_kind == "rust_kernel":
        if kernel_id is None:
            return "invalid_registry"
        contract = inventory.rust_kernels.get(kernel_id)
        if contract == _TaskContract(
            input_contract=input_contract, output_contract=output_contract
        ):
            return "executable"
        return "invalid_registry"
    return "invalid_registry"


def _classification_identity(*, identity: str, executor_kind: str, kernel_id: str | None) -> str:
    if executor_kind == "rust_kernel" and kernel_id:
        return f"rust_kernel:{kernel_id}"
    return identity


def _task_identity(
    *,
    source_family: str,
    corpus: str,
    collection: str,
    registry_task_id: str,
) -> str:
    return f"{source_family}/{corpus}/{collection}/{registry_task_id}"


@dataclass(frozen=True, slots=True)
class _DefaultExecutorInventory:
    ts_tasks: dict[str, _TaskContract]
    rust_kernels: dict[str, _TaskContract]


@dataclass(frozen=True, slots=True)
class _TaskContract:
    input_contract: str
    output_contract: str


def _load_default_executor_inventory(root: Path) -> _DefaultExecutorInventory:
    payload = _load_json_object(
        root / "packages/ingest-core/src/default-executor-inventory.v1.json"
    )
    if payload.get("schema_version") != "ingest_core_default_executor_inventory.v1":
        raise ValueError("invalid ingest-core default executor inventory schema_version")
    ts_tasks = payload.get("ts_tasks")
    rust_kernels = payload.get("rust_kernels")
    if not isinstance(ts_tasks, list):
        raise ValueError("ingest-core default executor inventory ts_tasks must be a list")
    if not isinstance(rust_kernels, list):
        raise ValueError("ingest-core default executor inventory rust_kernels must be a list")
    return _DefaultExecutorInventory(
        ts_tasks={
            _task_identity_from_inventory_entry(entry): _task_contract_from_inventory_entry(entry)
            for entry in ts_tasks
        },
        rust_kernels={
            _required_inventory_text(entry, "kernelId"): _task_contract_from_inventory_entry(entry)
            for entry in rust_kernels
            if isinstance(entry, dict)
        },
    )


def _task_identity_from_inventory_entry(entry: object) -> str:
    if not isinstance(entry, dict):
        raise ValueError("ingest-core default TS task identity must be an object")
    return _task_identity(
        source_family=_required_inventory_text(entry, "sourceFamily"),
        corpus=_required_inventory_text(entry, "corpus"),
        collection=_required_inventory_text(entry, "collection"),
        registry_task_id=_required_inventory_text(entry, "registryTaskId"),
    )


def _task_contract_from_inventory_entry(entry: object) -> _TaskContract:
    if not isinstance(entry, dict):
        raise ValueError("ingest-core default executor inventory entry must be an object")
    return _TaskContract(
        input_contract=_required_inventory_text(entry, "inputContract"),
        output_contract=_required_inventory_text(entry, "outputContract"),
    )


def _required_inventory_text(entry: dict[str, object], key: str) -> str:
    value = entry.get(key)
    if not isinstance(value, str) or not value:
        raise ValueError(f"ingest-core default TS task identity {key} is required")
    return value


def _registry_paths(root: Path) -> tuple[Path, ...]:
    return tuple(sorted((root / "configs/ingestion").glob("*/*/task-registry.v2.json")))


def _load_json_object(path: Path) -> dict[str, Any]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"expected object in {path}")
    return payload


def _string_or_none(value: object) -> str | None:
    if isinstance(value, str) and value:
        return value
    return None


def main() -> int:
    issues = audit_ingestion_task_executability()
    for issue in issues:
        print(f"{issue.path}: {issue.task}: {issue.message}")
    return 1 if issues else 0


if __name__ == "__main__":
    raise SystemExit(main())
