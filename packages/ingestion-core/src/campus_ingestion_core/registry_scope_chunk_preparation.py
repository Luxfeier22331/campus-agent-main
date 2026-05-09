from __future__ import annotations

import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Literal

from campus_ingestion_core.authenticated_notice_closeout_staged_documents import (
    load_verified_closeout_run_document_record_pairs,
)
from campus_ingestion_core.authenticated_notice_closeout_store import (
    CloseoutStore,
    build_authenticated_notice_closeout_store_from_env,
)
from campus_ingestion_core.corpus_profiles import load_chunk_profile, load_runtime_profile
from campus_ingestion_core.index_release import IndexReleaseValidationResult, validate_scope_release
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.process import IndexableChunk, build_indexable_chunks_from_jsonl
from campus_ingestion_core.registry import DocumentRegistry, build_document_registry_from_env
from campus_ingestion_core.registry_scope_chunk_preparation_helpers import (
    _assert_current_cleaning_provenance,
    _build_preparation_artifact_key,
    _hash_document_units_bytes,
    _hash_values,
    _record_key,
)
from campus_ingestion_core.registry_scope_chunk_preparation_models import (
    REGISTRY_SCOPE_CHUNK_PREPARATION_OPERATION,
    RegistryScopePreparationObjectStore,
)
from campus_ingestion_core.registry_scope_chunk_provenance import (
    hash_bytes,
    hash_chunk_fingerprint,
    hash_chunk_preparation_provenance,
    hash_chunk_profile,
    resolve_chunk_preparation_provenance,
    verify_chunk_preparation_provenance,
)
from campus_ingestion_core.registry_scope_common import (
    record_label,
    select_releasable_registry_records,
)
from campus_ingestion_core.settings import ObjectStoreSettings

MANDATORY_PREPARATION_SCOPES = frozenset(
    {
        ("campus_notices", "internal_notice"),
        ("regulations", "institutional_rules"),
        ("regulations", "scoped_rules"),
    }
)


@dataclass(frozen=True, slots=True)
class RegistryScopeChunkPreparationDocumentRef:
    document_id: str
    revision_track: str
    version_id: str
    document_units_object_key: str | None
    document_units_sha256: str | None = None


@dataclass(frozen=True, slots=True)
class RegistryScopeChunkPreparationDocumentReport:
    document_id: str
    revision_track: str
    version_id: str
    chunk_count: int
    token_summary: dict[str, object]
    unit_type_counts: dict[str, int]


@dataclass(frozen=True, slots=True)
class RegistryScopeChunkPreparationManifest:
    preparation_run_id: str
    corpus: str
    collection: str
    selection_mode: Literal["current_scope", "verified_closeout_run"]
    closeout_run_id: str | None
    cleaning_policy_version: str
    chunk_policy_version: str
    prepared_at: str
    document_count: int
    chunk_count: int
    document_version_ids_hash: str
    document_units_keys_hash: str
    validation_status: str
    validation_summary_object_key: str | None
    document_report_object_key: str | None
    documents: tuple[RegistryScopeChunkPreparationDocumentRef, ...] = field(default_factory=tuple)
    document_units_content_hash: str = ""
    chunk_profile_hash: str = ""
    chunk_fingerprint_hash: str = ""
    tokenizer_name: str = ""
    tokenizer_package_version: str = ""
    chunker_implementation_version: str = ""
    normalizer_version: str = ""
    document_units_schema_version: str = ""
    chunk_preparation_provenance_hash: str = ""


@dataclass(frozen=True, slots=True)
class RegistryScopeChunkPreparationArtifacts:
    manifest: RegistryScopeChunkPreparationManifest
    manifest_object_key: str
    validation_summary_object_key: str | None
    document_report_object_key: str | None


@dataclass(frozen=True, slots=True)
class RegistryScopeChunkPreparationReport:
    corpus: str
    collection: str
    preparation_run_id: str
    selection_mode: str
    closeout_run_id: str | None
    manifest_object_key: str
    validation_summary_object_key: str | None
    document_report_object_key: str | None
    validation_status: str
    document_count: int
    chunk_count: int
    prepared_at: str


