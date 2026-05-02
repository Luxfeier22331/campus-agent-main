from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Mapping
from typing import Any

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION

from campus_ingestion_core.campusrag_ingestion_support import DocumentImportInput
from campus_ingestion_core.collected_notice_regulation_text_normalization import (
    REGULATION_CANONICAL_NORMALIZER_VERSION,
)
from campus_ingestion_core.internal_notice_regulation_projection import (
    build_institutional_regulation_version_id,
)

INSTITUTIONAL_TARGET_COLLECTION = "institutional_rules"
SCOPED_TARGET_COLLECTION = "scoped_rules"
PHASE_09_ID = "phase-09-first-batch-regulation-promotion-write-gate"

_TARGET_IMPORT_SOURCE = "collected_notice_regulation_first_batch_promotion"
_TARGET_SOURCE_CHANNEL = "authenticated_notice_portal"
_DOCUMENT_UNITS_SCHEMA_VERSION = "document_units_jsonl"
_ARTICLE_OR_CHAPTER_RE = re.compile(
    r"(?=^第[一二三四五六七八九十百千万0-9]+[章节条][^\n]*)",
    re.MULTILINE,
)


def build_document_import_input(
    document: Mapping[str, Any],
    *,
    promotion_phase_id: str = PHASE_09_ID,
    import_source: str = _TARGET_IMPORT_SOURCE,
) -> DocumentImportInput:
    target_collection = _required_text(document.get("target_collection"), "target_collection")
    title = _required_text(document.get("title"), "title")
    target_document_id = _required_text(document.get("target_document_id"), "target_document_id")
    canonical_markdown = _required_text(document.get("canonical_markdown"), "canonical_markdown")
    semantic_content_hash = hashlib.sha256(canonical_markdown.encode("utf-8")).hexdigest()
    version_id = build_institutional_regulation_version_id(
        semantic_content_hash=semantic_content_hash,
        effective_date=None,
        revision_signal=None,
    )
    document_units_bytes = serialize_document_units(
        document=document,
        target_document_id=target_document_id,
        version_id=version_id,
        semantic_content_hash=semantic_content_hash,
    )
    metadata = {
        "document_id": target_document_id,
        "version_id": version_id,
        "revision_track": "current-effective",
        "title": title,
        "source_url": _source_url(document),
        "semantic_content_hash": semantic_content_hash,
        "entitlement_groups": ["campus_members"],
        "visibility_scope": "campus",
        "visibility_level": "restricted",
        "policy_projection_version": DEFAULT_POLICY_PROJECTION_VERSION,
        "status": "active",
    }
    return DocumentImportInput(
        source_label=f"{promotion_phase_id}:{target_document_id}",
        document_units_bytes=document_units_bytes,
        provider_response_bytes=None,
        canonical_markdown_bytes=canonical_markdown.encode("utf-8"),
        metadata=metadata,
        import_source=import_source,
        revision_track="current-effective",
        source_channel=_TARGET_SOURCE_CHANNEL,
        is_current=True,
        corpus="regulations",
        collection=target_collection,
        visibility_scope="campus",
        status="active",
        raw_path=None,
        raw_source_uri=None,
        raw_asset_id=None,
        raw_version_id=None,
        provider_response_object_key=None,
        additional_processed_object_keys=(),
        title=title,
        year=None,
    )


