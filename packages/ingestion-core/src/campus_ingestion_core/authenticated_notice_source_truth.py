from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
from html import unescape
import json
from pathlib import Path
import re
from typing import Any

from campus_ingestion_core.authenticated_notice_defaults import (
    DEFAULT_AUTHENTICATED_NOTICE_CORPUS,
)
from campus_ingestion_core.object_store import build_raw_asset_key


AUTHENTICATED_NOTICE_SOURCE_CHANNEL = "authenticated_notice_portal"
AUTHENTICATED_NOTICE_MANIFEST_SCHEMA = "authenticated_notice_manifest_v1"
AUTHENTICATED_NOTICE_BLOCK_SCHEMA = "authenticated_notice_block_v1"
AUTHENTICATED_NOTICE_ATTACHMENT_REF_SCHEMA = "authenticated_notice_attachment_ref_v1"
_ATTACHMENT_REFERENCE_KEYWORDS = ("附件：", "附件:", "见附件", "详见附件", "参见附件")
_FILE_RELEASE_REFERENCE_KEYWORDS = (
    "信息门户-文件发布",
    "文件发布",
    "自行下载",
    "下载参照执行",
    "下载后参照执行",
)
_WRAPPER_NOTICE_PREFIXES = ("关于发布", "关于印发", "关于修订", "关于转发", "关于公布")
_WRAPPER_NOTICE_KEYWORDS = ("通知", "现将", "予以发布", "予以印发", "请遵照执行", "转发")
_QUOTE_TITLE_RE = re.compile(r"《([^》]{2,200})》")

_HTML_BLOCK_RE = re.compile(r"<(h[1-6]|p|li|table)\b[^>]*>(.*?)</\1>", re.IGNORECASE | re.DOTALL)
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"\s+")


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
                str(attachment.get("normalized_source_url") or attachment.get("source_url") or "").strip(),
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


def prepare_authenticated_notice_source_material(
    *,
    bundle_record: dict[str, Any],
    export_manifest: dict[str, Any] | None,
    site_id: str,
    source_home_url: str,
) -> AuthenticatedNoticeSourceMaterial:
    notice = _notice_payload(bundle_record)
    notice_id = str(notice.get("notice_id") or bundle_record.get("notice_id") or "").strip()
    if not notice_id:
        raise ValueError("notice_id is required")
    title = str(notice.get("notice_title") or "").strip()
    if not title:
        raise ValueError("notice_title is required")
    raw_asset_id = build_authenticated_notice_raw_asset_id(site_id, notice_id)
    raw_version_id = build_authenticated_notice_raw_version_id(bundle_record)
    source_uri = str(notice.get("notice_link") or f"campusnotice://{site_id}/notice/{notice_id}").strip()
    source_home_url = source_home_url.strip()
    if not source_home_url:
        raise ValueError("source_home_url is required")
    year = infer_authenticated_notice_year(notice=notice)

    content_blocks = _build_content_blocks(
        title=title,
        html_value=str(notice.get("notice_content") or ""),
        links=tuple(_links_payload(bundle_record)),
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
    )
    attachment_refs = _build_attachment_refs(
        bundle_record=bundle_record,
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        notice_id=notice_id,
    )
    capture_artifacts = _build_capture_artifacts(bundle_record=bundle_record, export_manifest=export_manifest)
    provider_artifacts = _build_provider_artifacts(bundle_record=bundle_record)
    source_truth_artifacts = _build_source_truth_artifacts(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        site_id=site_id,
        notice_id=notice_id,
        source_uri=source_uri,
        source_home_url=source_home_url,
        title=title,
        notice=notice,
        export_manifest=export_manifest,
        content_blocks=content_blocks,
        attachment_refs=attachment_refs,
    )
    canonical_markdown_bytes, document_units_bytes = build_authenticated_notice_notice_document_artifacts(
        document_id=f"notice:{site_id}:{notice_id}",
        version_id=raw_version_id,
        source_uri=source_uri,
        title=title,
        content_blocks=content_blocks,
    )
    return AuthenticatedNoticeSourceMaterial(
        notice_id=notice_id,
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        source_uri=source_uri,
        source_home_url=source_home_url,
        title=title,
        year=year,
        capture_artifacts=capture_artifacts,
        provider_artifacts=provider_artifacts,
        source_truth_artifacts=source_truth_artifacts,
        content_blocks=content_blocks,
        attachment_refs=attachment_refs,
        canonical_markdown_bytes=canonical_markdown_bytes,
        document_units_bytes=document_units_bytes,
    )


