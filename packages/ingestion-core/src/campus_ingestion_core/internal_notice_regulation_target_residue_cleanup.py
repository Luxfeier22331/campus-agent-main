from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol


class RegulationTargetResidueRegistry(Protocol):
    def find_exact(
        self, *, collection: str, document_id: str, version_id: str
    ) -> list[dict[str, Any]]: ...

    def delete_exact(
        self,
        *,
        collection: str,
        document_id: str,
        version_id: str,
    ) -> list[dict[str, Any]]: ...

    def find_title_matches(self, *, title: str) -> list[dict[str, Any]]: ...


class RegulationTargetResidueObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def exists(self, bucket: str, key: str) -> bool: ...

    def delete_keys(self, *, bucket: str, keys: tuple[str, ...]) -> list[str]: ...

    def list_title_matches(self, *, bucket: str, title: str) -> list[str]: ...


class RegulationTargetResidueVectorIndex(Protocol):
    def find_exact(
        self,
        *,
        collection_names: tuple[str, ...],
        document_id: str,
        version_id: str,
        notice_id: str,
        target_surface: str,
    ) -> list[dict[str, Any]]: ...

    def delete_exact(
        self,
        *,
        collection_names: tuple[str, ...],
        document_id: str,
        version_id: str,
        notice_id: str,
        target_surface: str,
    ) -> list[str]: ...


@dataclass(frozen=True, slots=True)
class RegulationTargetResidueCleanupRequest:
    notice_id: str
    title: str
    collection: str
    document_id: str
    version_id: str
    bucket: str
    target_keys: tuple[str, ...]
    output_dir: Path
    qdrant_collections: tuple[str, ...] = ()
    target_surface: str = ""
    apply: bool = False


class InMemoryRegulationTargetResidueRegistry:
    def __init__(self, rows: list[dict[str, Any]] | tuple[dict[str, Any], ...] = ()) -> None:
        self.rows = [dict(row) for row in rows]

    def find_exact(
        self, *, collection: str, document_id: str, version_id: str
    ) -> list[dict[str, Any]]:
        return [
            dict(row)
            for row in self.rows
            if row.get("collection") == collection
            and row.get("document_id") == document_id
            and row.get("version_id") == version_id
        ]

    def delete_exact(
        self, *, collection: str, document_id: str, version_id: str
    ) -> list[dict[str, Any]]:
        deleted = self.find_exact(
            collection=collection, document_id=document_id, version_id=version_id
        )
        self.rows = [
            row
            for row in self.rows
            if not (
                row.get("collection") == collection
                and row.get("document_id") == document_id
                and row.get("version_id") == version_id
            )
        ]
        return deleted

    def find_title_matches(self, *, title: str) -> list[dict[str, Any]]:
        return [
            dict(row)
            for row in self.rows
            if title in str(row.get("document_id") or "")
            or title in str(row.get("version_id") or "")
        ]


class InMemoryRegulationTargetResidueObjectStore:
    def __init__(self, objects: dict[str, dict[str, bytes]] | None = None) -> None:
        self.objects = {bucket: dict(values) for bucket, values in (objects or {}).items()}

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.objects[bucket][key]

    def exists(self, bucket: str, key: str) -> bool:
        return key in self.objects.get(bucket, {})

    def delete_keys(self, *, bucket: str, keys: tuple[str, ...]) -> list[str]:
        deleted: list[str] = []
        bucket_objects = self.objects.setdefault(bucket, {})
        for key in keys:
            if key in bucket_objects:
                del bucket_objects[key]
                deleted.append(key)
        return deleted

    def list_title_matches(self, *, bucket: str, title: str) -> list[str]:
        return sorted(key for key in self.objects.get(bucket, {}) if title in key)


