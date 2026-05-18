from __future__ import annotations

import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass

from campus_ingestion_core.answer_ready_contract_quality import (
    ANSWER_READY_CONTRACT_FAILURE_CLASS,
    ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
    evaluate_answer_ready_contract_metadata,
    is_answer_ready_contract_issue,
)

_TOKEN_RE = re.compile(r"[\u4e00-\u9fff]|[A-Za-z0-9_]+|[^\s]")


@dataclass(frozen=True, slots=True)
class ReleaseQualityGateResult:
    status: str
    chunk_quality_status: str
    qrels_coverage_status: str
    release_metadata_consistency_status: str
    summary: dict[str, object]


@dataclass(frozen=True, slots=True)
class _ChunkQualityRow:
    chunk_id: str
    document_key: tuple[str, str, str, str]
    root_unit_id: str
    chunk_order: int | None
    segment_index: int | None
    segment_total: int | None


def evaluate_release_chunk_quality(
    *,
    chunks: Sequence[object],
    max_token_count: int,
    max_token_count_source: str = "explicit",
    max_token_count_by_unit_type: dict[str, int] | None = None,
    required_metadata_fields: Sequence[str] = ("root_unit_id", "chunk_policy_version"),
    qrels_coverage_issues: Sequence[str] = (),
    qrels_coverage_required: bool = True,
) -> ReleaseQualityGateResult:
    issues_by_chunk_id: dict[str, tuple[str, ...]] = {}
    seen_chunk_ids: set[str] = set()
    chunk_rows: list[_ChunkQualityRow] = []
    unit_type_budgets = dict(max_token_count_by_unit_type or {})
    for index, chunk in enumerate(chunks, start=1):
        chunk_id = _required_text(_chunk_value(chunk, "chunk_id")) or f"row-{index}"
        issues: list[str] = []
        for field_name in (
            "document_id",
            "version_id",
            "chunk_id",
            "chunk_order",
            "corpus",
            "collection",
            "text",
            "source_uri",
        ):
            if not _has_value(_chunk_value(chunk, field_name)):
                issues.append(f"missing_{field_name}")
        if chunk_id in seen_chunk_ids:
            issues.append("duplicate_chunk_id")
        seen_chunk_ids.add(chunk_id)
        metadata = _mapping_value(_chunk_value(chunk, "metadata"))
        anchor = _mapping_value(_chunk_value(chunk, "anchor"))
        for metadata_field in required_metadata_fields:
            if not (
                _has_value(_chunk_value(chunk, metadata_field))
                or _has_value(metadata.get(metadata_field))
                or _has_value(anchor.get(metadata_field))
            ):
                issues.append(f"missing_{metadata_field}")
        root_unit_id = (
            _required_text(_chunk_value(chunk, "root_unit_id"))
            or _required_text(metadata.get("root_unit_id"))
            or _required_text(anchor.get("root_unit_id"))
            or ""
        )
        token_count = _coerce_int(metadata.get("final_token_count"))
        if token_count is None:
            token_count = _count_tokens(str(_chunk_value(chunk, "text") or ""))
        unit_type = _required_text(metadata.get("unit_type")) or ""
        chunk_max_token_count = unit_type_budgets.get(unit_type, max_token_count)
        if chunk_max_token_count > 0 and token_count > chunk_max_token_count:
            issues.append("token_count_exceeds_budget")
        if unit_type == "attachment_ref":
            issues.append("attachment_ref_not_query_serving_chunk")
        if _is_heading_only_regulation_chunk(
            chunk=chunk,
            metadata=metadata,
            anchor=anchor,
            token_count=token_count,
        ):
            issues.append("heading_only_chunk")
        display_text = _required_text(metadata.get("display_text"))
        if display_text and not _contains_normalized_text(
            haystack=str(_chunk_value(chunk, "text") or ""),
            needle=display_text,
        ):
            issues.append("display_text_not_in_chunk_text")
        if _is_table_chunk_missing_context_or_header(metadata=metadata, anchor=anchor):
            issues.append("missing_table_context_or_header")
        issues.extend(
            evaluate_answer_ready_contract_metadata(
                corpus=str(_chunk_value(chunk, "corpus") or ""),
                collection=str(_chunk_value(chunk, "collection") or ""),
                metadata=metadata,
                anchor=anchor,
            ).issues
        )
        chunk_rows.append(
            _ChunkQualityRow(
                chunk_id=chunk_id,
                document_key=(
                    str(_chunk_value(chunk, "corpus") or ""),
                    str(_chunk_value(chunk, "collection") or ""),
                    str(_chunk_value(chunk, "document_id") or ""),
                    str(_chunk_value(chunk, "version_id") or ""),
                ),
                root_unit_id=root_unit_id,
                chunk_order=_coerce_int(_chunk_value(chunk, "chunk_order")),
                segment_index=_coerce_int(metadata.get("segment_index")),
                segment_total=_coerce_int(metadata.get("segment_total")),
            )
        )
        chunk_rows.extend(
            _build_member_segment_quality_rows(
                chunk_id=chunk_id,
                chunk=chunk,
                metadata=metadata,
            )
        )
        if issues:
            issues_by_chunk_id[chunk_id] = tuple(dict.fromkeys(issues))
    _add_cross_chunk_quality_issues(
        issues_by_chunk_id=issues_by_chunk_id,
        chunk_rows=tuple(chunk_rows),
    )

    chunk_issue_count = sum(len(issues) for issues in issues_by_chunk_id.values())
    answer_ready_contract_issue_count = sum(
        1
        for issues in issues_by_chunk_id.values()
        for issue in issues
        if is_answer_ready_contract_issue(issue)
    )
    answer_ready_contract_issues = tuple(
        dict.fromkeys(
            issue
            for issues in issues_by_chunk_id.values()
            for issue in issues
            if is_answer_ready_contract_issue(issue)
        )
    )
    answer_ready_required_field_failures = tuple(
        issue
        for issue in answer_ready_contract_issues
        if issue.endswith("_missing")
        or issue
        in {"answer_ready_procedure_step_fields_missing", "answer_ready_intro_fields_missing"}
    )
    answer_ready_semantic_failures = tuple(
        issue
        for issue in answer_ready_contract_issues
        if issue not in answer_ready_required_field_failures
    )
    qrels_issues = tuple(str(issue) for issue in qrels_coverage_issues if str(issue).strip())
    chunk_quality_status = "passed" if chunk_issue_count == 0 else "failed"
    answer_ready_contract_status = "passed" if answer_ready_contract_issue_count == 0 else "failed"
    if not qrels_coverage_required:
        qrels_coverage_status = "not_applicable" if not qrels_issues else "failed"
    else:
        qrels_coverage_status = "passed" if not qrels_issues else "failed"
    release_metadata_consistency_status = "passed"
    status = (
        "passed"
        if chunk_quality_status == "passed"
        and qrels_coverage_status in {"passed", "not_applicable"}
        and release_metadata_consistency_status == "passed"
        else "failed"
    )
    return ReleaseQualityGateResult(
        status=status,
        chunk_quality_status=chunk_quality_status,
        qrels_coverage_status=qrels_coverage_status,
        release_metadata_consistency_status=release_metadata_consistency_status,
        summary={
            "status": status,
            "chunk_count": len(chunks),
            "chunk_quality_status": chunk_quality_status,
            "chunk_issue_count": chunk_issue_count,
            "answer_ready_contract_version": ANSWER_READY_EVIDENCE_CONTRACT_VERSION,
            "answer_ready_contract_status": answer_ready_contract_status,
            "answer_ready_contract_issue_count": answer_ready_contract_issue_count,
            "answer_ready_required_field_failures": list(answer_ready_required_field_failures),
            "answer_ready_semantic_failures": list(answer_ready_semantic_failures),
            "failure_classes": (
                (ANSWER_READY_CONTRACT_FAILURE_CLASS,)
                if answer_ready_contract_status == "failed"
                else ()
            ),
            "issues_by_chunk_id": issues_by_chunk_id,
            "max_token_count": max_token_count,
            "max_token_count_source": max_token_count_source,
            "max_token_count_by_unit_type": dict(sorted(unit_type_budgets.items())),
            "required_metadata_fields": tuple(required_metadata_fields),
            "qrels_coverage_status": qrels_coverage_status,
            "qrels_coverage_issues": qrels_issues,
            "qrels_coverage_required": qrels_coverage_required,
            "release_metadata_consistency_status": release_metadata_consistency_status,
        },
    )


