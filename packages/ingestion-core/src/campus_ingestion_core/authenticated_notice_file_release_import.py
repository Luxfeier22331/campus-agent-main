from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION

from campus_ingestion_core.authenticated_notice_defaults import (
    DEFAULT_AUTHENTICATED_NOTICE_EMBEDDING_MODEL,
    DEFAULT_AUTHENTICATED_NOTICE_ENTITLEMENT_GROUPS,
    DEFAULT_AUTHENTICATED_NOTICE_VISIBILITY_SCOPE,
)
from campus_ingestion_core.authenticated_notice_file_release_inventory import (
    AuthenticatedNoticeFileReleaseInventoryEntry,
    AuthenticatedNoticeFileReleaseInventoryStore,
    build_authenticated_notice_file_release_inventory_store_from_env,
)
from campus_ingestion_core.authenticated_notice_file_release_owner_recovery import (
    load_authenticated_notice_file_release_export,
)
from campus_ingestion_core.authenticated_notice_import import (
    AUTHENTICATED_NOTICE_IMPORT_MODE_ADMIT_AND_MATERIALIZE,
    AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN,
)
from campus_ingestion_core.authenticated_notice_import_assets import _content_type_for_artifact
from campus_ingestion_core.authenticated_notice_source_truth_shared import (
    AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
)
from campus_ingestion_core.campusrag_ingestion_support import (
    DocumentImportInput,
    S3ObjectStoreWriter,
    apply_authorization_projection_metadata,
    collect_import_document_stats,
    utc_now,
)
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.object_store import (
    build_raw_asset_key,
    build_source_provider_artifact_key,
    build_source_truth_artifact_key,
)
from campus_ingestion_core.registry import (
    DocumentRegistry,
    RawAssetRegistry,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)
from campus_ingestion_core.scope_catalog import assert_known_scope
from campus_ingestion_core.settings import ObjectStoreSettings

DEFAULT_AUTHENTICATED_DOCUMENTS_CORPUS = "authenticated_documents"
DEFAULT_FILE_RELEASE_SOURCE_COLLECTION = "file_release_source"
DEFAULT_FILE_RELEASE_IMPORT_SOURCE = "authenticated_notice_file_release_import_v1"
DEFAULT_FILE_RELEASE_PARSER_VERSION = "authenticated_notice_file_release_import_v1"
FILE_RELEASE_SOURCE_SURFACE = "file_release"
FILE_RELEASE_MANIFEST_SCHEMA = "authenticated_notice_file_release_manifest_v1"
FILE_RELEASE_BLOCK_SCHEMA = "authenticated_notice_file_release_block_v1"
FILE_RELEASE_REF_SCHEMA = "authenticated_notice_file_release_ref_v1"
_YEAR_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})(?!\d)")
_WHITESPACE_RE = re.compile(r"\s+")
_SUPPORTED_FILE_RELEASE_IMPORT_MODES = {
    AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN,
    AUTHENTICATED_NOTICE_IMPORT_MODE_ADMIT_AND_MATERIALIZE,
}


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeFileReleaseImportRequest:
    bundle_path: Path
    manifest_path: Path
    site_id: str
    source_home_url: str
    corpus: str = DEFAULT_AUTHENTICATED_DOCUMENTS_CORPUS
    collection: str = DEFAULT_FILE_RELEASE_SOURCE_COLLECTION
    default_entitlement_groups: tuple[str, ...] = DEFAULT_AUTHENTICATED_NOTICE_ENTITLEMENT_GROUPS
    visibility_scope: str | None = DEFAULT_AUTHENTICATED_NOTICE_VISIBILITY_SCOPE
    parser_version: str = DEFAULT_FILE_RELEASE_PARSER_VERSION
    embedding_model: str = DEFAULT_AUTHENTICATED_NOTICE_EMBEDDING_MODEL
    import_source: str = DEFAULT_FILE_RELEASE_IMPORT_SOURCE
    mode: str = AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN
    replace_scope: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "bundle_path", Path(self.bundle_path))
        object.__setattr__(self, "manifest_path", Path(self.manifest_path))
        object.__setattr__(
            self,
            "default_entitlement_groups",
            tuple(group.strip() for group in self.default_entitlement_groups if group.strip()),
        )
        object.__setattr__(self, "mode", _normalize_import_mode(self.mode))
        assert_known_scope(self.corpus, self.collection)
        if not self.site_id.strip():
            raise ValueError("site_id is required")
        if not self.source_home_url.strip():
            raise ValueError("source_home_url is required")


