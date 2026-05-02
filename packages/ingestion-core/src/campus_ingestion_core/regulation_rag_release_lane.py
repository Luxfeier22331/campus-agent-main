from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Callable, Mapping, Sequence
from dataclasses import asdict, dataclass, field, replace
from datetime import UTC, datetime
from typing import Literal, Protocol

from campus_ingestion_core.corpus_profiles import CollectionRuntimeProfile, load_runtime_profile
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.postgres_runtime import (
    build_operator_postgres_connection_url,
    normalize_postgres_connection_url,
)
from campus_ingestion_core.registry import (
    SHARED_POSTGRES_ENV_KEY,
    SHARED_POSTGRES_MANAGEMENT_ENV_KEY,
    SHARED_POSTGRES_OPERATOR_ENV_KEY,
    DocumentRegistry,
    _coerce_json_payload,
    _ensure_table_schema,
    _postgres_connection,
    _qualified_table_sql,
    _table_index_suffix,
)
from campus_ingestion_core.regulation_rag_release_admission import (
    RegulationRagReleaseAdmissionError,
    build_regulation_rag_runtime_profile_identity,
    require_regulation_rag_release_admission_key,
)

DEFAULT_REGULATION_RAG_RELEASE_CANDIDATE_ENV_KEY = "REGULATION_RAG_RELEASE_CANDIDATE_DATABASE_URL"
DEFAULT_REGULATION_RAG_RELEASE_CANDIDATE_MANAGEMENT_ENV_KEY = (
    "REGULATION_RAG_RELEASE_CANDIDATE_MANAGEMENT_DATABASE_URL"
)
DEFAULT_REGULATION_RAG_RELEASE_CANDIDATE_OPERATOR_ENV_KEY = (
    "REGULATION_RAG_RELEASE_CANDIDATE_OPERATOR_DATABASE_URL"
)
DEFAULT_REGULATION_RAG_RELEASE_CANDIDATE_TABLE = (
    "ingestion_projection.regulation_rag_release_candidate"
)
REGULATION_RAG_RELEASE_ELIGIBLE_COLLECTIONS = frozenset({"institutional_rules"})

RagReleaseCandidateStatus = Literal[
    "pending",
    "batched",
    "preparing",
    "preparation_failed",
    "indexed",
    "acceptance_failed",
    "release_admission_blocked",
    "serving_published",
    "verification_failed",
    "skipped_unchanged",
    "not_query_enabled",
    "held_search_only",
    "profile_disabled",
    "deleted",
]


@dataclass(frozen=True, slots=True)
class RagReleaseCandidate:
    candidate_id: str
    document_id: str
    revision_track: str
    version_id: str
    corpus: str
    collection: str
    document_hash: str
    runtime_profile_identity: str
    chunk_profile_version: str
    cleaning_policy_version: str
    retrieval_enabled: bool
    query_enabled_by_default: bool
    is_current: bool
    document_status: str
    visibility_level: str
    visibility_scope: str | None
    entitlement_groups: tuple[str, ...]
    candidate_reason: str
    status: RagReleaseCandidateStatus
    cleanup_disposition: str
    created_at: str
    updated_at: str
    documentSiteStatus: str
    ragPreparationStatus: str
    ragIndexStatus: str
    ragServingStatus: str
    ragVerificationStatus: str
    last_release_id: str | None = None
    message: str | None = None


@dataclass(frozen=True, slots=True)
class RagReleaseExecutionResult:
    status: Literal[
        "passed",
        "acceptance_failed",
        "release_admission_blocked",
        "verification_failed",
    ]
    release_id: str | None = None
    verification_status: Literal["passed", "failed"] | None = None
    message: str | None = None
    release_admission_status: str = ""
    release_admission_manifest_key: str | None = None


@dataclass(frozen=True, slots=True)
class RagReleaseCandidateEnqueueReport:
    created_count: int
    skipped_unchanged_count: int
    candidate_ids: tuple[str, ...]
    forced_reenqueue_count: int = 0


@dataclass(frozen=True, slots=True)
class RagReleaseCandidateProcessReport:
    processed_count: int
    candidate_ids: tuple[str, ...]
    status_counts: dict[str, int] = field(default_factory=dict)
    admission_blocked_count: int = 0


class RegulationRagReleaseCandidateStore(Protocol):
    def upsert_candidate(self, candidate: RagReleaseCandidate) -> None: ...

    def list_candidates(self) -> tuple[RagReleaseCandidate, ...]: ...

    def list_pending_candidates(self) -> tuple[RagReleaseCandidate, ...]: ...

    def latest_candidate_for_document(
        self,
        *,
        document_id: str,
        revision_track: str,
        version_id: str,
        runtime_profile_identity: str,
    ) -> RagReleaseCandidate | None: ...


