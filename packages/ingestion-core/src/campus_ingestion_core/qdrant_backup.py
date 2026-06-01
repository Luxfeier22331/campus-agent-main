from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Protocol
from urllib.parse import quote

import requests
from campus_retrieval_core.settings import RetrievalSettings
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models
from qdrant_client.http.models import SnapshotPriority

from campus_ingestion_core.index_release import resolve_alias_target
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.qdrant_backup_io import (
    ObjectExistenceProbeError,
)
from campus_ingestion_core.qdrant_backup_io import (
    object_exists as _object_exists,
)
from campus_ingestion_core.qdrant_backup_io import (
    sha256_file as _sha256_file,
)
from campus_ingestion_core.qdrant_backup_io import (
    utc_now_iso as _utc_now_iso,
)
from campus_ingestion_core.qdrant_backup_io import (
    write_json_object as _write_json_object,
)
from campus_ingestion_core.qdrant_backup_manifest_helpers import (
    _build_gc_delete_report_key,
    _build_release_manifest_key,
    _list_index_release_manifests,
    _load_index_release_manifest,
)
from campus_ingestion_core.settings import ObjectStoreSettings, resolve_object_store_bucket_names


@dataclass(frozen=True, slots=True)
class CollectionGcCheckRequest:
    corpus: str
    collection: str
    release_id: str
    backup_root: Path | None = None
    protected_physical_collection_names: tuple[str, ...] = ()
    manual_blockers: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class CollectionGcEligibilityReport:
    eligible: bool
    corpus: str
    collection: str
    release_id: str
    physical_collection_name: str
    role: str
    blockers: tuple[str, ...]
    backup_manifest_path: str | None


@dataclass(frozen=True, slots=True)
class CollectionGcDeleteRequest:
    corpus: str
    collection: str
    release_id: str
    operator: str
    backup_root: Path | None = None
    protected_physical_collection_names: tuple[str, ...] = ()
    manual_blockers: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class CollectionGcDeleteReport:
    eligible: bool
    deleted: bool
    corpus: str
    collection: str
    release_id: str
    physical_collection_name: str
    role: str
    blockers: tuple[str, ...]
    backup_manifest_path: str | None
    delete_report_object_key: str | None
    deleted_at: str | None
    operator: str


class BackupObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(self, *, bucket: str, key: str, data: bytes, content_type: str) -> None: ...

    def upload_file(self, *, bucket: str, key: str, file_path: str, content_type: str) -> None: ...

    def download_file(self, *, bucket: str, key: str, file_path: str) -> None: ...

    def head_object(self, *, bucket: str, key: str) -> dict[str, object]: ...

    def list_keys(self, *, bucket: str, prefix: str) -> tuple[str, ...]: ...


class SnapshotQdrantAdmin(Protocol):
    def create_collection_snapshot(self, collection_name: str) -> str: ...

    def download_collection_snapshot(
        self,
        *,
        collection_name: str,
        snapshot_name: str,
        target_path: str,
    ) -> None: ...

    def delete_collection_snapshot(self, *, collection_name: str, snapshot_name: str) -> None: ...

    def restore_collection_snapshot(
        self,
        *,
        collection_name: str,
        snapshot_path: str,
        checksum: str | None,
    ) -> None: ...

    def resolve_alias_target(self, alias_name: str) -> str | None: ...

    def apply_alias_bindings(self, alias_bindings: dict[str, str]) -> None: ...

    def list_collections(self) -> tuple[str, ...]: ...

    def get_collection_points_count(self, collection_name: str) -> int | None: ...

    def get_release_payload(self, collection_name: str) -> dict[str, object]: ...

    def delete_collection(self, collection_name: str) -> None: ...


