from __future__ import annotations

import re

from campus_ingestion_core.handbook_article_structure import is_title_like_heading
from campus_ingestion_core.handbook_cleanup_normalize import (
    _looks_like_handbook_page_marker,
    _split_glued_structural_heading,
    normalize_handbook_article_body_text,
    normalize_handbook_body_text,
)
from campus_ingestion_core.handbook_cleanup_policy import (
    _extract_appendix_heading_title,
    _is_duplicate_attachment_cover_fragment,
    _is_duplicate_attachment_cover_text,
    _looks_like_ancillary_note_line,
    _looks_like_appendix_heading,
    _looks_like_appendix_leaf_section_heading,
    _looks_like_appendix_marker_only,
    _looks_like_attachment_title_text,
    _looks_like_list_entry,
    _looks_like_list_section_heading,
    _looks_like_navigation_policy_leaf,
    _looks_like_policy_doc_no,
    _next_policy_leaf_section_rank,
    _normalize_attachment_heading_text,
    _normalize_policy_doc_no,
    _normalize_policy_page_body_text,
    _normalize_policy_page_table_context,
    _should_emit_inline_policy_provision,
    _split_appendix_inline_title,
    _split_article_line,
    _split_attachment_title_with_body,
    _split_inline_enumerated_provision,
)
from campus_ingestion_core.handbook_cleanup_projection_selection import coerce_int, row_text
from campus_ingestion_core.handbook_cleanup_shared import LIST_SECTION_RANK
from campus_ingestion_core.handbook_cleanup_tables import (
    _looks_like_form_cover_table_context,
    _looks_like_form_table,
    _looks_like_form_template_legend,
    _looks_like_table_context,
    _looks_like_table_lead_label,
    _merge_policy_fragment_into_previous_line,
    _normalize_table_matrix,
    _project_phone_table_policy_pages,
    _repair_form_table_ocr_artifacts,
    _should_attach_policy_page_to_following_table,
    _should_merge_policy_fragment_into_previous_line,
)
from campus_ingestion_core.handbook_structure import classify_structural_heading


