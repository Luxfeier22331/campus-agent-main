from __future__ import annotations

import hashlib
import os
import random
import socket
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Literal
from urllib.parse import urlparse

from campus_ingestion_core.chunking import (
    ChunkProfile,
    build_student_handbook_chunk_profile,
)
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.handbook_chunking_validation_shared import (
    DEFAULT_HANDBOOK_MANIFEST_PATH,
    HANDBOOK_SCOPE,
    SAMPLE_BUCKETS,
    ChunkValidationArtifactReader,
    ChunkValidationFailure,
    StudentHandbookChunkingScanResult,
    StudentHandbookScannedDocument,
    StudentHandbookValidationInputs,
    _build_sample_candidate,
    _load_rows,
    _resolve_validation_cache_dir,
    _resolve_validation_workers,
    _sample_candidate_matches_bucket,
)
from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import build_indexable_chunks_from_jsonl
from campus_ingestion_core.registry import DocumentRegistry, build_document_registry_from_env
from campus_ingestion_core.settings import ObjectStoreSettings, resolve_object_store_bucket_names
from campus_ingestion_core.split_manifest import load_split_manifest
from campus_ingestion_core.tokenizer_cache import resolve_prefetched_hf_tokenizer_path


def scan_student_handbook_chunking(
    *,
    env: dict[str, str] | None = None,
    registry: DocumentRegistry | None = None,
    object_store: ChunkValidationArtifactReader | None = None,
    manifest_path: Path | None = None,
    chunk_profile: ChunkProfile | None = None,
    mode: Literal["full", "samples"] = "full",
    sample_seed: int = 20260325,
) -> StudentHandbookChunkingScanResult:
    inputs = _build_validation_inputs(
        env=env,
        registry=registry,
        object_store=object_store,
        manifest_path=manifest_path,
        chunk_profile=chunk_profile,
    )
    _ensure_validation_runtime_ready(inputs)
    cache_dir = _resolve_validation_cache_dir(inputs.source)
    documents: tuple[StudentHandbookScannedDocument, ...]
    if mode == "samples":
        documents = _scan_sample_candidates_only(
            inputs=inputs,
            cache_dir=cache_dir,
            sample_seed=sample_seed,
        )
    else:
        documents = _scan_all_documents(
            inputs=inputs,
            cache_dir=cache_dir,
        )
    return StudentHandbookChunkingScanResult(
        mode=mode,
        inputs=inputs,
        documents=documents,
    )


def _ensure_validation_runtime_ready(inputs: StudentHandbookValidationInputs) -> None:
    _ensure_object_store_is_reachable(inputs)
    _ensure_prefetched_tokenizer_is_available(inputs.chunk_profile.tokenizer_name)


def _ensure_object_store_is_reachable(inputs: StudentHandbookValidationInputs) -> None:
    source = inputs.source
    endpoint = (source.get("OBJECT_STORE_ENDPOINT") or "").strip()
    if endpoint:
        parsed = urlparse(endpoint)
        host = parsed.hostname
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        if host:
            try:
                with socket.create_connection((host, port), timeout=1.0):
                    pass
            except OSError as exc:
                raise RuntimeError(
                    f"Object store endpoint is unreachable: {endpoint} ({type(exc).__name__}: {exc})"
                ) from exc
    healthcheck = getattr(inputs.object_store, "healthcheck", None)
    if callable(healthcheck):
        healthcheck(bucket=inputs.derived_bucket)


def _ensure_prefetched_tokenizer_is_available(tokenizer_name: str) -> None:
    if not tokenizer_name.startswith("hf:"):
        return
    resolve_prefetched_hf_tokenizer_path(tokenizer_name.split(":", 1)[1])


def _scan_all_documents(
    *,
    inputs: StudentHandbookValidationInputs,
    cache_dir: Path | None,
) -> tuple[StudentHandbookScannedDocument, ...]:
    workers = _resolve_validation_workers(inputs.source)
    if workers <= 1:
        return tuple(
            _scan_single_document(
                inputs=inputs,
                record=record,
                cache_dir=cache_dir,
            )
            for record in inputs.selected_records
        )
    with ThreadPoolExecutor(max_workers=workers) as executor:
        results = executor.map(
            lambda record: _scan_single_document(
                inputs=inputs,
                record=record,
                cache_dir=cache_dir,
            ),
            inputs.selected_records,
        )
        return tuple(results)


