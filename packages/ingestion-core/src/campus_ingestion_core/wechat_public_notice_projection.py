from __future__ import annotations

import hashlib
import json
import os
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core.internal_notice_read_model_shared import (
    DEFAULT_INTERNAL_NOTICE_BODY_EXCERPT_MAX_CHARS,
    DEFAULT_INTERNAL_NOTICE_SEARCH_TEXT_MAX_CHARS,
    InternalNoticeReadModelEntry,
    InternalNoticeReadModelStore,
)
from campus_ingestion_core.local_rebuild_support import S3ObjectStoreAdmin
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_ANSWERABILITY_REFERENCE_ONLY,
    NOTICE_COMPLETENESS_REFERENCE_ONLY,
    NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
    NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
    NOTICE_DEFAULT_AGENT_NOTICE,
    NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED,
    NOTICE_SOURCE_FAMILY_OFFICIAL_WEB_PUBLIC,
    NOTICE_SOURCE_FAMILY_WECHAT_PUBLIC,
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NOTICE_TARGET_SURFACE_UNSUPPORTED,
    NOTICE_TEMPORAL_POLICY_ANNOUNCEMENT_WINDOW,
    InMemoryNoticeConsumptionProjectionStore,
    NoticeConsumptionProjectionEntry,
    NoticeConsumptionProjectionStore,
    build_notice_consumption_projection_store_from_env,
    is_notice_query_retained_consumption_status,
)
from campus_ingestion_core.object_store import build_document_artifact_key
from campus_ingestion_core.settings import ObjectStoreSettings

WECHAT_PUBLIC_NOTICE_SOURCE_CHANNEL = "wechat_official_account"
WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY = NOTICE_SOURCE_FAMILY_WECHAT_PUBLIC
WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS = "campus_notices"
WECHAT_PUBLIC_NOTICE_SOURCE_COLLECTION = "wechat_public_notice"
WECHAT_PUBLIC_NOTICE_PRIMARY_ROLE = "notice_window"
WECHAT_PUBLIC_NOTICE_SEMANTIC_OWNER = "notice_body"
WECHAT_PUBLIC_NOTICE_SOURCE_LABEL = "wechat_public_notice_projection_v1"

