from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from campus_ingestion_core.authenticated_notice_defaults import (
    DEFAULT_AUTHENTICATED_NOTICE_COLLECTION,
    DEFAULT_AUTHENTICATED_NOTICE_CORPUS,
    DEFAULT_AUTHENTICATED_NOTICE_EMBEDDING_MODEL,
    DEFAULT_AUTHENTICATED_NOTICE_ENTITLEMENT_GROUPS,
    DEFAULT_AUTHENTICATED_NOTICE_IMPORT_SOURCE,
    DEFAULT_AUTHENTICATED_NOTICE_PARSER_VERSION,
    DEFAULT_AUTHENTICATED_NOTICE_VISIBILITY_SCOPE,
)
from campus_ingestion_core.authenticated_notice_import_support import (
    assert_authenticated_notice_import_source_shape as _assert_authenticated_notice_import_source_shape,
)
from campus_ingestion_core.authenticated_notice_import_support import (
    normalize_import_mode as _normalize_import_mode,
)
from campus_ingestion_core.campus_agent_ingestion_support import DocumentImportInput
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.scope_catalog import assert_known_scope


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeImportRequest:
    bundle_path: Path | None = None
    export_manifest_path: Path | None = None
    site_id: str = ""
    source_home_url: str = ""
    run_id: str | None = None
    source_bucket: str | None = None
    capture_release_object_key: str | None = None
    capture_release_content_sha256: str | None = None
    capture_release_byte_size: int | None = None
    bundle_object_key: str | None = None
    manifest_object_key: str | None = None
    bundle_content_sha256: str | None = None
    bundle_byte_size: int | None = None
    manifest_content_sha256: str | None = None
    manifest_byte_size: int | None = None
    allow_local_fixture_import: bool = False
    consumer_admission_manifest_path: Path | None = None
    attachment_blob_root: Path | None = None
    corpus: str = DEFAULT_AUTHENTICATED_NOTICE_CORPUS
    collection: str = DEFAULT_AUTHENTICATED_NOTICE_COLLECTION
    default_entitlement_groups: tuple[str, ...] = DEFAULT_AUTHENTICATED_NOTICE_ENTITLEMENT_GROUPS
    visibility_scope: str | None = DEFAULT_AUTHENTICATED_NOTICE_VISIBILITY_SCOPE
    parser_version: str = DEFAULT_AUTHENTICATED_NOTICE_PARSER_VERSION
    embedding_model: str = DEFAULT_AUTHENTICATED_NOTICE_EMBEDDING_MODEL
    import_source: str = DEFAULT_AUTHENTICATED_NOTICE_IMPORT_SOURCE
    mode: str = "plan"
    replace_scope: bool = False
    source_truth_only: bool = False

    def __post_init__(self) -> None:
        if self.bundle_path is not None:
            object.__setattr__(self, "bundle_path", Path(self.bundle_path))
        if self.export_manifest_path is not None:
            object.__setattr__(self, "export_manifest_path", Path(self.export_manifest_path))
        if self.consumer_admission_manifest_path is not None:
            object.__setattr__(
                self,
                "consumer_admission_manifest_path",
                Path(self.consumer_admission_manifest_path),
            )
        if self.attachment_blob_root is not None:
            object.__setattr__(self, "attachment_blob_root", Path(self.attachment_blob_root))
        object.__setattr__(
            self,
            "default_entitlement_groups",
            tuple(group.strip() for group in self.default_entitlement_groups if group.strip()),
        )
        object.__setattr__(self, "mode", _normalize_import_mode(self.mode))
        for field_name in (
            "run_id",
            "source_bucket",
            "capture_release_object_key",
            "capture_release_content_sha256",
            "bundle_object_key",
            "manifest_object_key",
            "bundle_content_sha256",
            "manifest_content_sha256",
        ):
            value = getattr(self, field_name)
            if isinstance(value, str):
                object.__setattr__(self, field_name, value.strip() or None)
        assert_known_scope(self.corpus, self.collection)
        if not self.site_id.strip():
            raise ValueError("site_id is required")
        if not self.source_home_url.strip():
            raise ValueError("source_home_url is required")
        _assert_authenticated_notice_import_source_shape(self)


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticePreparedImport:
    notice_id: str
    raw_asset_id: str
    raw_version_id: str
    raw_record: RawAssetRecord
    capture_artifacts: dict[str, bytes]
    provider_artifacts: dict[str, bytes]
    source_truth_artifacts: dict[str, bytes]
    source_artifact_keys: dict[str, str]
    document_import: DocumentImportInput


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeBundleImportResult:
    notice_count: int
    notice_imports: tuple[AuthenticatedNoticePreparedImport, ...]


__all__ = [
    "AuthenticatedNoticeBundleImportResult",
    "AuthenticatedNoticeImportRequest",
    "AuthenticatedNoticePreparedImport",
]