def _scan_sample_candidates_only(
    *,
    inputs: StudentHandbookValidationInputs,
    cache_dir: Path | None,
    sample_seed: int,
) -> tuple[StudentHandbookScannedDocument, ...]:
    pending_bucket_names = {bucket_name for bucket_name, _ in SAMPLE_BUCKETS}
    records = list(inputs.selected_records)
    rng = random.Random(sample_seed)
    rng.shuffle(records)
    documents: list[StudentHandbookScannedDocument] = []
    for record in records:
        document = _scan_single_document(
            inputs=inputs,
            record=record,
            cache_dir=cache_dir,
        )
        documents.append(document)
        if (
            document.read_failure is not None
            or document.chunk_failure is not None
            or not document.chunks
        ):
            continue
        candidate = _build_sample_candidate(document)
        for bucket_name, _bucket_reason in SAMPLE_BUCKETS:
            if bucket_name not in pending_bucket_names:
                continue
            if _sample_candidate_matches_bucket(candidate, bucket_name=bucket_name):
                pending_bucket_names.remove(bucket_name)
        if not pending_bucket_names:
            break
    documents.sort(key=lambda document: document.record.document_id)
    return tuple(documents)


def _scan_single_document(
    *,
    inputs: StudentHandbookValidationInputs,
    record: DocumentRegistryRecord,
    cache_dir: Path | None,
) -> StudentHandbookScannedDocument:
    title = inputs.manifest_titles.get(record.document_id, record.document_id)
    if not record.document_units_object_key:
        return StudentHandbookScannedDocument(
            title=title,
            record=record,
            rows=(),
            chunks=(),
            read_failure=ChunkValidationFailure(
                document_id=record.document_id,
                title=title,
                artifact_key=None,
                error="document_units_object_key is missing",
            ),
        )
    try:
        structured_jsonl_bytes = _load_structured_jsonl_bytes(
            inputs=inputs,
            record=record,
            cache_dir=cache_dir,
        )
    except Exception as exc:
        return StudentHandbookScannedDocument(
            title=title,
            record=record,
            rows=(),
            chunks=(),
            read_failure=ChunkValidationFailure(
                document_id=record.document_id,
                title=title,
                artifact_key=record.document_units_object_key,
                error=f"{type(exc).__name__}: {exc}",
            ),
        )
    rows = tuple(_load_rows(structured_jsonl_bytes))
    try:
        chunks = build_indexable_chunks_from_jsonl(
            record=record,
            structured_jsonl_bytes=structured_jsonl_bytes,
            chunk_profile=inputs.chunk_profile,
        )
    except Exception as exc:
        return StudentHandbookScannedDocument(
            title=title,
            record=record,
            rows=rows,
            chunks=(),
            chunk_failure=ChunkValidationFailure(
                document_id=record.document_id,
                title=title,
                artifact_key=record.document_units_object_key,
                error=f"{type(exc).__name__}: {exc}",
            ),
        )
    return StudentHandbookScannedDocument(
        title=title,
        record=record,
        rows=rows,
        chunks=chunks,
    )


def _load_structured_jsonl_bytes(
    *,
    inputs: StudentHandbookValidationInputs,
    record: DocumentRegistryRecord,
    cache_dir: Path | None,
) -> bytes:
    if cache_dir is not None:
        cache_path = _validation_cache_file_path(
            cache_dir=cache_dir,
            bucket=inputs.derived_bucket,
            key=record.document_units_object_key or "",
            version_id=record.version_id,
        )
        if cache_path.exists():
            return cache_path.read_bytes()
    payload = inputs.object_store.get_bytes(
        bucket=inputs.derived_bucket,
        key=record.document_units_object_key or "",
    )
    if cache_dir is not None:
        cache_path.parent.mkdir(parents=True, exist_ok=True)
        cache_path.write_bytes(payload)
    return payload


