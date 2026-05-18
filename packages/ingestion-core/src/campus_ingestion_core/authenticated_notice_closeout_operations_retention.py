from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Protocol, TextIO

from campus_ingestion_core.object_store import S3ObjectStoreClientFactory
from campus_ingestion_core.settings import ObjectStoreBucketSettings, ObjectStoreSettings

AUTHENTICATED_NOTICE_CLOSEOUT_OPERATIONS_PREFIX = (
    "campus_notices/operations/authenticated-notice-closeout/"
)
DELETE_CANDIDATE_CLASSIFICATIONS = frozenset(
    {
        "delete_candidate_unreferenced_legacy_run",
        "delete_candidate_debug_probe_run",
    }
)
PROTECTED_CLASSIFICATIONS = frozenset(
    {
        "protected_documented_evidence",
        "protected_db_done_run",
        "protected_registry_referenced_run",
    }
)
REVIEW_CLASSIFICATIONS = frozenset({"review_db_non_promoted_run"})

CloseoutOperationRunClassification = Literal[
    "protected_documented_evidence",
    "protected_db_done_run",
    "protected_registry_referenced_run",
    "review_db_non_promoted_run",
    "delete_candidate_unreferenced_legacy_run",
    "delete_candidate_debug_probe_run",
]


class AuthenticatedNoticeCloseoutOperationsListObjectStore(Protocol):
    def list_objects(
        self,
        *,
        bucket: str,
        prefix: str,
    ) -> tuple[AuthenticatedNoticeCloseoutOperationObject, ...]: ...


class AuthenticatedNoticeCloseoutOperationsCleanupObjectStore(Protocol):
    def head_object(self, *, bucket: str, key: str) -> dict[str, Any]: ...

    def delete_object(self, *, bucket: str, key: str) -> None: ...


class AuthenticatedNoticeCloseoutOperationsS3ObjectStore:
    def __init__(self, settings: ObjectStoreSettings) -> None:
        self._client = S3ObjectStoreClientFactory(settings).create()

    def list_objects(
        self,
        *,
        bucket: str,
        prefix: str,
    ) -> tuple[AuthenticatedNoticeCloseoutOperationObject, ...]:
        rows: list[AuthenticatedNoticeCloseoutOperationObject] = []
        continuation_token: str | None = None
        while True:
            request: dict[str, object] = {"Bucket": bucket, "Prefix": prefix}
            if continuation_token is not None:
                request["ContinuationToken"] = continuation_token
            response = self._client.list_objects_v2(**request)
            for item in response.get("Contents") or ():
                rows.append(
                    AuthenticatedNoticeCloseoutOperationObject(
                        bucket=bucket,
                        object_key=str(item["Key"]),
                        byte_size=int(item.get("Size") or 0),
                        last_modified=_normalize_optional_text(item.get("LastModified")),
                    )
                )
            if not response.get("IsTruncated"):
                break
            continuation_token = response.get("NextContinuationToken")
        return tuple(rows)

    def head_object(self, *, bucket: str, key: str) -> dict[str, Any]:
        return dict(self._client.head_object(Bucket=bucket, Key=key))

    def delete_object(self, *, bucket: str, key: str) -> None:
        self._client.delete_object(Bucket=bucket, Key=key)


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeCloseoutOperationObject:
    bucket: str
    object_key: str
    byte_size: int
    last_modified: str | None = None

    def __post_init__(self) -> None:
        if not self.bucket:
            raise ValueError("bucket is required")
        if not self.object_key.startswith(AUTHENTICATED_NOTICE_CLOSEOUT_OPERATIONS_PREFIX):
            raise ValueError(
                f"unsupported authenticated notice closeout object key: {self.object_key}"
            )
        if self.byte_size < 0:
            raise ValueError("byte_size must be non-negative")

    @property
    def run_id(self) -> str:
        suffix = self.object_key[len(AUTHENTICATED_NOTICE_CLOSEOUT_OPERATIONS_PREFIX) :]
        run_id, _, _ = suffix.partition("/")
        if not run_id:
            raise ValueError(f"closeout object key is missing run id: {self.object_key}")
        return run_id

    @property
    def relative_key(self) -> str:
        suffix = self.object_key[len(AUTHENTICATED_NOTICE_CLOSEOUT_OPERATIONS_PREFIX) :]
        _, separator, relative_key = suffix.partition("/")
        if not separator or not relative_key:
            raise ValueError(f"closeout object key is missing run-relative path: {self.object_key}")
        return relative_key

    @property
    def category(self) -> str:
        relative_key = self.relative_key
        if relative_key == "run-manifest.json":
            return "run_manifest"
        if relative_key in {"shard-plan.json", "batch-plan.json"}:
            return "plan"
        if relative_key.startswith("batches/") and relative_key.endswith("/input.json"):
            return "batch_input"
        if relative_key.startswith("batches/") and relative_key.endswith("/manifest.json"):
            return "batch_manifest"
        if relative_key.startswith("workers/"):
            return "worker"
        if relative_key.startswith("heartbeat/"):
            return "heartbeat"
        if relative_key.startswith("milestones/"):
            return "milestone"
        if relative_key.startswith("reconciliation/"):
            return "reconciliation"
        if relative_key.startswith(("promotions/", "promotion-batches/")):
            return "promotion"
        if relative_key.startswith("staging/"):
            return "staging"
        if relative_key.startswith("inputs/"):
            return "input_snapshot"
        return relative_key.split("/", 1)[0]

    def to_inventory_row(
        self,
        *,
        classification: str,
        reason: str,
    ) -> dict[str, Any]:
        return {
            "bucket": self.bucket,
            "object_key": self.object_key,
            "run_id": self.run_id,
            "relative_key": self.relative_key,
            "category": self.category,
            "byte_size": self.byte_size,
            "last_modified": self.last_modified,
            "classification": classification,
            "reason": reason,
        }


