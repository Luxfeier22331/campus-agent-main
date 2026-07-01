from __future__ import annotations

import hashlib
import json
import re
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION

from campus_ingestion_core.internal_notice_regulation_promotion import (
    InternalNoticeRegulationCandidateArtifactDocument,
)

_TARGET_SCOPE = ("regulations", "institutional_rules")
_SOURCE_URL_PREFIX = "campus-agent://promotion/synthetic_notice"
_HEADING_RE = re.compile(r"^\s*#+\s*")
_MARKDOWN_HEADING_RE = re.compile(r"^\s*(?P<marks>#+)\s*(?P<text>.+?)\s*$")
_ARTICLE_LABEL_RE = re.compile(r"^(?P<label>第[一二三四五六七八九十百千万〇零两0-9]+条)")
_TOP_LEVEL_HEADING_RE = re.compile(r"^(?P<label>[一二三四五六七八九十百千万〇零两0-9]+、)")
_SUBSECTION_HEADING_RE = re.compile(
    r"^(?P<label>[（(][一二三四五六七八九十百千万〇零两0-9]+[)）][、.]?)"
)
_NUMERIC_ITEM_RE = re.compile(r"^(?P<label>[0-9]+[.、])")


@dataclass(frozen=True, slots=True)
class _RegulationBlockStructure:
    row_type: str
    section_path: tuple[str, ...]
    article_label: str | None
    provision_label: str | None
    next_top_level_path: tuple[str, ...]
    next_nested_path: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class InternalNoticeRegulationProjectionContext:
    source_notice_ids: tuple[str, ...] = ()
    source_document_ids: tuple[str, ...] = ()
    source_parent_document_ids: tuple[str, ...] = ()
    source_attachment_ref_ids: tuple[str, ...] = ()
    source_attachment_sha256s: tuple[str, ...] = ()
    duplicate_source_document_ids: tuple[str, ...] = ()
    derived_from_raw_asset_id: str | None = None
    derived_from_raw_version_id: str | None = None
    source_page_start: int | None = None
    source_page_end: int | None = None
    source_filename: str | None = None


@dataclass(frozen=True, slots=True)
class InternalNoticeRegulationProjectedDocument:
    document_id: str
    version_id: str
    title: str
    source_uri: str
    semantic_content_hash: str
    canonical_markdown: str
    document_units_bytes: bytes
    metadata: dict[str, object]
    published_date: str | None


def build_internal_notice_regulation_projected_document(
    *,
    candidate_document: InternalNoticeRegulationCandidateArtifactDocument,
    context: InternalNoticeRegulationProjectionContext | None = None,
) -> InternalNoticeRegulationProjectedDocument:
    runtime_context = context or InternalNoticeRegulationProjectionContext()
    title = _resolve_regulation_document_display_title(candidate_document)
    unit_title = _resolve_regulation_document_work_title(candidate_document)
    canonical_markdown = render_internal_notice_regulation_canonical_markdown(candidate_document)
    semantic_content_hash = hashlib.sha256(canonical_markdown.encode("utf-8")).hexdigest()
    document_id = build_institutional_regulation_document_id(
        regulation_title_normalized=candidate_document.regulation_title_normalized,
        regulation_work_title=candidate_document.regulation_work_title,
        issuing_org=candidate_document.issuing_org or "示例大学",
    )
    version_id = build_institutional_regulation_version_id(
        semantic_content_hash=semantic_content_hash,
        effective_date=candidate_document.effective_date,
        revision_signal=candidate_document.revision_signal,
    )
    metadata = build_internal_notice_regulation_projection_metadata(
        candidate_document=candidate_document,
        semantic_content_hash=semantic_content_hash,
        context=runtime_context,
    )
    document_units_bytes = serialize_internal_notice_regulation_projection_rows(
        document_id=document_id,
        version_id=version_id,
        title=unit_title,
        body=candidate_document.promotion_body,
        metadata=metadata,
        source_url=f"{_SOURCE_URL_PREFIX}/{candidate_document.candidate_id}",
        source_filename=runtime_context.source_filename
        or Path(candidate_document.artifact_markdown_path).name,
        entitlement_groups=candidate_document.entitlement_groups,
        visibility_scope=candidate_document.visibility_scope,
        visibility_level=candidate_document.visibility_level,
        page_start=runtime_context.source_page_start,
        page_end=runtime_context.source_page_end,
    )
    return InternalNoticeRegulationProjectedDocument(
        document_id=document_id,
        version_id=version_id,
        title=title,
        source_uri=f"{_SOURCE_URL_PREFIX}/{candidate_document.candidate_id}",
        semantic_content_hash=semantic_content_hash,
        canonical_markdown=canonical_markdown,
        document_units_bytes=document_units_bytes,
        metadata=metadata,
        published_date=normalize_internal_notice_projection_published_date(
            candidate_document.source_notice_release_time
        ),
    )


