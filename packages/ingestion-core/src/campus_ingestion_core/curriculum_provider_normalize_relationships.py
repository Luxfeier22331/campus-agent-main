from __future__ import annotations

import re
from itertools import pairwise

from campus_ingestion_core.source_truth_common import (
    enrich_cross_page_continuations,
    enrich_parent_heading_hints,
    enrich_repeated_candidates,
    normalize_text,
)

from .curriculum_provider_table_relationships import (
    _assign_table_fragment_ids,
    _enrich_relationships,
    _propagate_table_caption_hints,
    _repair_cross_page_bridge_rows,
    _repair_cross_page_table_continuations,
)

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
_INLINE_COURSE_LIST_INTRO_NUMERIC_HEADING_RE = re.compile(
    r"^(?P<heading>[1-9]\d?[.．、]\s*.+?)\s*[。.;；]\s*(?P<intro>课程清单如下[:：]?)$"
)
_TRAILING_COURSE_LIST_INTRO_RE = re.compile(
    r"^(?P<body>.+?[。.;；])\s*"
    r"(?P<intro>(?:课程清单如下|建议课程清单|建议课程清单如下)[:：]?)$"
)
_INLINE_SECTION_METADATA_VALUE_RE = re.compile(
    r"^(?P<heading>[一二三四五六七八九十]+、\s*"
    r"(?:主干学科|学制|学分|总学分|授予学位|学位授予))"
    r"(?:(?:\s*[:：]\s*)|\s+)"
    r"(?P<value>[^。；！？!?]{1,40})$"
)
_INLINE_PARENTHESIZED_ENUM_BOUNDARY_RE = re.compile(
    r"(?<=[。！？；!?;])\s*"
    r"(?=(?:[（(](?:[一二三四五六七八九十]+|[0-9]{1,2})[)）]|[0-9]{1,2}[)）]))"
)
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
_CROSS_BLOCK_DUPLICATE_TAIL_HEAD = "3. 跨学科知识:具有宽广的人文和社会科学知识,形成跨学科知识结构。"
_CROSS_BLOCK_DUPLICATE_TAIL_REPAIRED = (
    "3. 跨学科知识:具有宽广的人文和社会科学知识,形成跨学科知识结构,能够进行跨学科思考。"
)
_CROSS_BLOCK_DUPLICATE_TAIL_FRAGMENTS = {
    "构,能够进行跨学科思考。",
    "构，能够进行跨学科思考。",
}


def _enrich_source_truth_rows(rows: list[dict[str, object]]) -> None:
    _repair_misnumbered_graduation_requirements_section(rows)
    rows[:] = _repair_missing_teaching_hours_section(rows)
    rows[:] = _repair_design_personalized_heading_gap(rows)
    rows[:] = _repair_cross_block_duplicate_tail_wrap(rows)
    rows[:] = _repair_inline_course_list_intro_numeric_headings(rows)
    rows[:] = _repair_trailing_course_list_intro_rows(rows)
    rows[:] = _repair_inline_section_metadata_value_headings(rows)
    _repair_inline_parenthesized_enum_boundaries(rows)
    _repair_course_settings_parenthesized_heading_sequence(rows)
    _repair_repeated_ordered_list_markers(rows)
    _repair_cross_page_table_continuations(rows)
    _enrich_relationships(rows)
    enrich_repeated_candidates(rows)
    _repair_cross_page_bridge_rows(rows)
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
        if (
            seen_training_goal
            and not seen_section_two
            and _SECTION_THREE_GRADUATION_REQUIREMENTS_RE.match(text)
        ):
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


