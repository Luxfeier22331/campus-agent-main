from __future__ import annotations

import json
import re

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION

from campus_ingestion_core.chunking import serialize_table_unit_text
from campus_ingestion_core.handbook_cleanup_tables import (
    _build_table_unit_semantics,
    _normalize_table_matrix,
)
from campus_ingestion_core.readable_text_normalization import normalize_readable_text


def serialize_handbook_document_units(
    rows: tuple[dict[str, object], ...] | list[dict[str, object]],
) -> bytes:
    return ("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n").encode("utf-8")


def build_canonical_body(
    events: list[dict[str, object]],
    *,
    preface_text: str | None,
) -> str:
    parts: list[str] = []
    if preface_text:
        parts.append(preface_text)
    for event in events:
        kind = str(event["kind"])
        if kind == "section":
            parts.append(f"## {event['text']}")
            continue
        if kind == "article":
            article_text = str(event.get("text") or "")
            if event.get("render_heading") is False:
                if article_text:
                    parts.append(article_text)
                continue
            if article_text:
                parts.append(f"### {event['label']}\n{article_text}")
            else:
                parts.append(f"### {event['label']}")
            continue
        if kind == "policy_page":
            if _should_render_policy_page_as_canonical_heading(event):
                parts.append(f"## {event['text']}")
                continue
            parts.append(str(event["text"]))
            continue
        if kind == "table":
            table_text = str(event.get("text") or "")
            parts.append(f"[表格]\n{table_text}" if table_text else "[表格]")
            continue
    return normalize_readable_text("\n\n".join(part for part in parts if part))


def _should_render_policy_page_as_canonical_heading(event: dict[str, object]) -> bool:
    text = str(event.get("text") or "").strip()
    return bool(
        text
        and event.get("render_heading") is not False
        and "\n" not in text
        and event.get("provision_label") is not None
        and not tuple(event.get("section_path") or ())
    )


def build_canonical_markdown(
    *,
    title: str,
    doc_id: str,
    metadata: dict[str, object],
    canonical_body: str,
) -> str:
    front_matter_lines = [
        "---",
        "schema_version: 1",
        f"doc_id: {doc_id}",
        "corpus: regulations",
        "collection: student_rules",
        f"title: '{escape_yaml_string(title)}'",
        "source_kind: ocr",
        f"source_doc: '{escape_yaml_string(str(metadata['source_doc']))}'",
        f"handbook_section: '{escape_yaml_string(str(metadata['handbook_section']))}'",
        f"page_start: {metadata['page_start']}",
        f"page_end: {metadata['page_end']}",
    ]
    policy_doc_no = metadata.get("policy_doc_no")
    if isinstance(policy_doc_no, str) and policy_doc_no:
        front_matter_lines.append(f"policy_doc_no: '{escape_yaml_string(policy_doc_no)}'")
    front_matter_lines.append("---")
    front_matter_lines.append("")
    front_matter_lines.append(f"# {title}")
    if canonical_body:
        front_matter_lines.append("")
        front_matter_lines.append(canonical_body)
    return "\n".join(front_matter_lines).strip() + "\n"