_FORBIDDEN_SOURCE_TRUTH_FIELDS = frozenset(
    {
        "document_id",
        "doc_id",
        "version_id",
        "revision_track",
        "chunk_id",
        "chunk_order",
        "embedding",
        "visibility_level",
        "visibility_scope",
        "entitlement_groups",
        "policy_projection_version",
    }
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


def rebuild_wechat_public_notice_projection(
    *,
    request: WeChatPublicNoticeProjectionRequest,
    env: Mapping[str, str] | None = None,
    object_store: WeChatPublicNoticeProjectionObjectStore | None = None,
    projection_store: NoticeConsumptionProjectionStore | None = None,
    dry_run: bool = False,
) -> WeChatPublicNoticeProjectionBuildReport:
    source = dict(env if env is not None else os.environ)
    runtime_store = projection_store or _build_projection_store_with_fallback(source)
    runtime_object_store = object_store or _build_source_object_store(source)
    source_bucket = request.source_bucket.strip()
    if not source_bucket and any(not ref.bucket.strip() for ref in request.artifact_refs):
        source_bucket = ObjectStoreSettings.from_env(source).bucket_source
    normalized_refs = tuple(
        ref.normalized(default_bucket=source_bucket) for ref in request.artifact_refs
    )
    if not normalized_refs:
        raise ValueError("at least one source-truth artifact reference is required")

    articles = tuple(
        _load_wechat_article_source_truth(runtime_object_store, ref) for ref in normalized_refs
    )
    reference_entries = _load_reference_projection_entries(
        projection_store=runtime_store,
        source_corpus=request.source_corpus,
        source_collection=request.source_collection,
        reference_scopes=request.reference_scopes,
    )
    build_report = build_wechat_public_notice_projection_entries(
        articles=articles,
        source_corpus=request.source_corpus,
        source_collection=request.source_collection,
        reference_entries=reference_entries,
    )
    if dry_run:
        return build_report

    selected_notice_ids = tuple(
        sorted(
            {
                entry.source_notice_id
                for entry in build_report.projection_entries
                if entry.source_notice_id.strip()
            }
        )
    )
    runtime_store.replace_notices(
        request.source_corpus,
        request.source_collection,
        notice_ids=selected_notice_ids,
        records=build_report.projection_entries,
    )
    stored = runtime_store.list_by_scope(
        request.source_corpus,
        request.source_collection,
        notice_ids=selected_notice_ids,
    )
    return WeChatPublicNoticeProjectionBuildReport(
        projection_entries=stored,
        total_article_count=build_report.total_article_count,
        retained_count=build_report.retained_count,
        duplicate_suppressed_count=build_report.duplicate_suppressed_count,
        duplicate_source_family_counts=build_report.duplicate_source_family_counts,
    )


def build_wechat_public_notice_projection_entries(
    *,
    articles: Sequence[WeChatArticleSourceTruth],
    source_corpus: str,
    source_collection: str,
    reference_entries: Sequence[NoticeConsumptionProjectionEntry],
) -> WeChatPublicNoticeProjectionBuildReport:
    reference_signals = _build_reference_signal_map(reference_entries)
    retained_entries: list[NoticeConsumptionProjectionEntry] = []
    output_entries: list[NoticeConsumptionProjectionEntry] = []
    duplicate_source_family_counts: dict[str, int] = {}
    duplicate_suppressed_count = 0
    retained_count = 0

    for article in articles:
        duplicate_hit = _find_duplicate_reference(
            article=article,
            reference_signals=reference_signals,
            local_entries=tuple(retained_entries),
        )
        if duplicate_hit is None:
            entry = _build_retained_notice_entry(
                article=article,
                source_corpus=source_corpus,
                source_collection=source_collection,
            )
            output_entries.append(entry)
            retained_entries.append(entry)
            retained_count += 1
            continue

        duplicate_suppressed_count += 1
        duplicate_family = duplicate_hit.source_family.strip() or "unknown"
        duplicate_source_family_counts[duplicate_family] = (
            duplicate_source_family_counts.get(duplicate_family, 0) + 1
        )
        output_entries.append(
            _build_suppressed_duplicate_entry(
                article=article,
                duplicate_hit=duplicate_hit,
                source_corpus=source_corpus,
                source_collection=source_collection,
            )
        )

    return WeChatPublicNoticeProjectionBuildReport(
        projection_entries=tuple(sorted(output_entries, key=lambda item: item.unit_id)),
        total_article_count=len(articles),
        retained_count=retained_count,
        duplicate_suppressed_count=duplicate_suppressed_count,
        duplicate_source_family_counts=dict(sorted(duplicate_source_family_counts.items())),
    )


def build_wechat_public_notice_read_model_evidence_entries(
    entries: Sequence[NoticeConsumptionProjectionEntry],
) -> tuple[WeChatReadModelEvidenceEntry, ...]:
    evidence: list[WeChatReadModelEvidenceEntry] = []
    for entry in entries:
        metadata = dict(entry.role_metadata or {})
        title = _text(metadata.get("notice_title")) or _text(metadata.get("title"))
        source_url = _text(metadata.get("source_url")) or _text(
            metadata.get("normalized_article_url")
        )
        published_at = _text(metadata.get("publish_time"))
        body_excerpt = _text(metadata.get("title_normalized"))
        provenance_refs = _string_tuple(
            (
                metadata.get("manifest_key"),
                metadata.get("content_blocks_key"),
                metadata.get("media_refs_key"),
            )
        )
        evidence.append(
            WeChatReadModelEvidenceEntry(
                source_family=entry.source_family,
                source_notice_id=entry.source_notice_id,
                title=title,
                source_url=source_url,
                published_at=published_at,
                target_surface=entry.target_surface,
                consumption_status=entry.consumption_status,
                body_excerpt=body_excerpt,
                provenance_refs=provenance_refs,
            )
        )
    return tuple(sorted(evidence, key=lambda item: item.source_notice_id))


def build_wechat_public_notice_read_model_entries(
    entries: Sequence[NoticeConsumptionProjectionEntry],
    *,
    source_object_store: WeChatPublicNoticeProjectionObjectStore | None = None,
    derived_object_store: WeChatPublicNoticeDerivedObjectStore | None = None,
    source_bucket: str = "",
    derived_bucket: str = "",
) -> tuple[InternalNoticeReadModelEntry, ...]:
    rows: list[InternalNoticeReadModelEntry] = []
    for entry in entries:
        metadata = dict(entry.role_metadata or {})
        title = (
            _text(metadata.get("notice_title"))
            or _text(metadata.get("title"))
            or _text(metadata.get("title_normalized"))
            or entry.source_notice_id
        )
        source_url = _text(metadata.get("source_url")) or _text(
            metadata.get("normalized_article_url")
        ) or _text(metadata.get("article_url"))
        canonical_document_id = entry.source_notice_document_id or entry.source_document_id
        body_excerpt = _build_wechat_read_model_body_excerpt(metadata=metadata, title=title)
        canonical_markdown_object_key = ""
        if (
            _is_wechat_body_captured(metadata)
            and source_object_store is not None
            and derived_object_store is not None
            and derived_bucket.strip()
        ):
            canonical_markdown_object_key, body_excerpt = _write_wechat_canonical_markdown(
                entry=entry,
                title=title,
                source_object_store=source_object_store,
                derived_object_store=derived_object_store,
                source_bucket=source_bucket,
                derived_bucket=derived_bucket,
            )
        rows.append(
            InternalNoticeReadModelEntry(
                source_family=entry.source_family,
                source_corpus=entry.source_corpus,
                source_collection=entry.source_collection,
                source_notice_id=entry.source_notice_id,
                unit_id=entry.unit_id,
                primary_role=entry.primary_role,
                target_surface=entry.target_surface,
                consumption_status=entry.consumption_status,
                queryable=_is_wechat_read_model_queryable(entry),
                title=title,
                published_at=_text(metadata.get("publish_time"))
                or str(entry.source_notice_release_time or "").strip(),
                source_url=source_url,
                canonical_url=source_url,
                canonical_document_id=canonical_document_id,
                canonical_markdown_object_key=canonical_markdown_object_key,
                attachment_refs=entry.source_attachment_ref_ids,
                provenance_refs=_build_wechat_read_model_provenance_refs(
                    entry=entry,
                    metadata=metadata,
                    canonical_document_id=canonical_document_id,
                ),
                body_excerpt=body_excerpt,
                search_text=_build_wechat_read_model_search_text(
                    entry=entry,
                    title=title,
                    body_excerpt=body_excerpt,
                    source_url=source_url,
                    metadata=metadata,
                ),
                projection_updated_at=entry.updated_at,
            )
        )
    return tuple(sorted(rows, key=lambda item: (item.source_notice_id, item.unit_id)))


def materialize_wechat_public_notice_read_model(
    *,
    projection_entries: Sequence[NoticeConsumptionProjectionEntry],
    read_model_store: InternalNoticeReadModelStore,
    source_object_store: WeChatPublicNoticeProjectionObjectStore | None = None,
    derived_object_store: WeChatPublicNoticeDerivedObjectStore | None = None,
    source_bucket: str = "",
    derived_bucket: str = "",
) -> tuple[InternalNoticeReadModelEntry, ...]:
    if not projection_entries:
        return ()
    source_corpus = projection_entries[0].source_corpus
    source_collection = projection_entries[0].source_collection
    notice_ids = tuple(
        sorted(
            {
                entry.source_notice_id
                for entry in projection_entries
                if entry.source_notice_id.strip()
            }
        )
    )
    if not notice_ids:
        return ()
    rows = build_wechat_public_notice_read_model_entries(
        projection_entries,
        source_object_store=source_object_store,
        derived_object_store=derived_object_store,
        source_bucket=source_bucket,
        derived_bucket=derived_bucket,
    )
    read_model_store.replace_notices(
        source_corpus,
        source_collection,
        notice_ids=notice_ids,
        records=rows,
    )
    return read_model_store.list_by_scope(
        source_corpus,
        source_collection,
        notice_ids=notice_ids,
    )


def parse_wechat_projection_selection_path(
    path: Path,
    *,
    default_bucket: str = "",
) -> tuple[WeChatSourceTruthArtifactRefs, ...]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    refs = tuple(
        _normalize_selection_ref(item, default_bucket=default_bucket)
        for item in _extract_selection_ref_items(payload)
    )
    if not refs:
        raise ValueError("selection must contain source-truth artifact references")
    deduped: dict[tuple[str, str], WeChatSourceTruthArtifactRefs] = {}
    for ref in refs:
        deduped[(ref.bucket, ref.article_manifest_key)] = ref
    return tuple(
        sorted(deduped.values(), key=lambda item: (item.bucket, item.article_manifest_key))
    )


def _extract_selection_ref_items(payload: object) -> tuple[dict[str, object], ...]:
    if isinstance(payload, list):
        return tuple(item for item in payload if isinstance(item, dict))
    if not isinstance(payload, dict):
        return ()
    source_truth_articles = payload.get("source_truth_articles")
    if not isinstance(source_truth_articles, list):
        source_truth_articles = payload.get("sourceTruthArticles")
    if isinstance(source_truth_articles, list):
        return tuple(item for item in source_truth_articles if isinstance(item, dict))
    refs_from_artifacts = _derive_source_truth_refs_from_artifacts(payload)
    if refs_from_artifacts:
        return refs_from_artifacts
    return ()


def _derive_source_truth_refs_from_artifacts(
    payload: Mapping[str, object],
) -> tuple[dict[str, object], ...]:
    artifacts = payload.get("artifacts")
    object_keys = payload.get("artifact_keys")
    candidate_keys: list[tuple[str, str]] = []
    if isinstance(artifacts, list):
        for item in artifacts:
            if not isinstance(item, dict):
                continue
            object_key = _text(item.get("objectKey")) or _text(item.get("object_key"))
            if not object_key:
                continue
            bucket = _text(item.get("bucket")) or _text(item.get("source_bucket"))
            candidate_keys.append((bucket, object_key))
    if isinstance(object_keys, list):
        for item in object_keys:
            object_key = _text(item)
            if object_key:
                candidate_keys.append(("", object_key))
    manifests: dict[tuple[str, str], dict[str, object]] = {}
    for bucket, key in candidate_keys:
        if not key.endswith("/source-truth/article-manifest.json"):
            continue
        prefix = key.rsplit("/source-truth/article-manifest.json", 1)[0]
        manifests[(bucket, prefix)] = {
            "bucket": bucket,
            "article_manifest_key": f"{prefix}/source-truth/article-manifest.json",
            "content_blocks_key": f"{prefix}/source-truth/content-blocks.jsonl",
            "media_refs_key": f"{prefix}/source-truth/media-refs.jsonl",
        }
    return tuple(manifests.values())


def _normalize_selection_ref(
    payload: Mapping[str, object],
    *,
    default_bucket: str,
) -> WeChatSourceTruthArtifactRefs:
    manifest_key = _text(payload.get("article_manifest_key")) or _text(
        payload.get("articleManifestKey")
    )
    content_blocks_key = _text(payload.get("content_blocks_key")) or _text(
        payload.get("contentBlocksKey")
    )
    media_refs_key = _text(payload.get("media_refs_key")) or _text(payload.get("mediaRefsKey"))
    object_key = _text(payload.get("object_key")) or _text(payload.get("objectKey"))
    if (
        not manifest_key
        and not content_blocks_key
        and not media_refs_key
        and object_key.endswith("/source-truth/article-manifest.json")
    ):
        prefix = object_key.rsplit("/source-truth/article-manifest.json", 1)[0]
        manifest_key = f"{prefix}/source-truth/article-manifest.json"
        content_blocks_key = f"{prefix}/source-truth/content-blocks.jsonl"
        media_refs_key = f"{prefix}/source-truth/media-refs.jsonl"
    return WeChatSourceTruthArtifactRefs(
        article_manifest_key=manifest_key,
        content_blocks_key=content_blocks_key,
        media_refs_key=media_refs_key,
        bucket=_text(payload.get("bucket")) or default_bucket,
    ).normalized(default_bucket=default_bucket)


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
        summary_text=summary_text,
        body_paragraphs=body_paragraphs,
        metadata_hash=metadata_hash,
        manifest_key=artifact_refs.article_manifest_key,
        content_blocks_key=artifact_refs.content_blocks_key,
        media_refs_key=artifact_refs.media_refs_key,
        bucket=artifact_refs.bucket,
    )


