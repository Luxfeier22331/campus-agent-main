from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from typing import Any, Mapping

from campus_ingestion_core.authenticated_notice_file_release_inventory import (
    DEFAULT_FILE_RELEASE_INVENTORY_COLLECTION,
    DEFAULT_FILE_RELEASE_INVENTORY_CORPUS,
    AuthenticatedNoticeFileReleaseInventoryEntry,
    AuthenticatedNoticeFileReleaseInventoryStore,
    build_authenticated_notice_file_release_inventory_store_from_env,
)
from campus_ingestion_core.authenticated_notice_file_release_owner_recovery import (
    AuthenticatedNoticeFileReleaseExport,
    load_authenticated_notice_file_release_export,
)
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.registry import RawAssetRegistry, build_raw_asset_registry_from_env
from campus_ingestion_core.campusrag_ingestion_support import utc_now


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeFileReleaseInventoryBackfillRequest:
    bundle_path: Path
    manifest_path: Path
    corpus: str = DEFAULT_FILE_RELEASE_INVENTORY_CORPUS
    collection: str = DEFAULT_FILE_RELEASE_INVENTORY_COLLECTION


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeFileReleaseInventoryBackfillResult:
    corpus: str
    collection: str
    export_scope: str
    site_id: str
    collector_contract_version: str
    file_release_count: int
    inventory_upsert_count: int
    raw_asset_upsert_count: int
    reference_only_count: int
    targeted_upsert: bool
    target_file_release_id: int | None = None


def backfill_authenticated_notice_file_release_inventory(
    *,
    request: AuthenticatedNoticeFileReleaseInventoryBackfillRequest,
    env: dict[str, str] | None = None,
    inventory_store: AuthenticatedNoticeFileReleaseInventoryStore | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
) -> AuthenticatedNoticeFileReleaseInventoryBackfillResult:
    source = env if env is not None else dict(os.environ)
    export = load_authenticated_notice_file_release_export(
        bundle_path=request.bundle_path,
        manifest_path=request.manifest_path,
    )
    manifest = dict(export.export_manifest or {})
    if not manifest:
        raise ValueError("file-release inventory backfill requires manifest_path")
    runtime_inventory_store = inventory_store or build_authenticated_notice_file_release_inventory_store_from_env(
        source,
        prefer_operator=True,
    )
    runtime_raw_asset_registry = raw_asset_registry or build_raw_asset_registry_from_env(
        source,
        prefer_operator=True,
    )
    collector = _as_record(manifest.get("collector"))
    filters = _as_record(manifest.get("filters"))
    file_storage_mode = _optional_text(collector.get("file_storage_mode"))
    target_file_release_id = _optional_int(filters.get("target_file_release_id"))
    if target_file_release_id is not None:
        _validate_targeted_export_rows(
            export=export,
            target_file_release_id=target_file_release_id,
        )
    entries = tuple(
        inventory_entry_from_file_release_bundle_record(
            record=record,
            export_scope=_required_text(manifest.get("export_scope"), "export_scope"),
            site_id=_required_text(manifest.get("site_id"), "site_id"),
            source_home_url=_required_text(manifest.get("source_home_url"), "source_home_url"),
            collector_contract_version=_required_text(
                collector.get("export_contract_version"),
                "collector.export_contract_version",
            ),
            corpus=request.corpus,
            collection=request.collection,
        )
        for record in export.bundle_records
    )
    if target_file_release_id is not None:
        runtime_inventory_store.upsert_many(entries)
    else:
        runtime_inventory_store.replace_scope(request.corpus, request.collection, entries)

    raw_records = tuple(
        raw_asset_record_from_file_release_inventory_entry(
            entry,
            file_storage_mode=file_storage_mode,
        )
        for entry in entries
        if raw_asset_record_from_file_release_inventory_entry(
            entry,
            file_storage_mode=file_storage_mode,
        )
        is not None
    )
    if raw_records:
        runtime_raw_asset_registry.upsert_many(raw_records)

    return AuthenticatedNoticeFileReleaseInventoryBackfillResult(
        corpus=request.corpus,
        collection=request.collection,
        export_scope=_required_text(manifest.get("export_scope"), "export_scope"),
        site_id=_required_text(manifest.get("site_id"), "site_id"),
        collector_contract_version=_required_text(
            collector.get("export_contract_version"),
            "collector.export_contract_version",
        ),
        file_release_count=len(entries),
        inventory_upsert_count=len(entries),
        raw_asset_upsert_count=len(raw_records),
        reference_only_count=sum(
            1
            for entry in entries
            if entry.released_file_storage_provider != "object_store"
        ),
        targeted_upsert=target_file_release_id is not None,
        target_file_release_id=target_file_release_id,
    )