class PostgresRegulationRagReleaseCandidateStore:
    def __init__(
        self,
        database_url: str,
        *,
        table_name: str = DEFAULT_REGULATION_RAG_RELEASE_CANDIDATE_TABLE,
    ) -> None:
        self.database_url = normalize_postgres_connection_url(database_url)
        if not self.database_url:
            raise ValueError("regulation RAG release candidate database url is required")
        self.table_name = table_name
        self._ensure_schema()

    def upsert_candidate(self, candidate: RagReleaseCandidate) -> None:
        table_sql = _qualified_table_sql(self.table_name)
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(
                f"""
                insert into {table_sql} (
                    candidate_id,
                    document_id,
                    revision_track,
                    version_id,
                    corpus,
                    collection,
                    document_hash,
                    runtime_profile_identity,
                    status,
                    created_at,
                    updated_at,
                    record
                )
                values (
                    %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb
                )
                on conflict (candidate_id) do update set
                    document_id = excluded.document_id,
                    revision_track = excluded.revision_track,
                    version_id = excluded.version_id,
                    corpus = excluded.corpus,
                    collection = excluded.collection,
                    document_hash = excluded.document_hash,
                    runtime_profile_identity = excluded.runtime_profile_identity,
                    status = excluded.status,
                    created_at = excluded.created_at,
                    updated_at = excluded.updated_at,
                    record = excluded.record
                """,
                (
                    candidate.candidate_id,
                    candidate.document_id,
                    candidate.revision_track,
                    candidate.version_id,
                    candidate.corpus,
                    candidate.collection,
                    candidate.document_hash,
                    candidate.runtime_profile_identity,
                    candidate.status,
                    candidate.created_at,
                    candidate.updated_at,
                    json.dumps(asdict(candidate), ensure_ascii=False),
                ),
            )

    def list_candidates(self) -> tuple[RagReleaseCandidate, ...]:
        table_sql = _qualified_table_sql(self.table_name)
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(
                f"select record from {table_sql} order by updated_at asc, candidate_id asc"
            )
            rows = cursor.fetchall()
        return tuple(_candidate_from_payload(row[0]) for row in rows)

    def list_pending_candidates(self) -> tuple[RagReleaseCandidate, ...]:
        table_sql = _qualified_table_sql(self.table_name)
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(
                f"""
                select record
                from {table_sql}
                where status = 'pending'
                order by updated_at asc, candidate_id asc
                """
            )
            rows = cursor.fetchall()
        return tuple(_candidate_from_payload(row[0]) for row in rows)

    def latest_candidate_for_document(
        self,
        *,
        document_id: str,
        revision_track: str,
        version_id: str,
        runtime_profile_identity: str,
    ) -> RagReleaseCandidate | None:
        table_sql = _qualified_table_sql(self.table_name)
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            cursor.execute(
                f"""
                select record
                from {table_sql}
                where document_id = %s
                  and revision_track = %s
                  and version_id = %s
                  and runtime_profile_identity = %s
                order by updated_at desc, candidate_id desc
                limit 1
                """,
                (document_id, revision_track, version_id, runtime_profile_identity),
            )
            row = cursor.fetchone()
        return _candidate_from_payload(row[0]) if row is not None else None

    def _ensure_schema(self) -> None:
        table_sql = _qualified_table_sql(self.table_name)
        suffix = _table_index_suffix(self.table_name)
        with _postgres_connection(self.database_url) as conn, conn.cursor() as cursor:
            _ensure_table_schema(cursor, table_name=self.table_name)
            cursor.execute(
                f"""
                create table if not exists {table_sql} (
                    candidate_id text primary key,
                    document_id text not null,
                    revision_track text not null,
                    version_id text not null,
                    corpus text not null,
                    collection text not null,
                    document_hash text not null,
                    runtime_profile_identity text not null,
                    status text not null,
                    created_at timestamptz not null,
                    updated_at timestamptz not null,
                    record jsonb not null
                )
                """
            )
            cursor.execute(
                f"""
                create index if not exists idx_{suffix}_status_updated
                on {table_sql} (status, updated_at, candidate_id)
                """
            )
            cursor.execute(
                f"""
                create index if not exists idx_{suffix}_document_profile
                on {table_sql} (
                    document_id,
                    revision_track,
                    version_id,
                    runtime_profile_identity,
                    updated_at desc
                )
                """
            )


