from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from typing import Any, Protocol

from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.wechat_public_notice_multimodal_constants import (
    WeChatPublicNoticeImageStatus,
    WeChatPublicNoticeMultimodalConfidence,
)


class WeChatPublicNoticeMultimodalObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


class WeChatPublicNoticeDocumentRegistry(Protocol):
    def list_versions(
        self,
        document_id: str,
        revision_track: str | None = None,
    ) -> tuple[DocumentRegistryRecord, ...]: ...

    def upsert_many(self, records: tuple[DocumentRegistryRecord, ...]) -> None: ...


class WeChatPublicNoticeMultimodalAttemptStore(Protocol):
    def record(self, attempt: WeChatPublicNoticeMultimodalAttempt) -> None: ...

    def list_by_image(
        self,
        *,
        source_corpus: str = "",
        source_collection: str = "",
        source_notice_id: str,
        media_ref_id: str,
    ) -> tuple[WeChatPublicNoticeMultimodalAttempt, ...]: ...


class WeChatPublicNoticeMultimodalProvider(Protocol):
    def process(
        self,
        request: WeChatPublicNoticeMultimodalProviderRequest,
    ) -> WeChatPublicNoticeMultimodalProviderResult: ...


@dataclass(frozen=True, slots=True)
class WeChatPublicNoticeInlineImageRef:
    media_ref_id: str
    ref_order: int
    source_url: str
    normalized_source_url: str
    capture_status: str = ""
    final_url: str = ""
    object_key: str = ""
    content_sha256: str = ""
    mime_type: str = ""
    byte_size: int = 0
    captured_at: str = ""
    fetch_error_message: str = ""


@dataclass(frozen=True, slots=True)
class WeChatPublicNoticeInlineImageArtifactKeys:
    base_prefix: str
    fetch_manifest_key: str
    ocr_manifest_key: str


@dataclass(frozen=True, slots=True)
class WeChatPublicNoticeInlineImageOutcome:
    media_ref_id: str
    source_url: str
    normalized_source_url: str
    status: WeChatPublicNoticeImageStatus
    fetch_manifest_key: str
    ocr_manifest_key: str
    image_object_key: str = ""
    summary: str = ""
    extracted_text: str = ""
    confidence: str = ""
    provider: str = ""
    model: str = ""
    provider_response_key: str = ""
    layout_elements_key: str = ""
    child_document_id: str = ""
    child_canonical_markdown_key: str = ""
    child_document_units_key: str = ""
    error: str = ""


@dataclass(frozen=True, slots=True)
class WeChatPublicNoticeFetchedInlineImage:
    content_type: str
    image_bytes: bytes
    final_url: str


@dataclass(frozen=True, slots=True)
class WeChatPublicNoticeMultimodalProviderRequest:
    source_notice_id: str
    notice_title: str
    article_source_url: str
    publish_time: str
    media_ref_id: str
    image_url: str
    image_bytes: bytes


@dataclass(frozen=True, slots=True)
class WeChatPublicNoticeMultimodalProviderResult:
    provider: str
    model: str
    confidence: WeChatPublicNoticeMultimodalConfidence
    has_meaningful_text: bool
    summary: str
    extracted_text: str
    layout_elements: tuple[Mapping[str, Any], ...] = ()
    raw_response: Mapping[str, Any] | Sequence[Any] | str | None = None


@dataclass(frozen=True, slots=True)
class WeChatPublicNoticeMultimodalAttempt:
    source_corpus: str
    source_collection: str
    source_notice_id: str
    unit_id: str
    media_ref_id: str
    attempt_number: int
    admission_batch_id: str
    status: str
    provider: str
    model: str
    fetch_manifest_key: str
    ocr_manifest_key: str
    provider_response_key: str
    layout_elements_key: str
    error: str = ""
    created_at: str = ""


class InMemoryWeChatPublicNoticeMultimodalAttemptStore:
    def __init__(
        self,
        records: Sequence[WeChatPublicNoticeMultimodalAttempt] = (),
    ) -> None:
        self._records = list(records)

    def record(self, attempt: WeChatPublicNoticeMultimodalAttempt) -> None:
        self._records.append(attempt)

    def list_by_image(
        self,
        *,
        source_corpus: str = "",
        source_collection: str = "",
        source_notice_id: str,
        media_ref_id: str,
    ) -> tuple[WeChatPublicNoticeMultimodalAttempt, ...]:
        return tuple(
            item
            for item in self._records
            if (not source_corpus or item.source_corpus == source_corpus)
            and (not source_collection or item.source_collection == source_collection)
            and item.source_notice_id == source_notice_id
            and item.media_ref_id == media_ref_id
        )


@dataclass(frozen=True, slots=True)
class WeChatPublicNoticeMultimodalItemReport:
    source_notice_id: str
    media_ref_id: str
    status: str
    attempt_number: int
    reason: str = ""


@dataclass(frozen=True, slots=True)
class WeChatPublicNoticeMultimodalProcessingReport:
    source_corpus: str
    source_collection: str
    selected_notice_ids: tuple[str, ...]
    pending_notice_ids: tuple[str, ...]
    projection_entry_count: int
    pending_entry_count: int
    scanned_image_count: int
    attempted_image_count: int
    admitted_count: int
    no_extractable_text_count: int
    terminal_failure_count: int
    still_pending_count: int
    item_reports: tuple[WeChatPublicNoticeMultimodalItemReport, ...]


@dataclass(frozen=True, slots=True)
class _ChildDocument:
    document_id: str
    canonical_markdown: str
    document_units: tuple[Mapping[str, Any], ...]
