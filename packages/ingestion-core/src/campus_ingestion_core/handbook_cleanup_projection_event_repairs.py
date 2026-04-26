from __future__ import annotations

import re

from campus_ingestion_core.handbook_cleanup_normalize import normalize_handbook_body_text
from campus_ingestion_core.handbook_cleanup_policy import _looks_like_attachment_title_text
from campus_ingestion_core.handbook_cleanup_projection_selection import row_text


def _repair_table_after_intro_event_order(events: list[dict[str, object]]) -> None:
    for table_index, event in enumerate(tuple(events)):
        if event.get("kind") != "table":
            continue
        section_path = tuple(event.get("section_path") or ())
        for intro_index in range(table_index + 1, len(events)):
            candidate = events[intro_index]
            if candidate.get("kind") == "section":
                break
            if tuple(candidate.get("section_path") or ()) != section_path:
                break
            if candidate.get("kind") != "article":
                continue
            if (
                normalize_handbook_body_text(str(candidate.get("text") or ""))
                != "各专业学分要求如下:"
            ):
                continue
            table_event = events.pop(table_index)
            events.insert(intro_index, table_event)
            return


def _attach_consecutive_appendix_section_queue_to_following_tables(
    events: list[dict[str, object]],
) -> None:
    index = 0
    while index < len(events):
        if not _is_appendix_form_section_event(events[index]):
            index += 1
            continue

        run_start = index
        section_run: list[dict[str, object]] = []
        while index < len(events) and _is_appendix_form_section_event(events[index]):
            section_run.append(events[index])
            index += 1

        if len(section_run) < 2:
            continue

        scan_index = index
        table_indices: list[int] = []
        while scan_index < len(events) and len(table_indices) < len(section_run):
            kind = events[scan_index].get("kind")
            if kind == "table":
                table_indices.append(scan_index)
                scan_index += 1
                continue
            if kind == "section":
                break
            if kind in {"article", "policy_page"}:
                break
            scan_index += 1

        if len(table_indices) < len(section_run):
            continue

        segment_end = table_indices[-1] + 1
        segment_after_section_run = events[index:segment_end]
        rewritten_segment: list[dict[str, object]] = []
        assigned_table_count = 0
        for event in segment_after_section_run:
            if event.get("kind") == "table" and assigned_table_count < len(section_run):
                section_event = dict(section_run[assigned_table_count])
                table_event = dict(event)
                table_event["section_path"] = tuple(section_event.get("section_path") or ())
                rewritten_segment.append(section_event)
                rewritten_segment.append(table_event)
                assigned_table_count += 1
                continue
            rewritten_segment.append(event)

        events[run_start:segment_end] = rewritten_segment
        index = run_start + len(rewritten_segment)


def _is_appendix_form_section_event(event: dict[str, object]) -> bool:
    if event.get("kind") != "section":
        return False
    text = normalize_handbook_body_text(str(event.get("text") or ""))
    match = re.fullmatch(
        r"(?:附件|附表|附录)[0-9一二三四五六七八九十百千万〇零两]+[:：](?P<title>.+)",
        text,
    )
    if match is None:
        return False
    return _looks_like_attachment_title_text(match.group("title"))


def _extract_standalone_appendix_label_marker(text: str) -> str | None:
    normalized = normalize_handbook_body_text(text)
    match = re.fullmatch(
        r"(?P<marker>附件|附表|附录)\s*(?P<label>[0-9一二三四五六七八九十百千万〇零两]+)\s*[:：]?",
        normalized,
    )
    if match is None:
        return None
    return f"{match.group('marker')}{match.group('label')}:"


def _extract_inline_appendix_labeled_heading(text: str) -> str | None:
    normalized = normalize_handbook_body_text(text)
    match = re.fullmatch(
        r"(?P<marker>附件|附表|附录)\s*(?P<label>[0-9一二三四五六七八九十百千万〇零两]+)\s*[:：]\s*(?P<title>.+)",
        normalized,
    )
    if match is None:
        return None
    title = normalize_handbook_body_text(match.group("title"))
    if not title:
        return None
    return _reattach_pending_appendix_label(
        f"{match.group('marker')}{match.group('label')}:",
        title,
    )