class QdrantSnapshotAdmin:
    def __init__(self, settings: RetrievalSettings) -> None:
        self._client = QdrantClient(
            url=settings.qdrant_url,
            api_key=settings.qdrant_api_key,
            timeout=settings.qdrant_timeout_seconds,
            cloud_inference=True,
            check_compatibility=False,
            trust_env=False,
        )
        self._session = requests.Session()
        if settings.qdrant_api_key:
            self._session.headers["api-key"] = settings.qdrant_api_key
        self._timeout = settings.qdrant_timeout_seconds
        self._base_url = settings.qdrant_url.rstrip("/")

    def create_collection_snapshot(self, collection_name: str) -> str:
        snapshot = self._client.create_snapshot(collection_name=collection_name, wait=True)
        snapshot_name = getattr(snapshot, "name", None)
        if not snapshot_name:
            raise RuntimeError(f"snapshot creation returned no name for {collection_name}")
        return str(snapshot_name)

    def download_collection_snapshot(
        self,
        *,
        collection_name: str,
        snapshot_name: str,
        target_path: str,
    ) -> None:
        url = (
            f"{self._base_url}/collections/{quote(collection_name, safe='')}"
            f"/snapshots/{quote(snapshot_name, safe='')}"
        )
        with self._session.get(url, stream=True, timeout=self._timeout) as response:
            response.raise_for_status()
            with Path(target_path).open("wb") as handle:
                for chunk in response.iter_content(chunk_size=1024 * 1024):
                    if chunk:
                        handle.write(chunk)

    def delete_collection_snapshot(self, *, collection_name: str, snapshot_name: str) -> None:
        self._client.delete_snapshot(
            collection_name=collection_name,
            snapshot_name=snapshot_name,
            wait=True,
        )

    def restore_collection_snapshot(
        self,
        *,
        collection_name: str,
        snapshot_path: str,
        checksum: str | None,
    ) -> None:
        with Path(snapshot_path).open("rb") as handle:
            self._client.http.snapshots_api.recover_from_uploaded_snapshot(
                collection_name=collection_name,
                wait=True,
                priority=SnapshotPriority.SNAPSHOT,
                checksum=checksum,
                snapshot=handle,
            )

    def resolve_alias_target(self, alias_name: str) -> str | None:
        return resolve_alias_target(qdrant_client=self._client, alias_name=alias_name)

    def apply_alias_bindings(self, alias_bindings: dict[str, str]) -> None:
        operations: list[qdrant_models.AliasOperations] = []
        for alias_name, collection_name in alias_bindings.items():
            current_collection = self.resolve_alias_target(alias_name)
            if current_collection == collection_name:
                continue
            if current_collection is not None:
                operations.append(
                    qdrant_models.DeleteAliasOperation(
                        delete_alias=qdrant_models.DeleteAlias(alias_name=alias_name)
                    )
                )
            operations.append(
                qdrant_models.CreateAliasOperation(
                    create_alias=qdrant_models.CreateAlias(
                        alias_name=alias_name,
                        collection_name=collection_name,
                    )
                )
            )
        if operations:
            self._client.update_collection_aliases(operations)

    def list_collections(self) -> tuple[str, ...]:
        return tuple(
            str(collection.name or "")
            for collection in self._client.get_collections().collections or ()
            if str(collection.name or "")
        )

    def get_collection_points_count(self, collection_name: str) -> int | None:
        info = self._client.get_collection(collection_name)
        points_count = getattr(info, "points_count", None)
        return None if points_count is None else int(points_count)

    def get_release_payload(self, collection_name: str) -> dict[str, object]:
        points, _ = self._client.scroll(
            collection_name=collection_name,
            limit=1,
            with_payload=True,
            with_vectors=False,
        )
        if not points:
            return {}
        payload = points[0].payload or {}
        return {
            "index_release_id": payload.get("index_release_id"),
            "index_release_manifest_key": payload.get("index_release_manifest_key"),
            "index_release_alias": payload.get("index_release_alias"),
        }

    def delete_collection(self, collection_name: str) -> None:
        self._client.delete_collection(collection_name=collection_name)


def default_backup_id(*, now: datetime | None = None) -> str:
    runtime_now = now or datetime.now(UTC)
    return runtime_now.strftime("b%Y%m%dT%H%M%SZ")


