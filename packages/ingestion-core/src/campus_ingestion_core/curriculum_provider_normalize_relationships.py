from __future__ import annotations

import hashlib
import re
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

_MISSING_TEACHING_HOURS_SECTION_RE = re.compile(
    r"^(?P<degree>(?:授予学位|学位授予)\s*[:：]\s*.+?(?:第二学士学位|学士学位|学士))"
    r"(?P<body>(?:将本科修读阶段|本科第二学士学位修读阶段).+)$"
)
_SECTION_THREE_STUDY_PERIOD_RE = re.compile(r"^三、学制、总学分和(?:学位授予|授予学位)")
_SECTION_FOUR_TEACHING_HOURS_RE = re.compile(r"^四、各教学环节学时学分")
_SECTION_ONE_TRAINING_GOAL_RE = re.compile(r"^一、培养目标")
_SECTION_TWO_GRADUATION_REQUIREMENTS_RE = re.compile(r"^二、毕业要求")
_SECTION_THREE_GRADUATION_REQUIREMENTS_RE = re.compile(r"^三、毕业要求")
_COURSE_SETTINGS_SECTION_RE = re.compile(r"^五、课程设置和修读建议")
_CHINESE_NUMBERED_SECTION_RE = re.compile(r"^[一二三四五六七八九十]+、")
_CHINESE_PARENTHESIZED_HEADING_RE = re.compile(
    r"^(?P<open>[（(])(?P<number>[一二三四五六七八九十]+)(?P<close>[)）])(?P<body>.+)$"
)
_ORDERED_LIST_LINE_RE = re.compile(r"^(?P<number>[1-9]\d*)(?P<marker>[.．、])\s*(?P<body>.+)$")
_CHINESE_NUMBER_BY_INT = {
    1: "一",
    2: "二",
    3: "三",
    4: "四",
    5: "五",
    6: "六",
    7: "七",
    8: "八",
    9: "九",
    10: "十",
}
_INT_BY_CHINESE_NUMBER = {value: key for key, value in _CHINESE_NUMBER_BY_INT.items()}


def _enrich_source_truth_rows(rows: list[dict[str, object]]) -> None:
    _repair_misnumbered_graduation_requirements_section(rows)
    rows[:] = _repair_missing_teaching_hours_section(rows)
    _repair_course_settings_parenthesized_heading_sequence(rows)
    _repair_repeated_ordered_list_markers(rows)
    _repair_cross_page_table_continuations(rows)
    _enrich_relationships(rows)
    enrich_repeated_candidates(rows)
    enrich_parent_heading_hints(rows)
    enrich_cross_page_continuations(rows, textual_row_types=("paragraph", "list_item"))
    _assign_table_fragment_ids(rows)
    _propagate_table_caption_hints(rows)


def _repair_misnumbered_graduation_requirements_section(rows: list[dict[str, object]]) -> None:
    seen_training_goal = False
    seen_section_two = False
    pending_graduation_heading: dict[str, object] | None = None

    for row in rows:
        row_type = str(row.get("row_type") or "")
        if row_type != "heading":
            continue
        text = normalize_text(str(row.get("text_normalized") or row.get("clean_text") or ""))
        if _SECTION_ONE_TRAINING_GOAL_RE.match(text):
            seen_training_goal = True
            seen_section_two = False
            pending_graduation_heading = None
            continue
        if _SECTION_TWO_GRADUATION_REQUIREMENTS_RE.match(text):
            seen_section_two = True
            pending_graduation_heading = None
            continue
        if seen_training_goal and not seen_section_two and _SECTION_THREE_GRADUATION_REQUIREMENTS_RE.match(text):
            pending_graduation_heading = row
            continue
        if pending_graduation_heading is not None and _SECTION_THREE_STUDY_PERIOD_RE.match(text):
            pending_graduation_heading["text_raw"] = "二、毕业要求"
            pending_graduation_heading["text_normalized"] = "二、毕业要求"
            pending_graduation_heading["classification_reason"] = (
                "curriculum_repair:renumber_graduation_requirements_section"
            )
            pending_graduation_heading = None