@dataclass(frozen=True, slots=True)
class _DuplicateReferenceHit:
    source_family: str
    source_notice_id: str
    dedupe_basis: str


def _find_duplicate_reference(
    *,
    article: WeChatArticleSourceTruth,
    reference_signals: Mapping[str, tuple[str, str]],
    local_entries: Sequence[NoticeConsumptionProjectionEntry],
) -> _DuplicateReferenceHit | None:
    signals = _dedupe_signals_for_article(article)
    for dedupe_basis, signal in signals:
        existing = reference_signals.get(signal)
        if existing is not None:
            family, notice_id = existing
            if (
                family == WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY
                and notice_id == article.article_stable_id
            ):
                continue
            if _source_family_priority(family) >= _source_family_priority(
                WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY
            ):
                return _DuplicateReferenceHit(
                    source_family=family,
                    source_notice_id=notice_id,
                    dedupe_basis=dedupe_basis,
                )
    local_signal_map = _build_reference_signal_map(local_entries)
    for dedupe_basis, signal in signals:
        existing = local_signal_map.get(signal)
        if existing is not None:
            family, notice_id = existing
            if (
                family == WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY
                and notice_id == article.article_stable_id
            ):
                continue
            return _DuplicateReferenceHit(
                source_family=family,
                source_notice_id=notice_id,
                dedupe_basis=dedupe_basis,
            )
    return None


