from __future__ import annotations

import json
import os
from collections.abc import Mapping
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Protocol

from campus_retrieval_core.settings import RetrievalSettings

from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.qdrant_backup import QdrantSnapshotAdmin, SnapshotQdrantAdmin
from campus_ingestion_core.qdrant_backup_manifest_helpers import _load_snapshot_backup_manifest
from campus_ingestion_core.qdrant_backup_models import SnapshotBackupManifest
from campus_ingestion_core.settings import ObjectStoreSettings, resolve_object_store_bucket_names

_SCHEMA_VERSION = "qdrant_backup_cleanup_plan.v1"
_REPORT_SCHEMA_VERSION = "qdrant_backup_cleanup_report.v1"


class BackupCleanupObjectStore(Protocol):
    def delete_object(self, *, bucket: str, key: str) -> None: ...

    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def head_object(self, *, bucket: str, key: str) -> dict[str, object]: ...

    def list_keys(self, *, bucket: str, prefix: str) -> tuple[str, ...]: ...


@dataclass(frozen=True, slots=True)
class QdrantBackupCleanupPlanRequest:
    output_dir: Path
    current_aliases: Mapping[str, str] | None = None
    obsolete_families: tuple[str, ...] = ()
    protected_physical_collection_names: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "output_dir", Path(self.output_dir))
        object.__setattr__(
            self,
            "obsolete_families",
            tuple(_normalize_family(value) for value in self.obsolete_families),
        )
        object.__setattr__(
            self,
            "protected_physical_collection_names",
            tuple(
                sorted(
                    {
                        value.strip()
                        for value in self.protected_physical_collection_names
                        if value.strip()
                    }
                )
            ),
        )


@dataclass(frozen=True, slots=True)
class QdrantBackupCleanupPlanReport:
    inventory_path: str
    deletion_plan_path: str
    bucket: str
    inventory_object_count: int
    delete_candidate_count: int
    delete_candidate_bytes: int
    retained_object_count: int


@dataclass(frozen=True, slots=True)
class QdrantBackupCleanupReport:
    cleanup_report_path: str
    bucket: str
    deleted_count: int
    deleted_bytes: int
    remaining_backup_object_count: int
    remaining_backup_bytes: int


def build_qdrant_backup_cleanup_plan(
    *,
    request: QdrantBackupCleanupPlanRequest,
    env: dict[str, str] | None = None,
    object_store: BackupCleanupObjectStore | None = None,
    qdrant_admin: SnapshotQdrantAdmin | None = None,
) -> QdrantBackupCleanupPlanReport:
    source = dict(env if env is not None else os.environ)
    bucket = resolve_object_store_bucket_names(source)[1]
    runtime_object_store = object_store or S3ObjectStoreAdmin(ObjectStoreSettings.from_env(source))
    runtime_qdrant_admin = qdrant_admin or QdrantSnapshotAdmin(RetrievalSettings.from_env(source))
    backup_keys = _list_backup_keys(object_store=runtime_object_store, bucket=bucket)
    current_aliases = _resolve_current_aliases(
        explicit_aliases=request.current_aliases or {},
        backup_keys=backup_keys,
        bucket=bucket,
        object_store=runtime_object_store,
        qdrant_admin=runtime_qdrant_admin,
    )
    protected_names = set(request.protected_physical_collection_names)
    obsolete_families = set(request.obsolete_families)
    bundle_rows = _backup_bundle_rows(
        bucket=bucket,
        backup_keys=backup_keys,
        object_store=runtime_object_store,
    )
    inventory_rows: list[dict[str, object]] = []
    delete_rows: list[dict[str, object]] = []
    retained_rows: list[dict[str, object]] = []
    for row in bundle_rows:
        decision = _classify_backup_object(
            row=row,
            current_aliases=current_aliases,
            obsolete_families=obsolete_families,
            protected_physical_collection_names=protected_names,
        )
        inventory_row = {**row, **decision}
        inventory_rows.append(inventory_row)
        if decision["action"] == "delete":
            delete_rows.append(_deletion_row(inventory_row))
        else:
            retained_rows.append(inventory_row)

    output_dir = request.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    inventory_path = output_dir / "inventory.json"
    deletion_plan_path = output_dir / "deletion-plan.json"
    inventory_payload = {
        "schema_version": _SCHEMA_VERSION,
        "bucket": bucket,
        "current_aliases": dict(sorted(current_aliases.items())),
        "objects": inventory_rows,
    }
    deletion_plan = {
        "schema_version": _SCHEMA_VERSION,
        "bucket": bucket,
        "delete_candidate_count": len(delete_rows),
        "delete_candidate_bytes": sum(int(row["size_bytes"]) for row in delete_rows),
        "delete_candidates": delete_rows,
        "retained_object_count": len(retained_rows),
        "retained_objects": retained_rows,
    }
    _write_json(inventory_path, inventory_payload)
    _write_json(deletion_plan_path, deletion_plan)
    return QdrantBackupCleanupPlanReport(
        inventory_path=str(inventory_path),
        deletion_plan_path=str(deletion_plan_path),
        bucket=bucket,
        inventory_object_count=len(inventory_rows),
        delete_candidate_count=len(delete_rows),
        delete_candidate_bytes=sum(int(row["size_bytes"]) for row in delete_rows),
        retained_object_count=len(retained_rows),
    )


