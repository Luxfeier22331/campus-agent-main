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


def evaluate_chunk_quality(
    *,
    chunks: Iterable[Mapping[str, Any]],
    max_tokens: int,
    required_metadata_fields: Sequence[str] = ("root_unit_id", "chunk_policy_version"),
) -> RetrievalChunkQualityReport:
    issues_by_chunk_id: dict[str, tuple[str, ...]] = {}
    seen_chunk_ids: set[str] = set()
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
        if issues:
            issues_by_chunk_id[chunk_id] = tuple(dict.fromkeys(issues))
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


__all__ = [
    "RetrievalChunkQualityReport",
    "evaluate_chunk_quality",
    "load_chunks_jsonl",
]
