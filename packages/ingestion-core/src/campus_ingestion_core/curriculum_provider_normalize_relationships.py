from __future__ import annotations

import hashlib
from html import escape

from campus_ingestion_core.source_truth_common import (
    detect_merged_cells,
    enrich_cross_page_continuations,
    enrich_parent_heading_hints,
    enrich_repeated_candidates,
    infer_table_column_count,
    infer_table_header_rows,
    infer_table_row_count,
    normalize_text,
)

from .curriculum_provider_normalize_shared import _TABLE_ROW_RE, _TABLE_TAG_RE


def _enrich_source_truth_rows(rows: list[dict[str, object]]) -> None:
    _repair_cross_page_table_continuations(rows)
    _enrich_relationships(rows)
    enrich_repeated_candidates(rows)
    enrich_parent_heading_hints(rows)
    enrich_cross_page_continuations(rows, textual_row_types=("paragraph", "list_item"))
    _assign_table_fragment_ids(rows)
    _propagate_table_caption_hints(rows)


def _repair_cross_page_table_continuations(rows: list[dict[str, object]]) -> None:
    previous_table: dict[str, object] | None = None
    for row in rows:
        if str(row.get("row_type") or "") != "table":
            continue
        if previous_table is not None:
            repaired_cells = _repair_continuation_table_cells(
                previous_table=previous_table,
                current_table=row,
            )
            if repaired_cells is not None:
                repaired_html = _serialize_table_cells_html(repaired_cells)
                row["table_cells"] = repaired_cells
                row["html"] = repaired_html
                row["text_raw"] = repaired_html
                row["text_normalized"] = repaired_html
                row["table_header_rows"] = infer_table_header_rows(repaired_cells)
                row["table_row_count"] = infer_table_row_count(repaired_cells)
                row["table_column_count"] = infer_table_column_count(repaired_cells)
                row["table_has_merged_cells"] = detect_merged_cells(repaired_cells)
                row["relation_type"] = "table_continuation"
                row["owner_row_id"] = previous_table.get("row_id")
                row["continuation_group_id"] = previous_table.get(
                    "continuation_group_id"
                ) or previous_table.get("row_id")
        previous_table = row


def _repair_continuation_table_cells(
    *,
    previous_table: dict[str, object],
    current_table: dict[str, object],
) -> list[dict[str, object]] | None:
    previous_page_end = previous_table.get("page_end")
    current_page_start = current_table.get("page_start")
    if not isinstance(previous_page_end, int) or not isinstance(current_page_start, int):
        return None
    if current_page_start != previous_page_end + 1:
        return None
    previous_cells = _coerce_table_cells(previous_table.get("table_cells"))
    current_cells = _coerce_table_cells(current_table.get("table_cells"))
    if not previous_cells or not current_cells:
        return None

    previous_row_count = infer_table_row_count(previous_cells) or 0
    if previous_row_count <= 0:
        return None
    current_placeholder_columns = {
        int(cell.get("col") or 0)
        for cell in current_cells
        if int(cell.get("row") or 0) == 1 and not normalize_text(str(cell.get("text") or ""))
    }
    carried_cells: list[dict[str, object]] = []
    for cell in previous_cells:
        row_number = int(cell.get("row") or 0)
        col_number = int(cell.get("col") or 0)
        rowspan = int(cell.get("rowspan") or 1)
        overflow = row_number + max(rowspan, 1) - 1 - previous_row_count
        text = normalize_text(str(cell.get("text") or ""))
        if not text:
            continue
        if overflow <= 0:
            if (
                overflow == 0
                and col_number in current_placeholder_columns
                and row_number + max(rowspan, 1) - 1 == previous_row_count
            ):
                overflow = 1
            else:
                continue
        carried_cells.append(
            {
                "row": 1,
                "col": col_number,
                "text": text,
                "rowspan": overflow,
                "colspan": int(cell.get("colspan") or 1),
                "is_header": bool(cell.get("is_header")),
            }
        )
    if not carried_cells:
        return None

    repaired_cells = [dict(cell) for cell in current_cells]
    position_to_index = {
        (int(cell.get("row") or 0), int(cell.get("col") or 0)): index
        for index, cell in enumerate(repaired_cells)
    }
    replacements = 0
    for carry_cell in carried_cells:
        index = position_to_index.get((1, int(carry_cell["col"])))
        if index is None:
            return None
        current_cell = repaired_cells[index]
        current_text = normalize_text(str(current_cell.get("text") or ""))
        carry_text = str(carry_cell["text"])
        if current_text and current_text != carry_text:
            return None
        repaired_cells[index] = {
            **current_cell,
            "text": carry_text,
            "rowspan": int(carry_cell["rowspan"]),
            "colspan": int(carry_cell["colspan"]),
            "is_header": bool(carry_cell["is_header"]),
        }
        replacements += 1
    if replacements == 0:
        return None
    return repaired_cells


def _coerce_table_cells(value: object) -> list[dict[str, object]]:
    if not isinstance(value, list):
        return []
    return [dict(cell) for cell in value if isinstance(cell, dict)]


