from __future__ import annotations

import json

from pathlib import Path
from tempfile import TemporaryDirectory

from campus_ingestion_core.object_store import (
    build_index_release_artifact_key,
    build_qdrant_backup_artifact_key,
)
from campus_ingestion_core.qdrant_backup_io import sha256_file

from campus_ingestion_core.qdrant_backup import (
    CollectionGcDeleteRequest,
    CollectionGcCheckRequest,
    _load_index_release_manifest,
    check_snapshot_gc_eligibility,
    delete_gc_eligible_collection,
)
from campus_ingestion_core.qdrant_backup_models import SnapshotBackupManifest

DERIVED_BUCKET = "campus-rag-derived"


def _write_native_snapshot_bundle(
    *,
    backup_root: Path,
    corpus: str,
    collection: str,
    release_id: str,
    backup_id: str,
    serving_alias: str,
    physical_collection_name: str,
    manifest_key: str,
    validation_summary_key: str | None = None,
    snapshot_bytes: bytes = b"snapshot",
) -> Path:
    bundle_dir = backup_root / corpus / collection / release_id / backup_id
    bundle_dir.mkdir(parents=True)
    snapshot_name = f"{physical_collection_name}.snapshot"
    snapshot_path = bundle_dir / snapshot_name
    snapshot_path.write_bytes(snapshot_bytes)
    snapshot_sha256 = sha256_file(str(snapshot_path))
    payload = {
        "schema_version": "qdrant_filesystem_snapshot_backup.v1",
        "backup_id": backup_id,
        "backup_mode": "qdrant_collection_snapshot_filesystem_export",
        "captured_at": "2026-04-01T01:02:03+00:00",
        "corpus": corpus,
        "collection": collection,
        "release_id": release_id,
        "serving_alias": serving_alias,
        "physical_collection_name": physical_collection_name,
        "alias_bindings": {serving_alias: physical_collection_name},
        "index_release_manifest_key": manifest_key,
        "validation_summary_key": validation_summary_key,
        "snapshot_file": snapshot_name,
        "snapshot_sha256": snapshot_sha256,
        "snapshot_size_bytes": snapshot_path.stat().st_size,
        "point_count": 20,
        "backup_reason": "pre-gc",
        "operator": "tester",
    }
    manifest_path = bundle_dir / "backup-manifest.json"
    manifest_path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8",
    )
    (bundle_dir / "sha256.txt").write_text(
        f"{snapshot_sha256}  {snapshot_name}\n",
        encoding="utf-8",
    )
    return manifest_path


class _FakeBackupObjectStore:
    def __init__(self) -> None:
        self.objects: dict[tuple[str, str], bytes] = {}
        self.fail_head_keys: set[tuple[str, str]] = set()
        self.deleted_objects: list[tuple[str, str]] = []

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self.objects[(bucket, key)] = data

    def upload_file(self, *, bucket: str, key: str, file_path: str, content_type: str) -> None:
        self.objects[(bucket, key)] = Path(file_path).read_bytes()

    def download_file(self, *, bucket: str, key: str, file_path: str) -> None:
        Path(file_path).write_bytes(self.objects[(bucket, key)])

    def head_object(self, *, bucket: str, key: str) -> dict[str, object]:
        if (bucket, key) in self.fail_head_keys:
            raise RuntimeError(f"head unavailable for {key}")
        data = self.objects[(bucket, key)]
        return {"ContentLength": len(data)}

    def list_keys(self, *, bucket: str, prefix: str) -> tuple[str, ...]:
        return tuple(
            sorted(
                key
                for object_bucket, key in self.objects
                if object_bucket == bucket and key.startswith(prefix)
            )
        )

    def delete_object(self, *, bucket: str, key: str) -> None:
        self.deleted_objects.append((bucket, key))
        self.objects.pop((bucket, key), None)


