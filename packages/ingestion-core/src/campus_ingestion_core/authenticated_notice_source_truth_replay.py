from __future__ import annotations

from dataclasses import asdict, dataclass
import os
from pathlib import Path
from typing import Any, Protocol
from urllib.parse import urlsplit

from campus_ingestion_core.authenticated_notice_import import (
    DEFAULT_AUTHENTICATED_NOTICE_COLLECTION,
    DEFAULT_AUTHENTICATED_NOTICE_CORPUS,
    DEFAULT_AUTHENTICATED_NOTICE_VISIBILITY_SCOPE,
)
from campus_ingestion_core.authenticated_notice_source_projections import (
    DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_IMPORT_SOURCE,
    DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_PARSER_VERSION,
    _AuthenticatedNoticeParentSourceTruth,
    _build_attachment_document,
    _build_parent_notice_document,
    _classify_attachment_ref,
    _find_processed_key,
    _load_json_payload,
    _load_jsonl_rows,
    _parse_notice_document_id,
    load_authenticated_notice_source_projections_config,
    read_authenticated_notice_source_projections_config_path,
)
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRecord
from campus_ingestion_core.object_store import is_source_object_key
from campus_ingestion_core.raw_ingestion import (
    OnlineOcrClient,
    OnlineOcrSettings,
    PaddleOcrAsyncClient,
)
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
    config_path = request.source_projections_path or read_authenticated_notice_source_projections_config_path(
        env if env is not None else {}
    )
    config = load_authenticated_notice_source_projections_config(config_path)
    if config.source_corpus != request.corpus or config.source_collection != request.collection:
        raise ValueError(
            "authenticated notice source replay config scope mismatch: "
            f"expected {request.corpus}/{request.collection}, "
            f"got {config.source_corpus}/{config.source_collection}"
        )

    parent_snapshots: list[dict[str, Any]] = []
    site_ids: set[str] = set()
    source_home_urls: set[str] = set()
    embedding_models: set[str] = set()
    expected_document_count = 0
    expected_attachment_document_count = 0
    expected_raw_asset_keys: set[tuple[str, str]] = set()

    records = tuple(
        sorted(
            document_registry.list_by_scope(request.corpus, request.collection),
            key=lambda record: (record.document_id, record.revision_track, record.version_id),
        )
    )
    for record in records:
        if record.source_channel != "authenticated_notice_portal":
            continue
        notice_manifest_key = _find_processed_key(record, "source-truth/notice-manifest.json")
        content_blocks_key = _find_processed_key(record, "source-truth/content-blocks.jsonl")
        attachment_refs_key = _find_processed_key(record, "source-truth/attachment-refs.jsonl")
        if notice_manifest_key is None or content_blocks_key is None or attachment_refs_key is None:
            continue
        if record.raw_asset is None:
            raise ValueError(f"authenticated notice source-truth parent missing raw asset: {record.document_id}")
        raw_record = raw_asset_registry.get(
            record.raw_asset.raw_asset_id,
            record.raw_asset.raw_version_id,
        )
        if raw_record is None:
            raise ValueError(
                "authenticated notice source replay requires persisted raw asset registry truth: "
                f"{record.raw_asset.raw_asset_id}/{record.raw_asset.raw_version_id}"
            )
        manifest = _load_json_payload(
            object_store.get_bytes(
                bucket=object_store_settings.bucket_source,
                key=notice_manifest_key,
            )
        )
        attachment_refs = _load_jsonl_rows(
            object_store.get_bytes(
                bucket=object_store_settings.bucket_source,
                key=attachment_refs_key,
            )
        )
        expected_attachment_documents: list[dict[str, str]] = []
        for attachment_ref in attachment_refs:
            classification = _classify_attachment_ref(
                attachment_ref=attachment_ref,
                config=config,
            )
            attachment_ref_id = str(attachment_ref.get("attachment_ref_id") or "").strip()
            if classification == "reference_only":
                continue
            if classification == "unsupported_binary":
                raise ValueError(
                    "unsupported authenticated notice attachment requires an explicit extractor before replay: "
                    f"{record.document_id}#{attachment_ref_id or 'unknown'}"
                )
            if not attachment_ref_id:
                raise ValueError(f"{record.document_id} attachment_ref_id is required")
            site_id, notice_id = _parse_notice_document_id(record.document_id)
            expected_attachment_documents.append(
                {
                    "attachment_ref_id": attachment_ref_id,
                    "classification": classification,
                    "document_id": f"notice_attachment:{site_id}:{notice_id}:{attachment_ref_id}",
                }
            )
        site_id, _notice_id = _parse_notice_document_id(record.document_id)
        site_ids.add(site_id)
        source_home_urls.add(
            _normalize_non_empty_text(manifest.get("source_home_url"))
            or _derive_source_home_url(record.source_uri)
        )
        embedding_models.add(record.embedding_model)
        expected_document_count += 1 + len(expected_attachment_documents)
        expected_attachment_document_count += len(expected_attachment_documents)
        expected_raw_asset_keys.add((raw_record.raw_asset_id, raw_record.raw_version_id))
        parent_snapshots.append(
            {
                "notice_id": _notice_id,
                "document_id": record.document_id,
                "record": _serialize_document_record(record),
                "raw_record": asdict(raw_record),
                "source_artifact_keys": [
                    key
                    for key in record.processed_object_keys
                    if key and is_source_object_key(str(key))
                ],
                "notice_manifest_key": notice_manifest_key,
                "content_blocks_key": content_blocks_key,
                "attachment_refs_key": attachment_refs_key,
                "expected_attachment_documents": expected_attachment_documents,
            }
        )

    if not parent_snapshots:
        raise ValueError(
            f"no authenticated notice source-truth parents found for {request.corpus}/{request.collection}"
        )
    if len(site_ids) != 1:
        raise ValueError(f"authenticated notice source replay requires a single site_id, got {sorted(site_ids)}")
    embedding_model = next((item for item in sorted(embedding_models) if item.strip()), "")
    if not embedding_model:
        raise ValueError("authenticated notice source replay requires a non-empty embedding_model")
    source_home_url = next((item for item in sorted(source_home_urls) if item.strip()), "")
    if not source_home_url:
        raise ValueError("authenticated notice source replay requires a non-empty source_home_url")
    ordered_parents = tuple(sorted(parent_snapshots, key=lambda item: str(item["notice_id"])))
    return AuthenticatedNoticeSourceTruthReplayInventory(
        site_id=next(iter(site_ids)),
        source_home_url=source_home_url,
        embedding_model=embedding_model,
        expected_notice_count=len(ordered_parents),
        expected_document_count=expected_document_count,
        expected_attachment_document_count=expected_attachment_document_count,
        expected_raw_asset_count=len(expected_raw_asset_keys),
        parents=ordered_parents,
    )