@dataclass(frozen=True, slots=True)
class CloseoutDbRunState:
    run_id: str
    state: str
    promotion_state: str | None = None
    promotion_phase: str | None = None

    def __post_init__(self) -> None:
        if not self.run_id:
            raise ValueError("run_id is required")
        if not self.state:
            raise ValueError("state is required")

    @property
    def is_done_with_done_promotion(self) -> bool:
        return (
            self.state == "done"
            and (self.promotion_state or "") == "done"
            and (self.promotion_phase or "") == "done"
        )


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeCloseoutOperationRun:
    run_id: str
    classification: CloseoutOperationRunClassification
    reason: str
    object_count: int
    byte_size: int
    category_counts: dict[str, int] = field(default_factory=dict)
    category_byte_sizes: dict[str, int] = field(default_factory=dict)
    first_modified: str | None = None
    last_modified: str | None = None

    @property
    def is_delete_candidate(self) -> bool:
        return self.classification in DELETE_CANDIDATE_CLASSIFICATIONS

    def to_inventory_row(self) -> dict[str, Any]:
        return {
            "run_id": self.run_id,
            "classification": self.classification,
            "reason": self.reason,
            "object_count": self.object_count,
            "byte_size": self.byte_size,
            "mib": round(self.byte_size / 1024 / 1024, 2),
            "category_counts": dict(sorted(self.category_counts.items())),
            "category_byte_sizes": dict(sorted(self.category_byte_sizes.items())),
            "first_modified": self.first_modified,
            "last_modified": self.last_modified,
        }


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeCloseoutOperationsAuditRequest:
    output_dir: Path

    def __post_init__(self) -> None:
        object.__setattr__(self, "output_dir", Path(self.output_dir))


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeCloseoutOperationsCleanupRequest:
    candidate_objects_path: Path
    output_dir: Path
    dry_run: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "candidate_objects_path", Path(self.candidate_objects_path))
        object.__setattr__(self, "output_dir", Path(self.output_dir))