def default_preparation_run_id(*, now: datetime | None = None) -> str:
    runtime_now = now or datetime.now(UTC)
    return runtime_now.strftime("prep-%Y%m%d-%H%M%S")


def prepare_registry_scope_chunks(
    *,
    corpus: str,
    collection: str,
    preparation_run_id: str | None = None,
    closeout_run_id: str | None = None,
    env: dict[str, str] | None = None,
    registry: DocumentRegistry | None = None,
    object_store: RegistryScopePreparationObjectStore | None = None,
    closeout_store: CloseoutStore | None = None,
    official_web_min_release_documents: int | None = None,
    require_current_cleaning_provenance: bool = False,
) -> RegistryScopeChunkPreparationReport:
    source = dict(env if env is not None else os.environ)
    runtime_profile = load_runtime_profile(corpus, collection)
    object_store_settings = ObjectStoreSettings.from_env(source)
    if object_store is None:
        from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin

        runtime_object_store: RegistryScopePreparationObjectStore = S3ObjectStoreAdmin(
            object_store_settings
        )
    else:
        runtime_object_store = object_store
    records, manifest_records, selection_mode, resolved_closeout_run_id = (
        _select_preparation_records(
            source=source,
            corpus=corpus,
            collection=collection,
            runtime_profile=runtime_profile,
            runtime_registry=registry,
            closeout_run_id=closeout_run_id,
            closeout_store=closeout_store,
        )
    )
    if not records:
        raise ValueError(f"no releasable registry records found for {corpus}/{collection}")
    chunks: list[IndexableChunk] = []
    document_reports: list[RegistryScopeChunkPreparationDocumentReport] = []
    documents_without_chunks: list[str] = []
    document_units_sha256_by_record_key: dict[tuple[str, str, str], str] = {}
    for record in records:
        try:
            if not record.document_units_object_key:
                raise ValueError("document_units_object_key is required to build indexable chunks")
            document_units_bytes = runtime_object_store.get_bytes(
                bucket=object_store_settings.bucket_derived,
                key=record.document_units_object_key,
            )
            document_units_sha256_by_record_key[_record_key(record)] = hash_bytes(
                document_units_bytes
            )
            if require_current_cleaning_provenance:
                _assert_current_cleaning_provenance(
                    record=record,
                    runtime_cleaning_policy_version=runtime_profile.cleaning_policy_version,
                    document_units_bytes=document_units_bytes,
                )
            document_chunks = build_indexable_chunks_from_jsonl(
                record=record,
                structured_jsonl_bytes=document_units_bytes,
            )
        except Exception as exc:
            raise ValueError(
                "chunk preparation failed for "
                f"{record_label(record)} "
                f"(document_units_object_key={record.document_units_object_key!r}): {exc}"
            ) from exc
        if not document_chunks:
            documents_without_chunks.append(record_label(record))
            continue
        chunks.extend(document_chunks)
        document_reports.append(_build_document_report(record=record, chunks=document_chunks))

    validation = _validate_prepared_scope(
        corpus=corpus,
        collection=collection,
        chunks=tuple(chunks),
        documents_without_chunks=tuple(documents_without_chunks),
        official_web_min_release_documents=official_web_min_release_documents,
    )
    prepared_at = datetime.now(UTC).isoformat()
    manifest = build_chunk_preparation_manifest(
        preparation_run_id=preparation_run_id or default_preparation_run_id(),
        corpus=corpus,
        collection=collection,
        selection_mode=selection_mode,
        closeout_run_id=resolved_closeout_run_id,
        records=manifest_records,
        chunks=tuple(chunks),
        validation=validation,
        prepared_at=prepared_at,
        document_units_sha256_by_record_key={
            _record_key(manifest_record): document_units_sha256_by_record_key[
                _record_key(processing_record)
            ]
            for processing_record, manifest_record in zip(records, manifest_records, strict=True)
        },
    )
    artifacts = write_chunk_preparation_artifacts(
        writer=runtime_object_store,
        bucket=object_store_settings.bucket_derived,
        manifest=manifest,
        validation_summary=validation.summary,
        document_reports=tuple(document_reports),
    )
    if validation.status != "passed":
        raise ValueError(
            f"chunk preparation validation failed for {corpus}/{collection}: {validation.summary}"
        )
    return _build_chunk_preparation_report(artifacts)


