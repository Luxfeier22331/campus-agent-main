from __future__ import annotations

from dataclasses import asdict, dataclass
import os
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlsplit

from campus_ingestion_core.authenticated_notice_defaults import (
    DEFAULT_AUTHENTICATED_NOTICE_COLLECTION,
    DEFAULT_AUTHENTICATED_NOTICE_CORPUS,
    DEFAULT_AUTHENTICATED_NOTICE_VISIBILITY_SCOPE,
)
from campus_ingestion_core.authenticated_notice_source_projections import (
    AuthenticatedNoticeProjectedNotice,
    DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_IMPORT_SOURCE,
    DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_PARSER_VERSION,
    _AuthenticatedNoticeParentSourceTruth,
    _project_parent_source_truth,
    _load_json_payload,
    _load_jsonl_rows,
    load_authenticated_notice_source_projections_config,
    read_authenticated_notice_source_projections_config_path,
)
from campus_ingestion_core.authenticated_notice_source_truth_inventory import (
    AuthenticatedNoticeSourceTruthInventoryEntry,
    AuthenticatedNoticeSourceTruthInventoryStore,
    build_authenticated_notice_source_truth_inventory_entries,
)
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRecord
from campus_ingestion_core.raw_ingestion import OnlineOcrClient
from campus_ingestion_core.registry import DocumentRegistry, RawAssetRegistry
from campus_ingestion_core.scope_catalog import assert_known_scope
from campus_ingestion_core.settings import ObjectStoreSettings


SOURCE_TRUTH_REPLAY_INPUT_KIND = "source_truth_replay"


class AuthenticatedNoticeSourceTruthReplayObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeSourceTruthReplayRequest:
    corpus: str = DEFAULT_AUTHENTICATED_NOTICE_CORPUS
    collection: str = DEFAULT_AUTHENTICATED_NOTICE_COLLECTION
    source_projections_path: Path | None = None
    default_visibility_scope: str | None = DEFAULT_AUTHENTICATED_NOTICE_VISIBILITY_SCOPE

    def __post_init__(self) -> None:
        if self.source_projections_path is not None:
            object.__setattr__(self, "source_projections_path", Path(self.source_projections_path))
        assert_known_scope(self.corpus, self.collection)


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeSourceTruthReplayInventory:
    site_id: str
    source_home_url: str
    embedding_model: str
    expected_notice_count: int
    expected_document_count: int
    expected_attachment_document_count: int
    expected_ocr_candidate_count: int
    expected_raw_asset_count: int
    parents: tuple[dict[str, Any], ...]


def load_authenticated_notice_source_truth_replay_inventory(
    *,
    request: AuthenticatedNoticeSourceTruthReplayRequest,
    document_registry: DocumentRegistry,
    raw_asset_registry: RawAssetRegistry,
    object_store: AuthenticatedNoticeSourceTruthReplayObjectStore,
    object_store_settings: ObjectStoreSettings,
    env: dict[str, str] | None = None,
) -> AuthenticatedNoticeSourceTruthReplayInventory:
    entries = build_authenticated_notice_source_truth_inventory_entries(
        corpus=request.corpus,
        collection=request.collection,
        document_registry=document_registry,
        raw_asset_registry=raw_asset_registry,
        object_store=object_store,
        object_store_settings=object_store_settings,
        source_projections_path=request.source_projections_path,
        env=env,
    )
    return _inventory_from_entries(entries, corpus=request.corpus, collection=request.collection)


def load_authenticated_notice_source_truth_replay_inventory_from_store(
    *,
    request: AuthenticatedNoticeSourceTruthReplayRequest,
    source_truth_inventory_store: AuthenticatedNoticeSourceTruthInventoryStore,
) -> AuthenticatedNoticeSourceTruthReplayInventory:
    entries = source_truth_inventory_store.list_by_scope(
        request.corpus,
        request.collection,
    )
    return _inventory_from_entries(entries, corpus=request.corpus, collection=request.collection)


def build_authenticated_notice_source_truth_replay_documents(
    *,
    parent_snapshot: dict[str, Any],
    request: AuthenticatedNoticeSourceTruthReplayRequest,
    object_store: AuthenticatedNoticeSourceTruthReplayObjectStore,
    object_store_settings: ObjectStoreSettings,
    env: dict[str, str] | None = None,
    ocr_client: OnlineOcrClient | None = None,
) -> AuthenticatedNoticeProjectedNotice:
    config_path = request.source_projections_path or read_authenticated_notice_source_projections_config_path(
        env if env is not None else {}
    )
    config = load_authenticated_notice_source_projections_config(config_path)
    runtime_profile = load_runtime_profile(request.corpus, request.collection)
    parent_source_truth = _load_parent_source_truth_from_snapshot(
        parent_snapshot=parent_snapshot,
        object_store=object_store,
        object_store_settings=object_store_settings,
    )
    source = env if env is not None else dict(os.environ)
    projected_notice, _runtime_ocr_client = _project_parent_source_truth(
        parent_source_truth=parent_source_truth,
        config=config,
        object_store=object_store,
        object_store_settings=object_store_settings,
        runtime_profile=runtime_profile,
        ocr_client=ocr_client,
        env=source,
    )
    return projected_notice


