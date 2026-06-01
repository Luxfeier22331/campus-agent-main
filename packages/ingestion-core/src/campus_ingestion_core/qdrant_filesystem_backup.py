from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path

from campus_retrieval_core.settings import RetrievalSettings

from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.object_store import build_index_release_artifact_key
from campus_ingestion_core.qdrant_backup import (
    QdrantSnapshotAdmin,
    SnapshotQdrantAdmin,
    default_backup_id,
)
from campus_ingestion_core.qdrant_backup_io import sha256_file, utc_now_iso
from campus_ingestion_core.qdrant_backup_manifest_helpers import _load_index_release_manifest
from campus_ingestion_core.settings import ObjectStoreSettings, resolve_object_store_bucket_names


@dataclass(frozen=True, slots=True)
class FilesystemSnapshotBackupRequest:
    corpus: str
    collection: str
    release_id: str
    output_root: Path
    operator: str
    backup_reason: str = "post-publish-protection"

    def __post_init__(self) -> None:
        if not self.corpus.strip():
            raise ValueError("corpus is required")
        if not self.collection.strip():
            raise ValueError("collection is required")
        if not self.release_id.strip():
            raise ValueError("release_id is required")
        if not self.operator.strip():
            raise ValueError("operator is required")
        if not self.backup_reason.strip():
            raise ValueError("backup_reason is required")
        object.__setattr__(self, "output_root", Path(self.output_root))


@dataclass(frozen=True, slots=True)
class FilesystemSnapshotBackupReport:
    backup_id: str
    bundle_dir: str
    corpus: str
    collection: str
    release_id: str
    physical_collection_name: str
    snapshot_path: str
    snapshot_sha256: str
    snapshot_size_bytes: int
    point_count: int
    manifest_path: str
    restore_command_path: str