def check_snapshot_gc_eligibility(
    *,
    request: CollectionGcCheckRequest,
    env: dict[str, str] | None = None,
    object_store: BackupObjectStore | None = None,
    qdrant_admin: SnapshotQdrantAdmin | None = None,
) -> CollectionGcEligibilityReport:
    source = dict(env if env is not None else os.environ)
    bucket_derived = resolve_object_store_bucket_names(source)[1]
    runtime_object_store = object_store or S3ObjectStoreAdmin(ObjectStoreSettings.from_env(source))
    runtime_qdrant_admin = qdrant_admin or QdrantSnapshotAdmin(RetrievalSettings.from_env(source))
    target_manifest = _load_index_release_manifest(
        object_store=runtime_object_store,
        bucket=bucket_derived,
        corpus=request.corpus,
        collection=request.collection,
        release_id=request.release_id,
    )
    all_manifests = _list_index_release_manifests(
        object_store=runtime_object_store,
        bucket=bucket_derived,
        corpus=request.corpus,
        collection=request.collection,
    )
    latest_manifest = max(all_manifests, key=lambda item: item.release_id)
    current_alias_target = runtime_qdrant_admin.resolve_alias_target(target_manifest.serving_alias)
    role = "archive_candidate"
    blockers: list[str] = []
    if target_manifest.physical_collection_name == current_alias_target:
        role = "current"
        blockers.append("current_alias_target")
    elif (
        latest_manifest.previous_physical_collection_name
        == target_manifest.physical_collection_name
    ):
        role = "previous"
        blockers.append("latest_previous_release")
    elif target_manifest.physical_collection_name in request.protected_physical_collection_names:
        role = "migration_baseline"
        blockers.append("migration_baseline_protected")
    elif target_manifest.published_at is None:
        role = "preview_candidate"
    if target_manifest.physical_collection_name not in runtime_qdrant_admin.list_collections():
        blockers.append("missing_live_collection")
    backup_manifest_path = None
    if role != "preview_candidate":
        if target_manifest.validation_summary_object_key is None:
            blockers.append("missing_validation_summary")
        else:
            try:
                validation_summary_exists = _object_exists(
                    object_store=runtime_object_store,
                    bucket=bucket_derived,
                    key=target_manifest.validation_summary_object_key,
                )
            except ObjectExistenceProbeError:
                blockers.append("validation_summary_probe_failed")
            else:
                if not validation_summary_exists:
                    blockers.append("missing_validation_summary")
        backup_manifest_path, backup_errors = _find_native_snapshot_backup(
            backup_root=request.backup_root,
            corpus=request.corpus,
            collection=request.collection,
            release_id=request.release_id,
            physical_collection_name=target_manifest.physical_collection_name,
            serving_alias=target_manifest.serving_alias,
            release_manifest_key=_build_release_manifest_key(
                corpus=request.corpus,
                collection=request.collection,
                release_id=request.release_id,
            ),
        )
        blockers.extend(backup_errors)
    blockers.extend(request.manual_blockers)
    eligible = role in {"archive_candidate", "preview_candidate"} and not blockers
    return CollectionGcEligibilityReport(
        eligible=eligible,
        corpus=request.corpus,
        collection=request.collection,
        release_id=request.release_id,
        physical_collection_name=target_manifest.physical_collection_name,
        role=role,
        blockers=tuple(blockers),
        backup_manifest_path=str(backup_manifest_path) if backup_manifest_path else None,
    )


def delete_gc_eligible_collection(
    *,
    request: CollectionGcDeleteRequest,
    env: dict[str, str] | None = None,
    object_store: BackupObjectStore | None = None,
    qdrant_admin: SnapshotQdrantAdmin | None = None,
) -> CollectionGcDeleteReport:
    _require_operator(request.operator)
    source = dict(env if env is not None else os.environ)
    bucket_derived = resolve_object_store_bucket_names(source)[1]
    runtime_object_store = object_store or S3ObjectStoreAdmin(ObjectStoreSettings.from_env(source))
    runtime_qdrant_admin = qdrant_admin or QdrantSnapshotAdmin(RetrievalSettings.from_env(source))
    eligibility = check_snapshot_gc_eligibility(
        request=CollectionGcCheckRequest(
            corpus=request.corpus,
            collection=request.collection,
            release_id=request.release_id,
            backup_root=request.backup_root,
            protected_physical_collection_names=request.protected_physical_collection_names,
            manual_blockers=request.manual_blockers,
        ),
        env=source,
        object_store=runtime_object_store,
        qdrant_admin=runtime_qdrant_admin,
    )
    if not eligibility.eligible:
        return CollectionGcDeleteReport(
            eligible=False,
            deleted=False,
            corpus=eligibility.corpus,
            collection=eligibility.collection,
            release_id=eligibility.release_id,
            physical_collection_name=eligibility.physical_collection_name,
            role=eligibility.role,
            blockers=eligibility.blockers,
            backup_manifest_path=eligibility.backup_manifest_path,
            delete_report_object_key=None,
            deleted_at=None,
            operator=request.operator,
        )

    runtime_qdrant_admin.delete_collection(eligibility.physical_collection_name)
    deleted_at = _utc_now_iso()
    delete_report_key = _build_gc_delete_report_key(
        backup_manifest_path=eligibility.backup_manifest_path,
        corpus=request.corpus,
        collection=request.collection,
        release_id=request.release_id,
    )
    report = CollectionGcDeleteReport(
        eligible=True,
        deleted=True,
        corpus=eligibility.corpus,
        collection=eligibility.collection,
        release_id=eligibility.release_id,
        physical_collection_name=eligibility.physical_collection_name,
        role=eligibility.role,
        blockers=eligibility.blockers,
        backup_manifest_path=eligibility.backup_manifest_path,
        delete_report_object_key=delete_report_key,
        deleted_at=deleted_at,
        operator=request.operator,
    )
    _write_json_object(
        object_store=runtime_object_store,
        bucket=bucket_derived,
        key=delete_report_key,
        payload=asdict(report),
    )
    return report


