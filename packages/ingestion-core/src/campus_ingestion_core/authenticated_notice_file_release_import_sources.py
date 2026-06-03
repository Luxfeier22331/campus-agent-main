from __future__ import annotations

from typing import Any

from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
    DEFAULT_AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_TABLE,
    resolve_authenticated_notice_collector_run_refs,
)
from campus_ingestion_core.authenticated_notice_file_release_import_models import (
    AuthenticatedNoticeFileReleaseImportRequest,
    _PreparedFileReleaseImport,
)
from campus_ingestion_core.authenticated_notice_file_release_import_scalars import (
    FILE_RELEASE_SOURCE_SURFACE,
    _as_record,
    _optional_text,
    _required_non_negative_int,
    _required_text,
)
from campus_ingestion_core.authenticated_notice_file_release_owner_recovery import (
    AuthenticatedNoticeFileReleaseExport,
    load_authenticated_notice_file_release_export,
)
from campus_ingestion_core.authenticated_notice_import_sources import (
    AuthenticatedNoticeImportObjectRefs,
    explicit_authenticated_notice_import_object_refs,
    get_verified_authenticated_notice_object_bytes,
    load_authenticated_notice_import_payload_from_object_refs,
)


def _load_authenticated_notice_file_release_import_export(
    *,
    request: AuthenticatedNoticeFileReleaseImportRequest,
    env: dict[str, str],
    object_store: object | None,
) -> AuthenticatedNoticeFileReleaseExport:
    object_refs = _file_release_import_object_refs_from_request(request=request, env=env)
    if object_refs is not None:
        loaded = load_authenticated_notice_import_payload_from_object_refs(
            refs=object_refs,
            env=env,
            object_store=object_store,
            bundle_label="authenticated notice file-release bundle",
            manifest_label="authenticated notice file-release manifest",
        )
        _assert_file_release_manifest_schema(loaded.export_manifest)
        return _file_release_export_from_payload(
            bundle_records=loaded.bundle_records,
            export_manifest=loaded.export_manifest,
        )
    return load_authenticated_notice_file_release_export(
        bundle_path=request.bundle_path,
        manifest_path=request.manifest_path,
    )


def _file_release_import_object_refs_from_request(
    *,
    request: AuthenticatedNoticeFileReleaseImportRequest,
    env: dict[str, str],
) -> AuthenticatedNoticeImportObjectRefs | None:
    if request.run_id:
        resolved = resolve_authenticated_notice_collector_run_refs(
            env=env,
            run_id=request.run_id,
            expected_source_surface=FILE_RELEASE_SOURCE_SURFACE,
            table_name=request.collector_run_ledger_table
            or DEFAULT_AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_TABLE,
        )
        return explicit_authenticated_notice_import_object_refs(
            source_bucket=resolved.source_bucket,
            bundle_object_key=resolved.bundle_object_key,
            manifest_object_key=resolved.manifest_object_key,
            bundle_content_sha256=resolved.bundle_content_sha256,
            bundle_byte_size=resolved.bundle_byte_size,
            manifest_content_sha256=resolved.manifest_content_sha256,
            manifest_byte_size=resolved.manifest_byte_size,
            run_id=resolved.run_id,
        )
    if request.source_bucket or request.bundle_object_key or request.manifest_object_key:
        return explicit_authenticated_notice_import_object_refs(
            source_bucket=request.source_bucket,
            bundle_object_key=request.bundle_object_key,
            manifest_object_key=request.manifest_object_key,
            bundle_content_sha256=request.bundle_content_sha256,
            bundle_byte_size=request.bundle_byte_size,
            manifest_content_sha256=request.manifest_content_sha256,
            manifest_byte_size=request.manifest_byte_size,
        )
    return None


def _file_release_export_from_payload(
    *,
    bundle_records: tuple[dict[str, Any], ...],
    export_manifest: dict[str, Any],
) -> AuthenticatedNoticeFileReleaseExport:
    collector = _as_record(export_manifest.get("collector"))
    return AuthenticatedNoticeFileReleaseExport(
        bundle_records=bundle_records,
        export_manifest=export_manifest,
        export_scope=_optional_text(export_manifest.get("export_scope")),
        site_id=_optional_text(export_manifest.get("site_id")),
        source_home_url=_optional_text(export_manifest.get("source_home_url")),
        collector_contract_version=_optional_text(collector.get("export_contract_version")),
    )


def _verify_file_release_released_source_objects(
    *,
    prepared: tuple[_PreparedFileReleaseImport, ...],
    object_store: object,
) -> None:
    get_bytes = getattr(object_store, "get_bytes", None)
    if not callable(get_bytes):
        raise ValueError(
            "object_store must support get_bytes before file_release_source materialization"
        )
    verified_refs: set[tuple[str, str, str, int]] = set()
    for item in prepared:
        entry = item.inventory_entry
        bucket = _required_text(
            entry.released_file_bucket,
            "file_release source bytes bucket",
        )
        object_key = _required_text(
            entry.released_file_object_key,
            "file_release source bytes object_key",
        )
        source_sha256 = _required_text(
            entry.released_file_sha256,
            "file_release source bytes sha256",
        )
        source_byte_size = _required_non_negative_int(
            entry.released_file_byte_size,
            "file_release source bytes byte_size",
        )
        cache_key = (bucket, object_key, source_sha256, source_byte_size)
        if cache_key in verified_refs:
            continue
        get_verified_authenticated_notice_object_bytes(
            reader=object_store,  # type: ignore[arg-type]
            bucket=bucket,
            key=object_key,
            expected_sha256=source_sha256,
            expected_byte_size=source_byte_size,
            label=f"file_release released source bytes {item.file_release_id}",
            missing_reason_code="missing_source_bytes",
        )
        verified_refs.add(cache_key)


def _assert_file_release_manifest_schema(export_manifest: dict[str, Any]) -> None:
    schema_version = _optional_text(export_manifest.get("schema_version"))
    if schema_version != "authenticated_notice_file_release_export_v1":
        raise ValueError(
            "file-release manifest schema_version must be "
            "authenticated_notice_file_release_export_v1"
        )