def build_authenticated_notice_source_truth_replay_documents(
    *,
    parent_snapshot: dict[str, Any],
    request: AuthenticatedNoticeSourceTruthReplayRequest,
    object_store: AuthenticatedNoticeSourceTruthReplayObjectStore,
    object_store_settings: ObjectStoreSettings,
    env: dict[str, str] | None = None,
    ocr_client: OnlineOcrClient | None = None,
) -> tuple[object, ...]:
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
    documents: list[object] = [
        _build_parent_notice_document(
            parent_source_truth=parent_source_truth,
            runtime_profile=runtime_profile,
        )
    ]
    runtime_ocr_client = ocr_client
    source = env if env is not None else dict(os.environ)
    for attachment_ref in parent_source_truth.attachment_refs:
        classification = _classify_attachment_ref(
            attachment_ref=attachment_ref,
            config=config,
        )
        if classification == "reference_only":
            continue
        if classification == "unsupported_binary":
            raise ValueError(
                "unsupported authenticated notice attachment requires an explicit extractor: "
                f"{parent_source_truth.record.document_id}#{attachment_ref.get('attachment_ref_id')}"
            )
        if classification == "ocr_required" and runtime_ocr_client is None:
            settings = OnlineOcrSettings.from_env(source, required=True)
            if settings is None:  # pragma: no cover
                raise ValueError("OCR_BASE_URL and OCR_API_KEY must be configured together")
            runtime_ocr_client = PaddleOcrAsyncClient(settings)
        documents.append(
            _build_attachment_document(
                parent_source_truth=parent_source_truth,
                attachment_ref=attachment_ref,
                classification=classification,
                config=config,
                object_store=object_store,
                object_store_settings=object_store_settings,
                ocr_client=runtime_ocr_client,
                runtime_profile=runtime_profile,
            )
        )
    return tuple(documents)


def _serialize_document_record(record: DocumentRegistryRecord) -> dict[str, Any]:
    return {
        "document_id": record.document_id,
        "revision_track": record.revision_track,
        "version_id": record.version_id,
        "source_uri": record.source_uri,
        "content_hash": record.content_hash,
        "corpus": record.corpus,
        "collection": record.collection,
        "cleaning_policy_version": record.cleaning_policy_version,
        "entitlement_groups": list(record.entitlement_groups),
        "visibility_scope": record.visibility_scope,
        "visibility_level": record.visibility_level,
        "policy_projection_version": record.policy_projection_version,
        "status": record.status,
        "ingestion_timestamp": record.ingestion_timestamp,
        "parser_version": record.parser_version,
        "embedding_model": record.embedding_model,
        "source_channel": record.source_channel,
        "is_current": record.is_current,
        "effective_date": record.effective_date,
        "published_date": record.published_date,
        "supersedes_version_id": record.supersedes_version_id,
        "provenance_status": record.provenance_status,
        "document_units_object_key": record.document_units_object_key,
        "provider_response_object_key": record.provider_response_object_key,
        "canonical_markdown_object_key": record.canonical_markdown_object_key,
        "processed_object_keys": list(record.processed_object_keys),
        "import_source": record.import_source,
    }


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


def _derive_source_home_url(source_uri: str) -> str:
    normalized = source_uri.strip()
    parsed = urlsplit(normalized)
    if parsed.scheme and parsed.netloc:
        return f"{parsed.scheme}://{parsed.netloc}"
    return normalized


def _normalize_non_empty_text(value: Any) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


__all__ = [
    "AuthenticatedNoticeSourceTruthReplayInventory",
    "AuthenticatedNoticeSourceTruthReplayRequest",
    "SOURCE_TRUTH_REPLAY_INPUT_KIND",
    "build_authenticated_notice_source_truth_replay_documents",
    "load_authenticated_notice_source_truth_replay_inventory",
]
