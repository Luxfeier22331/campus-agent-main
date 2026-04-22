from __future__ import annotations

import re
from collections import Counter
from collections.abc import Sequence

from campus_ingestion_core.chunking import (
    TABLE_UNIT_TYPES,
    ChunkProfile,
    StructuredUnitChunkInput,
    clean_structured_text,
    estimate_token_count,
    resolve_display_budget,
)
from campus_ingestion_core.handbook_chunking_validation_shared import (
    APPENDIX_WEAK_TEXTUAL_KEYWORDS,
    HEADER_DOMINANT_RATIO_THRESHOLD,
    PARENT_UNIT_TYPES,
    RUNNING_HEADER_LINES,
    TINY_TEXTUAL_FINAL_TOKEN_THRESHOLD,
    VERBOSE_HEADER_MODES,
    StudentHandbookChunkingScanResult,
    StudentHandbookChunkingValidationReport,
)
from campus_ingestion_core.handbook_cleanup import (
    ARTICLE_PREFIX_RE,
    SHORT_HEADING_BODY_STARTERS,
    SHORT_HEADING_WHITELIST,
    _find_boundary_overlap,
    _has_unclosed_citation_context,
    _looks_like_appendix_leaf_section_heading,
    _looks_like_title_like_heading_remainder,
    _split_short_heading_from_body,
)

VALIDATION_LIST_MARKER_RE = re.compile(
    r"^(?P<label>(?:[0-9]+[.、]|[（(][一二三四五六七八九十百千万〇零两0-9]+[)）]))\s*(?P<body>.+)$"
)