def build_institutional_regulation_document_id(
    *,
    regulation_title_normalized: str,
    regulation_work_title: str | None = None,
    issuing_org: str,
    semantic_scope: str = "regulations/institutional_rules",
) -> str:
    work_title = (regulation_work_title or regulation_title_normalized).strip()
    title_slug = _slugify_identifier(work_title)
    digest = hashlib.sha256(
        "\n".join(
            (
                work_title,
                issuing_org.strip(),
                semantic_scope,
            )
        ).encode("utf-8")
    ).hexdigest()[:12]
    return f"institutional_regulation:example:{title_slug}:{digest}"


def build_institutional_regulation_version_id(
    *,
    semantic_content_hash: str,
    effective_date: str | None,
    revision_signal: str | None,
) -> str:
    date_label = _slugify_identifier(effective_date or "undated")
    revision_label = _slugify_identifier(revision_signal or "none")
    return f"sha256:{semantic_content_hash}:effective-{date_label}:revision-{revision_label}"


def render_internal_notice_regulation_canonical_markdown(
    candidate_document: InternalNoticeRegulationCandidateArtifactDocument,
) -> str:
    body = candidate_document.promotion_body.strip()
    title = candidate_document.regulation_title_normalized.strip()
    return f"# {title}\n\n{body}\n"


def build_internal_notice_regulation_projection_metadata(
    *,
    candidate_document: InternalNoticeRegulationCandidateArtifactDocument,
    semantic_content_hash: str,
    context: InternalNoticeRegulationProjectionContext,
) -> dict[str, object]:
    title = _resolve_regulation_document_display_title(candidate_document)
    source_notice_ids = tuple(
        sorted(set(context.source_notice_ids or (candidate_document.notice_id,)))
    )
    source_document_ids = tuple(
        sorted(set(context.source_document_ids or (candidate_document.source_document_id,)))
    )
    source_parent_document_ids = tuple(
        sorted(
            {
                parent_document_id
                for parent_document_id in (
                    *(context.source_parent_document_ids or ()),
                    candidate_document.source_parent_document_id,
                )
                if parent_document_id
            }
        )
    )
    source_attachment_ref_ids = tuple(
        sorted(
            {
                attachment_ref_id
                for attachment_ref_id in (
                    *(context.source_attachment_ref_ids or ()),
                    candidate_document.source_attachment_ref_id,
                )
                if attachment_ref_id
            }
        )
    )
    source_attachment_sha256s = tuple(
        sorted(
            {
                attachment_sha256
                for attachment_sha256 in (
                    *(context.source_attachment_sha256s or ()),
                    candidate_document.source_attachment_sha256,
                )
                if attachment_sha256
            }
        )
    )
    source_notice_document_id = _resolve_source_notice_document_id(candidate_document)
    source_notice_document_ids = tuple(
        sorted(
            {
                document_id
                for document_id in (
                    *(source_parent_document_ids or ()),
                    source_notice_document_id,
                )
                if document_id
            }
        )
    )
    source_attachment_document_id = _resolve_source_attachment_document_id(candidate_document)
    source_attachment_document_ids = tuple(
        sorted(
            {
                document_id
                for document_id in (
                    *(
                        source_document_ids
                        if candidate_document.semantic_owner_kind == "attachment_document"
                        else ()
                    ),
                    source_attachment_document_id,
                )
                if document_id
            }
        )
    )
    semantic_owner_document_id = _resolve_semantic_owner_document_id(candidate_document)
    semantic_owner_document_ids = tuple(
        sorted(
            {
                document_id
                for document_id in (
                    *(
                        source_attachment_document_ids
                        if candidate_document.semantic_owner_kind == "attachment_document"
                        else source_notice_document_ids
                    ),
                    semantic_owner_document_id,
                )
                if document_id
            }
        )
    )
    metadata: dict[str, object] = {
        "title": title,
        "semantic_content_hash": semantic_content_hash,
        "content_kind": "institutional_regulation",
        "content_role": candidate_document.promotion_class,
        "document_nature": candidate_document.document_nature,
        "semantic_owner_kind": candidate_document.semantic_owner_kind,
        "is_answer_bearing": True,
        "projection_name": "internal_notice_regulation_promotion",
        "derived_from": "internal_notice_canonical_document",
        "derived_from_document_id": candidate_document.source_document_id,
        "derived_from_document_ids": list(source_document_ids),
        "derived_from_raw_asset_id": context.derived_from_raw_asset_id,
        "derived_from_raw_version_id": context.derived_from_raw_version_id,
        "parent_document_id": candidate_document.source_parent_document_id,
        "promotion_class": candidate_document.promotion_class,
        "promotion_source_collection": "campus_notices/internal_notice",
        "source_notice_ids": list(source_notice_ids),
        "source_notice_document_id": source_notice_document_id,
        "source_notice_document_ids": list(source_notice_document_ids),
        "source_document_ids": list(source_document_ids),
        "source_parent_document_id": candidate_document.source_parent_document_id,
        "source_parent_document_ids": list(source_parent_document_ids),
        "source_attachment_document_id": source_attachment_document_id,
        "source_attachment_document_ids": list(source_attachment_document_ids),
        "source_attachment_ref_id": candidate_document.source_attachment_ref_id,
        "source_attachment_ref_ids": list(source_attachment_ref_ids),
        "source_attachment_sha256": candidate_document.source_attachment_sha256,
        "source_attachment_sha256s": list(source_attachment_sha256s),
        "semantic_owner_document_id": semantic_owner_document_id,
        "semantic_owner_document_ids": list(semantic_owner_document_ids),
        "source_notice_release_time": candidate_document.source_notice_release_time,
        "regulation_title_normalized": candidate_document.regulation_title_normalized,
        "regulation_work_title": candidate_document.regulation_work_title,
        "regulation_edition_label": candidate_document.regulation_edition_label,
        "regulation_display_title": candidate_document.regulation_display_title,
        "source_title_literal": candidate_document.source_title_literal,
        "issuing_org": candidate_document.issuing_org,
        "effective_date": candidate_document.effective_date,
        "revision_signal": candidate_document.revision_signal,
        "duplicate_source_document_ids": list(context.duplicate_source_document_ids),
        "quality_gates_passed": list(candidate_document.quality_gates_passed),
        "promotion_reasons": list(candidate_document.reasons),
        "source_page_start": context.source_page_start,
        "source_page_end": context.source_page_end,
        "published_date": normalize_internal_notice_projection_published_date(
            candidate_document.source_notice_release_time
        ),
    }
    return {key: value for key, value in metadata.items() if value is not None}


