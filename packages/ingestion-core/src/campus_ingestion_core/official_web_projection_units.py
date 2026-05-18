from __future__ import annotations

import hashlib
from pathlib import Path

from campus_ingestion_core.chunking_tables import serialize_table_unit_text
from campus_ingestion_core.official_web_projection_content import (
    _build_semantic_content_hash,
    _classify_article_line,
    _is_support_only_projection_unit,
    _resolve_document_promotion_block_reason,
    _resolve_document_serving_intent,
    _resolve_projection_content_role,
    _resolve_projection_is_answer_bearing,
)
from campus_ingestion_core.official_web_projection_listing import (
    _can_attach_listing_date,
    _finalize_listing_buffer_entries,
    _is_listing_date_only_line,
    _looks_like_listing_item_heading_block,
    _looks_like_portal_generic_page,
    _normalize_listing_context_label,
    _normalize_listing_line,
    _normalize_listing_section_heading,
    _resolve_listing_section_path,
    _sanitize_listing_parent_heading_path,
    _should_skip_generic_noise_line,
)
from campus_ingestion_core.official_web_projection_shared import (
    OFFICIAL_WEB_CONTENT_BLOCK_SCHEMA_VERSION,
    OFFICIAL_WEB_PAGE_MANIFEST_SCHEMA_VERSION,
    OfficialWebProjectionDeclaration,
    _normalize_block_text,
    _normalize_string_list,
    _optional_text,
    _read_json,
    _read_jsonl,
    _slugify_text,
)
from campus_ingestion_core.official_web_projection_table_units import (
    _build_official_web_table_metadata,
    _build_official_web_table_semantics,
    _resolve_official_web_table_context,
)

_ARTICLE_SECTION_MAX_PARAGRAPHS_PER_UNIT = 3