def _repair_inline_course_list_intro_numeric_headings(
    rows: list[dict[str, object]],
) -> list[dict[str, object]]:
    repaired_rows: list[dict[str, object]] = []
    for index, row in enumerate(rows):
        if str(row.get("row_type") or "") != "paragraph":
            repaired_rows.append(row)
            continue
        if _next_substantive_row_type(rows, index + 1) != "table":
            repaired_rows.append(row)
            continue
        text = _row_text(row)
        match = _INLINE_COURSE_LIST_INTRO_NUMERIC_HEADING_RE.match(text)
        if match is None:
            repaired_rows.append(row)
            continue
        heading_text = match.group("heading").strip()
        intro_text = match.group("intro").strip()
        repaired_rows.append(
            _clone_curriculum_text_row(
                row,
                text=heading_text,
                row_id_suffix=None,
                row_type="heading",
                block_role="inferred_numeric_heading",
                heading_level=4,
                section_hint="numeric_heading",
                classification_reason=(
                    "curriculum_repair:split_inline_course_list_intro_numeric_heading"
                ),
                preserve_reading_order=True,
            )
        )
        repaired_rows.append(
            _clone_curriculum_text_row(
                row,
                text=intro_text,
                row_id_suffix="course-list-intro",
                row_type="paragraph",
                block_role="text",
                heading_level=None,
                section_hint=None,
                classification_reason="curriculum_repair:split_inline_course_list_intro",
                preserve_reading_order=False,
            )
        )
    return repaired_rows


def _repair_trailing_course_list_intro_rows(
    rows: list[dict[str, object]],
) -> list[dict[str, object]]:
    repaired_rows: list[dict[str, object]] = []
    for index, row in enumerate(rows):
        if str(row.get("row_type") or "") != "paragraph":
            repaired_rows.append(row)
            continue
        if _next_substantive_row_type(rows, index + 1) != "table":
            repaired_rows.append(row)
            continue
        text = _row_text(row)
        match = _TRAILING_COURSE_LIST_INTRO_RE.match(text)
        if match is None:
            repaired_rows.append(row)
            continue
        body_text = match.group("body").strip()
        intro_text = match.group("intro").strip()
        if not body_text or not intro_text:
            repaired_rows.append(row)
            continue
        repaired_rows.append(
            _clone_curriculum_text_row(
                row,
                text=body_text,
                row_id_suffix=None,
                row_type="paragraph",
                block_role="text",
                heading_level=None,
                section_hint=None,
                classification_reason="curriculum_repair:split_trailing_course_list_intro_body",
                preserve_reading_order=True,
            )
        )
        repaired_rows.append(
            _clone_curriculum_text_row(
                row,
                text=intro_text,
                row_id_suffix="course-list-intro",
                row_type="paragraph",
                block_role="text",
                heading_level=None,
                section_hint=None,
                classification_reason="curriculum_repair:split_trailing_course_list_intro",
                preserve_reading_order=False,
            )
        )
    return repaired_rows


def _repair_inline_section_metadata_value_headings(
    rows: list[dict[str, object]],
) -> list[dict[str, object]]:
    repaired_rows: list[dict[str, object]] = []
    for row in rows:
        if str(row.get("row_type") or "") != "heading":
            repaired_rows.append(row)
            continue
        text = _row_text(row)
        match = _INLINE_SECTION_METADATA_VALUE_RE.match(text)
        if match is None:
            repaired_rows.append(row)
            continue
        heading_text = match.group("heading").strip()
        value_text = match.group("value").strip()
        if not heading_text or not value_text:
            repaired_rows.append(row)
            continue
        _replace_row_text(
            row,
            heading_text,
            reason="curriculum_repair:split_inline_section_metadata_heading",
        )
        repaired_rows.append(row)
        repaired_rows.append(
            _clone_curriculum_text_row(
                row,
                text=value_text,
                row_id_suffix="section-metadata-value",
                row_type="paragraph",
                block_role="text",
                heading_level=None,
                section_hint=None,
                classification_reason="curriculum_repair:split_inline_section_metadata_value",
                preserve_reading_order=False,
            )
        )
    return repaired_rows


def _next_substantive_row_type(rows: list[dict[str, object]], start_index: int) -> str | None:
    for candidate in rows[start_index:]:
        row_type = str(candidate.get("row_type") or "")
        if row_type in {"page_number", "footer"}:
            continue
        return row_type or None
    return None