def _reattach_pending_appendix_label(pending_label: str | None, heading: str) -> str:
    normalized_heading = normalize_handbook_body_text(heading)
    if not pending_label:
        return normalized_heading
    normalized_label = normalize_handbook_body_text(pending_label).rstrip(":：")
    if normalized_heading.startswith(normalized_label):
        return normalized_heading
    stripped_heading = re.sub(
        r"^[0-9一二三四五六七八九十百千万〇零两]+[:：]\s*",
        "",
        normalized_heading,
    ).strip()
    if stripped_heading.startswith("《") and stripped_heading.endswith("》"):
        stripped_heading = stripped_heading[1:-1].strip()
    return f"{normalized_label}:{stripped_heading}"


def _previous_event_was_heading_terminal_provision(events: list[dict[str, object]]) -> bool:
    if not events:
        return False
    previous = events[-1]
    return bool(
        previous.get("kind") == "policy_page"
        and previous.get("provision_label") is not None
        and previous.get("render_heading") is not False
        and not tuple(previous.get("section_path") or ())
    )


def _looks_like_weekly_report_checklist_item(
    text: str,
    *,
    current_section_nodes: list[tuple[int, str]],
) -> bool:
    if not any("周查月报" in section_text for _, section_text in current_section_nodes):
        return False
    normalized = normalize_handbook_body_text(text).rstrip("。")
    return bool(
        re.fullmatch(
            r"[（(][一二三四五六七八九十百千万〇零两0-9]+[)）](?:有无.+|其他需要报告.+事项)",
            normalized,
        )
    )


def expand_multiline_paragraph_rows(
    content_rows: list[dict[str, object]],
) -> list[dict[str, object]]:
    expanded_rows: list[dict[str, object]] = []
    for row in content_rows:
        if str(row.get("row_type") or "") not in {"paragraph", "list_item"}:
            expanded_rows.append(row)
            continue
        text = row_text(row)
        if not text or "\n" not in text:
            expanded_rows.append(row)
            continue
        fragments = [line.strip() for line in text.splitlines() if line.strip()]
        if len(fragments) <= 1:
            expanded_rows.append(row)
            continue
        for index, fragment in enumerate(fragments, start=1):
            expanded_row = dict(row)
            expanded_row["row_id"] = f"{row.get('row_id')}-part-{index:02d}"
            expanded_row["text_raw"] = fragment
            expanded_row["text_normalized"] = fragment
            expanded_rows.append(expanded_row)
    return expanded_rows


def next_content_text(rows: list[dict[str, object]], start_index: int) -> str | None:
    for row in rows[start_index:]:
        if str(row.get("row_type") or "") == "table":
            continue
        text = row_text(row)
        if text:
            return text
    return None


def next_nonblank_row(rows: list[dict[str, object]], start_index: int) -> dict[str, object] | None:
    for row in rows[start_index:]:
        row_type = str(row.get("row_type") or "")
        if row_type == "table":
            return row
        if row_text(row):
            return row
    return None


def has_following_table_before_content_break(
    rows: list[dict[str, object]], start_index: int
) -> bool:
    for row in rows[start_index:]:
        row_type = str(row.get("row_type") or "")
        if row_type == "table":
            return True
        text = row_text(row)
        if not text:
            continue
        if row_type == "heading":
            continue
        return False
    return False


__all__ = (
    "_attach_consecutive_appendix_section_queue_to_following_tables",
    "_extract_inline_appendix_labeled_heading",
    "_extract_standalone_appendix_label_marker",
    "_looks_like_weekly_report_checklist_item",
    "_previous_event_was_heading_terminal_provision",
    "_reattach_pending_appendix_label",
    "_repair_table_after_intro_event_order",
    "expand_multiline_paragraph_rows",
    "has_following_table_before_content_break",
    "next_content_text",
    "next_nonblank_row",
)