def classify_authenticated_notice_closeout_operation_runs(
    *,
    objects: Sequence[AuthenticatedNoticeCloseoutOperationObject],
    db_runs: Mapping[str, CloseoutDbRunState],
    repo_referenced_run_ids: frozenset[str],
    registry_referenced_run_ids: frozenset[str],
) -> tuple[AuthenticatedNoticeCloseoutOperationRun, ...]:
    objects_by_run: dict[str, list[AuthenticatedNoticeCloseoutOperationObject]] = defaultdict(list)
    for item in objects:
        objects_by_run[item.run_id].append(item)
    runs: list[AuthenticatedNoticeCloseoutOperationRun] = []
    for run_id, run_objects in objects_by_run.items():
        classification, reason = _classify_run(
            run_id=run_id,
            db_run=db_runs.get(run_id),
            repo_referenced_run_ids=repo_referenced_run_ids,
            registry_referenced_run_ids=registry_referenced_run_ids,
        )
        category_counts: dict[str, int] = {}
        category_byte_sizes: dict[str, int] = {}
        first_modified: str | None = None
        last_modified: str | None = None
        for item in run_objects:
            category_counts[item.category] = category_counts.get(item.category, 0) + 1
            category_byte_sizes[item.category] = (
                category_byte_sizes.get(item.category, 0) + item.byte_size
            )
            if item.last_modified is not None:
                first_modified = (
                    item.last_modified
                    if first_modified is None or item.last_modified < first_modified
                    else first_modified
                )
                last_modified = (
                    item.last_modified
                    if last_modified is None or item.last_modified > last_modified
                    else last_modified
                )
        runs.append(
            AuthenticatedNoticeCloseoutOperationRun(
                run_id=run_id,
                classification=classification,
                reason=reason,
                object_count=len(run_objects),
                byte_size=sum(item.byte_size for item in run_objects),
                category_counts=category_counts,
                category_byte_sizes=category_byte_sizes,
                first_modified=first_modified,
                last_modified=last_modified,
            )
        )
    return tuple(sorted(runs, key=lambda run: (-run.byte_size, run.run_id)))


def audit_authenticated_notice_closeout_operations_retention(
    *,
    request: AuthenticatedNoticeCloseoutOperationsAuditRequest,
    env: dict[str, str] | None = None,
    object_store: AuthenticatedNoticeCloseoutOperationsListObjectStore | None = None,
    objects: Sequence[AuthenticatedNoticeCloseoutOperationObject] | None = None,
    db_runs: Mapping[str, CloseoutDbRunState] | None = None,
    repo_referenced_run_ids: frozenset[str] | None = None,
    registry_referenced_run_ids: frozenset[str] | None = None,
) -> dict[str, Any]:
    source = env if env is not None else dict(os.environ)
    settings = _bucket_settings_from_env(source)
    runtime_objects = (
        tuple(objects)
        if objects is not None
        else _list_runtime_objects(settings=settings, object_store=object_store)
    )
    runtime_db_runs = dict(db_runs or {})
    runtime_repo_references = repo_referenced_run_ids or frozenset()
    runtime_registry_references = registry_referenced_run_ids or frozenset()
    runs = classify_authenticated_notice_closeout_operation_runs(
        objects=runtime_objects,
        db_runs=runtime_db_runs,
        repo_referenced_run_ids=runtime_repo_references,
        registry_referenced_run_ids=runtime_registry_references,
    )
    run_by_id = {run.run_id: run for run in runs}
    delete_candidate_runs = tuple(run for run in runs if run.is_delete_candidate)
    protected_runs = tuple(run for run in runs if run.classification in PROTECTED_CLASSIFICATIONS)
    review_required_runs = tuple(
        run for run in runs if run.classification in REVIEW_CLASSIFICATIONS
    )
    delete_candidate_run_ids = frozenset(run.run_id for run in delete_candidate_runs)

    output_dir = request.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    run_inventory_path = output_dir / "run-inventory.jsonl"
    protected_runs_path = output_dir / "protected-runs.jsonl"
    review_required_runs_path = output_dir / "review-required-runs.jsonl"
    delete_candidate_runs_path = output_dir / "delete-candidate-runs.jsonl"
    delete_candidate_objects_path = output_dir / "delete-candidate-objects.jsonl"
    top_objects_path = output_dir / "top-objects.jsonl"
    summary_path = output_dir / "summary.json"

    _write_jsonl(run_inventory_path, [run.to_inventory_row() for run in runs])
    _write_jsonl(protected_runs_path, [run.to_inventory_row() for run in protected_runs])
    _write_jsonl(
        review_required_runs_path, [run.to_inventory_row() for run in review_required_runs]
    )
    _write_jsonl(
        delete_candidate_runs_path,
        [run.to_inventory_row() for run in delete_candidate_runs],
    )
    _write_jsonl(
        delete_candidate_objects_path,
        [
            item.to_inventory_row(
                classification=run_by_id[item.run_id].classification,
                reason=run_by_id[item.run_id].reason,
            )
            for item in sorted(runtime_objects, key=lambda obj: obj.object_key)
            if item.run_id in delete_candidate_run_ids
        ],
    )
    _write_jsonl(
        top_objects_path,
        [
            item.to_inventory_row(
                classification=run_by_id[item.run_id].classification,
                reason=run_by_id[item.run_id].reason,
            )
            for item in sorted(runtime_objects, key=lambda obj: (-obj.byte_size, obj.object_key))[
                :100
            ]
        ],
    )
    summary = {
        "bucket": settings.bucket_derived,
        "prefix": AUTHENTICATED_NOTICE_CLOSEOUT_OPERATIONS_PREFIX,
        "object_count": len(runtime_objects),
        "byte_size": sum(item.byte_size for item in runtime_objects),
        "mib": round(sum(item.byte_size for item in runtime_objects) / 1024 / 1024, 2),
        "run_count": len(runs),
        "protected_run_count": len(protected_runs),
        "review_required_run_count": len(review_required_runs),
        "delete_candidate_run_count": len(delete_candidate_runs),
        "delete_candidate_object_count": sum(
            1 for item in runtime_objects if item.run_id in delete_candidate_run_ids
        ),
        "delete_candidate_byte_size": sum(
            item.byte_size for item in runtime_objects if item.run_id in delete_candidate_run_ids
        ),
        "delete_candidate_mib": round(
            sum(
                item.byte_size
                for item in runtime_objects
                if item.run_id in delete_candidate_run_ids
            )
            / 1024
            / 1024,
            2,
        ),
        "output_dir": str(output_dir),
        "run_inventory_path": str(run_inventory_path),
        "protected_runs_path": str(protected_runs_path),
        "review_required_runs_path": str(review_required_runs_path),
        "delete_candidate_runs_path": str(delete_candidate_runs_path),
        "delete_candidate_objects_path": str(delete_candidate_objects_path),
        "top_objects_path": str(top_objects_path),
    }
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return summary


