from __future__ import annotations

import hashlib
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
from campus_ingestion_core.regulation_document_units import (
    INSTITUTIONAL_TARGET_COLLECTION,
    SCOPED_TARGET_COLLECTION,
    regulation_common_metadata,
    serialize_regulation_document_units,
)

PHASE_09_ID = "phase-09-first-batch-regulation-promotion-write-gate"

_TARGET_IMPORT_SOURCE = "collected_notice_regulation_first_batch_promotion"
_TARGET_SOURCE_CHANNEL = "authenticated_notice_portal"


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
    source_notice_ids = [str(item) for item in document.get("source_notice_ids") or () if str(item)]
    source_document_ids = [
        str(item) for item in document.get("source_document_ids") or () if str(item)
    ]
    source_notice_id = source_notice_ids[0] if source_notice_ids else ""
    source_document_id = source_document_ids[0] if source_document_ids else ""
    source_notice_document_id = f"notice:muc_internal_portal:{source_notice_id}"
    source_attachment_document_id = _resolve_source_attachment_document_id(
        document=document,
        source_document_id=source_document_id,
    )
    semantic_owner_kind = "attachment_document" if source_attachment_document_id else "notice_body"
    semantic_owner_document_id = source_attachment_document_id or source_notice_document_id
    normalization_quality = _normalization_quality(document)
    normalizer_version = str(
        normalization_quality.get("normalizer_version") or REGULATION_CANONICAL_NORMALIZER_VERSION
    )
    cleaning_policy_version = f"{target_collection}_cleaning_v1"
    common_metadata = regulation_common_metadata(
        title=title,
        title_base=title,
        title_raw=title,
        normalizer_version=normalizer_version,
        cleaning_policy_version=cleaning_policy_version,
        normalization_quality=normalization_quality,
        extra_metadata={
            "promotion_source_collection": "authenticated_documents/file_release_source",
            "source_notice_ids": source_notice_ids,
            "source_document_ids": source_document_ids,
            "source_notice_document_id": source_notice_document_id,
            "semantic_owner_document_id": semantic_owner_document_id,
            "semantic_owner_kind": semantic_owner_kind,
            "source_attachment_document_id": source_attachment_document_id,
            "regulation_title_normalized": title,
            "source_title_literal": title,
        },
    )
    if target_collection == INSTITUTIONAL_TARGET_COLLECTION:
        collection_metadata = {
            "content_kind": "institutional_regulation",
            "promotion_class": "formal_regulation",
            "regulation_work_title": title,
            "regulation_display_title": title,
        }
    else:
        collection_metadata = {
            "content_kind": "scoped_rule",
            "document_nature": _resolve_scoped_rule_document_nature(document),
            "source_notice_release_time": _resolve_source_notice_release_time(document),
            "cycle_year": _resolve_cycle_year(document),
            "school_unit_name": _resolve_school_unit_name(document),
        }
    return serialize_regulation_document_units(
        target_collection=target_collection,
        target_document_id=target_document_id,
        version_id=version_id,
        title=title,
        canonical_markdown=_required_text(document.get("canonical_markdown"), "canonical_markdown"),
        source_url=_source_url(document),
        visibility_level="restricted",
        visibility_scope="campus",
        entitlement_groups=["campus_members"],
        common_metadata={**common_metadata, **collection_metadata},
        semantic_content_hash=semantic_content_hash,
    )


def _resolve_scoped_rule_document_nature(document: Mapping[str, Any]) -> str:
    value = str(document.get("document_nature") or "").strip()
    if value:
        return value
    target_hints = document.get("target_hints")
    if isinstance(target_hints, Mapping):
        value = str(target_hints.get("document_nature") or "").strip()
        if value:
            return value
    return "time_bound_operational_rule"


def _resolve_source_notice_release_time(document: Mapping[str, Any]) -> str:
    for field_name in ("source_notice_release_time", "notice_release_time", "published_date"):
        value = str(document.get(field_name) or "").strip()
        if value:
            return value
    return "unknown"


def _resolve_cycle_year(document: Mapping[str, Any]) -> str | None:
    for value in (
        document.get("cycle_year"),
        _target_hint_value(document, "cycle_year"),
        document.get("source_notice_release_time"),
        document.get("notice_release_time"),
        document.get("published_date"),
        document.get("title"),
    ):
        match = re.search(r"(?:19|20)\d{2}", str(value or ""))
        if match is not None:
            return match.group(0)
    return None


def _resolve_school_unit_name(document: Mapping[str, Any]) -> str | None:
    for value in (
        document.get("school_unit_name"),
        _target_hint_value(document, "school_unit_name"),
        document.get("issuing_org"),
        document.get("title"),
    ):
        normalized = str(value or "").strip()
        if normalized:
            return normalized
    return None


def _target_hint_value(document: Mapping[str, Any], key: str) -> object:
    target_hints = document.get("target_hints")
    if not isinstance(target_hints, Mapping):
        return None
    return target_hints.get(key)


def _normalization_quality(document: Mapping[str, Any]) -> dict[str, Any]:
    quality = document.get("normalization_quality")
    if not isinstance(quality, Mapping):
        return {
            "quality_verdict": "unknown",
            "normalizer_version": REGULATION_CANONICAL_NORMALIZER_VERSION,
            "reason_codes": ["missing_normalization_quality"],
        }
    return dict(quality)


def _resolve_source_attachment_document_id(
    *,
    document: Mapping[str, Any],
    source_document_id: str,
) -> str:
    if not source_document_id:
        return ""
    source_scope = document.get("source_scope")
    source_surface = (
        str(source_scope.get("source_surface") or "").strip()
        if isinstance(source_scope, Mapping)
        else ""
    )
    if source_surface == "notice_body":
        return ""
    if source_document_id.startswith(("notice_attachment:", "file-release:")):
        return source_document_id
    return ""


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
