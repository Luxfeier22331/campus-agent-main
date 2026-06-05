from __future__ import annotations

from campus_ingestion_core.wechat_public_notice_multimodal_artifacts import (
    build_wechat_public_notice_inline_image_artifact_keys,
)
from campus_ingestion_core.wechat_public_notice_multimodal_constants import (
    _IMAGE_CONTENT_TYPE_RE,
)
from campus_ingestion_core.wechat_public_notice_multimodal_models import (
    WeChatPublicNoticeFetchedInlineImage,
    WeChatPublicNoticeInlineImageRef,
    WeChatPublicNoticeMultimodalObjectStore,
)
from campus_ingestion_core.wechat_public_notice_multimodal_scalars import (
    _infer_image_extension,
    _load_json_if_present,
)


def _load_inline_image_object(
    *,
    object_store: WeChatPublicNoticeMultimodalObjectStore,
    bucket: str,
    inline_ref: WeChatPublicNoticeInlineImageRef,
) -> WeChatPublicNoticeFetchedInlineImage:
    if not inline_ref.object_key.strip():
        raise ValueError(f"{inline_ref.media_ref_id} missing source image object")
    image_bytes = object_store.get_bytes(bucket=bucket, key=inline_ref.object_key)
    content_type = inline_ref.mime_type.strip() or "image/png"
    if not _IMAGE_CONTENT_TYPE_RE.match(content_type):
        raise ValueError(
            f"{inline_ref.media_ref_id} expected image content-type, got {content_type or 'unknown'}"
        )
    return WeChatPublicNoticeFetchedInlineImage(
        content_type=content_type,
        image_bytes=image_bytes,
        final_url=inline_ref.final_url or inline_ref.normalized_source_url or inline_ref.source_url,
    )


def _write_inline_image_object(
    *,
    object_store: WeChatPublicNoticeMultimodalObjectStore,
    bucket: str,
    media_refs_key: str,
    inline_ref: WeChatPublicNoticeInlineImageRef,
    fetched: WeChatPublicNoticeFetchedInlineImage,
) -> str:
    artifact_keys = build_wechat_public_notice_inline_image_artifact_keys(
        media_refs_key=media_refs_key,
        media_ref_id=inline_ref.media_ref_id,
    )
    extension = _infer_image_extension(
        content_type=fetched.content_type,
        source_url=fetched.final_url or inline_ref.normalized_source_url or inline_ref.source_url,
    )
    image_object_key = f"{artifact_keys.base_prefix}/original{extension}"
    object_store.put_bytes(
        bucket=bucket,
        key=image_object_key,
        data=fetched.image_bytes,
        content_type=fetched.content_type,
    )
    return image_object_key


def fetched_image_object_key(
    *,
    object_store: WeChatPublicNoticeMultimodalObjectStore,
    bucket: str,
    media_refs_key: str,
    inline_ref: WeChatPublicNoticeInlineImageRef,
) -> str:
    fetch_payload = _load_json_if_present(
        object_store=object_store,
        bucket=bucket,
        key=build_wechat_public_notice_inline_image_artifact_keys(
            media_refs_key=media_refs_key,
            media_ref_id=inline_ref.media_ref_id,
        ).fetch_manifest_key,
    )
    if fetch_payload is None:
        return ""
    return str(fetch_payload.get("image_object_key") or "").strip()
