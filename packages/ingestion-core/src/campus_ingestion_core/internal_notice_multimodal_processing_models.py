from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from typing import Literal, Protocol

InternalNoticeMultimodalAction = Literal[
    "retain_for_notice_query",
    "no_adoption",
    "needs_additional_processing",
]
InternalNoticeMultimodalConfidence = Literal["high", "medium", "low"]


class InternalNoticeMultimodalObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


class InternalNoticeMultimodalProcessor(Protocol):
    def process(
        self,
        request: InternalNoticeMultimodalProcessingRequest,
    ) -> InternalNoticeMultimodalDecision: ...


class InternalNoticeMultimodalAttemptStore(Protocol):
    def record(self, attempt: InternalNoticeMultimodalAttempt) -> None: ...

    def list_by_unit(self, unit_id: str) -> tuple[InternalNoticeMultimodalAttempt, ...]: ...


@dataclass(frozen=True, slots=True)
class InternalNoticeMultimodalAttachment:
    attachment_ref_id: str
    filename: str
    mime_type: str
    object_key: str
    data: bytes


@dataclass(frozen=True, slots=True)
class InternalNoticeMultimodalProcessingRequest:
    source_notice_id: str
    unit_id: str
    notice_title: str
    primary_role: str
    reasons: tuple[str, ...]
    attachments: tuple[InternalNoticeMultimodalAttachment, ...]


@dataclass(frozen=True, slots=True)
class InternalNoticeMultimodalDecision:
    action: InternalNoticeMultimodalAction
    summary: str
    extracted_text: str
    reasons: tuple[str, ...]
    confidence: InternalNoticeMultimodalConfidence


@dataclass(frozen=True, slots=True)
class InternalNoticeMultimodalAttempt:
    source_corpus: str
    source_collection: str
    source_notice_id: str
    unit_id: str
    attempt_number: int
    admission_batch_id: str
    model: str
    decision_action: str
    status: str
    reasons: tuple[str, ...]
    error: str | None = None
    created_at: str = ""


@dataclass(frozen=True, slots=True)
class InternalNoticeMultimodalItemReport:
    source_notice_id: str
    unit_id: str
    action: str
    status: str
    reason: str | None = None


@dataclass(frozen=True, slots=True)
class InternalNoticeMultimodalProcessingReport:
    source_corpus: str
    source_collection: str
    selected_notice_ids: tuple[str, ...]
    projection_entry_count: int
    pending_entry_count: int
    processed_count: int
    retained_for_notice_query_count: int
    no_adoption_count: int
    still_pending_count: int
    failed_count: int
    item_reports: tuple[InternalNoticeMultimodalItemReport, ...]


@dataclass(frozen=True, slots=True)
class InternalNoticeMultimodalDrainReport:
    source_corpus: str
    source_collection: str
    selected_notice_ids: tuple[str, ...]
    pending_notice_ids: tuple[str, ...]
    scanned_projection_entry_count: int
    batch_count: int
    projection_entry_count: int
    pending_entry_count: int
    processed_count: int
    retained_for_notice_query_count: int
    no_adoption_count: int
    still_pending_count: int
    failed_count: int
    item_reports: tuple[InternalNoticeMultimodalItemReport, ...]


class InMemoryInternalNoticeMultimodalAttemptStore:
    def __init__(
        self,
        records: Sequence[InternalNoticeMultimodalAttempt] = (),
    ) -> None:
        self._records = list(records)

    def record(self, attempt: InternalNoticeMultimodalAttempt) -> None:
        self._records.append(attempt)

    def list_by_unit(self, unit_id: str) -> tuple[InternalNoticeMultimodalAttempt, ...]:
        return tuple(item for item in self._records if item.unit_id == unit_id)


__all__ = [
    "InMemoryInternalNoticeMultimodalAttemptStore",
    "InternalNoticeMultimodalAction",
    "InternalNoticeMultimodalAttachment",
    "InternalNoticeMultimodalAttempt",
    "InternalNoticeMultimodalAttemptStore",
    "InternalNoticeMultimodalConfidence",
    "InternalNoticeMultimodalDecision",
    "InternalNoticeMultimodalDrainReport",
    "InternalNoticeMultimodalItemReport",
    "InternalNoticeMultimodalObjectStore",
    "InternalNoticeMultimodalProcessingReport",
    "InternalNoticeMultimodalProcessingRequest",
    "InternalNoticeMultimodalProcessor",
]
