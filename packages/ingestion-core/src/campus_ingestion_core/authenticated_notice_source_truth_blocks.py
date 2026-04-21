from __future__ import annotations

import re
from html import unescape
from typing import Any

from campus_ingestion_core.authenticated_notice_source_truth_shared import (
    AUTHENTICATED_NOTICE_ATTACHMENT_REF_SCHEMA,
    AUTHENTICATED_NOTICE_BLOCK_SCHEMA,
    _content_kind_for_relation,
    _joined_attachments,
    _jsonl_bytes,
    _notice_payload,
    _optional_text,
    infer_authenticated_notice_year,
    resolve_authenticated_notice_attachment_object_key,
)

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
_HTML_BLOCK_RE = re.compile(
    r"<(h[1-6]|p|li|table)\b[^>]*>(.*?)</\1>",
    re.IGNORECASE | re.DOTALL,
)
_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"\s+")


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


def _strip_html(value: str) -> str:
    normalized = value.replace("<br/>", "\n").replace("<br />", "\n").replace("<br>", "\n")
    stripped = _HTML_TAG_RE.sub("", normalized)
    decoded = unescape(stripped).replace("\xa0", " ")
    lines = [_WHITESPACE_RE.sub(" ", line).strip() for line in decoded.splitlines()]
    return "\n".join(line for line in lines if line)


def _normalize_text(value: str) -> str:
    return _WHITESPACE_RE.sub(" ", value.replace("\xa0", " ")).strip()


def _unit_type_for_block(block_role: str) -> str:
    if block_role in {"title", "heading"}:
        return "policy_page"
    if block_role == "table":
        return "table_unit"
    return "article_body"
