from __future__ import annotations

from typing import Literal

from campus_ingestion_core.authenticated_notice_closeout_models import utc_now
from campus_ingestion_core.wechat_public_notice_multimodal_models import (
    WeChatPublicNoticeMultimodalAttempt,
    WeChatPublicNoticeMultimodalAttemptStore,
    WeChatPublicNoticeMultimodalProviderResult,
)


def _classify_provider_result(
    result: WeChatPublicNoticeMultimodalProviderResult,
) -> Literal["admitted", "no_extractable_text"]:
    summary = result.summary.strip()
    extracted_text = result.extracted_text.strip()
    if not result.has_meaningful_text and not summary and not extracted_text:
        return "no_extractable_text"
    if extracted_text and result.confidence in {"high", "medium"}:
        return "admitted"
    if summary and result.confidence == "high":
        return "admitted"
    raise ValueError("low confidence OCR result requires retry")


def _record_attempt(
    *,
    attempt_store: WeChatPublicNoticeMultimodalAttemptStore | None,
    entry,
    media_ref_id: str,
    attempt_number: int,
    admission_batch_id: str,
    status: str,
    provider: str,
    model: str,
    fetch_manifest_key: str,
    ocr_manifest_key: str,
    provider_response_key: str,
    layout_elements_key: str,
    error: str,
) -> None:
    if attempt_store is None:
        return
    attempt_store.record(
        WeChatPublicNoticeMultimodalAttempt(
            source_corpus=entry.source_corpus,
            source_collection=entry.source_collection,
            source_notice_id=entry.source_notice_id,
            unit_id=entry.unit_id,
            media_ref_id=media_ref_id,
            attempt_number=attempt_number,
            admission_batch_id=admission_batch_id,
            status=status,
            provider=provider,
            model=model,
            fetch_manifest_key=fetch_manifest_key,
            ocr_manifest_key=ocr_manifest_key,
            provider_response_key=provider_response_key,
            layout_elements_key=layout_elements_key,
            error=error,
            created_at=utc_now(),
        )
    )


def _next_attempt_number(
    *,
    attempt_store: WeChatPublicNoticeMultimodalAttemptStore | None,
    source_corpus: str,
    source_collection: str,
    source_notice_id: str,
    media_ref_id: str,
) -> int:
    if attempt_store is None:
        return 1
    return (
        len(
            attempt_store.list_by_image(
                source_corpus=source_corpus,
                source_collection=source_collection,
                source_notice_id=source_notice_id,
                media_ref_id=media_ref_id,
            )
        )
        + 1
    )
