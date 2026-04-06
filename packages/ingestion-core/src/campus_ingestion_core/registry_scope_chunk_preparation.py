from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import hashlib
import json
import os
from typing import Any, Protocol, Sequence

from campus_ingestion_core.corpus_profiles import load_chunk_profile, load_runtime_profile
from campus_ingestion_core.index_release import IndexReleaseValidationResult, validate_scope_release
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.object_store import build_operations_artifact_key
from campus_ingestion_core.process import IndexableChunk, build_indexable_chunks_from_record
from campus_ingestion_core.registry import DocumentRegistry, build_document_registry_from_env
from campus_ingestion_core.registry_scope_common import record_label, select_releasable_registry_records
from campus_ingestion_core.settings import ObjectStoreSettings

REGISTRY_SCOPE_CHUNK_PREPARATION_OPERATION = "registry-scope-chunk-preparation"
MANDATORY_PREPARATION_SCOPES = frozenset({("campus_notices", "internal_notice")})


class RegistryScopePreparationObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


@dataclass(frozen=True, slots=True)
class RegistryScopeChunkPreparationDocumentRef:
    document_id: str
    revision_track: str
    version_id: str
    document_units_object_key: str | None


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
    manifest_object_key: str
    validation_summary_object_key: str | None
    document_report_object_key: str | None
    validation_status: str
    document_count: int
    chunk_count: int
    prepared_at: str


def default_preparation_run_id(*, now: datetime | None = None) -> str:
    runtime_now = now or datetime.now(timezone.utc)
    return runtime_now.strftime("prep-%Y%m%d-%H%M%S")


def prepare_registry_scope_chunks(
    *,
    corpus: str,
    collection: str,
    preparation_run_id: str | None = None,
    env: dict[str, str] | None = None,
    registry: DocumentRegistry | None = None,
    object_store: RegistryScopePreparationObjectStore | None = None,
) -> RegistryScopeChunkPreparationReport:
    source = dict(env if env is not None else os.environ)
    runtime_profile = load_runtime_profile(corpus, collection)
    object_store_settings = ObjectStoreSettings.from_env(source)
    if object_store is None:
        from campus_ingestion_core.local_rebuild import S3ObjectStoreAdmin

        runtime_object_store: RegistryScopePreparationObjectStore = S3ObjectStoreAdmin(object_store_settings)
    else:
        runtime_object_store = object_store
    runtime_registry = registry or build_document_registry_from_env(source)
    records = select_releasable_registry_records(
        records=runtime_registry.list_by_scope(corpus, collection),
        runtime_profile=runtime_profile,
    )
    if not records:
        raise ValueError(f"no releasable registry records found for {corpus}/{collection}")
    chunks: list[IndexableChunk] = []
    document_reports: list[RegistryScopeChunkPreparationDocumentReport] = []
    documents_without_chunks: list[str] = []
    for record in records:
        document_chunks = build_indexable_chunks_from_record(
            record=record,
            object_store=runtime_object_store,
            bucket=object_store_settings.bucket_derived,
        )
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
    )
    prepared_at = datetime.now(timezone.utc).isoformat()
    manifest = build_chunk_preparation_manifest(
        preparation_run_id=preparation_run_id or default_preparation_run_id(),
        corpus=corpus,
        collection=collection,
        records=records,
        chunks=tuple(chunks),
        validation=validation,
        prepared_at=prepared_at,
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
            "chunk preparation validation failed for "
            f"{corpus}/{collection}: {validation.summary}"
        )
    return _build_chunk_preparation_report(artifacts)