def build_authenticated_notice_notice_document_artifacts(
    *,
    document_id: str,
    version_id: str,
    source_uri: str,
    title: str,
    content_blocks: tuple[dict[str, Any], ...],
) -> tuple[bytes, bytes]:
    canonical_markdown_bytes = _build_canonical_markdown(
        title=title,
        content_blocks=content_blocks,
    )
    document_units_bytes = _build_document_units(
        document_id=document_id,
        version_id=version_id,
        source_uri=source_uri,
        content_blocks=content_blocks,
    )
    return canonical_markdown_bytes, document_units_bytes


def _build_capture_artifacts(
    *,
    bundle_record: dict[str, Any],
    export_manifest: dict[str, Any] | None,
) -> dict[str, bytes]:
    notice = _notice_payload(bundle_record)
    list_payload = {
        "notice_id": notice.get("notice_id") or bundle_record.get("notice_id"),
        "notice_title": notice.get("notice_title"),
        "organization_name": notice.get("organization_name"),
        "organization_id": notice.get("organization_id"),
        "notice_release_time": notice.get("notice_release_time"),
        "notice_create_time": notice.get("notice_create_time"),
        "notice_first_time": notice.get("notice_first_time"),
        "notice_link": notice.get("notice_link"),
        "notice_source": notice.get("notice_source"),
        "notice_link_state": notice.get("notice_link_state"),
        "notice_state": notice.get("notice_state"),
        "notice_stick": notice.get("notice_stick"),
        "categories": notice.get("categories") or [],
    }
    detail_payload = {
        "notice": notice,
        "links": list(_links_payload(bundle_record)),
        "notice_attachments": list(_notice_attachments_payload(bundle_record)),
        "attachments": list(_attachments_payload(bundle_record)),
    }
    fetch_metadata = {
        "schema_version": "authenticated_notice_fetch_metadata_v1",
        "captured_at": _exported_at(export_manifest),
        "export_manifest": export_manifest or {},
    }
    return {
        "capture/list-response.json": _json_bytes(list_payload),
        "capture/detail-response.json": _json_bytes(detail_payload),
        "capture/fetch-metadata.json": _json_bytes(fetch_metadata),
    }


def _build_provider_artifacts(
    *,
    bundle_record: dict[str, Any],
) -> dict[str, bytes]:
    notice = _notice_payload(bundle_record)
    normalized_notice = {
        "schema_version": "authenticated_notice_normalized_notice_v1",
        "notice_id": notice.get("notice_id") or bundle_record.get("notice_id"),
        "notice_title": notice.get("notice_title"),
        "organization_name": notice.get("organization_name"),
        "organization_id": notice.get("organization_id"),
        "notice_release_time": notice.get("notice_release_time"),
        "notice_create_time": notice.get("notice_create_time"),
        "notice_first_time": notice.get("notice_first_time"),
        "notice_link": notice.get("notice_link"),
        "notice_source": notice.get("notice_source"),
        "notice_link_state": notice.get("notice_link_state"),
        "notice_state": notice.get("notice_state"),
        "notice_stick": notice.get("notice_stick"),
        "notice_type_ids": [item[0] for item in _category_pairs(notice)],
        "notice_type_names": [item[1] for item in _category_pairs(notice)],
        "notice_content_html": notice.get("notice_content"),
    }
    discovered_links = tuple(_links_payload(bundle_record))
    attachment_observations = tuple(
        {
            "attachment_id": attachment.get("attachment_id"),
            "link_id": relation.get("link_id"),
            "source_url": attachment.get("source_url"),
            "normalized_source_url": attachment.get("normalized_source_url"),
            "final_url": attachment.get("final_url"),
            "resource_role": relation.get("resource_role"),
            "relation_source": relation.get("relation_source"),
            "anchor_text": relation.get("anchor_text"),
            "object_key": resolve_authenticated_notice_attachment_object_key(
                attachment=attachment,
                year=infer_authenticated_notice_year(notice=notice),
            ),
            "content_sha256": attachment.get("sha256"),
            "mime_type": attachment.get("mime_type"),
            "byte_size": attachment.get("byte_size"),
            "origin_scope": attachment.get("origin_scope"),
            "provenance_status": attachment.get("provenance_status"),
        }
        for attachment, relation in _joined_attachments(bundle_record)
    )
    return {
        "provider/normalized-notice.json": _json_bytes(normalized_notice),
        "provider/discovered-links.jsonl": _jsonl_bytes(discovered_links),
        "provider/attachment-observations.jsonl": _jsonl_bytes(attachment_observations),
    }


