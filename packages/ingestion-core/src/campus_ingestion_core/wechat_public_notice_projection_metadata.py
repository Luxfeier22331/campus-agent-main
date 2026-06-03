from __future__ import annotations

from campus_ingestion_core.wechat_public_notice_projection_constants import (
    WECHAT_PUBLIC_NOTICE_SOURCE_CHANNEL,
    WECHAT_PUBLIC_NOTICE_SOURCE_LABEL,
)
from campus_ingestion_core.wechat_public_notice_projection_models import WeChatArticleSourceTruth
from campus_ingestion_core.wechat_public_notice_projection_multimodal_status import (
    _aggregate_multimodal_summary,
    _aggregate_multimodal_text,
    _article_ocr_required,
    _article_ocr_status,
    _capture_gate_status,
    _inline_image_status_counts,
    _multimodal_processing_status,
    _processing_gap_reason,
)
from campus_ingestion_core.wechat_public_notice_projection_read_model import (
    _build_article_body_excerpt,
)


def _build_article_role_metadata(
    article: WeChatArticleSourceTruth,
    *,
    consumer_admission_batch_id: str = "",
) -> dict[str, object]:
    ocr_required = _article_ocr_required(article)
    multimodal_summary = _aggregate_multimodal_summary(article)
    multimodal_extracted_text = _aggregate_multimodal_text(article)
    inline_image_ref_ids = tuple(item.media_ref_id for item in article.inline_image_refs)
    status_counts = _inline_image_status_counts(article)
    ocr_status = _article_ocr_status(article)
    processing_status = _multimodal_processing_status(article)
    processing_gap_reason = _processing_gap_reason(article)
    metadata = {
        "projection_source_label": WECHAT_PUBLIC_NOTICE_SOURCE_LABEL,
        "notice_title": article.title_raw,
        "title": article.title_raw,
        "title_normalized": article.title_normalized,
        "body_state": article.body_state,
        "source_channel": WECHAT_PUBLIC_NOTICE_SOURCE_CHANNEL,
        "provider": article.provider,
        "account_name": article.account_name,
        "account_slug": article.account_slug,
        "source_url": article.normalized_article_url or article.article_url,
        "normalized_article_url": article.normalized_article_url,
        "article_url": article.article_url,
        "provider_article_id": article.provider_article_id,
        "publish_time": article.publish_time,
        "publish_time_source": article.publish_time_source,
        "publish_day": article.publish_day,
        "cover_image_url": article.cover_image_url,
        "summary_text": article.summary_text,
        "body_excerpt": _build_article_body_excerpt(article),
        "body_paragraph_count": len(article.body_paragraphs),
        "content_block_count": article.content_block_count,
        "media_ref_count": article.media_ref_count,
        "inline_image_count": article.inline_image_count,
        "inline_image_ref_ids": inline_image_ref_ids,
        "ocr_required": ocr_required,
        "ocr_status": ocr_status,
        "capture_gate_status": _capture_gate_status(article),
        "multimodal_processing_status": processing_status,
        "processing_gap_reason": processing_gap_reason,
        "inline_image_status_counts": status_counts,
        "source_image_object_keys": tuple(
            item.image_object_key for item in article.inline_image_outcomes if item.image_object_key
        ),
        "ocr_manifest_keys": tuple(
            item.ocr_manifest_key for item in article.inline_image_outcomes if item.ocr_manifest_key
        ),
        "multimodal_summary": multimodal_summary,
        "multimodal_extracted_text": multimodal_extracted_text,
        "multimodal_child_document_ids": tuple(
            item.child_document_id
            for item in article.inline_image_outcomes
            if item.child_document_id
        ),
        "metadata_hash": article.metadata_hash,
        "manifest_key": article.manifest_key,
        "content_blocks_key": article.content_blocks_key,
        "media_refs_key": article.media_refs_key,
        "source_bucket": article.bucket,
    }
    if consumer_admission_batch_id.strip():
        metadata["consumer_admission_batch_id"] = consumer_admission_batch_id.strip()
    return metadata
