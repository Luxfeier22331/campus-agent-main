from __future__ import annotations

from collections.abc import Mapping
from dataclasses import replace

from campus_ingestion_core.authenticated_notice_closeout_models import utc_now
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.wechat_public_notice_multimodal_constants import (
    WECHAT_PUBLIC_NOTICE_MULTIMODAL_IMPORT_SOURCE,
    WECHAT_PUBLIC_NOTICE_MULTIMODAL_PARSER_VERSION,
)
from campus_ingestion_core.wechat_public_notice_multimodal_models import (
    WeChatPublicNoticeDocumentRegistry,
    WeChatPublicNoticeInlineImageRef,
    WeChatPublicNoticeMultimodalProviderResult,
)
from campus_ingestion_core.wechat_public_notice_multimodal_scalars import (
    _required_text,
    _slugify_segment,
)


def build_wechat_public_notice_inline_image_registry_record(
    *,
    entry,
    inline_ref: WeChatPublicNoticeInlineImageRef,
    document,
    artifact_report: Mapping[str, str],
    result: WeChatPublicNoticeMultimodalProviderResult,
) -> DocumentRegistryRecord:
    metadata = dict(entry.role_metadata or {})
    published_date = str(metadata.get("publish_time") or "").split("T", 1)[0] or None
    content_hash = _required_text(artifact_report.get("content_hash"), label="content_hash")
    version_id = _required_text(artifact_report.get("version_id"), label="version_id")
    return DocumentRegistryRecord(
        document_id=document.document_id,
        revision_track="source-faithful",
        version_id=version_id,
        source_uri=(
            "wechat_official_account://"
            f"{_slugify_segment(str(metadata.get('account_slug') or 'account'))}/"
            f"articles/{entry.source_notice_id}/media/{_slugify_segment(inline_ref.media_ref_id)}"
        ),
        content_hash=content_hash,
        corpus=entry.source_corpus,
        collection=entry.source_collection,
        cleaning_policy_version=WECHAT_PUBLIC_NOTICE_MULTIMODAL_PARSER_VERSION,
        visibility_scope="public",
        visibility_level="public",
        status="active",
        ingestion_timestamp=utc_now(),
        parser_version=WECHAT_PUBLIC_NOTICE_MULTIMODAL_PARSER_VERSION,
        source_channel="wechat_official_account",
        is_current=True,
        published_date=published_date,
        provenance_status="source_ocr_admitted",
        document_units_object_key=_required_text(
            artifact_report.get("document_units_key"),
            label="document_units_key",
        ),
        canonical_markdown_object_key=_required_text(
            artifact_report.get("canonical_markdown_key"),
            label="canonical_markdown_key",
        ),
        processed_object_keys=(
            _required_text(
                artifact_report.get("canonical_markdown_key"), label="canonical_markdown_key"
            ),
            _required_text(artifact_report.get("document_units_key"), label="document_units_key"),
        ),
        import_source=WECHAT_PUBLIC_NOTICE_MULTIMODAL_IMPORT_SOURCE,
    )


def upsert_wechat_public_notice_inline_image_registry_record(
    *,
    registry: WeChatPublicNoticeDocumentRegistry,
    record: DocumentRegistryRecord,
) -> None:
    existing_versions = registry.list_versions(
        record.document_id, revision_track=record.revision_track
    )
    records_to_write = []
    for existing in existing_versions:
        if existing.version_id == record.version_id:
            continue
        if existing.is_current:
            records_to_write.append(replace(existing, is_current=False))
    records_to_write.append(record)
    registry.upsert_many(tuple(records_to_write))
