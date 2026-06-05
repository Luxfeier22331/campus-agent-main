from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

from campus_ingestion_core.authenticated_notice_collector_run_ledger import (
    DEFAULT_AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_TABLE,
)
from campus_ingestion_core.authenticated_notice_defaults import (
    DEFAULT_AUTHENTICATED_NOTICE_EMBEDDING_MODEL,
    DEFAULT_AUTHENTICATED_NOTICE_ENTITLEMENT_GROUPS,
    DEFAULT_AUTHENTICATED_NOTICE_VISIBILITY_SCOPE,
)
from campus_ingestion_core.authenticated_notice_file_release_import_scalars import (
    DEFAULT_AUTHENTICATED_DOCUMENTS_CORPUS,
    DEFAULT_FILE_RELEASE_IMPORT_SOURCE,
    DEFAULT_FILE_RELEASE_PARSER_VERSION,
    DEFAULT_FILE_RELEASE_SOURCE_COLLECTION,
    _assert_file_release_import_scope,
    _normalize_import_mode,
)
from campus_ingestion_core.authenticated_notice_file_release_inventory import (
    AuthenticatedNoticeFileReleaseInventoryEntry,
)
from campus_ingestion_core.authenticated_notice_import import AUTHENTICATED_NOTICE_IMPORT_MODE_PLAN
from campus_ingestion_core.campusrag_ingestion_support import DocumentImportInput
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.scope_catalog import assert_known_scope


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeFileReleaseImportRequest:
    bundle_path: Path | None = None
    manifest_path: Path | None = None
    site_id: str = ""
    source_home_url: str = ""
    run_id: str | None = None
    source_bucket: str | None = None
    bundle_object_key: str | None = None
    manifest_object_key: str | None = None
    bundle_content_sha256: str | None = None
    bundle_byte_size: int | None = None
    manifest_content_sha256: str | None = None
    manifest_byte_size: int | None = None
    allow_local_fixture_import: bool = False
    collector_run_ledger_table: str = DEFAULT_AUTHENTICATED_NOTICE_COLLECTOR_RUN_LEDGER_TABLE
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
        if self.bundle_path is not None:
            object.__setattr__(self, "bundle_path", Path(self.bundle_path))
        if self.manifest_path is not None:
            object.__setattr__(self, "manifest_path", Path(self.manifest_path))
        object.__setattr__(
            self,
            "default_entitlement_groups",
            tuple(group.strip() for group in self.default_entitlement_groups if group.strip()),
        )
        object.__setattr__(self, "mode", _normalize_import_mode(self.mode))
        for field_name in (
            "run_id",
            "source_bucket",
            "bundle_object_key",
            "manifest_object_key",
            "bundle_content_sha256",
            "manifest_content_sha256",
            "collector_run_ledger_table",
        ):
            value = getattr(self, field_name)
            if isinstance(value, str):
                object.__setattr__(self, field_name, value.strip() or None)
        assert_known_scope(self.corpus, self.collection)
        _assert_file_release_import_scope(self.corpus, self.collection)
        if not self.site_id.strip():
            raise ValueError("site_id is required")
        if not self.source_home_url.strip():
            raise ValueError("source_home_url is required")
        _assert_file_release_import_source_shape(self)


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


def _assert_file_release_import_source_shape(
    request: AuthenticatedNoticeFileReleaseImportRequest,
) -> None:
    run_id_selected = request.run_id is not None
    object_ref_selected = any(
        value is not None
        for value in (
            request.source_bucket,
            request.bundle_object_key,
            request.manifest_object_key,
        )
    )
    local_selected = request.bundle_path is not None or request.manifest_path is not None
    selected_mode_count = sum((run_id_selected, object_ref_selected, local_selected))
    if selected_mode_count != 1:
        raise ValueError(
            "authenticated notice file-release import requires exactly one input mode: "
            "run_id, object refs, or local fixture import"
        )
    if run_id_selected:
        return
    if object_ref_selected:
        from campus_ingestion_core.authenticated_notice_import_sources import (
            explicit_authenticated_notice_import_object_refs,
        )

        explicit_authenticated_notice_import_object_refs(
            source_bucket=request.source_bucket,
            bundle_object_key=request.bundle_object_key,
            manifest_object_key=request.manifest_object_key,
            bundle_content_sha256=request.bundle_content_sha256,
            bundle_byte_size=request.bundle_byte_size,
            manifest_content_sha256=request.manifest_content_sha256,
            manifest_byte_size=request.manifest_byte_size,
        )
        return
    if request.bundle_path is None or request.manifest_path is None:
        raise ValueError(
            "bundle_path and manifest_path are required for authenticated notice "
            "file-release local fixture import"
        )
    if not request.allow_local_fixture_import:
        raise ValueError(
            "--allow-local-fixture-import / allow_local_fixture_import is required for "
            "authenticated notice "
            "file-release local fixture import"
        )
