from __future__ import annotations

import json
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

_TOKEN_RE = re.compile(r"[\u4e00-\u9fff]|[A-Za-z0-9_]+|[^\s]")


@dataclass(frozen=True, slots=True)
class RetrievalChunkQualityReport:
    status: str
    chunk_count: int
    issue_count: int
    issues_by_chunk_id: dict[str, tuple[str, ...]] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class RetrievalChunkQualityAuditReport:
    status: str
    chunk_count: int
    failed_chunk_count: int
    issue_count: int
    max_tokens: int
    counts_by_issue: dict[str, int] = field(default_factory=dict)
    counts_by_unit_type: dict[str, int] = field(default_factory=dict)
    issues_by_chunk_id: dict[str, tuple[str, ...]] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class _ChunkQualityRow:
    chunk_id: str
    document_key: tuple[str, str, str, str]
    root_unit_id: str
    chunk_order: int | None
    segment_index: int | None
    segment_total: int | None


def evaluate_chunk_quality(
    *,
    chunks: Iterable[Mapping[str, Any]],
    max_tokens: int,
    required_metadata_fields: Sequence[str] = ("root_unit_id", "chunk_policy_version"),
) -> RetrievalChunkQualityReport:
    issues_by_chunk_id: dict[str, tuple[str, ...]] = {}
    seen_chunk_ids: set[str] = set()
    chunk_rows: list[_ChunkQualityRow] = []
    chunk_count = 0
    for chunk in chunks:
        chunk_count += 1
        chunk_id = _required_text(chunk.get("chunk_id")) or f"row-{chunk_count}"
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
            if not _has_value(chunk.get(field_name)):
                issues.append(f"missing_{field_name}")
        if chunk_id in seen_chunk_ids:
            issues.append("duplicate_chunk_id")
        seen_chunk_ids.add(chunk_id)
        text = _required_text(chunk.get("text")) or ""
        if max_tokens > 0 and _count_tokens(text) > max_tokens:
            issues.append("token_count_exceeds_budget")
        metadata = chunk.get("metadata") if isinstance(chunk.get("metadata"), Mapping) else {}
        anchor = chunk.get("anchor") if isinstance(chunk.get("anchor"), Mapping) else {}
        for metadata_field in required_metadata_fields:
            if not (
                _has_value(chunk.get(metadata_field))
                or _has_value(metadata.get(metadata_field))
                or _has_value(anchor.get(metadata_field))
            ):
                issues.append(f"missing_{metadata_field}")
        display_text = _required_text(metadata.get("display_text"))
        if display_text and not _contains_normalized_text(haystack=text, needle=display_text):
            issues.append("display_text_not_in_chunk_text")
        if _is_table_chunk_missing_context_or_header(metadata=metadata, anchor=anchor):
            issues.append("missing_table_context_or_header")
        chunk_rows.append(
            _ChunkQualityRow(
                chunk_id=chunk_id,
                document_key=(
                    str(chunk.get("corpus") or ""),
                    str(chunk.get("collection") or ""),
                    str(chunk.get("document_id") or ""),
                    str(chunk.get("version_id") or ""),
                ),
                root_unit_id=(
                    _required_text(chunk.get("root_unit_id"))
                    or _required_text(metadata.get("root_unit_id"))
                    or _required_text(anchor.get("root_unit_id"))
                    or ""
                ),
                chunk_order=_coerce_int(chunk.get("chunk_order")),
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
    issue_count = sum(len(issues) for issues in issues_by_chunk_id.values())
    return RetrievalChunkQualityReport(
        status="passed" if issue_count == 0 else "failed",
        chunk_count=chunk_count,
        issue_count=issue_count,
        issues_by_chunk_id=issues_by_chunk_id,
    )


def load_chunks_jsonl(path: str | Path) -> tuple[dict[str, Any], ...]:
    rows: list[dict[str, Any]] = []
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if not line.strip():
            continue
        payload = json.loads(line)
        if not isinstance(payload, dict):
            raise ValueError("chunk JSONL rows must be JSON objects")
        rows.append(payload)
    return tuple(rows)


def build_chunk_quality_audit_report(
    *,
    chunks: Iterable[Mapping[str, Any]],
    max_tokens: int,
    required_metadata_fields: Sequence[str] = ("root_unit_id", "chunk_policy_version"),
) -> RetrievalChunkQualityAuditReport:
    chunk_rows = tuple(chunks)
    quality = evaluate_chunk_quality(
        chunks=chunk_rows,
        max_tokens=max_tokens,
        required_metadata_fields=required_metadata_fields,
    )
    counts_by_issue: dict[str, int] = {}
    for issues in quality.issues_by_chunk_id.values():
        for issue in issues:
            counts_by_issue[issue] = counts_by_issue.get(issue, 0) + 1
    counts_by_unit_type: dict[str, int] = {}
    for chunk in chunk_rows:
        unit_type = _chunk_unit_type(chunk)
        counts_by_unit_type[unit_type] = counts_by_unit_type.get(unit_type, 0) + 1
    return RetrievalChunkQualityAuditReport(
        status=quality.status,
        chunk_count=quality.chunk_count,
        failed_chunk_count=len(quality.issues_by_chunk_id),
        issue_count=quality.issue_count,
        max_tokens=max_tokens,
        counts_by_issue=dict(sorted(counts_by_issue.items())),
        counts_by_unit_type=dict(sorted(counts_by_unit_type.items())),
        issues_by_chunk_id=quality.issues_by_chunk_id,
    )


def retrieval_chunk_quality_report_to_dict(
    report: RetrievalChunkQualityAuditReport,
) -> dict[str, object]:
    return {
        "status": report.status,
        "chunk_count": report.chunk_count,
        "failed_chunk_count": report.failed_chunk_count,
        "issue_count": report.issue_count,
        "max_tokens": report.max_tokens,
        "counts_by_issue": report.counts_by_issue,
        "counts_by_unit_type": report.counts_by_unit_type,
        "issues_by_chunk_id": {
            chunk_id: list(issues) for chunk_id, issues in sorted(report.issues_by_chunk_id.items())
        },
    }


def _chunk_unit_type(chunk: Mapping[str, Any]) -> str:
    metadata = chunk.get("metadata") if isinstance(chunk.get("metadata"), Mapping) else {}
    return (
        _required_text(chunk.get("unit_type"))
        or _required_text(metadata.get("unit_type"))
        or "unknown"
    )


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


def _contains_normalized_text(*, haystack: str, needle: str) -> bool:
    normalized_haystack = re.sub(r"\s+", "", str(haystack or "")).strip()
    normalized_needle = re.sub(r"\s+", "", str(needle or "")).strip()
    return bool(normalized_needle and normalized_needle in normalized_haystack)


def _is_table_chunk_missing_context_or_header(
    *,
    metadata: Mapping[str, Any],
    anchor: Mapping[str, Any],
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
    chunk: Mapping[str, Any],
    metadata: Mapping[str, Any],
) -> tuple[_ChunkQualityRow, ...]:
    lineage = metadata.get("member_segment_lineage")
    if not isinstance(lineage, list | tuple):
        return ()
    document_key = (
        str(chunk.get("corpus") or ""),
        str(chunk.get("collection") or ""),
        str(chunk.get("document_id") or ""),
        str(chunk.get("version_id") or ""),
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
    segmented_rows = tuple(
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


__all__ = [
    "RetrievalChunkQualityAuditReport",
    "RetrievalChunkQualityReport",
    "build_chunk_quality_audit_report",
    "evaluate_chunk_quality",
    "load_chunks_jsonl",
    "retrieval_chunk_quality_report_to_dict",
]
