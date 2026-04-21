from __future__ import annotations

import hashlib
import json
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from campus_ingestion_core.authenticated_notice_defaults import (
    DEFAULT_AUTHENTICATED_NOTICE_CORPUS,
)
from campus_ingestion_core.object_store import build_raw_asset_key

AUTHENTICATED_NOTICE_SOURCE_CHANNEL = "authenticated_notice_portal"
AUTHENTICATED_NOTICE_MANIFEST_SCHEMA = "authenticated_notice_manifest_v1"
AUTHENTICATED_NOTICE_BLOCK_SCHEMA = "authenticated_notice_block_v1"
AUTHENTICATED_NOTICE_ATTACHMENT_REF_SCHEMA = "authenticated_notice_attachment_ref_v1"


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeSourceMaterial:
    notice_id: str
    raw_asset_id: str
    raw_version_id: str
    source_uri: str
    source_home_url: str
    title: str
    year: str | None
    capture_artifacts: dict[str, bytes]
    provider_artifacts: dict[str, bytes]
    source_truth_artifacts: dict[str, bytes]
    content_blocks: tuple[dict[str, Any], ...]
    attachment_refs: tuple[dict[str, Any], ...]
    canonical_markdown_bytes: bytes
    document_units_bytes: bytes


def build_authenticated_notice_raw_asset_id(site_id: str, notice_id: str | int) -> str:
    return f"asset:authenticated-notice:{site_id.strip()}:{str(notice_id).strip()}"


def build_authenticated_notice_raw_version_id(bundle_record: dict[str, Any]) -> str:
    notice = _notice_payload(bundle_record)
    categories = tuple(_category_pairs(notice))
    attachments = tuple(
        sorted(
            (
                str(
                    attachment.get("normalized_source_url") or attachment.get("source_url") or ""
                ).strip(),
                str(relation.get("resource_role") or "").strip(),
            )
            for attachment, relation in _joined_attachments(bundle_record)
        )
    )
    payload = {
        "title": str(notice.get("notice_title") or "").strip(),
        "html": str(notice.get("notice_content") or ""),
        "categories": categories,
        "attachments": attachments,
    }
    digest = hashlib.sha256(
        json.dumps(payload, ensure_ascii=False, sort_keys=True).encode("utf-8")
    ).hexdigest()
    return f"sha256:{digest}"


def infer_authenticated_notice_year(*, notice: dict[str, Any]) -> str | None:
    return _infer_year_label(notice.get("notice_release_time") or notice.get("notice_create_time"))


def build_authenticated_notice_attachment_capture_key(
    *,
    content_sha256: str,
    filename: str,
    year: str | None,
    corpus: str = DEFAULT_AUTHENTICATED_NOTICE_CORPUS,
) -> str:
    digest = str(content_sha256).strip().lower()
    if not digest:
        raise ValueError("content_sha256 is required")
    return build_raw_asset_key(
        corpus=corpus,
        raw_asset_id=f"asset:authenticated-notice-attachment:attachment-{digest[:12]}",
        raw_version_id=f"sha256:{digest}",
        filename=_normalize_attachment_filename(filename=filename),
        source_channel=AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
        year=year,
    )


def resolve_authenticated_notice_attachment_object_key(
    *,
    attachment: dict[str, Any],
    year: str | None,
    corpus: str = DEFAULT_AUTHENTICATED_NOTICE_CORPUS,
) -> str | None:
    object_key = _optional_text(attachment.get("object_key"))
    if object_key is None:
        return None
    content_sha256 = _optional_text(attachment.get("sha256"))
    if content_sha256 is None:
        return object_key
    return build_authenticated_notice_attachment_capture_key(
        content_sha256=content_sha256,
        filename=_normalize_attachment_filename(
            filename=attachment.get("original_filename"),
            fallback_key=object_key,
        ),
        year=year,
        corpus=corpus,
    )


