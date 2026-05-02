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
_CHINESE_NUMBER = "一二三四五六七八九十百千万〇零两0-9"
_STRUCTURAL_BLOCK_START_RE = re.compile(
    rf"(?=^(?:第[{_CHINESE_NUMBER}]+[章节条]|[{_CHINESE_NUMBER}]+、|[（(][{_CHINESE_NUMBER}]+[)）]))",
    re.MULTILINE,
)
_ARTICLE_LABEL_RE = re.compile(rf"^(?P<label>第[{_CHINESE_NUMBER}]+条)")
_CHAPTER_OR_SECTION_HEADING_RE = re.compile(rf"^第[{_CHINESE_NUMBER}]+[章节][^。；]*$")
_TOP_LEVEL_HEADING_RE = re.compile(rf"^(?P<label>[{_CHINESE_NUMBER}]+、)[^。；]{{1,60}}$")
_SUBSECTION_HEADING_RE = re.compile(
    rf"^(?P<label>[（(][{_CHINESE_NUMBER}]+[)）][、.]?)[^。；]{{0,60}}$"
)
_NUMERIC_ITEM_RE = re.compile(r"^(?P<label>[0-9]+[.、])")
_STRUCTURAL_HEADING_RE = re.compile(
    rf"^(?:第[{_CHINESE_NUMBER}]+[章节][^。；]*|[{_CHINESE_NUMBER}]+、[^。；]{{1,60}}|[（(][{_CHINESE_NUMBER}]+[)）][、.]?[^。；]{{0,60}})$"
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
        normalization_quality.get("normalizer_version") or REGULATION_CANONICAL_NORMALIZER_VERSION
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
            "source_notice_release_time": _resolve_source_notice_release_time(document),
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
                "section_path": [],
                "is_answer_bearing": True,
            },
        )
    ]
    current_section_path: tuple[str, ...] = ()
    for offset, chunk in enumerate(body_chunks, start=2):
        structure = _resolve_first_batch_block_structure(
            chunk, current_section_path=current_section_path
        )
        current_section_path = structure["next_section_path"]
        rows.append(
            _document_unit_row(
                document_id=target_document_id,
                version_id=version_id,
                index=offset,
                row_type=structure["row_type"],
                unit_type=body_unit_type,
                text=chunk,
                title=title,
                source_url=_source_url(document),
                metadata={
                    **common_metadata,
                    **collection_metadata,
                    "content_role": body_content_role,
                    "section_path": list(structure["section_path"]),
                    "article_label": structure["article_label"],
                    "provision_label": structure["provision_label"],
                    "is_answer_bearing": structure["row_type"] != "heading",
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
    row_type: str | None = None,
) -> dict[str, Any]:
    row_id = f"{document_id}:unit-{index:04d}"
    raw_section_path = metadata.get("section_path")
    section_path = (
        list(raw_section_path)
        if isinstance(raw_section_path, list)
        else ([title] if index == 1 else [])
    )
    anchor: dict[str, Any] = {"section_path": section_path} if section_path else {}
    article_label = str(metadata.get("article_label") or "").strip()
    if article_label:
        anchor["article_label"] = article_label
    provision_label = str(metadata.get("provision_label") or "").strip()
    if provision_label:
        anchor["provision_label"] = provision_label
    return {
        "doc_id": document_id,
        "version_id": version_id,
        "chunk_id": row_id,
        "row_id": row_id,
        "row_type": row_type or ("paragraph" if index > 1 else "heading"),
        "clean_text": text.strip(),
        "source_pdf": source_url.rsplit("/", 1)[-1] if source_url else "source.pdf",
        "source_url": source_url,
        "source": {"id": source_url},
        "page_start": None,
        "page_end": None,
        "entitlement_groups": ["campus_members"],
        "visibility_scope": "campus",
        "visibility_level": "restricted",
        "policy_projection_version": DEFAULT_POLICY_PROJECTION_VERSION,
        "unit_type": unit_type,
        "root_unit_id": row_id,
        "anchor": anchor,
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
    starts = [match.start() for match in _STRUCTURAL_BLOCK_START_RE.finditer(body)]
    if not starts:
        return tuple(_split_blank_blocks(body)) or (body,)
    chunks: list[str] = []
    prefix = body[: starts[0]].strip()
    chunks.extend(_split_blank_blocks(prefix))
    for index, start in enumerate(starts):
        end = starts[index + 1] if index + 1 < len(starts) else len(body)
        chunks.extend(_split_structural_region(body[start:end].strip()))
    return tuple(chunks)


def _split_structural_region(text: str) -> tuple[str, ...]:
    normalized = text.strip()
    if not normalized:
        return ()
    lines = normalized.splitlines()
    first_line_index = next((index for index, line in enumerate(lines) if line.strip()), None)
    if first_line_index is None:
        return ()
    first_line = lines[first_line_index].strip()
    remainder = "\n".join(lines[first_line_index + 1 :]).strip()
    if _ARTICLE_LABEL_RE.match(first_line):
        return (normalized,)
    if _looks_like_first_batch_structural_heading(first_line) and remainder:
        return (first_line, *_split_blank_blocks(remainder))
    return tuple(_split_blank_blocks(normalized)) or (normalized,)


def _split_blank_blocks(text: str) -> tuple[str, ...]:
    return tuple(chunk.strip() for chunk in re.split(r"\n{2,}", text.strip()) if chunk.strip())


def _looks_like_first_batch_structural_heading(text: str) -> bool:
    normalized = text.strip()
    return bool(
        _CHAPTER_OR_SECTION_HEADING_RE.match(normalized)
        or _TOP_LEVEL_HEADING_RE.match(normalized)
        or _SUBSECTION_HEADING_RE.match(normalized)
    )


def _resolve_scoped_rule_document_nature(document: Mapping[str, Any]) -> str:
    del document
    return "time_bound_operational_rule"


def _resolve_first_batch_block_structure(
    text: str,
    *,
    current_section_path: tuple[str, ...],
) -> dict[str, Any]:
    first_line = next((line.strip() for line in text.splitlines() if line.strip()), "")
    article_match = _ARTICLE_LABEL_RE.match(first_line)
    if article_match is not None:
        article_label = article_match.group("label").strip()
        article_body = first_line[article_match.end() :].strip()
        return {
            "row_type": "paragraph" if article_body else "heading",
            "section_path": current_section_path,
            "article_label": article_label,
            "provision_label": None,
            "next_section_path": current_section_path,
        }
    if _CHAPTER_OR_SECTION_HEADING_RE.match(first_line) or _TOP_LEVEL_HEADING_RE.match(first_line):
        return {
            "row_type": "heading",
            "section_path": (first_line,),
            "article_label": None,
            "provision_label": None,
            "next_section_path": (first_line,),
        }
    subsection_match = _SUBSECTION_HEADING_RE.match(first_line)
    if subsection_match is not None:
        return {
            "row_type": "heading",
            "section_path": (*current_section_path, first_line)
            if current_section_path
            else (first_line,),
            "article_label": None,
            "provision_label": None,
            "next_section_path": (*current_section_path, first_line)
            if current_section_path
            else (first_line,),
        }
    numeric_item = _NUMERIC_ITEM_RE.match(first_line)
    if numeric_item is not None:
        return {
            "row_type": "paragraph",
            "section_path": current_section_path,
            "article_label": None,
            "provision_label": numeric_item.group("label").strip(),
            "next_section_path": current_section_path,
        }
    return {
        "row_type": "paragraph",
        "section_path": current_section_path,
        "article_label": None,
        "provision_label": None,
        "next_section_path": current_section_path,
    }


def _resolve_source_notice_release_time(document: Mapping[str, Any]) -> str:
    for field_name in ("source_notice_release_time", "notice_release_time", "published_date"):
        value = str(document.get(field_name) or "").strip()
        if value:
            return value
    return "unknown"


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