def _build_projection_units(
    *,
    declaration: OfficialWebProjectionDeclaration,
    manifest: dict[str, object],
    blocks: list[dict[str, object]],
    document_id: str,
    version_id: str,
    title: str,
) -> list[dict[str, object]]:
    main_blocks = [
        block
        for block in blocks
        if bool(block.get("isMainContent")) and _normalize_block_text(block)
    ]
    if not main_blocks:
        raise ValueError(
            f"page {manifest['normalizedCanonicalUrl']} has no main-content blocks to project"
        )

    units: list[dict[str, object]] = []
    buffered_lines: list[str] = []
    buffered_row_id_groups: list[list[str]] = []
    buffered_line_roles: list[str] = []
    buffered_line_navigation_flags: list[bool] = []
    buffered_line_boilerplate_flags: list[bool] = []
    buffered_unit_type: str | None = None
    buffered_content_role: str | None = None
    current_section_path: list[str] = []
    buffered_section_path: list[str] = []
    seen_primary_narrative = False
    is_listing_document = declaration.document_kind == "listing"
    listing_item_headings: set[str] = set()
    portal_like_generic_page = (
        declaration.document_kind == "generic"
        and _looks_like_portal_generic_page(
            title=title,
            main_blocks=main_blocks,
        )
    )

    def reset_buffer() -> None:
        nonlocal buffered_lines
        nonlocal buffered_row_id_groups
        nonlocal buffered_line_roles
        nonlocal buffered_line_navigation_flags
        nonlocal buffered_line_boilerplate_flags
        nonlocal buffered_unit_type
        nonlocal buffered_content_role
        nonlocal buffered_section_path
        buffered_lines = []
        buffered_row_id_groups = []
        buffered_line_roles = []
        buffered_line_navigation_flags = []
        buffered_line_boilerplate_flags = []
        buffered_unit_type = None
        buffered_content_role = None
        buffered_section_path = []

    def flush_buffer() -> None:
        nonlocal buffered_lines
        nonlocal buffered_row_id_groups
        nonlocal buffered_line_roles
        nonlocal buffered_line_navigation_flags
        nonlocal buffered_line_boilerplate_flags
        nonlocal buffered_unit_type
        nonlocal buffered_content_role
        nonlocal buffered_section_path
        if not buffered_lines:
            return
        final_entries: list[tuple[int, str]] = list(enumerate(buffered_lines))
        if buffered_unit_type == "link_list":
            final_entries = _finalize_listing_buffer_entries(
                buffered_lines,
                buffered_line_roles,
                buffered_line_navigation_flags,
                buffered_line_boilerplate_flags,
                buffered_section_path,
                title=title,
            )
        elif buffered_unit_type == "directory_entry":
            final_entries = _finalize_directory_buffer_entries(
                buffered_lines,
                title=title,
                section_path=buffered_section_path,
            )
        clean_text = "\n".join(text for _, text in final_entries if text).strip()
        final_row_ids = [
            row_id
            for source_index, _ in final_entries
            if source_index < len(buffered_row_id_groups)
            for row_id in buffered_row_id_groups[source_index]
            if row_id
        ]
        if not clean_text:
            reset_buffer()
            return
        unit_index = len(units) + 1
        unit_metadata = _build_projection_unit_metadata(
            declaration=declaration,
            manifest=manifest,
            title=title,
            semantic_content_hash="",
            content_role=buffered_content_role,
            is_answer_bearing=_resolve_projection_is_answer_bearing(buffered_content_role),
        )
        units.append(
            _build_structured_unit_row(
                doc_id=document_id,
                version_id=version_id,
                chunk_id=f"{document_id}:unit-{unit_index:04d}",
                root_unit_id=f"{document_id}:root-{unit_index:04d}",
                unit_type=buffered_unit_type or "section_text",
                clean_text=clean_text,
                source_pdf=f"official_web:{manifest['siteId']}",
                source_url=str(manifest["normalizedCanonicalUrl"]),
                anchor={
                    "page_start": 1,
                    "page_end": 1,
                    "normalized_canonical_url": manifest["normalizedCanonicalUrl"],
                    "page_family": manifest["pageFamily"],
                    "section_path": list(buffered_section_path),
                    "row_ids": final_row_ids,
                },
                metadata=unit_metadata,
            )
        )
        reset_buffer()

    for block_index, block in enumerate(main_blocks):
        block_role = str(block.get("blockRole") or "").strip()
        text = _normalize_block_text(block)
        if not text:
            continue
        parent_heading_path = _normalize_string_list(block.get("parentHeadingPath"))
        if is_listing_document:
            parent_heading_path = _sanitize_listing_parent_heading_path(
                parent_heading_path,
                listing_item_headings,
            )
        if block_role == "title":
            continue
        if block_role == "heading":
            flush_buffer()
            if is_listing_document and _looks_like_listing_item_heading_block(
                main_blocks, block_index, text
            ):
                listing_item_headings.add(_normalize_listing_context_label(text))
                continue
            if portal_like_generic_page and seen_primary_narrative:
                current_section_path = list(parent_heading_path)
                continue
            if text == title or (current_section_path and text == current_section_path[-1]):
                current_section_path = list(parent_heading_path or current_section_path)
                continue
            current_section_path = [*parent_heading_path, text]
            continue
        if (
            declaration.document_kind in {"article", "generic"}
            and not seen_primary_narrative
            and block_role in {"list_item", "link"}
        ):
            continue
        if declaration.document_kind in {"article", "generic"} and _should_skip_generic_noise_line(
            text=text,
            block_role=block_role,
            seen_primary_narrative=seen_primary_narrative,
            portal_like_generic_page=portal_like_generic_page,
        ):
            continue
        unit_type = _resolve_unit_type(declaration.document_kind, block_role)
        section_path = parent_heading_path or current_section_path
        if unit_type == "link_list":
            text = _normalize_listing_line(text)
            if not text:
                continue
            section_path = _resolve_listing_section_path(
                parent_heading_path=parent_heading_path,
                current_section_path=current_section_path,
                listing_item_headings=listing_item_headings,
            )
            if (
                block_role == "paragraph"
                and _is_listing_date_only_line(text)
                and buffered_lines
                and _can_attach_listing_date(buffered_lines[-1])
            ):
                buffered_lines[-1] = f"{buffered_lines[-1]} {text}"
                if buffered_row_id_groups:
                    row_id = str(block.get("rowId") or "").strip()
                    if row_id:
                        buffered_row_id_groups[-1].append(row_id)
                continue
        if block_role in {"table", "table_row", "table_cell"}:
            flush_buffer()
            current_section_path = list(section_path)
            table_cells = block.get("tableCells")
            table_context = _resolve_official_web_table_context(
                title=title,
                section_path=section_path,
            )
            table_semantics = _build_official_web_table_semantics(
                table_cells=table_cells,
                table_context=table_context,
                title=title,
                normalized_canonical_url=str(manifest["normalizedCanonicalUrl"]),
                row_id=str(block.get("rowId") or ""),
            )
            table_metadata = _build_official_web_table_metadata(
                table_semantics=table_semantics,
                table_context=table_context,
            )
            clean_text = serialize_table_unit_text(
                caption_lines=tuple(
                    str(item) for item in table_metadata.get("caption_lines") or []
                ),
                header_line=str(table_metadata.get("table_header_line") or ""),
                row_lines=tuple(str(item) for item in table_metadata.get("table_row_lines") or []),
                note_lines=tuple(str(item) for item in table_metadata.get("note_lines") or []),
            )
            unit_index = len(units) + 1
            units.append(
                _build_structured_unit_row(
                    doc_id=document_id,
                    version_id=version_id,
                    chunk_id=f"{document_id}:unit-{unit_index:04d}",
                    root_unit_id=f"{document_id}:root-{unit_index:04d}",
                    unit_type="table_unit",
                    clean_text=clean_text,
                    source_pdf=f"official_web:{manifest['siteId']}",
                    source_url=str(manifest["normalizedCanonicalUrl"]),
                    anchor={
                        "page_start": 1,
                        "page_end": 1,
                        "normalized_canonical_url": manifest["normalizedCanonicalUrl"],
                        "page_family": manifest["pageFamily"],
                        "section_path": list(section_path),
                        "row_ids": [str(block.get("rowId") or "")],
                        "table_context": table_context,
                    },
                    metadata=_build_projection_unit_metadata(
                        declaration=declaration,
                        manifest=manifest,
                        title=title,
                        semantic_content_hash="",
                        content_role=_resolve_projection_content_role(
                            page_family=declaration.page_family,
                            document_kind=declaration.document_kind,
                            title=title,
                        ),
                        is_answer_bearing=True,
                        extra_metadata=table_metadata,
                    ),
                    table_cells=[list(row) for row in table_semantics.matrix],
                )
            )
            continue
        if declaration.document_kind == "directory" and block_role == "paragraph":
            flush_buffer()
            current_section_path = list(section_path)
            clean_text = _clean_directory_entry_text(
                text,
                title=title,
                section_path=section_path,
            )
            if not clean_text:
                continue
            unit_index = len(units) + 1
            units.append(
                _build_structured_unit_row(
                    doc_id=document_id,
                    version_id=version_id,
                    chunk_id=f"{document_id}:unit-{unit_index:04d}",
                    root_unit_id=f"{document_id}:root-{unit_index:04d}",
                    unit_type="directory_entry",
                    clean_text=clean_text,
                    source_pdf=f"official_web:{manifest['siteId']}",
                    source_url=str(manifest["normalizedCanonicalUrl"]),
                    anchor={
                        "page_start": 1,
                        "page_end": 1,
                        "normalized_canonical_url": manifest["normalizedCanonicalUrl"],
                        "page_family": manifest["pageFamily"],
                        "section_path": list(section_path),
                        "row_ids": [str(block.get("rowId") or "")],
                    },
                    metadata=_build_projection_unit_metadata(
                        declaration=declaration,
                        manifest=manifest,
                        title=title,
                        semantic_content_hash="",
                        content_role=_resolve_projection_content_role(
                            page_family=declaration.page_family,
                            document_kind=declaration.document_kind,
                            title=title,
                        ),
                        is_answer_bearing=True,
                    ),
                )
            )
            continue
        if block_role == "paragraph":
            seen_primary_narrative = True
        line_semantics = _classify_article_line(
            title=title,
            document_kind=declaration.document_kind,
            text=text,
        )
        content_role = _resolve_projection_content_role(
            page_family=declaration.page_family,
            document_kind=declaration.document_kind,
            title=title,
            line_class=line_semantics.line_class,
        )
        if buffered_unit_type is not None and (
            buffered_unit_type != unit_type
            or section_path != buffered_section_path
            or buffered_content_role != content_role
        ):
            flush_buffer()
        if _should_flush_article_section_text_buffer(
            document_kind=declaration.document_kind,
            buffered_unit_type=buffered_unit_type,
            buffered_content_role=buffered_content_role,
            buffered_lines=buffered_lines,
            buffered_line_roles=buffered_line_roles,
            next_unit_type=unit_type,
            next_content_role=content_role,
            next_block_role=block_role,
            next_line_class=line_semantics.line_class,
        ):
            flush_buffer()
        if buffered_unit_type is None:
            buffered_unit_type = unit_type
            buffered_section_path = list(section_path)
            buffered_content_role = content_role
        if buffered_lines and buffered_lines[-1] == text:
            continue
        buffered_lines.append(text)
        row_id = str(block.get("rowId") or "").strip()
        buffered_row_id_groups.append([row_id] if row_id else [])
        buffered_line_roles.append(block_role)
        buffered_line_navigation_flags.append(bool(block.get("isNavigation")))
        buffered_line_boilerplate_flags.append(bool(block.get("isBoilerplate")))

    flush_buffer()
    semantic_content_hash = _build_semantic_content_hash(
        document_kind=declaration.document_kind,
        title=title,
        units=units,
    )
    for unit in units:
        metadata = unit.get("metadata")
        if isinstance(metadata, dict):
            metadata["semantic_content_hash"] = semantic_content_hash
    return units