def _build_source_truth_artifacts(
    *,
    raw_asset_id: str,
    raw_version_id: str,
    site_id: str,
    notice_id: str,
    source_uri: str,
    source_home_url: str,
    title: str,
    notice: dict[str, Any],
    export_manifest: dict[str, Any] | None,
    content_blocks: tuple[dict[str, Any], ...],
    attachment_refs: tuple[dict[str, Any], ...],
) -> dict[str, bytes]:
    category_pairs = _category_pairs(notice)
    owner_expectations = _build_owner_expectations(
        title=title,
        content_blocks=content_blocks,
        attachment_refs=attachment_refs,
    )
    notice_manifest = {
        "schema_version": AUTHENTICATED_NOTICE_MANIFEST_SCHEMA,
        "source_channel": AUTHENTICATED_NOTICE_SOURCE_CHANNEL,
        "site_id": site_id,
        "notice_id": notice_id,
        "raw_asset_id": raw_asset_id,
        "raw_version_id": raw_version_id,
        "captured_at": _exported_at(export_manifest),
        "list_observed_at": _optional_text(notice.get("last_seen_at")) or _exported_at(export_manifest),
        "detail_observed_at": _optional_text(notice.get("enrich_attempted_at")) or _exported_at(export_manifest),
        "fetcher_name": "authenticated_notice_bundle_import",
        "fetcher_version": _fetcher_version(export_manifest),
        "collector_version": _collector_version(export_manifest),
        "credentials_mode": "authenticated",
        "notice_title_raw": title,
        "notice_title_normalized": title,
        "organization_name": _optional_text(notice.get("organization_name")),
        "organization_id": _optional_text(notice.get("organization_id")),
        "notice_release_time": _optional_text(notice.get("notice_release_time")),
        "notice_create_time": _optional_text(notice.get("notice_create_time")),
        "notice_first_time": _optional_text(notice.get("notice_first_time")),
        "notice_source": notice.get("notice_source"),
        "notice_link_state": notice.get("notice_link_state"),
        "notice_state": notice.get("notice_state"),
        "notice_stick": notice.get("notice_stick"),
        "notice_type_ids": [item[0] for item in category_pairs],
        "notice_type_names": [item[1] for item in category_pairs],
        "source_notice_link": source_uri,
        "source_home_url": source_home_url,
        "body_html_hash": hashlib.sha256(str(notice.get("notice_content") or "").encode("utf-8")).hexdigest(),
        "block_count": len(content_blocks),
        "link_count": sum(1 for row in content_blocks if row.get("block_role") == "link"),
        "attachment_ref_count": len(attachment_refs),
        "owner_expectation_count": len(owner_expectations),
        "owner_expectations": [dict(item) for item in owner_expectations],
    }
    return {
        "source-truth/notice-manifest.json": _json_bytes(notice_manifest),
        "source-truth/content-blocks.jsonl": _jsonl_bytes(content_blocks),
        "source-truth/attachment-refs.jsonl": _jsonl_bytes(attachment_refs),
    }