def build_chunk_preparation_manifest(
    *,
    preparation_run_id: str,
    corpus: str,
    collection: str,
    selection_mode: Literal["current_scope", "verified_closeout_run"],
    closeout_run_id: str | None,
    records: Sequence[DocumentRegistryRecord],
    chunks: Sequence[IndexableChunk],
    validation: IndexReleaseValidationResult,
    prepared_at: str,
    document_units_sha256_by_record_key: Mapping[tuple[str, str, str], str] | None = None,
) -> RegistryScopeChunkPreparationManifest:
    if not chunks:
        raise ValueError("chunks must not be empty")
    runtime_document_units_sha256_by_record_key = dict(document_units_sha256_by_record_key or {})
    document_refs = tuple(
        RegistryScopeChunkPreparationDocumentRef(
            document_id=record.document_id,
            revision_track=record.revision_track,
            version_id=record.version_id,
            document_units_object_key=record.document_units_object_key,
            document_units_sha256=runtime_document_units_sha256_by_record_key.get(
                _record_key(record)
            ),
        )
        for record in sorted(
            records, key=lambda item: (item.document_id, item.revision_track, item.version_id)
        )
    )
    provenance = resolve_chunk_preparation_provenance(corpus=corpus, collection=collection)
    return RegistryScopeChunkPreparationManifest(
        preparation_run_id=preparation_run_id,
        corpus=corpus,
        collection=collection,
        selection_mode=selection_mode,
        closeout_run_id=closeout_run_id,
        cleaning_policy_version=str(chunks[0].metadata.get("cleaning_policy_version") or ""),
        chunk_policy_version=str(chunks[0].metadata.get("chunk_policy_version") or ""),
        prepared_at=prepared_at,
        document_count=len(document_refs),
        chunk_count=len(chunks),
        document_version_ids_hash=_hash_values(
            f"{item.document_id}|{item.revision_track}|{item.version_id}" for item in document_refs
        ),
        document_units_keys_hash=_hash_values(
            item.document_units_object_key or "" for item in document_refs
        ),
        validation_status=validation.status,
        validation_summary_object_key=None,
        document_report_object_key=None,
        documents=document_refs,
        document_units_content_hash=_hash_values(
            f"{item.document_id}|{item.revision_track}|{item.version_id}|{item.document_units_sha256 or ''}"
            for item in document_refs
        )
        if runtime_document_units_sha256_by_record_key
        else "",
        chunk_profile_hash=hash_chunk_profile(corpus=corpus, collection=collection),
        chunk_fingerprint_hash=hash_chunk_fingerprint(chunks),
        tokenizer_name=provenance["tokenizer_name"],
        tokenizer_package_version=provenance["tokenizer_package_version"],
        chunker_implementation_version=provenance["chunker_implementation_version"],
        normalizer_version=provenance["normalizer_version"],
        document_units_schema_version=provenance["document_units_schema_version"],
        chunk_preparation_provenance_hash=hash_chunk_preparation_provenance(provenance),
    )