@dataclass(frozen=True, slots=True)
class _PreparedFileReleaseImport:
    file_release_id: int
    raw_record: RawAssetRecord
    capture_artifacts: dict[str, bytes]
    provider_artifacts: dict[str, bytes]
    source_truth_artifacts: dict[str, bytes]
    source_artifact_keys: dict[str, str]
    document_import: DocumentImportInput
    inventory_entry: AuthenticatedNoticeFileReleaseInventoryEntry


def import_authenticated_notice_file_release_export(
    *,
    request: AuthenticatedNoticeFileReleaseImportRequest,
    env: dict[str, str] | None = None,
    object_store: S3ObjectStoreWriter | object | None = None,
    document_registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
    inventory_store: AuthenticatedNoticeFileReleaseInventoryStore | None = None,
) -> dict[str, Any]:
    source = env if env is not None else dict(os.environ)
    export = load_authenticated_notice_file_release_export(
        bundle_path=request.bundle_path,
        manifest_path=request.manifest_path,
    )
    prepared = tuple(
        _prepare_file_release_import(
            request=request,
            bundle_record=bundle_record,
            export_manifest=export.export_manifest,
        )
        for bundle_record in export.bundle_records
    )
    if request.mode == AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN:
        return {
            "mode": request.mode,
            "write_enabled": False,
            "file_release_count": len(prepared),
            "created_document_ids": [],
            "updated_document_ids": [],
            "skipped_document_ids": [],
            "raw_uploaded_count": 0,
            "raw_reused_count": 0,
            "scope_write_mode": "replace_scope" if request.replace_scope else "upsert_selected",
            "write_plan": {
                "raw_asset_registry_rows": len(prepared),
                "document_registry_parent_rows": len(prepared),
                "file_release_inventory_rows": len(prepared),
                "source_artifact_object_count": sum(
                    len(item.source_artifact_keys) for item in prepared
                ),
                "derived_document_object_count": len(prepared) * 2,
            },
            "errors": [],
        }

    object_store_settings = ObjectStoreSettings.from_env(source)
    writer = object_store or S3ObjectStoreWriter(object_store_settings)
    registry = document_registry or build_document_registry_from_env(source)
    raw_registry = raw_asset_registry or build_raw_asset_registry_from_env(source)
    runtime_inventory_store = (
        inventory_store
        or build_authenticated_notice_file_release_inventory_store_from_env(
            source,
            prefer_operator=True,
        )
    )

    raw_uploaded_count = 0
    raw_reused_count = 0
    for item in prepared:
        existing_raw_record = raw_registry.get(
            item.raw_record.raw_asset_id,
            item.raw_record.raw_version_id,
        )
        if existing_raw_record is None:
            raw_registry.upsert(item.raw_record)
            raw_uploaded_count += 1
        else:
            raw_reused_count += 1
        for artifact_path, payload in (
            list(item.capture_artifacts.items())
            + list(item.provider_artifacts.items())
            + list(item.source_truth_artifacts.items())
        ):
            writer.put_bytes(
                bucket=object_store_settings.bucket_source,
                key=item.source_artifact_keys[artifact_path],
                data=payload,
                content_type=_content_type_for_artifact(artifact_path),
            )

    stats = collect_import_document_stats(
        documents=[item.document_import for item in prepared],
        registry=registry,
        raw_asset_registry=raw_registry,
        writer=writer,
        object_store=object_store_settings,
        parser_version=request.parser_version,
        embedding_model=request.embedding_model,
        cleaning_policy_version="authenticated_documents_holding_v1",
        default_visibility_scope=request.visibility_scope,
        scope_refresh=((request.corpus, request.collection) if request.replace_scope else None),
    )

    entries = tuple(item.inventory_entry for item in prepared)
    if request.replace_scope:
        runtime_inventory_store.replace_scope(request.corpus, request.collection, entries)
    else:
        runtime_inventory_store.upsert_many(entries)

    return {
        "mode": request.mode,
        "write_enabled": True,
        "file_release_count": len(prepared),
        "created_document_ids": list(stats.created_document_ids),
        "updated_document_ids": list(stats.updated_document_ids),
        "skipped_document_ids": list(stats.skipped_document_ids),
        "raw_uploaded_count": raw_uploaded_count,
        "raw_reused_count": raw_reused_count,
        "scope_write_mode": "replace_scope" if request.replace_scope else "upsert_selected",
        "file_release_inventory_rows": len(entries),
        "errors": list(stats.errors),
    }