def build_student_handbook_chunking_validation_report(
    *,
    scan_result: StudentHandbookChunkingScanResult,
) -> StudentHandbookChunkingValidationReport:
    if scan_result.mode != "full":
        raise ValueError("validation report requires a full handbook chunk scan")
    inputs = scan_result.inputs
    runtime_profile = inputs.chunk_profile
    read_failures: list = []
    chunk_failures: list = []
    empty_document_ids: list[str] = []
    unit_type_counts: Counter[str] = Counter()
    split_reason_counts: Counter[str] = Counter()
    boundary_rule_counts: Counter[str] = Counter()
    header_mode_counts: Counter[str] = Counter()
    oversize_parent_unit_counts: Counter[str] = Counter()
    oversize_multiline_parent_unit_counts: Counter[str] = Counter()
    structure_eligible_unit_counts: Counter[str] = Counter()
    chunk_counts_per_doc: list[int] = []
    total_units = 0
    non_table_oversize_chunk_count = 0
    header_only_table_chunk_count = 0
    generic_table_label_chunk_count = 0
    polluted_section_path_count = 0
    boilerplate_policy_page_count = 0
    weak_appendix_textual_chunk_count = 0
    missing_contextualization_count = 0
    broken_citation_linebreak_count = 0
    unclosed_citation_context_count = 0
    heading_body_glue_count = 0
    adjacent_overlap_duplication_count = 0
    tiny_textual_chunk_count = 0
    header_dominant_chunk_count = 0
    small_unaggregated_chunk_count = 0
    chunk_token_histogram: Counter[str] = Counter()
    header_token_histogram: Counter[str] = Counter()
    display_token_histogram: Counter[str] = Counter()

    for document in scan_result.documents:
        if document.read_failure is not None:
            read_failures.append(document.read_failure)
            continue
        if document.chunk_failure is not None:
            chunk_failures.append(document.chunk_failure)
            continue
        rows = list(document.rows)
        total_units += len(rows)
        polluted_section_path_count += sum(1 for row in rows if _has_polluted_section_path(row))
        boilerplate_policy_page_count += sum(
            1 for row in rows if _is_boilerplate_policy_page_row(row)
        )
        weak_appendix_textual_chunk_count += sum(
            1
            for index, row in enumerate(rows)
            if _is_weak_appendix_textual_row(rows=rows, row_index=index)
        )
        _collect_structure_stats(
            rows=rows,
            chunk_profile=runtime_profile,
            unit_type_counts=unit_type_counts,
            oversize_parent_unit_counts=oversize_parent_unit_counts,
            oversize_multiline_parent_unit_counts=oversize_multiline_parent_unit_counts,
            structure_eligible_unit_counts=structure_eligible_unit_counts,
        )
        chunks = document.chunks
        if not chunks:
            empty_document_ids.append(document.record.document_id)
        chunk_counts_per_doc.append(len(chunks))
        for chunk_index, chunk in enumerate(chunks):
            split_reason_counts[str(chunk.metadata.get("split_reason") or "none")] += 1
            boundary_rule_counts[str(chunk.metadata.get("boundary_rule") or "none")] += 1
            header_mode_counts[str(chunk.metadata.get("header_mode") or "none")] += 1
            if _chunk_requires_context(chunk) and not bool(
                chunk.metadata.get("contextualized_text")
            ):
                missing_contextualization_count += 1
            if _has_broken_citation_linebreak(chunk):
                broken_citation_linebreak_count += 1
            if _is_textual_chunk(chunk) and _has_unclosed_citation_context_in_chunk(chunk):
                unclosed_citation_context_count += 1
            if _has_heading_body_glue(chunk):
                heading_body_glue_count += 1
            if _has_adjacent_overlap_duplication(chunk):
                adjacent_overlap_duplication_count += 1
            if _is_header_only_table_chunk(chunk):
                header_only_table_chunk_count += 1
            if _has_generic_table_label(chunk):
                generic_table_label_chunk_count += 1
            token_count = estimate_token_count(chunk.text, chunk_profile=runtime_profile)
            chunk_token_histogram[_histogram_bucket(token_count)] += 1
            header_token_histogram[
                _histogram_bucket(int(chunk.metadata.get("header_token_count") or 0))
            ] += 1
            display_token_histogram[
                _histogram_bucket(int(chunk.metadata.get("display_token_count") or 0))
            ] += 1
            if (
                str(chunk.metadata.get("unit_type") or "") not in TABLE_UNIT_TYPES
                and token_count > runtime_profile.max_chunk_size
            ):
                non_table_oversize_chunk_count += 1
            if _is_textual_chunk(chunk):
                final_token_count = int(chunk.metadata.get("final_token_count") or token_count)
                header_token_count = int(chunk.metadata.get("header_token_count") or 0)
                if final_token_count < TINY_TEXTUAL_FINAL_TOKEN_THRESHOLD:
                    tiny_textual_chunk_count += 1
                    if not chunk.metadata.get(
                        "aggregation_mode"
                    ) and _has_actionable_short_textual_merge_neighbor(
                        chunks=chunks,
                        chunk_index=chunk_index,
                        chunk_profile=runtime_profile,
                    ):
                        small_unaggregated_chunk_count += 1
                if _is_verbose_header_dominant_chunk(
                    chunk=chunk,
                    header_token_count=header_token_count,
                    final_token_count=final_token_count,
                ):
                    header_dominant_chunk_count += 1

    total_chunks = sum(chunk_counts_per_doc)
    validated_document_count = len(chunk_counts_per_doc)
    passed = not (
        inputs.extra_registry_document_ids
        or inputs.missing_registry_document_ids
        or read_failures
        or chunk_failures
        or empty_document_ids
        or non_table_oversize_chunk_count
        or header_only_table_chunk_count
        or generic_table_label_chunk_count
        or polluted_section_path_count
        or boilerplate_policy_page_count
        or weak_appendix_textual_chunk_count
        or missing_contextualization_count
        or broken_citation_linebreak_count
        or unclosed_citation_context_count
        or heading_body_glue_count
        or adjacent_overlap_duplication_count
        or header_dominant_chunk_count
        or small_unaggregated_chunk_count
    )
    return StudentHandbookChunkingValidationReport(
        passed=passed,
        chunk_policy_version=runtime_profile.chunk_policy_version,
        tokenizer_name=runtime_profile.tokenizer_name,
        manifest_document_count=len(inputs.manifest_titles),
        registry_record_count=len(inputs.records),
        registry_unique_document_count=len(inputs.records_by_doc),
        selected_source_faithful_record_count=len(inputs.selected_records),
        validated_document_count=validated_document_count,
        total_units=total_units,
        total_chunks=total_chunks,
        avg_units_per_document=round(total_units / validated_document_count, 2)
        if validated_document_count
        else 0.0,
        avg_chunks_per_document=round(total_chunks / validated_document_count, 2)
        if validated_document_count
        else 0.0,
        max_chunks_in_document=max(chunk_counts_per_doc) if chunk_counts_per_doc else 0,
        min_chunks_in_document=min(chunk_counts_per_doc) if chunk_counts_per_doc else 0,
        extra_registry_document_ids=inputs.extra_registry_document_ids,
        missing_registry_document_ids=inputs.missing_registry_document_ids,
        read_failures=tuple(read_failures),
        chunk_failures=tuple(chunk_failures),
        empty_document_ids=tuple(sorted(empty_document_ids)),
        non_table_oversize_chunk_count=non_table_oversize_chunk_count,
        header_only_table_chunk_count=header_only_table_chunk_count,
        generic_table_label_chunk_count=generic_table_label_chunk_count,
        polluted_section_path_count=polluted_section_path_count,
        boilerplate_policy_page_count=boilerplate_policy_page_count,
        weak_appendix_textual_chunk_count=weak_appendix_textual_chunk_count,
        missing_contextualization_count=missing_contextualization_count,
        broken_citation_linebreak_count=broken_citation_linebreak_count,
        unclosed_citation_context_count=unclosed_citation_context_count,
        heading_body_glue_count=heading_body_glue_count,
        adjacent_overlap_duplication_count=adjacent_overlap_duplication_count,
        tiny_textual_chunk_count=tiny_textual_chunk_count,
        header_dominant_chunk_count=header_dominant_chunk_count,
        small_unaggregated_chunk_count=small_unaggregated_chunk_count,
        unit_type_counts=dict(unit_type_counts),
        split_reason_counts=dict(split_reason_counts),
        boundary_rule_counts=dict(boundary_rule_counts),
        header_mode_counts=dict(header_mode_counts),
        oversize_parent_unit_counts=dict(oversize_parent_unit_counts),
        oversize_multiline_parent_unit_counts=dict(oversize_multiline_parent_unit_counts),
        structure_eligible_unit_counts=dict(structure_eligible_unit_counts),
        chunk_token_histogram=dict(chunk_token_histogram),
        header_token_histogram=dict(header_token_histogram),
        display_token_histogram=dict(display_token_histogram),
    )