def write_chunk_preparation_artifacts(
    *,
    writer: RegistryScopePreparationObjectStore,
    bucket: str,
    manifest: RegistryScopeChunkPreparationManifest,
    validation_summary: dict[str, object] | None,
    document_reports: Sequence[RegistryScopeChunkPreparationDocumentReport],
) -> RegistryScopeChunkPreparationArtifacts:
    validation_summary_object_key: str | None = None
    if validation_summary is not None:
        validation_summary_object_key = _build_preparation_artifact_key(
            corpus=manifest.corpus,
            collection=manifest.collection,
            preparation_run_id=manifest.preparation_run_id,
            filename="validation-summary.json",
        )
        writer.put_bytes(
            bucket=bucket,
            key=validation_summary_object_key,
            data=(json.dumps(validation_summary, ensure_ascii=False, indent=2) + "\n").encode(
                "utf-8"
            ),
            content_type="application/json",
        )

    document_report_object_key: str | None = None
    if document_reports:
        document_report_object_key = _build_preparation_artifact_key(
            corpus=manifest.corpus,
            collection=manifest.collection,
            preparation_run_id=manifest.preparation_run_id,
            filename="document-reports.jsonl",
        )
        writer.put_bytes(
            bucket=bucket,
            key=document_report_object_key,
            data="".join(
                json.dumps(asdict(report), ensure_ascii=False) + "\n" for report in document_reports
            ).encode("utf-8"),
            content_type="application/x-ndjson",
        )

    runtime_manifest = RegistryScopeChunkPreparationManifest(
        preparation_run_id=manifest.preparation_run_id,
        corpus=manifest.corpus,
        collection=manifest.collection,
        selection_mode=manifest.selection_mode,
        closeout_run_id=manifest.closeout_run_id,
        cleaning_policy_version=manifest.cleaning_policy_version,
        chunk_policy_version=manifest.chunk_policy_version,
        prepared_at=manifest.prepared_at,
        document_count=manifest.document_count,
        chunk_count=manifest.chunk_count,
        document_version_ids_hash=manifest.document_version_ids_hash,
        document_units_keys_hash=manifest.document_units_keys_hash,
        validation_status=manifest.validation_status,
        validation_summary_object_key=validation_summary_object_key,
        document_report_object_key=document_report_object_key,
        documents=manifest.documents,
        document_units_content_hash=manifest.document_units_content_hash,
        chunk_profile_hash=manifest.chunk_profile_hash,
        chunk_fingerprint_hash=manifest.chunk_fingerprint_hash,
        tokenizer_name=manifest.tokenizer_name,
        tokenizer_package_version=manifest.tokenizer_package_version,
        chunker_implementation_version=manifest.chunker_implementation_version,
        normalizer_version=manifest.normalizer_version,
        document_units_schema_version=manifest.document_units_schema_version,
        chunk_preparation_provenance_hash=manifest.chunk_preparation_provenance_hash,
    )
    manifest_object_key = _build_preparation_artifact_key(
        corpus=runtime_manifest.corpus,
        collection=runtime_manifest.collection,
        preparation_run_id=runtime_manifest.preparation_run_id,
        filename="chunk-preparation.json",
    )
    writer.put_bytes(
        bucket=bucket,
        key=manifest_object_key,
        data=(json.dumps(asdict(runtime_manifest), ensure_ascii=False, indent=2) + "\n").encode(
            "utf-8"
        ),
        content_type="application/json",
    )
    return RegistryScopeChunkPreparationArtifacts(
        manifest=runtime_manifest,
        manifest_object_key=manifest_object_key,
        validation_summary_object_key=validation_summary_object_key,
        document_report_object_key=document_report_object_key,
    )


