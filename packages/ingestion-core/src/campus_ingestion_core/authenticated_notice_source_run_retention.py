from __future__ import annotations

import json
import os
import sys
from collections import defaultdict
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Literal, Protocol, TextIO

from campus_ingestion_core.object_store import S3ObjectStoreClientFactory
from campus_ingestion_core.settings import ObjectStoreBucketSettings, ObjectStoreSettings

AUTHENTICATED_NOTICE_SOURCE_RUN_PREFIX = "authenticated_notice_portal/runs/"

DELETE_CANDIDATE_SOURCE_RUN_CLASSIFICATIONS = frozenset(
    {
        "delete_candidate_unreferenced_source_run",
        "delete_candidate_debug_source_run",
    }
)
PROTECTED_SOURCE_RUN_CLASSIFICATIONS = frozenset(
    {
        "protected_db_referenced_run",
        "protected_repo_referenced_run",
    }
)

AuthenticatedNoticeSourceRunClassification = Literal[
    "protected_db_referenced_run",
    "protected_repo_referenced_run",
    "delete_candidate_unreferenced_source_run",
    "delete_candidate_debug_source_run",
]


class AuthenticatedNoticeSourceRunListObjectStore(Protocol):
    def list_objects(
        self,
        *,
        bucket: str,
        prefix: str,
    ) -> tuple[AuthenticatedNoticeSourceRunObject, ...]: ...


class AuthenticatedNoticeSourceRunCleanupObjectStore(Protocol):
    def head_object(self, *, bucket: str, key: str) -> dict[str, Any]: ...

    def delete_object(self, *, bucket: str, key: str) -> None: ...


