from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from campus_ingestion_core.wechat_public_notice_multimodal import (
    list_wechat_public_notice_inline_image_refs,
    load_wechat_public_notice_inline_image_outcome,
)
from campus_ingestion_core.wechat_public_notice_projection_constants import (
    WECHAT_PUBLIC_NOTICE_SOURCE_CHANNEL,
)
from campus_ingestion_core.wechat_public_notice_projection_models import (
    WeChatArticleSourceTruth,
    WeChatPublicNoticeProjectionObjectStore,
    WeChatSourceTruthArtifactRefs,
)
from campus_ingestion_core.wechat_public_notice_projection_scalars import (
    _ensure_forbidden_fields_absent,
    _load_json_object,
    _load_jsonl_rows,
    _required_text,
    _text,
    _to_non_negative_int,
    _to_publish_day,
)


def _load_wechat_article_source_truth(
    object_store: WeChatPublicNoticeProjectionObjectStore,
    artifact_refs: WeChatSourceTruthArtifactRefs,
) -> WeChatArticleSourceTruth:
    manifest = _load_json_object(
        object_store.get_bytes(bucket=artifact_refs.bucket, key=artifact_refs.article_manifest_key),
        field_name="article-manifest",
    )
    content_blocks = _load_jsonl_rows(
        object_store.get_bytes(bucket=artifact_refs.bucket, key=artifact_refs.content_blocks_key),
        field_name="content-blocks",
    )
    media_refs = _load_jsonl_rows(
        object_store.get_bytes(bucket=artifact_refs.bucket, key=artifact_refs.media_refs_key),
        field_name="media-refs",
    )
    _ensure_forbidden_fields_absent(manifest)
    _ensure_forbidden_fields_absent(content_blocks)
    _ensure_forbidden_fields_absent(media_refs)
    source_channel = _text(manifest.get("sourceChannel"))
    if source_channel != WECHAT_PUBLIC_NOTICE_SOURCE_CHANNEL:
        raise ValueError(f"unsupported sourceChannel for wechat projection: {source_channel}")
    body_state = _text(manifest.get("bodyState"))
    if body_state not in {"captured", "not_captured", "fetch_failed"}:
        raise ValueError(f"unsupported wechat source-truth bodyState: {body_state}")

    article_stable_id = _required_text(manifest, "articleStableId")
    raw_asset_id = _required_text(manifest, "rawAssetId")
    raw_version_id = _required_text(manifest, "rawVersionId")
    account_slug = _required_text(manifest, "accountSlug")
    account_name = _required_text(manifest, "accountName")
    provider = _required_text(manifest, "provider")
    title_raw = _required_text(manifest, "titleRaw")
    title_normalized = _required_text(manifest, "titleNormalized")
    normalized_article_url = _text(manifest.get("normalizedArticleUrl"))
    article_url = _text(manifest.get("articleUrl"))
    provider_article_id = _text(manifest.get("providerArticleId"))
    if not (normalized_article_url or provider_article_id):
        raise ValueError("wechat source-truth requires normalizedArticleUrl or providerArticleId")
    publish_time = _text(manifest.get("publishTime"))
    publish_time_source = _text(manifest.get("publishTimeSource"))
    publish_day = _to_publish_day(publish_time)
    cover_image_url = _text(manifest.get("coverImageUrl"))
    metadata_hash = _required_text(manifest, "metadataHash")
    expected_block_count = _to_non_negative_int(manifest.get("blockCount"), field_name="blockCount")
    expected_media_ref_count = _to_non_negative_int(
        manifest.get("mediaRefCount"),
        field_name="mediaRefCount",
    )
    if expected_block_count is not None and expected_block_count != len(content_blocks):
        raise ValueError("wechat source-truth blockCount does not match content-block rows")
    if expected_media_ref_count is not None and expected_media_ref_count != len(media_refs):
        raise ValueError("wechat source-truth mediaRefCount does not match media-ref rows")
    summary_text = _extract_wechat_summary_text(content_blocks)
    body_paragraphs = _extract_wechat_body_paragraphs(content_blocks)
    inline_image_refs = list_wechat_public_notice_inline_image_refs(media_refs)
    inline_image_outcomes = tuple(
        load_wechat_public_notice_inline_image_outcome(
            object_store=object_store,
            bucket=artifact_refs.bucket,
            media_refs_key=artifact_refs.media_refs_key,
            inline_ref=inline_ref,
        )
        for inline_ref in inline_image_refs
    )
    inline_image_count = len(inline_image_refs)

    return WeChatArticleSourceTruth(
        article_stable_id=article_stable_id,
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        account_name=account_name,
        account_slug=account_slug,
        provider=provider,
        normalized_article_url=normalized_article_url,
        article_url=article_url,
        provider_article_id=provider_article_id,
        publish_time=publish_time,
        publish_time_source=publish_time_source,
        publish_day=publish_day,
        cover_image_url=cover_image_url,
        title_raw=title_raw,
        title_normalized=title_normalized,
        body_state=body_state,
        content_block_count=len(content_blocks),
        media_ref_count=len(media_refs),
        inline_image_count=inline_image_count,
        inline_image_refs=inline_image_refs,
        inline_image_outcomes=inline_image_outcomes,
        summary_text=summary_text,
        body_paragraphs=body_paragraphs,
        metadata_hash=metadata_hash,
        manifest_key=artifact_refs.article_manifest_key,
        content_blocks_key=artifact_refs.content_blocks_key,
        media_refs_key=artifact_refs.media_refs_key,
        bucket=artifact_refs.bucket,
    )


def _extract_wechat_summary_text(content_blocks: Sequence[Mapping[str, Any]]) -> str:
    for row in content_blocks:
        if _text(row.get("blockRole")) != "summary":
            continue
        text = _text(row.get("textRaw")) or _text(row.get("textNormalized"))
        if text:
            return text
    return ""


def _extract_wechat_body_paragraphs(
    content_blocks: Sequence[Mapping[str, Any]],
) -> tuple[str, ...]:
    rows: list[str] = []
    for row in content_blocks:
        if _text(row.get("blockRole")) != "body_paragraph":
            continue
        text = _text(row.get("textRaw")) or _text(row.get("textNormalized"))
        if text:
            rows.append(text)
    return tuple(rows)


def _count_wechat_inline_images(media_refs: Sequence[Mapping[str, Any]]) -> int:
    count = 0
    for row in media_refs:
        if _text(row.get("resourceRole")) == "inline_image":
            count += 1
    return count