def build_document_rows(
    *,
    events: list[dict[str, object]],
    doc_id: str,
    version_id: str,
    source_pdf: str,
    source_url: str,
    entitlement_groups: tuple[str, ...],
    title: str,
    policy_doc_no: str | None,
    preface_text: str | None,
) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    policy_index = 0
    article_index = 0
    table_index = 0
    first_substantive_row = True

    for event in events:
        kind = str(event["kind"])
        if kind == "section":
            continue
        if kind == "policy_page":
            policy_index += 1
            root_unit_id = f"policy-page-{policy_index:04d}"
            rows.append(
                build_structured_unit_row(
                    doc_id=doc_id,
                    version_id=version_id,
                    chunk_id=root_unit_id,
                    root_unit_id=root_unit_id,
                    unit_type="policy_page",
                    clean_text=str(event["text"]),
                    source_pdf=source_pdf,
                    source_url=source_url,
                    entitlement_groups=entitlement_groups,
                    anchor={
                        "page_start": int(event["page_start"]),
                        "page_end": int(event["page_end"]),
                        "section_path": list(event.get("section_path") or ()),
                        **(
                            {"provision_label": str(event["provision_label"])}
                            if event.get("provision_label") is not None
                            else {}
                        ),
                    },
                    metadata=build_unit_metadata(
                        title=title,
                        policy_doc_no=policy_doc_no,
                        preface_text=preface_text if first_substantive_row else None,
                    ),
                )
            )
            first_substantive_row = False
            continue
        if kind == "article":
            article_index += 1
            root_unit_id = f"article-{article_index:04d}"
            rows.append(
                build_structured_unit_row(
                    doc_id=doc_id,
                    version_id=version_id,
                    chunk_id=root_unit_id,
                    root_unit_id=root_unit_id,
                    unit_type="article_body",
                    clean_text=str(event.get("text") or ""),
                    source_pdf=source_pdf,
                    source_url=source_url,
                    entitlement_groups=entitlement_groups,
                    anchor={
                        "page_start": int(event["page_start"]),
                        "page_end": int(event["page_end"]),
                        "section_path": list(event.get("section_path") or ()),
                        "article_label": str(event["label"]),
                    },
                    metadata=build_unit_metadata(
                        title=title,
                        policy_doc_no=policy_doc_no,
                        preface_text=preface_text if first_substantive_row else None,
                    ),
                )
            )
            first_substantive_row = False
            continue
        if kind == "table":
            table_index += 1
            root_unit_id = f"table-{table_index:04d}"
            table_cells = _normalize_table_matrix(
                html=event.get("html"),
                table_cells=event.get("table_cells"),
            )
            rows.append(
                build_structured_unit_row(
                    doc_id=doc_id,
                    version_id=version_id,
                    chunk_id=root_unit_id,
                    root_unit_id=root_unit_id,
                    unit_type="table",
                    clean_text=str(event.get("text") or ""),
                    source_pdf=source_pdf,
                    source_url=source_url,
                    entitlement_groups=entitlement_groups,
                    anchor={
                        "page_start": int(event["page_start"]),
                        "page_end": int(event["page_end"]),
                        "section_path": list(event.get("section_path") or ()),
                        "article_label": event.get("article_label"),
                        "table_context": event.get("table_context"),
                    },
                    metadata=build_unit_metadata(
                        title=title,
                        policy_doc_no=policy_doc_no,
                        preface_text=preface_text if first_substantive_row else None,
                    ),
                    html=event.get("html"),
                    table_cells=table_cells,
                )
            )
            first_substantive_row = False
            table_semantics = _build_table_unit_semantics(
                table_cells=table_cells,
                table_context=event.get("table_context"),
            )
            if table_semantics is not None:
                rows.append(
                    build_structured_unit_row(
                        doc_id=doc_id,
                        version_id=version_id,
                        chunk_id=f"{root_unit_id}-unit",
                        root_unit_id=root_unit_id,
                        unit_type="table_unit",
                        clean_text=serialize_table_unit_text(
                            caption_lines=table_semantics.caption_lines,
                            header_line=table_semantics.header_line,
                            row_lines=table_semantics.row_lines,
                            note_lines=table_semantics.note_lines,
                        ),
                        source_pdf=source_pdf,
                        source_url=source_url,
                        entitlement_groups=entitlement_groups,
                        anchor={
                            "page_start": int(event["page_start"]),
                            "page_end": int(event["page_end"]),
                            "section_path": list(event.get("section_path") or ()),
                            "article_label": event.get("article_label"),
                            "table_context": event.get("table_context"),
                        },
                        metadata={
                            **build_unit_metadata(
                                title=title,
                                policy_doc_no=policy_doc_no,
                                preface_text=None,
                            ),
                            "caption_lines": list(table_semantics.caption_lines),
                            "note_lines": list(table_semantics.note_lines),
                            "table_header_rows": [list(row) for row in table_semantics.header_rows],
                            "table_body_rows": [list(row) for row in table_semantics.body_rows],
                            "table_column_paths": list(table_semantics.column_paths),
                            "table_header_line": table_semantics.header_line,
                            "table_row_lines": list(table_semantics.row_lines),
                            "table_header_row_count": len(table_semantics.header_rows),
                            "table_row_count": len(table_semantics.row_lines),
                            "table_column_count": len(table_semantics.column_paths),
                        },
                        table_cells=[list(row) for row in table_semantics.matrix],
                    )
                )
    return rows