def _collect_structure_stats(
    *,
    rows: list[dict[str, object]],
    chunk_profile: ChunkProfile,
    unit_type_counts: Counter[str],
    oversize_parent_unit_counts: Counter[str],
    oversize_multiline_parent_unit_counts: Counter[str],
    structure_eligible_unit_counts: Counter[str],
) -> None:
    strategy = chunk_profile.strategy
    for row in rows:
        unit_type = str(row.get("unit_type") or "")
        unit_type_counts[unit_type] += 1
        if unit_type not in PARENT_UNIT_TYPES:
            continue
        text = str(row.get("clean_text") or "")
        cleaned_text = clean_structured_text(unit_type=unit_type, text=text)
        display_budget = resolve_display_budget(
            unit=StructuredUnitChunkInput(
                unit_type=unit_type,
                root_unit_id=str(row.get("root_unit_id") or row.get("chunk_id") or ""),
                text=text,
                anchor=row.get("anchor") if isinstance(row.get("anchor"), dict) else {},
                metadata=row.get("metadata") if isinstance(row.get("metadata"), dict) else {},
            ),
            chunk_profile=chunk_profile,
        )
        token_count = estimate_token_count(cleaned_text, chunk_profile=chunk_profile)
        if token_count <= display_budget.max_tokens:
            continue
        oversize_parent_unit_counts[unit_type] += 1
        lines = [line.strip() for line in cleaned_text.splitlines() if line.strip()]
        if len(lines) < 2:
            continue
        oversize_multiline_parent_unit_counts[unit_type] += 1
        if strategy is None:
            continue
        result = strategy.split_structure_boundaries(
            unit_type=unit_type,
            text=cleaned_text,
            chunk_profile=chunk_profile,
            display_budget=display_budget,
        )
        if result is not None:
            structure_eligible_unit_counts[result.boundary_rule] += 1