def _build_reference_signal_map(
    entries: Sequence[NoticeConsumptionProjectionEntry],
) -> dict[str, tuple[str, str]]:
    signal_map: dict[str, tuple[str, str]] = {}
    for entry in entries:
        signals = _dedupe_signals_for_projection_entry(entry)
        for signal in signals:
            signal_map.setdefault(signal, (entry.source_family, entry.source_notice_id))
    return signal_map


def _dedupe_signals_for_article(article: WeChatArticleSourceTruth) -> tuple[tuple[str, str], ...]:
    signals: list[tuple[str, str]] = []
    if article.normalized_article_url:
        signals.append(("normalized_article_url", f"url:{article.normalized_article_url}"))
        signals.append(
            (
                "account_slug+normalized_article_url",
                f"account_url:{article.account_slug}:{article.normalized_article_url}",
            )
        )
    if article.title_normalized and article.publish_day:
        signals.append(
            ("title+publish_day", f"title_day:{article.title_normalized}:{article.publish_day}")
        )
    if article.account_slug and article.provider_article_id:
        signals.append(
            (
                "account_slug+provider_article_id",
                f"provider_id:{article.account_slug}:{article.provider_article_id}",
            )
        )
    return tuple(signals)


def _dedupe_signals_for_projection_entry(
    entry: NoticeConsumptionProjectionEntry,
) -> tuple[str, ...]:
    metadata = dict(entry.role_metadata or {})
    account_slug = _text(metadata.get("account_slug"))
    normalized_article_url = _text(metadata.get("normalized_article_url")) or _text(
        metadata.get("source_url")
    )
    title_normalized = _text(metadata.get("title_normalized")) or _text(metadata.get("title"))
    publish_day = _to_publish_day(
        _text(metadata.get("publish_time")) or _text(metadata.get("published_at"))
    )
    provider_article_id = _text(metadata.get("provider_article_id"))

    signals: list[str] = []
    if normalized_article_url:
        signals.append(f"url:{normalized_article_url}")
    if account_slug and normalized_article_url:
        signals.append(f"account_url:{account_slug}:{normalized_article_url}")
    if title_normalized and publish_day:
        signals.append(f"title_day:{title_normalized}:{publish_day}")
    if account_slug and provider_article_id:
        signals.append(f"provider_id:{account_slug}:{provider_article_id}")
    return tuple(dict.fromkeys(signals))