class InMemoryRegulationRagReleaseCandidateStore:
    def __init__(self, candidates: Sequence[RagReleaseCandidate] = ()) -> None:
        self._candidates: dict[str, RagReleaseCandidate] = {}
        for candidate in candidates:
            self.upsert_candidate(candidate)

    def upsert_candidate(self, candidate: RagReleaseCandidate) -> None:
        self._candidates[candidate.candidate_id] = candidate

    def list_candidates(self) -> tuple[RagReleaseCandidate, ...]:
        return tuple(self._candidates.values())

    def list_pending_candidates(self) -> tuple[RagReleaseCandidate, ...]:
        return tuple(
            candidate for candidate in self.list_candidates() if candidate.status == "pending"
        )

    def latest_candidate_for_document(
        self,
        *,
        document_id: str,
        revision_track: str,
        version_id: str,
        runtime_profile_identity: str,
    ) -> RagReleaseCandidate | None:
        matches = [
            candidate
            for candidate in self._candidates.values()
            if candidate.document_id == document_id
            and candidate.revision_track == revision_track
            and candidate.version_id == version_id
            and candidate.runtime_profile_identity == runtime_profile_identity
        ]
        if not matches:
            return None
        return max(matches, key=lambda candidate: candidate.updated_at)


def enqueue_regulation_rag_release_candidates_for_records(
    *,
    store: RegulationRagReleaseCandidateStore,
    records: Sequence[DocumentRegistryRecord],
    runtime_profile: CollectionRuntimeProfile,
    now: datetime | None = None,
    force: bool = False,
) -> RagReleaseCandidateEnqueueReport:
    if (
        runtime_profile.collection not in REGULATION_RAG_RELEASE_ELIGIBLE_COLLECTIONS
        or not runtime_profile.query_enabled_by_default
    ):
        return RagReleaseCandidateEnqueueReport(
            created_count=0,
            skipped_unchanged_count=0,
            candidate_ids=(),
            forced_reenqueue_count=0,
        )
    runtime_now = _iso(now)
    candidate_ids: list[str] = []
    skipped_unchanged_count = 0
    forced_reenqueue_count = 0
    for record in records:
        if record.collection not in REGULATION_RAG_RELEASE_ELIGIBLE_COLLECTIONS:
            continue
        runtime_profile_identity = _runtime_profile_identity(runtime_profile)
        existing = store.latest_candidate_for_document(
            document_id=record.document_id,
            revision_track=record.revision_track,
            version_id=record.version_id,
            runtime_profile_identity=runtime_profile_identity,
        )
        if (
            existing is not None
            and existing.document_hash == record.content_hash
            and existing.status == "serving_published"
        ):
            if force:
                candidate = _candidate_from_record(
                    record=record,
                    runtime_profile=runtime_profile,
                    now=runtime_now,
                    status="pending",
                    candidate_reason="forced_release_policy_reenqueue",
                )
                forced_reenqueue_count += 1
            else:
                candidate = _candidate_from_record(
                    record=record,
                    runtime_profile=runtime_profile,
                    now=runtime_now,
                    status="skipped_unchanged",
                    last_release_id=existing.last_release_id,
                )
                skipped_unchanged_count += 1
        else:
            candidate = _candidate_from_record(
                record=record,
                runtime_profile=runtime_profile,
                now=runtime_now,
                status="pending",
            )
        store.upsert_candidate(candidate)
        candidate_ids.append(candidate.candidate_id)
    return RagReleaseCandidateEnqueueReport(
        created_count=len(candidate_ids) - skipped_unchanged_count,
        skipped_unchanged_count=skipped_unchanged_count,
        candidate_ids=tuple(candidate_ids),
        forced_reenqueue_count=forced_reenqueue_count,
    )


def enqueue_regulation_rag_release_candidates_for_registry_delta(
    *,
    store: RegulationRagReleaseCandidateStore,
    registry: DocumentRegistry,
    corpus: str,
    collection: str,
    changed_document_ids: Sequence[str],
    runtime_profile: CollectionRuntimeProfile | None = None,
    now: datetime | None = None,
    force: bool = False,
) -> RagReleaseCandidateEnqueueReport:
    resolved_profile = runtime_profile or load_runtime_profile(corpus, collection)
    changed_ids = tuple(
        dict.fromkeys(str(item).strip() for item in changed_document_ids if str(item).strip())
    )
    records: list[DocumentRegistryRecord] = []
    for document_id in changed_ids:
        record = registry.current_version(
            document_id,
            preferred_revision_tracks=resolved_profile.serving_revision_tracks,
        )
        if record is None:
            continue
        if record.corpus == corpus and record.collection == collection:
            records.append(record)
    return enqueue_regulation_rag_release_candidates_for_records(
        store=store,
        records=tuple(sorted(records, key=lambda item: item.document_id)),
        runtime_profile=resolved_profile,
        now=now,
        force=force,
    )


