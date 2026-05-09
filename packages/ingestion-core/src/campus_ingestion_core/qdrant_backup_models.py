from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class SnapshotBackupManifest:
    backup_id: str
    backup_mode: str
    captured_at: str
    corpus: str
    collection: str
    release_id: str
    serving_alias: str
    physical_collection_name: str
    alias_bindings: dict[str, str]
    index_release_manifest_key: str
    validation_summary_key: str | None
    snapshot_object_key: str
    snapshot_sha256: str
    backup_reason: str
    operator: str
