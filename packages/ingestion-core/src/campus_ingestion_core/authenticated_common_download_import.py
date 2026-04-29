from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_defaults import (
    DEFAULT_AUTHENTICATED_NOTICE_EMBEDDING_MODEL,
    DEFAULT_AUTHENTICATED_NOTICE_ENTITLEMENT_GROUPS,
    DEFAULT_AUTHENTICATED_NOTICE_VISIBILITY_SCOPE,
)
from campus_ingestion_core.authenticated_notice_import import (
    AUTHENTICATED_NOTICE_IMPORT_MODE_ADMIT_AND_MATERIALIZE,
    AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN,
    AuthenticatedNoticeImportRequest,
    import_authenticated_notice_export,
    load_authenticated_notice_bundle_payload,
    load_authenticated_notice_export_manifest,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryStore,
)
from campus_ingestion_core.campusrag_ingestion_support import S3ObjectStoreWriter
from campus_ingestion_core.registry import DocumentRegistry, RawAssetRegistry
from campus_ingestion_core.scope_catalog import assert_known_scope

DEFAULT_AUTHENTICATED_DOCUMENTS_CORPUS = "authenticated_documents"
DEFAULT_COMMON_DOWNLOAD_COLLECTION = "common_download_source"
DEFAULT_COMMON_DOWNLOAD_IMPORT_SOURCE = "authenticated_common_download_import_v1"
DEFAULT_COMMON_DOWNLOAD_PARSER_VERSION = "authenticated_common_download_import_v1"
COMMON_DOWNLOAD_NOTICE_TYPE_ID = "9982"
_SUPPORTED_IMPORT_MODES = {
    AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN,
    AUTHENTICATED_NOTICE_IMPORT_MODE_ADMIT_AND_MATERIALIZE,
}


@dataclass(frozen=True, slots=True)
class AuthenticatedCommonDownloadImportRequest:
    bundle_path: Path
    manifest_path: Path
    site_id: str
    source_home_url: str
    attachment_blob_root: Path | None = None
    corpus: str = DEFAULT_AUTHENTICATED_DOCUMENTS_CORPUS
    collection: str = DEFAULT_COMMON_DOWNLOAD_COLLECTION
    default_entitlement_groups: tuple[str, ...] = DEFAULT_AUTHENTICATED_NOTICE_ENTITLEMENT_GROUPS
    visibility_scope: str | None = DEFAULT_AUTHENTICATED_NOTICE_VISIBILITY_SCOPE
    parser_version: str = DEFAULT_COMMON_DOWNLOAD_PARSER_VERSION
    embedding_model: str = DEFAULT_AUTHENTICATED_NOTICE_EMBEDDING_MODEL
    import_source: str = DEFAULT_COMMON_DOWNLOAD_IMPORT_SOURCE
    mode: str = AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN
    replace_scope: bool = False

    def __post_init__(self) -> None:
        object.__setattr__(self, "bundle_path", Path(self.bundle_path))
        object.__setattr__(self, "manifest_path", Path(self.manifest_path))
        if self.attachment_blob_root is not None:
            object.__setattr__(self, "attachment_blob_root", Path(self.attachment_blob_root))
        object.__setattr__(
            self,
            "default_entitlement_groups",
            tuple(group.strip() for group in self.default_entitlement_groups if group.strip()),
        )
        normalized_mode = str(self.mode or "").strip().lower().replace("-", "_")
        if normalized_mode not in _SUPPORTED_IMPORT_MODES:
            raise ValueError(f"unsupported common-download import mode: {self.mode}")
        object.__setattr__(self, "mode", normalized_mode)
        assert_known_scope(self.corpus, self.collection)
        _assert_common_download_import_scope(self.corpus, self.collection)
        if not self.site_id.strip():
            raise ValueError("site_id is required")
        if not self.source_home_url.strip():
            raise ValueError("source_home_url is required")