def create_filesystem_snapshot_backup(
    *,
    request: FilesystemSnapshotBackupRequest,
    env: dict[str, str] | None = None,
    object_store=None,
    qdrant_admin: SnapshotQdrantAdmin | None = None,
    backup_id: str | None = None,
) -> FilesystemSnapshotBackupReport:
    source = dict(env if env is not None else os.environ)
    bucket_derived = resolve_object_store_bucket_names(source)[1]
    runtime_object_store = object_store or _build_object_store(source)
    runtime_qdrant_admin = qdrant_admin or QdrantSnapshotAdmin(RetrievalSettings.from_env(source))
    release_manifest = _load_index_release_manifest(
        object_store=runtime_object_store,
        bucket=bucket_derived,
        corpus=request.corpus,
        collection=request.collection,
        release_id=request.release_id,
    )
    release_manifest_key = build_index_release_artifact_key(
        corpus=request.corpus,
        collection=request.collection,
        release_id=request.release_id,
        filename="index-release.json",
    )
    _validate_current_release(
        qdrant_admin=runtime_qdrant_admin,
        serving_alias=release_manifest.serving_alias,
        physical_collection_name=release_manifest.physical_collection_name,
        release_id=release_manifest.release_id,
        release_manifest_key=release_manifest_key,
        expected_point_count=release_manifest.point_count,
    )
    runtime_backup_id = backup_id or default_backup_id()
    bundle_dir = (
        request.output_root
        / request.corpus
        / request.collection
        / request.release_id
        / runtime_backup_id
    )
    bundle_dir.mkdir(parents=True, exist_ok=False)
    snapshot_filename = f"{release_manifest.physical_collection_name}.snapshot"
    snapshot_path = bundle_dir / snapshot_filename
    snapshot_name = runtime_qdrant_admin.create_collection_snapshot(
        release_manifest.physical_collection_name
    )
    try:
        runtime_qdrant_admin.download_collection_snapshot(
            collection_name=release_manifest.physical_collection_name,
            snapshot_name=snapshot_name,
            target_path=str(snapshot_path),
        )
        snapshot_sha256 = sha256_file(str(snapshot_path))
        snapshot_size = snapshot_path.stat().st_size
        restore_command = _restore_command(
            request=request,
            backup_id=runtime_backup_id,
            snapshot_filename=snapshot_filename,
            checksum=snapshot_sha256,
        )
        manifest_payload = {
            "schema_version": "qdrant_filesystem_snapshot_backup.v1",
            "bucket": "filesystem",
            "source_bucket": bucket_derived,
            "backup_id": runtime_backup_id,
            "backup_mode": "qdrant_collection_snapshot_filesystem_export",
            "captured_at": utc_now_iso(),
            "corpus": request.corpus,
            "collection": request.collection,
            "release_id": request.release_id,
            "serving_alias": release_manifest.serving_alias,
            "physical_collection_name": release_manifest.physical_collection_name,
            "alias_bindings": {
                release_manifest.serving_alias: release_manifest.physical_collection_name
            },
            "index_release_manifest_key": release_manifest_key,
            "validation_summary_key": release_manifest.validation_summary_object_key,
            "snapshot_file": snapshot_filename,
            "snapshot_sha256": snapshot_sha256,
            "snapshot_size_bytes": snapshot_size,
            "point_count": release_manifest.point_count,
            "backup_reason": request.backup_reason,
            "operator": request.operator,
            "restore_command": restore_command,
        }
        manifest_path = bundle_dir / "backup-manifest.json"
        sha_path = bundle_dir / "sha256.txt"
        restore_path = bundle_dir / "restore-command.txt"
        manifest_path.write_text(
            json.dumps(manifest_payload, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        sha_path.write_text(f"{snapshot_sha256}  {snapshot_filename}\n", encoding="utf-8")
        restore_path.write_text(restore_command + "\n", encoding="utf-8")
    finally:
        runtime_qdrant_admin.delete_collection_snapshot(
            collection_name=release_manifest.physical_collection_name,
            snapshot_name=snapshot_name,
        )
    return FilesystemSnapshotBackupReport(
        backup_id=runtime_backup_id,
        bundle_dir=str(bundle_dir),
        corpus=request.corpus,
        collection=request.collection,
        release_id=request.release_id,
        physical_collection_name=release_manifest.physical_collection_name,
        snapshot_path=str(snapshot_path),
        snapshot_sha256=snapshot_sha256,
        snapshot_size_bytes=snapshot_size,
        point_count=release_manifest.point_count,
        manifest_path=str(manifest_path),
        restore_command_path=str(restore_path),
    )


def _validate_current_release(
    *,
    qdrant_admin: SnapshotQdrantAdmin,
    serving_alias: str,
    physical_collection_name: str,
    release_id: str,
    release_manifest_key: str,
    expected_point_count: int,
) -> None:
    alias_target = qdrant_admin.resolve_alias_target(serving_alias)
    errors: list[str] = []
    if alias_target != physical_collection_name:
        errors.append("alias_target_mismatch")
    if physical_collection_name not in qdrant_admin.list_collections():
        errors.append("collection_missing")
    points_count = qdrant_admin.get_collection_points_count(physical_collection_name)
    if points_count != expected_point_count:
        errors.append("points_count_mismatch")
    payload = qdrant_admin.get_release_payload(physical_collection_name)
    if payload.get("index_release_id") != release_id:
        errors.append("payload_release_id_mismatch")
    if payload.get("index_release_manifest_key") != release_manifest_key:
        errors.append("payload_manifest_key_mismatch")
    if payload.get("index_release_alias") != serving_alias:
        errors.append("payload_alias_mismatch")
    if errors:
        raise ValueError(",".join(errors))


def _restore_command(
    *,
    request: FilesystemSnapshotBackupRequest,
    backup_id: str,
    snapshot_filename: str,
    checksum: str,
) -> str:
    bundle_dir = (
        request.output_root / request.corpus / request.collection / request.release_id / backup_id
    )
    return (
        f"cd {bundle_dir} && "
        "QDRANT_URL=<target-url> QDRANT_API_KEY=<target-key> "
        "/srv/apps/campus-agent/infra/local/qdrant-native-snapshot.sh restore-collection "
        f"--collection <target-physical-collection> --snapshot {snapshot_filename} "
        "--manifest backup-manifest.json --apply-alias "
        f"# expected-sha256={checksum}"
    )


def _build_object_store(env: dict[str, str]):
    return S3ObjectStoreAdmin(ObjectStoreSettings.from_env(env))


__all__ = [
    "FilesystemSnapshotBackupReport",
    "FilesystemSnapshotBackupRequest",
    "create_filesystem_snapshot_backup",
]