def _build_retained_notice_entry(
    *,
    article: WeChatArticleSourceTruth,
    source_corpus: str,
    source_collection: str,
) -> NoticeConsumptionProjectionEntry:
    notice_document_id = f"wechat_notice:{article.account_slug}:{article.article_stable_id}"
    unit_digest = hashlib.sha256(
        "\n".join(
            (article.article_stable_id, article.raw_version_id, WECHAT_PUBLIC_NOTICE_PRIMARY_ROLE)
        ).encode("utf-8")
    ).hexdigest()[:16]
    return NoticeConsumptionProjectionEntry(
        source_family=WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY,
        source_corpus=source_corpus,
        source_collection=source_collection,
        source_notice_id=article.article_stable_id,
        unit_id=f"notice_unit:wechat:{article.article_stable_id}:{unit_digest}",
        primary_role=WECHAT_PUBLIC_NOTICE_PRIMARY_ROLE,
        semantic_owner=WECHAT_PUBLIC_NOTICE_SEMANTIC_OWNER,
        default_agent=NOTICE_DEFAULT_AGENT_NOTICE,
        target_surface=NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
        temporal_policy=NOTICE_TEMPORAL_POLICY_ANNOUNCEMENT_WINDOW,
        completeness_status=NOTICE_COMPLETENESS_REFERENCE_ONLY,
        answerability=NOTICE_ANSWERABILITY_REFERENCE_ONLY,
        consumption_status=NOTICE_CONSUMPTION_STATUS_RETAINED_FOR_NOTICE_QUERY,
        source_notice_document_id=notice_document_id,
        source_document_id=notice_document_id,
        source_notice_release_time=article.publish_time or None,
        role_metadata={
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
            "metadata_hash": article.metadata_hash,
            "manifest_key": article.manifest_key,
            "content_blocks_key": article.content_blocks_key,
            "media_refs_key": article.media_refs_key,
            "source_bucket": article.bucket,
            "dedupe_status": "unique",
        },
    )