def build_chunk_preparation_manifest(
    *,
    preparation_run_id: str,
    corpus: str,
    collection: str,
    records: Sequence[DocumentRegistryRecord],
    chunks: Sequence[IndexableChunk],
    validation: IndexReleaseValidationResult,
    prepared_at: str,
) -> RegistryScopeChunkPreparationManifest:
    if not chunks:
        raise ValueError("chunks must not be empty")
    document_refs = tuple(
        RegistryScopeChunkPreparationDocumentRef(
            document_id=record.document_id,
            revision_track=record.revision_track,
            version_id=record.version_id,
            document_units_object_key=record.document_units_object_key,
        )
        for record in sorted(records, key=lambda item: (item.document_id, item.revision_track, item.version_id))
    )
    return RegistryScopeChunkPreparationManifest(
        preparation_run_id=preparation_run_id,
        corpus=corpus,
        collection=collection,
        cleaning_policy_version=str(chunks[0].metadata.get("cleaning_policy_version") or ""),
        chunk_policy_version=str(chunks[0].metadata.get("chunk_policy_version") or ""),
        prepared_at=prepared_at,
        document_count=len(document_refs),
        chunk_count=len(chunks),
        document_version_ids_hash=_hash_values(
            f"{item.document_id}|{item.revision_track}|{item.version_id}" for item in document_refs
        ),
        document_units_keys_hash=_hash_values(item.document_units_object_key or "" for item in document_refs),
        validation_status=validation.status,
        validation_summary_object_key=None,
        document_report_object_key=None,
        documents=document_refs,
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
            data=(json.dumps(validation_summary, ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
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
        data=(json.dumps(asdict(runtime_manifest), ensure_ascii=False, indent=2) + "\n").encode("utf-8"),
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
            )
            for item in list(payload.get("documents") or [])
        ),
    )


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
                "chunk preparation run id is required before release for "
                f"{corpus}/{collection}"
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
    expected_document_units_hash = _hash_values(record.document_units_object_key or "" for record in records)
    if manifest.document_units_keys_hash != expected_document_units_hash:
        raise ValueError(
            "chunk preparation document-units hash does not match current registry scope for "
            f"{corpus}/{collection}"
        )
    return manifest


def _validate_prepared_scope(
    *,
    corpus: str,
    collection: str,
    chunks: Sequence[IndexableChunk],
    documents_without_chunks: Sequence[str],
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
    base_validation = validate_scope_release(corpus=corpus, collection=collection, chunks=chunks)
    token_counts = [int(chunk.metadata.get("final_token_count") or 0) for chunk in chunks]
    invalid_token_count_chunks = [
        chunk.chunk_id for chunk in chunks if int(chunk.metadata.get("final_token_count") or 0) <= 0
    ]
    max_chunk_size_limit: int | None = None
    if (corpus, collection) in MANDATORY_PREPARATION_SCOPES:
        max_chunk_size_limit = load_chunk_profile(corpus, collection).runtime_defaults.max_chunk_size
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
        chunk.chunk_id for chunk in chunks if str(chunk.metadata.get("unit_type") or "") == "attachment_ref"
    ]
    status = "passed"
    if base_validation.status != "passed":
        status = "failed"
    if documents_without_chunks or invalid_token_count_chunks or oversized_chunks or attachment_ref_chunks:
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
        manifest_object_key=artifacts.manifest_object_key,
        validation_summary_object_key=artifacts.validation_summary_object_key,
        document_report_object_key=artifacts.document_report_object_key,
        validation_status=manifest.validation_status,
        document_count=manifest.document_count,
        chunk_count=manifest.chunk_count,
        prepared_at=manifest.prepared_at,
    )


def _build_preparation_artifact_key(
    *,
    corpus: str,
    collection: str,
    preparation_run_id: str,
    filename: str,
) -> str:
    return build_operations_artifact_key(
        corpus=corpus,
        operation=REGISTRY_SCOPE_CHUNK_PREPARATION_OPERATION,
        run_id=preparation_run_id,
        filename=filename,
        segments=(collection,),
    )


def _hash_values(values: Sequence[str] | Any) -> str:
    digest = hashlib.sha256()
    for value in sorted(str(item) for item in values):
        digest.update(value.encode("utf-8"))
        digest.update(b"\n")
    return digest.hexdigest()


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
    "write_chunk_preparation_artifacts",
]