class InMemoryRegulationTargetResidueVectorIndex:
    def __init__(self, collections: dict[str, list[dict[str, Any]]] | None = None) -> None:
        self.collections = {
            collection_name: [dict(point) for point in points]
            for collection_name, points in (collections or {}).items()
        }

    def find_exact(
        self,
        *,
        collection_names: tuple[str, ...],
        document_id: str,
        version_id: str,
        notice_id: str,
        target_surface: str,
    ) -> list[dict[str, Any]]:
        matches: list[dict[str, Any]] = []
        for collection_name in collection_names:
            for point in self.collections.get(collection_name, ()):
                payload = point.get("payload") if isinstance(point.get("payload"), dict) else {}
                if _point_payload_matches(
                    payload=payload,
                    document_id=document_id,
                    version_id=version_id,
                    notice_id=notice_id,
                    target_surface=target_surface,
                ):
                    matches.append(
                        {
                            "collection_name": collection_name,
                            "point_id": str(point.get("id") or ""),
                            "payload": dict(payload),
                        }
                    )
        return matches

    def delete_exact(
        self,
        *,
        collection_names: tuple[str, ...],
        document_id: str,
        version_id: str,
        notice_id: str,
        target_surface: str,
    ) -> list[str]:
        deleted: list[str] = []
        for collection_name in collection_names:
            kept: list[dict[str, Any]] = []
            for point in self.collections.get(collection_name, ()):
                payload = point.get("payload") if isinstance(point.get("payload"), dict) else {}
                if _point_payload_matches(
                    payload=payload,
                    document_id=document_id,
                    version_id=version_id,
                    notice_id=notice_id,
                    target_surface=target_surface,
                ):
                    deleted.append(str(point.get("id") or ""))
                else:
                    kept.append(point)
            self.collections[collection_name] = kept
        return deleted


def cleanup_internal_notice_regulation_target_residue(
    *,
    request: RegulationTargetResidueCleanupRequest,
    registry: RegulationTargetResidueRegistry,
    object_store: RegulationTargetResidueObjectStore,
    vector_index: RegulationTargetResidueVectorIndex | None = None,
) -> dict[str, Any]:
    request.output_dir.mkdir(parents=True, exist_ok=True)
    object_backup_dir = request.output_dir / "object-backups"
    object_backup_dir.mkdir(parents=True, exist_ok=True)
    matched_rows = registry.find_exact(
        collection=request.collection,
        document_id=request.document_id,
        version_id=request.version_id,
    )
    _write_json(request.output_dir / "postgres-row-backup.json", matched_rows)
    object_backups = _backup_target_objects(
        request=request,
        object_store=object_store,
        object_backup_dir=object_backup_dir,
    )
    target_surface = request.target_surface or f"regulations/{request.collection}"
    matched_points = (
        vector_index.find_exact(
            collection_names=request.qdrant_collections,
            document_id=request.document_id,
            version_id=request.version_id,
            notice_id=request.notice_id,
            target_surface=target_surface,
        )
        if vector_index is not None and request.qdrant_collections
        else []
    )
    deleted_rows = (
        registry.delete_exact(
            collection=request.collection,
            document_id=request.document_id,
            version_id=request.version_id,
        )
        if request.apply
        else []
    )
    deleted_keys = (
        object_store.delete_keys(
            bucket=request.bucket,
            keys=tuple(str(item["key"]) for item in object_backups),
        )
        if request.apply
        else []
    )
    deleted_point_ids = (
        vector_index.delete_exact(
            collection_names=request.qdrant_collections,
            document_id=request.document_id,
            version_id=request.version_id,
            notice_id=request.notice_id,
            target_surface=target_surface,
        )
        if request.apply and vector_index is not None and request.qdrant_collections
        else []
    )
    exact_remaining = registry.find_exact(
        collection=request.collection,
        document_id=request.document_id,
        version_id=request.version_id,
    )
    exact_key_remaining = [
        key for key in request.target_keys if object_store.exists(request.bucket, key)
    ]
    qdrant_remaining = (
        vector_index.find_exact(
            collection_names=request.qdrant_collections,
            document_id=request.document_id,
            version_id=request.version_id,
            notice_id=request.notice_id,
            target_surface=target_surface,
        )
        if vector_index is not None and request.qdrant_collections
        else []
    )
    report = {
        "schema_version": "internal_notice_regulation_target_residue_cleanup.v1",
        "generated_at": datetime.now(UTC).isoformat(),
        "apply": request.apply,
        "notice_id": request.notice_id,
        "title": request.title,
        "postgres": {
            "target": {
                "collection": request.collection,
                "document_id": request.document_id,
                "version_id": request.version_id,
            },
            "backup_path": str(request.output_dir / "postgres-row-backup.json"),
            "matched_before": len(matched_rows),
            "deleted_rows": deleted_rows,
        },
        "object_store": {
            "bucket": request.bucket,
            "target_keys": list(request.target_keys),
            "backups": object_backups,
            "backed_up_count": len(object_backups),
            "deleted_keys": deleted_keys,
        },
        "qdrant": {
            "target_collections": list(request.qdrant_collections),
            "target_surface": target_surface,
            "matched_before": len(matched_points),
            "matched_points": matched_points,
            "deleted_point_ids": deleted_point_ids,
        },
        "residue_audit": {
            "postgres_exact_remaining": len(exact_remaining),
            "postgres_title_matches": registry.find_title_matches(title=request.title),
            "object_store_exact_keys_remaining": exact_key_remaining,
            "object_store_title_key_matches": object_store.list_title_matches(
                bucket=request.bucket,
                title=request.title,
            ),
            "qdrant_residue_count": len(qdrant_remaining),
            "qdrant_residue_points": qdrant_remaining,
        },
    }
    _write_json(request.output_dir / "cleanup-manifest.json", report)
    return report