def _resolve_source_notice_document_id(
    candidate_document: InternalNoticeRegulationCandidateArtifactDocument,
) -> str | None:
    if candidate_document.source_notice_document_id:
        return candidate_document.source_notice_document_id
    if candidate_document.source_parent_document_id:
        return candidate_document.source_parent_document_id
    if candidate_document.source_kind == "parent_notice":
        return candidate_document.source_document_id
    return None


def _resolve_regulation_document_display_title(
    candidate_document: InternalNoticeRegulationCandidateArtifactDocument,
) -> str:
    return (
        candidate_document.regulation_display_title
        or candidate_document.regulation_title_normalized
    ).strip()


def _resolve_regulation_document_work_title(
    candidate_document: InternalNoticeRegulationCandidateArtifactDocument,
) -> str:
    return (
        candidate_document.regulation_work_title or candidate_document.regulation_title_normalized
    ).strip()


def _resolve_source_attachment_document_id(
    candidate_document: InternalNoticeRegulationCandidateArtifactDocument,
) -> str | None:
    if candidate_document.source_attachment_document_id:
        return candidate_document.source_attachment_document_id
    if candidate_document.source_kind == "attachment_document":
        return candidate_document.source_document_id
    return None


def _resolve_semantic_owner_document_id(
    candidate_document: InternalNoticeRegulationCandidateArtifactDocument,
) -> str | None:
    if candidate_document.semantic_owner_document_id:
        return candidate_document.semantic_owner_document_id
    if candidate_document.semantic_owner_kind == "attachment_document":
        return _resolve_source_attachment_document_id(candidate_document)
    if candidate_document.semantic_owner_kind == "notice_body":
        return _resolve_source_notice_document_id(candidate_document)
    return None