def _clean_directory_entry_text(
    text: str,
    *,
    title: str,
    section_path: list[str],
) -> str:
    entries = _finalize_directory_buffer_entries(
        [line.strip() for line in text.splitlines() if line.strip()],
        title=title,
        section_path=section_path,
    )
    return "\n".join(line for _, line in entries).strip()


def _finalize_directory_buffer_entries(
    lines: list[str],
    *,
    title: str,
    section_path: list[str],
) -> list[tuple[int, str]]:
    normalized_entries = [
        (index, " ".join(line.split()).strip()) for index, line in enumerate(lines)
    ]
    normalized_entries = [(index, line) for index, line in normalized_entries if line]
    if len(normalized_entries) < 2:
        return normalized_entries

    label_indexes = _directory_heading_label_indexes(
        [line for _, line in normalized_entries],
        title=title,
        section_path=section_path,
    )
    had_heading_labels = bool(label_indexes)
    filtered_entries = [
        (source_index, line)
        for normalized_index, (source_index, line) in enumerate(normalized_entries)
        if normalized_index not in label_indexes
    ]
    before_aggregate_count = len(filtered_entries)
    filtered_entries = _drop_directory_aggregate_label_entries(filtered_entries)
    had_aggregate_label = len(filtered_entries) != before_aggregate_count
    if (had_heading_labels or had_aggregate_label) and _looks_like_directory_navigation_label_stack(
        [line for _, line in filtered_entries]
    ):
        return []
    return filtered_entries


