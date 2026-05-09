from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

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
REGULATION_RAG_RELEASE_ELIGIBLE_COLLECTIONS = frozenset({"institutional_rules", "student_rules"})

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
    publish_alias: bool = True


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
