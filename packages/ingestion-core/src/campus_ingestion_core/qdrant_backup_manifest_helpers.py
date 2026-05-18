from __future__ import annotations

import json
from typing import Protocol

from campus_ingestion_core.index_release import IndexReleaseManifest, load_index_release_manifest
from campus_ingestion_core.object_store import (
    build_index_release_artifact_key,
    build_operations_artifact_key,
    build_qdrant_backup_artifact_key,
)
from campus_ingestion_core.qdrant_backup_models import SnapshotBackupManifest


class BackupObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def list_keys(self, *, bucket: str, prefix: str) -> list[str]: ...


def _build_release_manifest_key(*, corpus: str, collection: str, release_id: str) -> str:
    return build_index_release_artifact_key(
        corpus=corpus,
        collection=collection,
        release_id=release_id,
        filename="index-release.json",
    )


def _load_index_release_manifest(
    *,
    object_store: BackupObjectStore,
    bucket: str,
    corpus: str,
    collection: str,
    release_id: str,
) -> IndexReleaseManifest:
    return load_index_release_manifest(
        reader=object_store,
        bucket=bucket,
        corpus=corpus,
        collection=collection,
        release_id=release_id,
    )


def _load_snapshot_backup_manifest(
    *,
    object_store: BackupObjectStore,
    bucket: str,
    corpus: str,
    collection: str,
    release_id: str,
    backup_id: str,
) -> SnapshotBackupManifest:
    backup_manifest_key = build_qdrant_backup_artifact_key(
        corpus=corpus,
        collection=collection,
        release_id=release_id,
        backup_id=backup_id,
        filename="backup-manifest.json",
    )
    payload = json.loads(
        object_store.get_bytes(bucket=bucket, key=backup_manifest_key).decode("utf-8")
    )
    return SnapshotBackupManifest(
        backup_id=str(payload["backup_id"]),
        backup_mode=str(payload["backup_mode"]),
        captured_at=str(payload["captured_at"]),
        corpus=str(payload["corpus"]),
        collection=str(payload["collection"]),
        release_id=str(payload["release_id"]),
        serving_alias=str(payload["serving_alias"]),
        physical_collection_name=str(payload["physical_collection_name"]),
        alias_bindings={
            str(key): str(value) for key, value in (payload.get("alias_bindings") or {}).items()
        },
        index_release_manifest_key=str(payload["index_release_manifest_key"]),
        validation_summary_key=(
            None
            if payload.get("validation_summary_key") is None
            else str(payload["validation_summary_key"])
        ),
        snapshot_object_key=str(payload["snapshot_object_key"]),
        snapshot_sha256=str(payload["snapshot_sha256"]),
        backup_reason=str(payload["backup_reason"]),
        operator=str(payload["operator"]),
    )


def _list_index_release_manifests(
    *,
    object_store: BackupObjectStore,
    bucket: str,
    corpus: str,
    collection: str,
) -> tuple[IndexReleaseManifest, ...]:
    prefix = "/".join([corpus, "releases", collection]) + "/"
    keys = [
        key
        for key in object_store.list_keys(bucket=bucket, prefix=prefix)
        if key.endswith("/index-release.json")
    ]
    return tuple(
        _load_index_release_manifest(
            object_store=object_store,
            bucket=bucket,
            corpus=corpus,
            collection=collection,
            release_id=key.split("/")[3],
        )
        for key in sorted(keys)
    )


def _find_backup_manifest_for_release(
    *,
    object_store: BackupObjectStore,
    bucket: str,
    corpus: str,
    collection: str,
    release_id: str,
    physical_collection_name: str,
) -> tuple[SnapshotBackupManifest | None, str | None]:
    prefix = "/".join([corpus, "backups", collection, release_id]) + "/"
    keys = [
        key
        for key in object_store.list_keys(bucket=bucket, prefix=prefix)
        if key.endswith("/backup-manifest.json")
    ]
    for key in sorted(keys, reverse=True):
        backup_id = key.split("/")[4]
        manifest = _load_snapshot_backup_manifest(
            object_store=object_store,
            bucket=bucket,
            corpus=corpus,
            collection=collection,
            release_id=release_id,
            backup_id=backup_id,
        )
        if manifest.physical_collection_name == physical_collection_name:
            return manifest, key
    return None, None


def _build_gc_delete_report_key(
    *,
    backup_manifest_object_key: str | None,
    corpus: str,
    collection: str,
    release_id: str,
) -> str:
    if backup_manifest_object_key:
        return backup_manifest_object_key.rsplit("/", 1)[0] + "/gc-delete-report.json"
    return build_operations_artifact_key(
        corpus=corpus,
        operation="qdrant_gc_delete",
        run_id=release_id,
        filename="gc-delete-report.json",
        segments=(collection,),
    )


def _remap_alias_bindings(
    *,
    alias_bindings: dict[str, str],
    original_collection_name: str,
    restored_collection_name: str,
) -> dict[str, str]:
    remapped: dict[str, str] = {}
    for alias_name, collection_name in alias_bindings.items():
        remapped[alias_name] = (
            restored_collection_name
            if collection_name == original_collection_name
            else collection_name
        )
    return remapped


__all__ = [
    "_build_gc_delete_report_key",
    "_build_release_manifest_key",
    "_find_backup_manifest_for_release",
    "_list_index_release_manifests",
    "_load_snapshot_backup_manifest",
    "_remap_alias_bindings",
]