def _histogram_bucket(token_count: int) -> str:
    if token_count < 100:
        return "lt_100"
    if token_count < 250:
        return "100_249"
    if token_count < 500:
        return "250_499"
    return "ge_500"


def _has_polluted_section_path(row: dict[str, object]) -> bool:
    anchor = row.get("anchor")
    if not isinstance(anchor, dict):
        return False
    section_path = anchor.get("section_path")
    if not isinstance(section_path, list) or not section_path:
        return False
    if anchor.get("provision_label") is not None:
        return False
    tail = str(section_path[-1] or "").strip()
    clean_text = str(row.get("clean_text") or "").strip()
    if not tail or not clean_text:
        return False
    if _looks_like_appendix_leaf_section_heading(tail):
        return True
    return tail == clean_text and tail.endswith(("。", "！", "？", "；"))


def _chunk_requires_context(chunk: object) -> bool:
    metadata = getattr(chunk, "metadata", {})
    if not isinstance(metadata, dict):
        return False
    if str(metadata.get("unit_type") or "") in TABLE_UNIT_TYPES:
        return False
    return bool(metadata.get("title"))


def _is_textual_chunk(chunk: object) -> bool:
    metadata = getattr(chunk, "metadata", {})
    if not isinstance(metadata, dict):
        return False
    return str(metadata.get("unit_type") or "") in PARENT_UNIT_TYPES


def _is_boilerplate_policy_page_row(row: dict[str, object]) -> bool:
    if str(row.get("unit_type") or "") != "policy_page":
        return False
    return str(row.get("clean_text") or "").strip() in RUNNING_HEADER_LINES


def _is_weak_appendix_textual_row(*, rows: Sequence[dict[str, object]], row_index: int) -> bool:
    row = rows[row_index]
    if str(row.get("unit_type") or "") != "policy_page":
        return False
    if _is_boilerplate_policy_page_row(row):
        return False
    display_text = str(row.get("clean_text") or "").strip()
    if not display_text or len(display_text) > 120:
        return False
    anchor = row.get("anchor")
    if not isinstance(anchor, dict):
        return False
    section_path = _normalize_section_path(anchor)
    if not section_path:
        return False
    joined_path = " / ".join(section_path)
    if not any(
        keyword in joined_path or keyword in display_text
        for keyword in APPENDIX_WEAK_TEXTUAL_KEYWORDS
    ):
        return False
    for neighbor_index in (row_index - 1, row_index + 1):
        if neighbor_index < 0 or neighbor_index >= len(rows):
            continue
        neighbor_row = rows[neighbor_index]
        if str(neighbor_row.get("unit_type") or "") in {"table", "table_unit"}:
            return True
    return False


def _chunk_header_ratio(*, header_token_count: int, final_token_count: int) -> float:
    if final_token_count <= 0:
        return 0.0
    return header_token_count / final_token_count


def _has_actionable_short_textual_merge_neighbor(
    *,
    chunks: Sequence[object],
    chunk_index: int,
    chunk_profile: ChunkProfile,
) -> bool:
    current = chunks[chunk_index]
    if not _is_merge_eligible_textual_chunk(current):
        return False
    for neighbor_index in (chunk_index - 1, chunk_index + 1):
        if neighbor_index < 0 or neighbor_index >= len(chunks):
            continue
        if _chunks_could_merge_for_validation(
            current=current,
            neighbor=chunks[neighbor_index],
            chunk_profile=chunk_profile,
        ):
            return True
    return False