def build_preface_policy_rows(
    *,
    doc_id: str,
    version_id: str,
    source_pdf: str,
    source_url: str,
    entitlement_groups: tuple[str, ...],
    title: str,
    policy_doc_no: str | None,
    preface_text: str | None,
    page_start: int,
    page_end: int,
) -> list[dict[str, object]]:
    if not preface_text:
        return []
    segments = _split_preface_numbered_policy_rows(preface_text)
    if not segments:
        return []
    rows: list[dict[str, object]] = []
    for index, segment in enumerate(segments, start=1):
        root_unit_id = f"policy-page-preface-{index:04d}"
        rows.append(
            build_structured_unit_row(
                doc_id=doc_id,
                version_id=version_id,
                chunk_id=root_unit_id,
                root_unit_id=root_unit_id,
                unit_type="policy_page",
                clean_text=segment,
                source_pdf=source_pdf,
                source_url=source_url,
                entitlement_groups=entitlement_groups,
                anchor={
                    "page_start": page_start,
                    "page_end": page_end,
                    "section_path": [],
                },
                metadata=build_unit_metadata(
                    title=title,
                    policy_doc_no=policy_doc_no,
                    preface_text=None,
                ),
            )
        )
    return rows


def _split_preface_numbered_policy_rows(preface_text: str) -> tuple[str, ...]:
    lines = [line.strip() for line in preface_text.splitlines() if line.strip()]
    if len(lines) < 2:
        return ()
    numbered_lines = lines[1:]
    if not numbered_lines:
        return ()
    if not all(_looks_like_top_level_numbered_clause(line) for line in numbered_lines):
        return ()
    return tuple(numbered_lines)


def _looks_like_top_level_numbered_clause(text: str) -> bool:
    normalized = normalize_readable_text(text)
    if not normalized:
        return False
    return bool(
        re.match(r"^[一二三四五六七八九十百千万〇零两]+、", normalized)
        and normalized.endswith(("。", "；"))
    )


def build_structured_unit_row(
    *,
    doc_id: str,
    version_id: str,
    chunk_id: str,
    root_unit_id: str,
    unit_type: str,
    clean_text: str,
    source_pdf: str,
    source_url: str,
    entitlement_groups: tuple[str, ...],
    anchor: dict[str, object],
    metadata: dict[str, object] | None = None,
    html: object = None,
    table_cells: object = None,
) -> dict[str, object]:
    visibility_level = "restricted" if entitlement_groups else "public"
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
        "metadata": metadata or {},
        "entitlement_groups": list(entitlement_groups),
        "visibility_scope": None,
        "visibility_level": visibility_level,
        "policy_projection_version": DEFAULT_POLICY_PROJECTION_VERSION,
        "html": html,
        "table_cells": table_cells,
    }


def build_unit_metadata(
    *,
    title: str,
    policy_doc_no: str | None,
    preface_text: str | None,
) -> dict[str, object]:
    metadata: dict[str, object] = {"title": title}
    if policy_doc_no:
        metadata["policy_doc_no"] = policy_doc_no
    if preface_text:
        metadata["preface_text"] = preface_text
    return metadata


def escape_yaml_string(value: str) -> str:
    return value.replace("'", "''")


__all__ = [
    "build_canonical_body",
    "build_canonical_markdown",
    "build_document_rows",
    "serialize_handbook_document_units",
]