def _chunk_value(chunk: object, field_name: str) -> object:
    if isinstance(chunk, dict):
        return chunk.get(field_name)
    return getattr(chunk, field_name, None)


def _mapping_value(value: object) -> dict[str, object]:
    return dict(value) if isinstance(value, Mapping) else {}


def _count_tokens(text: str) -> int:
    return len(_TOKEN_RE.findall(text))


def _has_value(value: object) -> bool:
    if value is None:
        return False
    if isinstance(value, str):
        return bool(value.strip())
    return True


def _required_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _coerce_int(value: object) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _is_heading_only_regulation_chunk(
    *,
    chunk: object,
    metadata: dict[str, object],
    anchor: dict[str, object],
    token_count: int,
) -> bool:
    if _chunk_value(chunk, "corpus") != "regulations":
        return False
    if str(metadata.get("unit_type") or "") != "section_text":
        return False
    text = str(_chunk_value(chunk, "text") or "").strip()
    if not text or "\n" in text or token_count > 16:
        return False
    section_path = tuple(str(item).strip() for item in anchor.get("section_path") or ())
    return bool(section_path and text == section_path[-1])


def _contains_normalized_text(*, haystack: str, needle: str) -> bool:
    normalized_haystack = _normalize_match_text(haystack)
    normalized_needle = _normalize_match_text(needle)
    return bool(normalized_needle and normalized_needle in normalized_haystack)