def _prepare_file_release_import(
    *,
    request: AuthenticatedNoticeFileReleaseImportRequest,
    bundle_record: dict[str, Any],
    export_manifest: dict[str, Any] | None,
) -> _PreparedFileReleaseImport:
    file_release_id = _required_int(bundle_record.get("file_release_id"), "file_release_id")
    file_release = _as_record(bundle_record.get("file_release"))
    released_file = _as_record(bundle_record.get("released_file"))
    filename = _required_text(file_release.get("filename"), "file_release.filename")
    object_key = _required_text(
        released_file.get("object_key"),
        "file_release source bytes object_key",
    )
    source_sha256 = _required_text(
        released_file.get("sha256"),
        "file_release source bytes sha256",
    )
    storage_provider = _required_text(
        released_file.get("storage_provider"),
        "file_release source bytes storage_provider",
    )
    if storage_provider != "object_store":
        raise ValueError("file_release source bytes require object_store storage_provider")
    source_uri = _required_text(
        file_release.get("resolved_download_url") or released_file.get("source_url"),
        "file_release.resolved_download_url",
    )
    year = _infer_year(file_release.get("filetime"), filename)
    raw_asset_id = f"asset:file-release:{request.site_id}:{file_release_id}"
    raw_version_id = _build_file_release_raw_version_id(bundle_record)
    document_id = f"file-release:{request.site_id}:{file_release_id}"
    title = filename

    capture_artifacts = _build_capture_artifacts(bundle_record, export_manifest)
    provider_artifacts = _build_provider_artifacts(bundle_record)
    content_blocks = _build_content_blocks(bundle_record)
    source_truth_artifacts = _build_source_truth_artifacts(
        bundle_record=bundle_record,
        export_manifest=export_manifest,
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        site_id=request.site_id,
        source_home_url=request.source_home_url,
        source_uri=source_uri,
        content_blocks=content_blocks,
    )
    source_artifact_keys = {
        "capture/list-response.json": build_raw_asset_key(
            corpus=request.corpus,
            raw_asset_id=raw_asset_id,
            raw_version_id=raw_version_id,
            filename="list-response.json",
            source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
            year=year,
        ),
        "capture/detail-response.json": build_raw_asset_key(
            corpus=request.corpus,
            raw_asset_id=raw_asset_id,
            raw_version_id=raw_version_id,
            filename="detail-response.json",
            source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
            year=year,
        ),
        "capture/fetch-metadata.json": build_raw_asset_key(
            corpus=request.corpus,
            raw_asset_id=raw_asset_id,
            raw_version_id=raw_version_id,
            filename="fetch-metadata.json",
            source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
            year=year,
        ),
        "provider/normalized-file-release.json": build_source_provider_artifact_key(
            raw_asset_id=raw_asset_id,
            raw_version_id=raw_version_id,
            filename="normalized-file-release.json",
            source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
            model_slug="bundle-import-v1",
            year=year,
        ),
        "provider/released-file-observation.json": build_source_provider_artifact_key(
            raw_asset_id=raw_asset_id,
            raw_version_id=raw_version_id,
            filename="released-file-observation.json",
            source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
            model_slug="bundle-import-v1",
            year=year,
        ),
        "source-truth/file-release-manifest.json": build_source_truth_artifact_key(
            raw_asset_id=raw_asset_id,
            raw_version_id=raw_version_id,
            filename="file-release-manifest.json",
            source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
            year=year,
        ),
        "source-truth/content-blocks.jsonl": build_source_truth_artifact_key(
            raw_asset_id=raw_asset_id,
            raw_version_id=raw_version_id,
            filename="content-blocks.jsonl",
            source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
            year=year,
        ),
        "source-truth/released-file-ref.json": build_source_truth_artifact_key(
            raw_asset_id=raw_asset_id,
            raw_version_id=raw_version_id,
            filename="released-file-ref.json",
            source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
            year=year,
        ),
    }
    metadata: dict[str, Any] = {
        "document_id": document_id,
        "version_id": raw_version_id,
        "source_url": source_uri,
        "source_id": document_id,
        "raw_page_start": None,
        "raw_page_end": None,
    }
    apply_authorization_projection_metadata(
        metadata,
        entitlement_groups=request.default_entitlement_groups,
        visibility_scope=request.visibility_scope,
        visibility_level="restricted" if request.default_entitlement_groups else "public",
        policy_projection_version=DEFAULT_POLICY_PROJECTION_VERSION,
    )
    canonical_markdown_bytes = _build_canonical_markdown(bundle_record).encode("utf-8")
    document_units_bytes = _build_document_units(
        document_id=document_id,
        version_id=raw_version_id,
        source_uri=source_uri,
        content_blocks=content_blocks,
    )
    document_import = DocumentImportInput(
        source_label=f"file_release:{file_release_id}",
        document_units_bytes=document_units_bytes,
        provider_response_bytes=None,
        canonical_markdown_bytes=canonical_markdown_bytes,
        metadata=metadata,
        import_source=request.import_source,
        revision_track="source-faithful",
        source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
        is_current=False,
        corpus=request.corpus,
        collection=request.collection,
        visibility_scope=request.visibility_scope,
        raw_source_uri=source_uri,
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        provider_response_object_key=source_artifact_keys["provider/normalized-file-release.json"],
        additional_processed_object_keys=(
            source_artifact_keys["capture/list-response.json"],
            source_artifact_keys["capture/detail-response.json"],
            source_artifact_keys["capture/fetch-metadata.json"],
            source_artifact_keys["provider/released-file-observation.json"],
            source_artifact_keys["source-truth/file-release-manifest.json"],
            source_artifact_keys["source-truth/content-blocks.jsonl"],
            source_artifact_keys["source-truth/released-file-ref.json"],
        ),
        title=title,
        year=year,
    )
    raw_record = RawAssetRecord(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        corpus=request.corpus,
        collection=request.collection,
        raw_source_uri=source_uri,
        content_hash=source_sha256,
        source_filename=_optional_text(released_file.get("original_filename")) or filename,
        object_key=object_key,
        content_type=_optional_text(released_file.get("mime_type")),
        file_extension=_normalize_extension(
            _optional_text(released_file.get("original_filename")) or filename
        ),
        byte_size=_optional_int(released_file.get("byte_size")),
        ingestion_timestamp=utc_now(),
        import_source=request.import_source,
    )
    inventory_entry = AuthenticatedNoticeFileReleaseInventoryEntry(
        corpus=request.corpus,
        collection=request.collection,
        file_release_id=file_release_id,
        site_id=request.site_id,
        export_scope=_required_text((export_manifest or {}).get("export_scope"), "export_scope"),
        collector_contract_version=_collector_version(export_manifest),
        source_home_url=request.source_home_url,
        filename=filename,
        upfilename=_optional_text(file_release.get("upfilename")),
        filecode=_optional_text(file_release.get("filecode")),
        filetime=_optional_text(file_release.get("filetime")),
        filedepartment=_optional_text(file_release.get("filedepartment")),
        explain_department=_optional_text(file_release.get("explain_department")),
        file_type_id=_optional_int(file_release.get("file_type_id")),
        file_type_name=_optional_text(file_release.get("file_type_name")),
        resolved_download_url=source_uri,
        released_file_storage_provider=storage_provider,
        released_file_bucket=_optional_text(released_file.get("bucket")),
        released_file_object_key=object_key,
        released_file_sha256=source_sha256,
        released_file_byte_size=_optional_int(released_file.get("byte_size")),
        released_file_ingest_status=_optional_text(released_file.get("ingest_status")),
        released_file_provenance_status=_optional_text(released_file.get("provenance_status")),
        updated_at=utc_now(),
        record={
            "file_release_id": file_release_id,
            "file_release": file_release,
            "released_file": released_file,
            "document_id": document_id,
            "raw_asset_id": raw_asset_id,
            "raw_version_id": raw_version_id,
            "source_artifact_keys": source_artifact_keys,
        },
    )
    return _PreparedFileReleaseImport(
        file_release_id=file_release_id,
        raw_record=raw_record,
        capture_artifacts=capture_artifacts,
        provider_artifacts=provider_artifacts,
        source_truth_artifacts=source_truth_artifacts,
        source_artifact_keys=source_artifact_keys,
        document_import=document_import,
        inventory_entry=inventory_entry,
    )