def _build_suppressed_duplicate_entry(
    *,
    article: WeChatArticleSourceTruth,
    duplicate_hit: _DuplicateReferenceHit,
    source_corpus: str,
    source_collection: str,
) -> NoticeConsumptionProjectionEntry:
    retained_entry = _build_retained_notice_entry(
        article=article,
        source_corpus=source_corpus,
        source_collection=source_collection,
    )
    metadata = dict(retained_entry.role_metadata)
    metadata.update(
        {
            "dedupe_status": "suppressed_duplicate",
            "dedupe_basis": duplicate_hit.dedupe_basis,
            "duplicate_of_source_family": duplicate_hit.source_family,
            "duplicate_of_notice_id": duplicate_hit.source_notice_id,
            "canonical_source_family": duplicate_hit.source_family,
            "canonical_notice_id": duplicate_hit.source_notice_id,
        }
    )
    return NoticeConsumptionProjectionEntry(
        source_family=retained_entry.source_family,
        source_corpus=retained_entry.source_corpus,
        source_collection=retained_entry.source_collection,
        source_notice_id=retained_entry.source_notice_id,
        unit_id=retained_entry.unit_id,
        primary_role=retained_entry.primary_role,
        semantic_owner=retained_entry.semantic_owner,
        default_agent=retained_entry.default_agent,
        target_surface=NOTICE_TARGET_SURFACE_UNSUPPORTED,
        temporal_policy=retained_entry.temporal_policy,
        completeness_status=retained_entry.completeness_status,
        answerability=retained_entry.answerability,
        consumption_status=NOTICE_CONSUMPTION_STATUS_NO_ADOPTION,
        source_notice_document_id=retained_entry.source_notice_document_id,
        source_document_id=retained_entry.source_document_id,
        source_attachment_ref_ids=retained_entry.source_attachment_ref_ids,
        source_notice_release_time=retained_entry.source_notice_release_time,
        role_metadata=metadata,
    )


def _load_reference_projection_entries(
    *,
    projection_store: NoticeConsumptionProjectionStore,
    source_corpus: str,
    source_collection: str,
    reference_scopes: Sequence[tuple[str, str]],
) -> tuple[NoticeConsumptionProjectionEntry, ...]:
    entries: list[NoticeConsumptionProjectionEntry] = []
    visited: set[tuple[str, str]] = set()
    scopes = list(reference_scopes) or [(source_corpus, source_collection)]
    if (source_corpus, source_collection) not in scopes:
        scopes.append((source_corpus, source_collection))
    for scope in scopes:
        if len(scope) != 2:
            continue
        corpus = str(scope[0]).strip()
        collection = str(scope[1]).strip()
        if not (corpus and collection):
            continue
        if (corpus, collection) in visited:
            continue
        visited.add((corpus, collection))
        entries.extend(projection_store.list_by_scope(corpus, collection))
    return tuple(entries)


def _build_projection_store_with_fallback(
    env: Mapping[str, str],
) -> NoticeConsumptionProjectionStore:
    try:
        return build_notice_consumption_projection_store_from_env(dict(env))
    except ValueError:
        return InMemoryNoticeConsumptionProjectionStore()


def _build_source_object_store(
    env: Mapping[str, str],
) -> WeChatPublicNoticeProjectionObjectStore:
    settings = ObjectStoreSettings.from_env(dict(env))
    return S3ObjectStoreAdmin(settings)


def _is_wechat_read_model_queryable(entry: NoticeConsumptionProjectionEntry) -> bool:
    return (
        is_notice_query_retained_consumption_status(entry.consumption_status)
        and entry.target_surface == NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY
        and _is_wechat_body_captured(entry.role_metadata or {})
    )


def _build_wechat_read_model_body_excerpt(
    *,
    metadata: Mapping[str, object],
    title: str,
) -> str:
    excerpt = (
        _text(metadata.get("body_excerpt"))
        or _text(metadata.get("summary_text"))
        or _text(metadata.get("title_normalized"))
        or _text(metadata.get("title"))
        or _text(metadata.get("notice_title"))
        or title
    )
    return excerpt[:DEFAULT_INTERNAL_NOTICE_BODY_EXCERPT_MAX_CHARS]


def _build_wechat_read_model_provenance_refs(
    *,
    entry: NoticeConsumptionProjectionEntry,
    metadata: Mapping[str, object],
    canonical_document_id: str,
) -> tuple[str, ...]:
    return _string_tuple(
        (
            entry.source_notice_document_id,
            entry.source_document_id,
            canonical_document_id,
            metadata.get("manifest_key"),
            metadata.get("content_blocks_key"),
            metadata.get("media_refs_key"),
            entry.unit_id,
        )
    )