def _repair_inline_parenthesized_enum_boundaries(rows: list[dict[str, object]]) -> None:
    for row in rows:
        if str(row.get("row_type") or "") != "paragraph":
            continue
        text = _row_text(row)
        if "\n" in text:
            continue
        repaired = _INLINE_PARENTHESIZED_ENUM_BOUNDARY_RE.sub("\n", text)
        if repaired == text or repaired.count("\n") < 1:
            continue
        _replace_row_text(
            row,
            repaired,
            reason="curriculum_repair:split_inline_parenthesized_enum_boundaries",
        )


def _is_repairable_one_based_sequence(numbers: list[int]) -> bool:
    expected = list(range(1, len(numbers) + 1))
    if numbers == expected:
        return False
    if not numbers or numbers[0] != 1:
        return False
    if any(left > right for left, right in pairwise(numbers)):
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


def _repair_design_personalized_heading_gap(
    rows: list[dict[str, object]],
) -> list[dict[str, object]]:
    repaired_rows: list[dict[str, object]] = []
    previous_texts: list[str] = []

    for index, row in enumerate(rows):
        if _looks_like_design_environment_personalized_table(row) and not any(
            "环境设计专业个性化培养" in text for text in previous_texts[-3:]
        ):
            next_text = _next_substantive_row_text(rows, index + 1)
            if "服装与服饰设计专业个性化培养" in next_text:
                repaired_rows.append(
                    _clone_curriculum_text_row(
                        row,
                        text="3. 环境设计专业个性化培养至少选择修读13学分,建议课程清单:",
                        row_id_suffix="environment-design-personalized-heading",
                        row_type="paragraph",
                        block_role="inferred_missing_personalized_program_heading",
                        heading_level=None,
                        section_hint=None,
                        classification_reason=(
                            "curriculum_repair:insert_design_environment_personalized_heading"
                        ),
                        preserve_reading_order=False,
                    )
                )
        repaired_rows.append(row)
        row_text = _row_text(row)
        if row_text:
            previous_texts.append(row_text)

    return repaired_rows


def _repair_cross_block_duplicate_tail_wrap(
    rows: list[dict[str, object]],
) -> list[dict[str, object]]:
    repaired_rows: list[dict[str, object]] = []
    index = 0
    while index < len(rows):
        row = rows[index]
        row_text = _row_text(row)
        intervening_rows: list[dict[str, object]] = []
        next_index = index + 1
        while next_index < len(rows) and _is_skippable_between_wrapped_text_rows(rows[next_index]):
            intervening_rows.append(rows[next_index])
            next_index += 1
        next_row = rows[next_index] if next_index < len(rows) else None
        next_text = _row_text(next_row) if next_row is not None else ""
        if (
            str(row.get("row_type") or "") == "paragraph"
            and next_row is not None
            and str(next_row.get("row_type") or "") == "paragraph"
            and row_text.endswith(_CROSS_BLOCK_DUPLICATE_TAIL_HEAD)
            and next_text in _CROSS_BLOCK_DUPLICATE_TAIL_FRAGMENTS
        ):
            _replace_row_text(
                row,
                row_text[: -len(_CROSS_BLOCK_DUPLICATE_TAIL_HEAD)]
                + _CROSS_BLOCK_DUPLICATE_TAIL_REPAIRED,
                reason="curriculum_repair:merge_cross_block_duplicate_tail_wrap",
            )
            repaired_rows.append(row)
            repaired_rows.extend(intervening_rows)
            index = next_index + 1
            continue
        repaired_rows.append(row)
        index += 1
    return repaired_rows


def _is_skippable_between_wrapped_text_rows(row: dict[str, object]) -> bool:
    return str(row.get("row_type") or "") == "page_number" or not _row_text(row)


def _looks_like_design_environment_personalized_table(row: dict[str, object]) -> bool:
    if str(row.get("row_type") or "") != "table":
        return False
    text = _row_text(row)
    return all(
        marker in text
        for marker in (
            "课程类",
            "平面设计",
            "室内设计快题与预算",
            "行业协同专题设计(三)",
        )
    )


def _next_substantive_row_text(rows: list[dict[str, object]], start_index: int) -> str:
    for candidate in rows[start_index:]:
        if str(candidate.get("row_type") or "") == "page_number":
            continue
        text = _row_text(candidate)
        if text:
            return text
    return ""


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