def _serialize_table_cells_html(table_cells: list[dict[str, object]]) -> str:
    row_count = infer_table_row_count(table_cells) or 0
    if row_count <= 0:
        return "<table></table>"
    cells_by_row: dict[int, list[dict[str, object]]] = {}
    for cell in table_cells:
        row_number = int(cell.get("row") or 0)
        if row_number <= 0:
            continue
        cells_by_row.setdefault(row_number, []).append(cell)
    html_rows: list[str] = []
    for row_number in range(1, row_count + 1):
        row_cells = sorted(
            cells_by_row.get(row_number, ()),
            key=lambda item: int(item.get("col") or 0),
        )
        rendered_cells: list[str] = []
        for cell in row_cells:
            tag_name = "th" if bool(cell.get("is_header")) else "td"
            attrs: list[str] = []
            rowspan = int(cell.get("rowspan") or 1)
            colspan = int(cell.get("colspan") or 1)
            if rowspan > 1:
                attrs.append(f' rowspan="{rowspan}"')
            if colspan > 1:
                attrs.append(f' colspan="{colspan}"')
            rendered_cells.append(
                f"<{tag_name}{''.join(attrs)}>{escape(str(cell.get('text') or ''))}</{tag_name}>"
            )
        html_rows.append(f"<tr>{''.join(rendered_cells)}</tr>")
    return f"<table>{''.join(html_rows)}</table>"


def _enrich_relationships(rows: list[dict[str, object]]) -> None:
    pending_captions: list[dict[str, object]] = []
    open_table_context: dict[str, object] | None = None
    last_attachable_owner: dict[str, object] | None = None

    for row in rows:
        row_type = str(row.get("row_type") or "")
        if row_type == "table_caption":
            pending_captions.append(row)
            continue

        if row_type == "table":
            continuation_group_id = str(
                row.get("continuation_group_id") or row.get("row_id") or ""
            ) or str(row["row_id"])
            owner_row_id = str(row.get("owner_row_id") or "").strip() or None
            relation_type = str(row.get("relation_type") or "").strip() or None
            header_signature = _table_header_signature(str(row.get("html") or ""))
            continuation_hint = any(
                _is_continuation_caption(str(caption.get("text_normalized") or ""))
                for caption in pending_captions
            )

            if relation_type == "table_continuation" and continuation_group_id:
                owner_row_id = owner_row_id or continuation_group_id
            elif continuation_hint and open_table_context is not None:
                continuation_group_id = str(open_table_context["continuation_group_id"])
                owner_row_id = str(open_table_context["continuation_group_id"])
                relation_type = "table_continuation"
            elif (
                open_table_context is not None
                and not pending_captions
                and header_signature
                and header_signature == open_table_context.get("header_signature")
            ):
                continuation_group_id = str(open_table_context["continuation_group_id"])
                owner_row_id = str(open_table_context["continuation_group_id"])
                relation_type = "table_continuation"
                row["is_repeated_candidate"] = True

            row["continuation_group_id"] = continuation_group_id
            row["owner_row_id"] = owner_row_id
            row["relation_type"] = relation_type
            row["table_caption_hint"] = _primary_caption_text(pending_captions)

            for caption in pending_captions:
                caption["owner_row_id"] = row["row_id"]
                caption["relation_type"] = "caption_of"
                caption["continuation_group_id"] = continuation_group_id
            pending_captions.clear()

            open_table_context = {
                "row_id": row["row_id"],
                "continuation_group_id": continuation_group_id,
                "header_signature": header_signature,
            }
            last_attachable_owner = {
                "row_id": row["row_id"],
                "continuation_group_id": continuation_group_id,
            }
            continue

        if row_type == "note" and last_attachable_owner is not None:
            row["owner_row_id"] = last_attachable_owner["row_id"]
            row["relation_type"] = "note_of"
            row["continuation_group_id"] = last_attachable_owner["continuation_group_id"]
            continue

        if row_type in {"heading", "paragraph", "toc_entry"}:
            last_attachable_owner = {
                "row_id": row["row_id"],
                "continuation_group_id": row["row_id"],
            }
            open_table_context = None
            pending_captions.clear()
            continue

        if row_type in {"page_number", "image", "footer"}:
            continue

        pending_captions.clear()
        open_table_context = None


def _is_continuation_caption(text: str) -> bool:
    return text.strip().replace(" ", "").startswith("续表")


def _table_header_signature(html: str) -> str | None:
    if not html:
        return None
    match = _TABLE_ROW_RE.search(html)
    if not match:
        return None
    header_text = _TABLE_TAG_RE.sub(" ", match.group(1))
    signature = " ".join(part for part in header_text.split() if part).strip().lower()
    return signature or None


def _primary_caption_text(captions: list[dict[str, object]]) -> str | None:
    for caption in captions:
        text = str(caption.get("text_normalized") or "").strip()
        if text:
            return text
    return None


def _assign_table_fragment_ids(rows: list[dict[str, object]]) -> None:
    groups: dict[str, list[dict[str, object]]] = {}
    for row in rows:
        if str(row.get("row_type") or "") != "table":
            continue
        group_id = str(row.get("continuation_group_id") or row.get("row_id") or "")
        if group_id:
            groups.setdefault(group_id, []).append(row)

    for group_id, tables in groups.items():
        fragment_id = f"tablefrag:{hashlib.sha1(group_id.encode('utf-8')).hexdigest()[:12]}"
        for table_row in tables:
            table_row["table_fragment_id"] = fragment_id


def _propagate_table_caption_hints(rows: list[dict[str, object]]) -> None:
    captions_by_owner: dict[str, str] = {}
    for row in rows:
        if str(row.get("row_type") or "") != "table_caption":
            continue
        owner_row_id = str(row.get("owner_row_id") or "").strip()
        text = str(row.get("text_normalized") or "").strip()
        if owner_row_id and text and owner_row_id not in captions_by_owner:
            captions_by_owner[owner_row_id] = text

    for row in rows:
        if str(row.get("row_type") or "") != "table":
            continue
        row_id = str(row.get("row_id") or "")
        if row_id in captions_by_owner:
            row["table_caption_hint"] = captions_by_owner[row_id]