class _FakeQdrantSnapshotAdmin:
    def __init__(self) -> None:
        self.aliases: dict[str, str] = {}
        self.collections: set[str] = set()
        self.created_snapshots: list[tuple[str, str]] = []
        self.deleted_snapshots: list[tuple[str, str]] = []
        self.restored_snapshots: list[tuple[str, bytes, str | None]] = []
        self.deleted_collections: list[str] = []
        self.applied_aliases: list[dict[str, str]] = []
        self.points_count: dict[str, int] = {}
        self.release_payload: dict[str, dict[str, object]] = {}

    def create_collection_snapshot(self, collection_name: str) -> str:
        snapshot_name = f"{collection_name}-snapshot-001.snapshot"
        self.created_snapshots.append((collection_name, snapshot_name))
        return snapshot_name

    def download_collection_snapshot(
        self,
        *,
        collection_name: str,
        snapshot_name: str,
        target_path: str,
    ) -> None:
        Path(target_path).write_bytes(f"snapshot:{collection_name}:{snapshot_name}".encode())

    def delete_collection_snapshot(self, *, collection_name: str, snapshot_name: str) -> None:
        self.deleted_snapshots.append((collection_name, snapshot_name))

    def restore_collection_snapshot(
        self,
        *,
        collection_name: str,
        snapshot_path: str,
        checksum: str | None,
    ) -> None:
        snapshot_bytes = Path(snapshot_path).read_bytes()
        self.collections.add(collection_name)
        self.restored_snapshots.append((collection_name, snapshot_bytes, checksum))

    def resolve_alias_target(self, alias_name: str) -> str | None:
        return self.aliases.get(alias_name)

    def apply_alias_bindings(self, alias_bindings: dict[str, str]) -> None:
        self.aliases.update(alias_bindings)
        self.applied_aliases.append(dict(alias_bindings))

    def list_collections(self) -> tuple[str, ...]:
        return tuple(sorted(self.collections))

    def get_collection_points_count(self, collection_name: str) -> int | None:
        return self.points_count.get(collection_name)

    def get_release_payload(self, collection_name: str) -> dict[str, object]:
        return dict(self.release_payload.get(collection_name) or {})

    def delete_collection(self, collection_name: str) -> None:
        self.collections.discard(collection_name)
        self.deleted_collections.append(collection_name)


def _seed_release_manifest(
    *,
    object_store: _FakeBackupObjectStore,
    corpus: str,
    collection: str,
    release_id: str,
    physical_collection_name: str,
    previous_physical_collection_name: str | None,
    serving_alias: str,
    validation_summary_key: str | None = None,
    post_publish_audit_status: str = "",
    post_publish_audit_summary_key: str | None = None,
    component_eval_status: str = "",
    component_eval_summary_key: str | None = None,
    published_at: str | None = "2026-03-31T12:05:00+00:00",
) -> str:
    manifest_key = build_index_release_artifact_key(
        corpus=corpus,
        collection=collection,
        release_id=release_id,
        filename="index-release.json",
    )
    payload = {
        "release_id": release_id,
        "corpus": corpus,
        "collection": collection,
        "serving_alias": serving_alias,
        "physical_collection_name": physical_collection_name,
        "previous_physical_collection_name": previous_physical_collection_name,
        "cleaning_policy_version": "student-handbook-cleaning-v1",
        "chunk_policy_version": "student-handbook-semantic-v1",
        "embedding_model": "Qwen3-Embedding-4B",
        "indexed_at": "2026-03-31T12:00:00+00:00",
        "published_at": published_at,
        "document_count": 2,
        "point_count": 20,
        "document_version_ids_hash": "doc-hash",
        "document_units_keys_hash": "units-hash",
        "validation_status": "passed",
        "validation_summary_object_key": validation_summary_key,
        "component_eval_status": component_eval_status,
        "component_eval_summary_object_key": component_eval_summary_key,
        "post_publish_audit_status": post_publish_audit_status,
        "post_publish_audit_summary_object_key": post_publish_audit_summary_key,
        "documents": [],
    }
    object_store.put_bytes(
        bucket=DERIVED_BUCKET,
        key=manifest_key,
        data=(json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
        content_type="application/json",
    )
    if validation_summary_key is not None:
        object_store.put_bytes(
            bucket=DERIVED_BUCKET,
            key=validation_summary_key,
            data=b'{"status":"passed"}\n',
            content_type="application/json",
        )
    return manifest_key


__all__ = [name for name in globals() if not name.startswith("__")]
