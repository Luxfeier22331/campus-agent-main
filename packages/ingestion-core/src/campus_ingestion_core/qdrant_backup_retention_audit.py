from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.qdrant_backup import (
    BackupObjectStore,
    CollectionGcCheckRequest,
    SnapshotQdrantAdmin,
    check_snapshot_gc_eligibility,
)
from campus_ingestion_core.qdrant_backup_manifest_helpers import (
    _load_snapshot_backup_manifest,
)
from campus_ingestion_core.settings import ObjectStoreSettings, resolve_object_store_bucket_names


@dataclass(frozen=True, slots=True)
class QdrantBackupRetentionAuditRequest:
    corpus: str
    collection: str
    output_dir: Path
    protected_physical_collection_names: tuple[str, ...] = ()
    manual_blockers: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if not self.corpus.strip():
            raise ValueError("corpus is required")
        if not self.collection.strip():
            raise ValueError("collection is required")
        object.__setattr__(self, "output_dir", Path(self.output_dir))


def audit_qdrant_backup_retention(
    *,
    request: QdrantBackupRetentionAuditRequest,
    env: dict[str, str] | None = None,
    object_store: BackupObjectStore | None = None,
    qdrant_admin: SnapshotQdrantAdmin | None = None,
) -> dict[str, Any]:
    source = dict(env if env is not None else os.environ)
    bucket_derived = resolve_object_store_bucket_names(source)[1]
    runtime_object_store = object_store or S3ObjectStoreAdmin(ObjectStoreSettings.from_env(source))
    if qdrant_admin is None:
        raise ValueError("qdrant_admin is required for backup retention audit")

    backup_manifest_keys = _list_backup_manifest_keys(
        object_store=runtime_object_store,
        bucket=bucket_derived,
        corpus=request.corpus,
        collection=request.collection,
    )
    rows: list[dict[str, object]] = []
    for key in backup_manifest_keys:
        release_id, backup_id = _release_and_backup_id_from_key(key)
        manifest = _load_snapshot_backup_manifest(
            object_store=runtime_object_store,
            bucket=bucket_derived,
            corpus=request.corpus,
            collection=request.collection,
            release_id=release_id,
            backup_id=backup_id,
        )
        try:
            eligibility = check_snapshot_gc_eligibility(
                request=CollectionGcCheckRequest(
                    corpus=request.corpus,
                    collection=request.collection,
                    release_id=release_id,
                    protected_physical_collection_names=request.protected_physical_collection_names,
                    manual_blockers=request.manual_blockers,
                ),
                env=source,
                object_store=runtime_object_store,
                qdrant_admin=qdrant_admin,
            )
            role = eligibility.role
            blockers = list(eligibility.blockers)
            eligible_for_collection_gc = eligibility.eligible
        except Exception as exc:
            role = "orphan_backup_manifest"
            blockers = ["missing_release_manifest"]
            eligible_for_collection_gc = False
            if not isinstance(exc, (KeyError, FileNotFoundError)):
                blockers.append(type(exc).__name__)

        rows.append(
            {
                "backup_id": manifest.backup_id,
                "backup_manifest_object_key": key,
                "backup_reason": manifest.backup_reason,
                "blockers": blockers,
                "captured_at": manifest.captured_at,
                "eligible_for_collection_gc": eligible_for_collection_gc,
                "physical_collection_name": manifest.physical_collection_name,
                "release_id": manifest.release_id,
                "role": role,
                "snapshot_object_key": manifest.snapshot_object_key,
            }
        )

    output_dir = request.output_dir
    output_dir.mkdir(parents=True, exist_ok=True)
    inventory_path = output_dir / "backup-retention-inventory.jsonl"
    summary_path = output_dir / "summary.json"
    _write_jsonl(inventory_path, rows)
    summary = {
        "archive_candidate_count": sum(1 for row in rows if row["role"] == "archive_candidate"),
        "backup_manifest_count": len(rows),
        "bucket": bucket_derived,
        "collection": request.collection,
        "corpus": request.corpus,
        "current_count": sum(1 for row in rows if row["role"] == "current"),
        "inventory_path": str(inventory_path),
        "migration_baseline_count": sum(1 for row in rows if row["role"] == "migration_baseline"),
        "orphan_backup_manifest_count": sum(
            1 for row in rows if row["role"] == "orphan_backup_manifest"
        ),
        "output_dir": str(output_dir),
        "previous_count": sum(1 for row in rows if row["role"] == "previous"),
    }
    summary_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    return summary


def _list_backup_manifest_keys(
    *,
    object_store: BackupObjectStore,
    bucket: str,
    corpus: str,
    collection: str,
) -> tuple[str, ...]:
    prefix = f"{corpus}/backups/{collection}/"
    return tuple(
        sorted(
            key
            for key in object_store.list_keys(bucket=bucket, prefix=prefix)
            if key.endswith("/backup-manifest.json")
        )
    )


def _release_and_backup_id_from_key(key: str) -> tuple[str, str]:
    parts = key.split("/")
    if len(parts) < 6:
        raise ValueError(f"invalid qdrant backup manifest key: {key}")
    return parts[3], parts[4]


def _write_jsonl(path: Path, rows: list[dict[str, object]]) -> None:
    if not rows:
        path.write_text("", encoding="utf-8")
        return
    path.write_text(
        "\n".join(json.dumps(row, ensure_ascii=False, sort_keys=True) for row in rows) + "\n",
        encoding="utf-8",
    )


__all__ = [
    "QdrantBackupRetentionAuditRequest",
    "audit_qdrant_backup_retention",
]
