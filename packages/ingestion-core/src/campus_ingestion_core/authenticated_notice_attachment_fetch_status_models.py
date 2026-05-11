from __future__ import annotations

import hashlib
from dataclasses import asdict, dataclass, field, fields
from datetime import UTC, datetime
from typing import Any

DEFAULT_ATTACHMENT_FETCH_STATUS_SCHEMA = "ingestion_projection"
DEFAULT_ATTACHMENT_FETCH_STATUS_TABLE = (
    f"{DEFAULT_ATTACHMENT_FETCH_STATUS_SCHEMA}.authenticated_notice_attachment_fetch_status"
)
DEFAULT_ATTACHMENT_FETCH_STATUS_ENV_KEY = (
    "AUTHENTICATED_NOTICE_ATTACHMENT_FETCH_STATUS_DATABASE_URL"
)
DEFAULT_ATTACHMENT_FETCH_STATUS_OPERATOR_ENV_KEY = (
    "AUTHENTICATED_NOTICE_ATTACHMENT_FETCH_STATUS_OPERATOR_DATABASE_URL"
)

FETCH_STATUS_COLLECTED_INTERNAL = "collected_internal"
FETCH_STATUS_REFERENCE_ONLY = "reference_only"
FETCH_STATUS_TERMINAL_UNAVAILABLE = "terminal_unavailable"
FETCH_STATUS_TRANSIENT_FAILED = "transient_failed"
TERMINAL_REASON_HTTP_404 = "http_404"
TERMINAL_REASON_HTTP_410 = "http_410"
TERMINAL_REASON_PORTAL_FILE_MISSING = "portal_file_missing"

_FETCH_STATUSES = frozenset(
    {
        FETCH_STATUS_COLLECTED_INTERNAL,
        FETCH_STATUS_REFERENCE_ONLY,
        FETCH_STATUS_TERMINAL_UNAVAILABLE,
        FETCH_STATUS_TRANSIENT_FAILED,
    }
)
_TERMINAL_REASONS = frozenset(
    {
        TERMINAL_REASON_HTTP_404,
        TERMINAL_REASON_HTTP_410,
        TERMINAL_REASON_PORTAL_FILE_MISSING,
    }
)


def build_attachment_source_url_hash(source_url: str) -> str:
    return hashlib.sha256(str(source_url).strip().encode("utf-8")).hexdigest()


def _utc_now() -> str:
    return datetime.now(UTC).isoformat()


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeAttachmentFetchStatusRecord:
    site_id: str
    notice_id: str
    attachment_ref_id: str
    source_url: str
    source_url_hash: str
    fetch_status: str
    portal_attachment_id: str | None = None
    filename: str | None = None
    terminal_reason: str | None = None
    last_http_status: int | None = None
    last_error: str | None = None
    attempt_count: int = 0
    first_seen_at: str = field(default_factory=_utc_now)
    last_attempted_at: str | None = None
    next_retry_after: str | None = None
    object_key: str | None = None
    content_sha256: str | None = None
    updated_at: str = field(default_factory=_utc_now)

    def __post_init__(self) -> None:
        normalized = _normalize_status(self.fetch_status)
        object.__setattr__(self, "fetch_status", normalized)
        if self.terminal_reason is not None:
            reason = str(self.terminal_reason).strip()
            if reason not in _TERMINAL_REASONS:
                raise ValueError(f"unsupported terminal_reason: {self.terminal_reason!r}")
            object.__setattr__(self, "terminal_reason", reason)
        if normalized == FETCH_STATUS_TERMINAL_UNAVAILABLE and self.terminal_reason is None:
            raise ValueError("terminal_unavailable records require terminal_reason")
        if self.source_url_hash != build_attachment_source_url_hash(self.source_url):
            raise ValueError("source_url_hash does not match source_url")
        object.__setattr__(self, "attempt_count", max(0, int(self.attempt_count or 0)))

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> AuthenticatedNoticeAttachmentFetchStatusRecord:
        raw = dict(payload)
        raw["attempt_count"] = int(raw.get("attempt_count") or 0)
        if raw.get("last_http_status") is not None:
            raw["last_http_status"] = int(raw["last_http_status"])
        allowed = {item.name for item in fields(cls)}
        return cls(**{key: value for key, value in raw.items() if key in allowed})

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True, slots=True)
class AttachmentFetchStatusCoverageReport:
    source_notice_count: int
    source_attachment_ref_count: int
    fetch_status_record_count: int
    missing_fetch_status_attachment_refs: tuple[str, ...]
    extra_fetch_status_attachment_refs: tuple[str, ...]
    status_counts: dict[str, int]
    terminal_reason_counts: dict[str, int]


