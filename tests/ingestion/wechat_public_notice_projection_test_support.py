from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from campus_ingestion_core.internal_notice_read_model import InMemoryInternalNoticeReadModelStore
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_COMPLETENESS_REQUIRES_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_CONSUMPTION_STATUS_PENDING_MULTIMODAL_PROCESSING,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_SOURCE_FAMILY_OFFICIAL_WEB_PUBLIC,
    NOTICE_SOURCE_FAMILY_WECHAT_PUBLIC,
    NOTICE_TARGET_SURFACE_MULTIMODAL_PROCESSING_CANDIDATE,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_UNSUPPORTED,
    InMemoryNoticeConsumptionProjectionStore,
    NoticeConsumptionProjectionEntry,
)
from campus_ingestion_core.wechat_public_notice_multimodal import (
    WECHAT_PUBLIC_NOTICE_MULTIMODAL_OCR_MANIFEST_SCHEMA,
    build_wechat_public_notice_inline_image_artifact_keys,
)
from campus_ingestion_core.wechat_public_notice_projection import (
    WeChatPublicNoticeProjectionRequest,
    WeChatSourceTruthArtifactRefs,
    build_wechat_public_notice_read_model_entries,
    materialize_wechat_public_notice_read_model,
    parse_wechat_projection_selection_path,
    rebuild_wechat_public_notice_projection,
)


class _FakeObjectStore:
    def __init__(self, payloads: dict[tuple[str, str], bytes]) -> None:
        self.payloads = payloads

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        return self.payloads[(bucket, key)]


class _FakeDerivedObjectStore:
    def __init__(self) -> None:
        self.payloads: dict[tuple[str, str], bytes] = {}

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self.payloads[(bucket, key)] = data