def _chunks_could_merge_for_validation(
    *,
    current: object,
    neighbor: object,
    chunk_profile: ChunkProfile,
) -> bool:
    if not _is_merge_eligible_textual_chunk(neighbor):
        return False
    current_metadata = getattr(current, "metadata", {})
    neighbor_metadata = getattr(neighbor, "metadata", {})
    if not isinstance(current_metadata, dict) or not isinstance(neighbor_metadata, dict):
        return False
    if str(current_metadata.get("unit_type") or "") != str(
        neighbor_metadata.get("unit_type") or ""
    ):
        return False
    if getattr(current, "visibility_level", None) != getattr(neighbor, "visibility_level", None):
        return False
    for field_name in ("title", "policy_doc_no"):
        if current_metadata.get(field_name) != neighbor_metadata.get(field_name):
            return False
    current_anchor = getattr(current, "anchor", {})
    neighbor_anchor = getattr(neighbor, "anchor", {})
    if not isinstance(current_anchor, dict) or not isinstance(neighbor_anchor, dict):
        return False
    if not _textual_chunk_paths_are_merge_compatible(
        unit_type=str(current_metadata.get("unit_type") or ""),
        current_anchor=current_anchor,
        neighbor_anchor=neighbor_anchor,
    ):
        return False
    merged_display_budget = (
        int(current_metadata.get("display_token_count") or 0)
        + int(neighbor_metadata.get("display_token_count") or 0)
        + max(
            int(current_metadata.get("header_token_count") or 0),
            int(neighbor_metadata.get("header_token_count") or 0),
        )
    )
    return merged_display_budget <= chunk_profile.max_chunk_size


def _is_merge_eligible_textual_chunk(chunk: object) -> bool:
    if not _is_textual_chunk(chunk):
        return False
    metadata = getattr(chunk, "metadata", {})
    if not isinstance(metadata, dict):
        return False
    if metadata.get("split_reason") is not None:
        return False
    return int(metadata.get("segment_total") or 1) == 1


def _textual_chunk_paths_are_merge_compatible(
    *,
    unit_type: str,
    current_anchor: dict[str, object],
    neighbor_anchor: dict[str, object],
) -> bool:
    current_path = _normalize_section_path(current_anchor)
    neighbor_path = _normalize_section_path(neighbor_anchor)
    if current_path == neighbor_path:
        return True
    if (
        unit_type == "policy_page"
        and not _chunk_has_explicit_member_label(current_anchor)
        and not _chunk_has_explicit_member_label(neighbor_anchor)
    ):
        return _policy_page_paths_are_merge_compatible(
            current_path=current_path, neighbor_path=neighbor_path
        )
    return False


def _chunk_has_explicit_member_label(anchor: dict[str, object]) -> bool:
    return (
        _normalize_anchor_label(anchor, "article_label") is not None
        or _normalize_anchor_label(
            anchor,
            "provision_label",
        )
        is not None
    )


def _policy_page_paths_are_merge_compatible(
    *,
    current_path: tuple[str, ...],
    neighbor_path: tuple[str, ...],
) -> bool:
    if not current_path or not neighbor_path:
        return False
    if len(current_path) >= 2 and neighbor_path[: len(current_path)] == current_path:
        return True
    if len(neighbor_path) >= 2 and current_path[: len(neighbor_path)] == neighbor_path:
        return True
    current_parent = current_path[:-1]
    neighbor_parent = neighbor_path[:-1]
    if len(current_parent) < 2 or len(neighbor_parent) < 2:
        return False
    return current_parent == neighbor_parent


def _normalize_section_path(anchor: dict[str, object]) -> tuple[str, ...]:
    section_path = anchor.get("section_path")
    if not isinstance(section_path, list):
        return ()
    return tuple(str(item).strip() for item in section_path if str(item).strip())


def _normalize_anchor_label(anchor: dict[str, object], field_name: str) -> str | None:
    value = anchor.get(field_name)
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _is_verbose_header_dominant_chunk(
    *,
    chunk: object,
    header_token_count: int,
    final_token_count: int,
) -> bool:
    metadata = getattr(chunk, "metadata", {})
    if not isinstance(metadata, dict):
        return False
    if str(metadata.get("header_mode") or "") not in VERBOSE_HEADER_MODES:
        return False
    return (
        _chunk_header_ratio(
            header_token_count=header_token_count,
            final_token_count=final_token_count,
        )
        >= HEADER_DOMINANT_RATIO_THRESHOLD
    )