def _repair_course_settings_parenthesized_heading_sequence(rows: list[dict[str, object]]) -> None:
    candidates: list[dict[str, object]] = []
    in_course_settings_section = False

    def flush_candidates() -> None:
        if len(candidates) < 3:
            candidates.clear()
            return
        ordinals: list[int] = []
        for candidate in candidates:
            text = _row_text(candidate)
            match = _CHINESE_PARENTHESIZED_HEADING_RE.match(text)
            if match is None:
                candidates.clear()
                return
            ordinal = _INT_BY_CHINESE_NUMBER.get(match.group("number"))
            if ordinal is None:
                candidates.clear()
                return
            ordinals.append(ordinal)
        if not ordinals or ordinals[0] != 1:
            candidates.clear()
            return
        if _is_repairable_one_based_sequence(ordinals):
            expected = list(range(1, len(candidates) + 1))
        else:
            candidates.clear()
            return
        for candidate, current, target in zip(candidates, ordinals, expected, strict=True):
            if current == target:
                continue
            _renumber_chinese_parenthesized_heading(candidate, target)
        candidates.clear()

    for row in rows:
        if str(row.get("row_type") or "") != "heading":
            continue
        text = _row_text(row)
        if _COURSE_SETTINGS_SECTION_RE.match(text):
            flush_candidates()
            in_course_settings_section = True
            continue
        if in_course_settings_section and _CHINESE_NUMBERED_SECTION_RE.match(text):
            flush_candidates()
            in_course_settings_section = False
        if (
            in_course_settings_section
            and row.get("heading_level") == 3
            and _CHINESE_PARENTHESIZED_HEADING_RE.match(text)
        ):
            candidates.append(row)

    flush_candidates()


def _renumber_chinese_parenthesized_heading(row: dict[str, object], target_number: int) -> None:
    text = _row_text(row)
    match = _CHINESE_PARENTHESIZED_HEADING_RE.match(text)
    replacement = _CHINESE_NUMBER_BY_INT.get(target_number)
    if match is None or replacement is None:
        return
    repaired = f"{match.group('open')}{replacement}{match.group('close')}{match.group('body')}"
    _replace_row_text(
        row,
        repaired,
        reason="curriculum_repair:renumber_course_settings_parenthesized_heading",
    )


def _repair_repeated_ordered_list_markers(rows: list[dict[str, object]]) -> None:
    for row in rows:
        if str(row.get("row_type") or "") != "paragraph":
            continue
        text = _row_text(row)
        lines = text.splitlines()
        if len(lines) < 3:
            continue
        matches = [_ORDERED_LIST_LINE_RE.match(line.strip()) for line in lines]
        if any(match is None for match in matches):
            continue
        numbers = [int(match.group("number")) for match in matches if match is not None]
        if not _is_repairable_one_based_sequence(numbers):
            continue
        expected = list(range(1, len(numbers) + 1))
        repaired_lines: list[str] = []
        changed = False
        for expected_number, line, match in zip(expected, lines, matches, strict=True):
            if match is None:
                repaired_lines.append(line)
                continue
            body = match.group("body").strip()
            repaired_line = f"{expected_number}. {body}"
            repaired_lines.append(repaired_line)
            changed = changed or repaired_line != line
        if changed:
            _replace_row_text(
                row,
                "\n".join(repaired_lines),
                reason="curriculum_repair:renumber_repeated_ordered_list_markers",
            )


def _is_repairable_one_based_sequence(numbers: list[int]) -> bool:
    expected = list(range(1, len(numbers) + 1))
    if numbers == expected:
        return False
    if not numbers or numbers[0] != 1:
        return False
    if any(left > right for left, right in zip(numbers, numbers[1:], strict=False)):
        return False
    if any(number < 1 or number > len(numbers) for number in numbers):
        return False
    missing = [number for number in expected if number not in numbers]
    duplicated = [number for number in set(numbers) if numbers.count(number) > 1]
    return len(missing) == 1 and len(duplicated) == 1


def _row_text(row: dict[str, object]) -> str:
    return normalize_text(str(row.get("text_normalized") or row.get("clean_text") or ""))