class AuthenticatedNoticeSourceRunS3ObjectStore:
    def __init__(self, settings: ObjectStoreSettings) -> None:
        self._client = S3ObjectStoreClientFactory(settings).create()

    def list_objects(
        self,
        *,
        bucket: str,
        prefix: str,
    ) -> tuple[AuthenticatedNoticeSourceRunObject, ...]:
        rows: list[AuthenticatedNoticeSourceRunObject] = []
        continuation_token: str | None = None
        while True:
            request: dict[str, object] = {"Bucket": bucket, "Prefix": prefix}
            if continuation_token is not None:
                request["ContinuationToken"] = continuation_token
            response = self._client.list_objects_v2(**request)
            for item in response.get("Contents") or ():
                rows.append(
                    AuthenticatedNoticeSourceRunObject(
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
class AuthenticatedNoticeSourceRunObject:
    bucket: str
    object_key: str
    byte_size: int
    last_modified: str | None = None

    def __post_init__(self) -> None:
        if not self.bucket:
            raise ValueError("bucket is required")
        if not self.object_key.startswith(AUTHENTICATED_NOTICE_SOURCE_RUN_PREFIX):
            raise ValueError(f"unsupported authenticated notice source run key: {self.object_key}")
        if self.byte_size < 0:
            raise ValueError("byte_size must be non-negative")

    @property
    def run_id(self) -> str:
        suffix = self.object_key[len(AUTHENTICATED_NOTICE_SOURCE_RUN_PREFIX) :]
        run_id, _, _ = suffix.partition("/")
        if not run_id:
            raise ValueError(f"source run key is missing run id: {self.object_key}")
        return run_id

    @property
    def relative_key(self) -> str:
        suffix = self.object_key[len(AUTHENTICATED_NOTICE_SOURCE_RUN_PREFIX) :]
        _, separator, relative_key = suffix.partition("/")
        if not separator or not relative_key:
            raise ValueError(f"source run key is missing run-relative path: {self.object_key}")
        return relative_key

    def to_inventory_row(self, *, classification: str, reason: str) -> dict[str, object]:
        return {
            "bucket": self.bucket,
            "byte_size": self.byte_size,
            "classification": classification,
            "last_modified": self.last_modified,
            "object_key": self.object_key,
            "reason": reason,
            "relative_key": self.relative_key,
            "run_id": self.run_id,
        }


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeSourceRun:
    run_id: str
    classification: AuthenticatedNoticeSourceRunClassification
    reason: str
    object_count: int
    byte_size: int
    first_modified: str | None = None
    last_modified: str | None = None
    relative_key_counts: dict[str, int] = field(default_factory=dict)

    @property
    def is_delete_candidate(self) -> bool:
        return self.classification in DELETE_CANDIDATE_SOURCE_RUN_CLASSIFICATIONS

    def to_inventory_row(self) -> dict[str, object]:
        return {
            "byte_size": self.byte_size,
            "classification": self.classification,
            "first_modified": self.first_modified,
            "last_modified": self.last_modified,
            "mib": round(self.byte_size / 1024 / 1024, 2),
            "object_count": self.object_count,
            "reason": self.reason,
            "relative_key_counts": dict(sorted(self.relative_key_counts.items())),
            "run_id": self.run_id,
        }


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeSourceRunRetentionAuditRequest:
    output_dir: Path

    def __post_init__(self) -> None:
        object.__setattr__(self, "output_dir", Path(self.output_dir))


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeSourceRunRetentionCleanupRequest:
    candidate_objects_path: Path
    output_dir: Path
    dry_run: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "candidate_objects_path", Path(self.candidate_objects_path))
        object.__setattr__(self, "output_dir", Path(self.output_dir))


def classify_authenticated_notice_source_runs(
    *,
    objects: Sequence[AuthenticatedNoticeSourceRunObject],
    db_referenced_run_ids: frozenset[str],
    repo_referenced_run_ids: frozenset[str],
) -> tuple[AuthenticatedNoticeSourceRun, ...]:
    objects_by_run: dict[str, list[AuthenticatedNoticeSourceRunObject]] = defaultdict(list)
    for item in objects:
        objects_by_run[item.run_id].append(item)
    runs: list[AuthenticatedNoticeSourceRun] = []
    for run_id, run_objects in objects_by_run.items():
        classification, reason = _classify_run(
            run_id=run_id,
            db_referenced_run_ids=db_referenced_run_ids,
            repo_referenced_run_ids=repo_referenced_run_ids,
        )
        first_modified: str | None = None
        last_modified: str | None = None
        relative_key_counts: dict[str, int] = {}
        for item in run_objects:
            relative_key_counts[item.relative_key] = (
                relative_key_counts.get(item.relative_key, 0) + 1
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
            AuthenticatedNoticeSourceRun(
                run_id=run_id,
                classification=classification,
                reason=reason,
                object_count=len(run_objects),
                byte_size=sum(item.byte_size for item in run_objects),
                first_modified=first_modified,
                last_modified=last_modified,
                relative_key_counts=relative_key_counts,
            )
        )
    return tuple(sorted(runs, key=lambda run: (-run.byte_size, run.run_id)))


def audit_authenticated_notice_source_run_retention(
    *,
    request: AuthenticatedNoticeSourceRunRetentionAuditRequest,
    env: dict[str, str] | None = None,
    object_store: AuthenticatedNoticeSourceRunListObjectStore | None = None,
    objects: Sequence[AuthenticatedNoticeSourceRunObject] | None = None,
    db_referenced_run_ids: frozenset[str] | None = None,
    repo_referenced_run_ids: frozenset[str] | None = None,
) -> dict[str, Any]:
    source = env if env is not None else dict(os.environ)
    settings = _bucket_settings_from_env(source)
    runtime_objects = (
        tuple(objects)
        if objects is not None
        else _list_runtime_objects(settings=settings, object_store=object_store)
    )
    runs = classify_authenticated_notice_source_runs(
        objects=runtime_objects,
        db_referenced_run_ids=db_referenced_run_ids or frozenset(),
        repo_referenced_run_ids=repo_referenced_run_ids or frozenset(),
    )
    run_by_id = {run.run_id: run for run in runs}
    delete_candidate_runs = tuple(run for run in runs if run.is_delete_candidate)
    protected_runs = tuple(
        run for run in runs if run.classification in PROTECTED_SOURCE_RUN_CLASSIFICATIONS
    )
    delete_candidate_run_ids = frozenset(run.run_id for run in delete_candidate_runs)

    output_dir = request.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    run_inventory_path = output_dir / "run-inventory.jsonl"
    protected_runs_path = output_dir / "protected-runs.jsonl"
    delete_candidate_runs_path = output_dir / "delete-candidate-runs.jsonl"
    delete_candidate_objects_path = output_dir / "delete-candidate-objects.jsonl"
    summary_path = output_dir / "summary.json"

    _write_jsonl(run_inventory_path, [run.to_inventory_row() for run in runs])
    _write_jsonl(protected_runs_path, [run.to_inventory_row() for run in protected_runs])
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
    summary = {
        "bucket": settings.bucket_source,
        "byte_size": sum(item.byte_size for item in runtime_objects),
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
        "delete_candidate_object_count": sum(
            1 for item in runtime_objects if item.run_id in delete_candidate_run_ids
        ),
        "delete_candidate_objects_path": str(delete_candidate_objects_path),
        "delete_candidate_run_count": len(delete_candidate_runs),
        "delete_candidate_runs_path": str(delete_candidate_runs_path),
        "mib": round(sum(item.byte_size for item in runtime_objects) / 1024 / 1024, 2),
        "object_count": len(runtime_objects),
        "output_dir": str(output_dir),
        "prefix": AUTHENTICATED_NOTICE_SOURCE_RUN_PREFIX,
        "protected_run_count": len(protected_runs),
        "protected_runs_path": str(protected_runs_path),
        "run_count": len(runs),
        "run_inventory_path": str(run_inventory_path),
    }
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return summary


def cleanup_authenticated_notice_source_runs(
    *,
    request: AuthenticatedNoticeSourceRunRetentionCleanupRequest,
    env: dict[str, str] | None = None,
    object_store: AuthenticatedNoticeSourceRunCleanupObjectStore | None = None,
    stderr: TextIO | None = None,
) -> dict[str, Any]:
    source = env if env is not None else dict(os.environ)
    settings = _bucket_settings_from_env(source)
    cleanup_store = object_store or AuthenticatedNoticeSourceRunS3ObjectStore(
        ObjectStoreSettings.from_env(source)
    )
    log_output = stderr if stderr is not None else sys.stderr
    candidates = _load_delete_candidate_object_rows(
        request.candidate_objects_path,
        expected_bucket=settings.bucket_source,
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
                bucket=settings.bucket_source,
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
                    "[authenticated-notice-source-run-cleanup] "
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
        "already_absent_count": len(already_absent_rows),
        "already_absent_inventory_path": str(already_absent_path),
        "bucket": settings.bucket_source,
        "candidate_byte_size": sum(int(row.get("byte_size") or 0) for row in candidates),
        "candidate_count": len(candidates),
        "candidate_objects_path": str(request.candidate_objects_path),
        "deleted_count": len(deleted_rows),
        "deleted_inventory_path": str(deleted_path),
        "dry_run": request.dry_run,
        "dry_run_count": len(dry_run_rows),
        "dry_run_inventory_path": str(dry_run_path),
        "output_dir": str(output_dir),
        "prefix": AUTHENTICATED_NOTICE_SOURCE_RUN_PREFIX,
    }
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return summary


def _classify_run(
    *,
    run_id: str,
    db_referenced_run_ids: frozenset[str],
    repo_referenced_run_ids: frozenset[str],
) -> tuple[AuthenticatedNoticeSourceRunClassification, str]:
    if run_id in db_referenced_run_ids:
        return "protected_db_referenced_run", "database references this source run"
    if run_id in repo_referenced_run_ids:
        return "protected_repo_referenced_run", "repo evidence references this source run"
    if _is_debug_run_id(run_id):
        return (
            "delete_candidate_debug_source_run",
            "debug/probe/smoke source run has no DB or repo reference",
        )
    return (
        "delete_candidate_unreferenced_source_run",
        "source run has no DB or repo reference",
    )


def _is_debug_run_id(run_id: str) -> bool:
    normalized = run_id.lower()
    return any(token in normalized for token in ("debug", "probe", "smoke", "eval", "local"))


def _list_runtime_objects(
    *,
    settings: ObjectStoreBucketSettings,
    object_store: AuthenticatedNoticeSourceRunListObjectStore | None,
) -> tuple[AuthenticatedNoticeSourceRunObject, ...]:
    runtime_store = object_store or AuthenticatedNoticeSourceRunS3ObjectStore(
        ObjectStoreSettings.from_env()
    )
    return runtime_store.list_objects(
        bucket=settings.bucket_source,
        prefix=AUTHENTICATED_NOTICE_SOURCE_RUN_PREFIX,
    )


def _bucket_settings_from_env(env: Mapping[str, str]) -> ObjectStoreBucketSettings:
    return ObjectStoreBucketSettings(
        bucket_source=(env.get("OBJECT_STORE_BUCKET_SOURCE") or "campus-agent-source").strip(),
        bucket_derived=(env.get("OBJECT_STORE_BUCKET_DERIVED") or "campus-agent-derived").strip(),
    )


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False, sort_keys=True) for row in rows) + "\n",
        encoding="utf-8",
    )


