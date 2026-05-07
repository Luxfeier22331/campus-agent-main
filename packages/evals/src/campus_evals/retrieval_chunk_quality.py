from __future__ import annotations

import json
import re
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from campus_ingestion_core.answer_ready_contract_quality import (
    evaluate_answer_ready_contract_metadata,
)
from campus_ingestion_core.regulation_semantics import starts_example_list

_TOKEN_RE = re.compile(r"[\u4e00-\u9fff]|[A-Za-z0-9_]+|[^\s]")
_ENUMERATED_EXAMPLE_RE = re.compile(r"(^|\n)\s*(?:\d+[.．、]|[（(]\d+[)）])")
_PROCEDURE_STEP_RE = re.compile(
    r"(审核|审批|公示|报送|受理|办理|备案|提交申请材料|提交[^。；;\n]{0,12}申请[^。；;\n]{0,12}材料)"
)


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
    counts_by_answer_role: dict[str, int] = field(default_factory=dict)
    counts_by_content_role: dict[str, int] = field(default_factory=dict)
    counts_by_claim_type: dict[str, int] = field(default_factory=dict)
    answer_ready_chunk_count: int = 0
    answer_ready_ratio: float = 0.0
    low_confidence_role_count: int = 0
    table_answer_ready_count: int = 0
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
        metadata = chunk.get("metadata") if isinstance(chunk.get("metadata"), Mapping) else {}
        anchor = chunk.get("anchor") if isinstance(chunk.get("anchor"), Mapping) else {}
        token_count = _coerce_int(metadata.get("final_token_count"))
        if token_count is None:
            token_count = _count_tokens(text)
        if max_tokens > 0 and token_count > max_tokens:
            issues.append("token_count_exceeds_budget")
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
        if _answer_clause_is_mixed_with_example_list(metadata=metadata, text=display_text or text):
            issues.append("answer_clause_mixed_with_example_list")
        if _category_overview_is_missing_answer_role(metadata=metadata):
            issues.append("category_overview_missing_answer_role")
        if _category_overview_is_missing_member_titles(
            metadata=metadata, text=display_text or text
        ):
            issues.append("category_overview_missing_member_titles")
        if _procedure_step_role_mismatch(metadata=metadata, text=display_text or text):
            issues.append("procedure_step_role_mismatch")
        if _answer_bearing_missing_role_confidence(metadata=metadata):
            issues.append("answer_bearing_missing_role_confidence")
        if _table_unit_missing_answer_ready_metadata(metadata=metadata):
            issues.append("table_unit_missing_answer_ready_metadata")
        issues.extend(
            evaluate_answer_ready_contract_metadata(
                corpus=str(chunk.get("corpus") or ""),
                collection=str(chunk.get("collection") or ""),
                metadata=metadata,
                anchor=anchor,
            ).issues
        )
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
    counts_by_answer_role: dict[str, int] = {}
    counts_by_content_role: dict[str, int] = {}
    counts_by_claim_type: dict[str, int] = {}
    answer_ready_chunk_count = 0
    low_confidence_role_count = 0
    table_answer_ready_count = 0
    for chunk in chunk_rows:
        unit_type = _chunk_unit_type(chunk)
        counts_by_unit_type[unit_type] = counts_by_unit_type.get(unit_type, 0) + 1
        metadata = chunk.get("metadata") if isinstance(chunk.get("metadata"), Mapping) else {}
        answer_role = _required_text(metadata.get("answer_role"))
        content_role = _required_text(metadata.get("content_role"))
        claim_type = _required_text(metadata.get("claim_type"))
        if answer_role:
            counts_by_answer_role[answer_role] = counts_by_answer_role.get(answer_role, 0) + 1
        if content_role:
            counts_by_content_role[content_role] = counts_by_content_role.get(content_role, 0) + 1
        if claim_type:
            counts_by_claim_type[claim_type] = counts_by_claim_type.get(claim_type, 0) + 1
        if _is_answer_ready_metadata(metadata):
            answer_ready_chunk_count += 1
        if str(metadata.get("role_confidence") or "").strip() == "low":
            low_confidence_role_count += 1
        if unit_type == "table_unit" and _is_answer_ready_metadata(metadata):
            table_answer_ready_count += 1
    answer_ready_ratio = (
        answer_ready_chunk_count / quality.chunk_count if quality.chunk_count else 0.0
    )
    return RetrievalChunkQualityAuditReport(
        status=quality.status,
        chunk_count=quality.chunk_count,
        failed_chunk_count=len(quality.issues_by_chunk_id),
        issue_count=quality.issue_count,
        max_tokens=max_tokens,
        counts_by_issue=dict(sorted(counts_by_issue.items())),
        counts_by_unit_type=dict(sorted(counts_by_unit_type.items())),
        counts_by_answer_role=dict(sorted(counts_by_answer_role.items())),
        counts_by_content_role=dict(sorted(counts_by_content_role.items())),
        counts_by_claim_type=dict(sorted(counts_by_claim_type.items())),
        answer_ready_chunk_count=answer_ready_chunk_count,
        answer_ready_ratio=answer_ready_ratio,
        low_confidence_role_count=low_confidence_role_count,
        table_answer_ready_count=table_answer_ready_count,
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
        "counts_by_answer_role": report.counts_by_answer_role,
        "counts_by_content_role": report.counts_by_content_role,
        "counts_by_claim_type": report.counts_by_claim_type,
        "answer_ready_chunk_count": report.answer_ready_chunk_count,
        "answer_ready_ratio": report.answer_ready_ratio,
        "low_confidence_role_count": report.low_confidence_role_count,
        "table_answer_ready_count": report.table_answer_ready_count,
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


def _answer_clause_is_mixed_with_example_list(
    *,
    metadata: Mapping[str, Any],
    text: str,
) -> bool:
    answer_role = str(metadata.get("answer_role") or "").strip()
    content_role = str(metadata.get("content_role") or "").strip()
    if answer_role not in {"exception_rule", "eligibility_condition"} and content_role not in {
        "eligibility",
        "requirement",
    }:
        return False
    if not starts_example_list(text):
        return False
    return len(_ENUMERATED_EXAMPLE_RE.findall(text)) >= 2


def _category_overview_is_missing_answer_role(*, metadata: Mapping[str, Any]) -> bool:
    unit_type = str(metadata.get("unit_type") or "").strip()
    content_role = str(metadata.get("content_role") or "").strip()
    if unit_type != "category_overview" and content_role != "policy_list":
        return False
    return str(metadata.get("answer_role") or "").strip() != "category_overview"


def _category_overview_is_missing_member_titles(
    *,
    metadata: Mapping[str, Any],
    text: str,
) -> bool:
    if not _is_category_overview_metadata(metadata):
        return False
    member_titles = metadata.get("category_member_titles")
    if not isinstance(member_titles, list | tuple):
        return False
    normalized_text = _normalize_for_contains(text)
    for title in member_titles:
        normalized_title = _normalize_for_contains(str(title or ""))
        if normalized_title and normalized_title not in normalized_text:
            return True
    return False


def _procedure_step_role_mismatch(*, metadata: Mapping[str, Any], text: str) -> bool:
    answer_role = str(metadata.get("answer_role") or "").strip()
    content_role = str(metadata.get("content_role") or "").strip()
    if answer_role == "procedure_step" or content_role == "procedure":
        return False
    if answer_role in {"exclusion_rule", "exception_rule"}:
        return False
    if str(metadata.get("claim_type") or "").strip() == "cannot_do":
        return False
    if str(metadata.get("polarity") or "").strip() == "negative":
        return False
    return _looks_like_actionable_procedure_step(text)


def _answer_bearing_missing_role_confidence(*, metadata: Mapping[str, Any]) -> bool:
    if not bool(metadata.get("is_answer_bearing")):
        return False
    return not _has_value(metadata.get("role_confidence"))


def _table_unit_missing_answer_ready_metadata(*, metadata: Mapping[str, Any]) -> bool:
    if str(metadata.get("unit_type") or "").strip() != "table_unit":
        return False
    return not (
        str(metadata.get("answer_role") or "").strip() == "table_fact"
        and _has_value(metadata.get("table_fact_type"))
        and _has_value(metadata.get("role_confidence"))
    )


def _is_answer_ready_metadata(metadata: Mapping[str, Any]) -> bool:
    if not bool(metadata.get("is_answer_bearing")):
        return False
    answer_role = str(metadata.get("answer_role") or "").strip()
    return bool(answer_role and answer_role != "supporting_detail")


def _is_category_overview_metadata(metadata: Mapping[str, Any]) -> bool:
    unit_type = str(metadata.get("unit_type") or "").strip()
    content_role = str(metadata.get("content_role") or "").strip()
    return unit_type == "category_overview" or content_role == "policy_list"


def _normalize_for_contains(value: str) -> str:
    return re.sub(r"\s+", "", str(value or "")).strip()


def _looks_like_actionable_procedure_step(text: str) -> bool:
    normalized = _normalize_for_contains(text)
    first_line = next((line.strip() for line in text.splitlines() if line.strip()), "")
    if not _PROCEDURE_STEP_RE.search(normalized):
        return False
    if any(marker in normalized for marker in ("负责", "职责", "不再受理", "不予受理", "视为放弃")):
        return False
    if (
        "提交申请材料" in normalized
        and not _ENUMERATED_EXAMPLE_RE.match(first_line)
        and not any(marker in normalized for marker in ("程序", "流程", "步骤", "公示", "审批", "审核"))
    ):
        return False
    if len(_ENUMERATED_EXAMPLE_RE.findall(text)) >= 2:
        return True
    if _ENUMERATED_EXAMPLE_RE.match(first_line):
        return True
    if any(marker in normalized for marker in ("申请程序", "办理程序", "按照以下程序", "按如下程序")):
        return True
    return bool(
        re.search(
            r"(提交[^。；;\n]{0,18}(?:材料|申请)|进行审核|予以公示|申请人.{0,18}提交|本人.{0,18}提交)",
            normalized,
        )
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
