from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from campus_ingestion_core.notice_consumption_projection import NoticeConsumptionProjectionEntry
from campus_ingestion_core.wechat_public_notice_multimodal import (
    WeChatPublicNoticeInlineImageOutcome,
    WeChatPublicNoticeInlineImageRef,
)
from campus_ingestion_core.wechat_public_notice_projection_constants import (
    WECHAT_PUBLIC_NOTICE_SOURCE_COLLECTION,
    WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS,
)


class WeChatPublicNoticeProjectionObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


class WeChatPublicNoticeDerivedObjectStore(Protocol):
    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


@dataclass(frozen=True, slots=True)
class WeChatSourceTruthArtifactRefs:
    article_manifest_key: str
    content_blocks_key: str
    media_refs_key: str
    bucket: str = ""

    def normalized(self, *, default_bucket: str) -> WeChatSourceTruthArtifactRefs:
        manifest = self.article_manifest_key.strip()
        blocks = self.content_blocks_key.strip()
        media = self.media_refs_key.strip()
        bucket = self.bucket.strip() or default_bucket.strip()
        if not bucket:
            raise ValueError("source-truth artifact bucket is required")
        if not (manifest and blocks and media):
            raise ValueError(
                "article_manifest_key, content_blocks_key, and media_refs_key are required"
            )
        return WeChatSourceTruthArtifactRefs(
            article_manifest_key=manifest,
            content_blocks_key=blocks,
            media_refs_key=media,
            bucket=bucket,
        )


@dataclass(frozen=True, slots=True)
class WeChatArticleSourceTruth:
    article_stable_id: str
    raw_asset_id: str
    raw_version_id: str
    account_name: str
    account_slug: str
    provider: str
    normalized_article_url: str
    article_url: str
    provider_article_id: str
    publish_time: str
    publish_time_source: str
    publish_day: str
    cover_image_url: str
    title_raw: str
    title_normalized: str
    body_state: str
    content_block_count: int
    media_ref_count: int
    inline_image_count: int
    inline_image_refs: tuple[WeChatPublicNoticeInlineImageRef, ...]
    inline_image_outcomes: tuple[WeChatPublicNoticeInlineImageOutcome, ...]
    summary_text: str
    body_paragraphs: tuple[str, ...]
    metadata_hash: str
    manifest_key: str
    content_blocks_key: str
    media_refs_key: str
    bucket: str


@dataclass(frozen=True, slots=True)
class WeChatPublicNoticeProjectionRequest:
    artifact_refs: tuple[WeChatSourceTruthArtifactRefs, ...]
    source_corpus: str = WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS
    source_collection: str = WECHAT_PUBLIC_NOTICE_SOURCE_COLLECTION
    consumer_admission_batch_id: str = ""
    reference_scopes: tuple[tuple[str, str], ...] = (
        (WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS, "internal_notice"),
        (WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS, WECHAT_PUBLIC_NOTICE_SOURCE_COLLECTION),
    )
    source_bucket: str = ""


@dataclass(frozen=True, slots=True)
class WeChatPublicNoticeProjectionBuildReport:
    projection_entries: tuple[NoticeConsumptionProjectionEntry, ...]
    total_article_count: int
    retained_count: int
    duplicate_suppressed_count: int
    duplicate_source_family_counts: dict[str, int]


@dataclass(frozen=True, slots=True)
class WeChatReadModelEvidenceEntry:
    source_family: str
    source_notice_id: str
    title: str
    source_url: str
    published_at: str
    target_surface: str
    consumption_status: str
    body_excerpt: str
    provenance_refs: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class _DuplicateReferenceHit:
    source_family: str
    source_notice_id: str
    dedupe_basis: str
