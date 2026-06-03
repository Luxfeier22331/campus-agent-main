from __future__ import annotations

import json
from collections.abc import Mapping, Sequence

from campus_ingestion_core.wechat_public_notice_multimodal_constants import (
    WECHAT_PUBLIC_NOTICE_MULTIMODAL_OCR_MANIFEST_SCHEMA,
)
from campus_ingestion_core.wechat_public_notice_multimodal_models import (
    WeChatPublicNoticeInlineImageArtifactKeys,
    WeChatPublicNoticeInlineImageOutcome,
    WeChatPublicNoticeInlineImageRef,
    WeChatPublicNoticeMultimodalObjectStore,
    WeChatPublicNoticeMultimodalProviderResult,
)
from campus_ingestion_core.wechat_public_notice_multimodal_scalars import (
    _coerce_outcome_status,
    _layout_elements_jsonl,
    _load_json_if_present,
    _model_slug,
    _required_text,
    _slugify_segment,
)


def build_wechat_public_notice_inline_image_artifact_keys(
    *,
    media_refs_key: str,
    media_ref_id: str,
) -> WeChatPublicNoticeInlineImageArtifactKeys:
    article_prefix = media_refs_key.rsplit("/source-truth/media-refs.jsonl", 1)[0]
    ref_slug = _slugify_segment(media_ref_id)
    base_prefix = f"{article_prefix}/projection/wechat_public_notice/multimodal/{ref_slug}"
    return WeChatPublicNoticeInlineImageArtifactKeys(
        base_prefix=base_prefix,
        fetch_manifest_key=f"{base_prefix}/source-image-reference.json",
        ocr_manifest_key=f"{base_prefix}/ocr-manifest.json",
    )


def list_wechat_public_notice_inline_image_refs(
    media_rows: Sequence[Mapping[str, object]],
) -> tuple[WeChatPublicNoticeInlineImageRef, ...]:
    refs: list[WeChatPublicNoticeInlineImageRef] = []
    for row in media_rows:
        if str(row.get("resourceRole") or "").strip() != "inline_image":
            continue
        media_ref_id = _required_text(row.get("mediaRefId"), label="mediaRefId")
        refs.append(
            WeChatPublicNoticeInlineImageRef(
                media_ref_id=media_ref_id,
                ref_order=int(row.get("refOrder") or 0),
                source_url=_required_text(row.get("sourceUrl"), label="sourceUrl"),
                normalized_source_url=_required_text(
                    row.get("normalizedSourceUrl"),
                    label="normalizedSourceUrl",
                ),
                capture_status=str(row.get("captureStatus") or "").strip(),
                final_url=str(row.get("finalUrl") or "").strip(),
                object_key=str(row.get("objectKey") or "").strip(),
                content_sha256=str(row.get("contentSha256") or "").strip(),
                mime_type=str(row.get("mimeType") or "").strip(),
                byte_size=int(row.get("byteSize") or 0),
                captured_at=str(row.get("capturedAt") or "").strip(),
                fetch_error_message=str(row.get("fetchErrorMessage") or "").strip(),
            )
        )
    return tuple(sorted(refs, key=lambda item: (item.ref_order, item.media_ref_id)))


def load_wechat_public_notice_inline_image_outcome(
    *,
    object_store: WeChatPublicNoticeMultimodalObjectStore,
    bucket: str,
    media_refs_key: str,
    inline_ref: WeChatPublicNoticeInlineImageRef,
) -> WeChatPublicNoticeInlineImageOutcome:
    artifact_keys = build_wechat_public_notice_inline_image_artifact_keys(
        media_refs_key=media_refs_key,
        media_ref_id=inline_ref.media_ref_id,
    )
    ocr_payload = _load_json_if_present(
        object_store=object_store,
        bucket=bucket,
        key=artifact_keys.ocr_manifest_key,
    )
    if ocr_payload is not None:
        return WeChatPublicNoticeInlineImageOutcome(
            media_ref_id=inline_ref.media_ref_id,
            source_url=inline_ref.source_url,
            normalized_source_url=inline_ref.normalized_source_url,
            status=_coerce_outcome_status(ocr_payload.get("status")),
            fetch_manifest_key="",
            ocr_manifest_key=artifact_keys.ocr_manifest_key,
            image_object_key=str(ocr_payload.get("image_object_key") or inline_ref.object_key),
            summary=str(ocr_payload.get("summary") or "").strip(),
            extracted_text=str(ocr_payload.get("extracted_text") or "").strip(),
            confidence=str(ocr_payload.get("confidence") or "").strip(),
            provider=str(ocr_payload.get("provider") or "").strip(),
            model=str(ocr_payload.get("model") or "").strip(),
            provider_response_key=str(ocr_payload.get("provider_response_key") or "").strip(),
            layout_elements_key=str(ocr_payload.get("layout_elements_key") or "").strip(),
            child_document_id=str(ocr_payload.get("child_document_id") or "").strip(),
            child_canonical_markdown_key=str(
                ocr_payload.get("child_canonical_markdown_key") or ""
            ).strip(),
            child_document_units_key=str(ocr_payload.get("child_document_units_key") or "").strip(),
            error=str(ocr_payload.get("error") or "").strip(),
        )
    capture_status = str(inline_ref.capture_status or "").strip()
    if capture_status == "fetch_failed":
        return WeChatPublicNoticeInlineImageOutcome(
            media_ref_id=inline_ref.media_ref_id,
            source_url=inline_ref.source_url,
            normalized_source_url=inline_ref.normalized_source_url,
            status="fetch_failed",
            fetch_manifest_key="",
            ocr_manifest_key=artifact_keys.ocr_manifest_key,
            image_object_key=inline_ref.object_key,
            error=inline_ref.fetch_error_message,
        )
    if not inline_ref.object_key:
        return WeChatPublicNoticeInlineImageOutcome(
            media_ref_id=inline_ref.media_ref_id,
            source_url=inline_ref.source_url,
            normalized_source_url=inline_ref.normalized_source_url,
            status="fetch_failed",
            fetch_manifest_key="",
            ocr_manifest_key=artifact_keys.ocr_manifest_key,
            error="missing source image object",
        )
    return WeChatPublicNoticeInlineImageOutcome(
        media_ref_id=inline_ref.media_ref_id,
        source_url=inline_ref.source_url,
        normalized_source_url=inline_ref.normalized_source_url,
        status="pending",
        fetch_manifest_key="",
        ocr_manifest_key=artifact_keys.ocr_manifest_key,
        image_object_key=inline_ref.object_key,
    )