def _validation_cache_file_path(*, cache_dir: Path, bucket: str, key: str, version_id: str) -> Path:
    suffix = Path(key).name or "document-units.jsonl"
    digest = hashlib.sha1(f"{bucket}:{key}:{version_id}".encode("utf-8")).hexdigest()
    return cache_dir / bucket / digest / suffix


def _resolve_manifest_path(*, source: dict[str, str], manifest_path: Path | None) -> Path:
    if manifest_path is not None:
        return Path(manifest_path)
    configured = (source.get("INGESTION_SPLIT_MANIFEST_PATH") or "").strip()
    if configured:
        return Path(configured)
    return DEFAULT_HANDBOOK_MANIFEST_PATH


def _build_validation_inputs(
    *,
    env: dict[str, str] | None,
    registry: DocumentRegistry | None,
    object_store: ChunkValidationArtifactReader | None,
    manifest_path: Path | None,
    chunk_profile: ChunkProfile | None,
) -> StudentHandbookValidationInputs:
    source = dict(env if env is not None else os.environ)
    corpus, collection = HANDBOOK_SCOPE
    runtime_profile = chunk_profile or _resolve_validation_chunk_profile(
        source, corpus=corpus, collection=collection
    )
    runtime_registry = registry or build_document_registry_from_env(source)
    bucket_source, bucket_derived = resolve_object_store_bucket_names(source)
    runtime_object_store = object_store or S3ObjectStoreAdmin(
        ObjectStoreSettings.from_env(
            {
                **source,
                "OBJECT_STORE_BUCKET_SOURCE": bucket_source,
                "OBJECT_STORE_BUCKET_DERIVED": bucket_derived,
            }
        )
    )
    split_manifest_path = _resolve_manifest_path(source=source, manifest_path=manifest_path)
    manifest = load_split_manifest(
        split_manifest_path,
        expected_corpus=corpus,
        expected_collection=collection,
    )
    manifest_ids = {document.document_id for document in manifest.documents}
    manifest_titles = {document.document_id: document.title for document in manifest.documents}
    records = tuple(runtime_registry.list_by_scope(corpus, collection))
    records_by_doc: dict[str, list[DocumentRegistryRecord]] = {}
    for record in records:
        records_by_doc.setdefault(record.document_id, []).append(record)
    normalized_records_by_doc = {
        document_id: tuple(doc_records) for document_id, doc_records in records_by_doc.items()
    }
    selected_records = _select_source_faithful_records(records_by_doc)
    return StudentHandbookValidationInputs(
        source=source,
        chunk_profile=runtime_profile,
        registry=runtime_registry,
        object_store=runtime_object_store,
        derived_bucket=bucket_derived,
        manifest_path=split_manifest_path,
        manifest_titles=manifest_titles,
        records=records,
        records_by_doc=normalized_records_by_doc,
        selected_records=selected_records,
        extra_registry_document_ids=tuple(sorted(set(records_by_doc) - manifest_ids)),
        missing_registry_document_ids=tuple(sorted(manifest_ids - set(records_by_doc))),
    )


def _resolve_validation_chunk_profile(
    source: dict[str, str],
    *,
    corpus: str,
    collection: str,
) -> ChunkProfile:
    runtime_profile = load_runtime_profile(corpus, collection)
    model_name = (
        source.get("INGESTION_EMBEDDING_MODEL") or source.get("EMBEDDING_MODEL") or ""
    ).strip()
    return build_student_handbook_chunk_profile(
        profile_version=runtime_profile.chunk_profile_version,
        model_name=model_name or None,
    )


def _select_source_faithful_records(
    records_by_doc: dict[str, list[DocumentRegistryRecord]],
) -> tuple[DocumentRegistryRecord, ...]:
    selected_records: list[DocumentRegistryRecord] = []
    for document_id in sorted(records_by_doc):
        doc_records = records_by_doc[document_id]
        preferred = [
            record
            for record in doc_records
            if record.is_current and record.revision_track == "source-faithful"
        ]
        if preferred:
            selected_records.append(max(preferred, key=lambda record: record.ingestion_timestamp))
            continue
        source_faithful = [
            record for record in doc_records if record.revision_track == "source-faithful"
        ]
        if source_faithful:
            selected_records.append(
                max(source_faithful, key=lambda record: record.ingestion_timestamp)
            )
    return tuple(selected_records)