def serialize_document_units(
    *,
    document: Mapping[str, Any],
    target_document_id: str,
    version_id: str,
    semantic_content_hash: str,
) -> bytes:
    target_collection = _required_text(document.get("target_collection"), "target_collection")
    title = _required_text(document.get("title"), "title")
    body_chunks = _canonical_body_chunks(
        _required_text(document.get("canonical_markdown"), "canonical_markdown")
    )
    source_notice_ids = [str(item) for item in document.get("source_notice_ids") or () if str(item)]
    source_document_ids = [
        str(item) for item in document.get("source_document_ids") or () if str(item)
    ]
    source_notice_id = source_notice_ids[0] if source_notice_ids else ""
    source_document_id = source_document_ids[0] if source_document_ids else ""
    source_notice_document_id = f"notice:muc_internal_portal:{source_notice_id}"
    normalization_quality = _normalization_quality(document)
    normalizer_version = str(
        normalization_quality.get("normalizer_version")
        or REGULATION_CANONICAL_NORMALIZER_VERSION
    )
    cleaning_policy_version = f"{target_collection}_cleaning_v1"
    common_metadata = {
        "title": title,
        "promotion_source_collection": "authenticated_documents/file_release_source",
        "source_notice_ids": source_notice_ids,
        "source_document_ids": source_document_ids,
        "source_notice_document_id": source_notice_document_id,
        "semantic_owner_document_id": source_document_id or source_notice_document_id,
        "semantic_owner_kind": "attachment_document" if source_document_id else "notice_body",
        "source_attachment_document_id": source_document_id,
        "regulation_title_normalized": title,
        "source_title_literal": title,
        "semantic_content_hash": semantic_content_hash,
        "normalizer_version": normalizer_version,
        "cleaning_policy_version": cleaning_policy_version,
        "document_units_schema_version": _DOCUMENT_UNITS_SCHEMA_VERSION,
        "normalization_quality": normalization_quality,
    }
    if target_collection == INSTITUTIONAL_TARGET_COLLECTION:
        title_unit_type = "regulation_title"
        body_unit_type = "regulation_body"
        title_content_role = "regulation_title"
        body_content_role = "regulation_body"
        collection_metadata = {
            "content_kind": "institutional_regulation",
            "promotion_class": "formal_regulation",
            "regulation_work_title": title,
            "regulation_display_title": title,
        }
    else:
        title_unit_type = "scoped_rule_title"
        body_unit_type = "scoped_rule_body"
        title_content_role = "scoped_rule_title"
        body_content_role = "scoped_rule_body"
        collection_metadata = {
            "content_kind": "scoped_rule",
            "document_nature": _resolve_scoped_rule_document_nature(document),
            "source_notice_release_time": str(document.get("generated_at") or "unknown"),
        }
    rows = [
        _document_unit_row(
            document_id=target_document_id,
            version_id=version_id,
            index=1,
            unit_type=title_unit_type,
            text=title,
            title=title,
            source_url=_source_url(document),
            metadata={
                **common_metadata,
                **collection_metadata,
                "content_role": title_content_role,
                "section_path": [title],
            },
        )
    ]
    for offset, chunk in enumerate(body_chunks, start=2):
        heading = chunk.splitlines()[0].strip() if chunk.splitlines() else title
        rows.append(
            _document_unit_row(
                document_id=target_document_id,
                version_id=version_id,
                index=offset,
                unit_type=body_unit_type,
                text=chunk,
                title=title,
                source_url=_source_url(document),
                metadata={
                    **common_metadata,
                    **collection_metadata,
                    "content_role": body_content_role,
                    "section_path": [title, heading],
                },
            )
        )
    return "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows).encode("utf-8")


def _document_unit_row(
    *,
    document_id: str,
    version_id: str,
    index: int,
    unit_type: str,
    text: str,
    title: str,
    source_url: str,
    metadata: Mapping[str, Any],
) -> dict[str, Any]:
    row_id = f"{document_id}:unit-{index:04d}"
    section_path = list(metadata.get("section_path") or [title])
    return {
        "doc_id": document_id,
        "version_id": version_id,
        "chunk_id": row_id,
        "row_id": row_id,
        "row_type": "paragraph" if index > 1 else "heading",
        "clean_text": text.strip(),
        "source_pdf": source_url.rsplit("/", 1)[-1] if source_url else "source.pdf",
        "source_url": source_url,
        "source": {"id": source_url},
        "page_start": 1,
        "page_end": 1,
        "entitlement_groups": ["campus_members"],
        "visibility_scope": "campus",
        "visibility_level": "restricted",
        "policy_projection_version": DEFAULT_POLICY_PROJECTION_VERSION,
        "unit_type": unit_type,
        "root_unit_id": row_id,
        "anchor": {"section_path": section_path, "page_start": 1, "page_end": 1},
        "metadata": dict(metadata),
    }


def _canonical_body_chunks(canonical_markdown: str) -> tuple[str, ...]:
    lines = canonical_markdown.strip().splitlines()
    if lines and lines[0].startswith("# "):
        body = "\n".join(lines[1:]).strip()
    else:
        body = canonical_markdown.strip()
    if not body:
        return ()
    starts = [match.start() for match in _ARTICLE_OR_CHAPTER_RE.finditer(body)]
    if not starts:
        return (body,)
    chunks: list[str] = []
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(body)
        chunk = body[start:end].strip()
        if chunk:
            chunks.append(chunk)
    prefix = body[: starts[0]].strip()
    if prefix and chunks:
        chunks[0] = f"{prefix}\n\n{chunks[0]}"
    return tuple(chunks)


def _resolve_scoped_rule_document_nature(document: Mapping[str, Any]) -> str:
    del document
    return "time_bound_operational_rule"


def _normalization_quality(document: Mapping[str, Any]) -> dict[str, Any]:
    quality = document.get("normalization_quality")
    if not isinstance(quality, Mapping):
        return {
            "quality_verdict": "unknown",
            "normalizer_version": REGULATION_CANONICAL_NORMALIZER_VERSION,
            "reason_codes": ["missing_normalization_quality"],
        }
    return dict(quality)


def _source_url(document: Mapping[str, Any]) -> str:
    urls = [str(item).strip() for item in document.get("source_urls") or () if str(item).strip()]
    if urls:
        return urls[0]
    source_notice_ids = [str(item) for item in document.get("source_notice_ids") or () if str(item)]
    if source_notice_ids:
        return f"campusrag://collected-notice/{source_notice_ids[0]}"
    return f"campusrag://collected-notice/{document.get('target_document_id')}"


def _required_text(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} is required")
    return value.strip()


__all__ = [
    "INSTITUTIONAL_TARGET_COLLECTION",
    "PHASE_09_ID",
    "SCOPED_TARGET_COLLECTION",
    "build_document_import_input",
    "serialize_document_units",
]