def _directory_heading_label_indexes(
    lines: list[str],
    *,
    title: str,
    section_path: list[str],
) -> set[int]:
    title_label = " ".join(title.split()).strip()
    section_labels = {" ".join(item.split()).strip() for item in section_path if item.strip()}
    section_labels.discard("")
    explicit_labels = set(section_labels)
    if title_label:
        explicit_labels.add(title_label)

    label_indexes = {
        index
        for index, line in enumerate(lines)
        if line in explicit_labels and _has_non_label_directory_line(lines, explicit_labels)
    }
    if title_label in lines:
        title_index = lines.index(title_label)
        leading = lines[: title_index + 1]
        if (
            title_index < len(lines) - 1
            and len(leading) >= 2
            and all(_looks_like_directory_section_tab_label(line) for line in leading)
        ):
            label_indexes.update(range(title_index + 1))
    return label_indexes


def _has_non_label_directory_line(lines: list[str], labels: set[str]) -> bool:
    return any(line not in labels for line in lines)


def _looks_like_directory_section_tab_label(text: str) -> bool:
    normalized = " ".join(text.split()).strip()
    if not normalized:
        return False
    if len(normalized) > 10:
        return False
    if any(
        punctuation in normalized for punctuation in {"。", "！", "？", "；", "：", ":", "，", ","}
    ):
        return False
    return not any(character.isdigit() for character in normalized)


def _drop_directory_aggregate_label_entries(
    entries: list[tuple[int, str]],
) -> list[tuple[int, str]]:
    lines = [line for _, line in entries]
    filtered_entries: list[tuple[int, str]] = []
    for index, entry in enumerate(entries):
        line = entry[1]
        matching_shorter_lines = {
            other
            for other_index, other in enumerate(lines)
            if other_index != index and len(other) >= 2 and len(other) < len(line) and other in line
        }
        if len(matching_shorter_lines) >= 2 and line.count(" ") >= 2:
            continue
        filtered_entries.append(entry)
    return filtered_entries


