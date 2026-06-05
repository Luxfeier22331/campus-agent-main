from __future__ import annotations

import hashlib

from campus_ingestion_core.object_store import build_document_artifact_key
from campus_ingestion_core.wechat_public_notice_multimodal_constants import (
    WECHAT_PUBLIC_NOTICE_MULTIMODAL_IMPORT_SOURCE,
)
from campus_ingestion_core.wechat_public_notice_multimodal_models import (
    WeChatPublicNoticeInlineImageRef,
    WeChatPublicNoticeMultimodalObjectStore,
    WeChatPublicNoticeMultimodalProviderResult,
    _ChildDocument,
)
from campus_ingestion_core.wechat_public_notice_multimodal_scalars import (
    _document_units_jsonl,
    _publish_year,
    _resolve_notice_title,
    _slugify_segment,
)


def build_wechat_public_notice_inline_image_child_document(
    *,
    entry,
    inline_ref: WeChatPublicNoticeInlineImageRef,
    result: WeChatPublicNoticeMultimodalProviderResult,
):
    notice_title = _resolve_notice_title(entry)
    metadata = dict(entry.role_metadata or {})
    document_id = (
        "wechat_notice_image:"
        f"{_slugify_segment(str(metadata.get('account_slug') or 'account'))}:"
        f"{entry.source_notice_id}:{_slugify_segment(inline_ref.media_ref_id)}"
    )
    summary = result.summary.strip()
    extracted_text = result.extracted_text.strip()
    lines = [
        f"# {notice_title}",
        "",
        f"- source_notice_id: `{entry.source_notice_id}`",
        f"- media_ref_id: `{inline_ref.media_ref_id}`",
        f"- source_url: {inline_ref.normalized_source_url or inline_ref.source_url}",
        f"- provider: `{result.provider}`",
        f"- model: `{result.model}`",
        "",
    ]
    if summary:
        lines.extend(["## OCR Summary", "", summary, ""])
    if extracted_text:
        lines.extend(["## OCR Extracted Text", "", extracted_text, ""])
    markdown = "\n".join(lines).strip() + "\n"
    document_units = (
        {
            "unit_id": f"{document_id}:ocr-text",
            "unit_type": "text_unit",
            "text": "\n\n".join(item for item in (summary, extracted_text) if item).strip(),
            "metadata": {
                "source": WECHAT_PUBLIC_NOTICE_MULTIMODAL_IMPORT_SOURCE,
                "confidence": result.confidence,
                "media_ref_id": inline_ref.media_ref_id,
            },
        },
    )
    return _ChildDocument(
        document_id=document_id,
        canonical_markdown=markdown,
        document_units=document_units,
    )


def write_wechat_public_notice_inline_image_child_document_artifacts(
    *,
    object_store: WeChatPublicNoticeMultimodalObjectStore,
    bucket: str,
    entry,
    inline_ref: WeChatPublicNoticeInlineImageRef,
    document,
) -> dict[str, str]:
    metadata = dict(entry.role_metadata or {})
    title = _resolve_notice_title(entry)
    version_id = (
        "sha256:"
        + hashlib.sha256(document.canonical_markdown.encode("utf-8")).hexdigest()
        + ":source-faithful"
    )
    year = _publish_year(str(metadata.get("publish_day") or metadata.get("publish_time") or ""))
    canonical_markdown_key = build_document_artifact_key(
        corpus=entry.source_corpus,
        collection=entry.source_collection,
        document_id=document.document_id,
        revision_track="source-faithful",
        version_id=version_id,
        filename="canonical.md",
        title=f"{title}-{inline_ref.media_ref_id}",
        year=year,
    )
    document_units_key = build_document_artifact_key(
        corpus=entry.source_corpus,
        collection=entry.source_collection,
        document_id=document.document_id,
        revision_track="source-faithful",
        version_id=version_id,
        filename="document-units.jsonl",
        title=f"{title}-{inline_ref.media_ref_id}",
        year=year,
    )
    object_store.put_bytes(
        bucket=bucket,
        key=canonical_markdown_key,
        data=document.canonical_markdown.encode("utf-8"),
        content_type="text/markdown; charset=utf-8",
    )
    object_store.put_bytes(
        bucket=bucket,
        key=document_units_key,
        data=_document_units_jsonl(document.document_units).encode("utf-8"),
        content_type="application/x-ndjson; charset=utf-8",
    )
    return {
        "canonical_markdown_key": canonical_markdown_key,
        "document_units_key": document_units_key,
        "content_hash": "sha256:"
        + hashlib.sha256(document.canonical_markdown.encode("utf-8")).hexdigest(),
        "version_id": version_id,
    }