@dataclass(frozen=True, slots=True)
class ReferenceOnlyAttachmentExplanationRow:
    site_id: str
    notice_id: str
    attachment_ref_id: str
    reason: str
    action_required: bool
    resource_role: str | None = None
    content_kind: str | None = None
    mime_type: str | None = None
    object_key: str | None = None
    content_sha256: str | None = None
    source_url: str | None = None
    final_url: str | None = None
    fetch_status: str | None = None
    terminal_reason: str | None = None


@dataclass(frozen=True, slots=True)
class ReferenceOnlyAttachmentExplanationReport:
    source_notice_count: int
    source_attachment_ref_count: int
    reference_only_inventory_count: int
    reference_only_attachment_count: int
    action_required_count: int
    reason_counts: dict[str, int]
    rows: tuple[ReferenceOnlyAttachmentExplanationRow, ...]


@dataclass(frozen=True, slots=True)
class AttachmentOwnerExpectationMismatchRow:
    site_id: str
    notice_id: str
    owner_kind: str
    relation_type: str
    owner_title_hint: str | None = None
    evidence_text: str | None = None


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeLiveHistoricalReconcileReport:
    source_notice_count: int
    source_attachment_ref_count: int
    fetch_status_record_count: int
    missing_fetch_status_attachment_refs: tuple[str, ...]
    extra_fetch_status_attachment_refs: tuple[str, ...]
    status_counts: dict[str, int]
    terminal_reason_counts: dict[str, int]
    attachment_owner_expectation_mismatch_count: int
    attachment_owner_expectation_mismatches: tuple[AttachmentOwnerExpectationMismatchRow, ...]
    action_required_count: int


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeControlPlaneStatusReport:
    source_notice_count: int
    source_attachment_ref_count: int
    fetch_status_record_count: int
    missing_fetch_status_attachment_ref_count: int
    extra_fetch_status_attachment_ref_count: int
    reference_only_attachment_count: int
    reference_only_action_required_count: int
    reconcile_action_required_count: int
    unsupported_binary_count: int
    multimodal_processing_required_count: int
    notice_risk_counts: dict[str, int]
    action_required_count: int
    latest_collector_run: dict[str, Any] | None
    reconcile_report: AuthenticatedNoticeLiveHistoricalReconcileReport
    reference_only_report: ReferenceOnlyAttachmentExplanationReport


def _normalize_status(value: str) -> str:
    normalized = str(value).strip()
    if normalized not in _FETCH_STATUSES:
        raise ValueError(f"unsupported fetch_status: {value!r}")
    return normalized


__all__ = [
    "DEFAULT_ATTACHMENT_FETCH_STATUS_ENV_KEY",
    "DEFAULT_ATTACHMENT_FETCH_STATUS_OPERATOR_ENV_KEY",
    "DEFAULT_ATTACHMENT_FETCH_STATUS_SCHEMA",
    "DEFAULT_ATTACHMENT_FETCH_STATUS_TABLE",
    "FETCH_STATUS_COLLECTED_INTERNAL",
    "FETCH_STATUS_REFERENCE_ONLY",
    "FETCH_STATUS_TERMINAL_UNAVAILABLE",
    "FETCH_STATUS_TRANSIENT_FAILED",
    "TERMINAL_REASON_HTTP_404",
    "TERMINAL_REASON_HTTP_410",
    "TERMINAL_REASON_PORTAL_FILE_MISSING",
    "AttachmentFetchStatusCoverageReport",
    "AttachmentOwnerExpectationMismatchRow",
    "AuthenticatedNoticeAttachmentFetchStatusRecord",
    "AuthenticatedNoticeControlPlaneStatusReport",
    "AuthenticatedNoticeLiveHistoricalReconcileReport",
    "ReferenceOnlyAttachmentExplanationReport",
    "ReferenceOnlyAttachmentExplanationRow",
    "build_attachment_source_url_hash",
]