def _normalize_match_text(value: object) -> str:
    return re.sub(r"\s+", "", str(value or "")).strip()


def _is_table_chunk_missing_context_or_header(
    *,
    metadata: Mapping[str, object],
    anchor: Mapping[str, object],
) -> bool:
    unit_type = str(metadata.get("unit_type") or "")
    if unit_type not in {"table", "table_row", "table_unit"}:
        return False
    return not (
        _has_value(anchor.get("table_context"))
        or _has_value(metadata.get("table_context"))
        or _has_value(anchor.get("table_headers"))
        or _has_value(metadata.get("table_headers"))
        or _has_value(anchor.get("table_header_cells"))
        or _has_value(metadata.get("table_header_cells"))
        or _has_value(anchor.get("header_cells"))
        or _has_value(metadata.get("header_cells"))
        or _has_value(anchor.get("table_columns"))
        or _has_value(metadata.get("table_columns"))
    )


def _add_cross_chunk_quality_issues(
    *,
    issues_by_chunk_id: dict[str, tuple[str, ...]],
    chunk_rows: Sequence[_ChunkQualityRow],
) -> None:
    rows_by_document: dict[tuple[str, str, str, str], list[_ChunkQualityRow]] = {}
    rows_by_root: dict[tuple[str, str, str, str, str], list[_ChunkQualityRow]] = {}
    for row in chunk_rows:
        rows_by_document.setdefault(row.document_key, []).append(row)
        if row.root_unit_id:
            rows_by_root.setdefault((*row.document_key, row.root_unit_id), []).append(row)
    for rows in rows_by_document.values():
        _add_chunk_order_issues(issues_by_chunk_id=issues_by_chunk_id, rows=tuple(rows))
    for rows in rows_by_root.values():
        _add_segment_coverage_issues(issues_by_chunk_id=issues_by_chunk_id, rows=tuple(rows))


def _build_member_segment_quality_rows(
    *,
    chunk_id: str,
    chunk: object,
    metadata: Mapping[str, object],
) -> tuple[_ChunkQualityRow, ...]:
    lineage = metadata.get("member_segment_lineage")
    if not isinstance(lineage, list | tuple):
        return ()
    document_key = (
        str(_chunk_value(chunk, "corpus") or ""),
        str(_chunk_value(chunk, "collection") or ""),
        str(_chunk_value(chunk, "document_id") or ""),
        str(_chunk_value(chunk, "version_id") or ""),
    )
    rows: list[_ChunkQualityRow] = []
    for item in lineage:
        if not isinstance(item, Mapping):
            continue
        root_unit_id = _required_text(item.get("root_unit_id")) or ""
        if not root_unit_id:
            continue
        rows.append(
            _ChunkQualityRow(
                chunk_id=chunk_id,
                document_key=document_key,
                root_unit_id=root_unit_id,
                chunk_order=None,
                segment_index=_coerce_int(item.get("segment_index")),
                segment_total=_coerce_int(item.get("segment_total")),
            )
        )
    return tuple(rows)


