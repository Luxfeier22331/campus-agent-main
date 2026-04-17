from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from enum import Enum
import hashlib
from typing import Any, Sequence

from campus_ingestion_core.authenticated_notice_defaults import (
    DEFAULT_AUTHENTICATED_NOTICE_COLLECTION,
    DEFAULT_AUTHENTICATED_NOTICE_CORPUS,
    DEFAULT_AUTHENTICATED_NOTICE_EMBEDDING_MODEL,
    DEFAULT_AUTHENTICATED_NOTICE_ENTITLEMENT_GROUPS,
    DEFAULT_AUTHENTICATED_NOTICE_IMPORT_SOURCE,
    DEFAULT_AUTHENTICATED_NOTICE_PARSER_VERSION,
    DEFAULT_AUTHENTICATED_NOTICE_VISIBILITY_SCOPE,
)


DEFAULT_CLOSEOUT_OPERATION = "authenticated-notice-closeout"
DEFAULT_CLOSEOUT_INPUT_KIND = "bundle_import"
DEFAULT_CLOSEOUT_SHARD_SIZE = 250
DEFAULT_CLOSEOUT_BATCH_SIZE = 16
DEFAULT_CLOSEOUT_MAX_CONCURRENCY = 8
DEFAULT_CLOSEOUT_NOTICE_CONCURRENCY = 8
DEFAULT_CLOSEOUT_OBJECT_STORE_CONCURRENCY = 64
DEFAULT_CLOSEOUT_LEASE_SECONDS = 300


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def utc_now_dt() -> datetime:
    return datetime.now(timezone.utc)


def lease_expires_at(lease_seconds: int) -> str:
    return (utc_now_dt() + timedelta(seconds=lease_seconds)).isoformat()


def parse_optional_timestamp(value: str | None) -> datetime | None:
    if not value:
        return None
    return datetime.fromisoformat(value)


def coerce_non_negative(value: int) -> int:
    return max(0, int(value))


class CloseoutRunState(str, Enum):
    PLANNING = "planning"
    PLANNED = "planned"
    RUNNING = "running"
    VERIFYING = "verifying"
    VERIFIED = "verified"
    PROMOTING = "promoting"
    DONE = "done"
    FAILED = "failed"