def execute_qdrant_backup_cleanup_plan(
    *,
    plan_path: Path,
    output_dir: Path | None = None,
    env: dict[str, str] | None = None,
    object_store: BackupCleanupObjectStore | None = None,
) -> QdrantBackupCleanupReport:
    source = dict(env if env is not None else os.environ)
    runtime_object_store = object_store or S3ObjectStoreAdmin(ObjectStoreSettings.from_env(source))
    plan = json.loads(Path(plan_path).read_text(encoding="utf-8"))
    if plan.get("schema_version") != _SCHEMA_VERSION:
        raise ValueError("unsupported qdrant backup cleanup plan schema_version")
    bucket = _required_text(plan, "bucket")
    rows = plan.get("delete_candidates")
    if not isinstance(rows, list):
        raise ValueError("delete_candidates must be a list")
    deleted_count = 0
    deleted_bytes = 0
    for item in rows:
        if not isinstance(item, dict):
            raise ValueError("delete candidate row must be an object")
        row_bucket = _required_text(item, "bucket")
        key = _required_text(item, "key")
        if row_bucket != bucket:
            raise ValueError(f"delete candidate bucket mismatch for {key}")
        if item.get("delete_mode") != "exact_object":
            raise ValueError(f"delete candidate {key} is not exact_object")
        _validate_backup_object_key(key)
        runtime_object_store.delete_object(bucket=bucket, key=key)
        deleted_count += 1
        deleted_bytes += int(item.get("size_bytes") or 0)

    remaining_keys = _list_backup_keys(object_store=runtime_object_store, bucket=bucket)
    remaining_bytes = sum(
        _object_size(object_store=runtime_object_store, bucket=bucket, key=key)
        for key in remaining_keys
    )
    report_dir = Path(output_dir) if output_dir is not None else Path(plan_path).parent
    report_dir.mkdir(parents=True, exist_ok=True)
    report_path = report_dir / "cleanup-report.json"
    report = QdrantBackupCleanupReport(
        cleanup_report_path=str(report_path),
        bucket=bucket,
        deleted_count=deleted_count,
        deleted_bytes=deleted_bytes,
        remaining_backup_object_count=len(remaining_keys),
        remaining_backup_bytes=remaining_bytes,
    )
    _write_json(
        report_path,
        {"schema_version": _REPORT_SCHEMA_VERSION, **asdict(report)},
    )
    return report


def _resolve_current_aliases(
    *,
    explicit_aliases: Mapping[str, str],
    backup_keys: tuple[str, ...],
    bucket: str,
    object_store: BackupCleanupObjectStore,
    qdrant_admin: SnapshotQdrantAdmin,
) -> dict[str, str]:
    aliases = {
        str(alias).strip(): str(collection).strip()
        for alias, collection in explicit_aliases.items()
        if str(alias).strip() and str(collection).strip()
    }
    serving_aliases: set[str] = set(aliases)
    for key in backup_keys:
        if not key.endswith("/backup-manifest.json"):
            continue
        corpus, collection, release_id, backup_id = _parse_backup_key(key)
        manifest = _load_snapshot_backup_manifest(
            object_store=object_store,
            bucket=bucket,
            corpus=corpus,
            collection=collection,
            release_id=release_id,
            backup_id=backup_id,
        )
        serving_aliases.add(manifest.serving_alias)
    for alias in sorted(serving_aliases):
        if alias in aliases:
            continue
        target = qdrant_admin.resolve_alias_target(alias)
        if target:
            aliases[alias] = target
    return aliases