def _is_header_only_table_chunk(chunk: object) -> bool:
    metadata = getattr(chunk, "metadata", {})
    if not isinstance(metadata, dict):
        return False
    if str(metadata.get("unit_type") or "") != "table_unit":
        return False
    return int(metadata.get("table_row_count") or 0) == 0


def _has_generic_table_label(chunk: object) -> bool:
    text = getattr(chunk, "text", "")
    return isinstance(text, str) and ("列=" in text or "未命名列" in text)


def _has_broken_citation_linebreak(chunk: object) -> bool:
    text = getattr(chunk, "text", "")
    if not isinstance(text, str) or "\n" not in text:
        return False
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for previous, current in zip(lines, lines[1:], strict=False):
        if current[:1] in {"[", "〔", "(", "（"} and _has_unclosed_citation_context(previous):
            return True
        if previous.endswith(("民大校发", "民大学发", "民大党发", "中发", "教高")) and current[
            :1
        ] in {"[", "〔"}:
            return True
    return False


def _has_unclosed_citation_context_in_chunk(chunk: object) -> bool:
    text = getattr(chunk, "text", "")
    if not isinstance(text, str):
        return False
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    for line in lines:
        if line.startswith("标题：") or line.startswith("文号："):
            continue
        if _has_unclosed_citation_context(line):
            return True
    return False


def _has_heading_body_glue(chunk: object) -> bool:
    text = getattr(chunk, "text", "")
    if not isinstance(text, str):
        return False
    for line in (line.strip() for line in text.splitlines() if line.strip()):
        if _extract_validation_heading_body_glue(line) is not None:
            return True
    return False


def _has_adjacent_overlap_duplication(chunk: object) -> bool:
    text = getattr(chunk, "text", "")
    if not isinstance(text, str):
        return False
    for line in (line.strip() for line in text.splitlines() if line.strip()):
        split_body = _extract_validation_heading_body_glue(line)
        if split_body is None:
            continue
        if _find_boundary_overlap(split_body[0], split_body[1]):
            return True
        if len(_shared_cjk_prefix(split_body[0], split_body[1])) >= 2:
            return True
    return False


def _validation_line_body(line: str) -> str:
    stripped = line.strip()
    article_match = ARTICLE_PREFIX_RE.match(stripped)
    if article_match is not None:
        return article_match.group("rest").strip()
    match = VALIDATION_LIST_MARKER_RE.match(stripped)
    if match is not None:
        return match.group("body").strip()
    return stripped


def _extract_validation_heading_body_glue(line: str) -> tuple[str, str] | None:
    stripped = line.strip()
    if not stripped or stripped.startswith("标题：") or stripped.startswith("文号："):
        return None
    if " / " in stripped:
        return None
    body = _validation_line_body(stripped)
    if not body:
        return None
    split_body = _split_short_heading_from_body(body)
    if split_body is None:
        return None
    heading, remainder = split_body
    if remainder.startswith(heading):
        return split_body
    if _looks_like_title_like_heading_remainder(remainder):
        return split_body
    if any(
        starter != "无" and remainder.startswith(starter) for starter in SHORT_HEADING_BODY_STARTERS
    ):
        return split_body
    if remainder.startswith("无") and not remainder.startswith("无异议"):
        return split_body
    if heading in SHORT_HEADING_WHITELIST and _looks_like_title_like_heading_remainder(remainder):
        return split_body
    return None


def _detect_inline_overlap_duplication(text: str) -> str:
    compact = text.strip()
    max_overlap = min(len(compact) // 2, 8)
    for overlap_length in range(max_overlap, 2, -1):
        for index in range(overlap_length, len(compact) - overlap_length + 1):
            left = compact[index - overlap_length : index]
            right = compact[index : index + overlap_length]
            if left != right:
                continue
            if not re.fullmatch(r"[\u4e00-\u9fff]{3,8}", left):
                continue
            return left
    return ""


def _shared_cjk_prefix(left: str, right: str) -> str:
    shared_chars: list[str] = []
    for left_char, right_char in zip(left, right, strict=False):
        if left_char != right_char:
            break
        if not re.fullmatch(r"[\u4e00-\u9fff]", left_char):
            break
        shared_chars.append(left_char)
    return "".join(shared_chars)