def build_document_events(
    content_rows: list[dict[str, object]],
) -> tuple[list[dict[str, object]], str | None, str | None]:
    content_rows = expand_multiline_paragraph_rows(content_rows)
    policy_doc_no: str | None = None
    current_section_nodes: list[tuple[int, str]] = []
    preface_parts: list[str] = []
    events: list[dict[str, object]] = []
    current_article: dict[str, object] | None = None
    current_policy_page: dict[str, object] | None = None
    active_article_context: dict[str, object] | None = None
    pending_table_context: str | None = None
    pending_form_table_legend_skip = False
    appendix_context_active = False
    pending_appendix_marker_only = False
    pending_appendix_label: str | None = None

    def flush_article() -> None:
        nonlocal current_article
        if current_article is None:
            return
        current_article["text"] = normalize_handbook_article_body_text(
            "\n".join(current_article.pop("parts"))
        )
        events.append(current_article)
        current_article = None

    def flush_policy_page() -> None:
        nonlocal current_policy_page
        if current_policy_page is None:
            return
        text = _normalize_policy_page_body_text("\n".join(current_policy_page.pop("parts")))
        if text:
            current_policy_page["text"] = text
            events.append(current_policy_page)
        current_policy_page = None

    def append_section(*, text: str, rank: int = LIST_SECTION_RANK) -> None:
        nonlocal current_section_nodes
        normalized_heading = normalize_handbook_body_text(text)
        if not normalized_heading or _looks_like_appendix_leaf_section_heading(normalized_heading):
            return
        current_section_nodes = [node for node in current_section_nodes if node[0] < rank]
        current_section_nodes.append((rank, normalized_heading))
        events.append(
            {
                "kind": "section",
                "text": normalized_heading,
                "section_path": tuple(node_text for _, node_text in current_section_nodes),
            }
        )

    for row_index, row in enumerate(content_rows):
        row_type = str(row.get("row_type") or "")
        text = row_text(row)
        page_start = coerce_int(row.get("page_start")) or 0
        page_end = coerce_int(row.get("page_end")) or page_start
        next_text = next_content_text(content_rows, row_index + 1)
        next_row = next_nonblank_row(content_rows, row_index + 1)
        followed_by_table = has_following_table_before_content_break(content_rows, row_index + 1)

        if row_type == "table":
            roster_policy_pages = _project_phone_table_policy_pages(
                row=row, page_start=page_start, page_end=page_end
            )
            if roster_policy_pages:
                flush_article()
                flush_policy_page()
                active_article_context = None
                pending_table_context = None
                pending_form_table_legend_skip = False
                appendix_context_active = False
                pending_appendix_marker_only = False
                events.extend(roster_policy_pages)
            policy_page_table_context: str | None = None
            if current_policy_page is not None:
                candidate_policy_text = normalize_handbook_body_text(
                    "\n".join(current_policy_page["parts"])
                )
                if appendix_context_active and _should_attach_policy_page_to_following_table(
                    candidate_policy_text
                ):
                    policy_page_table_context = _normalize_policy_page_table_context(
                        candidate_policy_text
                    )
                    current_policy_page = None
                else:
                    flush_policy_page()
            table_context = (
                pending_table_context
                if active_article_context is not None
                else policy_page_table_context
            )
            if current_article is not None and active_article_context is not None:
                flush_article()
            if (
                table_context is None
                and not current_section_nodes
                and not any(event["kind"] != "section" for event in events)
            ):
                preface_table_context = _normalize_policy_page_table_context(
                    "\n".join(preface_parts)
                )
                if preface_table_context is not None and _looks_like_form_cover_table_context(
                    preface_table_context
                ):
                    table_context = preface_table_context
                    preface_parts.clear()
            table_matrix = _normalize_table_matrix(
                html=row.get("html"),
                table_cells=row.get("table_cells"),
            )
            form_like_table = False
            if table_matrix:
                normalized_table_matrix = [
                    tuple(normalize_handbook_body_text(cell) for cell in table_row)
                    for table_row in table_matrix
                ]
                caption_text = (
                    normalize_handbook_body_text(table_context)
                    if isinstance(table_context, str)
                    else ""
                )
                form_like_table = _looks_like_form_table(
                    normalized_table_matrix, caption_text=caption_text
                )
            events.append(
                {
                    "kind": "table",
                    "page_start": page_start,
                    "page_end": page_end,
                    "text": _repair_form_table_ocr_artifacts(
                        normalize_handbook_body_text(text),
                        form_like_table=form_like_table,
                    ),
                    "table_cells": _repair_form_table_ocr_artifacts(
                        row.get("table_cells"),
                        form_like_table=form_like_table,
                    ),
                    "html": _repair_form_table_ocr_artifacts(
                        row.get("html"),
                        form_like_table=form_like_table,
                    ),
                    "section_path": tuple(node_text for _, node_text in current_section_nodes),
                    "article_label": active_article_context["label"]
                    if active_article_context is not None
                    else None,
                    "table_context": table_context,
                }
            )
            pending_form_table_legend_skip = form_like_table
            pending_table_context = None
            continue

        if not text:
            continue
        if _looks_like_handbook_page_marker(text):
            continue

        if appendix_context_active and _looks_like_form_template_legend(text):
            continue
        if pending_form_table_legend_skip and _looks_like_form_template_legend(text):
            continue
        if pending_form_table_legend_skip:
            pending_form_table_legend_skip = False

        appendix_labeled_heading = _extract_inline_appendix_labeled_heading(text)
        if appendix_labeled_heading is not None:
            flush_article()
            flush_policy_page()
            active_article_context = None
            pending_table_context = None
            appendix_context_active = True
            pending_appendix_marker_only = False
            pending_appendix_label = None
            append_section(text=appendix_labeled_heading)
            continue

        appendix_label_marker = _extract_standalone_appendix_label_marker(text)
        if appendix_label_marker is not None:
            flush_article()
            flush_policy_page()
            active_article_context = None
            pending_table_context = None
            appendix_context_active = True
            pending_appendix_marker_only = True
            pending_appendix_label = appendix_label_marker
            continue

        appendix_heading_title = _extract_appendix_heading_title(text)
        if appendix_heading_title is not None:
            flush_article()
            flush_policy_page()
            active_article_context = None
            pending_table_context = None
            appendix_context_active = True
            append_section(text=appendix_heading_title)
            pending_appendix_label = None
            continue

        if _looks_like_appendix_marker_only(text):
            flush_article()
            flush_policy_page()
            active_article_context = None
            pending_table_context = None
            appendix_context_active = True
            pending_appendix_marker_only = True
            pending_appendix_label = None
            continue

        if appendix_context_active and _is_duplicate_attachment_cover_fragment(
            text=text,
            current_section_nodes=current_section_nodes,
        ):
            pending_appendix_marker_only = False
            pending_appendix_label = None
            continue

        if appendix_context_active and pending_appendix_marker_only:
            normalized_candidate = normalize_handbook_body_text(text)
            if (
                normalized_candidate
                and not _looks_like_appendix_heading(normalized_candidate)
                and (row_type == "heading" or is_title_like_heading(normalized_candidate))
            ):
                flush_article()
                flush_policy_page()
                active_article_context = None
                pending_table_context = None
                append_section(
                    text=_reattach_pending_appendix_label(
                        pending_appendix_label,
                        normalized_candidate,
                    )
                )
                pending_appendix_label = None
                pending_appendix_marker_only = False
                continue
            if normalized_candidate and (
                _looks_like_attachment_title_text(normalized_candidate)
                or _looks_like_appendix_leaf_section_heading(normalized_candidate)
            ):
                flush_article()
                flush_policy_page()
                active_article_context = None
                pending_table_context = None
                append_section(
                    text=_reattach_pending_appendix_label(
                        pending_appendix_label,
                        _normalize_attachment_heading_text(normalized_candidate),
                    ),
                    rank=_next_policy_leaf_section_rank(current_section_nodes),
                )
                pending_appendix_label = None
                pending_appendix_marker_only = False
                continue
            appendix_inline_title = _split_appendix_inline_title(text)
            if appendix_inline_title is not None:
                appendix_title, appendix_body = appendix_inline_title
                flush_article()
                flush_policy_page()
                active_article_context = None
                pending_table_context = None
                append_section(
                    text=_reattach_pending_appendix_label(
                        pending_appendix_label,
                        appendix_title,
                    )
                )
                pending_appendix_label = None
                pending_appendix_marker_only = False
                if appendix_body:
                    text = appendix_body
                    next_text = next_content_text(content_rows, row_index + 1)
                    next_row = next_nonblank_row(content_rows, row_index + 1)
                else:
                    continue
            else:
                pending_appendix_label = None
                pending_appendix_marker_only = False

        if appendix_context_active:
            attachment_title_with_body = _split_attachment_title_with_body(text)
            if attachment_title_with_body is not None:
                attachment_title, attachment_body = attachment_title_with_body
                flush_article()
                flush_policy_page()
                active_article_context = None
                pending_table_context = None
                append_section(
                    text=_reattach_pending_appendix_label(
                        pending_appendix_label,
                        attachment_title,
                    ),
                    rank=_next_policy_leaf_section_rank(current_section_nodes),
                )
                pending_appendix_label = None
                if not attachment_body:
                    continue
                text = attachment_body
                next_text = next_content_text(content_rows, row_index + 1)
                next_row = next_nonblank_row(content_rows, row_index + 1)
                followed_by_table = has_following_table_before_content_break(
                    content_rows, row_index + 1
                )
            elif _is_duplicate_attachment_cover_text(
                text=text,
                current_section_nodes=current_section_nodes,
            ):
                continue

        if policy_doc_no is None and _looks_like_policy_doc_no(text):
            policy_doc_no = _normalize_policy_doc_no(text)
            continue

        if _is_duplicate_attachment_cover_text(
            text=text,
            current_section_nodes=current_section_nodes,
        ):
            continue

        if (
            current_article is None
            and current_section_nodes
            and _looks_like_navigation_policy_leaf(
                text, current_section_nodes=current_section_nodes
            )
        ):
            flush_policy_page()
            active_article_context = None
            pending_table_context = None
            append_section(text=text, rank=_next_policy_leaf_section_rank(current_section_nodes))
            continue

        glued_structural_heading = _split_glued_structural_heading(text) if text else None
        original_text_before_glued_split = text
        original_next_text_before_glued_split = next_text
        original_next_row_before_glued_split = next_row
        original_followed_by_table_before_glued_split = followed_by_table
        glued_structural_heading_used = False
        glued_structural_heading_candidate = None
        if glued_structural_heading is not None:
            candidate_heading, candidate_remainder = glued_structural_heading
            glued_structural_heading_candidate = classify_structural_heading(
                text=candidate_heading,
                row_type=row_type,
                next_text=candidate_remainder,
            )
            if glued_structural_heading_candidate is not None:
                text = candidate_heading
                next_text = candidate_remainder
                glued_structural_heading_used = True

        structural_heading = (
            None
            if _looks_like_weekly_report_checklist_item(
                text,
                current_section_nodes=current_section_nodes,
            )
            else glued_structural_heading_candidate
            if glued_structural_heading_used
            else classify_structural_heading(
                text=text,
                row_type=row_type,
                next_text=next_text,
            )
        )
        if (
            structural_heading is not None
            and current_article is not None
            and structural_heading.kind in {"enumerated", "enumerated_subsection"}
        ):
            structural_heading = None
        if (
            structural_heading is not None
            and active_article_context is not None
            and (pending_table_context is not None or followed_by_table)
            and structural_heading.kind in {"enumerated", "enumerated_subsection"}
        ):
            structural_heading = None
        if structural_heading is None and glued_structural_heading_used:
            text = original_text_before_glued_split
            next_text = original_next_text_before_glued_split
            next_row = original_next_row_before_glued_split
            followed_by_table = original_followed_by_table_before_glued_split
            glued_structural_heading_used = False
        if structural_heading is not None:
            flush_article()
            flush_policy_page()
            active_article_context = None
            pending_table_context = None
            current_section_nodes = [
                node for node in current_section_nodes if node[0] < structural_heading.rank
            ]
            current_section_nodes.append((structural_heading.rank, structural_heading.text))
            events.append(
                {
                    "kind": "section",
                    "text": structural_heading.text,
                    "section_path": tuple(node_text for _, node_text in current_section_nodes),
                }
            )
            if not glued_structural_heading_used:
                continue
            text = glued_structural_heading[1]

        if glued_structural_heading_used:
            next_text = next_content_text(content_rows, row_index + 1)
            next_row = next_nonblank_row(content_rows, row_index + 1)

        if (
            current_policy_page is not None
            and appendix_context_active
            and _should_merge_policy_fragment_into_previous_line(
                fragment=text,
                current_parts=current_policy_page["parts"],
                next_row=next_row,
            )
        ):
            current_policy_page["parts"][-1] = _merge_policy_fragment_into_previous_line(
                current_policy_page["parts"][-1],
                text,
            )
            current_policy_page["page_end"] = page_end
            continue

        terminal_provision = (
            _split_inline_enumerated_provision(text)
            if current_article is None
            and _should_emit_inline_policy_provision(
                text,
                current_section_nodes=current_section_nodes,
                current_policy_page=current_policy_page,
            )
            else None
        )
        if terminal_provision is not None:
            provision_label, normalized_text = terminal_provision
            render_heading = bool(current_section_nodes) or _previous_event_was_heading_terminal_provision(
                events
            )
            flush_policy_page()
            active_article_context = None
            pending_table_context = None
            current_section_nodes = [node for node in current_section_nodes if node[0] <= 4]
            events.append(
                {
                    "kind": "policy_page",
                    "text": normalized_text,
                    "page_start": page_start,
                    "page_end": page_end,
                    "section_path": tuple(node_text for _, node_text in current_section_nodes),
                    "provision_label": provision_label,
                    "render_heading": render_heading,
                }
            )
            continue

        article_label, rest = _split_article_line(text)
        if article_label is not None:
            flush_policy_page()
            flush_article()
            current_section_nodes = [
                node for node in current_section_nodes if node[0] < LIST_SECTION_RANK
            ]
            current_article = {
                "kind": "article",
                "label": article_label,
                "parts": [rest] if rest else [],
                "page_start": page_start,
                "page_end": page_end,
                "section_path": tuple(node_text for _, node_text in current_section_nodes),
            }
            active_article_context = {
                "label": article_label,
                "section_path": tuple(node_text for _, node_text in current_section_nodes),
            }
            pending_table_context = None
            appendix_context_active = False
            pending_appendix_marker_only = False
            continue

        if current_article is not None and _looks_like_appendix_heading(text):
            flush_article()
            if current_policy_page is None:
                current_policy_page = {
                    "kind": "policy_page",
                    "parts": [],
                    "page_start": page_start,
                    "page_end": page_end,
                    "section_path": tuple(node_text for _, node_text in current_section_nodes),
                }
            current_policy_page["parts"].append(text)
            current_policy_page["page_end"] = page_end
            pending_table_context = None
            appendix_context_active = True
            continue

        if current_article is not None:
            current_article["parts"].append(text)
            current_article["page_end"] = page_end
            if _looks_like_table_context(
                text, next_row=next_row, followed_by_table=followed_by_table
            ):
                pending_table_context = text
            elif not (
                pending_table_context is not None and followed_by_table and row_type == "heading"
            ):
                pending_table_context = None
            continue

        if active_article_context is not None:
            if _looks_like_table_context(
                text, next_row=next_row, followed_by_table=followed_by_table
            ):
                pending_table_context = text
            elif not (
                pending_table_context is not None and followed_by_table and row_type == "heading"
            ):
                pending_table_context = None
            if pending_table_context == text and followed_by_table:
                current_article = {
                    "kind": "article",
                    "label": active_article_context["label"],
                    "parts": [text],
                    "page_start": page_start,
                    "page_end": page_end,
                    "section_path": active_article_context["section_path"],
                    "render_heading": False,
                }
                continue

        if appendix_context_active and _looks_like_table_lead_label(text, next_row=next_row):
            flush_policy_page()
            current_policy_page = {
                "kind": "policy_page",
                "parts": [text],
                "page_start": page_start,
                "page_end": page_end,
                "section_path": tuple(node_text for _, node_text in current_section_nodes),
            }
            continue

        if appendix_context_active and followed_by_table:
            normalized_table_context = _normalize_policy_page_table_context(text)
            if _is_duplicate_attachment_cover_text(
                text=text,
                current_section_nodes=current_section_nodes,
            ):
                continue
            if normalized_table_context is not None and _looks_like_form_cover_table_context(
                normalized_table_context
            ):
                flush_policy_page()
                current_policy_page = {
                    "kind": "policy_page",
                    "parts": [text],
                    "page_start": page_start,
                    "page_end": page_end,
                    "section_path": tuple(node_text for _, node_text in current_section_nodes),
                }
                continue

        if _looks_like_list_section_heading(text, next_text):
            flush_policy_page()
            active_article_context = None
            append_section(text=text)
            continue

        if current_section_nodes and _looks_like_attachment_title_text(text):
            flush_policy_page()
            active_article_context = None
            pending_table_context = None
            append_section(
                text=_normalize_attachment_heading_text(text),
                rank=_next_policy_leaf_section_rank(current_section_nodes),
            )
            continue

        if current_section_nodes and _looks_like_ancillary_note_line(text):
            flush_policy_page()
            active_article_context = None
            pending_table_context = None
            continue

        if active_article_context is not None:
            current_article = {
                "kind": "article",
                "label": active_article_context["label"],
                "parts": [text],
                "page_start": page_start,
                "page_end": page_end,
                "section_path": active_article_context["section_path"],
                "render_heading": False,
            }
            continue

        if current_policy_page is not None or current_section_nodes or _looks_like_list_entry(text):
            if current_policy_page is None:
                current_policy_page = {
                    "kind": "policy_page",
                    "parts": [],
                    "page_start": page_start,
                    "page_end": page_end,
                    "section_path": tuple(node_text for _, node_text in current_section_nodes),
                }
            current_policy_page["parts"].append(text)
            current_policy_page["page_end"] = page_end
            continue

        flush_policy_page()
        active_article_context = None
        pending_table_context = None
        appendix_context_active = False
        pending_appendix_marker_only = False
        preface_parts.append(text)

    flush_article()
    flush_policy_page()
    preface_text = normalize_handbook_body_text("\n".join(preface_parts)) if preface_parts else None
    if preface_text and not any(event["kind"] != "section" for event in events):
        events.append(
            {
                "kind": "policy_page",
                "text": preface_text,
                "page_start": coerce_int(content_rows[0].get("page_start")) or 0,
                "page_end": coerce_int(content_rows[-1].get("page_end")) or 0,
                "section_path": (),
            },
        )
        preface_text = None

    substantive_events = [event for event in events if event["kind"] != "section"]
    if not substantive_events:
        raise ValueError("handbook document cleanup produced no content units")
    _repair_table_after_intro_event_order(events)
    _attach_consecutive_appendix_section_queue_to_following_tables(events)
    return events, policy_doc_no, preface_text


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


__all__ = ["build_document_events"]
