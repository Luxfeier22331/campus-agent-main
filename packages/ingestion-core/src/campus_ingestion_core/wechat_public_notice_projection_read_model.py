from __future__ import annotations

import hashlib
from collections.abc import Mapping, Sequence

from campus_ingestion_core.internal_notice_read_model_entries import (
    _normalize_required_notice_timestamp,
)
from campus_ingestion_core.internal_notice_read_model_shared import (
    DEFAULT_INTERNAL_NOTICE_BODY_EXCERPT_MAX_CHARS,
    DEFAULT_INTERNAL_NOTICE_SEARCH_TEXT_MAX_CHARS,
    InternalNoticeReadModelEntry,
    InternalNoticeReadModelStore,
)
from campus_ingestion_core.notice_consumption_projection import (
    NOTICE_TARGET_SURFACE_NOTICE_LEVEL_QUERY,
    NoticeConsumptionProjectionEntry,
    is_notice_query_retained_consumption_status,
)
from campus_ingestion_core.object_store import build_document_artifact_key
from campus_ingestion_core.wechat_public_notice_projection_constants import (
    WECHAT_PUBLIC_NOTICE_SOURCE_CHANNEL,
    WECHAT_PUBLIC_NOTICE_SOURCE_FAMILY,
)
from campus_ingestion_core.wechat_public_notice_projection_models import (
    WeChatArticleSourceTruth,
    WeChatPublicNoticeDerivedObjectStore,
    WeChatPublicNoticeProjectionObjectStore,
    WeChatReadModelEvidenceEntry,
)
from campus_ingestion_core.wechat_public_notice_projection_multimodal_status import (
    _aggregate_multimodal_summary,
    _aggregate_multimodal_text,
)
from campus_ingestion_core.wechat_public_notice_projection_scalars import (
    _format_front_matter_value,
    _load_jsonl_rows,
    _string_tuple,
    _text,
)
from campus_ingestion_core.wechat_public_notice_projection_source_truth import (
    _extract_wechat_body_paragraphs,
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
        source_url = (
            _text(metadata.get("source_url"))
            or _text(metadata.get("normalized_article_url"))
            or _text(metadata.get("article_url"))
        )
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
        published_at = (
            _text(metadata.get("publish_time"))
            or str(entry.source_notice_release_time or "").strip()
        )
        published_at_ts = _normalize_required_notice_timestamp(published_at)
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
                visibility_level="public",
                entitlement_groups=(),
                policy_projection_version="public-notice-projection-v1",
                published_at=published_at,
                published_at_ts=published_at_ts,
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
        _text(metadata.get("multimodal_extracted_text"))
        or _text(metadata.get("multimodal_summary"))
        or _text(metadata.get("body_excerpt"))
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
            *tuple(metadata.get("source_image_object_keys") or ()),
            *tuple(metadata.get("ocr_manifest_keys") or ()),
            *tuple(metadata.get("multimodal_child_document_ids") or ()),
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
        _text(metadata.get("multimodal_summary")),
        _text(metadata.get("multimodal_extracted_text")),
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
    body = "\n\n".join(body_paragraphs).strip()
    multimodal_summary = _text(metadata.get("multimodal_summary"))
    multimodal_extracted_text = _text(metadata.get("multimodal_extracted_text"))
    if not body and not multimodal_summary and not multimodal_extracted_text:
        raise ValueError("captured wechat article is missing body and multimodal text")
    canonical_key = build_document_artifact_key(
        corpus=entry.source_corpus,
        collection=entry.source_collection,
        document_id=entry.source_document_id
        or entry.source_notice_document_id
        or entry.source_notice_id,
        revision_track="source-faithful",
        version_id=_canonical_version_token(metadata, source_notice_id=entry.source_notice_id),
        filename="canonical.md",
        title=title,
        year=_text(metadata.get("publish_day")) or "",
    )
    canonical_markdown = _render_wechat_canonical_markdown(
        metadata=metadata,
        title=title,
        body=body,
        multimodal_summary=multimodal_summary,
        multimodal_extracted_text=multimodal_extracted_text,
    )
    derived_object_store.put_bytes(
        bucket=derived_bucket,
        key=canonical_key,
        data=canonical_markdown.encode("utf-8"),
        content_type="text/markdown; charset=utf-8",
    )
    excerpt_source = (
        multimodal_extracted_text
        or multimodal_summary
        or body
        or _text(metadata.get("summary_text"))
    )
    return canonical_key, _build_body_excerpt_from_text(excerpt_source)


def _build_article_body_excerpt(article: WeChatArticleSourceTruth) -> str:
    if article.summary_text:
        return article.summary_text[:DEFAULT_INTERNAL_NOTICE_BODY_EXCERPT_MAX_CHARS]
    if _aggregate_multimodal_text(article):
        return _build_body_excerpt_from_text(_aggregate_multimodal_text(article))
    if _aggregate_multimodal_summary(article):
        return _build_body_excerpt_from_text(_aggregate_multimodal_summary(article))
    if article.body_paragraphs:
        return _build_body_excerpt_from_text("\n\n".join(article.body_paragraphs))
    return article.title_normalized[:DEFAULT_INTERNAL_NOTICE_BODY_EXCERPT_MAX_CHARS]


def _build_body_excerpt_from_text(value: str) -> str:
    return value.strip()[:DEFAULT_INTERNAL_NOTICE_BODY_EXCERPT_MAX_CHARS]


def _canonical_version_token(metadata: Mapping[str, object], *, source_notice_id: str) -> str:
    base = _text(metadata.get("metadata_hash")) or source_notice_id
    fingerprint = "\n".join(
        (
            base,
            _text(metadata.get("multimodal_summary")),
            _text(metadata.get("multimodal_extracted_text")),
            _text(metadata.get("ocr_status")),
        )
    )
    return "sha256:" + hashlib.sha256(fingerprint.encode("utf-8")).hexdigest()


def _is_wechat_body_captured(metadata: Mapping[str, object]) -> bool:
    return _text(metadata.get("body_state")) == "captured"


def _render_wechat_canonical_markdown(
    *,
    metadata: Mapping[str, object],
    title: str,
    body: str,
    multimodal_summary: str,
    multimodal_extracted_text: str,
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
    lines.extend(["---", "", f"# {title}", ""])
    if body.strip():
        lines.extend(["", body.strip()])
    if multimodal_summary:
        lines.extend(["", "## OCR Summary", "", multimodal_summary])
    if multimodal_extracted_text:
        lines.extend(["", "## OCR Extracted Text", "", multimodal_extracted_text])
    lines.append("")
    return "\n".join(lines)