def _build_capture_artifacts(
    bundle_record: dict[str, Any],
    export_manifest: dict[str, Any] | None,
) -> dict[str, bytes]:
    file_release = _as_record(bundle_record.get("file_release"))
    return {
        "capture/list-response.json": _json_bytes(
            {
                "file_release_id": bundle_record.get("file_release_id"),
                "file_release": file_release,
            }
        ),
        "capture/detail-response.json": _json_bytes(bundle_record),
        "capture/fetch-metadata.json": _json_bytes(
            {
                "schema_version": "authenticated_notice_file_release_fetch_metadata_v1",
                "captured_at": _exported_at(export_manifest),
                "export_manifest": export_manifest or {},
            }
        ),
    }


def _build_provider_artifacts(bundle_record: dict[str, Any]) -> dict[str, bytes]:
    return {
        "provider/normalized-file-release.json": _json_bytes(
            {
                "schema_version": "authenticated_notice_file_release_normalized_v1",
                "file_release_id": bundle_record.get("file_release_id"),
                "file_release": _as_record(bundle_record.get("file_release")),
            }
        ),
        "provider/released-file-observation.json": _json_bytes(
            {
                "schema_version": "authenticated_notice_file_release_observation_v1",
                "file_release_id": bundle_record.get("file_release_id"),
                "released_file": _as_record(bundle_record.get("released_file")),
            }
        ),
    }