def _add_chunk_order_issues(
    *,
    issues_by_chunk_id: dict[str, tuple[str, ...]],
    rows: Sequence[_ChunkQualityRow],
) -> None:
    ordered_rows = tuple(row for row in rows if row.chunk_order is not None)
    if not ordered_rows:
        return
    orders = [int(row.chunk_order) for row in ordered_rows if row.chunk_order is not None]
    if len(set(orders)) != len(orders):
        for row in ordered_rows:
            _append_chunk_quality_issue(
                issues_by_chunk_id=issues_by_chunk_id,
                chunk_id=row.chunk_id,
                issue="duplicate_chunk_order",
            )
    if sorted(orders) != list(range(1, max(orders) + 1)):
        for row in ordered_rows:
            _append_chunk_quality_issue(
                issues_by_chunk_id=issues_by_chunk_id,
                chunk_id=row.chunk_id,
                issue="chunk_order_gap",
            )


def _add_segment_coverage_issues(
    *,
    issues_by_chunk_id: dict[str, tuple[str, ...]],
    rows: Sequence[_ChunkQualityRow],
) -> None:
    segmented_rows = _dedupe_segment_quality_rows(
        row for row in rows if row.segment_index is not None or row.segment_total is not None
    )
    if not segmented_rows:
        return
    invalid_rows = tuple(
        row
        for row in segmented_rows
        if row.segment_index is None
        or row.segment_total is None
        or row.segment_index <= 0
        or row.segment_total <= 0
        or row.segment_index > row.segment_total
    )
    for row in invalid_rows:
        _append_chunk_quality_issue(
            issues_by_chunk_id=issues_by_chunk_id,
            chunk_id=row.chunk_id,
            issue="invalid_segment_metadata",
        )
    valid_rows = tuple(row for row in segmented_rows if row not in invalid_rows)
    if not valid_rows:
        return
    segment_totals = {int(row.segment_total) for row in valid_rows if row.segment_total is not None}
    if len(segment_totals) != 1:
        for row in valid_rows:
            _append_chunk_quality_issue(
                issues_by_chunk_id=issues_by_chunk_id,
                chunk_id=row.chunk_id,
                issue="segment_total_mismatch",
            )
        return
    segment_total = next(iter(segment_totals))
    if segment_total <= 1:
        return
    segment_indexes = [
        int(row.segment_index) for row in valid_rows if row.segment_index is not None
    ]
    if len(set(segment_indexes)) != len(segment_indexes):
        for row in valid_rows:
            _append_chunk_quality_issue(
                issues_by_chunk_id=issues_by_chunk_id,
                chunk_id=row.chunk_id,
                issue="duplicate_segment_index",
            )
    if sorted(set(segment_indexes)) != list(range(1, segment_total + 1)):
        for row in valid_rows:
            _append_chunk_quality_issue(
                issues_by_chunk_id=issues_by_chunk_id,
                chunk_id=row.chunk_id,
                issue="segment_coverage_gap",
            )


def _dedupe_segment_quality_rows(
    rows: Iterable[_ChunkQualityRow],
) -> tuple[_ChunkQualityRow, ...]:
    deduped: list[_ChunkQualityRow] = []
    seen: set[tuple[str, int | None, int | None]] = set()
    for row in rows:
        key = (row.chunk_id, row.segment_index, row.segment_total)
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    return tuple(deduped)


def _append_chunk_quality_issue(
    *,
    issues_by_chunk_id: dict[str, tuple[str, ...]],
    chunk_id: str,
    issue: str,
) -> None:
    current = issues_by_chunk_id.get(chunk_id, ())
    if issue in current:
        return
    issues_by_chunk_id[chunk_id] = (*current, issue)


__all__ = ["ReleaseQualityGateResult", "evaluate_release_chunk_quality"]
