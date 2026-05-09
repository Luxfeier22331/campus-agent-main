from __future__ import annotations

import json

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION

from campus_ingestion_core.internal_notice_scoped_rule_materialization_shared import (
    _split_markdown_blocks,
    _strip_heading,
)


def _serialize_scoped_rule_rows(
    *,
    document_id: str,
    version_id: str,
    title: str,
    body: str,
    metadata: dict[str, object],
    source_url: str,
    source_pdf: str,
    entitlement_groups: tuple[str, ...],
    visibility_scope: str | None,
    visibility_level: str,
    page_start: int | None,
    page_end: int | None,
) -> bytes:
    rows: list[dict[str, object]] = []
    root_unit_id = f"{document_id}:root"
    rows.append(
        _build_scoped_row(
            document_id=document_id,
            version_id=version_id,
            row_id=f"{document_id}:row-0001",
            row_type="heading",
            clean_text=title,
            metadata={
                **metadata,
                "title": title,
                "detail_label": "标题",
                "section_path": [title],
                "content_role": "scoped_rule_title",
            },
            source_url=source_url,
            source_pdf=source_pdf,
            entitlement_groups=entitlement_groups,
            visibility_scope=visibility_scope,
            visibility_level=visibility_level,
            page_start=page_start,
            page_end=page_end,
            unit_type="scoped_rule_heading",
            root_unit_id=root_unit_id,
        )
    )
    section_path = [title]
    for index, block in enumerate(_split_markdown_blocks(body), start=2):
        block_text = block["text"]
        if not block_text:
            continue
        if block["row_type"] == "heading":
            section_path = [title, _strip_heading(block_text)]
        rows.append(
            _build_scoped_row(
                document_id=document_id,
                version_id=version_id,
                row_id=f"{document_id}:row-{index:04d}",
                row_type=str(block["row_type"]),
                clean_text=block_text,
                metadata={
                    **metadata,
                    "title": title,
                    "detail_label": "正文",
                    "section_path": list(section_path),
                    "content_role": "scoped_rule_body",
                },
                source_url=source_url,
                source_pdf=source_pdf,
                entitlement_groups=entitlement_groups,
                visibility_scope=visibility_scope,
                visibility_level=visibility_level,
                page_start=page_start,
                page_end=page_end,
                unit_type="scoped_rule_block",
                root_unit_id=root_unit_id,
            )
        )
    return "".join(json.dumps(row, ensure_ascii=False) + "\n" for row in rows).encode("utf-8")


def _build_scoped_row(
    *,
    document_id: str,
    version_id: str,
    row_id: str,
    row_type: str,
    clean_text: str,
    metadata: dict[str, object],
    source_url: str,
    source_pdf: str,
    entitlement_groups: tuple[str, ...],
    visibility_scope: str | None,
    visibility_level: str,
    page_start: int | None,
    page_end: int | None,
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
        "source_pdf": source_pdf,
        "source_url": source_url,
        "source": {"id": source_url},
        "page_start": page_start,
        "page_end": page_end,
        "entitlement_groups": list(entitlement_groups),
        "visibility_scope": visibility_scope,
        "visibility_level": visibility_level,
        "policy_projection_version": DEFAULT_POLICY_PROJECTION_VERSION,
        "unit_type": unit_type,
        "root_unit_id": root_unit_id,
        "metadata": metadata,
    }