def cleanup_authenticated_notice_closeout_operations(
    *,
    request: AuthenticatedNoticeCloseoutOperationsCleanupRequest,
    env: dict[str, str] | None = None,
    object_store: AuthenticatedNoticeCloseoutOperationsCleanupObjectStore | None = None,
    stderr: TextIO | None = None,
) -> dict[str, Any]:
    source = env if env is not None else dict(os.environ)
    settings = _bucket_settings_from_env(source)
    cleanup_store = object_store or AuthenticatedNoticeCloseoutOperationsS3ObjectStore(
        ObjectStoreSettings.from_env(source)
    )
    log_output = stderr if stderr is not None else sys.stderr
    candidates = _load_delete_candidate_object_rows(
        request.candidate_objects_path,
        expected_bucket=settings.bucket_derived,
    )
    output_dir = request.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    deleted_path = output_dir / "deleted-objects.jsonl"
    already_absent_path = output_dir / "already-absent-objects.jsonl"
    dry_run_path = output_dir / "dry-run-objects.jsonl"
    summary_path = output_dir / "summary.json"

    deleted_rows: list[dict[str, Any]] = []
    already_absent_rows: list[dict[str, Any]] = []
    dry_run_rows: list[dict[str, Any]] = []
    total = len(candidates)
    for completed, candidate in enumerate(candidates, start=1):
        object_key = str(candidate["object_key"])
        if request.dry_run:
            result = {**candidate, "status": "dry_run"}
        else:
            result = _delete_candidate_object(
                bucket=settings.bucket_derived,
                object_key=object_key,
                object_store=cleanup_store,
                candidate=candidate,
            )
        if result["status"] == "deleted":
            deleted_rows.append(result)
        elif result["status"] == "already_absent":
            already_absent_rows.append(result)
        elif result["status"] == "dry_run":
            dry_run_rows.append(result)
        else:  # pragma: no cover
            raise ValueError(f"unsupported cleanup status: {result['status']}")
        if completed == total or completed % 250 == 0:
            print(
                (
                    "[authenticated-notice-closeout-operations-cleanup] "
                    f"completed={completed}/{total} deleted={len(deleted_rows)} "
                    f"already_absent={len(already_absent_rows)}"
                ),
                file=log_output,
            )

    _write_jsonl(deleted_path, sorted(deleted_rows, key=lambda row: str(row["object_key"])))
    _write_jsonl(
        already_absent_path,
        sorted(already_absent_rows, key=lambda row: str(row["object_key"])),
    )
    _write_jsonl(dry_run_path, sorted(dry_run_rows, key=lambda row: str(row["object_key"])))
    summary = {
        "candidate_objects_path": str(request.candidate_objects_path),
        "output_dir": str(output_dir),
        "bucket": settings.bucket_derived,
        "prefix": AUTHENTICATED_NOTICE_CLOSEOUT_OPERATIONS_PREFIX,
        "dry_run": request.dry_run,
        "candidate_count": len(candidates),
        "candidate_byte_size": sum(int(row.get("byte_size") or 0) for row in candidates),
        "deleted_count": len(deleted_rows),
        "already_absent_count": len(already_absent_rows),
        "dry_run_count": len(dry_run_rows),
        "deleted_inventory_path": str(deleted_path),
        "already_absent_inventory_path": str(already_absent_path),
        "dry_run_inventory_path": str(dry_run_path),
    }
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return summary