def serialize_internal_notice_regulation_projection_rows(
    *,
    document_id: str,
    version_id: str,
    title: str,
    body: str,
    metadata: dict[str, object],
    source_url: str,
    source_filename: str,
    entitlement_groups: Sequence[str],
    visibility_scope: str | None,
    visibility_level: str,
    page_start: int | None,
    page_end: int | None,
) -> bytes:
    rows: list[dict[str, object]] = []
    root_unit_id = f"{document_id}:root"
    rows.append(
        _build_row(
            document_id=document_id,
            version_id=version_id,
            row_id=f"{document_id}:row-0001",
            row_type="heading",
            clean_text=title,
            metadata={
                **metadata,
                "title": title,
                "detail_label": "标题",
                "section_path": [],
                "content_role": "regulation_title",
            },
            source_url=source_url,
            source_filename=source_filename,
            entitlement_groups=tuple(entitlement_groups),
            visibility_scope=visibility_scope,
            visibility_level=visibility_level,
            page_start=page_start,
            page_end=page_end,
            anchor=_build_anchor(
                page_start=page_start,
                page_end=page_end,
            ),
            unit_type="institutional_regulation_heading",
            root_unit_id=root_unit_id,
        )
    )
    top_level_path: tuple[str, ...] = ()
    nested_path: tuple[str, ...] = ()
    for index, block in enumerate(_split_markdown_blocks(body), start=2):
        block_text = block["text"]
        if not block_text:
            continue
        structure = _resolve_regulation_block_structure(
            text=block_text,
            default_row_type=str(block["row_type"]),
            current_top_level_path=top_level_path,
            current_nested_path=nested_path,
        )
        top_level_path = structure.next_top_level_path
        nested_path = structure.next_nested_path
        rows.append(
            _build_row(
                document_id=document_id,
                version_id=version_id,
                row_id=f"{document_id}:row-{index:04d}",
                row_type=structure.row_type,
                clean_text=block_text,
                metadata={
                    **metadata,
                    "title": title,
                    "detail_label": "正文",
                    "section_path": list(structure.section_path),
                    "article_label": structure.article_label,
                    "provision_label": structure.provision_label,
                    "is_answer_bearing": structure.row_type != "heading",
                    "content_role": "regulation_body",
                },
                source_url=source_url,
                source_filename=source_filename,
                entitlement_groups=tuple(entitlement_groups),
                visibility_scope=visibility_scope,
                visibility_level=visibility_level,
                page_start=page_start,
                page_end=page_end,
                anchor=_build_anchor(
                    section_path=structure.section_path,
                    article_label=structure.article_label,
                    provision_label=structure.provision_label,
                    page_start=page_start,
                    page_end=page_end,
                ),
                unit_type="institutional_regulation_block",
                root_unit_id=root_unit_id,
            )
        )
    return "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows).encode("utf-8")


def normalize_internal_notice_projection_published_date(value: str | None) -> str | None:
    if value is None:
        return None
    normalized = value.strip()
    if not normalized:
        return None
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", normalized):
        return normalized
    match = re.match(r"(?P<year>\d{4})年(?P<month>\d{1,2})月(?P<day>\d{1,2})日", normalized)
    if match is None:
        if len(normalized) >= 10 and re.fullmatch(r"\d{4}-\d{2}-\d{2}", normalized[:10]):
            return normalized[:10]
        return normalized
    return (
        f"{int(match.group('year')):04d}-{int(match.group('month')):02d}-"
        f"{int(match.group('day')):02d}"
    )


def _build_row(
    *,
    document_id: str,
    version_id: str,
    row_id: str,
    row_type: str,
    clean_text: str,
    metadata: dict[str, object],
    source_url: str,
    source_filename: str,
    entitlement_groups: tuple[str, ...],
    visibility_scope: str | None,
    visibility_level: str,
    page_start: int | None,
    page_end: int | None,
    anchor: dict[str, object],
    unit_type: str,
    root_unit_id: str,
) -> dict[str, object]:
    return {
        "doc_id": document_id,
        "version_id": version_id,
        "chunk_id": row_id,
        "row_id": row_id,
        "row_type": row_type,
        "clean_text": clean_text,
        "source_pdf": source_filename,
        "source_url": source_url,
        "source": {"id": source_url},
        "page_start": page_start,
        "page_end": page_end,
        "entitlement_groups": list(entitlement_groups),
        "visibility_scope": visibility_scope,
        "visibility_level": visibility_level,
        "policy_projection_version": DEFAULT_POLICY_PROJECTION_VERSION,
        "anchor": anchor,
        "unit_type": unit_type,
        "root_unit_id": root_unit_id,
        "metadata": metadata,
    }


def _split_markdown_blocks(body: str) -> tuple[dict[str, str], ...]:
    blocks: list[dict[str, str]] = []
    for raw_block in body.split("\n\n"):
        cleaned = raw_block.strip()
        if not cleaned:
            continue
        row_type = "heading" if cleaned.startswith("#") else "paragraph"
        blocks.append({"row_type": row_type, "text": cleaned})
    return tuple(blocks)