def _build_source_truth_fixture(
    *,
    bucket: str,
    prefix: str,
    article_stable_id: str,
    normalized_article_url: str,
    publish_time: str,
    provider_article_id: str,
    title_raw: str,
    title_normalized: str,
    body_state: str = "not_captured",
    body_block_texts: tuple[str, ...] = (),
    inline_image_urls: tuple[str, ...] = (),
    manifest_overrides: dict[str, object] | None = None,
) -> tuple[_FakeObjectStore, WeChatSourceTruthArtifactRefs]:
    refs = WeChatSourceTruthArtifactRefs(
        article_manifest_key=f"{prefix}/source-truth/article-manifest.json",
        content_blocks_key=f"{prefix}/source-truth/content-blocks.jsonl",
        media_refs_key=f"{prefix}/source-truth/media-refs.jsonl",
        bucket=bucket,
    )
    manifest = {
        "schemaVersion": "wechat_official_account_article_manifest.v2",
        "sourceChannel": "wechat_official_account",
        "accountName": "中央民族大学学生会",
        "accountSlug": "muc",
        "articleStableId": article_stable_id,
        "rawAssetId": f"woa_asset:{article_stable_id}",
        "rawVersionId": f"woa_ver:{article_stable_id}",
        "articleUrl": normalized_article_url,
        "normalizedArticleUrl": normalized_article_url,
        "articleIdentityBasis": "article_url",
        "provider": "feedwe",
        "providerArticleId": provider_article_id,
        "capturedAt": "2026-04-22T00:00:00+08:00",
        "titleRaw": title_raw,
        "titleNormalized": title_normalized,
        "publishTime": publish_time,
        "publishTimeSource": "provider",
        "coverImageUrl": "https://cdn.example.com/cover.png",
        "bodyState": body_state,
        "metadataHash": f"sha256:{article_stable_id}",
        "blockCount": 1 + len(body_block_texts),
        "mediaRefCount": 1 + len(inline_image_urls),
        "availabilityState": "observed",
        "captureBoundary": "real_mp_weixin_page",
        "pageKind": "article" if body_state == "captured" else "verification",
        "pageParserVersion": "wechat-page-parser.v1",
        "capturedPageFinalUrl": normalized_article_url,
        "inlineImageCount": len(inline_image_urls),
        "capturedInlineImageCount": len(inline_image_urls),
        "failedInlineImageCount": 0,
    }
    manifest.update(manifest_overrides or {})
    content_blocks = [
        {
            "schemaVersion": "wechat_official_account_content_block.v1",
            "rawAssetId": manifest["rawAssetId"],
            "rawVersionId": manifest["rawVersionId"],
            "rowId": f"{article_stable_id}:block:0",
            "rowIndex": 0,
            "blockOrder": 0,
            "blockRole": "title",
            "textRaw": title_raw,
            "textNormalized": title_normalized,
        }
    ]
    for index, text in enumerate(body_block_texts, start=1):
        content_blocks.append(
            {
                "schemaVersion": "wechat_official_account_content_block.v1",
                "rawAssetId": manifest["rawAssetId"],
                "rawVersionId": manifest["rawVersionId"],
                "rowId": f"{article_stable_id}:block:{index}",
                "rowIndex": index,
                "blockOrder": index,
                "blockRole": "body_paragraph",
                "textRaw": text,
                "textNormalized": text,
            }
        )
    media_refs = [
        {
            "schemaVersion": "wechat_official_account_media_ref.v2",
            "rawAssetId": manifest["rawAssetId"],
            "rawVersionId": manifest["rawVersionId"],
            "mediaRefId": f"{article_stable_id}:media:0",
            "refOrder": 0,
            "resourceRole": "cover_image",
            "sourceUrl": "https://cdn.example.com/cover.png",
            "normalizedSourceUrl": "https://cdn.example.com/cover.png",
            "captureStatus": "captured",
            "finalUrl": "https://cdn.example.com/cover.png",
            "objectKey": f"{prefix}/capture/media/cover/original.png",
            "contentSha256": "c" * 64,
            "mimeType": "image/png",
            "byteSize": 11,
            "capturedAt": "2026-04-22T00:00:00+08:00",
            "fetchErrorMessage": None,
        }
    ]
    for index, image_url in enumerate(inline_image_urls, start=1):
        media_refs.append(
            {
                "schemaVersion": "wechat_official_account_media_ref.v2",
                "rawAssetId": manifest["rawAssetId"],
                "rawVersionId": manifest["rawVersionId"],
                "mediaRefId": f"{article_stable_id}:media:{index}",
                "refOrder": index,
                "resourceRole": "inline_image",
                "sourceUrl": image_url,
                "normalizedSourceUrl": image_url,
                "captureStatus": "captured",
                "finalUrl": image_url,
                "objectKey": f"{prefix}/capture/media/inline-{index}/original.png",
                "contentSha256": str(index) * 64,
                "mimeType": "image/png",
                "byteSize": 100 + index,
                "capturedAt": "2026-04-22T00:00:00+08:00",
                "fetchErrorMessage": None,
            }
        )
    payloads = {
        (bucket, refs.article_manifest_key): json.dumps(manifest, ensure_ascii=False).encode(
            "utf-8"
        ),
        (bucket, refs.content_blocks_key): (
            "\n".join(json.dumps(row, ensure_ascii=False) for row in content_blocks).encode("utf-8")
        ),
        (bucket, refs.media_refs_key): (
            "\n".join(json.dumps(row, ensure_ascii=False) for row in media_refs).encode("utf-8")
        ),
    }
    return _FakeObjectStore(payloads), refs


def _projection_entry(
    *,
    source_family: str,
    source_collection: str,
    source_notice_id: str,
    title_normalized: str,
    publish_time: str,
    normalized_article_url: str,
    provider_article_id: str = "",
    account_slug: str = "",
    body_state: str = "not_captured",
) -> NoticeConsumptionProjectionEntry:
    return NoticeConsumptionProjectionEntry(
        source_family=source_family,
        source_corpus="campus_notices",
        source_collection=source_collection,
        source_notice_id=source_notice_id,
        unit_id=f"notice_unit:{source_family}:{source_notice_id}",
        primary_role="notice_window",
        semantic_owner="notice_body",
        default_agent="notice-agent",
        target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
        temporal_policy="announcement_window",
        completeness_status="reference_only",
        answerability="reference_only",
        consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
        source_notice_document_id=f"notice:{source_notice_id}",
        source_document_id=f"notice:{source_notice_id}",
        role_metadata={
            "title_normalized": title_normalized,
            "publish_time": publish_time,
            "normalized_article_url": normalized_article_url,
            "provider_article_id": provider_article_id,
            "account_slug": account_slug,
            "body_state": body_state,
        },
    )


if __name__ == "__main__":
    unittest.main()


__all__ = [name for name in globals() if not name.startswith("__")]