class CloseoutShardState(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class CloseoutBatchState(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class CloseoutWorkerState(str, Enum):
    IDLE = "idle"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


class CloseoutPromotionBatchState(str, Enum):
    PENDING = "pending"
    RUNNING = "running"
    DONE = "done"
    FAILED = "failed"


@dataclass(frozen=True, slots=True)
class CloseoutRun:
    run_id: str
    bundle_path: str
    manifest_path: str | None
    expected_notice_count: int
    operations_prefix: str
    selected_notice_ids: tuple[str, ...] = ()
    input_kind: str = DEFAULT_CLOSEOUT_INPUT_KIND
    notice_risk_counts: dict[str, int] = field(default_factory=dict)
    high_risk_notice_count: int = 0
    expected_document_count: int = 0
    expected_attachment_document_count: int = 0
    expected_ocr_candidate_count: int = 0
    expected_raw_asset_count: int = 0
    source_projections_path: str | None = None
    corpus: str = DEFAULT_AUTHENTICATED_NOTICE_CORPUS
    collection: str = DEFAULT_AUTHENTICATED_NOTICE_COLLECTION
    site_id: str = ""
    source_home_url: str = ""
    default_entitlement_groups: tuple[str, ...] = (
        DEFAULT_AUTHENTICATED_NOTICE_ENTITLEMENT_GROUPS
    )
    visibility_scope: str | None = DEFAULT_AUTHENTICATED_NOTICE_VISIBILITY_SCOPE
    parser_version: str = DEFAULT_AUTHENTICATED_NOTICE_PARSER_VERSION
    embedding_model: str = DEFAULT_AUTHENTICATED_NOTICE_EMBEDDING_MODEL
    import_source: str = DEFAULT_AUTHENTICATED_NOTICE_IMPORT_SOURCE
    export_manifest_object_key: str | None = None
    source_truth_inventory_object_key: str | None = None
    shard_size: int = DEFAULT_CLOSEOUT_SHARD_SIZE
    batch_size: int = DEFAULT_CLOSEOUT_BATCH_SIZE
    max_concurrency: int = DEFAULT_CLOSEOUT_MAX_CONCURRENCY
    notice_concurrency: int = DEFAULT_CLOSEOUT_NOTICE_CONCURRENCY
    object_store_concurrency: int = DEFAULT_CLOSEOUT_OBJECT_STORE_CONCURRENCY
    lease_seconds: int = DEFAULT_CLOSEOUT_LEASE_SECONDS
    state: CloseoutRunState = CloseoutRunState.PLANNING
    shard_count: int = 0
    completed_shard_count: int = 0
    failed_shard_count: int = 0
    batch_count: int = 0
    completed_batch_count: int = 0
    running_batch_count: int = 0
    pending_batch_count: int = 0
    active_worker_count: int = 0
    processed_notice_count: int = 0
    staged_notice_count: int = 0
    staged_raw_asset_count: int = 0
    staged_document_count: int = 0
    created_at: str = field(default_factory=utc_now)
    planned_at: str | None = None
    started_at: str | None = None
    finished_at: str | None = None
    verification: dict[str, Any] = field(default_factory=dict)
    promotion: dict[str, Any] = field(default_factory=dict)
    failure_reason: str | None = None

    def with_progress(
        self,
        *,
        staged_notice_delta: int = 0,
        staged_raw_asset_delta: int = 0,
        staged_document_delta: int = 0,
        completed_batch_delta: int = 0,
        running_batch_delta: int = 0,
        pending_batch_delta: int = 0,
        processed_notice_delta: int = 0,
        completed_shard_delta: int = 0,
        failed_shard_delta: int = 0,
        active_worker_count: int | None = None,
    ) -> CloseoutRun:
        return replace(
            self,
            staged_notice_count=coerce_non_negative(
                self.staged_notice_count + staged_notice_delta
            ),
            staged_raw_asset_count=coerce_non_negative(
                self.staged_raw_asset_count + staged_raw_asset_delta
            ),
            staged_document_count=coerce_non_negative(
                self.staged_document_count + staged_document_delta
            ),
            completed_batch_count=coerce_non_negative(
                self.completed_batch_count + completed_batch_delta
            ),
            running_batch_count=coerce_non_negative(
                self.running_batch_count + running_batch_delta
            ),
            pending_batch_count=coerce_non_negative(
                self.pending_batch_count + pending_batch_delta
            ),
            processed_notice_count=coerce_non_negative(
                self.processed_notice_count + processed_notice_delta
            ),
            completed_shard_count=coerce_non_negative(
                self.completed_shard_count + completed_shard_delta
            ),
            failed_shard_count=coerce_non_negative(
                self.failed_shard_count + failed_shard_delta
            ),
            active_worker_count=(
                self.active_worker_count
                if active_worker_count is None
                else coerce_non_negative(active_worker_count)
            ),
        )

    def mark_planned(self) -> CloseoutRun:
        return replace(
            self,
            state=CloseoutRunState.PLANNED,
            planned_at=self.planned_at or utc_now(),
            failure_reason=None,
        )

    def mark_running(self) -> CloseoutRun:
        timestamp = utc_now()
        return replace(
            self,
            state=CloseoutRunState.RUNNING,
            started_at=self.started_at or timestamp,
            failure_reason=None,
        )

    def mark_verifying(self) -> CloseoutRun:
        return replace(
            self,
            state=CloseoutRunState.VERIFYING,
            active_worker_count=0,
            failure_reason=None,
        )

    def mark_verified(self, verification: dict[str, Any]) -> CloseoutRun:
        return replace(
            self,
            state=CloseoutRunState.VERIFIED,
            verification=dict(verification),
            running_batch_count=0,
            pending_batch_count=0,
            active_worker_count=0,
            failure_reason=None,
        )

    def with_promotion(self, promotion: dict[str, Any]) -> CloseoutRun:
        return replace(self, promotion=dict(promotion))

    def mark_promoting(self, promotion: dict[str, Any] | None = None) -> CloseoutRun:
        return replace(
            self,
            state=CloseoutRunState.PROMOTING,
            promotion=dict(self.promotion if promotion is None else promotion),
            active_worker_count=0,
            failure_reason=None,
        )

    def complete(self, promotion: dict[str, Any]) -> CloseoutRun:
        return replace(
            self,
            state=CloseoutRunState.DONE,
            promotion=dict(promotion),
            running_batch_count=0,
            pending_batch_count=0,
            active_worker_count=0,
            finished_at=utc_now(),
            failure_reason=None,
        )

    def fail(self, reason: str) -> CloseoutRun:
        return replace(
            self,
            state=CloseoutRunState.FAILED,
            running_batch_count=0,
            active_worker_count=0,
            finished_at=utc_now(),
            failure_reason=reason,
        )

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> CloseoutRun:
        raw = dict(payload)
        raw["state"] = CloseoutRunState(
            str(raw.get("state") or CloseoutRunState.PLANNING.value)
        )
        raw["selected_notice_ids"] = tuple(
            str(item) for item in raw.get("selected_notice_ids") or ()
        )
        raw["default_entitlement_groups"] = tuple(
            str(item) for item in raw.get("default_entitlement_groups") or ()
        )
        raw["notice_risk_counts"] = dict(raw.get("notice_risk_counts") or {})
        raw["verification"] = dict(raw.get("verification") or {})
        raw["promotion"] = dict(raw.get("promotion") or {})
        return cls(**raw)


@dataclass(frozen=True, slots=True)
class CloseoutShard:
    shard_id: int
    notice_ids: tuple[str, ...]
    batch_ids: tuple[int, ...] = ()
    batch_count: int = 0
    state: CloseoutShardState = CloseoutShardState.PENDING
    attempt: int = 0
    processed_notice_count: int = 0
    staged_notice_count: int = 0
    completed_batch_count: int = 0
    started_at: str | None = None
    heartbeat_at: str | None = None
    finished_at: str | None = None
    error: str | None = None

    def with_batches(self, batch_ids: Sequence[int]) -> CloseoutShard:
        normalized = tuple(int(item) for item in batch_ids)
        return replace(self, batch_ids=normalized, batch_count=len(normalized))

    def mark_running(self) -> CloseoutShard:
        timestamp = utc_now()
        if self.state == CloseoutShardState.RUNNING:
            return replace(self, heartbeat_at=timestamp, error=None)
        return replace(
            self,
            state=CloseoutShardState.RUNNING,
            attempt=self.attempt + 1,
            started_at=self.started_at or timestamp,
            heartbeat_at=timestamp,
            error=None,
        )

    def complete_batch(
        self,
        *,
        processed_notice_count: int,
        staged_notice_count: int,
    ) -> CloseoutShard:
        timestamp = utc_now()
        completed_batch_count = self.completed_batch_count + 1
        next_state = (
            CloseoutShardState.DONE
            if completed_batch_count >= self.batch_count
            else CloseoutShardState.RUNNING
        )
        return replace(
            self,
            state=next_state,
            processed_notice_count=self.processed_notice_count + processed_notice_count,
            staged_notice_count=self.staged_notice_count + staged_notice_count,
            completed_batch_count=completed_batch_count,
            heartbeat_at=timestamp,
            finished_at=timestamp if next_state == CloseoutShardState.DONE else None,
            error=None,
        )

    def fail(self, error: str) -> CloseoutShard:
        timestamp = utc_now()
        return replace(
            self,
            state=CloseoutShardState.FAILED,
            heartbeat_at=timestamp,
            finished_at=timestamp,
            error=error,
        )

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> CloseoutShard:
        raw = dict(payload)
        raw["state"] = CloseoutShardState(
            str(raw.get("state") or CloseoutShardState.PENDING.value)
        )
        raw["notice_ids"] = tuple(str(item) for item in raw.get("notice_ids") or ())
        raw["batch_ids"] = tuple(int(item) for item in raw.get("batch_ids") or ())
        return cls(**raw)


@dataclass(frozen=True, slots=True)
class CloseoutBatch:
    batch_id: int
    shard_id: int
    notice_ids: tuple[str, ...]
    input_object_key: str | None = None
    input_sha256: str | None = None
    state: CloseoutBatchState = CloseoutBatchState.PENDING
    worker_id: str | None = None
    attempt: int = 0
    processed_notice_count: int = 0
    staged_notice_count: int = 0
    staged_raw_asset_count: int = 0
    staged_document_count: int = 0
    started_at: str | None = None
    heartbeat_at: str | None = None
    lease_expires_at: str | None = None
    finished_at: str | None = None
    error: str | None = None

    def claim(self, *, worker_id: str, lease_seconds: int) -> CloseoutBatch:
        timestamp = utc_now()
        return replace(
            self,
            state=CloseoutBatchState.RUNNING,
            worker_id=worker_id,
            attempt=self.attempt + 1,
            started_at=self.started_at or timestamp,
            heartbeat_at=timestamp,
            lease_expires_at=lease_expires_at(lease_seconds),
            finished_at=None,
            error=None,
        )

    def complete(
        self,
        *,
        staged_notice_count: int,
        staged_raw_asset_count: int,
        staged_document_count: int,
    ) -> CloseoutBatch:
        timestamp = utc_now()
        return replace(
            self,
            state=CloseoutBatchState.DONE,
            processed_notice_count=len(self.notice_ids),
            staged_notice_count=staged_notice_count,
            staged_raw_asset_count=staged_raw_asset_count,
            staged_document_count=staged_document_count,
            heartbeat_at=timestamp,
            lease_expires_at=None,
            finished_at=timestamp,
            error=None,
        )

    def fail(self, error: str) -> CloseoutBatch:
        timestamp = utc_now()
        return replace(
            self,
            state=CloseoutBatchState.FAILED,
            heartbeat_at=timestamp,
            lease_expires_at=None,
            finished_at=timestamp,
            error=error,
        )

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> CloseoutBatch:
        raw = dict(payload)
        raw["state"] = CloseoutBatchState(
            str(raw.get("state") or CloseoutBatchState.PENDING.value)
        )
        raw["notice_ids"] = tuple(str(item) for item in raw.get("notice_ids") or ())
        return cls(**raw)


@dataclass(frozen=True, slots=True)
class CloseoutWorker:
    worker_id: str
    state: CloseoutWorkerState = CloseoutWorkerState.IDLE
    active_batch_count: int = 0
    completed_batch_count: int = 0
    failed_batch_count: int = 0
    current_batch_ids: tuple[int, ...] = ()
    started_at: str = field(default_factory=utc_now)
    heartbeat_at: str | None = None
    last_progress_at: str | None = None
    error: str | None = None

    def claim_batch(self, batch_id: int) -> CloseoutWorker:
        timestamp = utc_now()
        current_batch_ids = tuple(sorted((*self.current_batch_ids, int(batch_id))))
        return replace(
            self,
            state=CloseoutWorkerState.RUNNING,
            active_batch_count=len(current_batch_ids),
            current_batch_ids=current_batch_ids,
            heartbeat_at=timestamp,
            last_progress_at=timestamp,
            error=None,
        )

    def complete_batch(self, batch_id: int) -> CloseoutWorker:
        timestamp = utc_now()
        current_batch_ids = tuple(
            item for item in self.current_batch_ids if item != int(batch_id)
        )
        return replace(
            self,
            state=(
                CloseoutWorkerState.IDLE
                if not current_batch_ids
                else CloseoutWorkerState.RUNNING
            ),
            active_batch_count=len(current_batch_ids),
            completed_batch_count=self.completed_batch_count + 1,
            current_batch_ids=current_batch_ids,
            heartbeat_at=timestamp,
            last_progress_at=timestamp,
            error=None,
        )

    def fail_batch(self, batch_id: int, error: str) -> CloseoutWorker:
        timestamp = utc_now()
        current_batch_ids = tuple(
            item for item in self.current_batch_ids if item != int(batch_id)
        )
        return replace(
            self,
            state=CloseoutWorkerState.FAILED,
            active_batch_count=len(current_batch_ids),
            failed_batch_count=self.failed_batch_count + 1,
            current_batch_ids=current_batch_ids,
            heartbeat_at=timestamp,
            last_progress_at=timestamp,
            error=error,
        )

    def finish(self) -> CloseoutWorker:
        if self.state == CloseoutWorkerState.FAILED:
            return replace(self, active_batch_count=0, current_batch_ids=())
        timestamp = utc_now()
        return replace(
            self,
            state=CloseoutWorkerState.DONE,
            active_batch_count=0,
            current_batch_ids=(),
            heartbeat_at=timestamp,
            last_progress_at=timestamp,
            error=None,
        )

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> CloseoutWorker:
        raw = dict(payload)
        raw["state"] = CloseoutWorkerState(
            str(raw.get("state") or CloseoutWorkerState.IDLE.value)
        )
        raw["current_batch_ids"] = tuple(
            int(item) for item in raw.get("current_batch_ids") or ()
        )
        return cls(**raw)


@dataclass(frozen=True, slots=True)
class CloseoutPromotionBatch:
    promotion_id: str
    batch_id: int
    document_refs: tuple[tuple[str, str, str], ...]
    state: CloseoutPromotionBatchState = CloseoutPromotionBatchState.PENDING
    attempt: int = 0
    copied_document_count: int = 0
    copied_object_count: int = 0
    started_at: str | None = None
    heartbeat_at: str | None = None
    finished_at: str | None = None
    error: str | None = None

    def mark_running(self) -> CloseoutPromotionBatch:
        timestamp = utc_now()
        return replace(
            self,
            state=CloseoutPromotionBatchState.RUNNING,
            attempt=self.attempt + 1,
            started_at=self.started_at or timestamp,
            heartbeat_at=timestamp,
            finished_at=None,
            error=None,
        )

    def complete(
        self,
        *,
        copied_document_count: int,
        copied_object_count: int,
    ) -> CloseoutPromotionBatch:
        timestamp = utc_now()
        return replace(
            self,
            state=CloseoutPromotionBatchState.DONE,
            copied_document_count=copied_document_count,
            copied_object_count=copied_object_count,
            heartbeat_at=timestamp,
            finished_at=timestamp,
            error=None,
        )

    def fail(self, error: str) -> CloseoutPromotionBatch:
        timestamp = utc_now()
        return replace(
            self,
            state=CloseoutPromotionBatchState.FAILED,
            heartbeat_at=timestamp,
            finished_at=timestamp,
            error=error,
        )

    @classmethod
    def from_dict(cls, payload: dict[str, Any]) -> CloseoutPromotionBatch:
        raw = dict(payload)
        raw["state"] = CloseoutPromotionBatchState(
            str(raw.get("state") or CloseoutPromotionBatchState.PENDING.value)
        )
        raw["document_refs"] = tuple(
            tuple(str(part) for part in item)
            for item in raw.get("document_refs") or ()
        )
        return cls(**raw)


def attach_batches_to_shards(
    shards: Sequence[CloseoutShard],
    batches: Sequence[CloseoutBatch],
) -> tuple[CloseoutShard, ...]:
    batch_ids_by_shard: dict[int, list[int]] = {shard.shard_id: [] for shard in shards}
    for batch in batches:
        batch_ids_by_shard.setdefault(batch.shard_id, []).append(batch.batch_id)
    return tuple(
        shard.with_batches(batch_ids_by_shard.get(shard.shard_id, ()))
        for shard in shards
    )


def batch_lease_expired(batch: CloseoutBatch) -> bool:
    if batch.state != CloseoutBatchState.RUNNING:
        return False
    expiry = parse_optional_timestamp(batch.lease_expires_at)
    if expiry is None:
        return True
    return expiry <= utc_now_dt()


def batch_segment(batch_id: int) -> str:
    return f"{int(batch_id):06d}"


def document_stage_slug(document_id: str) -> str:
    return hashlib.sha256(document_id.encode("utf-8")).hexdigest()[:16]


__all__ = [
    "DEFAULT_CLOSEOUT_BATCH_SIZE",
    "DEFAULT_CLOSEOUT_INPUT_KIND",
    "DEFAULT_CLOSEOUT_LEASE_SECONDS",
    "DEFAULT_CLOSEOUT_MAX_CONCURRENCY",
    "DEFAULT_CLOSEOUT_NOTICE_CONCURRENCY",
    "DEFAULT_CLOSEOUT_OBJECT_STORE_CONCURRENCY",
    "DEFAULT_CLOSEOUT_OPERATION",
    "DEFAULT_CLOSEOUT_SHARD_SIZE",
    "CloseoutBatch",
    "CloseoutBatchState",
    "CloseoutRun",
    "CloseoutRunState",
    "CloseoutShard",
    "CloseoutShardState",
    "CloseoutWorker",
    "CloseoutWorkerState",
    "attach_batches_to_shards",
    "batch_lease_expired",
    "batch_segment",
    "coerce_non_negative",
    "document_stage_slug",
    "lease_expires_at",
    "parse_optional_timestamp",
    "utc_now",
    "utc_now_dt",
]