def process_pending_regulation_rag_release_candidates(
    *,
    store: RegulationRagReleaseCandidateStore,
    release_executor: Callable[[RagReleaseCandidate], RagReleaseExecutionResult],
    candidate_ids: Sequence[str] = (),
    now: datetime | None = None,
) -> RagReleaseCandidateProcessReport:
    runtime_now = _iso(now)
    selected_candidate_ids = {
        str(candidate_id).strip() for candidate_id in candidate_ids if str(candidate_id).strip()
    }
    released_candidate_by_scope: dict[tuple[str, str, str], RagReleaseCandidate] = {}
    processed_ids: list[str] = []
    status_counts: dict[str, int] = {}
    for candidate in store.list_pending_candidates():
        if selected_candidate_ids and candidate.candidate_id not in selected_candidate_ids:
            continue
        processed = _terminal_without_release(candidate, updated_at=runtime_now)
        if processed is None:
            scope_key = (
                candidate.corpus,
                candidate.collection,
                candidate.runtime_profile_identity,
            )
            release_result = released_candidate_by_scope.get(scope_key)
            if release_result is None:
                processed = _process_with_release_executor(
                    candidate=candidate,
                    release_executor=release_executor,
                    updated_at=runtime_now,
                )
                released_candidate_by_scope[scope_key] = processed
            else:
                processed = _copy_release_terminal_status(
                    candidate=candidate,
                    released=release_result,
                    updated_at=runtime_now,
                )
        store.upsert_candidate(processed)
        processed_ids.append(processed.candidate_id)
        status_counts[processed.status] = status_counts.get(processed.status, 0) + 1
    return RagReleaseCandidateProcessReport(
        processed_count=len(processed_ids),
        candidate_ids=tuple(processed_ids),
        status_counts=status_counts,
        admission_blocked_count=status_counts.get("release_admission_blocked", 0),
    )


def build_operator_rag_release_status(
    candidate: RagReleaseCandidate,
) -> dict[str, str]:
    return {
        "documentSiteStatus": candidate.documentSiteStatus,
        "ragPreparationStatus": candidate.ragPreparationStatus,
        "ragIndexStatus": candidate.ragIndexStatus,
        "ragServingStatus": candidate.ragServingStatus,
        "ragVerificationStatus": candidate.ragVerificationStatus,
    }


def build_registry_scope_rag_release_executor(
    *,
    prepare_registry_scope_chunks: Callable[..., object] | None = None,
    release_registry_scope: Callable[..., object] | None = None,
    acceptance_case_path: str | None = None,
    release_admission_manifest_key: str | None = None,
    env: Mapping[str, str] | None = None,
    publish_alias: bool = True,
    reset_index: bool = False,
) -> Callable[[RagReleaseCandidate], RagReleaseExecutionResult]:
    source = dict(env if env is not None else os.environ)
    if prepare_registry_scope_chunks is None:
        from campus_ingestion_core.registry_scope_chunk_preparation import (
            prepare_registry_scope_chunks as runtime_prepare_registry_scope_chunks,
        )

        prepare_registry_scope_chunks = runtime_prepare_registry_scope_chunks
    if release_registry_scope is None:
        from campus_ingestion_core.registry_scope_release import (
            release_registry_scope as runtime_release_registry_scope,
        )

        release_registry_scope = runtime_release_registry_scope

    def execute(candidate: RagReleaseCandidate) -> RagReleaseExecutionResult:
        try:
            resolved_admission_manifest_key = require_regulation_rag_release_admission_key(
                corpus=candidate.corpus,
                collection=candidate.collection,
                runtime_profile=load_runtime_profile(candidate.corpus, candidate.collection),
                publish_alias=publish_alias,
                explicit_key=release_admission_manifest_key,
                env=source,
            )
        except RegulationRagReleaseAdmissionError as exc:
            return RagReleaseExecutionResult(
                status="release_admission_blocked",
                verification_status="failed",
                message=str(exc),
            )
        prepare_registry_scope_chunks(
            corpus=candidate.corpus,
            collection=candidate.collection,
            preparation_run_id=candidate.candidate_id,
            require_current_cleaning_provenance=True,
        )
        release_report = release_registry_scope(
            corpus=candidate.corpus,
            collection=candidate.collection,
            preparation_run_id=candidate.candidate_id,
            acceptance_case_path=acceptance_case_path,
            release_admission_manifest_key=resolved_admission_manifest_key,
            reset_index=reset_index,
            publish_alias=publish_alias,
        )
        release_id = _optional_attr(release_report, "release_id")
        retrieval_acceptance_status = _optional_attr(
            release_report,
            "retrieval_acceptance_status",
        )
        post_publish_audit_status = _optional_attr(
            release_report,
            "post_publish_audit_status",
        )
        if retrieval_acceptance_status in {"failed", "rejected"}:
            return RagReleaseExecutionResult(
                status="acceptance_failed",
                release_id=release_id,
                verification_status="failed",
                message=f"retrieval acceptance {retrieval_acceptance_status}",
            )
        if post_publish_audit_status in {"failed", "rejected"}:
            return RagReleaseExecutionResult(
                status="verification_failed",
                release_id=release_id,
                verification_status="failed",
                message=f"post-publish audit {post_publish_audit_status}",
            )
        return RagReleaseExecutionResult(
            status="passed",
            release_id=release_id,
            verification_status="passed",
            release_admission_status=_optional_attr(release_report, "release_admission_status")
            or "",
            release_admission_manifest_key=_optional_attr(
                release_report,
                "release_admission_manifest_key",
            ),
        )

    return execute


