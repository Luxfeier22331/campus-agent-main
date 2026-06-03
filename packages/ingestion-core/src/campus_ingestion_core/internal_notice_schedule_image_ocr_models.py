from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol

from campus_ingestion_core.internal_notice_schedule_image_ocr_constants import (
    ScheduleImageOcrAdmissionStatus,
    ScheduleImageOcrConfidence,
)


class ScheduleImageOcrSourceObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


class ScheduleImageOcrWritableObjectStore(ScheduleImageOcrSourceObjectStore, Protocol):
    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


class ScheduleImageOcrProvider(Protocol):
    def process(
        self, request: ScheduleImageOcrProviderRequest
    ) -> ScheduleImageOcrProviderResult: ...


class ScheduleImageOcrAttemptStore(Protocol):
    def record(self, attempt: ScheduleImageOcrAttempt) -> None: ...


@dataclass(frozen=True, slots=True)
class ScheduleImageOcrEvidence:
    notice_id: str
    notice_title: str
    release_time: str
    organization: str
    image_index: int
    attachment_ref_id: str
    filename: str
    mime_type: str
    byte_size: int
    sha256: str
    object_key: str
    image_use: str
    reason_codes: tuple[str, ...] = ()
    context_before: str = ""
    context_after: str = ""


@dataclass(frozen=True, slots=True)
class ScheduleImageOcrProviderRequest:
    evidence: ScheduleImageOcrEvidence
    image_bytes: bytes


@dataclass(frozen=True, slots=True)
class ScheduleImageOcrProviderResult:
    provider: str
    model: str
    confidence: ScheduleImageOcrConfidence
    extracted_text: str
    tables: tuple[tuple[tuple[str, ...], ...], ...] = ()
    layout_elements: tuple[Mapping[str, Any], ...] = ()
    raw_response: Mapping[str, Any] | Sequence[Any] | str | None = None


@dataclass(frozen=True, slots=True)
class ScheduleImageOcrArtifactKeys:
    provider_response_key: str
    layout_elements_key: str
    ocr_manifest_key: str


@dataclass(frozen=True, slots=True)
class ScheduleImageOcrAttempt:
    source_corpus: str
    source_collection: str
    source_notice_id: str
    attachment_ref_id: str
    image_index: int
    source_object_key: str
    source_sha256: str
    provider: str
    model: str
    status: str
    confidence: str
    provider_response_key: str
    layout_elements_key: str
    ocr_manifest_key: str
    admission_batch_id: str
    run_id: str
    attempt_number: int = 1
    created_at: str = ""
    error: str = ""


@dataclass(frozen=True, slots=True)
class ScheduleImageOcrSourceArtifactWriteReport:
    status: str
    keys: ScheduleImageOcrArtifactKeys


@dataclass(frozen=True, slots=True)
class ScheduleImageOcrDryRunItemReport:
    notice_id: str
    attachment_ref_id: str
    image_index: int
    status: str
    classification: str
    reason: str = ""


@dataclass(frozen=True, slots=True)
class ScheduleImageOcrDryRunReport:
    run_id: str
    notice_count: int
    image_count: int
    processed_count: int
    failed_count: int
    item_reports: tuple[ScheduleImageOcrDryRunItemReport, ...]


@dataclass(frozen=True, slots=True)
class ScheduleImageOcrChildDocument:
    document_id: str
    canonical_markdown: str
    document_units: tuple[dict[str, Any], ...]
    source_notice_id: str
    attachment_ref_id: str


@dataclass(frozen=True, slots=True)
class ScheduleImageOcrChildDocumentArtifactReport:
    document_id: str
    canonical_markdown_object_key: str
    document_units_object_key: str
    content_hash: str


@dataclass(frozen=True, slots=True)
class ScheduleImageOcrAdmissionDecision:
    status: ScheduleImageOcrAdmissionStatus
    reason: str
    document: ScheduleImageOcrChildDocument | None = None


@dataclass(frozen=True, slots=True)
class ScheduleImageOcrNoticeImageReview:
    notice_id: str
    attachment_ref_id: str
    image_index: int
    admission_status: str
    admission_reason: str
    image_role: str
    rationale: str


@dataclass(frozen=True, slots=True)
class ScheduleImageOcrNoticeReview:
    notice_id: str
    image_count: int
    admitted_schedule_image_count: int
    non_schedule_visual_count: int
    rejected_schedule_candidate_count: int
    body_schedule_candidate_count: int
    recommended_actions: tuple[str, ...]
    images: tuple[ScheduleImageOcrNoticeImageReview, ...]