def inventory_entry_from_file_release_bundle_record(
    *,
    record: Mapping[str, object],
    export_scope: str,
    site_id: str,
    source_home_url: str,
    collector_contract_version: str,
    corpus: str = DEFAULT_FILE_RELEASE_INVENTORY_CORPUS,
    collection: str = DEFAULT_FILE_RELEASE_INVENTORY_COLLECTION,
) -> AuthenticatedNoticeFileReleaseInventoryEntry:
    bundle_record = _as_record(record)
    file_release = _as_record(bundle_record.get("file_release"))
    released_file = _as_record(bundle_record.get("released_file"))
    return AuthenticatedNoticeFileReleaseInventoryEntry(
        corpus=corpus,
        collection=collection,
        file_release_id=_required_int(bundle_record.get("file_release_id"), "file_release_id"),
        site_id=site_id,
        export_scope=export_scope,
        collector_contract_version=collector_contract_version,
        source_home_url=source_home_url,
        filename=_required_text(file_release.get("filename"), "file_release.filename"),
        upfilename=_optional_text(file_release.get("upfilename")),
        filecode=_optional_text(file_release.get("filecode")),
        filetime=_optional_text(file_release.get("filetime")),
        filedepartment=_optional_text(file_release.get("filedepartment")),
        explain_department=_optional_text(file_release.get("explain_department")),
        file_type_id=_optional_int(file_release.get("file_type_id")),
        file_type_name=_optional_text(file_release.get("file_type_name")),
        resolved_download_url=_optional_text(file_release.get("resolved_download_url")),
        released_file_storage_provider=_optional_text(released_file.get("storage_provider")),
        released_file_bucket=_optional_text(released_file.get("bucket")),
        released_file_object_key=_optional_text(released_file.get("object_key")),
        released_file_sha256=_optional_text(released_file.get("sha256")),
        released_file_byte_size=_optional_int(released_file.get("byte_size")),
        released_file_ingest_status=_optional_text(released_file.get("ingest_status")),
        released_file_provenance_status=_optional_text(released_file.get("provenance_status")),
        updated_at=utc_now(),
        record={
            "file_release_id": _required_int(bundle_record.get("file_release_id"), "file_release_id"),
            "file_release": dict(file_release),
            "released_file": dict(released_file),
        },
    )


def raw_asset_record_from_file_release_inventory_entry(
    entry: AuthenticatedNoticeFileReleaseInventoryEntry,
    *,
    file_storage_mode: str | None,
) -> RawAssetRecord | None:
    storage_provider = entry.released_file_storage_provider
    if file_storage_mode == "object_store_write":
        if storage_provider != "object_store":
            raise ValueError(
                "file-release inventory backfill requires object_store locators when "
                "collector.file_storage_mode=object_store_write"
            )
        if not (
            entry.released_file_bucket
            and entry.released_file_object_key
            and entry.released_file_sha256
        ):
            raise ValueError(
                "file-release inventory backfill requires bucket/object_key/sha256 when "
                "collector.file_storage_mode=object_store_write"
            )
    if storage_provider != "object_store":
        return None
    if not (
        entry.released_file_bucket
        and entry.released_file_object_key
        and entry.released_file_sha256
    ):
        raise ValueError(
            "file-release inventory backfill requires bucket/object_key/sha256 for object_store rows"
        )
    filename = _resolve_source_filename(entry)
    return RawAssetRecord(
        raw_asset_id=f"asset:file-release:{entry.site_id}:{entry.file_release_id}",
        raw_version_id=f"sha256:{entry.released_file_sha256}",
        corpus=entry.corpus,
        collection=entry.collection,
        raw_source_uri=_resolve_raw_source_uri(entry),
        content_hash=entry.released_file_sha256,
        source_filename=filename,
        object_key=entry.released_file_object_key,
        content_type=_infer_content_type(filename),
        file_extension=_normalize_extension(filename),
        byte_size=entry.released_file_byte_size,
        ingestion_timestamp=entry.updated_at,
        import_source="authenticated_notice_file_release_registry_backfill_v1",
    )


def _validate_targeted_export_rows(
    *,
    export: AuthenticatedNoticeFileReleaseExport,
    target_file_release_id: int,
) -> None:
    if not export.bundle_records:
        raise ValueError("targeted file-release export must contain one matched row")
    for record in export.bundle_records:
        bundle_record = _as_record(record)
        file_release_id = _required_int(bundle_record.get("file_release_id"), "file_release_id")
        if file_release_id != target_file_release_id:
            raise ValueError(
                "targeted file-release export bundle rows must match filters.target_file_release_id"
            )


def _resolve_source_filename(entry: AuthenticatedNoticeFileReleaseInventoryEntry) -> str:
    released_file = _as_record(entry.record.get("released_file"))
    filename = _optional_text(released_file.get("original_filename")) or entry.filename
    if not filename:
        raise ValueError("file-release raw asset requires source filename")
    return filename


def _resolve_raw_source_uri(entry: AuthenticatedNoticeFileReleaseInventoryEntry) -> str:
    released_file = _as_record(entry.record.get("released_file"))
    for value in (
        released_file.get("final_url"),
        released_file.get("normalized_source_url"),
        released_file.get("source_url"),
        entry.resolved_download_url,
    ):
        text = _optional_text(value)
        if text:
            return text
    raise ValueError("file-release raw asset requires a source uri")


def _infer_content_type(filename: str) -> str | None:
    extension = _normalize_extension(filename)
    return {
        ".pdf": "application/pdf",
        ".doc": "application/msword",
        ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        ".xls": "application/vnd.ms-excel",
        ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        ".ppt": "application/vnd.ms-powerpoint",
        ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        ".txt": "text/plain",
        ".csv": "text/csv",
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
    }.get(extension)


def _normalize_extension(filename: str) -> str:
    return Path(filename).suffix.lower().strip()


def _as_record(value: object) -> dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    return {}


def _required_text(value: object, label: str) -> str:
    text = _optional_text(value)
    if text is None:
        raise ValueError(f"{label} is required")
    return text


def _optional_text(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _required_int(value: object, label: str) -> int:
    parsed = _optional_int(value)
    if parsed is None:
        raise ValueError(f"{label} is required")
    return parsed


def _optional_int(value: object) -> int | None:
    if value in (None, ""):
        return None
    return int(value)


__all__ = [
    "AuthenticatedNoticeFileReleaseInventoryBackfillRequest",
    "AuthenticatedNoticeFileReleaseInventoryBackfillResult",
    "backfill_authenticated_notice_file_release_inventory",
    "inventory_entry_from_file_release_bundle_record",
    "raw_asset_record_from_file_release_inventory_entry",
]
