from __future__ import annotations

from campus_ingestion_core.authenticated_notice_closeout_models import utc_now
from campus_ingestion_core.wechat_public_notice_multimodal_artifacts import (
    build_wechat_public_notice_inline_image_artifact_keys,
)
from campus_ingestion_core.wechat_public_notice_multimodal_constants import (
    WECHAT_PUBLIC_NOTICE_MULTIMODAL_FETCH_MANIFEST_SCHEMA,
    WECHAT_PUBLIC_NOTICE_MULTIMODAL_OCR_MANIFEST_SCHEMA,
)
from campus_ingestion_core.wechat_public_notice_multimodal_models import (
    WeChatPublicNoticeInlineImageRef,
    WeChatPublicNoticeMultimodalProviderResult,
)
from campus_ingestion_core.wechat_public_notice_multimodal_scalars import _required_text


def _build_fetch_manifest(
    *,
    entry,
    inline_ref: WeChatPublicNoticeInlineImageRef,
    status: str,
    image_object_key: str,
    content_type: str,
    byte_size: int,
    sha256: str,
    final_url: str,
    error: str,
) -> dict[str, object]:
    metadata = dict(entry.role_metadata or {})
    return {
        "schema_version": WECHAT_PUBLIC_NOTICE_MULTIMODAL_FETCH_MANIFEST_SCHEMA,
        "source_notice_id": entry.source_notice_id,
        "source_collection": entry.source_collection,
        "media_ref_id": inline_ref.media_ref_id,
        "source_url": inline_ref.source_url,
        "normalized_source_url": inline_ref.normalized_source_url,
        "article_source_url": str(metadata.get("source_url") or ""),
        "status": status,
        "image_object_key": image_object_key,
        "content_type": content_type,
        "byte_size": byte_size,
        "sha256": sha256,
        "final_url": final_url,
        "fetched_at": utc_now(),
        "error": error,
    }


def _build_ocr_manifest(
    *,
    entry,
    inline_ref: WeChatPublicNoticeInlineImageRef,
    result: WeChatPublicNoticeMultimodalProviderResult,
    status: str,
    image_object_key: str,
    provider_response_key: str,
    layout_elements_key: str,
    child_document_id: str,
    child_canonical_markdown_key: str,
    child_document_units_key: str,
    error: str,
) -> dict[str, object]:
    artifact_keys = build_wechat_public_notice_inline_image_artifact_keys(
        media_refs_key=_required_text(
            dict(entry.role_metadata or {}).get("media_refs_key"),
            label="media_refs_key",
        ),
        media_ref_id=inline_ref.media_ref_id,
    )
    fetch_manifest = {
        "fetch_manifest_key": artifact_keys.fetch_manifest_key,
        "ocr_manifest_key": artifact_keys.ocr_manifest_key,
    }
    return {
        "schema_version": WECHAT_PUBLIC_NOTICE_MULTIMODAL_OCR_MANIFEST_SCHEMA,
        "source_notice_id": entry.source_notice_id,
        "source_collection": entry.source_collection,
        "media_ref_id": inline_ref.media_ref_id,
        "status": status,
        "provider": result.provider,
        "model": result.model,
        "confidence": result.confidence,
        "summary": result.summary,
        "extracted_text": result.extracted_text,
        "provider_response_key": provider_response_key,
        "layout_elements_key": layout_elements_key,
        "child_document_id": child_document_id,
        "child_canonical_markdown_key": child_canonical_markdown_key,
        "child_document_units_key": child_document_units_key,
        "processed_at": utc_now(),
        "error": error,
        "image_object_key": image_object_key,
        **fetch_manifest,
    }
