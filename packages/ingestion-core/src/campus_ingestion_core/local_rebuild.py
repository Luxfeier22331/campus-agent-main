from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from typing import Any, Callable, Protocol

from campus_contracts import ALLOWED_CORPORA
from qdrant_client import QdrantClient

from campus_ingestion_core.existing_ocr_import import import_campusrag_existing_ocr
from campus_ingestion_core.raw_ingestion import process_raw_ingestion_job
from campus_ingestion_core.registry import (
    DocumentRegistry,
    FileDocumentRegistry,
    FileRawAssetRegistry,
    RawAssetRegistry,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_retrieval_core.settings import DEFAULT_QDRANT_COLLECTION, RetrievalSettings


DEFAULT_INGESTION_CORPUS = "student_handbook"
ALLOWED_REBUILD_IMPORT_MODES = ("existing_ocr", "raw_online_ocr")


class ObjectStoreAdmin(Protocol):
    def delete_prefix(self, *, bucket: str, prefix: str) -> None: ...


class QdrantAdmin(Protocol):
    def reset_collection(self, collection_name: str) -> None: ...


@dataclass(frozen=True, slots=True)
class LocalDataRebuildReport:
    import_env: dict[str, str]
    import_result: object


class S3ObjectStoreAdmin:
    def __init__(self, settings: ObjectStoreSettings) -> None:
        from campus_ingestion_core.object_store import S3ObjectStoreClientFactory

        self._client = S3ObjectStoreClientFactory(settings).create()

    def delete_prefix(self, *, bucket: str, prefix: str) -> None:
        continuation_token: str | None = None
        while True:
            request: dict[str, object] = {"Bucket": bucket, "Prefix": prefix}
            if continuation_token is not None:
                request["ContinuationToken"] = continuation_token
            response = self._client.list_objects_v2(**request)
            keys = [{"Key": item["Key"]} for item in response.get("Contents") or ()]
            for start in range(0, len(keys), 1000):
                batch = keys[start : start + 1000]
                if batch:
                    self._client.delete_objects(
                        Bucket=bucket,
                        Delete={"Objects": batch, "Quiet": True},
                    )
            if not response.get("IsTruncated"):
                break
            continuation_token = response.get("NextContinuationToken")


class QdrantCollectionAdmin:
    def __init__(self, client: QdrantClient) -> None:
        self._client = client

    def reset_collection(self, collection_name: str) -> None:
        if self._client.collection_exists(collection_name):
            self._client.delete_collection(collection_name)


def rebuild_local_data(
    *,
    env: dict[str, str] | None = None,
    object_store: ObjectStoreAdmin | None = None,
    qdrant_admin: QdrantAdmin | None = None,
    import_runner: Callable[..., Any] | None = None,
    document_registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
) -> LocalDataRebuildReport:
    source = dict(env if env is not None else os.environ)
    corpus = _read_ingestion_corpus(source)
    import_mode = _read_rebuild_import_mode(source)
    object_store_settings = ObjectStoreSettings.from_env(source)

    object_store_admin = object_store or S3ObjectStoreAdmin(object_store_settings)
    object_store_admin.delete_prefix(bucket=object_store_settings.bucket_raw, prefix=f"{corpus}/")
    object_store_admin.delete_prefix(bucket=object_store_settings.bucket_processed, prefix=f"{corpus}/")
    runtime_document_registry = document_registry or _build_document_registry_for_rebuild(source, corpus)
    runtime_raw_asset_registry = raw_asset_registry or _build_raw_asset_registry_for_rebuild(source, corpus)
    runtime_document_registry.delete_by_corpus(corpus)
    runtime_raw_asset_registry.delete_by_corpus(corpus)

    if _parse_bool(source.get("REBUILD_RESET_QDRANT"), default=False):
        retrieval_settings = RetrievalSettings.from_env(source)
        qdrant_collection_admin = qdrant_admin or QdrantCollectionAdmin(_build_qdrant_client(retrieval_settings))
        qdrant_collection_admin.reset_collection(source.get("QDRANT_COLLECTION") or DEFAULT_QDRANT_COLLECTION)

    runtime_import_runner = import_runner or _resolve_import_runner(import_mode)

    return LocalDataRebuildReport(
        import_env=source,
        import_result=runtime_import_runner(env=source),
    )


def _build_qdrant_client(settings: RetrievalSettings) -> QdrantClient:
    if settings.qdrant_url == ":memory:":
        return QdrantClient(location=":memory:")
    return QdrantClient(
        url=settings.qdrant_url,
        api_key=settings.qdrant_api_key,
        timeout=settings.qdrant_timeout_seconds,
    )


def _parse_bool(value: str | None, *, default: bool) -> bool:
    if value is None or value == "":
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"invalid boolean value: {value}")


def _read_ingestion_corpus(source: dict[str, str]) -> str:
    corpus = (source.get("INGESTION_CORPUS") or DEFAULT_INGESTION_CORPUS).strip() or DEFAULT_INGESTION_CORPUS
    if corpus not in ALLOWED_CORPORA:
        raise ValueError(f"unsupported corpus: {corpus}")
    return corpus


def _read_rebuild_import_mode(source: dict[str, str]) -> str:
    import_mode = (source.get("REBUILD_IMPORT_MODE") or "").strip()
    if not import_mode:
        raise ValueError("REBUILD_IMPORT_MODE is required")
    if import_mode not in ALLOWED_REBUILD_IMPORT_MODES:
        raise ValueError(f"unsupported REBUILD_IMPORT_MODE: {import_mode}")
    return import_mode


def _resolve_import_runner(import_mode: str) -> Callable[..., Any]:
    if import_mode == "existing_ocr":
        return import_campusrag_existing_ocr
    if import_mode == "raw_online_ocr":
        return process_raw_ingestion_job
    raise ValueError(f"unsupported REBUILD_IMPORT_MODE: {import_mode}")


def _build_document_registry_for_rebuild(source: dict[str, str], corpus: str) -> DocumentRegistry:
    if (source.get("DOCUMENT_REGISTRY_DATABASE_URL") or "").strip():
        return build_document_registry_from_env(source)
    path = Path((source.get("DOCUMENT_REGISTRY_PATH") or f"./var/registry/{corpus}_documents.json").strip())
    return FileDocumentRegistry(path)


def _build_raw_asset_registry_for_rebuild(source: dict[str, str], corpus: str) -> RawAssetRegistry:
    if (source.get("DOCUMENT_REGISTRY_DATABASE_URL") or "").strip():
        return build_raw_asset_registry_from_env(source)
    path = Path((source.get("RAW_ASSET_REGISTRY_PATH") or f"./var/registry/{corpus}_raw_assets.json").strip())
    return FileRawAssetRegistry(path)
