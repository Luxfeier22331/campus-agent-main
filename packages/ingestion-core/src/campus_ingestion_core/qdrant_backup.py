from __future__ import annotations

import os
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Protocol
from urllib.parse import quote

import requests
from campus_retrieval_core.settings import RetrievalSettings
from qdrant_client import QdrantClient
from qdrant_client.http import models as qdrant_models
from qdrant_client.http.models import SnapshotPriority

from campus_ingestion_core.index_release import resolve_alias_target
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.object_store import build_qdrant_backup_artifact_key
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
    _find_backup_manifest_for_release,
    _list_index_release_manifests,
    _load_index_release_manifest,
    _load_snapshot_backup_manifest,
    _remap_alias_bindings,
)
from campus_ingestion_core.qdrant_backup_models import SnapshotBackupManifest
from campus_ingestion_core.settings import ObjectStoreSettings, resolve_object_store_bucket_names


@dataclass(frozen=True, slots=True)
class SnapshotBackupRequest:
    corpus: str
    collection: str
    release_id: str
    backup_reason: str
    operator: str = "unknown"


@dataclass(frozen=True, slots=True)
class SnapshotRestoreRequest:
    corpus: str
    collection: str
    release_id: str
    backup_id: str
    operator: str = "unknown"
    apply_alias: bool = False
    target_collection_name: str | None = None


@dataclass(frozen=True, slots=True)
class SnapshotRestoreReport:
    backup_id: str
    corpus: str
    collection: str
    release_id: str
    restored_collection_name: str
    applied_alias_bindings: dict[str, str]
    points_count: int | None
    restored_at: str
    restore_report_object_key: str
    verification_status: str
    verification_errors: tuple[str, ...] = field(default_factory=tuple)


@dataclass(frozen=True, slots=True)
class CollectionGcCheckRequest:
    corpus: str
    collection: str
    release_id: str
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
    backup_manifest_object_key: str | None


@dataclass(frozen=True, slots=True)
class CollectionGcDeleteRequest:
    corpus: str
    collection: str
    release_id: str
    operator: str = "unknown"
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
    backup_manifest_object_key: str | None
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


def create_snapshot_backup(
    *,
    request: SnapshotBackupRequest,
    env: dict[str, str] | None = None,
    object_store: BackupObjectStore | None = None,
    qdrant_admin: SnapshotQdrantAdmin | None = None,
) -> SnapshotBackupManifest:
    source = dict(env if env is not None else os.environ)
    bucket_derived = resolve_object_store_bucket_names(source)[1]
    runtime_object_store = object_store or S3ObjectStoreAdmin(ObjectStoreSettings.from_env(source))
    runtime_qdrant_admin = qdrant_admin or QdrantSnapshotAdmin(RetrievalSettings.from_env(source))
    release_manifest = _load_index_release_manifest(
        object_store=runtime_object_store,
        bucket=bucket_derived,
        corpus=request.corpus,
        collection=request.collection,
        release_id=request.release_id,
    )
    backup_id = default_backup_id()
    snapshot_filename = f"{release_manifest.physical_collection_name}.snapshot"
    snapshot_key = build_qdrant_backup_artifact_key(
        corpus=request.corpus,
        collection=request.collection,
        release_id=request.release_id,
        backup_id=backup_id,
        filename=snapshot_filename,
    )
    with TemporaryDirectory(prefix="campus-qdrant-backup-") as tempdir:
        snapshot_path = str(Path(tempdir) / snapshot_filename)
        snapshot_name = runtime_qdrant_admin.create_collection_snapshot(
            release_manifest.physical_collection_name
        )
        runtime_qdrant_admin.download_collection_snapshot(
            collection_name=release_manifest.physical_collection_name,
            snapshot_name=snapshot_name,
            target_path=snapshot_path,
        )
        snapshot_sha256 = _sha256_file(snapshot_path)
        runtime_object_store.upload_file(
            bucket=bucket_derived,
            key=snapshot_key,
            file_path=snapshot_path,
            content_type="application/octet-stream",
        )
    backup_manifest = SnapshotBackupManifest(
        backup_id=backup_id,
        backup_mode="qdrant_collection_snapshot_export",
        captured_at=_utc_now_iso(),
        corpus=request.corpus,
        collection=request.collection,
        release_id=request.release_id,
        serving_alias=release_manifest.serving_alias,
        physical_collection_name=release_manifest.physical_collection_name,
        alias_bindings={release_manifest.serving_alias: release_manifest.physical_collection_name},
        index_release_manifest_key=_build_release_manifest_key(
            corpus=request.corpus,
            collection=request.collection,
            release_id=request.release_id,
        ),
        validation_summary_key=release_manifest.validation_summary_object_key,
        snapshot_object_key=snapshot_key,
        snapshot_sha256=snapshot_sha256,
        backup_reason=request.backup_reason,
        operator=request.operator,
    )
    backup_manifest_key = build_qdrant_backup_artifact_key(
        corpus=request.corpus,
        collection=request.collection,
        release_id=request.release_id,
        backup_id=backup_id,
        filename="backup-manifest.json",
    )
    _write_json_object(
        object_store=runtime_object_store,
        bucket=bucket_derived,
        key=backup_manifest_key,
        payload=asdict(backup_manifest),
    )
    return backup_manifest