def _classify_run(
    *,
    run_id: str,
    db_run: CloseoutDbRunState | None,
    repo_referenced_run_ids: frozenset[str],
    registry_referenced_run_ids: frozenset[str],
) -> tuple[CloseoutOperationRunClassification, str]:
    if run_id in registry_referenced_run_ids:
        return (
            "protected_registry_referenced_run",
            "document registry still references this operations run",
        )
    if run_id in repo_referenced_run_ids:
        return (
            "protected_documented_evidence",
            "repo documentation or planning artifacts explicitly reference this run",
        )
    if db_run is not None:
        if db_run.is_done_with_done_promotion:
            return (
                "protected_db_done_run",
                "closeout database records a completed promoted run",
            )
        return (
            "review_db_non_promoted_run",
            f"closeout database still records non-promoted state {db_run.state}",
        )
    if _is_debug_probe_run_id(run_id):
        return (
            "delete_candidate_debug_probe_run",
            "run id is debug/probe/smoke/eval/local and has no DB, registry, or repo reference",
        )
    return (
        "delete_candidate_unreferenced_legacy_run",
        "run has no DB, registry, or repo reference",
    )


def _is_debug_probe_run_id(run_id: str) -> bool:
    normalized = run_id.lower()
    tokens = ("debug", "probe", "smoke", "eval-", "local-")
    return any(token in normalized for token in tokens)


def _list_runtime_objects(
    *,
    settings: ObjectStoreBucketSettings,
    object_store: AuthenticatedNoticeCloseoutOperationsListObjectStore | None,
) -> tuple[AuthenticatedNoticeCloseoutOperationObject, ...]:
    if object_store is None:
        runtime_store = AuthenticatedNoticeCloseoutOperationsS3ObjectStore(
            ObjectStoreSettings.from_env()
        )
    else:
        runtime_store = object_store
    return runtime_store.list_objects(
        bucket=settings.bucket_derived,
        prefix=AUTHENTICATED_NOTICE_CLOSEOUT_OPERATIONS_PREFIX,
    )


def _load_delete_candidate_object_rows(
    path: Path,
    *,
    expected_bucket: str,
) -> tuple[dict[str, Any], ...]:
    rows = _load_jsonl_rows(path)
    candidates: list[dict[str, Any]] = []
    for index, row in enumerate(rows, start=1):
        object_key = _required_text(row.get("object_key"), label=f"{path}:{index}:object_key")
        bucket = _required_text(row.get("bucket"), label=f"{path}:{index}:bucket")
        classification = _required_text(
            row.get("classification"),
            label=f"{path}:{index}:classification",
        )
        if bucket != expected_bucket:
            raise ValueError(f"{path}:{index} targets bucket {bucket}, expected {expected_bucket}")
        if not object_key.startswith(AUTHENTICATED_NOTICE_CLOSEOUT_OPERATIONS_PREFIX):
            raise ValueError(f"{path}:{index} is outside authenticated notice closeout prefix")
        if classification not in DELETE_CANDIDATE_CLASSIFICATIONS:
            raise ValueError(f"{path}:{index} is not a delete candidate: {classification}")
        candidates.append(dict(row))
    return tuple(sorted(candidates, key=lambda row: str(row["object_key"])))