def _document_record_from_snapshot(
    payload: dict[str, Any],
    *,
    processed_object_keys: tuple[str, ...],
) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=str(payload["document_id"]),
        revision_track=str(payload["revision_track"]),
        version_id=str(payload["version_id"]),
        source_uri=str(payload["source_uri"]),
        content_hash=str(payload["content_hash"]),
        corpus=str(payload["corpus"]),
        collection=str(payload["collection"]),
        cleaning_policy_version=str(payload.get("cleaning_policy_version") or ""),
        entitlement_groups=tuple(str(item) for item in payload.get("entitlement_groups") or ()),
        visibility_scope=payload.get("visibility_scope"),
        visibility_level=str(payload.get("visibility_level") or ""),
        policy_projection_version=str(payload.get("policy_projection_version") or ""),
        status=str(payload.get("status") or "active"),
        ingestion_timestamp=str(payload.get("ingestion_timestamp") or ""),
        parser_version=str(payload.get("parser_version") or ""),
        embedding_model=str(payload.get("embedding_model") or ""),
        source_channel=str(payload.get("source_channel") or ""),
        is_current=bool(payload.get("is_current", False)),
        effective_date=payload.get("effective_date"),
        published_date=payload.get("published_date"),
        supersedes_version_id=payload.get("supersedes_version_id"),
        provenance_status=str(payload.get("provenance_status") or ""),
        raw_asset=None,
        source_observations=(),
        document_units_object_key=payload.get("document_units_object_key"),
        provider_response_object_key=payload.get("provider_response_object_key"),
        canonical_markdown_object_key=payload.get("canonical_markdown_object_key"),
        processed_object_keys=processed_object_keys,
        import_source=str(payload.get("import_source") or ""),
    )


def _load_parent_source_truth_from_snapshot(
    *,
    parent_snapshot: dict[str, Any],
    object_store: AuthenticatedNoticeSourceTruthReplayObjectStore,
    object_store_settings: ObjectStoreSettings,
) -> _AuthenticatedNoticeParentSourceTruth:
    source_artifact_keys = tuple(str(item) for item in parent_snapshot.get("source_artifact_keys") or ())
    record = _document_record_from_snapshot(
        dict(parent_snapshot["record"]),
        processed_object_keys=source_artifact_keys,
    )
    notice_manifest_key = str(parent_snapshot["notice_manifest_key"])
    content_blocks_key = str(parent_snapshot["content_blocks_key"])
    attachment_refs_key = str(parent_snapshot["attachment_refs_key"])
    manifest = _load_json_payload(
        object_store.get_bytes(
            bucket=object_store_settings.bucket_source,
            key=notice_manifest_key,
        )
    )
    content_blocks = _load_jsonl_rows(
        object_store.get_bytes(
            bucket=object_store_settings.bucket_source,
            key=content_blocks_key,
        )
    )
    attachment_refs = _load_jsonl_rows(
        object_store.get_bytes(
            bucket=object_store_settings.bucket_source,
            key=attachment_refs_key,
        )
    )
    return _AuthenticatedNoticeParentSourceTruth(
        record=record,
        manifest=manifest,
        content_blocks=content_blocks,
        attachment_refs=attachment_refs,
        source_keys=source_artifact_keys,
        notice_manifest_key=notice_manifest_key,
        content_blocks_key=content_blocks_key,
        attachment_refs_key=attachment_refs_key,
    )

def _inventory_from_entries(
    entries: Sequence[AuthenticatedNoticeSourceTruthInventoryEntry],
    *,
    corpus: str,
    collection: str,
) -> AuthenticatedNoticeSourceTruthReplayInventory:
    if not entries:
        raise ValueError(
            f"no authenticated notice source-truth parents found for {corpus}/{collection}"
        )
    site_ids = {entry.site_id for entry in entries if entry.site_id.strip()}
    if len(site_ids) != 1:
        raise ValueError(f"authenticated notice source replay requires a single site_id, got {sorted(site_ids)}")
    source_home_urls = {
        entry.source_home_url for entry in entries if entry.source_home_url.strip()
    }
    if len(source_home_urls) != 1:
        raise ValueError(
            "authenticated notice source replay requires a single non-empty source_home_url"
        )
    embedding_models = {
        entry.embedding_model for entry in entries if entry.embedding_model.strip()
    }
    if len(embedding_models) != 1:
        raise ValueError(
            "authenticated notice source replay requires a single non-empty embedding_model"
        )
    ordered_parents = tuple(
        sorted(
            (dict(entry.parent_snapshot) for entry in entries),
            key=lambda item: str(item["notice_id"]),
        )
    )
    return AuthenticatedNoticeSourceTruthReplayInventory(
        site_id=next(iter(site_ids)),
        source_home_url=next(iter(source_home_urls)),
        embedding_model=next(iter(embedding_models)),
        expected_notice_count=len(ordered_parents),
        expected_document_count=sum(1 + entry.attachment_document_count for entry in entries),
        expected_attachment_document_count=sum(
            entry.attachment_document_count for entry in entries
        ),
        expected_ocr_candidate_count=sum(entry.ocr_required_count for entry in entries),
        expected_raw_asset_count=len(
            {(entry.raw_asset_id, entry.raw_version_id) for entry in entries}
        ),
        parents=ordered_parents,
    )


__all__ = [
    "AuthenticatedNoticeSourceTruthReplayInventory",
    "AuthenticatedNoticeSourceTruthReplayRequest",
    "SOURCE_TRUTH_REPLAY_INPUT_KIND",
    "build_authenticated_notice_source_truth_replay_documents",
    "load_authenticated_notice_source_truth_replay_inventory",
    "load_authenticated_notice_source_truth_replay_inventory_from_store",
]