def _build_content_blocks(
    *,
    title: str,
    html_value: str,
    links: tuple[dict[str, Any], ...],
    raw_asset_id: str,
    raw_version_id: str,
) -> tuple[dict[str, Any], ...]:
    rows: list[dict[str, Any]] = []
    heading_path: list[str] = []

    def append_block(
        *,
        block_role: str,
        text: str,
        heading_level: int | None = None,
        link_target: str | None = None,
        link_text: str | None = None,
    ) -> None:
        normalized_text = _normalize_text(text)
        if not normalized_text:
            return
        row_id = f"block-{len(rows) + 1:04d}"
        parent_heading_path = tuple(heading_path)
        rows.append(
            {
                "schema_version": AUTHENTICATED_NOTICE_BLOCK_SCHEMA,
                "raw_asset_id": raw_asset_id,
                "raw_version_id": raw_version_id,
                "row_id": row_id,
                "row_index": len(rows),
                "block_order": len(rows) + 1,
                "block_role": block_role,
                "heading_level": heading_level,
                "parent_heading_path": list(parent_heading_path),
                "list_level": None,
                "table_id": None,
                "table_row_index": None,
                "table_col_index": None,
                "text_raw": text.strip(),
                "text_normalized": normalized_text,
                "html_fragment": None,
                "link_target": link_target,
                "link_text": link_text,
                "table_html": None,
                "table_cells": None,
            }
        )

    append_block(block_role="title", text=title, heading_level=1)

    parsed_blocks = _html_blocks(html_value)
    for block in parsed_blocks:
        if block["text_normalized"] == _normalize_text(title):
            continue
        if block["block_role"] == "heading":
            heading_level = int(block.get("heading_level") or 2)
            while len(heading_path) >= heading_level:
                heading_path.pop()
            heading_path.append(block["text_normalized"])
            append_block(
                block_role="heading",
                text=block["text_raw"],
                heading_level=heading_level,
            )
            continue
        append_block(
            block_role=str(block["block_role"]),
            text=str(block["text_raw"]),
        )

    for link in links:
        link_target = _optional_text(link.get("final_url")) or _optional_text(link.get("url"))
        link_text = _optional_text(link.get("link_text")) or link_target
        if not link_target:
            continue
        append_block(
            block_role="link",
            text=link_text or link_target,
            link_target=link_target,
            link_text=link_text,
        )

    return tuple(rows)


def _build_attachment_refs(
    *,
    bundle_record: dict[str, Any],
    raw_asset_id: str,
    raw_version_id: str,
    notice_id: str,
) -> tuple[dict[str, Any], ...]:
    rows: list[dict[str, Any]] = []
    for index, (attachment, relation) in enumerate(_joined_attachments(bundle_record), start=1):
        rows.append(
            {
                "schema_version": AUTHENTICATED_NOTICE_ATTACHMENT_REF_SCHEMA,
                "raw_asset_id": raw_asset_id,
                "raw_version_id": raw_version_id,
                "attachment_ref_id": f"attachment-{index:04d}",
                "ref_order": index,
                "notice_id": notice_id,
                "relation_source": relation.get("relation_source"),
                "resource_role": relation.get("resource_role"),
                "content_kind": _content_kind_for_relation(
                    bundle_record=bundle_record,
                    relation=relation,
                ),
                "anchor_text": _optional_text(relation.get("anchor_text")),
                "original_filename": _optional_text(attachment.get("original_filename")),
                "source_url": _optional_text(attachment.get("source_url")),
                "normalized_source_url": _optional_text(attachment.get("normalized_source_url")),
                "final_url": _optional_text(attachment.get("final_url")),
                "origin_scope": _optional_text(attachment.get("origin_scope")),
                "object_key": resolve_authenticated_notice_attachment_object_key(
                    attachment=attachment,
                    year=infer_authenticated_notice_year(notice=_notice_payload(bundle_record)),
                ),
                "content_sha256": _optional_text(attachment.get("sha256")),
                "mime_type": _optional_text(attachment.get("mime_type")),
                "byte_size": attachment.get("byte_size"),
                "storage_provider": _optional_text(attachment.get("storage_provider")),
                "ingest_status": _optional_text(attachment.get("ingest_status")),
            }
        )
    return tuple(rows)


def _build_owner_expectations(
    *,
    title: str,
    content_blocks: tuple[dict[str, Any], ...],
    attachment_refs: tuple[dict[str, Any], ...],
) -> tuple[dict[str, Any], ...]:
    if attachment_refs:
        return ()
    title_hint = _extract_quoted_title(title)
    body_lines = _body_lines_for_owner_expectations(content_blocks)
    combined_body = "\n".join(body_lines)
    wrapper_like = _looks_like_wrapper_notice(title=title, body=combined_body)
    rows: list[dict[str, Any]] = []
    seen: set[tuple[str, str, str, str]] = set()

    def append_expectation(
        *,
        owner_kind: str,
        relation_type: str,
        evidence_reason: str,
        owner_title_hint: str | None,
        evidence_text: str,
    ) -> None:
        normalized_title_hint = _optional_text(owner_title_hint) or ""
        normalized_evidence_text = _optional_text(evidence_text) or ""
        dedupe_key = (
            owner_kind,
            relation_type,
            normalized_title_hint,
            normalized_evidence_text,
        )
        if dedupe_key in seen:
            return
        seen.add(dedupe_key)
        rows.append(
            {
                "owner_expectation_id": f"owner-expectation-{len(rows) + 1:04d}",
                "owner_kind": owner_kind,
                "relation_type": relation_type,
                "evidence_reason": evidence_reason,
                "owner_title_hint": _optional_text(owner_title_hint),
                "evidence_text": normalized_evidence_text,
            }
        )

    for line in body_lines:
        if _looks_like_attachment_owner_signal(line):
            append_expectation(
                owner_kind="attachment_document",
                relation_type="attachment_ref",
                evidence_reason="attachment_anchor_detected",
                owner_title_hint=_extract_owner_title_hint(line) or title_hint,
                evidence_text=line,
            )
            continue
        if _looks_like_file_release_reference(line) and (wrapper_like or title_hint):
            append_expectation(
                owner_kind="file_release_document",
                relation_type="file_release_ref",
                evidence_reason="file_release_reference_detected",
                owner_title_hint=_extract_owner_title_hint(line) or title_hint,
                evidence_text=line,
            )

    return tuple(rows)


