from __future__ import annotations

from campus_ingestion_core.source_truth_common import build_position_preserving_table_rows
from campus_ingestion_core.split_manifest import SplitManifestDocument


def build_split_document_canonical_markdown(
    *,
    manifest_document: SplitManifestDocument,
    split_rows: list[dict[str, object]],
) -> bytes:
    parts = [f"# {manifest_document.title.strip()}"]
    for row in split_rows:
        block = _render_markdown_block(row=row, manifest_title=manifest_document.title)
        if not block:
            continue
        kind, text = block
        if kind == "heading" and text.lstrip("# ").strip() == manifest_document.title.strip():
            continue
        parts.append(text)
    if len(parts) == 1:
        raise ValueError(
            f"split manifest document {manifest_document.document_id} produced empty canonical markdown"
        )
    markdown = "\n\n".join(part.strip() for part in parts if part.strip()).strip() + "\n"
    return markdown.encode("utf-8")


def _render_markdown_block(
    *,
    row: dict[str, object],
    manifest_title: str,
) -> tuple[str, str] | None:
    row_type = str(row.get("row_type") or "").strip()
    clean_text = str(row.get("clean_text") or "").strip()
    if row_type == "table":
        rendered_table = _render_table_markdown(row)
        if rendered_table:
            return "table", rendered_table
    if not clean_text:
        return None
    if row_type == "heading":
        level = _heading_level(row=row, manifest_title=manifest_title, text=clean_text)
        return "heading", f"{'#' * level} {clean_text}"
    return "text", clean_text


def _heading_level(
    *,
    row: dict[str, object],
    manifest_title: str,
    text: str,
) -> int:
    if text.strip() == manifest_title.strip():
        return 1
    heading_level = row.get("heading_level")
    if isinstance(heading_level, int) and heading_level > 0:
        return min(heading_level + 1, 6)
    return 2


def _render_table_markdown(row: dict[str, object]) -> str | None:
    table_rows = build_position_preserving_table_rows(
        html=_normalize_optional_text(row.get("html")),
        table_cells=row.get("table_cells"),
        pipe_delimited_text=_normalize_optional_text(row.get("clean_text")),
    )
    if not table_rows:
        clean_text = str(row.get("clean_text") or "").strip()
        return clean_text or None
    header = tuple(str(cell).strip() for cell in table_rows[0])
    if not any(header):
        return None
    lines = [
        _render_table_line(header),
        _render_table_line(tuple("---" for _ in header)),
    ]
    for body_row in table_rows[1:]:
        normalized_body_row = tuple(str(cell).strip() for cell in body_row)
        if any(normalized_body_row):
            lines.append(_render_table_line(normalized_body_row))
    return "\n".join(lines).strip()


def _render_table_line(cells: tuple[str, ...]) -> str:
    return "| " + " | ".join(cell.replace("\n", " ").strip() for cell in cells) + " |"


def _normalize_optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


__all__ = ["build_split_document_canonical_markdown"]
