from __future__ import annotations

from dataclasses import dataclass
import os
from pathlib import Path
from typing import Any, Callable, Protocol

from campus_contracts import (
    ALLOWED_CORPORA,
    DEFAULT_COLLECTION,
    DEFAULT_CORPUS,
    KNOWN_COLLECTION_TO_CORPUS,
)
from qdrant_client import QdrantClient

from campus_ingestion_core.artifacts import (
    LAYOUT_ELEMENTS_FILENAME,
    PROVIDER_RESPONSE_FILENAME,
)
from campus_ingestion_core.campusrag_ingestion_support import (
    DocumentImportInput,
    ImportReport,
    ObjectStoreWriter,
    PersistImportStats,
    collect_import_document_stats,
    load_metadata_from_bytes,
    persist_import_documents,
    write_import_report,
)
from campus_ingestion_core.collection_config import CollectionTruthConfig, resolve_collection_truth_config
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.curriculum_provider_normalize import normalize_curriculum_provider_result
from campus_ingestion_core.embed import EmbeddingSettings, build_embedding_model
from campus_ingestion_core.handbook_cleanup import cleanup_handbook_document, serialize_handbook_document_units
from campus_ingestion_core.handbook_source_projections import (
    build_handbook_projection_import_documents,
    build_declared_projection_processed_keys,
    load_handbook_source_projections_config,
)
from campus_ingestion_core.handbook_provider_normalize import (
    normalize_handbook_provider_result,
    serialize_handbook_layout_elements,
)
from campus_ingestion_core.object_store import (
    DEFAULT_RAW_SOURCE_CHANNEL,
    S3ObjectStoreClientFactory,
    build_source_model_slug,
    build_source_ocr_artifact_key,
    build_source_truth_artifact_key,
    build_raw_asset_key,
    infer_year_label,
    is_source_object_key,
    parse_source_object_key,
)
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.process import build_indexable_chunks_from_jsonl, index_chunks_to_qdrant
from campus_ingestion_core.sparse import SparseEmbeddingSettings, build_sparse_embedding_model
from campus_ingestion_core.raw_ingestion import (
    DEFAULT_ONLINE_OCR_MODEL,
    DEFAULT_ONLINE_OCR_PROVIDER,
    DEFAULT_RAW_ONLINE_OCR_PARSER_VERSION,
    _build_split_manifest_document_input,
    _load_layout_elements_rows,
    process_raw_ingestion_job,
)
from campus_ingestion_core.registry import (
    DocumentRegistry,
    RawAssetRegistry,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.split_manifest import SplitManifestDocument, load_split_manifest
from campus_retrieval_core.settings import DEFAULT_QDRANT_COLLECTION, RetrievalSettings


DEFAULT_INGESTION_CORPUS = DEFAULT_CORPUS
DEFAULT_INGESTION_COLLECTION = DEFAULT_COLLECTION
DEFAULT_REPLAY_SOURCE_PDF = "学生手册_2018.pdf"
DEFAULT_CURRICULUM_REPLAY_SOURCE_PDF = "curriculum-plan.pdf"
DEFAULT_HANDBOOK_CANONICAL_RAW_FILENAME = "学生手册_2018.pdf"
ALLOWED_REBUILD_IMPORT_MODES = ("raw_online_ocr", "provider_response_replay")
DEFAULT_QDRANT_UPSERT_BATCH_SIZE = 128
DEFAULT_INGESTION_QDRANT_TIMEOUT_SECONDS = 60.0


class ObjectStoreAdmin(Protocol):
    def delete_prefix(self, *, bucket: str, prefix: str, exclude_keys: tuple[str, ...] = ()) -> None: ...


class ReplayObjectStore(ObjectStoreWriter, Protocol):
    def delete_prefix(self, *, bucket: str, prefix: str, exclude_keys: tuple[str, ...] = ()) -> None: ...

    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


class QdrantAdmin(Protocol):
    def reset_collection(self, collection_name: str) -> None: ...


@dataclass(frozen=True, slots=True)
class LocalDataRebuildReport:
    import_context: dict[str, str]
    import_result: object


@dataclass(frozen=True, slots=True)
class StudentHandbookMigrationReport:
    canonical_raw_filename: str
    previous_raw_object_key: str
    canonical_raw_object_key: str
    rebuild_report: LocalDataRebuildReport


@dataclass(frozen=True, slots=True)
class RebuildRequest:
    corpus: str
    collection: str
    import_mode: str
    raw_version_id: str | None = None
    raw_asset_id: str | None = None
    source_pdf: str | None = None
    reset_qdrant: bool = False
    index_qdrant: bool = False


@dataclass(frozen=True, slots=True)
class StudentHandbookSourceAssetRequest:
    raw_version_id: str
    raw_asset_id: str | None = None
    source_pdf: str | None = None
    canonical_raw_filename: str = DEFAULT_HANDBOOK_CANONICAL_RAW_FILENAME


class S3ObjectStoreAdmin:
    def __init__(self, settings: ObjectStoreSettings) -> None:
        self._client = S3ObjectStoreClientFactory(settings).create()

    def healthcheck(self, *, bucket: str) -> None:
        self._client.list_objects_v2(Bucket=bucket, MaxKeys=1)

    def delete_prefix(self, *, bucket: str, prefix: str, exclude_keys: tuple[str, ...] = ()) -> None:
        excluded = set(exclude_keys)
        continuation_token: str | None = None
        while True:
            request: dict[str, object] = {"Bucket": bucket, "Prefix": prefix}
            if continuation_token is not None:
                request["ContinuationToken"] = continuation_token
            response = self._client.list_objects_v2(**request)
            keys = [
                {"Key": item["Key"]}
                for item in response.get("Contents") or ()
                if item["Key"] not in excluded
            ]
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

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        response = self._client.get_object(Bucket=bucket, Key=key)
        return response["Body"].read()

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self._client.put_object(
            Bucket=bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )

    def copy_bytes(
        self,
        *,
        bucket: str,
        source_key: str,
        target_key: str,
        content_type: str,
    ) -> None:
        data = self.get_bytes(bucket=bucket, key=source_key)
        self.put_bytes(bucket=bucket, key=target_key, data=data, content_type=content_type)


class QdrantCollectionAdmin:
    def __init__(self, client: QdrantClient) -> None:
        self._client = client

    def reset_collection(self, collection_name: str) -> None:
        if self._client.collection_exists(collection_name):
            self._client.delete_collection(collection_name)


def _resolve_primary_qdrant_collection_name(source: dict[str, str]) -> str:
    return (source.get("QDRANT_COLLECTION") or DEFAULT_QDRANT_COLLECTION).strip() or DEFAULT_QDRANT_COLLECTION


def _resolve_target_qdrant_collection_name(
    source: dict[str, str],
    *,
    corpus: str,
    collection: str,
) -> str:
    primary_scope = (_read_ingestion_corpus(source), _read_ingestion_collection(source, corpus=_read_ingestion_corpus(source)))
    if (corpus, collection) == primary_scope:
        return _resolve_primary_qdrant_collection_name(source)
    return collection


def _resolve_rebuild_target_qdrant_collections(
    *,
    source: dict[str, str],
    request: RebuildRequest,
    collection_config: CollectionTruthConfig,
) -> tuple[str, ...]:
    target_collections = [
        _resolve_target_qdrant_collection_name(
            source,
            corpus=request.corpus,
            collection=request.collection,
        )
    ]
    if request.import_mode == "provider_response_replay" and request.collection == "student_handbook":
        projections_config = load_handbook_source_projections_config(collection_config.source_projections_path)
        for projection in projections_config.projections:
            if projection.target_corpus == projections_config.source_corpus and projection.target_collection == projections_config.source_collection:
                continue
            target_collections.append(
                _resolve_target_qdrant_collection_name(
                    source,
                    corpus=projection.target_corpus,
                    collection=projection.target_collection,
                )
            )
    return tuple(dict.fromkeys(target_collections))


def rebuild_local_data(
    *,
    env: dict[str, str] | None = None,
    request: RebuildRequest | None = None,
    collection_config: CollectionTruthConfig | None = None,
    object_store: ReplayObjectStore | None = None,
    qdrant_admin: QdrantAdmin | None = None,
    import_runner: Callable[..., Any] | None = None,
    document_registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
) -> LocalDataRebuildReport:
    source = dict(env if env is not None else os.environ)
    runtime_request = request or _build_rebuild_request_from_env(source)
    runtime_collection_config = collection_config or _resolve_runtime_collection_config(
        source=source,
        corpus=runtime_request.corpus,
        collection=runtime_request.collection,
    )
    import_env = _build_rebuild_import_env(
        source=source,
        request=runtime_request,
        collection_config=runtime_collection_config,
    )
    corpus = runtime_request.corpus
    collection = runtime_request.collection
    import_mode = runtime_request.import_mode
    object_store_settings = ObjectStoreSettings.from_env(source)

    object_store_admin = object_store or S3ObjectStoreAdmin(object_store_settings)
    runtime_document_registry = document_registry or _build_document_registry_for_rebuild(source, corpus)
    runtime_raw_asset_registry = raw_asset_registry or _build_raw_asset_registry_for_rebuild(source, corpus)
    processed_exclude_keys = _processed_bucket_exclude_keys(
        source=import_env,
        corpus=corpus,
        collection=collection,
        import_mode=import_mode,
    )
    document_records = _list_document_records_for_scope(runtime_document_registry, corpus, collection)
    _delete_object_keys(
        object_store_admin=object_store_admin,
        bucket=object_store_settings.bucket_derived,
        object_keys=_collect_processed_rebuild_keys(
            source=import_env,
            corpus=corpus,
            collection=collection,
            import_mode=import_mode,
            registry=runtime_document_registry,
            document_records=document_records,
        ),
        exclude_keys=processed_exclude_keys,
    )
    if _should_delete_document_registry_scope(collection=collection, import_mode=import_mode):
        runtime_document_registry.delete_by_scope(corpus, collection)

    if runtime_request.reset_qdrant:
        retrieval_settings = RetrievalSettings.from_env(source)
        qdrant_collection_admin = qdrant_admin or QdrantCollectionAdmin(
            _build_qdrant_client(retrieval_settings, source=source)
        )
        for collection_name in _resolve_rebuild_target_qdrant_collections(
            source=source,
            request=runtime_request,
            collection_config=runtime_collection_config,
        ):
            qdrant_collection_admin.reset_collection(collection_name)

    runtime_import_runner = import_runner or _resolve_import_runner(import_mode)

    return LocalDataRebuildReport(
        import_context=_build_rebuild_report_context(import_env),
        import_result=runtime_import_runner(env=import_env),
    )


def _build_rebuild_request_from_env(source: dict[str, str]) -> RebuildRequest:
    corpus = _read_ingestion_corpus(source)
    collection = _read_ingestion_collection(source, corpus=corpus)
    import_mode = _read_rebuild_import_mode(source)
    raw_asset_id = _normalize_optional_text(source.get("RAW_ASSET_ID"))
    raw_version_id = _normalize_optional_text(source.get("RAW_VERSION_ID"))
    if import_mode == "provider_response_replay" and raw_version_id is None:
        raise ValueError("RAW_VERSION_ID is required for provider_response_replay")
    return RebuildRequest(
        corpus=corpus,
        collection=collection,
        import_mode=import_mode,
        raw_version_id=raw_version_id,
        raw_asset_id=raw_asset_id,
        source_pdf=_normalize_optional_text(source.get("REPLAY_SOURCE_PDF")),
        reset_qdrant=_parse_bool(source.get("REBUILD_RESET_QDRANT"), default=False),
        index_qdrant=_parse_bool(source.get("REBUILD_INDEX_QDRANT"), default=False),
    )


def _build_rebuild_import_env(
    *,
    source: dict[str, str],
    request: RebuildRequest,
    collection_config: CollectionTruthConfig,
) -> dict[str, str]:
    import_env = dict(source)
    import_env["INGESTION_CORPUS"] = request.corpus
    import_env["INGESTION_COLLECTION"] = request.collection
    import_env["REBUILD_IMPORT_MODE"] = request.import_mode
    if request.reset_qdrant:
        import_env["REBUILD_RESET_QDRANT"] = "1"
    if request.index_qdrant:
        import_env["REBUILD_INDEX_QDRANT"] = "1"
    if request.raw_asset_id:
        import_env["RAW_ASSET_ID"] = request.raw_asset_id
    if request.raw_version_id:
        import_env["RAW_VERSION_ID"] = request.raw_version_id
    if collection_config.split_manifest_path.exists():
        import_env["INGESTION_SPLIT_MANIFEST_PATH"] = str(collection_config.split_manifest_path.resolve())
    if collection_config.source_projections_path is not None:
        import_env["HANDBOOK_SOURCE_PROJECTIONS_PATH"] = str(collection_config.source_projections_path.resolve())
    if request.import_mode == "provider_response_replay":
        raw_asset_id = _resolve_collection_raw_asset_id(request=request, collection_config=collection_config)
        raw_version_id = request.raw_version_id
        if raw_version_id is None:
            raise ValueError("raw_version_id is required for provider_response_replay")
        source_pdf = request.source_pdf or _default_replay_source_pdf(request.collection)
        import_env["REPLAY_SOURCE_PDF"] = source_pdf
    return import_env


_REBUILD_REPORT_CONTEXT_KEYS = (
    "INGESTION_CORPUS",
    "INGESTION_COLLECTION",
    "REBUILD_IMPORT_MODE",
    "REBUILD_RESET_QDRANT",
    "REBUILD_INDEX_QDRANT",
    "RAW_ASSET_ID",
    "RAW_VERSION_ID",
    "INGESTION_SPLIT_MANIFEST_PATH",
    "HANDBOOK_SOURCE_PROJECTIONS_PATH",
    "REPLAY_SOURCE_PDF",
    "QDRANT_COLLECTION",
)


def _build_rebuild_report_context(import_env: dict[str, str]) -> dict[str, str]:
    return {
        key: import_env[key]
        for key in _REBUILD_REPORT_CONTEXT_KEYS
        if key in import_env and import_env[key] != ""
    }


def _resolve_collection_raw_asset_id(
    *,
    request: RebuildRequest,
    collection_config: CollectionTruthConfig,
) -> str:
    split_manifest = load_split_manifest(
        collection_config.split_manifest_path,
        expected_corpus=request.corpus,
        expected_collection=request.collection,
    )
    if request.raw_asset_id is not None and request.raw_asset_id != split_manifest.raw_asset_id:
        raise ValueError("request raw_asset_id does not match collection split manifest raw_asset_id")
    return request.raw_asset_id or split_manifest.raw_asset_id


def _resolve_runtime_collection_config(
    *,
    source: dict[str, str],
    corpus: str,
    collection: str,
) -> CollectionTruthConfig:
    base = resolve_collection_truth_config(corpus, collection)
    split_manifest_override = _normalize_optional_text(source.get("INGESTION_SPLIT_MANIFEST_PATH"))
    source_projections_override = _normalize_optional_text(source.get("HANDBOOK_SOURCE_PROJECTIONS_PATH"))
    return CollectionTruthConfig(
        corpus=base.corpus,
        collection=base.collection,
        config_root=base.config_root,
        runtime_profile_path=base.runtime_profile_path,
        split_manifest_path=(Path(split_manifest_override).resolve() if split_manifest_override else base.split_manifest_path),
        canonical_profile_path=base.canonical_profile_path,
        chunk_profile_path=base.chunk_profile_path,
        source_projections_path=(
            Path(source_projections_override).resolve()
            if source_projections_override
            else base.source_projections_path
        ),
    )


def _delete_object_keys(
    *,
    object_store_admin: ObjectStoreAdmin,
    bucket: str,
    object_keys: tuple[str, ...],
    exclude_keys: tuple[str, ...] = (),
) -> None:
    excluded = set(exclude_keys)
    for object_key in dict.fromkeys(key for key in object_keys if key and key not in excluded):
        object_store_admin.delete_prefix(bucket=bucket, prefix=object_key)


def _list_document_records_for_scope(
    registry: DocumentRegistry,
    corpus: str,
    collection: str,
) -> tuple[Any, ...]:
    list_by_scope = getattr(registry, "list_by_scope", None)
    if callable(list_by_scope):
        return tuple(list_by_scope(corpus, collection))
    list_by_corpus = getattr(registry, "list_by_corpus", None)
    if callable(list_by_corpus):
        return tuple(record for record in list_by_corpus(corpus) if getattr(record, "collection", None) == collection)
    return ()


def _list_raw_asset_records_for_scope(
    registry: RawAssetRegistry,
    corpus: str,
    collection: str,
) -> tuple[RawAssetRecord, ...]:
    list_by_scope = getattr(registry, "list_by_scope", None)
    if callable(list_by_scope):
        return tuple(list_by_scope(corpus, collection))
    list_by_corpus = getattr(registry, "list_by_corpus", None)
    if callable(list_by_corpus):
        return tuple(record for record in list_by_corpus(corpus) if getattr(record, "collection", None) == collection)
    return ()


def _collect_processed_rebuild_keys(
    *,
    source: dict[str, str],
    corpus: str,
    collection: str,
    import_mode: str,
    registry: DocumentRegistry,
    document_records: tuple[Any, ...],
) -> tuple[str, ...]:
    keys: list[str] = []
    for record in document_records:
        for key in tuple(getattr(record, "processed_object_keys", ()) or ()):
            if key and _is_derived_artifact_key(key):
                keys.append(key)
    keys.extend(
        _extra_processed_rebuild_keys(
            source=source,
            corpus=corpus,
            collection=collection,
            import_mode=import_mode,
            registry=registry,
            document_records=document_records,
        )
    )
    return tuple(dict.fromkeys(keys))


def _extra_processed_rebuild_keys(
    *,
    source: dict[str, str],
    corpus: str,
    collection: str,
    import_mode: str,
    registry: DocumentRegistry,
    document_records: tuple[Any, ...],
) -> tuple[str, ...]:
    if import_mode != "provider_response_replay" or collection != "student_handbook":
        return ()
    return (
        *_declared_projection_processed_keys(
            source=source,
            registry=registry,
            current_document_records=document_records,
        ),
    )


def _is_derived_artifact_key(key: str) -> bool:
    return not is_source_object_key(key)


def migrate_student_handbook_source_faithful(
    *,
    env: dict[str, str] | None = None,
    request: StudentHandbookSourceAssetRequest | None = None,
    object_store: ReplayObjectStore | None = None,
    qdrant_admin: QdrantAdmin | None = None,
    document_registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
) -> StudentHandbookMigrationReport:
    source = dict(env if env is not None else os.environ)
    runtime_request = request or _build_student_handbook_source_asset_request_from_env(source)
    corpus = "regulations"
    collection = "student_handbook"
    collection_config = _resolve_runtime_collection_config(source=source, corpus=corpus, collection=collection)
    object_store_settings = ObjectStoreSettings.from_env(source)
    runtime_object_store = object_store or S3ObjectStoreAdmin(object_store_settings)
    runtime_raw_asset_registry = raw_asset_registry or _build_raw_asset_registry_for_rebuild(source, corpus)
    split_manifest = load_split_manifest(
        collection_config.split_manifest_path,
        expected_corpus=corpus,
        expected_collection=collection,
    )
    raw_asset_id = runtime_request.raw_asset_id or split_manifest.raw_asset_id
    if raw_asset_id != split_manifest.raw_asset_id:
        raise ValueError("request raw_asset_id does not match collection split manifest raw_asset_id")
    canonical_raw_filename = runtime_request.canonical_raw_filename
    raw_version_id = runtime_request.raw_version_id
    raw_record = runtime_raw_asset_registry.get(raw_asset_id, raw_version_id)
    if raw_record is None:
        raise ValueError("raw asset registry record is required before handbook migration")

    canonical_raw_object_key = build_raw_asset_key(
        corpus=corpus,
        raw_asset_id=raw_record.raw_asset_id,
        raw_version_id=raw_record.raw_version_id,
        filename=canonical_raw_filename,
    )
    canonical_raw_record = RawAssetRecord(
        raw_asset_id=raw_record.raw_asset_id,
        raw_version_id=raw_record.raw_version_id,
        corpus=corpus,
        collection=collection,
        raw_source_uri=raw_record.raw_source_uri,
        content_hash=raw_record.content_hash,
        source_filename=canonical_raw_filename,
        object_key=canonical_raw_object_key,
        ingestion_timestamp=raw_record.ingestion_timestamp,
        import_source=raw_record.import_source,
    )
    if raw_record.object_key != canonical_raw_object_key:
        raw_bytes = runtime_object_store.get_bytes(
            bucket=object_store_settings.bucket_source,
            key=raw_record.object_key,
        )
        runtime_object_store.put_bytes(
            bucket=object_store_settings.bucket_source,
            key=canonical_raw_object_key,
            data=raw_bytes,
            content_type="application/pdf",
        )
        runtime_object_store.delete_prefix(
            bucket=object_store_settings.bucket_source,
            prefix=raw_record.object_key,
            exclude_keys=(canonical_raw_object_key,),
        )
    runtime_raw_asset_registry.upsert(canonical_raw_record)

    rebuild_env = dict(source)
    rebuild_env["REPLAY_SOURCE_PDF"] = canonical_raw_filename
    rebuild_report = rebuild_local_data(
        env=rebuild_env,
        request=RebuildRequest(
            corpus=corpus,
            collection=collection,
            import_mode="provider_response_replay",
            raw_asset_id=raw_asset_id,
            raw_version_id=raw_version_id,
            source_pdf=canonical_raw_filename,
            reset_qdrant=_parse_bool(source.get("REBUILD_RESET_QDRANT"), default=False),
            index_qdrant=_parse_bool(source.get("REBUILD_INDEX_QDRANT"), default=False),
        ),
        object_store=runtime_object_store,
        qdrant_admin=qdrant_admin,
        document_registry=document_registry,
        raw_asset_registry=runtime_raw_asset_registry,
    )
    return StudentHandbookMigrationReport(
        canonical_raw_filename=canonical_raw_filename,
        previous_raw_object_key=raw_record.object_key,
        canonical_raw_object_key=canonical_raw_object_key,
        rebuild_report=rebuild_report,
    )
def _build_qdrant_client(settings: RetrievalSettings, *, source: dict[str, str] | None = None) -> QdrantClient:
    if settings.qdrant_url == ":memory:":
        return QdrantClient(location=":memory:")
    return QdrantClient(
        url=settings.qdrant_url,
        api_key=settings.qdrant_api_key,
        timeout=_resolve_ingestion_qdrant_timeout_seconds(
            source=source,
            default_timeout_seconds=settings.qdrant_timeout_seconds,
        ),
        cloud_inference=True,
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


def _resolve_ingestion_qdrant_timeout_seconds(
    *,
    source: dict[str, str] | None,
    default_timeout_seconds: float,
) -> float:
    env = source if source is not None else {}
    raw_value = _normalize_optional_text(env.get("INGESTION_QDRANT_TIMEOUT_SECONDS"))
    if raw_value is not None:
        timeout_seconds = float(raw_value)
        if timeout_seconds <= 0:
            raise ValueError("INGESTION_QDRANT_TIMEOUT_SECONDS must be greater than zero")
        return timeout_seconds
    return max(default_timeout_seconds, DEFAULT_INGESTION_QDRANT_TIMEOUT_SECONDS)


def _read_ingestion_corpus(source: dict[str, str]) -> str:
    corpus = (source.get("INGESTION_CORPUS") or DEFAULT_INGESTION_CORPUS).strip() or DEFAULT_INGESTION_CORPUS
    if corpus not in ALLOWED_CORPORA:
        raise ValueError(f"unsupported corpus: {corpus}")
    return corpus


def _read_ingestion_collection(source: dict[str, str], *, corpus: str) -> str:
    collection = (
        source.get("INGESTION_COLLECTION") or DEFAULT_INGESTION_COLLECTION
    ).strip() or DEFAULT_INGESTION_COLLECTION
    expected_corpus = KNOWN_COLLECTION_TO_CORPUS.get(collection)
    if expected_corpus is not None and expected_corpus != corpus:
        raise ValueError(f"unsupported collection scope: {collection} does not belong to {corpus}")
    return collection


def _read_rebuild_import_mode(source: dict[str, str]) -> str:
    import_mode = (source.get("REBUILD_IMPORT_MODE") or "").strip()
    if not import_mode:
        raise ValueError("REBUILD_IMPORT_MODE is required")
    if import_mode not in ALLOWED_REBUILD_IMPORT_MODES:
        raise ValueError(f"unsupported REBUILD_IMPORT_MODE: {import_mode}")
    return import_mode


def _build_student_handbook_source_asset_request_from_env(
    source: dict[str, str],
) -> StudentHandbookSourceAssetRequest:
    raw_version_id = _normalize_optional_text(source.get("RAW_VERSION_ID"))
    raw_asset_id = _normalize_optional_text(source.get("RAW_ASSET_ID"))
    if raw_version_id is None:
        raise ValueError("RAW_VERSION_ID is required for handbook source migration")
    return StudentHandbookSourceAssetRequest(
        raw_version_id=raw_version_id,
        raw_asset_id=raw_asset_id,
        source_pdf=_normalize_optional_text(source.get("REPLAY_SOURCE_PDF")),
        canonical_raw_filename=(
            _normalize_optional_text(source.get("HANDBOOK_CANONICAL_RAW_FILENAME"))
            or DEFAULT_HANDBOOK_CANONICAL_RAW_FILENAME
        ),
    )


def _resolve_import_runner(import_mode: str) -> Callable[..., Any]:
    if import_mode == "raw_online_ocr":
        return process_raw_ingestion_job
    if import_mode == "provider_response_replay":
        return replay_provider_response_rebuild
    raise ValueError(f"unsupported REBUILD_IMPORT_MODE: {import_mode}")


def _build_document_registry_for_rebuild(source: dict[str, str], corpus: str) -> DocumentRegistry:
    return build_document_registry_from_env(source)


def _build_raw_asset_registry_for_rebuild(source: dict[str, str], corpus: str) -> RawAssetRegistry:
    return build_raw_asset_registry_from_env(source)


def replay_provider_response_rebuild(
    *,
    env: dict[str, str] | None = None,
    object_store: ReplayObjectStore | None = None,
    registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
    qdrant_client: QdrantClient | None = None,
) -> ImportReport:
    source = dict(env if env is not None else os.environ)
    corpus = _read_ingestion_corpus(source)
    collection = _read_ingestion_collection(source, corpus=corpus)
    collection_config = _resolve_runtime_collection_config(source=source, corpus=corpus, collection=collection)
    if collection not in {"student_handbook", "curriculum_plan"}:
        raise ValueError("provider_response_replay only supports student_handbook or curriculum_plan")
    source_pdf = (
        source.get("REPLAY_SOURCE_PDF") or _default_replay_source_pdf(collection)
    ).strip() or _default_replay_source_pdf(collection)

    object_store_settings = ObjectStoreSettings.from_env(source)
    runtime_object_store = object_store or S3ObjectStoreAdmin(object_store_settings)
    split_manifest = load_split_manifest(
        collection_config.split_manifest_path,
        expected_corpus=corpus,
        expected_collection=collection,
    )
    raw_version_id = _read_required_env(source, "RAW_VERSION_ID")
    provider_response_key = build_source_ocr_artifact_key(
        raw_asset_id=split_manifest.raw_asset_id,
        raw_version_id=raw_version_id,
        filename=PROVIDER_RESPONSE_FILENAME,
        source_channel=DEFAULT_RAW_SOURCE_CHANNEL,
        model_slug=build_source_model_slug(
            (source.get("OCR_MODEL") or DEFAULT_ONLINE_OCR_MODEL).strip() or DEFAULT_ONLINE_OCR_MODEL
        ),
        year=infer_year_label(source_pdf),
    )
    provider_response_bytes = runtime_object_store.get_bytes(
        bucket=object_store_settings.bucket_source,
        key=provider_response_key,
    )
    ocr_model = (source.get("OCR_MODEL") or DEFAULT_ONLINE_OCR_MODEL).strip() or DEFAULT_ONLINE_OCR_MODEL
    if collection == "student_handbook":
        structured_rows = normalize_handbook_provider_result(
            source_pdf=source_pdf,
            provider_jsonl_bytes=provider_response_bytes,
            ocr_provider=DEFAULT_ONLINE_OCR_PROVIDER,
            ocr_model=ocr_model,
            source_artifact_id=split_manifest.raw_asset_id,
        )
        layout_elements_bytes = serialize_handbook_layout_elements(structured_rows)
    else:
        layout_elements_bytes = normalize_curriculum_provider_result(
            provider_jsonl_bytes=provider_response_bytes,
            source_pdf=source_pdf,
            ocr_model=ocr_model,
        )
        structured_rows = _load_layout_elements_rows(layout_elements_bytes)
    layout_elements_key = build_source_truth_artifact_key(
        raw_asset_id=split_manifest.raw_asset_id,
        raw_version_id=raw_version_id,
        filename=LAYOUT_ELEMENTS_FILENAME,
        source_channel=DEFAULT_RAW_SOURCE_CHANNEL,
        year=infer_year_label(source_pdf),
    )
    runtime_object_store.put_bytes(
        bucket=object_store_settings.bucket_source,
        key=provider_response_key,
        data=provider_response_bytes,
        content_type="application/x-ndjson",
    )
    runtime_object_store.put_bytes(
        bucket=object_store_settings.bucket_source,
        key=layout_elements_key,
        data=layout_elements_bytes,
        content_type="application/x-ndjson",
    )
    _cleanup_legacy_replay_source_objects(
        object_store=runtime_object_store,
        object_store_settings=object_store_settings,
        source_provider_response_key=provider_response_key,
        canonical_provider_response_key=provider_response_key,
        canonical_layout_elements_key=layout_elements_key,
    )

    if collection == "student_handbook":
        documents = [
            _build_handbook_replay_document_input(
                source_label=f"{provider_response_key}#{manifest_document.document_id}",
                source_doc=source_pdf,
                manifest_document=manifest_document,
                structured_rows=structured_rows,
                provider_response_key=provider_response_key,
                layout_elements_key=layout_elements_key,
                corpus=corpus,
                collection=collection,
            )
            for manifest_document in split_manifest.documents
        ]
    else:
        raw_asset_ref = RawAssetRecord(
            raw_asset_id=split_manifest.raw_asset_id,
            raw_version_id=raw_version_id,
            corpus=corpus,
            collection=collection,
            raw_source_uri=f"campusrag://source/{corpus}/{split_manifest.raw_asset_id}/{raw_version_id}",
            content_hash=raw_version_id.removeprefix("sha256:") or raw_version_id,
            source_filename=source_pdf,
            object_key=provider_response_key,
            ingestion_timestamp="1970-01-01T00:00:00+00:00",
            import_source="provider_response_replay",
        )
        default_campus_scope = (source.get("INGESTION_DEFAULT_CAMPUS_SCOPE") or "").strip() or None
        documents = [
            _build_split_manifest_document_input(
                raw_asset_record=raw_asset_ref,
                manifest_version=split_manifest.manifest_version,
                manifest_document=manifest_document,
                structured_rows=structured_rows,
                provider_response_key=provider_response_key,
                layout_elements_key=layout_elements_key,
                default_campus_scope=default_campus_scope,
                corpus=corpus,
                collection=collection,
            )
            for manifest_document in split_manifest.documents
        ]
    raw_asset_ref = RawAssetRecord(
        raw_asset_id=split_manifest.raw_asset_id,
        raw_version_id=raw_version_id,
        corpus=corpus,
        collection=collection,
        raw_source_uri=f"campusrag://source/{corpus}/{split_manifest.raw_asset_id}/{raw_version_id}",
        content_hash=raw_version_id.removeprefix("sha256:") or raw_version_id,
        source_filename=source_pdf,
        object_key=provider_response_key,
        ingestion_timestamp="1970-01-01T00:00:00+00:00",
        import_source="provider_response_replay",
    )
    documents.extend(
        build_handbook_projection_import_documents(
            source=source,
            config_path=collection_config.source_projections_path,
            raw_asset_record=raw_asset_ref,
            provider_response_key=provider_response_key,
            layout_elements_key=layout_elements_key,
            structured_rows=structured_rows,
            split_manifest_documents=split_manifest.documents,
        )
    )
    runtime_registry = registry or _build_document_registry_for_rebuild(source, corpus)
    runtime_raw_asset_registry = raw_asset_registry or _build_raw_asset_registry_for_rebuild(source, corpus)
    stats = _collect_projection_aware_import_stats(
        source=source,
        documents=documents,
        registry=runtime_registry,
        raw_asset_registry=runtime_raw_asset_registry,
        writer=runtime_object_store,
        object_store=object_store_settings,
        parser_version=DEFAULT_RAW_ONLINE_OCR_PARSER_VERSION,
        embedding_model=_read_embedding_model_name(source),
        default_campus_scope=(source.get("INGESTION_DEFAULT_CAMPUS_SCOPE") or "").strip() or None,
        primary_scope=(corpus, collection),
    )
    errors = list(stats.errors)
    failed_count = stats.failed_count
    if _should_index_qdrant_for_replay(source):
        try:
            _index_replayed_documents(
                source=source,
                registry=runtime_registry,
                documents=documents,
                qdrant_client=qdrant_client,
            )
        except Exception as exc:
            failed_count += 1
            errors.append(f"replay indexing failed: {exc}")
    return write_import_report(
        import_mode="provider_response_replay",
        report_dir=Path((source.get("IMPORT_REPORT_DIR") or "./var/import-reports").strip()),
        report_prefix="replay-provider-response-rebuild",
        success_count=stats.success_count,
        skipped_count=stats.skipped_count,
        failed_count=failed_count,
        raw_uploaded_count=stats.raw_uploaded_count,
        raw_reused_count=stats.raw_reused_count,
        document_ids=stats.document_ids,
        unresolved_source_pdfs=stats.unresolved_source_pdfs,
        errors=tuple(errors),
        timestamp=stats.timestamp,
    )


def _processed_bucket_exclude_keys(
    *,
    source: dict[str, str],
    corpus: str,
    collection: str,
    import_mode: str,
) -> tuple[str, ...]:
    if import_mode != "provider_response_replay" or collection != "student_handbook":
        return ()
    raw_version_id = _read_required_env(source, "RAW_VERSION_ID")
    collection_config = _resolve_runtime_collection_config(source=source, corpus=corpus, collection=collection)
    raw_asset_id = _resolve_collection_raw_asset_id(
        request=RebuildRequest(
            corpus=corpus,
            collection=collection,
            import_mode=import_mode,
            raw_version_id=raw_version_id,
            raw_asset_id=_normalize_optional_text(source.get("RAW_ASSET_ID")),
            source_pdf=_normalize_optional_text(source.get("REPLAY_SOURCE_PDF")),
        ),
        collection_config=collection_config,
    )
    source_pdf = (source.get("REPLAY_SOURCE_PDF") or DEFAULT_REPLAY_SOURCE_PDF).strip() or DEFAULT_REPLAY_SOURCE_PDF
    provider_response_key = build_source_ocr_artifact_key(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        filename=PROVIDER_RESPONSE_FILENAME,
        source_channel=DEFAULT_RAW_SOURCE_CHANNEL,
        model_slug=build_source_model_slug(
            (source.get("OCR_MODEL") or DEFAULT_ONLINE_OCR_MODEL).strip() or DEFAULT_ONLINE_OCR_MODEL
        ),
        year=infer_year_label(source_pdf),
    )
    return (provider_response_key,)


def _should_delete_document_registry_scope(*, collection: str, import_mode: str) -> bool:
    return not (collection == "student_handbook" and import_mode == "provider_response_replay")


def _should_index_qdrant_for_replay(source: dict[str, str]) -> bool:
    return _parse_bool(source.get("REBUILD_INDEX_QDRANT"), default=False)


def _default_replay_source_pdf(collection: str) -> str:
    if collection == "curriculum_plan":
        return DEFAULT_CURRICULUM_REPLAY_SOURCE_PDF
    return DEFAULT_REPLAY_SOURCE_PDF


def _collect_projection_aware_import_stats(
    *,
    source: dict[str, str],
    documents: list[DocumentImportInput],
    registry: DocumentRegistry,
    raw_asset_registry: RawAssetRegistry,
    writer: ReplayObjectStore,
    object_store: ObjectStoreSettings,
    parser_version: str,
    embedding_model: str,
    default_campus_scope: str | None,
    primary_scope: tuple[str, str],
) -> PersistImportStats:
    grouped: dict[tuple[str, str], list[DocumentImportInput]] = {}
    for document in documents:
        grouped.setdefault((document.corpus, document.collection), []).append(document)

    success_count = 0
    skipped_count = 0
    failed_count = 0
    raw_uploaded_count = 0
    raw_reused_count = 0
    errors: list[str] = []
    document_ids: list[str] = []
    created_document_ids: list[str] = []
    updated_document_ids: list[str] = []
    skipped_document_ids: list[str] = []
    timestamp = "1970-01-01T00:00:00+00:00"
    for scope, scope_documents in grouped.items():
        profile = load_runtime_profile(scope[0], scope[1])
        stats = collect_import_document_stats(
            documents=scope_documents,
            registry=registry,
            raw_asset_registry=raw_asset_registry,
            writer=writer,
            object_store=object_store,
            parser_version=parser_version,
            embedding_model=embedding_model,
            cleaning_policy_version=profile.cleaning_policy_version,
            default_campus_scope=default_campus_scope,
            scope_refresh=scope if scope == primary_scope else None,
        )
        timestamp = stats.timestamp
        success_count += stats.success_count
        skipped_count += stats.skipped_count
        failed_count += stats.failed_count
        raw_uploaded_count += stats.raw_uploaded_count
        raw_reused_count += stats.raw_reused_count
        errors.extend(stats.errors)
        document_ids.extend(stats.document_ids)
        created_document_ids.extend(stats.created_document_ids)
        updated_document_ids.extend(stats.updated_document_ids)
        skipped_document_ids.extend(stats.skipped_document_ids)

    return PersistImportStats(
        success_count=success_count,
        skipped_count=skipped_count,
        failed_count=failed_count,
        raw_uploaded_count=raw_uploaded_count,
        raw_reused_count=raw_reused_count,
        document_ids=tuple(document_ids),
        unresolved_source_pdfs=(),
        errors=tuple(errors),
        timestamp=timestamp,
        created_document_ids=tuple(created_document_ids),
        updated_document_ids=tuple(updated_document_ids),
        skipped_document_ids=tuple(skipped_document_ids),
    )


def _declared_projection_processed_keys(
    *,
    source: dict[str, str],
    registry: DocumentRegistry,
    current_document_records: tuple[Any, ...],
) -> tuple[str, ...]:
    path_value = (source.get("HANDBOOK_SOURCE_PROJECTIONS_PATH") or "").strip()
    if not path_value:
        return ()
    config = load_handbook_source_projections_config(Path(path_value))
    keys: list[str] = []
    source_pdf = (source.get("REPLAY_SOURCE_PDF") or DEFAULT_REPLAY_SOURCE_PDF).strip() or DEFAULT_REPLAY_SOURCE_PDF
    keys.extend(
        build_declared_projection_processed_keys(
            config=config,
            source_pdf=source_pdf,
        )
    )
    seen_scope_records: dict[tuple[str | None, str | None], tuple[Any, ...]] = {}
    for record in current_document_records:
        seen_scope_records[(getattr(record, "corpus", None), getattr(record, "collection", None))] = current_document_records
    for projection in config.projections:
        scope = (projection.target_corpus, projection.target_collection)
        if scope == (config.source_corpus, config.source_collection):
            continue
        scope_records = seen_scope_records.get(scope)
        if scope_records is None:
            scope_records = _list_document_records_for_scope(registry, scope[0], scope[1])
            seen_scope_records[scope] = scope_records
        for record in scope_records:
            for key in tuple(getattr(record, "processed_object_keys", ()) or ()):
                if key:
                    keys.append(key)
    return tuple(dict.fromkeys(keys))


def _read_required_env(source: dict[str, str], field_name: str) -> str:
    value = (source.get(field_name) or "").strip()
    if not value:
        raise ValueError(f"{field_name} is required")
    return value


def _normalize_optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _raw_asset_segments(raw_asset_id: str) -> tuple[str, ...]:
    segments = tuple(part.strip() for part in raw_asset_id.split(":") if part.strip())
    if len(segments) >= 2 and segments[0] == "asset":
        return segments[1:]
    return segments


def _is_year_segment(value: str) -> bool:
    return value == "undated" or (len(value) == 4 and value.isdigit())


def _replace_object_key_filename(object_key: str, filename: str) -> str:
    parts = [part for part in object_key.strip("/").split("/") if part]
    if not parts:
        raise ValueError("object key is required")
    parts[-1] = filename
    return "/".join(parts)


def _try_get_object_bytes(
    *,
    object_store: ReplayObjectStore,
    bucket: str,
    key: str,
) -> bytes | None:
    try:
        return object_store.get_bytes(bucket=bucket, key=key)
    except Exception as exc:  # pragma: no cover - exercised through fake stores and boto clients
        if _is_missing_object_error(exc):
            return None
        raise


def _is_missing_object_error(exc: Exception) -> bool:
    if isinstance(exc, (FileNotFoundError, KeyError)):
        return True
    response = getattr(exc, "response", None)
    if isinstance(response, dict):
        error = response.get("Error")
        if isinstance(error, dict):
            code = str(error.get("Code") or "")
            if code in {"404", "NoSuchKey", "NotFound"}:
                return True
    return False


def _cleanup_legacy_replay_source_objects(
    *,
    object_store: ReplayObjectStore,
    object_store_settings: ObjectStoreSettings,
    source_provider_response_key: str,
    canonical_provider_response_key: str,
    canonical_layout_elements_key: str,
) -> None:
    delete_prefix = getattr(object_store, "delete_prefix", None)
    if not callable(delete_prefix):
        return
    if source_provider_response_key != canonical_provider_response_key:
        delete_prefix(
            bucket=object_store_settings.bucket_source,
            prefix=source_provider_response_key,
            exclude_keys=(canonical_provider_response_key,),
        )
    candidate_source_layout_keys = {
        _replace_object_key_filename(source_provider_response_key, LAYOUT_ELEMENTS_FILENAME),
    }
    parsed_source_key = parse_source_object_key(source_provider_response_key)
    if parsed_source_key is not None:
        candidate_source_layout_keys.add(
            build_source_truth_artifact_key(
                raw_asset_id=f"asset:{parsed_source_key['source_asset_slug']}",
                raw_version_id=str(parsed_source_key["raw_version_id"]),
                filename=LAYOUT_ELEMENTS_FILENAME,
                source_channel=str(parsed_source_key["source_channel"]),
                year=str(parsed_source_key["year"]),
            )
        )
    for source_layout_elements_key in candidate_source_layout_keys:
        if source_layout_elements_key != canonical_layout_elements_key:
            delete_prefix(
                bucket=object_store_settings.bucket_source,
                prefix=source_layout_elements_key,
                exclude_keys=(canonical_layout_elements_key,),
            )


def _build_handbook_replay_document_input(
    *,
    source_label: str,
    source_doc: str,
    manifest_document: SplitManifestDocument,
    structured_rows: list[dict[str, object]],
    provider_response_key: str,
    layout_elements_key: str,
    corpus: str,
    collection: str,
) -> DocumentImportInput:
    cleanup_result = cleanup_handbook_document(
        structured_rows=structured_rows,
        manifest_document=manifest_document,
        source_doc=source_doc,
    )
    document_units_bytes = serialize_handbook_document_units(cleanup_result.document_units)
    metadata = load_metadata_from_bytes(document_units_bytes)
    metadata["title"] = cleanup_result.title
    metadata["campus_scope"] = manifest_document.campus_scope
    metadata["status"] = manifest_document.status
    return DocumentImportInput(
        source_label=source_label,
        document_units_bytes=document_units_bytes,
        provider_response_bytes=None,
        canonical_markdown_bytes=cleanup_result.canonical_markdown.encode("utf-8"),
        metadata=metadata,
        import_source="provider_response_replay",
        revision_track="source-faithful",
        source_channel="pdf_ocr",
        is_current=True,
        corpus=corpus,
        collection=collection,
        campus_scope=manifest_document.campus_scope,
        status=manifest_document.status,
        raw_path=None,
        raw_source_uri=None,
        raw_asset_id=None,
        provider_response_object_key=provider_response_key,
        additional_processed_object_keys=(layout_elements_key,),
        title=cleanup_result.title,
    )


def _index_replayed_documents(
    *,
    source: dict[str, str],
    registry: DocumentRegistry,
    documents: list[DocumentImportInput],
    qdrant_client: QdrantClient | None,
) -> None:
    runtime_qdrant_client = qdrant_client or _build_qdrant_client(RetrievalSettings.from_env(source), source=source)
    upsert_batch_size = _read_qdrant_upsert_batch_size(source)
    embedding_model = build_embedding_model(EmbeddingSettings.from_env(source))
    sparse_embedding_model = build_sparse_embedding_model(SparseEmbeddingSettings.from_env(source))
    documents_by_collection: dict[str, list[DocumentImportInput]] = {}
    for document in documents:
        collection_name = _resolve_target_qdrant_collection_name(
            source,
            corpus=document.corpus,
            collection=document.collection,
        )
        documents_by_collection.setdefault(collection_name, []).append(document)

    for collection_name, collection_documents in documents_by_collection.items():
        pending_chunks = []
        should_ensure_collection = True

        def flush_pending_chunks() -> None:
            nonlocal pending_chunks, should_ensure_collection
            if not pending_chunks:
                return
            index_chunks_to_qdrant(
                chunks=tuple(pending_chunks),
                qdrant_client=runtime_qdrant_client,
                collection_name=collection_name,
                sparse_embedding_model=sparse_embedding_model,
                recreate_collection_on_schema_mismatch=True,
                ensure_collection=should_ensure_collection,
                ensure_payload_indexes=should_ensure_collection,
            )
            pending_chunks = []
            should_ensure_collection = False

        for document in collection_documents:
            document_id = str(document.metadata["document_id"])
            version_id = str(document.metadata["version_id"])
            record = registry.get(document_id, document.revision_track, version_id)
            if record is None:
                continue
            chunks = build_indexable_chunks_from_jsonl(
                record=record,
                structured_jsonl_bytes=document.document_units_bytes,
                embedding_model=embedding_model,
                sparse_embedding_model=sparse_embedding_model,
            )
            pending_chunks.extend(chunks)
            if len(pending_chunks) >= upsert_batch_size:
                flush_pending_chunks()
        flush_pending_chunks()


def _read_embedding_model_name(source: dict[str, str]) -> str:
    model = (source.get("INGESTION_EMBEDDING_MODEL") or source.get("EMBEDDING_MODEL") or "").strip()
    if not model:
        raise ValueError("INGESTION_EMBEDDING_MODEL or EMBEDDING_MODEL is required")
    return model


def _read_qdrant_upsert_batch_size(source: dict[str, str]) -> int:
    raw_value = (source.get("QDRANT_UPSERT_BATCH_SIZE") or str(DEFAULT_QDRANT_UPSERT_BATCH_SIZE)).strip()
    batch_size = int(raw_value)
    if batch_size <= 0:
        raise ValueError("QDRANT_UPSERT_BATCH_SIZE must be greater than zero")
    return batch_size
