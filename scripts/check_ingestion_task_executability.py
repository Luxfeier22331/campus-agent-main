from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

EXECUTABLE_TS_TASKS = frozenset(
    {
        "authenticated_notice/campus_notices/internal_notice/source_truth_materialize",
        "official_web/official_web/fresh_news/source_truth_materialize",
        "official_web/official_web/stable_reference/source_truth_materialize",
    }
)

EXECUTABLE_RUST_KERNELS = frozenset(
    {
        "chunk-document-units",
        "validate-document-units",
        "validate-release-manifest",
    }
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
            task_kind = str(task.get("task_kind", ""))
            executor_kind = str(task.get("executor_kind", ""))
            identity = _task_identity(
                source_family=source_family,
                corpus=corpus,
                collection=collection,
                task_kind=task_kind,
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
                        identity=identity,
                        executor_kind=executor_kind,
                        kernel_id=_string_or_none(task.get("kernel_id")),
                    ),
                )
            )
    return tuple(classifications)


def audit_ingestion_task_executability(
    *, root: Path | None = None
) -> tuple[IngestionTaskExecutabilityIssue, ...]:
    base = root or repo_root()
    issues: list[IngestionTaskExecutabilityIssue] = []
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
                        task_kind="<registry>",
                    ),
                    message="ingestion task registry tasks must be a list",
                )
            )
            continue
        for task in tasks:
            if not isinstance(task, dict):
                continue
            task_kind = str(task.get("task_kind", ""))
            executor_kind = str(task.get("executor_kind", ""))
            kernel_id = _string_or_none(task.get("kernel_id"))
            identity = _task_identity(
                source_family=source_family,
                corpus=corpus,
                collection=collection,
                task_kind=task_kind,
            )
            issue = _audit_task(
                identity=identity,
                executor_kind=executor_kind,
                kernel_id=kernel_id,
                path=registry_path.relative_to(base).as_posix(),
            )
            if issue:
                issues.append(issue)
    return tuple(issues)


def _audit_task(
    *,
    identity: str,
    executor_kind: str,
    kernel_id: str | None,
    path: str,
) -> IngestionTaskExecutabilityIssue | None:
    if executor_kind == "ts_control":
        if identity in EXECUTABLE_TS_TASKS:
            return None
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
        if kernel_id in EXECUTABLE_RUST_KERNELS:
            return None
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


def _task_status(*, identity: str, executor_kind: str, kernel_id: str | None) -> str:
    if executor_kind == "ts_control":
        if identity in EXECUTABLE_TS_TASKS:
            return "executable"
        return "invalid_registry"
    if executor_kind == "rust_kernel":
        if kernel_id is None:
            return "invalid_registry"
        if kernel_id in EXECUTABLE_RUST_KERNELS:
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
    task_kind: str,
) -> str:
    return f"{source_family}/{corpus}/{collection}/{task_kind}"


def _registry_paths(root: Path) -> tuple[Path, ...]:
    return tuple(sorted((root / "configs/ingestion").glob("*/*/task-registry.v1.json")))


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