def restore_snapshot_backup(
    *,
    request: SnapshotRestoreRequest,
    env: dict[str, str] | None = None,
    object_store: BackupObjectStore | None = None,
    qdrant_admin: SnapshotQdrantAdmin | None = None,
) -> SnapshotRestoreReport:
    source = dict(env if env is not None else os.environ)
    bucket_derived = resolve_object_store_bucket_names(source)[1]
    runtime_object_store = object_store or S3ObjectStoreAdmin(ObjectStoreSettings.from_env(source))
    runtime_qdrant_admin = qdrant_admin or QdrantSnapshotAdmin(RetrievalSettings.from_env(source))
    backup_manifest = _load_snapshot_backup_manifest(
        object_store=runtime_object_store,
        bucket=bucket_derived,
        corpus=request.corpus,
        collection=request.collection,
        release_id=request.release_id,
        backup_id=request.backup_id,
    )
    release_manifest = _load_index_release_manifest(
        object_store=runtime_object_store,
        bucket=bucket_derived,
        corpus=request.corpus,
        collection=request.collection,
        release_id=request.release_id,
    )
    restored_collection_name = (
        request.target_collection_name or backup_manifest.physical_collection_name
    )
    restore_report_key = build_qdrant_backup_artifact_key(
        corpus=request.corpus,
        collection=request.collection,
        release_id=request.release_id,
        backup_id=request.backup_id,
        filename="restore-report.json",
    )
    with TemporaryDirectory(prefix="campus-qdrant-restore-") as tempdir:
        snapshot_path = str(Path(tempdir) / Path(backup_manifest.snapshot_object_key).name)
        runtime_object_store.download_file(
            bucket=bucket_derived,
            key=backup_manifest.snapshot_object_key,
            file_path=snapshot_path,
        )
        runtime_checksum = _sha256_file(snapshot_path)
        if runtime_checksum != backup_manifest.snapshot_sha256:
            raise ValueError("snapshot sha256 mismatch")
        runtime_qdrant_admin.restore_collection_snapshot(
            collection_name=restored_collection_name,
            snapshot_path=snapshot_path,
            checksum=runtime_checksum,
        )
    verification_errors: list[str] = []
    if restored_collection_name not in runtime_qdrant_admin.list_collections():
        verification_errors.append("restored_collection_missing")
    try:
        points_count = runtime_qdrant_admin.get_collection_points_count(restored_collection_name)
    except Exception:
        points_count = None
        verification_errors.append("points_count_unavailable")
    else:
        if points_count is None:
            verification_errors.append("points_count_unavailable")
        elif points_count != release_manifest.point_count:
            verification_errors.append("points_count_mismatch")
    try:
        release_payload = runtime_qdrant_admin.get_release_payload(restored_collection_name)
    except Exception:
        release_payload = {}
        verification_errors.append("payload_verification_unavailable")
    if release_payload.get("index_release_id") != release_manifest.release_id:
        verification_errors.append("payload_release_id_mismatch")
    if release_payload.get("index_release_manifest_key") != _build_release_manifest_key(
        corpus=request.corpus,
        collection=request.collection,
        release_id=request.release_id,
    ):
        verification_errors.append("payload_manifest_key_mismatch")
    if release_payload.get("index_release_alias") != release_manifest.serving_alias:
        verification_errors.append("payload_alias_mismatch")
    applied_alias_bindings: dict[str, str] = {}
    if request.apply_alias and not verification_errors:
        applied_alias_bindings = _remap_alias_bindings(
            alias_bindings=backup_manifest.alias_bindings,
            original_collection_name=backup_manifest.physical_collection_name,
            restored_collection_name=restored_collection_name,
        )
        runtime_qdrant_admin.apply_alias_bindings(applied_alias_bindings)
    verification_status = "passed" if not verification_errors else "failed"
    report = SnapshotRestoreReport(
        backup_id=request.backup_id,
        corpus=request.corpus,
        collection=request.collection,
        release_id=request.release_id,
        restored_collection_name=restored_collection_name,
        applied_alias_bindings=applied_alias_bindings,
        points_count=points_count,
        restored_at=_utc_now_iso(),
        restore_report_object_key=restore_report_key,
        verification_status=verification_status,
        verification_errors=tuple(verification_errors),
    )
    _write_json_object(
        object_store=runtime_object_store,
        bucket=bucket_derived,
        key=restore_report_key,
        payload=asdict(report),
    )
    return report


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
    backup_manifest = None
    backup_manifest_key = None
    if role != "preview_candidate":
        if target_manifest.validation_summary_object_key is None or not _object_exists(
            object_store=runtime_object_store,
            bucket=bucket_derived,
            key=target_manifest.validation_summary_object_key,
        ):
            blockers.append("missing_validation_summary")
        backup_manifest, backup_manifest_key = _find_backup_manifest_for_release(
            object_store=runtime_object_store,
            bucket=bucket_derived,
            corpus=request.corpus,
            collection=request.collection,
            release_id=request.release_id,
            physical_collection_name=target_manifest.physical_collection_name,
        )
        if backup_manifest is None:
            blockers.append("missing_snapshot_backup")
        elif not _object_exists(
            object_store=runtime_object_store,
            bucket=bucket_derived,
            key=backup_manifest.snapshot_object_key,
        ):
            blockers.append("missing_snapshot_object")
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
        backup_manifest_object_key=backup_manifest_key,
    )