def _body_lines_for_owner_expectations(
    content_blocks: tuple[dict[str, Any], ...],
) -> tuple[str, ...]:
    lines: list[str] = []
    for block in content_blocks:
        if str(block.get("block_role") or "") == "title":
            continue
        text = str(block.get("text_raw") or block.get("text_normalized") or "").strip()
        if not text:
            continue
        for line in text.splitlines():
            normalized_line = _optional_text(line)
            if normalized_line is not None:
                lines.append(normalized_line)
    return tuple(lines)


def _looks_like_attachment_owner_signal(line: str) -> bool:
    stripped = line.strip()
    if not stripped or "附件" not in stripped:
        return False
    return stripped.startswith("附件") or any(
        keyword in stripped for keyword in _ATTACHMENT_REFERENCE_KEYWORDS
    )


def _looks_like_file_release_reference(line: str) -> bool:
    stripped = line.strip()
    return bool(stripped) and any(
        keyword in stripped for keyword in _FILE_RELEASE_REFERENCE_KEYWORDS
    )


def _looks_like_wrapper_notice(*, title: str, body: str) -> bool:
    combined = "\n".join(item for item in (title, body) if item)
    if any(title.startswith(prefix) for prefix in _WRAPPER_NOTICE_PREFIXES):
        return True
    return any(keyword in combined for keyword in _WRAPPER_NOTICE_KEYWORDS)


def _extract_owner_title_hint(value: str) -> str | None:
    quoted_title = _extract_quoted_title(value)
    if quoted_title is not None:
        return quoted_title
    stripped = value.strip()
    if not stripped.startswith("附件"):
        return None
    remainder = re.sub(r"^附件\s*\d*\s*[:：]?\s*", "", stripped).strip()
    remainder = remainder.strip("：:。；;，, ")
    return _optional_text(remainder)


def _extract_quoted_title(value: str | None) -> str | None:
    text = _optional_text(value)
    if text is None:
        return None
    match = _QUOTE_TITLE_RE.search(text)
    if match is None:
        return None
    return _optional_text(match.group(1))


def _build_canonical_markdown(
    *,
    title: str,
    content_blocks: tuple[dict[str, Any], ...],
) -> bytes:
    lines = [f"# {title}"]
    for block in content_blocks[1:]:
        role = str(block.get("block_role") or "")
        text = str(block.get("text_normalized") or "").strip()
        if not text:
            continue
        if role == "heading":
            level = int(block.get("heading_level") or 2)
            lines.append(f"{'#' * max(level, 2)} {text}")
        elif role == "list_item":
            lines.append(f"- {text}")
        elif role == "link":
            target = str(block.get("link_target") or "").strip()
            if target:
                lines.append(f"- [{text}]({target})")
            else:
                lines.append(f"- {text}")
        else:
            lines.append(text)
    return ("\n\n".join(lines).strip() + "\n").encode("utf-8")


def _build_document_units(
    *,
    document_id: str,
    version_id: str,
    source_uri: str,
    content_blocks: tuple[dict[str, Any], ...],
) -> bytes:
    rows: list[dict[str, Any]] = []
    for block in content_blocks:
        text = str(block.get("text_normalized") or "").strip()
        if not text:
            continue
        role = str(block.get("block_role") or "policy_page")
        rows.append(
            {
                "doc_id": document_id,
                "version_id": version_id,
                "chunk_id": str(block.get("row_id") or ""),
                "root_unit_id": str(block.get("row_id") or ""),
                "unit_type": _unit_type_for_block(role),
                "text": text,
                "raw_text": str(block.get("text_raw") or text),
                "clean_text": text,
                "anchor": {
                    "block_order": block.get("block_order"),
                    "block_role": role,
                    "parent_heading_path": block.get("parent_heading_path") or [],
                    "source_uri": source_uri,
                    "link_target": block.get("link_target"),
                },
                "metadata": {
                    "block_role": role,
                    "heading_level": block.get("heading_level"),
                    "link_target": block.get("link_target"),
                    "link_text": block.get("link_text"),
                },
            }
        )
    return _jsonl_bytes(rows)


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