def build_regulation_rag_release_candidate_store_from_env(
    env: Mapping[str, str] | None = None,
    *,
    prefer_operator: bool = False,
    table_name: str = DEFAULT_REGULATION_RAG_RELEASE_CANDIDATE_TABLE,
) -> RegulationRagReleaseCandidateStore:
    source = dict(env if env is not None else os.environ)
    database_url = _resolve_candidate_store_database_url(source, prefer_operator=prefer_operator)
    return PostgresRegulationRagReleaseCandidateStore(database_url, table_name=table_name)


def _process_with_release_executor(
    *,
    candidate: RagReleaseCandidate,
    release_executor: Callable[[RagReleaseCandidate], RagReleaseExecutionResult],
    updated_at: str,
) -> RagReleaseCandidate:
    preparing = _with_status(
        candidate,
        status="preparing",
        updated_at=updated_at,
        rag_preparation_status="preparing",
    )
    try:
        result = release_executor(preparing)
    except RegulationRagReleaseAdmissionError as exc:
        return _with_status(
            preparing,
            status="release_admission_blocked",
            updated_at=updated_at,
            rag_preparation_status="blocked",
            rag_index_status="not_applicable",
            rag_serving_status="not_serving",
            rag_verification_status="not_applicable",
            message=str(exc),
        )
    except Exception as exc:
        return _with_status(
            preparing,
            status="preparation_failed",
            updated_at=updated_at,
            rag_preparation_status="failed",
            rag_index_status="not_applicable",
            rag_serving_status="not_serving",
            rag_verification_status="failed",
            message=str(exc),
        )
    return _candidate_with_release_result(
        preparing=preparing,
        result=result,
        updated_at=updated_at,
    )


def _copy_release_terminal_status(
    *,
    candidate: RagReleaseCandidate,
    released: RagReleaseCandidate,
    updated_at: str,
) -> RagReleaseCandidate:
    return replace(
        candidate,
        status=released.status,
        cleanup_disposition=released.cleanup_disposition,
        updated_at=updated_at,
        ragPreparationStatus=released.ragPreparationStatus,
        ragIndexStatus=released.ragIndexStatus,
        ragServingStatus=released.ragServingStatus,
        ragVerificationStatus=released.ragVerificationStatus,
        last_release_id=released.last_release_id,
        message=released.message,
    )