def load_chunk_preparation_manifest(
    *,
    reader: RegistryScopePreparationObjectStore,
    bucket: str,
    corpus: str,
    collection: str,
    preparation_run_id: str,
) -> RegistryScopeChunkPreparationManifest:
    payload = json.loads(
        reader.get_bytes(
            bucket=bucket,
            key=_build_preparation_artifact_key(
                corpus=corpus,
                collection=collection,
                preparation_run_id=preparation_run_id,
                filename="chunk-preparation.json",
            ),
        ).decode("utf-8")
    )
    return RegistryScopeChunkPreparationManifest(
        preparation_run_id=str(payload.get("preparation_run_id") or ""),
        corpus=str(payload.get("corpus") or ""),
        collection=str(payload.get("collection") or ""),
        selection_mode=str(payload.get("selection_mode") or "current_scope"),
        closeout_run_id=(
            str(payload.get("closeout_run_id"))
            if payload.get("closeout_run_id") is not None
            else None
        ),
        cleaning_policy_version=str(payload.get("cleaning_policy_version") or ""),
        chunk_policy_version=str(payload.get("chunk_policy_version") or ""),
        prepared_at=str(payload.get("prepared_at") or ""),
        document_count=int(payload.get("document_count") or 0),
        chunk_count=int(payload.get("chunk_count") or 0),
        document_version_ids_hash=str(payload.get("document_version_ids_hash") or ""),
        document_units_keys_hash=str(payload.get("document_units_keys_hash") or ""),
        validation_status=str(payload.get("validation_status") or ""),
        validation_summary_object_key=(
            str(payload.get("validation_summary_object_key"))
            if payload.get("validation_summary_object_key") is not None
            else None
        ),
        document_report_object_key=(
            str(payload.get("document_report_object_key"))
            if payload.get("document_report_object_key") is not None
            else None
        ),
        documents=tuple(
            RegistryScopeChunkPreparationDocumentRef(
                document_id=str(item.get("document_id") or ""),
                revision_track=str(item.get("revision_track") or ""),
                version_id=str(item.get("version_id") or ""),
                document_units_object_key=(
                    str(item.get("document_units_object_key"))
                    if item.get("document_units_object_key") is not None
                    else None
                ),
                document_units_sha256=(
                    str(item.get("document_units_sha256"))
                    if item.get("document_units_sha256") is not None
                    else None
                ),
            )
            for item in list(payload.get("documents") or [])
        ),
        document_units_content_hash=str(payload.get("document_units_content_hash") or ""),
        chunk_profile_hash=str(payload.get("chunk_profile_hash") or ""),
        chunk_fingerprint_hash=str(payload.get("chunk_fingerprint_hash") or ""),
        tokenizer_name=str(payload.get("tokenizer_name") or ""),
        tokenizer_package_version=str(payload.get("tokenizer_package_version") or ""),
        chunker_implementation_version=str(payload.get("chunker_implementation_version") or ""),
        normalizer_version=str(payload.get("normalizer_version") or ""),
        document_units_schema_version=str(payload.get("document_units_schema_version") or ""),
        chunk_preparation_provenance_hash=str(
            payload.get("chunk_preparation_provenance_hash") or ""
        ),
    )


def _select_preparation_records(
    *,
    source: dict[str, str],
    corpus: str,
    collection: str,
    runtime_profile,
    runtime_registry: DocumentRegistry | None,
    closeout_run_id: str | None,
    closeout_store: CloseoutStore | None,
) -> tuple[
    tuple[DocumentRegistryRecord, ...],
    tuple[DocumentRegistryRecord, ...],
    Literal["current_scope", "verified_closeout_run"],
    str | None,
]:
    if closeout_run_id:
        runtime_closeout_store = (
            closeout_store
            or build_authenticated_notice_closeout_store_from_env(
                source,
                prefer_operator=True,
            )
        )
        pairs = load_verified_closeout_run_document_record_pairs(
            run_id=closeout_run_id,
            closeout_store=runtime_closeout_store,
            expected_corpus=corpus,
            expected_collection=collection,
        )
        selected_processing_records = select_releasable_registry_records(
            records=tuple(pair.staged_record for pair in pairs),
            runtime_profile=runtime_profile,
        )
        pair_by_key = {_record_key(pair.staged_record): pair for pair in pairs}
        selected_pairs = tuple(
            pair_by_key[_record_key(record)] for record in selected_processing_records
        )
        return (
            tuple(pair.staged_record for pair in selected_pairs),
            tuple(pair.final_record for pair in selected_pairs),
            "verified_closeout_run",
            closeout_run_id,
        )
    records = select_releasable_registry_records(
        records=(
            runtime_registry or build_document_registry_from_env(source, prefer_operator=True)
        ).list_by_scope(corpus, collection),
        runtime_profile=runtime_profile,
    )
    return records, records, "current_scope", None