def _build_source_truth_artifacts(
    *,
    bundle_record: dict[str, Any],
    export_manifest: dict[str, Any] | None,
    raw_asset_id: str,
    raw_version_id: str,
    site_id: str,
    source_home_url: str,
    source_uri: str,
    content_blocks: tuple[dict[str, Any], ...],
) -> dict[str, bytes]:
    file_release = _as_record(bundle_record.get("file_release"))
    released_file = _as_record(bundle_record.get("released_file"))
    file_release_id = _required_int(bundle_record.get("file_release_id"), "file_release_id")
    return {
        "source-truth/file-release-manifest.json": _json_bytes(
            {
                "schema_version": FILE_RELEASE_MANIFEST_SCHEMA,
                "source_channel": AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
                "source_surface": FILE_RELEASE_SOURCE_SURFACE,
                "site_id": site_id,
                "file_release_id": file_release_id,
                "raw_asset_id": raw_asset_id,
                "raw_version_id": raw_version_id,
                "captured_at": _exported_at(export_manifest),
                "detail_observed_at": _optional_text(file_release.get("enrich_attempted_at"))
                or _exported_at(export_manifest),
                "fetcher_name": "authenticated_notice_file_release_import",
                "fetcher_version": _fetcher_version(export_manifest),
                "collector_version": _collector_version(export_manifest),
                "credentials_mode": "authenticated",
                "source_home_url": source_home_url,
                "source_file_url": source_uri,
                "filename": _optional_text(file_release.get("filename")),
                "upfilename": _optional_text(file_release.get("upfilename")),
                "filecode": _optional_text(file_release.get("filecode")),
                "filetime": _optional_text(file_release.get("filetime")),
                "filedepartment": _optional_text(file_release.get("filedepartment")),
                "explain_department": _optional_text(file_release.get("explain_department")),
                "file_type_id": _optional_int(file_release.get("file_type_id")),
                "file_type_name": _optional_text(file_release.get("file_type_name")),
                "released_file_object_key": _optional_text(released_file.get("object_key")),
                "released_file_sha256": _optional_text(released_file.get("sha256")),
                "released_file_byte_size": _optional_int(released_file.get("byte_size")),
                "released_file_mime_type": _optional_text(released_file.get("mime_type")),
                "block_count": len(content_blocks),
            }
        ),
        "source-truth/content-blocks.jsonl": _jsonl_bytes(content_blocks),
        "source-truth/released-file-ref.json": _json_bytes(
            {
                "schema_version": FILE_RELEASE_REF_SCHEMA,
                "raw_asset_id": raw_asset_id,
                "raw_version_id": raw_version_id,
                "file_release_id": file_release_id,
                "source_url": _optional_text(released_file.get("source_url")),
                "final_url": _optional_text(released_file.get("final_url")),
                "original_filename": _optional_text(released_file.get("original_filename")),
                "mime_type": _optional_text(released_file.get("mime_type")),
                "byte_size": _optional_int(released_file.get("byte_size")),
                "storage_provider": _optional_text(released_file.get("storage_provider")),
                "bucket": _optional_text(released_file.get("bucket")),
                "object_key": _optional_text(released_file.get("object_key")),
                "content_sha256": _optional_text(released_file.get("sha256")),
            }
        ),
    }