def delete_gc_eligible_collection(
    *,
    request: CollectionGcDeleteRequest,
    env: dict[str, str] | None = None,
    object_store: BackupObjectStore | None = None,
    qdrant_admin: SnapshotQdrantAdmin | None = None,
) -> CollectionGcDeleteReport:
    source = dict(env if env is not None else os.environ)
    bucket_derived = resolve_object_store_bucket_names(source)[1]
    runtime_object_store = object_store or S3ObjectStoreAdmin(ObjectStoreSettings.from_env(source))
    runtime_qdrant_admin = qdrant_admin or QdrantSnapshotAdmin(RetrievalSettings.from_env(source))
    eligibility = check_snapshot_gc_eligibility(
        request=CollectionGcCheckRequest(
            corpus=request.corpus,
            collection=request.collection,
            release_id=request.release_id,
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
            backup_manifest_object_key=eligibility.backup_manifest_object_key,
            delete_report_object_key=None,
            deleted_at=None,
            operator=request.operator,
        )

    runtime_qdrant_admin.delete_collection(eligibility.physical_collection_name)
    deleted_at = _utc_now_iso()
    delete_report_key = _build_gc_delete_report_key(
        backup_manifest_object_key=eligibility.backup_manifest_object_key,
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
        backup_manifest_object_key=eligibility.backup_manifest_object_key,
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
