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
    collect_import_document_stats,
    load_metadata_from_bytes,
    persist_import_documents,
    write_import_report,
)
from campus_ingestion_core.chunking import ChunkProfile
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.embed import EmbeddingSettings, build_embedding_model
from campus_ingestion_core.handbook_cleanup import cleanup_handbook_document, serialize_handbook_document_units
from campus_ingestion_core.handbook_provider_normalize import (
    normalize_handbook_provider_result,
    serialize_handbook_layout_elements,
)
from campus_ingestion_core.object_store import (
    S3ObjectStoreClientFactory,
    build_processed_asset_artifact_key,
    build_raw_asset_key,
    infer_year_label,
)
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.process import build_indexable_chunks_from_jsonl, index_chunks_to_qdrant
from campus_ingestion_core.raw_ingestion import (
    DEFAULT_ONLINE_OCR_MODEL,
    DEFAULT_ONLINE_OCR_PROVIDER,
    DEFAULT_RAW_ONLINE_OCR_PARSER_VERSION,
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
DEFAULT_HANDBOOK_CANONICAL_RAW_FILENAME = "学生手册_2018.pdf"
ALLOWED_REBUILD_IMPORT_MODES = ("raw_online_ocr", "provider_response_replay")


class ObjectStoreAdmin(Protocol):
    def delete_prefix(self, *, bucket: str, prefix: str, exclude_keys: tuple[str, ...] = ()) -> None: ...


class ReplayObjectStore(ObjectStoreWriter, Protocol):
    def delete_prefix(self, *, bucket: str, prefix: str, exclude_keys: tuple[str, ...] = ()) -> None: ...

    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


class QdrantAdmin(Protocol):
    def reset_collection(self, collection_name: str) -> None: ...


@dataclass(frozen=True, slots=True)
class LocalDataRebuildReport:
    import_env: dict[str, str]
    import_result: object


@dataclass(frozen=True, slots=True)
class StudentHandbookMigrationReport:
    canonical_raw_filename: str
    previous_raw_object_key: str
    canonical_raw_object_key: str
    rebuild_report: LocalDataRebuildReport


class S3ObjectStoreAdmin:
    def __init__(self, settings: ObjectStoreSettings) -> None:
        self._client = S3ObjectStoreClientFactory(settings).create()

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


def rebuild_local_data(
    *,
    env: dict[str, str] | None = None,
    object_store: ReplayObjectStore | None = None,
    qdrant_admin: QdrantAdmin | None = None,
    import_runner: Callable[..., Any] | None = None,
    document_registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
) -> LocalDataRebuildReport:
    source = dict(env if env is not None else os.environ)
    corpus = _read_ingestion_corpus(source)
    collection = _read_ingestion_collection(source, corpus=corpus)
    import_mode = _read_rebuild_import_mode(source)
    object_store_settings = ObjectStoreSettings.from_env(source)

    object_store_admin = object_store or S3ObjectStoreAdmin(object_store_settings)
    runtime_document_registry = document_registry or _build_document_registry_for_rebuild(source, corpus)
    runtime_raw_asset_registry = raw_asset_registry or _build_raw_asset_registry_for_rebuild(source, corpus)
    processed_exclude_keys = _processed_bucket_exclude_keys(
        source=source,
        corpus=corpus,
        collection=collection,
        import_mode=import_mode,
    )
    raw_records = _list_raw_asset_records_for_scope(runtime_raw_asset_registry, corpus, collection)
    document_records = _list_document_records_for_scope(runtime_document_registry, corpus, collection)
    if _should_clear_raw_bucket(collection=collection, import_mode=import_mode):
        _delete_object_keys(
            object_store_admin=object_store_admin,
            bucket=object_store_settings.bucket_raw,
            object_keys=tuple(record.object_key for record in raw_records),
        )
    _delete_object_keys(
        object_store_admin=object_store_admin,
        bucket=object_store_settings.bucket_processed,
        object_keys=_collect_processed_rebuild_keys(
            source=source,
            corpus=corpus,
            collection=collection,
            import_mode=import_mode,
            document_records=document_records,
        ),
        exclude_keys=processed_exclude_keys,
    )
    runtime_document_registry.delete_by_scope(corpus, collection)
    if _should_delete_raw_asset_registry(collection=collection, import_mode=import_mode):
        runtime_raw_asset_registry.delete_by_scope(corpus, collection)

    if _parse_bool(source.get("REBUILD_RESET_QDRANT"), default=False):
        retrieval_settings = RetrievalSettings.from_env(source)
        qdrant_collection_admin = qdrant_admin or QdrantCollectionAdmin(_build_qdrant_client(retrieval_settings))
        qdrant_collection_admin.reset_collection(source.get("QDRANT_COLLECTION") or DEFAULT_QDRANT_COLLECTION)

    runtime_import_runner = import_runner or _resolve_import_runner(import_mode)

    return LocalDataRebuildReport(
        import_env=source,
        import_result=runtime_import_runner(env=source),
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
    document_records: tuple[Any, ...],
) -> tuple[str, ...]:
    keys: list[str] = []
    for record in document_records:
        for key in tuple(getattr(record, "processed_object_keys", ()) or ()):
            if key:
                keys.append(key)
    keys.extend(
        _extra_processed_rebuild_keys(
            source=source,
            corpus=corpus,
            collection=collection,
            import_mode=import_mode,
        )
    )
    return tuple(dict.fromkeys(keys))


def _extra_processed_rebuild_keys(
    *,
    source: dict[str, str],
    corpus: str,
    collection: str,
    import_mode: str,
) -> tuple[str, ...]:
    if import_mode != "provider_response_replay" or collection != "student_handbook":
        return ()
    provider_response_key = _read_required_env(source, "REBUILD_PROVIDER_RESPONSE_KEY")
    return (_replace_object_key_filename(provider_response_key, LAYOUT_ELEMENTS_FILENAME),)


def migrate_student_handbook_source_faithful(
    *,
    env: dict[str, str] | None = None,
    object_store: ReplayObjectStore | None = None,
    qdrant_admin: QdrantAdmin | None = None,
    document_registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
) -> StudentHandbookMigrationReport:
    source = dict(env if env is not None else os.environ)
    corpus = _read_ingestion_corpus(source)
    collection = _read_ingestion_collection(source, corpus=corpus)
    if collection != "student_handbook":
        raise ValueError("migrate_student_handbook_source_faithful only supports student_handbook")
    provider_response_key = _read_required_env(source, "REBUILD_PROVIDER_RESPONSE_KEY")
    split_manifest_path = (source.get("INGESTION_SPLIT_MANIFEST_PATH") or "").strip()
    if not split_manifest_path:
        raise ValueError("INGESTION_SPLIT_MANIFEST_PATH is required for handbook migration")

    canonical_raw_filename = (
        source.get("HANDBOOK_CANONICAL_RAW_FILENAME") or DEFAULT_HANDBOOK_CANONICAL_RAW_FILENAME
    ).strip() or DEFAULT_HANDBOOK_CANONICAL_RAW_FILENAME
    object_store_settings = ObjectStoreSettings.from_env(source)
    runtime_object_store = object_store or S3ObjectStoreAdmin(object_store_settings)
    runtime_raw_asset_registry = raw_asset_registry or _build_raw_asset_registry_for_rebuild(source, corpus)
    split_manifest = load_split_manifest(
        Path(split_manifest_path),
        expected_corpus=corpus,
        expected_collection=collection,
    )
    raw_version_id = _parse_replay_raw_version_id(
        corpus=corpus,
        provider_response_key=provider_response_key,
        raw_asset_id=split_manifest.raw_asset_id,
    )
    raw_record = runtime_raw_asset_registry.get(split_manifest.raw_asset_id, raw_version_id)
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
            bucket=object_store_settings.bucket_raw,
            key=raw_record.object_key,
        )
        runtime_object_store.put_bytes(
            bucket=object_store_settings.bucket_raw,
            key=canonical_raw_object_key,
            data=raw_bytes,
            content_type="application/pdf",
        )
        runtime_object_store.delete_prefix(
            bucket=object_store_settings.bucket_raw,
            prefix=raw_record.object_key,
            exclude_keys=(canonical_raw_object_key,),
        )
    runtime_raw_asset_registry.upsert(canonical_raw_record)

    rebuild_env = dict(source)
    rebuild_env["REBUILD_IMPORT_MODE"] = "provider_response_replay"
    rebuild_env["REPLAY_SOURCE_PDF"] = canonical_raw_filename
    rebuild_report = rebuild_local_data(
        env=rebuild_env,
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
    if collection != "student_handbook":
        raise ValueError("provider_response_replay only supports student_handbook")
    source_provider_response_key = _read_required_env(source, "REBUILD_PROVIDER_RESPONSE_KEY")
    source_pdf = (source.get("REPLAY_SOURCE_PDF") or DEFAULT_REPLAY_SOURCE_PDF).strip() or DEFAULT_REPLAY_SOURCE_PDF
    split_manifest_path = (source.get("INGESTION_SPLIT_MANIFEST_PATH") or "").strip()
    if not split_manifest_path:
        raise ValueError("INGESTION_SPLIT_MANIFEST_PATH is required for provider_response_replay")

    object_store_settings = ObjectStoreSettings.from_env(source)
    runtime_object_store = object_store or S3ObjectStoreAdmin(object_store_settings)
    split_manifest = load_split_manifest(
        Path(split_manifest_path),
        expected_corpus=corpus,
        expected_collection=collection,
    )
    raw_version_id = _parse_replay_raw_version_id(
        corpus=corpus,
        provider_response_key=source_provider_response_key,
        raw_asset_id=split_manifest.raw_asset_id,
    )
    provider_response_key = build_processed_asset_artifact_key(
        corpus=corpus,
        raw_asset_id=split_manifest.raw_asset_id,
        raw_version_id=raw_version_id,
        filename=PROVIDER_RESPONSE_FILENAME,
        year=infer_year_label(source_pdf),
    )
    provider_response_bytes = runtime_object_store.get_bytes(
        bucket=object_store_settings.bucket_processed,
        key=source_provider_response_key,
    )
    structured_rows = normalize_handbook_provider_result(
        source_pdf=source_pdf,
        provider_jsonl_bytes=provider_response_bytes,
        ocr_provider=DEFAULT_ONLINE_OCR_PROVIDER,
        ocr_model=(source.get("OCR_MODEL") or DEFAULT_ONLINE_OCR_MODEL).strip() or DEFAULT_ONLINE_OCR_MODEL,
        source_artifact_id=split_manifest.raw_asset_id,
    )
    layout_elements_bytes = serialize_handbook_layout_elements(structured_rows)
    layout_elements_key = build_processed_asset_artifact_key(
        corpus=corpus,
        raw_asset_id=split_manifest.raw_asset_id,
        raw_version_id=raw_version_id,
        filename=LAYOUT_ELEMENTS_FILENAME,
        year=infer_year_label(source_pdf),
    )
    runtime_object_store.put_bytes(
        bucket=object_store_settings.bucket_processed,
        key=provider_response_key,
        data=provider_response_bytes,
        content_type="application/x-ndjson",
    )
    runtime_object_store.put_bytes(
        bucket=object_store_settings.bucket_processed,
        key=layout_elements_key,
        data=layout_elements_bytes,
        content_type="application/x-ndjson",
    )
    _cleanup_legacy_replay_source_objects(
        object_store=runtime_object_store,
        object_store_settings=object_store_settings,
        source_provider_response_key=source_provider_response_key,
        canonical_provider_response_key=provider_response_key,
        canonical_layout_elements_key=layout_elements_key,
    )

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
    runtime_registry = registry or _build_document_registry_for_rebuild(source, corpus)
    runtime_raw_asset_registry = raw_asset_registry or _build_raw_asset_registry_for_rebuild(source, corpus)
    stats = collect_import_document_stats(
        documents=documents,
        registry=runtime_registry,
        raw_asset_registry=runtime_raw_asset_registry,
        writer=runtime_object_store,
        object_store=object_store_settings,
        parser_version=DEFAULT_RAW_ONLINE_OCR_PARSER_VERSION,
        embedding_model=_read_embedding_model_name(source),
        cleaning_policy_version=load_runtime_profile(corpus, collection).cleaning_policy_version,
        default_campus_scope=(source.get("INGESTION_DEFAULT_CAMPUS_SCOPE") or "").strip() or None,
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
    provider_response_key = _read_required_env(source, "REBUILD_PROVIDER_RESPONSE_KEY")
    return (provider_response_key,)


def _should_clear_raw_bucket(*, collection: str, import_mode: str) -> bool:
    return not (collection == "student_handbook" and import_mode == "provider_response_replay")


def _should_delete_raw_asset_registry(*, collection: str, import_mode: str) -> bool:
    return not (collection == "student_handbook" and import_mode == "provider_response_replay")


def _should_index_qdrant_for_replay(source: dict[str, str]) -> bool:
    return _parse_bool(source.get("REBUILD_INDEX_QDRANT"), default=False)


def _read_required_env(source: dict[str, str], field_name: str) -> str:
    value = (source.get(field_name) or "").strip()
    if not value:
        raise ValueError(f"{field_name} is required")
    return value


def _parse_replay_raw_version_id(
    *,
    corpus: str,
    provider_response_key: str,
    raw_asset_id: str,
) -> str:
    parts = [part for part in provider_response_key.strip("/").split("/") if part]
    version_segments = _match_replay_version_segments(parts=parts, corpus=corpus, raw_asset_id=raw_asset_id)
    if version_segments is None:
        raise ValueError("REBUILD_PROVIDER_RESPONSE_KEY does not match split manifest raw_asset_id")
    if parts[-1] != PROVIDER_RESPONSE_FILENAME:
        raise ValueError(f"REBUILD_PROVIDER_RESPONSE_KEY must point to {PROVIDER_RESPONSE_FILENAME}")
    if not version_segments:
        raise ValueError("REBUILD_PROVIDER_RESPONSE_KEY is missing raw version segments")
    return ":".join(version_segments)


def _raw_asset_segments(raw_asset_id: str) -> tuple[str, ...]:
    segments = tuple(part.strip() for part in raw_asset_id.split(":") if part.strip())
    if len(segments) >= 2 and segments[0] == "asset":
        return segments[1:]
    return segments


def _match_replay_version_segments(
    *,
    parts: list[str],
    corpus: str,
    raw_asset_id: str,
) -> list[str] | None:
    legacy_segments = list(_raw_asset_segments(raw_asset_id))
    normalized_slug = _normalized_source_asset_slug(raw_asset_id)
    candidate_prefixes = [
        [corpus, "sources", "pdf_ocr", normalized_slug],
        [corpus, "sources", "pdf_ocr", legacy_segments[-1]],
        [corpus, "assets", *legacy_segments],
    ]
    for prefix in candidate_prefixes:
        if parts[: len(prefix)] == prefix:
            remainder = parts[len(prefix) : -1]
            if remainder and _is_year_segment(remainder[0]):
                remainder = remainder[1:]
            return remainder
    return None


def _normalized_source_asset_slug(raw_asset_id: str) -> str:
    segments = _raw_asset_segments(raw_asset_id)
    if not segments:
        raise ValueError("raw_asset_id is required")
    parts = [part for part in segments[-1].split("-") if part]
    if len(parts) >= 2 and parts[-1] in {"pdf", "doc", "docx", "html", "htm", "md", "markdown", "txt", "json", "csv", "zip"}:
        parts = parts[:-1]
    if len(parts) >= 2 and _is_year_segment(parts[-1]) and parts[-1] != "undated":
        parts = parts[:-1]
    return "-".join(parts) or segments[-1]


def _is_year_segment(value: str) -> bool:
    return value == "undated" or (len(value) == 4 and value.isdigit())


def _replace_object_key_filename(object_key: str, filename: str) -> str:
    parts = [part for part in object_key.strip("/").split("/") if part]
    if not parts:
        raise ValueError("object key is required")
    parts[-1] = filename
    return "/".join(parts)


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
            bucket=object_store_settings.bucket_processed,
            prefix=source_provider_response_key,
            exclude_keys=(canonical_provider_response_key,),
        )
    source_layout_elements_key = _replace_object_key_filename(
        source_provider_response_key,
        LAYOUT_ELEMENTS_FILENAME,
    )
    if source_layout_elements_key != canonical_layout_elements_key:
        delete_prefix(
            bucket=object_store_settings.bucket_processed,
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
        is_current=False,
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
    runtime_qdrant_client = qdrant_client or _build_qdrant_client(RetrievalSettings.from_env(source))
    collection_name = (source.get("QDRANT_COLLECTION") or DEFAULT_QDRANT_COLLECTION).strip() or DEFAULT_QDRANT_COLLECTION
    embedding_model = build_embedding_model(EmbeddingSettings.from_env(source))
    chunk_profile = ChunkProfile()
    for document in documents:
        document_id = str(document.metadata["document_id"])
        version_id = str(document.metadata["version_id"])
        record = registry.get(document_id, document.revision_track, version_id)
        if record is None:
            continue
        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=document.document_units_bytes,
            chunk_profile=chunk_profile,
            embedding_model=embedding_model,
        )
        index_chunks_to_qdrant(
            chunks=chunks,
            qdrant_client=runtime_qdrant_client,
            collection_name=collection_name,
        )


def _read_embedding_model_name(source: dict[str, str]) -> str:
    model = (source.get("INGESTION_EMBEDDING_MODEL") or source.get("EMBEDDING_MODEL") or "").strip()
    if not model:
        raise ValueError("INGESTION_EMBEDDING_MODEL or EMBEDDING_MODEL is required")
    return model