def _json_bytes(payload: object) -> bytes:
    return (json.dumps(payload, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def _jsonl_bytes(rows: tuple[dict[str, Any], ...] | list[dict[str, Any]]) -> bytes:
    return (
        "\n".join(json.dumps(row, ensure_ascii=False) for row in rows).strip() + "\n"
        if rows
        else ""
    ).encode("utf-8")


def _notice_payload(bundle_record: dict[str, Any]) -> dict[str, Any]:
    notice = bundle_record.get("notice")
    if not isinstance(notice, dict):
        raise ValueError("bundle record is missing notice payload")
    return notice


def _links_payload(bundle_record: dict[str, Any]) -> tuple[dict[str, Any], ...]:
    links = bundle_record.get("links") or ()
    return tuple(item for item in links if isinstance(item, dict))


def _attachments_payload(bundle_record: dict[str, Any]) -> tuple[dict[str, Any], ...]:
    attachments = bundle_record.get("attachments") or ()
    return tuple(item for item in attachments if isinstance(item, dict))


def _notice_attachments_payload(bundle_record: dict[str, Any]) -> tuple[dict[str, Any], ...]:
    relations = bundle_record.get("notice_attachments") or ()
    return tuple(item for item in relations if isinstance(item, dict))


def _joined_attachments(
    bundle_record: dict[str, Any],
) -> tuple[tuple[dict[str, Any], dict[str, Any]], ...]:
    attachments_by_id = {
        item.get("attachment_id"): item
        for item in _attachments_payload(bundle_record)
        if item.get("attachment_id") is not None
    }
    joined: list[tuple[dict[str, Any], dict[str, Any]]] = []
    for relation in _notice_attachments_payload(bundle_record):
        attachment = attachments_by_id.get(relation.get("attachment_id"))
        if attachment is None:
            continue
        joined.append((attachment, relation))
    return tuple(joined)


def _category_pairs(notice: dict[str, Any]) -> tuple[tuple[str, str], ...]:
    categories = notice.get("categories") or ()
    pairs: list[tuple[str, str]] = []
    for category in categories:
        if not isinstance(category, dict):
            continue
        category_id = str(category.get("notice_type") or "").strip()
        category_name = str(category.get("notice_type_name") or "").strip()
        if category_id or category_name:
            pairs.append((category_id, category_name))
    return tuple(pairs)


def _exported_at(export_manifest: dict[str, Any] | None) -> str:
    candidate = _optional_text((export_manifest or {}).get("exported_at"))
    if candidate is not None:
        return candidate
    return datetime.now(timezone.utc).isoformat()


def _content_kind_for_relation(
    *,
    bundle_record: dict[str, Any],
    relation: dict[str, Any],
) -> str | None:
    link_id = relation.get("link_id")
    if link_id is None:
        return None
    for link in _links_payload(bundle_record):
        if link.get("id") == link_id:
            return _optional_text(link.get("content_kind"))
    return None


def _infer_year_label(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    match = re.search(r"(?<!\d)((?:19|20)\d{2})(?!\d)", value)
    if match is None:
        return None
    return match.group(1)


def _fetcher_version(export_manifest: dict[str, Any] | None) -> str:
    manifest = dict(export_manifest or {})
    normalizer = manifest.get("normalizer")
    if isinstance(normalizer, dict):
        version = str(
            normalizer.get("normalizer_version") or normalizer.get("schema_version") or ""
        ).strip()
        if version:
            return version
    return str(manifest.get("schema_version") or "unknown")


def _collector_version(export_manifest: dict[str, Any] | None) -> str:
    manifest = dict(export_manifest or {})
    collector = manifest.get("collector")
    if isinstance(collector, dict):
        version = str(
            collector.get("export_contract_version") or collector.get("runtime_shell") or ""
        ).strip()
        if version:
            return version
    return str(manifest.get("schema_version") or "unknown")


def _optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_attachment_filename(
    *,
    filename: object,
    fallback_key: str | None = None,
) -> str:
    value = str(filename or "").strip()
    fallback = str(fallback_key or "").strip()
    candidate_source = value or fallback
    candidate = Path(candidate_source.replace("\\", "/")).name.strip().replace("/", "_")
    return candidate or "attachment"