def _joined_attachments(bundle_record: dict[str, Any]) -> tuple[tuple[dict[str, Any], dict[str, Any]], ...]:
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


def _html_blocks(html_value: str) -> tuple[dict[str, Any], ...]:
    if not html_value.strip():
        return ()
    rows: list[dict[str, Any]] = []
    for match in _HTML_BLOCK_RE.finditer(html_value):
        tag = match.group(1).lower()
        inner_html = match.group(2)
        text = _strip_html(inner_html)
        if not text:
            continue
        if tag.startswith("h"):
            rows.append(
                {
                    "block_role": "heading",
                    "heading_level": int(tag[1]),
                    "text_raw": text,
                    "text_normalized": _normalize_text(text),
                }
            )
        elif tag == "li":
            rows.append(
                {
                    "block_role": "list_item",
                    "heading_level": None,
                    "text_raw": text,
                    "text_normalized": _normalize_text(text),
                }
            )
        elif tag == "table":
            rows.append(
                {
                    "block_role": "table",
                    "heading_level": None,
                    "text_raw": text,
                    "text_normalized": _normalize_text(text),
                }
            )
        else:
            rows.append(
                {
                    "block_role": "paragraph",
                    "heading_level": None,
                    "text_raw": text,
                    "text_normalized": _normalize_text(text),
                }
            )
    if rows:
        return tuple(rows)
    text = _strip_html(html_value)
    if not text:
        return ()
    return (
        {
            "block_role": "paragraph",
            "heading_level": None,
            "text_raw": text,
            "text_normalized": _normalize_text(text),
        },
    )


def _fetcher_version(export_manifest: dict[str, Any] | None) -> str:
    manifest = dict(export_manifest or {})
    normalizer = manifest.get("normalizer")
    if isinstance(normalizer, dict):
        version = str(
            normalizer.get("normalizer_version")
            or normalizer.get("schema_version")
            or ""
        ).strip()
        if version:
            return version
    return str(manifest.get("schema_version") or "unknown")


def _collector_version(export_manifest: dict[str, Any] | None) -> str:
    manifest = dict(export_manifest or {})
    collector = manifest.get("collector")
    if isinstance(collector, dict):
        version = str(
            collector.get("export_contract_version")
            or collector.get("runtime_shell")
            or ""
        ).strip()
        if version:
            return version
    return str(manifest.get("schema_version") or "unknown")


def _strip_html(value: str) -> str:
    normalized = value.replace("<br/>", "\n").replace("<br />", "\n").replace("<br>", "\n")
    stripped = _HTML_TAG_RE.sub("", normalized)
    decoded = unescape(stripped).replace("\xa0", " ")
    lines = [_WHITESPACE_RE.sub(" ", line).strip() for line in decoded.splitlines()]
    return "\n".join(line for line in lines if line)


def _normalize_text(value: str) -> str:
    return _WHITESPACE_RE.sub(" ", value.replace("\xa0", " ")).strip()


def _optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _normalize_attachment_filename(*, filename: object, fallback_key: str | None = None) -> str:
    value = str(filename or "").strip()
    fallback = str(fallback_key or "").strip()
    candidate_source = value or fallback
    candidate = Path(candidate_source.replace("\\", "/")).name.strip().replace("/", "_")
    return candidate or "attachment"


def _unit_type_for_block(block_role: str) -> str:
    if block_role in {"title", "heading"}:
        return "policy_page"
    if block_role == "table":
        return "table_unit"
    return "article_body"


__all__ = [
    "AUTHENTICATED_NOTICE_SOURCE_CHANNEL",
    "AuthenticatedNoticeSourceMaterial",
    "build_authenticated_notice_attachment_capture_key",
    "build_authenticated_notice_raw_asset_id",
    "build_authenticated_notice_raw_version_id",
    "infer_authenticated_notice_year",
    "prepare_authenticated_notice_source_material",
    "resolve_authenticated_notice_attachment_object_key",
]