def _build_content_blocks(bundle_record: dict[str, Any]) -> tuple[dict[str, Any], ...]:
    file_release = _as_record(bundle_record.get("file_release"))
    released_file = _as_record(bundle_record.get("released_file"))
    raw_rows = [
        ("title", _required_text(file_release.get("filename"), "file_release.filename")),
        ("metadata", _metadata_line("文件编号", _optional_text(file_release.get("filecode")))),
        ("metadata", _metadata_line("发布时间", _optional_text(file_release.get("filetime")))),
        (
            "metadata",
            _metadata_line("发布部门", _optional_text(file_release.get("filedepartment"))),
        ),
        (
            "metadata",
            _metadata_line("说明部门", _optional_text(file_release.get("explain_department"))),
        ),
        (
            "metadata",
            _metadata_line("文件类型", _optional_text(file_release.get("file_type_name"))),
        ),
        (
            "metadata",
            _metadata_line("下载地址", _optional_text(file_release.get("resolved_download_url"))),
        ),
        (
            "metadata",
            _metadata_line("原始文件", _optional_text(released_file.get("original_filename"))),
        ),
    ]
    rows: list[dict[str, Any]] = []
    for index, (block_role, text) in enumerate(raw_rows, start=1):
        if not text:
            continue
        normalized = _normalize_text(text)
        rows.append(
            {
                "schema_version": FILE_RELEASE_BLOCK_SCHEMA,
                "row_id": f"block-{index:04d}",
                "row_index": len(rows),
                "block_order": len(rows) + 1,
                "block_role": block_role,
                "text_raw": text,
                "text_normalized": normalized,
            }
        )
    return tuple(rows)


def _build_canonical_markdown(bundle_record: dict[str, Any]) -> str:
    file_release = _as_record(bundle_record.get("file_release"))
    released_file = _as_record(bundle_record.get("released_file"))
    lines = [
        f"# {_required_text(file_release.get('filename'), 'file_release.filename')}",
    ]
    for label, value in (
        ("文件编号", _optional_text(file_release.get("filecode"))),
        ("发布时间", _optional_text(file_release.get("filetime"))),
        ("发布部门", _optional_text(file_release.get("filedepartment"))),
        ("说明部门", _optional_text(file_release.get("explain_department"))),
        ("文件类型", _optional_text(file_release.get("file_type_name"))),
        ("下载地址", _optional_text(file_release.get("resolved_download_url"))),
        ("原始文件", _optional_text(released_file.get("original_filename"))),
    ):
        if value:
            lines.append(f"- {label}：{value}")
    return "\n".join(lines).strip() + "\n"


def _build_document_units(
    *,
    document_id: str,
    version_id: str,
    source_uri: str,
    content_blocks: tuple[dict[str, Any], ...],
) -> bytes:
    rows = []
    for block in content_blocks:
        text = str(block.get("text_normalized") or "").strip()
        if not text:
            continue
        role = str(block.get("block_role") or "metadata")
        rows.append(
            {
                "doc_id": document_id,
                "version_id": version_id,
                "chunk_id": str(block.get("row_id") or ""),
                "root_unit_id": str(block.get("row_id") or ""),
                "unit_type": "policy_page" if role == "title" else "article_body",
                "text": text,
                "raw_text": str(block.get("text_raw") or text),
                "clean_text": text,
                "anchor": {
                    "block_order": block.get("block_order"),
                    "block_role": role,
                    "source_uri": source_uri,
                },
                "metadata": {
                    "block_role": role,
                },
            }
        )
    return _jsonl_bytes(tuple(rows))