def _backup_bundle_rows(
    *,
    bucket: str,
    backup_keys: tuple[str, ...],
    object_store: BackupCleanupObjectStore,
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    manifest_by_prefix = _load_manifest_by_prefix(
        bucket=bucket,
        backup_keys=backup_keys,
        object_store=object_store,
    )
    for key in backup_keys:
        _require_valid_backup_bundle(
            key=key,
            manifest_by_prefix=manifest_by_prefix,
            backup_keys=set(backup_keys),
        )
    for key in sorted(backup_keys):
        corpus, collection, release_id, backup_id = _parse_backup_key(key)
        prefix = "/".join([corpus, "backups", collection, release_id, backup_id]) + "/"
        manifest = manifest_by_prefix[prefix]
        rows.append(
            {
                "bucket": bucket,
                "key": key,
                "size_bytes": _object_size(object_store=object_store, bucket=bucket, key=key),
                "family": f"{corpus}/{collection}",
                "corpus": corpus,
                "collection": collection,
                "release_id": release_id,
                "backup_id": backup_id,
                "physical_collection_name": manifest.physical_collection_name,
                "serving_alias": manifest.serving_alias,
                "manifest_status": "loaded",
            }
        )
    return rows


def _load_manifest_by_prefix(
    *,
    bucket: str,
    backup_keys: tuple[str, ...],
    object_store: BackupCleanupObjectStore,
) -> dict[str, SnapshotBackupManifest]:
    manifests: dict[str, SnapshotBackupManifest] = {}
    for key in backup_keys:
        if not key.endswith("/backup-manifest.json"):
            continue
        corpus, collection, release_id, backup_id = _parse_backup_key(key)
        prefix = key.rsplit("/", 1)[0] + "/"
        manifests[prefix] = _load_snapshot_backup_manifest(
            object_store=object_store,
            bucket=bucket,
            corpus=corpus,
            collection=collection,
            release_id=release_id,
            backup_id=backup_id,
        )
    return manifests


def _require_valid_backup_bundle(
    *,
    key: str,
    manifest_by_prefix: Mapping[str, SnapshotBackupManifest],
    backup_keys: set[str],
) -> None:
    corpus, collection, release_id, backup_id = _parse_backup_key(key)
    prefix = "/".join([corpus, "backups", collection, release_id, backup_id]) + "/"
    manifest = manifest_by_prefix.get(prefix)
    if manifest is None:
        raise ValueError(f"missing backup-manifest.json for {prefix}")
    snapshot_key = str(getattr(manifest, "snapshot_object_key", ""))
    if snapshot_key not in backup_keys:
        raise ValueError(f"manifest snapshot object missing for {prefix}: {snapshot_key}")


def _classify_backup_object(
    *,
    row: dict[str, object],
    current_aliases: Mapping[str, str],
    obsolete_families: set[str],
    protected_physical_collection_names: set[str],
) -> dict[str, str]:
    family = str(row["family"])
    physical = str(row.get("physical_collection_name") or "")
    alias = str(row.get("serving_alias") or "")
    if physical and physical in protected_physical_collection_names:
        return {"action": "retain", "reason": "protected_physical_collection"}
    if physical and alias and current_aliases.get(alias) == physical:
        return {"action": "retain", "reason": "current_alias_target"}
    if family in obsolete_families:
        return {"action": "delete", "reason": "obsolete_family"}
    return {"action": "delete", "reason": "not_current_alias_target"}


def _deletion_row(row: dict[str, object]) -> dict[str, object]:
    return {
        "bucket": row["bucket"],
        "key": row["key"],
        "size_bytes": row["size_bytes"],
        "family": row["family"],
        "release_id": row["release_id"],
        "backup_id": row["backup_id"],
        "physical_collection_name": row["physical_collection_name"],
        "reason": row["reason"],
        "delete_mode": "exact_object",
    }


def _list_backup_keys(
    *,
    object_store: BackupCleanupObjectStore,
    bucket: str,
) -> tuple[str, ...]:
    return tuple(
        sorted(
            key for key in object_store.list_keys(bucket=bucket, prefix="") if "/backups/" in key
        )
    )


def _object_size(
    *,
    object_store: BackupCleanupObjectStore,
    bucket: str,
    key: str,
) -> int:
    metadata = object_store.head_object(bucket=bucket, key=key)
    value = metadata.get("ContentLength", metadata.get("content_length"))
    if value is None:
        raise ValueError(f"missing ContentLength for {bucket}/{key}")
    return int(value)


def _parse_backup_key(key: str) -> tuple[str, str, str, str]:
    _validate_backup_object_key(key)
    parts = key.split("/")
    return parts[0], parts[2], parts[3], parts[4]


def _validate_backup_object_key(key: str) -> None:
    parts = key.split("/")
    if len(parts) < 6 or parts[1] != "backups" or not parts[-1]:
        raise ValueError(f"invalid qdrant backup object key: {key}")
    if any(part in {"", ".", ".."} for part in parts):
        raise ValueError(f"invalid qdrant backup object key: {key}")


def _normalize_family(value: str) -> str:
    normalized = str(value or "").strip().strip("/")
    if normalized.count("/") != 1:
        raise ValueError(f"obsolete family must be corpus/collection: {value}")
    if any(part in {"", ".", ".."} for part in normalized.split("/")):
        raise ValueError(f"invalid obsolete family: {value}")
    return normalized


def _required_text(row: dict[str, object], field_name: str) -> str:
    value = row.get(field_name)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} is required")
    return value.strip()


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )


__all__ = [
    "QdrantBackupCleanupPlanReport",
    "QdrantBackupCleanupPlanRequest",
    "QdrantBackupCleanupReport",
    "build_qdrant_backup_cleanup_plan",
    "execute_qdrant_backup_cleanup_plan",
]