def _build_wechat_read_model_search_text(
    *,
    entry: NoticeConsumptionProjectionEntry,
    title: str,
    body_excerpt: str,
    source_url: str,
    metadata: Mapping[str, object],
) -> str:
    parts = (
        title,
        entry.source_notice_id,
        entry.primary_role,
        entry.target_surface,
        source_url,
        _text(metadata.get("account_name")),
        _text(metadata.get("account_slug")),
        _text(metadata.get("provider_article_id")),
        body_excerpt,
    )
    return "\n".join(part for part in parts if part).strip()[
        :DEFAULT_INTERNAL_NOTICE_SEARCH_TEXT_MAX_CHARS
    ]


def _write_wechat_canonical_markdown(
    *,
    entry: NoticeConsumptionProjectionEntry,
    title: str,
    source_object_store: WeChatPublicNoticeProjectionObjectStore,
    derived_object_store: WeChatPublicNoticeDerivedObjectStore,
    source_bucket: str,
    derived_bucket: str,
) -> tuple[str, str]:
    metadata = dict(entry.role_metadata or {})
    source_truth_bucket = _text(metadata.get("source_bucket")) or source_bucket
    if not source_truth_bucket:
        raise ValueError("wechat read-model materialization requires source bucket")
    content_blocks_key = _text(metadata.get("content_blocks_key"))
    if not content_blocks_key:
        raise ValueError("wechat read-model materialization requires content_blocks_key")
    content_blocks = _load_jsonl_rows(
        source_object_store.get_bytes(bucket=source_truth_bucket, key=content_blocks_key),
        field_name="content-blocks",
    )
    body_paragraphs = _extract_wechat_body_paragraphs(content_blocks)
    if not body_paragraphs:
        raise ValueError("captured wechat article is missing body_paragraph blocks")
    body = "\n\n".join(body_paragraphs).strip()
    canonical_key = build_document_artifact_key(
        corpus=entry.source_corpus,
        collection=entry.source_collection,
        document_id=entry.source_document_id or entry.source_notice_document_id or entry.source_notice_id,
        revision_track="source-faithful",
        version_id=_text(metadata.get("metadata_hash")) or entry.source_notice_id,
        filename="canonical.md",
        title=title,
        year=_text(metadata.get("publish_day")) or "",
    )
    canonical_markdown = _render_wechat_canonical_markdown(metadata=metadata, title=title, body=body)
    derived_object_store.put_bytes(
        bucket=derived_bucket,
        key=canonical_key,
        data=canonical_markdown.encode("utf-8"),
        content_type="text/markdown; charset=utf-8",
    )
    return canonical_key, _build_body_excerpt_from_text(body)


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


def _build_article_body_excerpt(article: WeChatArticleSourceTruth) -> str:
    if article.summary_text:
        return article.summary_text[:DEFAULT_INTERNAL_NOTICE_BODY_EXCERPT_MAX_CHARS]
    if article.body_paragraphs:
        return _build_body_excerpt_from_text("\n\n".join(article.body_paragraphs))
    return article.title_normalized[:DEFAULT_INTERNAL_NOTICE_BODY_EXCERPT_MAX_CHARS]


def _build_body_excerpt_from_text(value: str) -> str:
    return value.strip()[:DEFAULT_INTERNAL_NOTICE_BODY_EXCERPT_MAX_CHARS]


def _is_wechat_body_captured(metadata: Mapping[str, object]) -> bool:
    return _text(metadata.get("body_state")) == "captured"


def _render_wechat_canonical_markdown(
    *,
    metadata: Mapping[str, object],
    title: str,
    body: str,
) -> str:
    front_matter: dict[str, object] = {
        "source_family": WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY,
        "source_channel": WECHAT_PUBLIC_NOTICE_SOURCE_CHANNEL,
        "account_name": _text(metadata.get("account_name")),
        "account_slug": _text(metadata.get("account_slug")),
        "source_url": _text(metadata.get("source_url")),
        "published_at": _text(metadata.get("publish_time")),
        "provider": _text(metadata.get("provider")),
        "provider_article_id": _text(metadata.get("provider_article_id")),
        "body_state": _text(metadata.get("body_state")),
    }
    lines = ["---"]
    for key, value in front_matter.items():
        if value is None or value == "":
            continue
        lines.append(f"{key}: {_format_front_matter_value(value)}")
    lines.extend(["---", "", f"# {title}", "", body.strip(), ""])
    return "\n".join(lines)