def import_authenticated_common_download_export(
    *,
    request: AuthenticatedCommonDownloadImportRequest,
    env: dict[str, str] | None = None,
    object_store: S3ObjectStoreWriter | object | None = None,
    document_registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore | None = None,
) -> dict[str, Any]:
    export_manifest = load_authenticated_notice_export_manifest(request.manifest_path)
    bundle_payload = load_authenticated_notice_bundle_payload(request.bundle_path)
    _validate_common_download_export(
        export_manifest=export_manifest,
        bundle_payload=bundle_payload,
    )
    replace_scope = request.replace_scope or _manifest_declares_full_scope_replace(export_manifest)
    result = import_authenticated_notice_export(
        request=AuthenticatedNoticeImportRequest(
            bundle_path=request.bundle_path,
            export_manifest_path=request.manifest_path,
            attachment_blob_root=request.attachment_blob_root,
            site_id=request.site_id,
            source_home_url=request.source_home_url,
            allow_local_fixture_import=True,
            corpus=request.corpus,
            collection=request.collection,
            default_entitlement_groups=request.default_entitlement_groups,
            visibility_scope=request.visibility_scope,
            parser_version=request.parser_version,
            embedding_model=request.embedding_model,
            import_source=request.import_source,
            mode=request.mode,
            replace_scope=replace_scope,
            source_truth_only=True,
        ),
        env=env,
        object_store=object_store,
        document_registry=document_registry,
        raw_asset_registry=raw_asset_registry,
        source_truth_inventory_store=source_truth_inventory_store,
    )
    normalized = dict(result)
    normalized["replace_scope"] = replace_scope
    normalized["source_truth_only"] = True
    return normalized


def _assert_common_download_import_scope(corpus: str, collection: str) -> None:
    if (corpus, collection) != (
        DEFAULT_AUTHENTICATED_DOCUMENTS_CORPUS,
        DEFAULT_COMMON_DOWNLOAD_COLLECTION,
    ):
        raise ValueError(
            "authenticated common-download imports must target "
            "authenticated_documents/common_download_source"
        )


def _validate_common_download_export(
    *,
    export_manifest: dict[str, Any] | None,
    bundle_payload: tuple[dict[str, Any], ...],
) -> None:
    if not isinstance(export_manifest, dict):
        raise ValueError("common-download import requires export manifest")
    if str(export_manifest.get("source_channel") or "").strip() != "authenticated_notice_portal":
        raise ValueError(
            "common-download import requires source_channel=authenticated_notice_portal"
        )
    source_surface = str(export_manifest.get("source_surface") or "").strip()
    if source_surface and source_surface != "notice":
        raise ValueError("common-download import requires source_surface=notice")
    notice_types = _manifest_notice_types(export_manifest)
    if notice_types != (COMMON_DOWNLOAD_NOTICE_TYPE_ID,):
        raise ValueError("common-download import requires manifest notice_types=['9982']")
    invalid_notice_ids = [
        str(record.get("notice_id") or "").strip()
        for record in bundle_payload
        if COMMON_DOWNLOAD_NOTICE_TYPE_ID not in _bundle_record_notice_type_ids(record)
    ]
    if invalid_notice_ids:
        raise ValueError(
            "common-download import bundle rows must include notice_type 9982; invalid notice_ids: "
            + ", ".join(item for item in invalid_notice_ids if item)
        )


def _manifest_notice_types(export_manifest: dict[str, Any]) -> tuple[str, ...]:
    filters = export_manifest.get("filters")
    if not isinstance(filters, dict):
        return ()
    return tuple(
        str(item).strip() for item in list(filters.get("notice_types") or []) if str(item).strip()
    )


def _bundle_record_notice_type_ids(record: dict[str, Any]) -> tuple[str, ...]:
    notice = record.get("notice")
    if not isinstance(notice, dict):
        return ()
    categories = notice.get("categories")
    if not isinstance(categories, list):
        return ()
    ids: list[str] = []
    for item in categories:
        if not isinstance(item, dict):
            continue
        notice_type = str(item.get("notice_type") or "").strip()
        if notice_type:
            ids.append(notice_type)
    return tuple(ids)


def _manifest_declares_full_scope_replace(export_manifest: dict[str, Any]) -> bool:
    if _selected_notice_ids(export_manifest):
        return False
    return (
        export_manifest.get("full_scope_requested") is True
        and export_manifest.get("full_scope_completed") is True
        and export_manifest.get("page_budget_exhausted") is not True
    )


def _selected_notice_ids(export_manifest: dict[str, Any]) -> tuple[str, ...]:
    filters = export_manifest.get("filters")
    filter_selected = ()
    if isinstance(filters, dict):
        filter_selected = tuple(
            str(item).strip()
            for item in list(filters.get("selected_notice_ids") or [])
            if str(item).strip()
        )
    if filter_selected:
        return filter_selected
    run_admission = export_manifest.get("run_admission")
    if not isinstance(run_admission, dict):
        return ()
    return tuple(
        str(item).strip()
        for item in list(run_admission.get("selected_notice_ids") or [])
        if str(item).strip()
    )


__all__ = [
    "AuthenticatedCommonDownloadImportRequest",
    "import_authenticated_common_download_export",
]