def _normalize_optional_text(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


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
        if not object_key.startswith(AUTHENTICATED_NOTICE_SOURCE_RUN_PREFIX):
            raise ValueError(f"{path}:{index} is outside authenticated notice source run prefix")
        if classification not in DELETE_CANDIDATE_SOURCE_RUN_CLASSIFICATIONS:
            raise ValueError(f"{path}:{index} is not a delete candidate: {classification}")
        candidates.append(dict(row))
    return tuple(sorted(candidates, key=lambda row: str(row["object_key"])))


def _delete_candidate_object(
    *,
    bucket: str,
    object_key: str,
    object_store: AuthenticatedNoticeSourceRunCleanupObjectStore,
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
                "deleted_byte_size": byte_size,
                "etag": etag,
                "status": "deleted",
            }
        raise
    raise ValueError(f"{object_key} still exists after delete")


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
    "AUTHENTICATED_NOTICE_SOURCE_RUN_PREFIX",
    "AuthenticatedNoticeSourceRun",
    "AuthenticatedNoticeSourceRunObject",
    "AuthenticatedNoticeSourceRunRetentionAuditRequest",
    "AuthenticatedNoticeSourceRunRetentionCleanupRequest",
    "audit_authenticated_notice_source_run_retention",
    "classify_authenticated_notice_source_runs",
    "cleanup_authenticated_notice_source_runs",
]