def _candidate_with_release_result(
    *,
    preparing: RagReleaseCandidate,
    result: RagReleaseExecutionResult,
    updated_at: str,
) -> RagReleaseCandidate:
    if result.status == "passed":
        if _candidate_requires_release_admission(preparing) and (
            result.release_admission_status != "passed"
            or not (result.release_admission_manifest_key or "").strip()
        ):
            return _with_status(
                preparing,
                status="release_admission_blocked",
                updated_at=updated_at,
                rag_preparation_status="blocked",
                rag_index_status="not_applicable",
                rag_serving_status="not_serving",
                rag_verification_status="not_applicable",
                message="release admission manifest proof is required before serving publication",
            )
        return _with_status(
            preparing,
            status="serving_published",
            updated_at=updated_at,
            rag_preparation_status="completed",
            rag_index_status="indexed",
            rag_serving_status="serving_published",
            rag_verification_status=result.verification_status or "passed",
            last_release_id=result.release_id,
            message=result.message,
        )
    if result.status == "acceptance_failed":
        return _with_status(
            preparing,
            status="acceptance_failed",
            updated_at=updated_at,
            rag_preparation_status="completed",
            rag_index_status="indexed",
            rag_serving_status="not_serving",
            rag_verification_status="failed",
            last_release_id=result.release_id,
            message=result.message,
        )
    if result.status == "release_admission_blocked":
        return _with_status(
            preparing,
            status="release_admission_blocked",
            updated_at=updated_at,
            rag_preparation_status="blocked",
            rag_index_status="not_applicable",
            rag_serving_status="not_serving",
            rag_verification_status="not_applicable",
            message=result.message,
        )
    return _with_status(
        preparing,
        status="verification_failed",
        updated_at=updated_at,
        rag_preparation_status="completed",
        rag_index_status="indexed",
        rag_serving_status="not_serving",
        rag_verification_status="failed",
        last_release_id=result.release_id,
        message=result.message,
    )


def _terminal_without_release(
    candidate: RagReleaseCandidate,
    *,
    updated_at: str,
) -> RagReleaseCandidate | None:
    if candidate.document_status in {"withdrawn", "deleted"}:
        return _with_status(
            candidate,
            status="deleted",
            updated_at=updated_at,
            cleanup_disposition="delete_current_alias_points",
            rag_preparation_status="not_applicable",
            rag_index_status="delete_planned",
            rag_serving_status="not_serving",
            rag_verification_status="not_applicable",
        )
    if not candidate.is_current:
        return _with_status(
            candidate,
            status="held_search_only",
            updated_at=updated_at,
            rag_preparation_status="not_applicable",
            rag_index_status="not_applicable",
            rag_serving_status="not_serving",
            rag_verification_status="not_applicable",
        )
    if not candidate.retrieval_enabled:
        return _with_status(
            candidate,
            status="profile_disabled",
            updated_at=updated_at,
            rag_preparation_status="not_applicable",
            rag_index_status="not_applicable",
            rag_serving_status="not_serving",
            rag_verification_status="not_applicable",
        )
    if not candidate.query_enabled_by_default:
        return _with_status(
            candidate,
            status="not_query_enabled",
            updated_at=updated_at,
            rag_preparation_status="not_applicable",
            rag_index_status="not_applicable",
            rag_serving_status="not_serving",
            rag_verification_status="not_applicable",
        )
    return None


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
            or (
                source.get(DEFAULT_REGULATION_RAG_RELEASE_CANDIDATE_MANAGEMENT_ENV_KEY) or ""
            ).strip()
            or (source.get(SHARED_POSTGRES_OPERATOR_ENV_KEY) or "").strip()
            or (source.get(SHARED_POSTGRES_MANAGEMENT_ENV_KEY) or "").strip()
        )
        if not operator_url:
            raise ValueError(
                f"{DEFAULT_REGULATION_RAG_RELEASE_CANDIDATE_OPERATOR_ENV_KEY} or "
                f"{DEFAULT_REGULATION_RAG_RELEASE_CANDIDATE_MANAGEMENT_ENV_KEY} or "
                f"{SHARED_POSTGRES_OPERATOR_ENV_KEY} or {SHARED_POSTGRES_MANAGEMENT_ENV_KEY} "
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


__all__ = [
    "REGULATION_RAG_RELEASE_ELIGIBLE_COLLECTIONS",
    "InMemoryRegulationRagReleaseCandidateStore",
    "PostgresRegulationRagReleaseCandidateStore",
    "RagReleaseCandidate",
    "RagReleaseCandidateEnqueueReport",
    "RagReleaseCandidateProcessReport",
    "RagReleaseCandidateStatus",
    "RagReleaseExecutionResult",
    "RegulationRagReleaseCandidateStore",
    "build_operator_rag_release_status",
    "build_registry_scope_rag_release_executor",
    "build_regulation_rag_release_candidate_store_from_env",
    "enqueue_regulation_rag_release_candidates_for_records",
    "enqueue_regulation_rag_release_candidates_for_registry_delta",
    "process_pending_regulation_rag_release_candidates",
]
