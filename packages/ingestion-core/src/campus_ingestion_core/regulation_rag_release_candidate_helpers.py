from __future__ import annotations

import hashlib
from dataclasses import replace
from datetime import UTC, datetime

from campus_ingestion_core.corpus_profiles import CollectionRuntimeProfile
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.postgres_runtime import build_operator_postgres_connection_url
from campus_ingestion_core.registry import (
    SHARED_POSTGRES_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
    _coerce_json_payload,
)
from campus_ingestion_core.regulation_rag_release_admission import (
    build_regulation_rag_runtime_profile_identity,
)
from campus_ingestion_core.regulation_rag_release_models import (
    DEFAULT_REGULATION_RAG_RELEASE_CANDIDATE_ENV_KEY,
    DEFAULT_REGULATION_RAG_RELEASE_CANDIDATE_OPERATOR_ENV_KEY,
    RagReleaseCandidate,
    RagReleaseCandidateStatus,
)


def _candidate_requires_release_admission(candidate: RagReleaseCandidate) -> bool:
    return bool(
        candidate.corpus == "regulations"
        and candidate.query_enabled_by_default
        and candidate.retrieval_enabled
    )


def _candidate_from_record(
    *,
    record: DocumentRegistryRecord,
    runtime_profile: CollectionRuntimeProfile,
    now: str,
    status: RagReleaseCandidateStatus,
    last_release_id: str | None = None,
    candidate_reason: str | None = None,
) -> RagReleaseCandidate:
    runtime_profile_identity = _runtime_profile_identity(runtime_profile)
    candidate_id = _candidate_id(record, runtime_profile_identity, status)
    document_site_status = "not_tracked"
    rag_preparation_status = "pending"
    rag_index_status = "pending"
    rag_serving_status = "not_serving"
    rag_verification_status = "pending"
    if status == "skipped_unchanged":
        rag_preparation_status = "skipped_unchanged"
        rag_index_status = "skipped_unchanged"
        rag_verification_status = "not_applicable"
    return RagReleaseCandidate(
        candidate_id=candidate_id,
        document_id=record.document_id,
        revision_track=record.revision_track,
        version_id=record.version_id,
        corpus=record.corpus,
        collection=record.collection,
        document_hash=record.content_hash,
        runtime_profile_identity=runtime_profile_identity,
        chunk_profile_version=runtime_profile.chunk_profile_version,
        cleaning_policy_version=runtime_profile.cleaning_policy_version,
        retrieval_enabled=runtime_profile.retrieval_enabled,
        query_enabled_by_default=runtime_profile.query_enabled_by_default,
        is_current=record.is_current,
        document_status=record.status,
        visibility_level=record.visibility_level,
        visibility_scope=record.visibility_scope,
        entitlement_groups=tuple(record.entitlement_groups),
        candidate_reason=candidate_reason or _candidate_reason(record),
        status=status,
        cleanup_disposition="none",
        created_at=now,
        updated_at=now,
        documentSiteStatus=document_site_status,
        ragPreparationStatus=rag_preparation_status,
        ragIndexStatus=rag_index_status,
        ragServingStatus=rag_serving_status,
        ragVerificationStatus=rag_verification_status,
        last_release_id=last_release_id,
    )


def _candidate_from_payload(value: object) -> RagReleaseCandidate:
    payload = _coerce_json_payload(value)
    payload["entitlement_groups"] = tuple(
        str(item) for item in payload.get("entitlement_groups") or ()
    )
    for optional_key in ("last_release_id", "message", "visibility_scope"):
        if payload.get(optional_key) is None:
            payload[optional_key] = None
    return RagReleaseCandidate(**payload)  # type: ignore[arg-type]


def _with_status(
    candidate: RagReleaseCandidate,
    *,
    status: RagReleaseCandidateStatus,
    updated_at: str,
    cleanup_disposition: str | None = None,
    rag_preparation_status: str | None = None,
    rag_index_status: str | None = None,
    rag_serving_status: str | None = None,
    rag_verification_status: str | None = None,
    last_release_id: str | None = None,
    message: str | None = None,
) -> RagReleaseCandidate:
    return replace(
        candidate,
        status=status,
        cleanup_disposition=cleanup_disposition or candidate.cleanup_disposition,
        updated_at=updated_at,
        ragPreparationStatus=rag_preparation_status or candidate.ragPreparationStatus,
        ragIndexStatus=rag_index_status or candidate.ragIndexStatus,
        ragServingStatus=rag_serving_status or candidate.ragServingStatus,
        ragVerificationStatus=rag_verification_status or candidate.ragVerificationStatus,
        last_release_id=last_release_id or candidate.last_release_id,
        message=message,
    )


def _candidate_reason(record: DocumentRegistryRecord) -> str:
    if record.status in {"withdrawn", "deleted"}:
        return "document_withdrawn_or_deleted"
    if not record.is_current:
        return "document_no_longer_current"
    return "canonical_document_changed"


def _runtime_profile_identity(runtime_profile: CollectionRuntimeProfile) -> str:
    return build_regulation_rag_runtime_profile_identity(runtime_profile)


def _candidate_id(
    record: DocumentRegistryRecord,
    runtime_profile_identity: str,
    status: str,
) -> str:
    payload = "|".join(
        (
            record.corpus,
            record.collection,
            record.document_id,
            record.revision_track,
            record.version_id,
            record.content_hash,
            runtime_profile_identity,
            status,
        )
    )
    return "rag_release_candidate:" + hashlib.sha256(payload.encode("utf-8")).hexdigest()


def _iso(value: datetime | None = None) -> str:
    return (value or datetime.now(UTC)).astimezone(UTC).isoformat()


def _optional_attr(value: object, name: str) -> str | None:
    raw = getattr(value, name, None)
    normalized = str(raw or "").strip()
    return normalized or None


def _resolve_candidate_store_database_url(
    source: dict[str, str],
    *,
    prefer_operator: bool,
) -> str:
    if prefer_operator:
        operator_url = (
            (source.get(DEFAULT_REGULATION_RAG_RELEASE_CANDIDATE_OPERATOR_ENV_KEY) or "").strip()
            or (source.get(SHARED_POSTGRES_OPERATOR_ENV_KEY) or "").strip()
        )
        if not operator_url:
            raise ValueError(
                f"{DEFAULT_REGULATION_RAG_RELEASE_CANDIDATE_OPERATOR_ENV_KEY} or "
                f"{SHARED_POSTGRES_OPERATOR_ENV_KEY} "
                "is required for regulation RAG release candidate store"
            )
        return build_operator_postgres_connection_url(operator_url)
    database_url = (source.get(DEFAULT_REGULATION_RAG_RELEASE_CANDIDATE_ENV_KEY) or "").strip() or (
        source.get(SHARED_POSTGRES_ENV_KEY) or ""
    ).strip()
    if not database_url:
        raise ValueError(
            f"{DEFAULT_REGULATION_RAG_RELEASE_CANDIDATE_ENV_KEY} or {SHARED_POSTGRES_ENV_KEY} "
            "is required for regulation RAG release candidate store"
        )
    return database_url