def _looks_like_directory_navigation_label_stack(lines: list[str]) -> bool:
    if len(lines) < 3:
        return False
    return all(_looks_like_directory_section_tab_label(line) for line in lines)


def _resolve_document_title(*, manifest: dict[str, object], blocks: list[dict[str, object]]) -> str:
    title = str(manifest.get("pageTitleNormalized") or "").strip()
    if title:
        return title
    for block in blocks:
        text = _normalize_block_text(block)
        if text:
            return text.splitlines()[0].strip()
    return "Untitled official web page"


def _build_document_id(*, site_id: str, page_family: str, normalized_canonical_url: str) -> str:
    digest = hashlib.sha1(
        f"{site_id}\n{page_family}\n{normalized_canonical_url}".encode()
    ).hexdigest()
    return f"official_web:{site_id}:{page_family}:{digest}"


def _build_version_id(*, raw_version_id: str, declaration_id: str, main_content_hash: str) -> str:
    digest = hashlib.sha1(
        f"{raw_version_id}\n{declaration_id}\n{main_content_hash}".encode()
    ).hexdigest()
    return f"owdocver:{digest}"


def _build_document_output_dir(
    *,
    projection_output_dir: Path,
    declaration: OfficialWebProjectionDeclaration,
    title: str,
    document_id: str,
) -> Path:
    title_slug = _slugify_text(title) or declaration.document_kind or declaration.page_family
    document_hash = hashlib.sha1(document_id.encode("utf-8")).hexdigest()[:8]
    return (
        projection_output_dir
        / "documents"
        / declaration.target_corpus
        / declaration.target_collection
        / f"{title_slug}--{document_hash}"
    )


def _render_canonical_markdown(
    *,
    title: str,
    manifest: dict[str, object],
    units: list[dict[str, object]],
) -> str:
    lines = [f"# {title}", "", f"> Source URL: {manifest['normalizedCanonicalUrl']}", ""]
    is_listing_page = str(manifest.get("pageFamily") or "").strip() == "listing_page"
    last_section_path: tuple[str, ...] = ()
    for unit in units:
        if _is_support_only_projection_unit(unit):
            continue
        anchor = unit.get("anchor")
        section_path = tuple(
            _normalize_string_list(anchor.get("section_path") if isinstance(anchor, dict) else [])
        )
        display_section_path = (
            tuple(_normalize_listing_section_heading(item) for item in section_path)
            if is_listing_page
            else section_path
        )
        if display_section_path and display_section_path != last_section_path:
            heading = display_section_path[-1]
            if heading and heading != title:
                lines.append(f"## {heading}")
                lines.append("")
            last_section_path = display_section_path
        clean_text = str(unit.get("clean_text") or "").strip()
        if not clean_text:
            continue
        if str(unit.get("unit_type") or "") in {"link_list", "directory_entry"}:
            for line in clean_text.splitlines():
                normalized = line.strip()
                if normalized:
                    lines.append(f"- {normalized}")
            lines.append("")
            continue
        lines.append(clean_text)
        lines.append("")
    return "\n".join(lines).strip() + "\n"


def _resolve_unit_type(document_kind: str, block_role: str) -> str:
    if block_role in {"table", "table_row", "table_cell"}:
        return "table_unit"
    if document_kind == "listing":
        return "link_list"
    if document_kind == "directory":
        return "directory_entry"
    return "section_text"


def _should_flush_article_section_text_buffer(
    *,
    document_kind: str,
    buffered_unit_type: str | None,
    buffered_content_role: str | None,
    buffered_lines: list[str],
    buffered_line_roles: list[str],
    next_unit_type: str,
    next_content_role: str,
    next_block_role: str,
    next_line_class: str,
) -> bool:
    if document_kind != "article":
        return False
    if buffered_unit_type != "section_text" or next_unit_type != "section_text":
        return False
    if next_block_role != "paragraph":
        return False
    if buffered_content_role != next_content_role:
        return False
    if next_line_class in {
        "source_attribution_line",
        "terminal_boilerplate_line",
        "media_caption_line",
        "attachment_reference_line",
        "terminal_signature_line",
    }:
        return False
    if buffered_content_role == "notice_fact":
        return False
    buffered_paragraph_count = sum(1 for role in buffered_line_roles if role == "paragraph")
    return buffered_paragraph_count >= _ARTICLE_SECTION_MAX_PARAGRAPHS_PER_UNIT


