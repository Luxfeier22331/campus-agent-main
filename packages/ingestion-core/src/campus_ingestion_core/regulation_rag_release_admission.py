from __future__ import annotations

import hashlib
import json
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from typing import Protocol

from campus_regulation_semantics.answer_ready_evidence_contract import (
    ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
)

from campus_ingestion_core.corpus_profiles import CollectionRuntimeProfile
from campus_ingestion_core.index_release_acceptance import (
    ReleaseQualityGateResult,
    evaluate_release_chunk_quality,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.object_store import build_operations_artifact_key
from campus_ingestion_core.process import build_indexable_chunks_from_jsonl
from campus_ingestion_core.registry_scope_chunk_preparation import (
    verify_prepared_chunks_match_manifest,
)
from campus_ingestion_core.registry_scope_release_support import (
    resolve_release_chunk_quality_budget,
)

REGULATION_RAG_RELEASE_ADMISSION_SCHEMA_VERSION = "regulation_rag_release_admission.v1"
REGULATION_RAG_RELEASE_ADMISSION_POLICY_VERSION = "regulation_rag_release_admission_policy.v2"
REGULATION_RAG_RELEASE_ADMISSION_OPERATION = "regulation-rag-release-admission"
REGULATION_RAG_RELEASE_ADMISSION_MANIFEST_ENV_KEY = "REGULATION_RAG_RELEASE_ADMISSION_MANIFEST_KEY"


class RegulationRagReleaseAdmissionError(ValueError):
    pass


class RegulationRagReleaseAdmissionObjectStore(Protocol):
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
class RegulationRagReleaseAdmissionDocumentRef:
    document_id: str
    revision_track: str
    version_id: str
    content_hash: str
    document_units_object_key: str
    document_units_sha256: str
    cleaning_policy_version: str
    chunk_profile_version: str
    runtime_profile_identity: str
    reader_current_version_id: str
    cleaning_quality_status: str = "passed"
    chunk_quality_status: str = "passed"
    reader_publish_status: str = "passed"


@dataclass(frozen=True, slots=True)
class RegulationRagReleaseAdmissionManifest:
    schema_version: str
    policy_version: str
    admission_run_id: str
    corpus: str
    collection: str
    admission_status: str
    admitted_at: str
    cleaning_policy_version: str
    chunk_profile_version: str
    runtime_profile_identity: str
    document_count: int
    documents: tuple[RegulationRagReleaseAdmissionDocumentRef, ...] = field(default_factory=tuple)
    chunk_quality_status: str = "passed"
    answer_ready_contract_version: str = ANSWER_READY_EVIDENCE_CONTRACT_VERSION
    answer_ready_contract_status: str = "passed"
    answer_ready_required_field_failures: tuple[str, ...] = ()
    answer_ready_semantic_failures: tuple[str, ...] = ()
    qrels_coverage_status: str = "passed"
    reader_publish_status: str = "passed"
    authz_denial_check_status: str = "passed"
    semantic_oracle_status: str = "passed"
    notes: tuple[str, ...] = ()


def regulation_rag_release_admission_required(
    *,
    corpus: str,
    runtime_profile: CollectionRuntimeProfile,
    publish_alias: bool,
) -> bool:
    return bool(
        publish_alias
        and corpus == "regulations"
        and runtime_profile.serving_stage == "query_serving"
        and runtime_profile.query_enabled_by_default
    )


def build_regulation_rag_runtime_profile_identity(
    runtime_profile: CollectionRuntimeProfile,
) -> str:
    payload = "|".join(
        (
            runtime_profile.corpus,
            runtime_profile.collection,
            runtime_profile.cleaning_policy_version,
            runtime_profile.chunk_profile_version,
            str(runtime_profile.retrieval_enabled),
            str(runtime_profile.query_enabled_by_default),
            ",".join(runtime_profile.serving_revision_tracks),
        )
    )
    return "sha256:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()


def resolve_regulation_rag_release_admission_manifest_key(
    *,
    explicit_key: str | None,
    env: Mapping[str, str] | None = None,
) -> str | None:
    candidate = (explicit_key or "").strip()
    if candidate:
        return candidate
    source = dict(env or {})
    candidate = (source.get(REGULATION_RAG_RELEASE_ADMISSION_MANIFEST_ENV_KEY) or "").strip()
    return candidate or None


def require_regulation_rag_release_admission_key(
    *,
    corpus: str,
    collection: str,
    runtime_profile: CollectionRuntimeProfile,
    publish_alias: bool,
    explicit_key: str | None,
    env: Mapping[str, str] | None = None,
) -> str | None:
    manifest_key = resolve_regulation_rag_release_admission_manifest_key(
        explicit_key=explicit_key,
        env=env,
    )
    if (
        regulation_rag_release_admission_required(
            corpus=corpus,
            runtime_profile=runtime_profile,
            publish_alias=publish_alias,
        )
        and not manifest_key
    ):
        raise RegulationRagReleaseAdmissionError(
            "release admission manifest key is required before query-enabled regulation "
            f"release for {corpus}/{collection}"
        )
    return manifest_key


def build_regulation_rag_release_admission_artifact_key(
    *,
    corpus: str,
    collection: str,
    admission_run_id: str,
) -> str:
    return build_operations_artifact_key(
        corpus=corpus,
        operation=REGULATION_RAG_RELEASE_ADMISSION_OPERATION,
        run_id=admission_run_id,
        segments=(collection,),
        filename="release-admission.json",
    )


def build_regulation_rag_release_admission_manifest(
    *,
    admission_run_id: str,
    corpus: str,
    collection: str,
    records: Sequence[DocumentRegistryRecord],
    runtime_profile: CollectionRuntimeProfile,
    preparation_manifest: object,
    admitted_at: str | None = None,
    chunk_quality_status: str = "passed",
    answer_ready_contract_status: str = "passed",
    answer_ready_contract_version: str = ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
    answer_ready_required_field_failures: Sequence[str] = (),
    answer_ready_semantic_failures: Sequence[str] = (),
    semantic_oracle_status: str = "passed",
    notes: Sequence[str] = (),
) -> RegulationRagReleaseAdmissionManifest:
    documents = _expected_document_refs(
        records=records,
        runtime_profile=runtime_profile,
        preparation_manifest=preparation_manifest,
    )
    return RegulationRagReleaseAdmissionManifest(
        schema_version=REGULATION_RAG_RELEASE_ADMISSION_SCHEMA_VERSION,
        policy_version=REGULATION_RAG_RELEASE_ADMISSION_POLICY_VERSION,
        admission_run_id=admission_run_id,
        corpus=corpus,
        collection=collection,
        admission_status="passed",
        admitted_at=admitted_at or datetime.now(UTC).isoformat(),
        cleaning_policy_version=runtime_profile.cleaning_policy_version,
        chunk_profile_version=runtime_profile.chunk_profile_version,
        runtime_profile_identity=build_regulation_rag_runtime_profile_identity(runtime_profile),
        document_count=len(documents),
        documents=documents,
        chunk_quality_status=chunk_quality_status,
        answer_ready_contract_version=answer_ready_contract_version,
        answer_ready_contract_status=answer_ready_contract_status,
        answer_ready_required_field_failures=tuple(
            str(item) for item in answer_ready_required_field_failures if str(item).strip()
        ),
        answer_ready_semantic_failures=tuple(
            str(item) for item in answer_ready_semantic_failures if str(item).strip()
        ),
        semantic_oracle_status=semantic_oracle_status,
        notes=tuple(str(item) for item in notes if str(item).strip()),
    )


def evaluate_prepared_regulation_rag_release_chunk_quality(
    *,
    reader: RegulationRagReleaseAdmissionObjectStore,
    bucket: str,
    corpus: str,
    collection: str,
    records: Sequence[DocumentRegistryRecord],
    runtime_profile: CollectionRuntimeProfile,
    preparation_manifest: object,
) -> ReleaseQualityGateResult:
    chunk_budget = resolve_release_chunk_quality_budget(
        corpus=corpus,
        collection=collection,
        runtime_profile=runtime_profile,
    )
    chunks = []
    for record in records:
        object_key = str(record.document_units_object_key or "").strip()
        if not object_key:
            raise ValueError(
                f"document_units_object_key is required for release admission quality: {record.document_id}"
            )
        document_units_bytes = reader.get_bytes(bucket=bucket, key=object_key)
        chunks.extend(
            build_indexable_chunks_from_jsonl(
                record=record,
                structured_jsonl_bytes=document_units_bytes,
            )
        )
    verify_prepared_chunks_match_manifest(manifest=preparation_manifest, chunks=tuple(chunks))
    return evaluate_release_chunk_quality(
        chunks=tuple(chunks),
        max_token_count=chunk_budget.max_token_count,
        max_token_count_source=chunk_budget.source,
        max_token_count_by_unit_type=chunk_budget.max_token_count_by_unit_type,
        qrels_coverage_required=False,
    )


def write_regulation_rag_release_admission_manifest(
    *,
    writer: RegulationRagReleaseAdmissionObjectStore,
    bucket: str,
    manifest: RegulationRagReleaseAdmissionManifest,
) -> str:
    validate_regulation_rag_release_admission_manifest_shape(manifest)
    object_key = build_regulation_rag_release_admission_artifact_key(
        corpus=manifest.corpus,
        collection=manifest.collection,
        admission_run_id=manifest.admission_run_id,
    )
    payload = (json.dumps(asdict(manifest), ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    try:
        existing_payload = writer.get_bytes(bucket=bucket, key=object_key)
    except Exception as exc:
        if not _is_missing_object_error(exc):
            raise
    else:
        if existing_payload == payload:
            return object_key
        raise RegulationRagReleaseAdmissionError(
            "admission manifest already exists with different content"
        )
    writer.put_bytes(
        bucket=bucket,
        key=object_key,
        data=payload,
        content_type="application/json",
    )
    return object_key


def load_regulation_rag_release_admission_manifest(
    *,
    reader: RegulationRagReleaseAdmissionObjectStore,
    bucket: str,
    object_key: str,
) -> RegulationRagReleaseAdmissionManifest:
    payload = json.loads(reader.get_bytes(bucket=bucket, key=object_key).decode("utf-8"))
    if not isinstance(payload, dict):
        raise RegulationRagReleaseAdmissionError(
            "regulation RAG release admission manifest must be a JSON object"
        )
    return _manifest_from_payload(payload)


def assert_regulation_rag_release_admission_allows_release(
    *,
    corpus: str,
    collection: str,
    runtime_profile: CollectionRuntimeProfile,
    publish_alias: bool,
    manifest_key: str | None,
    records: Sequence[DocumentRegistryRecord],
    preparation_manifest: object,
    object_store: RegulationRagReleaseAdmissionObjectStore,
    bucket: str,
) -> RegulationRagReleaseAdmissionManifest | None:
    resolved_manifest_key = require_regulation_rag_release_admission_key(
        corpus=corpus,
        collection=collection,
        runtime_profile=runtime_profile,
        publish_alias=publish_alias,
        explicit_key=manifest_key,
    )
    if not regulation_rag_release_admission_required(
        corpus=corpus,
        runtime_profile=runtime_profile,
        publish_alias=publish_alias,
    ):
        return None
    manifest = load_regulation_rag_release_admission_manifest(
        reader=object_store,
        bucket=bucket,
        object_key=str(resolved_manifest_key or ""),
    )
    issues = validate_regulation_rag_release_admission_for_release(
        manifest=manifest,
        corpus=corpus,
        collection=collection,
        runtime_profile=runtime_profile,
        records=records,
        preparation_manifest=preparation_manifest,
    )
    if issues:
        raise RegulationRagReleaseAdmissionError(
            f"release admission manifest rejected {corpus}/{collection}: {', '.join(issues)}"
        )
    return manifest


def validate_regulation_rag_release_admission_manifest_shape(
    manifest: RegulationRagReleaseAdmissionManifest,
) -> None:
    issues = _manifest_shape_issues(manifest)
    if issues:
        raise RegulationRagReleaseAdmissionError(
            "invalid regulation RAG release admission manifest: " + ", ".join(issues)
        )


def validate_regulation_rag_release_admission_for_release(
    *,
    manifest: RegulationRagReleaseAdmissionManifest,
    corpus: str,
    collection: str,
    runtime_profile: CollectionRuntimeProfile,
    records: Sequence[DocumentRegistryRecord],
    preparation_manifest: object,
) -> tuple[str, ...]:
    issues = list(_manifest_shape_issues(manifest))
    if (
        _requires_target_component_eval_proof(
            corpus=corpus,
            collection=collection,
            runtime_profile=runtime_profile,
        )
        and manifest.semantic_oracle_status != "passed"
    ):
        issues.append(f"semantic_oracle_status_not_passed:{manifest.semantic_oracle_status}")
    expected_runtime_profile_identity = build_regulation_rag_runtime_profile_identity(
        runtime_profile
    )
    if manifest.corpus != corpus:
        issues.append(f"corpus_mismatch:{manifest.corpus}!={corpus}")
    if manifest.collection != collection:
        issues.append(f"collection_mismatch:{manifest.collection}!={collection}")
    if manifest.cleaning_policy_version != runtime_profile.cleaning_policy_version:
        issues.append("cleaning_policy_version_mismatch")
    if manifest.chunk_profile_version != runtime_profile.chunk_profile_version:
        issues.append("chunk_profile_version_mismatch")
    if manifest.runtime_profile_identity != expected_runtime_profile_identity:
        issues.append("runtime_profile_identity_mismatch")
    expected_documents = _expected_document_refs(
        records=records,
        runtime_profile=runtime_profile,
        preparation_manifest=preparation_manifest,
    )
    if manifest.document_count != len(expected_documents):
        issues.append("document_count_mismatch")
    actual_by_key = {_document_ref_key(document): document for document in manifest.documents}
    expected_by_key = {_document_ref_key(document): document for document in expected_documents}
    if set(actual_by_key) != set(expected_by_key):
        issues.append("document_identity_set_mismatch")
    else:
        for key, expected in sorted(expected_by_key.items()):
            actual = actual_by_key[key]
            if actual != expected:
                issues.append(f"document_identity_mismatch:{'|'.join(key)}")
    return tuple(issues)


def _manifest_shape_issues(
    manifest: RegulationRagReleaseAdmissionManifest,
) -> tuple[str, ...]:
    issues: list[str] = []
    if manifest.schema_version != REGULATION_RAG_RELEASE_ADMISSION_SCHEMA_VERSION:
        issues.append("schema_version_mismatch")
    if manifest.policy_version != REGULATION_RAG_RELEASE_ADMISSION_POLICY_VERSION:
        issues.append("policy_version_mismatch")
    for field_name in ("admission_run_id", "corpus", "collection", "admitted_at"):
        if not str(getattr(manifest, field_name) or "").strip():
            issues.append(f"{field_name}_missing")
    if manifest.admission_status != "passed":
        issues.append(f"admission_status_not_passed:{manifest.admission_status}")
    for field_name in (
        "chunk_quality_status",
        "answer_ready_contract_version",
        "answer_ready_contract_status",
        "qrels_coverage_status",
        "reader_publish_status",
        "authz_denial_check_status",
        "semantic_oracle_status",
    ):
        value = getattr(manifest, field_name)
        if field_name == "answer_ready_contract_version":
            if value != ANSWER_READY_EVIDENCE_CONTRACT_VERSION:
                issues.append(f"{field_name}_not_passed:{value}")
            continue
        if field_name == "semantic_oracle_status":
            if value != "passed":
                issues.append(f"{field_name}_not_passed:{value}")
            continue
        if value != "passed":
            issues.append(f"{field_name}_not_passed:{getattr(manifest, field_name)}")
    if manifest.answer_ready_required_field_failures:
        issues.append("answer_ready_required_field_failures_not_empty")
    if manifest.answer_ready_semantic_failures:
        issues.append("answer_ready_semantic_failures_not_empty")
    if manifest.document_count != len(manifest.documents):
        issues.append("document_count_shape_mismatch")
    seen: set[tuple[str, str, str]] = set()
    for document in manifest.documents:
        key = _document_ref_key(document)
        if key in seen:
            issues.append(f"duplicate_document_ref:{'|'.join(key)}")
        seen.add(key)
        for field_name in (
            "document_id",
            "revision_track",
            "version_id",
            "content_hash",
            "document_units_object_key",
            "document_units_sha256",
            "cleaning_policy_version",
            "chunk_profile_version",
            "runtime_profile_identity",
            "reader_current_version_id",
        ):
            if not str(getattr(document, field_name) or "").strip():
                issues.append(f"document_{field_name}_missing:{'|'.join(key)}")
        for field_name in (
            "cleaning_quality_status",
            "chunk_quality_status",
            "reader_publish_status",
        ):
            if getattr(document, field_name) != "passed":
                issues.append(f"document_{field_name}_not_passed:{'|'.join(key)}")
    return tuple(issues)


def require_component_eval_summary_for_target_release(
    *,
    corpus: str,
    collection: str,
    runtime_profile: CollectionRuntimeProfile,
    publish_alias: bool,
    component_eval_summary: Mapping[str, object] | None,
    context_label: str,
) -> None:
    if not (
        publish_alias
        and _requires_target_component_eval_proof(
            corpus=corpus,
            collection=collection,
            runtime_profile=runtime_profile,
        )
    ):
        return
    if component_eval_summary is None:
        raise ValueError(
            f"component eval summary is required before query-enabled regulation {context_label}"
        )


def require_release_chunk_quality_summary_for_target_release(
    *,
    corpus: str,
    collection: str,
    runtime_profile: CollectionRuntimeProfile,
    publish_alias: bool,
    preparation_manifest: object,
    context_label: str,
) -> None:
    if not (
        publish_alias
        and _requires_target_component_eval_proof(
            corpus=corpus,
            collection=collection,
            runtime_profile=runtime_profile,
        )
    ):
        return
    validation_summary_object_key = str(
        getattr(preparation_manifest, "validation_summary_object_key", "") or ""
    ).strip()
    validation_status = str(getattr(preparation_manifest, "validation_status", "") or "").strip()
    if not validation_summary_object_key or validation_status != "passed":
        raise ValueError(
            "release chunk quality summary is required before "
            f"query-enabled regulation {context_label}"
        )


def _requires_target_component_eval_proof(
    *,
    corpus: str,
    collection: str,
    runtime_profile: CollectionRuntimeProfile,
) -> bool:
    return bool(
        corpus == "regulations"
        and collection in {"student_rules", "institutional_rules"}
        and runtime_profile.serving_stage == "query_serving"
        and runtime_profile.query_enabled_by_default
    )


def _expected_document_refs(
    *,
    records: Sequence[DocumentRegistryRecord],
    runtime_profile: CollectionRuntimeProfile,
    preparation_manifest: object,
) -> tuple[RegulationRagReleaseAdmissionDocumentRef, ...]:
    runtime_profile_identity = build_regulation_rag_runtime_profile_identity(runtime_profile)
    document_units_sha256_by_key = _document_units_sha256_by_record_key(preparation_manifest)
    return tuple(
        RegulationRagReleaseAdmissionDocumentRef(
            document_id=record.document_id,
            revision_track=record.revision_track,
            version_id=record.version_id,
            content_hash=record.content_hash,
            document_units_object_key=record.document_units_object_key or "",
            document_units_sha256=document_units_sha256_by_key.get(
                (record.document_id, record.revision_track, record.version_id),
                "",
            ),
            cleaning_policy_version=record.cleaning_policy_version
            or runtime_profile.cleaning_policy_version,
            chunk_profile_version=runtime_profile.chunk_profile_version,
            runtime_profile_identity=runtime_profile_identity,
            reader_current_version_id=record.version_id,
        )
        for record in sorted(
            records,
            key=lambda item: (item.document_id, item.revision_track, item.version_id),
        )
    )


def _document_units_sha256_by_record_key(
    preparation_manifest: object,
) -> dict[tuple[str, str, str], str]:
    documents = getattr(preparation_manifest, "documents", ())
    values: dict[tuple[str, str, str], str] = {}
    for document in documents:
        values[
            (
                str(getattr(document, "document_id", "") or ""),
                str(getattr(document, "revision_track", "") or ""),
                str(getattr(document, "version_id", "") or ""),
            )
        ] = str(getattr(document, "document_units_sha256", "") or "")
    return values


def _document_ref_key(
    document: RegulationRagReleaseAdmissionDocumentRef,
) -> tuple[str, str, str]:
    return (document.document_id, document.revision_track, document.version_id)


def _is_missing_object_error(exc: Exception) -> bool:
    if isinstance(exc, (FileNotFoundError, KeyError)):
        return True
    response = getattr(exc, "response", None)
    if not isinstance(response, dict):
        return False
    error = response.get("Error")
    if isinstance(error, dict) and str(error.get("Code") or "").strip() in {
        "404",
        "NoSuchKey",
        "NoSuchBucket",
        "NotFound",
    }:
        return True
    metadata = response.get("ResponseMetadata")
    return isinstance(metadata, dict) and str(metadata.get("HTTPStatusCode") or "").strip() == "404"


def _manifest_from_payload(payload: Mapping[str, object]) -> RegulationRagReleaseAdmissionManifest:
    return RegulationRagReleaseAdmissionManifest(
        schema_version=str(payload.get("schema_version") or ""),
        policy_version=str(payload.get("policy_version") or ""),
        admission_run_id=str(payload.get("admission_run_id") or ""),
        corpus=str(payload.get("corpus") or ""),
        collection=str(payload.get("collection") or ""),
        admission_status=str(payload.get("admission_status") or ""),
        admitted_at=str(payload.get("admitted_at") or ""),
        cleaning_policy_version=str(payload.get("cleaning_policy_version") or ""),
        chunk_profile_version=str(payload.get("chunk_profile_version") or ""),
        runtime_profile_identity=str(payload.get("runtime_profile_identity") or ""),
        document_count=int(payload.get("document_count") or 0),
        documents=tuple(
            _document_ref_from_payload(item)
            for item in list(payload.get("documents") or [])
            if isinstance(item, Mapping)
        ),
        chunk_quality_status=str(payload.get("chunk_quality_status") or ""),
        answer_ready_contract_version=str(payload.get("answer_ready_contract_version") or ""),
        answer_ready_contract_status=str(payload.get("answer_ready_contract_status") or ""),
        answer_ready_required_field_failures=tuple(
            str(item) for item in list(payload.get("answer_ready_required_field_failures") or [])
        ),
        answer_ready_semantic_failures=tuple(
            str(item) for item in list(payload.get("answer_ready_semantic_failures") or [])
        ),
        qrels_coverage_status=str(payload.get("qrels_coverage_status") or ""),
        reader_publish_status=str(payload.get("reader_publish_status") or ""),
        authz_denial_check_status=str(payload.get("authz_denial_check_status") or ""),
        semantic_oracle_status=str(payload.get("semantic_oracle_status") or ""),
        notes=tuple(str(item) for item in list(payload.get("notes") or [])),
    )


def _document_ref_from_payload(
    payload: Mapping[str, object],
) -> RegulationRagReleaseAdmissionDocumentRef:
    return RegulationRagReleaseAdmissionDocumentRef(
        document_id=str(payload.get("document_id") or ""),
        revision_track=str(payload.get("revision_track") or ""),
        version_id=str(payload.get("version_id") or ""),
        content_hash=str(payload.get("content_hash") or ""),
        document_units_object_key=str(payload.get("document_units_object_key") or ""),
        document_units_sha256=str(payload.get("document_units_sha256") or ""),
        cleaning_policy_version=str(payload.get("cleaning_policy_version") or ""),
        chunk_profile_version=str(payload.get("chunk_profile_version") or ""),
        runtime_profile_identity=str(payload.get("runtime_profile_identity") or ""),
        reader_current_version_id=str(payload.get("reader_current_version_id") or ""),
        cleaning_quality_status=str(payload.get("cleaning_quality_status") or ""),
        chunk_quality_status=str(payload.get("chunk_quality_status") or ""),
        reader_publish_status=str(payload.get("reader_publish_status") or ""),
    )


__all__ = [
    "REGULATION_RAG_RELEASE_ADMISSION_MANIFEST_ENV_KEY",
    "REGULATION_RAG_RELEASE_ADMISSION_OPERATION",
    "REGULATION_RAG_RELEASE_ADMISSION_POLICY_VERSION",
    "REGULATION_RAG_RELEASE_ADMISSION_SCHEMA_VERSION",
    "RegulationRagReleaseAdmissionDocumentRef",
    "RegulationRagReleaseAdmissionError",
    "RegulationRagReleaseAdmissionManifest",
    "assert_regulation_rag_release_admission_allows_release",
    "build_regulation_rag_release_admission_artifact_key",
    "build_regulation_rag_release_admission_manifest",
    "build_regulation_rag_runtime_profile_identity",
    "evaluate_prepared_regulation_rag_release_chunk_quality",
    "load_regulation_rag_release_admission_manifest",
    "regulation_rag_release_admission_required",
    "require_component_eval_summary_for_target_release",
    "require_regulation_rag_release_admission_key",
    "require_release_chunk_quality_summary_for_target_release",
    "resolve_regulation_rag_release_admission_manifest_key",
    "validate_regulation_rag_release_admission_for_release",
    "validate_regulation_rag_release_admission_manifest_shape",
    "write_regulation_rag_release_admission_manifest",
]