def _format_front_matter_value(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    text = str(value)
    if not text:
        return '""'
    if any(ch in text for ch in ["#", "[", "]", "{", "}", ","]) or text != text.strip():
        return json.dumps(text, ensure_ascii=False)
    return text


def _source_family_priority(source_family: str) -> int:
    normalized = source_family.strip()
    if normalized == NOTICE_SOURCE_FAMILY_INTERNAL_RESTRICTED:
        return 3
    if normalized == NOTICE_SOURCE_FAMILY_OFFICIAL_WEB_PUBLIC:
        return 2
    if normalized == WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY:
        return 1
    return 0


def _load_json_object(payload: bytes, *, field_name: str) -> dict[str, Any]:
    data = json.loads(payload.decode("utf-8"))
    if not isinstance(data, dict):
        raise ValueError(f"{field_name} payload must be a JSON object")
    return dict(data)


def _load_jsonl_rows(payload: bytes, *, field_name: str) -> tuple[dict[str, Any], ...]:
    rows: list[dict[str, Any]] = []
    for index, line in enumerate(payload.decode("utf-8").splitlines(), start=1):
        normalized = line.strip()
        if not normalized:
            continue
        data = json.loads(normalized)
        if not isinstance(data, dict):
            raise ValueError(f"{field_name} line {index} must be a JSON object")
        rows.append(dict(data))
    return tuple(rows)


def _ensure_forbidden_fields_absent(value: object) -> None:
    found = _find_forbidden_fields(value)
    if found:
        ordered = ", ".join(sorted(found))
        raise ValueError(f"wechat source-truth contains forbidden fields: {ordered}")


def _find_forbidden_fields(value: object) -> set[str]:
    found: set[str] = set()
    if isinstance(value, dict):
        for key, nested in value.items():
            if key in _FORBIDDEN_SOURCE_TRUTH_FIELDS:
                found.add(key)
            found.update(_find_forbidden_fields(nested))
    elif isinstance(value, list):
        for item in value:
            found.update(_find_forbidden_fields(item))
    return found


def _required_text(payload: Mapping[str, Any], field_name: str) -> str:
    value = _text(payload.get(field_name))
    if not value:
        raise ValueError(f"{field_name} is required in wechat source-truth manifest")
    return value


def _to_publish_day(value: str) -> str:
    normalized = value.strip()
    if not normalized:
        return ""
    try:
        return datetime.fromisoformat(normalized.replace("Z", "+00:00")).date().isoformat()
    except ValueError:
        return normalized[:10]


def _text(value: object) -> str:
    return value.strip() if isinstance(value, str) else ""


def _string_tuple(values: Sequence[object]) -> tuple[str, ...]:
    return tuple(item for item in (_text(value) for value in values) if item)


def _to_non_negative_int(value: object, *, field_name: str) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValueError(f"{field_name} must be a non-negative integer")
    if isinstance(value, int):
        parsed = value
    elif isinstance(value, str):
        normalized = value.strip()
        if not normalized:
            return None
        try:
            parsed = int(normalized)
        except ValueError as exc:
            raise ValueError(f"{field_name} must be a non-negative integer") from exc
    else:
        raise ValueError(f"{field_name} must be a non-negative integer")
    if parsed < 0:
        raise ValueError(f"{field_name} must be a non-negative integer")
    return parsed


__all__ = [
    "WECHAT_PUBLIC_NOTICE_SOURCE_CHANNEL",
    "WECHAT_PUBLIC_NOTICE_SOURCE_COLLECTION",
    "WECHAT_PUBLIC_NOTICE_SOURCE_CORPUS",
    "WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY",
    "WECHAT_PUBLIC_NOTICE_SOURCE_LABEL",
    "WeChatArticleSourceTruth",
    "WeChatPublicNoticeProjectionBuildReport",
    "WeChatPublicNoticeProjectionObjectStore",
    "WeChatPublicNoticeProjectionRequest",
    "WeChatReadModelEvidenceEntry",
    "WeChatSourceTruthArtifactRefs",
    "build_wechat_public_notice_projection_entries",
    "build_wechat_public_notice_read_model_entries",
    "build_wechat_public_notice_read_model_evidence_entries",
    "materialize_wechat_public_notice_read_model",
    "parse_wechat_projection_selection_path",
    "rebuild_wechat_public_notice_projection",
]