def _backup_target_objects(
    *,
    request: RegulationTargetResidueCleanupRequest,
    object_store: RegulationTargetResidueObjectStore,
    object_backup_dir: Path,
) -> list[dict[str, Any]]:
    backups: list[dict[str, Any]] = []
    for key in request.target_keys:
        if not object_store.exists(request.bucket, key):
            continue
        body = object_store.get_bytes(bucket=request.bucket, key=key)
        digest = hashlib.sha256(body).hexdigest()
        backup_path = object_backup_dir / f"{digest}.bin"
        backup_path.write_bytes(body)
        backups.append(
            {
                "key": key,
                "backup_path": str(backup_path),
                "sha256": digest,
                "size": len(body),
            }
        )
    return backups


def _write_json(path: Path, payload: Any) -> None:
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def _point_payload_matches(
    *,
    payload: dict[str, Any],
    document_id: str,
    version_id: str,
    notice_id: str,
    target_surface: str,
) -> bool:
    if str(payload.get("document_id") or "") != document_id:
        return False
    if str(payload.get("version_id") or "") != version_id:
        return False
    source_notice_ids = {str(item) for item in list(payload.get("source_notice_ids") or [])}
    legacy_notice_id = str(payload.get("notice_id") or "")
    if source_notice_ids and notice_id not in source_notice_ids:
        return False
    if not source_notice_ids and legacy_notice_id and legacy_notice_id != notice_id:
        return False
    payload_target_surface = str(payload.get("target_surface") or "")
    return not payload_target_surface or payload_target_surface == target_surface


def regulation_target_residue_payload_matches(
    *,
    payload: dict[str, Any],
    document_id: str,
    version_id: str,
    notice_id: str,
    target_surface: str,
) -> bool:
    return _point_payload_matches(
        payload=payload,
        document_id=document_id,
        version_id=version_id,
        notice_id=notice_id,
        target_surface=target_surface,
    )


__all__ = [
    "InMemoryRegulationTargetResidueObjectStore",
    "InMemoryRegulationTargetResidueRegistry",
    "InMemoryRegulationTargetResidueVectorIndex",
    "RegulationTargetResidueCleanupRequest",
    "cleanup_internal_notice_regulation_target_residue",
    "regulation_target_residue_payload_matches",
]