def _delete_candidate_object(
    *,
    bucket: str,
    object_key: str,
    object_store: AuthenticatedNoticeCloseoutOperationsCleanupObjectStore,
    candidate: dict[str, Any],
) -> dict[str, Any]:
    try:
        metadata = object_store.head_object(bucket=bucket, key=object_key)
    except Exception as exc:
        if _is_missing_object_error(exc):
            return {**candidate, "status": "already_absent"}
        raise
    byte_size = _coerce_content_length(metadata, label=object_key)
    etag = _normalize_optional_text(_read_head_field(metadata, "ETag", "etag"))
    object_store.delete_object(bucket=bucket, key=object_key)
    try:
        object_store.head_object(bucket=bucket, key=object_key)
    except Exception as exc:
        if _is_missing_object_error(exc):
            return {
                **candidate,
                "status": "deleted",
                "deleted_byte_size": byte_size,
                "etag": etag,
            }
        raise
    raise ValueError(f"{object_key} still exists after delete")


def _bucket_settings_from_env(env: dict[str, str]) -> ObjectStoreBucketSettings:
    return ObjectStoreBucketSettings(
        bucket_source=(env.get("OBJECT_STORE_BUCKET_SOURCE") or "campus-rag-source").strip(),
        bucket_derived=(env.get("OBJECT_STORE_BUCKET_DERIVED") or "campus-rag-derived").strip(),
    )


def _load_jsonl_rows(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise ValueError(f"inventory does not exist: {path}")
    rows: list[dict[str, Any]] = []
    for line_number, line in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        if not line.strip():
            continue
        payload = json.loads(line)
        if not isinstance(payload, dict):
            raise ValueError(f"{path}:{line_number} must be a JSON object")
        rows.append(payload)
    return rows


def _write_jsonl(path: Path, rows: Iterable[dict[str, Any]]) -> None:
    materialized = list(rows)
    if not materialized:
        path.write_text("", encoding="utf-8")
        return
    path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False) for row in materialized) + "\n",
        encoding="utf-8",
    )


def _required_text(value: object, *, label: str) -> str:
    normalized = _normalize_optional_text(value)
    if normalized is None:
        raise ValueError(f"{label} is required")
    return normalized


def _read_head_field(metadata: dict[str, Any], *names: str) -> object | None:
    for name in names:
        if name in metadata:
            return metadata[name]
    return None


def _coerce_content_length(metadata: dict[str, Any], *, label: str) -> int:
    value = _read_head_field(metadata, "ContentLength", "content_length")
    if value is None:
        raise ValueError(f"{label} missing content length in head_object response")
    return int(value)


def _normalize_optional_text(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _is_missing_object_error(exc: Exception) -> bool:
    if isinstance(exc, KeyError):
        return True
    response = getattr(exc, "response", None)
    if not isinstance(response, dict):
        return False
    error = response.get("Error")
    if not isinstance(error, dict):
        return False
    code = str(error.get("Code") or "").strip()
    return code in {"404", "NoSuchKey", "NotFound"}


__all__ = [
    "AUTHENTICATED_NOTICE_CLOSEOUT_OPERATIONS_PREFIX",
    "DELETE_CANDIDATE_CLASSIFICATIONS",
    "AuthenticatedNoticeCloseoutOperationObject",
    "AuthenticatedNoticeCloseoutOperationRun",
    "AuthenticatedNoticeCloseoutOperationsAuditRequest",
    "AuthenticatedNoticeCloseoutOperationsCleanupRequest",
    "AuthenticatedNoticeCloseoutOperationsS3ObjectStore",
    "CloseoutDbRunState",
    "audit_authenticated_notice_closeout_operations_retention",
    "classify_authenticated_notice_closeout_operation_runs",
    "cleanup_authenticated_notice_closeout_operations",
]