def _build_file_release_raw_version_id(bundle_record: dict[str, Any]) -> str:
    file_release = _as_record(bundle_record.get("file_release"))
    released_file = _as_record(bundle_record.get("released_file"))
    payload = {
        "file_release_id": _required_int(bundle_record.get("file_release_id"), "file_release_id"),
        "filename": _optional_text(file_release.get("filename")),
        "filecode": _optional_text(file_release.get("filecode")),
        "filetime": _optional_text(file_release.get("filetime")),
        "resolved_download_url": _optional_text(file_release.get("resolved_download_url")),
        "released_file_object_key": _optional_text(released_file.get("object_key")),
        "released_file_sha256": _optional_text(released_file.get("sha256")),
    }
    digest = hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    return f"sha256:{digest}"


def _normalize_import_mode(mode: str) -> str:
    normalized = str(mode or "").strip().lower().replace("-", "_")
    aliases = {
        "dry_run": AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN,
        "dryrun": AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN,
        "preview": AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN,
        "materialize": AUTHENTICATED_NOTICE_IMPORT_MODE_ADMIT_AND_MATERIALIZE,
        "write": AUTHENTICATED_NOTICE_IMPORT_MODE_ADMIT_AND_MATERIALIZE,
        "admit": AUTHENTICATED_NOTICE_IMPORT_MODE_ADMIT_AND_MATERIALIZE,
        "admit_and_write": AUTHENTICATED_NOTICE_IMPORT_MODE_ADMIT_AND_MATERIALIZE,
    }
    normalized = aliases.get(normalized, normalized)
    if normalized not in _SUPPORTED_FILE_RELEASE_IMPORT_MODES:
        raise ValueError(
            "unsupported authenticated notice file-release import mode: "
            f"{mode!r}; expected one of {sorted(_SUPPORTED_FILE_RELEASE_IMPORT_MODES)}"
        )
    return normalized


def _fetcher_version(export_manifest: dict[str, Any] | None) -> str:
    return str((export_manifest or {}).get("schema_version") or "unknown")


def _collector_version(export_manifest: dict[str, Any] | None) -> str:
    collector = _as_record((export_manifest or {}).get("collector"))
    return _required_text(
        collector.get("export_contract_version")
        or collector.get("runtime_shell")
        or (export_manifest or {}).get("schema_version"),
        "collector.export_contract_version",
    )


def _exported_at(export_manifest: dict[str, Any] | None) -> str:
    return _required_text((export_manifest or {}).get("exported_at"), "exported_at")


def _infer_year(*values: object) -> str | None:
    for value in values:
        if not isinstance(value, str):
            continue
        match = _YEAR_RE.search(value)
        if match is not None:
            return match.group(1)
    return None


def _metadata_line(label: str, value: str | None) -> str | None:
    if not value:
        return None
    return f"{label}：{value}"


def _normalize_text(value: str) -> str:
    return _WHITESPACE_RE.sub(" ", value.replace("\xa0", " ")).strip()


def _json_bytes(payload: object) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def _jsonl_bytes(rows: tuple[dict[str, Any], ...]) -> bytes:
    return (
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows).strip() + "\n"
        if rows
        else ""
    ).encode("utf-8")


def _optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _required_text(value: object, label: str) -> str:
    normalized = _optional_text(value)
    if normalized is None:
        raise ValueError(f"{label} is required")
    return normalized


def _optional_int(value: object) -> int | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return None
    try:
        parsed = int(value)
    except (TypeError, ValueError):
        return None
    return parsed


def _required_int(value: object, label: str) -> int:
    parsed = _optional_int(value)
    if parsed is None:
        raise ValueError(f"{label} is required")
    return parsed


def _normalize_extension(filename: str) -> str | None:
    candidate = filename.rsplit("/", 1)[-1].rsplit(".", 1)
    if len(candidate) != 2 or not candidate[1].strip():
        return None
    return candidate[1].strip().lower()


def _as_record(value: object) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


__all__ = [
    "DEFAULT_AUTHENTICATED_DOCUMENTS_CORPUS",
    "DEFAULT_FILE_RELEASE_SOURCE_COLLECTION",
    "AuthenticatedNoticeFileReleaseImportRequest",
    "import_authenticated_notice_file_release_export",
]