def require_verified_chunk_preparation(
    *,
    corpus: str,
    collection: str,
    preparation_run_id: str | None,
    records: Sequence[DocumentRegistryRecord],
    object_store: RegistryScopePreparationObjectStore,
    bucket: str,
) -> RegistryScopeChunkPreparationManifest | None:
    requires_preparation = (corpus, collection) in MANDATORY_PREPARATION_SCOPES
    if preparation_run_id is None:
        if requires_preparation:
            raise ValueError(
                f"chunk preparation run id is required before release for {corpus}/{collection}"
            )
        return None
    manifest = load_chunk_preparation_manifest(
        reader=object_store,
        bucket=bucket,
        corpus=corpus,
        collection=collection,
        preparation_run_id=preparation_run_id,
    )
    if manifest.validation_status != "passed":
        raise ValueError(
            "chunk preparation is not verified for "
            f"{corpus}/{collection} run {preparation_run_id}: {manifest.validation_status}"
        )
    expected_document_hash = _hash_values(
        f"{record.document_id}|{record.revision_track}|{record.version_id}" for record in records
    )
    if manifest.document_version_ids_hash != expected_document_hash:
        raise ValueError(
            "chunk preparation document scope hash does not match current registry scope for "
            f"{corpus}/{collection}"
        )
    expected_document_units_hash = _hash_values(
        record.document_units_object_key or "" for record in records
    )
    if manifest.document_units_keys_hash != expected_document_units_hash:
        raise ValueError(
            "chunk preparation document-units hash does not match current registry scope for "
            f"{corpus}/{collection}"
        )
    if requires_preparation:
        if not manifest.document_units_content_hash:
            raise ValueError(
                "chunk preparation document-units content hash is missing for "
                f"{corpus}/{collection} run {preparation_run_id}"
            )
        if not manifest.chunk_profile_hash:
            raise ValueError(
                "chunk preparation chunk profile hash is missing for "
                f"{corpus}/{collection} run {preparation_run_id}"
            )
        if not manifest.chunk_fingerprint_hash:
            raise ValueError(
                "chunk preparation chunk fingerprint hash is missing for "
                f"{corpus}/{collection} run {preparation_run_id}"
            )
        verify_chunk_preparation_provenance(manifest)
    expected_document_units_content_hash = _hash_values(
        f"{record.document_id}|{record.revision_track}|{record.version_id}|{_hash_document_units_bytes(object_store=object_store, bucket=bucket, record=record)}"
        for record in records
    )
    if (
        manifest.document_units_content_hash
        and manifest.document_units_content_hash != expected_document_units_content_hash
    ):
        raise ValueError(
            "chunk preparation document-units content hash does not match current artifacts for "
            f"{corpus}/{collection}"
        )
    expected_chunk_profile_hash = hash_chunk_profile(corpus=corpus, collection=collection)
    if manifest.chunk_profile_hash and manifest.chunk_profile_hash != expected_chunk_profile_hash:
        raise ValueError(
            "chunk preparation chunk profile hash does not match current config for "
            f"{corpus}/{collection}"
        )
    return manifest


def verify_prepared_chunks_match_manifest(
    *,
    manifest: RegistryScopeChunkPreparationManifest | None,
    chunks: Sequence[IndexableChunk],
) -> None:
    if manifest is None or not manifest.chunk_fingerprint_hash:
        return
    actual_hash = hash_chunk_fingerprint(chunks)
    if manifest.chunk_fingerprint_hash != actual_hash:
        raise ValueError(
            "chunk preparation fingerprint hash does not match release chunks for "
            f"{manifest.corpus}/{manifest.collection}"
        )