def _replace_row_text(row: dict[str, object], text: str, *, reason: str) -> None:
    row["text_raw"] = text
    row["text_normalized"] = text
    if "clean_text" in row:
        row["clean_text"] = text
    current_reason = str(row.get("classification_reason") or "").strip()
    if reason not in current_reason.split(";"):
        row["classification_reason"] = f"{current_reason};{reason}" if current_reason else reason


def _repair_missing_teaching_hours_section(
    rows: list[dict[str, object]],
) -> list[dict[str, object]]:
    repaired_rows: list[dict[str, object]] = []
    after_study_period_section = False

    for row in rows:
        row_type = str(row.get("row_type") or "")
        text = normalize_text(str(row.get("text_normalized") or row.get("clean_text") or ""))

        if row_type == "heading":
            after_study_period_section = bool(_SECTION_THREE_STUDY_PERIOD_RE.match(text))
            if _SECTION_FOUR_TEACHING_HOURS_RE.match(text):
                after_study_period_section = False
            repaired_rows.append(row)
            continue

        match = (
            _MISSING_TEACHING_HOURS_SECTION_RE.match(text)
            if after_study_period_section and row_type == "paragraph"
            else None
        )
        if match is None:
            repaired_rows.append(row)
            continue

        degree_text = match.group("degree").strip()
        body_text = match.group("body").strip()
        degree_row = _clone_curriculum_text_row(
            row,
            text=degree_text,
            row_id_suffix=None,
            row_type="paragraph",
            block_role="text",
            heading_level=None,
            section_hint=None,
            classification_reason="curriculum_repair:split_inline_degree_before_section_four",
            preserve_reading_order=True,
        )
        heading_row = _clone_curriculum_text_row(
            row,
            text="四、各教学环节学时学分",
            row_id_suffix="section-4-heading",
            row_type="heading",
            block_role="inferred_missing_section_heading",
            heading_level=2,
            section_hint="section",
            classification_reason="curriculum_repair:insert_missing_section_four_heading",
            preserve_reading_order=False,
        )
        body_row = _clone_curriculum_text_row(
            row,
            text=body_text,
            row_id_suffix="section-4-body",
            row_type="paragraph",
            block_role="text",
            heading_level=None,
            section_hint=None,
            classification_reason="curriculum_repair:split_section_four_body",
            preserve_reading_order=False,
        )
        repaired_rows.extend([degree_row, heading_row, body_row])
        after_study_period_section = False

    return repaired_rows


def _clone_curriculum_text_row(
    row: dict[str, object],
    *,
    text: str,
    row_id_suffix: str | None,
    row_type: str,
    block_role: str,
    heading_level: int | None,
    section_hint: str | None,
    classification_reason: str,
    preserve_reading_order: bool,
) -> dict[str, object]:
    cloned = dict(row)
    if row_id_suffix is not None:
        base_row_id = str(row.get("row_id") or "row").strip() or "row"
        cloned["row_id"] = f"{base_row_id}-{row_id_suffix}"
        cloned["reading_order"] = None
    elif not preserve_reading_order:
        cloned["reading_order"] = None
    cloned["row_type"] = row_type
    cloned["block_role"] = block_role
    cloned["heading_level"] = heading_level
    cloned["text_raw"] = text
    cloned["text_normalized"] = text
    cloned["html"] = None
    cloned["table_cells"] = None
    cloned["is_blank"] = False
    cloned["title_candidate_score"] = 0.75 if row_type == "heading" else 0.0
    cloned["section_hint"] = section_hint
    cloned["classification_confidence"] = 0.82
    cloned["classification_reason"] = classification_reason
    cloned["repeat_cluster_id"] = None
    cloned["repeat_frequency"] = 0
    cloned["repeat_position_band"] = None
    cloned["parent_heading_hint"] = None
    cloned["list_level_hint"] = None
    cloned["continues_from_previous_page"] = False
    cloned["continues_to_next_page"] = False
    cloned["table_fragment_id"] = None
    cloned["table_header_rows"] = None
    cloned["table_row_count"] = None
    cloned["table_column_count"] = None
    cloned["table_has_merged_cells"] = None
    cloned["table_caption_hint"] = None
    cloned["owner_row_id"] = None
    cloned["relation_type"] = None
    cloned["continuation_group_id"] = None
    return cloned


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