def _load_local_page_source_truth(
    *,
    output_dir: Path,
    raw_asset_id: str,
    raw_version_id: str,
) -> tuple[dict[str, object], list[dict[str, object]]]:
    base_dir = output_dir / "source-assets" / raw_asset_id / raw_version_id / "source-truth"
    manifest = _read_json(base_dir / "page-manifest.json")
    manifest_schema = str(
        manifest.get("schemaVersion") or manifest.get("schema_version") or ""
    ).strip()
    if manifest_schema != OFFICIAL_WEB_PAGE_MANIFEST_SCHEMA_VERSION:
        raise ValueError(f"unsupported page-manifest schema_version: {manifest_schema!r}")
    blocks = _read_jsonl(base_dir / "content-blocks.jsonl")
    for block in blocks:
        block_schema = str(block.get("schemaVersion") or block.get("schema_version") or "").strip()
        if block_schema != OFFICIAL_WEB_CONTENT_BLOCK_SCHEMA_VERSION:
            raise ValueError(f"unsupported content-block schema_version: {block_schema!r}")
    return manifest, blocks


def _build_structured_unit_row(
    *,
    doc_id: str,
    version_id: str,
    chunk_id: str,
    root_unit_id: str,
    unit_type: str,
    clean_text: str,
    source_pdf: str,
    source_url: str,
    anchor: dict[str, object],
    metadata: dict[str, object],
    table_cells: object = None,
) -> dict[str, object]:
    return {
        "doc_id": doc_id,
        "version_id": version_id,
        "chunk_id": chunk_id,
        "root_unit_id": root_unit_id,
        "unit_type": unit_type,
        "clean_text": clean_text,
        "source_pdf": source_pdf,
        "source_url": source_url,
        "source_md": None,
        "source": {"id": source_url},
        "page_start": int(anchor["page_start"]),
        "page_end": int(anchor["page_end"]),
        "anchor": anchor,
        "metadata": metadata,
        "table_cells": table_cells,
    }


def _build_projection_unit_metadata(
    *,
    declaration: OfficialWebProjectionDeclaration,
    manifest: dict[str, object],
    title: str,
    semantic_content_hash: str,
    content_role: str | None = None,
    is_answer_bearing: bool | None = None,
    extra_metadata: dict[str, object] | None = None,
) -> dict[str, object]:
    serving_intent = _resolve_document_serving_intent(
        page_family=declaration.page_family,
        document_kind=declaration.document_kind,
        title=title,
        normalized_canonical_url=str(manifest["normalizedCanonicalUrl"]),
    )
    promotion_block_reason = _resolve_document_promotion_block_reason(
        page_family=declaration.page_family,
        document_kind=declaration.document_kind,
        title=title,
        normalized_canonical_url=str(manifest["normalizedCanonicalUrl"]),
    )
    metadata: dict[str, object] = {
        "title": title,
        "site_id": manifest["siteId"],
        "host": manifest["host"],
        "page_family": manifest["pageFamily"],
        "published_at": _optional_text(manifest.get("publishedAt") or manifest.get("published_at")),
        "fetched_at": _optional_text(manifest.get("fetchedAt") or manifest.get("fetched_at")),
        "last_modified": _optional_text(
            manifest.get("lastModified") or manifest.get("last_modified")
        ),
        "projection_family": declaration.projection_family,
        "document_kind": declaration.document_kind,
        "declaration_id": declaration.declaration_id,
        "serving_intent": serving_intent,
        "semantic_content_hash": semantic_content_hash,
        "content_role": content_role
        or _resolve_projection_content_role(
            page_family=declaration.page_family,
            document_kind=declaration.document_kind,
            title=title,
        ),
    }
    resolved_content_role = str(metadata["content_role"]).strip()
    metadata["is_answer_bearing"] = (
        is_answer_bearing
        if is_answer_bearing is not None
        else _resolve_projection_is_answer_bearing(resolved_content_role)
    )
    if promotion_block_reason is not None:
        metadata["promotion_block_reason"] = promotion_block_reason
    if extra_metadata:
        metadata.update(extra_metadata)
    return metadata