def _validate_prepared_scope(
    *,
    corpus: str,
    collection: str,
    chunks: Sequence[IndexableChunk],
    documents_without_chunks: Sequence[str],
    official_web_min_release_documents: int | None = None,
) -> IndexReleaseValidationResult:
    if not chunks:
        return IndexReleaseValidationResult(
            status="failed",
            summary={
                "chunk_count": 0,
                "documents_without_chunks": list(documents_without_chunks),
                "documents_without_chunks_count": len(documents_without_chunks),
            },
        )
    base_validation = validate_scope_release(
        corpus=corpus,
        collection=collection,
        chunks=chunks,
        official_web_min_release_documents=official_web_min_release_documents,
    )
    token_counts = [int(chunk.metadata.get("final_token_count") or 0) for chunk in chunks]
    invalid_token_count_chunks = [
        chunk.chunk_id for chunk in chunks if int(chunk.metadata.get("final_token_count") or 0) <= 0
    ]
    max_chunk_size_limit: int | None = None
    if (corpus, collection) in MANDATORY_PREPARATION_SCOPES:
        max_chunk_size_limit = load_chunk_profile(
            corpus, collection
        ).runtime_defaults.max_chunk_size
    oversized_chunks = (
        [
            chunk.chunk_id
            for chunk in chunks
            if int(chunk.metadata.get("final_token_count") or 0) > max_chunk_size_limit
        ]
        if max_chunk_size_limit is not None
        else []
    )
    attachment_ref_chunks = [
        chunk.chunk_id
        for chunk in chunks
        if str(chunk.metadata.get("unit_type") or "") == "attachment_ref"
    ]
    status = "passed"
    if base_validation.status != "passed":
        status = "failed"
    if (
        documents_without_chunks
        or invalid_token_count_chunks
        or oversized_chunks
        or attachment_ref_chunks
    ):
        status = "failed"
    summary = {
        **dict(base_validation.summary),
        "documents_without_chunks": list(documents_without_chunks),
        "documents_without_chunks_count": len(documents_without_chunks),
        "invalid_token_count_chunks": invalid_token_count_chunks,
        "invalid_token_count_chunk_count": len(invalid_token_count_chunks),
        "oversized_chunk_limit": max_chunk_size_limit,
        "oversized_chunk_ids": oversized_chunks,
        "oversized_chunk_count": len(oversized_chunks),
        "attachment_ref_chunk_ids": attachment_ref_chunks,
        "attachment_ref_chunk_count": len(attachment_ref_chunks),
        "token_summary": {
            "min": min(token_counts) if token_counts else 0,
            "max": max(token_counts) if token_counts else 0,
            "avg": round(sum(token_counts) / len(token_counts), 2) if token_counts else 0.0,
        },
    }
    return IndexReleaseValidationResult(status=status, summary=summary)


def _build_document_report(
    *,
    record: DocumentRegistryRecord,
    chunks: Sequence[IndexableChunk],
) -> RegistryScopeChunkPreparationDocumentReport:
    token_counts = [int(chunk.metadata.get("final_token_count") or 0) for chunk in chunks]
    unit_type_counts: dict[str, int] = {}
    for chunk in chunks:
        unit_type = str(chunk.metadata.get("unit_type") or "unknown")
        unit_type_counts[unit_type] = unit_type_counts.get(unit_type, 0) + 1
    return RegistryScopeChunkPreparationDocumentReport(
        document_id=record.document_id,
        revision_track=record.revision_track,
        version_id=record.version_id,
        chunk_count=len(chunks),
        token_summary={
            "min": min(token_counts) if token_counts else 0,
            "max": max(token_counts) if token_counts else 0,
            "avg": round(sum(token_counts) / len(token_counts), 2) if token_counts else 0.0,
        },
        unit_type_counts=unit_type_counts,
    )


def _build_chunk_preparation_report(
    artifacts: RegistryScopeChunkPreparationArtifacts,
) -> RegistryScopeChunkPreparationReport:
    manifest = artifacts.manifest
    return RegistryScopeChunkPreparationReport(
        corpus=manifest.corpus,
        collection=manifest.collection,
        preparation_run_id=manifest.preparation_run_id,
        selection_mode=manifest.selection_mode,
        closeout_run_id=manifest.closeout_run_id,
        manifest_object_key=artifacts.manifest_object_key,
        validation_summary_object_key=artifacts.validation_summary_object_key,
        document_report_object_key=artifacts.document_report_object_key,
        validation_status=manifest.validation_status,
        document_count=manifest.document_count,
        chunk_count=manifest.chunk_count,
        prepared_at=manifest.prepared_at,
    )


__all__ = [
    "MANDATORY_PREPARATION_SCOPES",
    "REGISTRY_SCOPE_CHUNK_PREPARATION_OPERATION",
    "RegistryScopeChunkPreparationArtifacts",
    "RegistryScopeChunkPreparationDocumentRef",
    "RegistryScopeChunkPreparationDocumentReport",
    "RegistryScopeChunkPreparationManifest",
    "RegistryScopeChunkPreparationReport",
    "default_preparation_run_id",
    "load_chunk_preparation_manifest",
    "prepare_registry_scope_chunks",
    "require_verified_chunk_preparation",
    "verify_prepared_chunks_match_manifest",
    "write_chunk_preparation_artifacts",
]