def _require_operator(operator: str) -> None:
    if not str(operator or "").strip():
        raise ValueError("operator is required")


def _find_native_snapshot_backup(
    *,
    backup_root: Path | None,
    corpus: str,
    collection: str,
    release_id: str,
    physical_collection_name: str,
    serving_alias: str,
    release_manifest_key: str,
) -> tuple[Path | None, tuple[str, ...]]:
    if backup_root is None:
        return None, ("missing_native_snapshot_backup_root",)
    release_dir = Path(backup_root) / corpus / collection / release_id
    if not release_dir.is_dir():
        return None, ("missing_native_snapshot_backup",)
    manifests = sorted(release_dir.glob("*/backup-manifest.json"), reverse=True)
    errors: list[str] = []
    for manifest_path in manifests:
        try:
            payload = json.loads(manifest_path.read_text(encoding="utf-8"))
        except OSError:
            errors.append("native_snapshot_manifest_read_failed")
            continue
        except json.JSONDecodeError:
            errors.append("native_snapshot_manifest_invalid_json")
            continue
        if payload.get("physical_collection_name") != physical_collection_name:
            continue
        manifest_errors = _validate_native_snapshot_manifest(
            manifest_path=manifest_path,
            payload=payload,
            corpus=corpus,
            collection=collection,
            release_id=release_id,
            physical_collection_name=physical_collection_name,
            serving_alias=serving_alias,
            release_manifest_key=release_manifest_key,
        )
        if not manifest_errors:
            return manifest_path, ()
        errors.extend(manifest_errors)
    return None, tuple(dict.fromkeys(errors or ["missing_native_snapshot_backup"]))


def _validate_native_snapshot_manifest(
    *,
    manifest_path: Path,
    payload: dict[str, object],
    corpus: str,
    collection: str,
    release_id: str,
    physical_collection_name: str,
    serving_alias: str,
    release_manifest_key: str,
) -> tuple[str, ...]:
    errors: list[str] = []
    expected = {
        "corpus": corpus,
        "collection": collection,
        "release_id": release_id,
        "physical_collection_name": physical_collection_name,
        "serving_alias": serving_alias,
        "index_release_manifest_key": release_manifest_key,
    }
    for key, value in expected.items():
        if payload.get(key) != value:
            errors.append(f"native_snapshot_{key}_mismatch")
    snapshot_file = payload.get("snapshot_file")
    snapshot_sha256 = payload.get("snapshot_sha256")
    if not isinstance(snapshot_file, str) or not snapshot_file:
        errors.append("native_snapshot_file_missing")
    if not isinstance(snapshot_sha256, str) or not snapshot_sha256:
        errors.append("native_snapshot_sha256_missing")
    if errors:
        return tuple(errors)
    snapshot_path = manifest_path.parent / snapshot_file
    if not snapshot_path.is_file():
        errors.append("missing_native_snapshot_file")
        return tuple(errors)
    if _sha256_file(str(snapshot_path)) != snapshot_sha256:
        errors.append("native_snapshot_sha256_mismatch")
    sha_path = manifest_path.parent / "sha256.txt"
    if not sha_path.is_file():
        errors.append("missing_native_snapshot_sha256_file")
    elif f"{snapshot_sha256}  {snapshot_file}" not in sha_path.read_text(encoding="utf-8"):
        errors.append("native_snapshot_sha256_file_mismatch")
    return tuple(errors)