def _strip_heading(text: str) -> str:
    return _HEADING_RE.sub("", text.strip())


def _resolve_regulation_block_structure(
    *,
    text: str,
    default_row_type: str,
    current_top_level_path: tuple[str, ...],
    current_nested_path: tuple[str, ...],
) -> _RegulationBlockStructure:
    markdown_heading = _MARKDOWN_HEADING_RE.match(text.strip())
    if markdown_heading is not None:
        heading_text = markdown_heading.group("text").strip()
        heading_level = len(markdown_heading.group("marks"))
        if heading_level <= 1:
            path = (heading_text,)
            return _RegulationBlockStructure(
                row_type="heading",
                section_path=path,
                article_label=None,
                provision_label=None,
                next_top_level_path=path,
                next_nested_path=(),
            )
        path = (
            (*current_top_level_path, heading_text) if current_top_level_path else (heading_text,)
        )
        return _RegulationBlockStructure(
            row_type="heading",
            section_path=path,
            article_label=None,
            provision_label=None,
            next_top_level_path=current_top_level_path,
            next_nested_path=path,
        )

    normalized = _strip_heading(text)
    article_match = _ARTICLE_LABEL_RE.match(normalized)
    if article_match is not None:
        article_label = article_match.group("label").strip()
        article_body = normalized[article_match.end() :].strip()
        inherited_path = current_nested_path or current_top_level_path
        return _RegulationBlockStructure(
            row_type="paragraph" if article_body else "heading",
            section_path=inherited_path,
            article_label=article_label,
            provision_label=None,
            next_top_level_path=current_top_level_path,
            next_nested_path=current_nested_path,
        )

    for pattern, level in (
        (_TOP_LEVEL_HEADING_RE, "top"),
        (_SUBSECTION_HEADING_RE, "nested"),
    ):
        match = pattern.match(normalized)
        if match is None:
            continue
        match.group("label").strip()
        if level == "top":
            path = (normalized,)
            return _RegulationBlockStructure(
                row_type="heading",
                section_path=path,
                article_label=None,
                provision_label=None,
                next_top_level_path=path,
                next_nested_path=(),
            )
        path = (*current_top_level_path, normalized) if current_top_level_path else (normalized,)
        return _RegulationBlockStructure(
            row_type="heading",
            section_path=path,
            article_label=None,
            provision_label=None,
            next_top_level_path=current_top_level_path,
            next_nested_path=path,
        )

    numeric_item = _NUMERIC_ITEM_RE.match(normalized)
    if numeric_item is not None:
        inherited_path = current_nested_path or current_top_level_path or (normalized,)
        return _RegulationBlockStructure(
            row_type=default_row_type,
            section_path=inherited_path,
            article_label=None,
            provision_label=numeric_item.group("label").strip(),
            next_top_level_path=current_top_level_path,
            next_nested_path=current_nested_path,
        )

    inherited_path = current_nested_path or current_top_level_path
    return _RegulationBlockStructure(
        row_type=default_row_type,
        section_path=inherited_path,
        article_label=None,
        provision_label=None,
        next_top_level_path=current_top_level_path,
        next_nested_path=current_nested_path,
    )


def _build_anchor(
    *,
    section_path: Sequence[str] = (),
    article_label: str | None = None,
    provision_label: str | None = None,
    page_start: int | None,
    page_end: int | None,
) -> dict[str, object]:
    anchor: dict[str, object] = {}
    normalized_section_path = [item.strip() for item in section_path if item.strip()]
    if normalized_section_path:
        anchor["section_path"] = normalized_section_path
    if article_label is not None and article_label.strip():
        anchor["article_label"] = article_label.strip()
    if provision_label is not None and provision_label.strip():
        anchor["provision_label"] = provision_label.strip()
    if page_start is not None:
        anchor["page_start"] = page_start
    if page_end is not None:
        anchor["page_end"] = page_end
    return anchor


def _slugify_identifier(value: str) -> str:
    normalized = value.strip().lower()
    slug = "".join(ch if ch.isalnum() else "-" for ch in normalized).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "document"


__all__ = [
    "InternalNoticeRegulationProjectedDocument",
    "InternalNoticeRegulationProjectionContext",
    "build_institutional_regulation_document_id",
    "build_institutional_regulation_version_id",
    "build_internal_notice_regulation_projected_document",
    "build_internal_notice_regulation_projection_metadata",
    "normalize_internal_notice_projection_published_date",
    "render_internal_notice_regulation_canonical_markdown",
    "serialize_internal_notice_regulation_projection_rows",
]