def write_wechat_public_notice_inline_image_fetch_manifest(
    *,
    object_store: WeChatPublicNoticeMultimodalObjectStore,
    bucket: str,
    media_refs_key: str,
    inline_ref: WeChatPublicNoticeInlineImageRef,
    payload: Mapping[str, object],
) -> str:
    key = build_wechat_public_notice_inline_image_artifact_keys(
        media_refs_key=media_refs_key,
        media_ref_id=inline_ref.media_ref_id,
    ).fetch_manifest_key
    object_store.put_bytes(
        bucket=bucket,
        key=key,
        data=(
            json.dumps(dict(payload), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        ).encode("utf-8"),
        content_type="application/json; charset=utf-8",
    )
    return key


def write_wechat_public_notice_inline_image_ocr_manifest(
    *,
    object_store: WeChatPublicNoticeMultimodalObjectStore,
    bucket: str,
    media_refs_key: str,
    inline_ref: WeChatPublicNoticeInlineImageRef,
    payload: Mapping[str, object],
) -> str:
    key = build_wechat_public_notice_inline_image_artifact_keys(
        media_refs_key=media_refs_key,
        media_ref_id=inline_ref.media_ref_id,
    ).ocr_manifest_key
    object_store.put_bytes(
        bucket=bucket,
        key=key,
        data=(
            json.dumps(dict(payload), ensure_ascii=False, indent=2, sort_keys=True) + "\n"
        ).encode("utf-8"),
        content_type="application/json; charset=utf-8",
    )
    return key


def write_wechat_public_notice_inline_image_provider_artifacts(
    *,
    object_store: WeChatPublicNoticeMultimodalObjectStore,
    bucket: str,
    media_refs_key: str,
    inline_ref: WeChatPublicNoticeInlineImageRef,
    result: WeChatPublicNoticeMultimodalProviderResult,
) -> dict[str, str]:
    artifact_keys = build_wechat_public_notice_inline_image_artifact_keys(
        media_refs_key=media_refs_key,
        media_ref_id=inline_ref.media_ref_id,
    )
    model_slug = _model_slug(provider=result.provider, model=result.model)
    provider_response_key = (
        f"{artifact_keys.base_prefix}/provider/{model_slug}/provider-response.jsonl"
    )
    layout_elements_key = f"{artifact_keys.base_prefix}/provider/{model_slug}/layout-elements.jsonl"
    object_store.put_bytes(
        bucket=bucket,
        key=provider_response_key,
        data=(
            json.dumps(
                {
                    "schema_version": WECHAT_PUBLIC_NOTICE_MULTIMODAL_OCR_MANIFEST_SCHEMA,
                    "provider": result.provider,
                    "model": result.model,
                    "confidence": result.confidence,
                    "summary": result.summary,
                    "extracted_text": result.extracted_text,
                    "has_meaningful_text": result.has_meaningful_text,
                    "raw_response": result.raw_response,
                },
                ensure_ascii=False,
            )
            + "\n"
        ).encode("utf-8"),
        content_type="application/x-ndjson; charset=utf-8",
    )
    object_store.put_bytes(
        bucket=bucket,
        key=layout_elements_key,
        data=_layout_elements_jsonl(result.layout_elements).encode("utf-8"),
        content_type="application/x-ndjson; charset=utf-8",
    )
    return {
        "provider_response_key": provider_response_key,
        "layout_elements_key": layout_elements_key,
    }
