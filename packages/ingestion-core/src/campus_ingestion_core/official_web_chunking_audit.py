from __future__ import annotations

import json
import re
from collections import Counter
from dataclasses import dataclass
from pathlib import Path
from statistics import median

from campus_ingestion_core.chunking import (
    _dedupe_context_section_path,
    _normalize_context_text,
    estimate_token_count,
)
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRef, SourceObservation
from campus_ingestion_core.process import build_indexable_chunks_from_jsonl

OFFICIAL_WEB_PROJECTION_CHUNKING_AUDIT_SCHEMA_VERSION = "official_web_projection_chunking_audit.v1"
_SHORT_CHUNK_TOKEN_THRESHOLD = 60
_COLLAPSED_SECTION_PATH_MIN_UNITS = 3
_SHORT_LABEL_MAX_CHARS = 8
_LISTING_CONTEXT_POLLUTION_MIN_UNITS = 4
_LISTING_CONTEXT_POLLUTION_MIN_CHARS = 12
_ROW_ID_MISMATCH_EXTRA_IDS_THRESHOLD = 3
_ARTICLE_SECTION_OVER_AGGREGATION_MIN_LINES = 4
_TERMINAL_COPYRIGHT_PATTERN = re.compile(r"^copyright(?:@|\b)", re.IGNORECASE)
_TERMINAL_BOILERPLATE_PREFIXES = (
    "新闻网版权与免责声明",
    "投稿方式：",
    "投稿方式:",
    "① 凡本网未注明其他出处的作品",
    "② 凡本网注明其他来源的作品",
    "③ 有关作品内容、版权和其它问题请与我们联系",
)
_SOURCE_ATTRIBUTION_PATTERN = re.compile(r"^[（(]?\s*来源[:：]\s*[^（）()]+[)）]?$")
_OFFICIAL_WEB_HEADER_LINE_PREFIXES = ("标题：", "章节：", "文号：")


@dataclass(frozen=True, slots=True)
class OfficialWebProjectionChunkingAuditDocumentReport:
    document_id: str
    title: str
    target_corpus: str
    target_collection: str
    normalized_canonical_url: str
    page_family: str
    unit_count: int
    chunk_count: int
    distinct_section_path_count: int
    token_summary: dict[str, int | float]
    short_chunk_count: int
    stacked_short_label_unit_count: int
    ellipsis_unit_count: int
    issue_codes: tuple[str, ...]
    examples: tuple[dict[str, object], ...]


@dataclass(frozen=True, slots=True)
class OfficialWebProjectionChunkingAuditReport:
    schema_version: str
    projection_output_dir: str
    passed: bool
    document_count: int
    total_units: int
    total_chunks: int
    issue_counts: dict[str, int]
    documents: tuple[OfficialWebProjectionChunkingAuditDocumentReport, ...]


def audit_official_web_projection_chunking(
    projection_output_dir: Path,
) -> OfficialWebProjectionChunkingAuditReport:
    resolved_output_dir = projection_output_dir.resolve()
    projection_report = _read_json(resolved_output_dir / "projection-report.json")
    raw_documents = projection_report.get("documents")
    if not isinstance(raw_documents, list):
        raise ValueError("projection report documents must be an array")

    documents: list[OfficialWebProjectionChunkingAuditDocumentReport] = []
    issue_counts: Counter[str] = Counter()
    total_units = 0
    total_chunks = 0
    for raw_document in raw_documents:
        if not isinstance(raw_document, dict):
            raise ValueError("projection report document must be an object")
        document_report = _audit_document(raw_document)
        documents.append(document_report)
        total_units += document_report.unit_count
        total_chunks += document_report.chunk_count
        issue_counts.update(document_report.issue_codes)
        issue_counts["stacked_short_label_lines"] += document_report.stacked_short_label_unit_count
        issue_counts["ellipsis_truncation"] += document_report.ellipsis_unit_count
        if "stacked_short_label_lines" in document_report.issue_codes:
            issue_counts["stacked_short_label_lines"] -= 1
        if "ellipsis_truncation" in document_report.issue_codes:
            issue_counts["ellipsis_truncation"] -= 1

    normalized_issue_counts = {code: count for code, count in issue_counts.items() if count > 0}
    return OfficialWebProjectionChunkingAuditReport(
        schema_version=OFFICIAL_WEB_PROJECTION_CHUNKING_AUDIT_SCHEMA_VERSION,
        projection_output_dir=str(resolved_output_dir),
        passed=not normalized_issue_counts,
        document_count=len(documents),
        total_units=total_units,
        total_chunks=total_chunks,
        issue_counts=normalized_issue_counts,
        documents=tuple(documents),
    )


def _audit_document(
    raw_document: dict[str, object],
) -> OfficialWebProjectionChunkingAuditDocumentReport:
    document_id = _require_text(raw_document.get("document_id"), "document_id")
    version_id = _require_text(raw_document.get("version_id"), "version_id")
    title = _require_text(raw_document.get("title"), "title")
    target_corpus = _require_text(raw_document.get("target_corpus"), "target_corpus")
    target_collection = _require_text(raw_document.get("target_collection"), "target_collection")
    normalized_canonical_url = _require_text(
        raw_document.get("normalized_canonical_url"),
        "normalized_canonical_url",
    )
    page_family = _require_text(raw_document.get("page_family"), "page_family")
    raw_asset_id = _require_text(raw_document.get("raw_asset_id"), "raw_asset_id")
    raw_version_id = _require_text(raw_document.get("raw_version_id"), "raw_version_id")
    units_path = Path(
        _require_text(raw_document.get("document_units_path"), "document_units_path")
    ).resolve()
    rows = _read_jsonl(units_path)
    if not rows:
        raise ValueError(f"projection document {document_id} produced no document units")

    runtime_profile = load_runtime_profile(target_corpus, target_collection)
    record = DocumentRegistryRecord(
        document_id=document_id,
        revision_track="source-faithful",
        version_id=version_id,
        source_uri=normalized_canonical_url,
        content_hash=f"projection-audit:{version_id}",
        corpus=target_corpus,
        collection=target_collection,
        cleaning_policy_version=runtime_profile.cleaning_policy_version,
        ingestion_timestamp="2026-04-02T00:00:00+00:00",
        parser_version="official_web_projection_replay.v1",
        embedding_model="",
        source_channel="official_web",
        is_current=True,
        raw_asset=RawAssetRef(raw_asset_id=raw_asset_id, raw_version_id=raw_version_id),
        source_observations=(
            SourceObservation(
                source_channel="official_web",
                source_uri=normalized_canonical_url,
                is_primary=True,
                import_source="official_web_projection_chunking_audit",
            ),
        ),
        import_source="official_web_projection_chunking_audit",
    )
    chunks = build_indexable_chunks_from_jsonl(
        record=record,
        structured_jsonl_bytes=units_path.read_bytes(),
    )
    token_counts = [estimate_token_count(chunk.text) for chunk in chunks]
    section_paths = {tuple(_require_section_path(row)) for row in rows}
    short_chunk_count = sum(1 for count in token_counts if count <= _SHORT_CHUNK_TOKEN_THRESHOLD)
    stacked_short_label_examples = [
        {
            "issue_code": "stacked_short_label_lines",
            "unit_index": index,
            "text": text,
        }
        for index, text in enumerate(
            (_require_text(row.get("clean_text"), "clean_text") for row in rows), start=1
        )
        if _looks_like_stacked_short_label_lines(text)
    ]
    ellipsis_examples = [
        {
            "issue_code": "ellipsis_truncation",
            "unit_index": index,
            "text": text,
        }
        for index, text in enumerate(
            (_require_text(row.get("clean_text"), "clean_text") for row in rows), start=1
        )
        if _contains_ellipsis_truncation(text)
    ]
    headline_only_examples = [
        {
            "issue_code": "headline_only_fragments",
            "unit_index": index,
            "text": text,
        }
        for index, text in enumerate(
            (_require_text(row.get("clean_text"), "clean_text") for row in rows), start=1
        )
        if _looks_like_headline_only_fragment(text)
    ]
    teaser_cluster_examples = [
        {
            "issue_code": "teaser_cluster_lines",
            "unit_index": index,
            "text": text,
        }
        for index, text in enumerate(
            (_require_text(row.get("clean_text"), "clean_text") for row in rows), start=1
        )
        if page_family == "listing_page" and _looks_like_listing_teaser_cluster(text)
    ]
    listing_context_pollution_example = (
        _find_listing_context_pollution(rows) if page_family == "listing_page" else None
    )
    row_id_mismatch_examples = [
        {
            "issue_code": "row_id_mismatch_after_cleaning",
            "unit_index": index,
            "text": text,
            "row_id_count": len(row_ids),
            "line_count": len([line for line in text.splitlines() if line.strip()]),
        }
        for index, row in enumerate(rows, start=1)
        for text in [_require_text(row.get("clean_text"), "clean_text")]
        for row_ids in [_require_row_ids(row)]
        if page_family == "listing_page"
        and _looks_like_row_id_mismatch_after_cleaning(text, row_ids)
    ]
    article_section_over_aggregation_examples = [
        {
            "issue_code": "article_section_over_aggregation",
            "unit_index": index,
            "text": text,
            "row_id_count": len(row_ids),
            "line_count": len([line for line in text.splitlines() if line.strip()]),
            "section_path": list(_require_section_path(row)),
        }
        for index, row in enumerate(rows, start=1)
        for text in [_require_text(row.get("clean_text"), "clean_text")]
        for row_ids in [_require_row_ids(row)]
        for content_role in [_resolve_content_role(row)]
        if page_family == "article_detail"
        and _looks_like_article_section_over_aggregation(
            text,
            row_ids,
            content_role=content_role,
        )
    ]
    source_only_chunk_examples = [
        {
            "issue_code": "source_only_chunk",
            "chunk_id": chunk.chunk_id,
            "text": chunk.text,
        }
        for chunk in chunks
        if page_family == "article_detail"
        and _looks_like_source_only_chunk(chunk.text, chunk.metadata)
    ]
    terminal_boilerplate_chunk_examples = [
        {
            "issue_code": "terminal_boilerplate_chunk",
            "chunk_id": chunk.chunk_id,
            "text": chunk.text,
        }
        for chunk in chunks
        if page_family == "article_detail"
        and _looks_like_terminal_boilerplate_chunk(chunk.text, chunk.metadata)
    ]
    header_context_drift_examples = [
        {
            "issue_code": "header_context_drift",
            "chunk_id": chunk.chunk_id,
            "header_mode": str(chunk.metadata.get("header_mode") or ""),
            "text": chunk.text,
        }
        for chunk in chunks
        if _looks_like_header_context_drift(
            text=chunk.text,
            metadata=chunk.metadata,
            anchor=chunk.anchor,
            page_family=page_family,
        )
    ]

    issue_codes: list[str] = []
    examples: list[dict[str, object]] = []
    if (
        page_family == "generic_content_page"
        and len(rows) >= _COLLAPSED_SECTION_PATH_MIN_UNITS
        and len(section_paths) == 1
    ):
        issue_codes.append("collapsed_section_path")
        examples.append(
            {
                "issue_code": "collapsed_section_path",
                "section_path": list(next(iter(section_paths))),
                "unit_count": len(rows),
            }
        )
    if stacked_short_label_examples:
        issue_codes.append("stacked_short_label_lines")
        examples.extend(stacked_short_label_examples[:3])
    if ellipsis_examples:
        issue_codes.append("ellipsis_truncation")
        examples.extend(ellipsis_examples[:3])
    if teaser_cluster_examples:
        issue_codes.append("teaser_cluster_lines")
        examples.extend(teaser_cluster_examples[:3])
    if listing_context_pollution_example is not None:
        issue_codes.append("listing_context_pollution")
        examples.append(listing_context_pollution_example)
    if row_id_mismatch_examples:
        issue_codes.append("row_id_mismatch_after_cleaning")
        examples.extend(row_id_mismatch_examples[:3])
    if article_section_over_aggregation_examples:
        issue_codes.append("article_section_over_aggregation")
        examples.extend(article_section_over_aggregation_examples[:3])
    if source_only_chunk_examples:
        issue_codes.append("source_only_chunk")
        examples.extend(source_only_chunk_examples[:3])
    if terminal_boilerplate_chunk_examples:
        issue_codes.append("terminal_boilerplate_chunk")
        examples.extend(terminal_boilerplate_chunk_examples[:3])
    if header_context_drift_examples:
        issue_codes.append("header_context_drift")
        examples.extend(header_context_drift_examples[:3])
    if page_family == "generic_content_page" and len(headline_only_examples) >= 3:
        issue_codes.append("headline_only_fragments")
        examples.extend(headline_only_examples[:3])

    return OfficialWebProjectionChunkingAuditDocumentReport(
        document_id=document_id,
        title=title,
        target_corpus=target_corpus,
        target_collection=target_collection,
        normalized_canonical_url=normalized_canonical_url,
        page_family=page_family,
        unit_count=len(rows),
        chunk_count=len(chunks),
        distinct_section_path_count=len(section_paths),
        token_summary=_build_token_summary(token_counts),
        short_chunk_count=short_chunk_count,
        stacked_short_label_unit_count=len(stacked_short_label_examples),
        ellipsis_unit_count=len(ellipsis_examples),
        issue_codes=tuple(issue_codes),
        examples=tuple(examples),
    )


def _build_token_summary(token_counts: list[int]) -> dict[str, int | float]:
    if not token_counts:
        return {"min": 0, "max": 0, "avg": 0.0, "median": 0}
    return {
        "min": min(token_counts),
        "max": max(token_counts),
        "avg": round(sum(token_counts) / len(token_counts), 2),
        "median": int(median(token_counts)),
    }


def _contains_ellipsis_truncation(text: str) -> bool:
    normalized = text.strip()
    return "..." in normalized or "…" in normalized


def _looks_like_stacked_short_label_lines(text: str) -> bool:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len(lines) < 3:
        return False
    short_line_count = sum(1 for line in lines if len(line) <= _SHORT_LABEL_MAX_CHARS)
    return short_line_count >= 2


def _looks_like_headline_only_fragment(text: str) -> bool:
    normalized = " ".join(text.split()).strip()
    if not normalized:
        return False
    if len(normalized) > 96:
        return False
    if "..." in normalized or "…" in normalized:
        return True
    if any(punctuation in normalized for punctuation in {"。", "！", "？", "；", ";"}):
        return False
    comma_count = normalized.count("，") + normalized.count(",")
    return comma_count < 2


def _looks_like_listing_teaser_cluster(text: str) -> bool:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if len(lines) < 3:
        return False
    for start_index in range(1, len(lines)):
        trailing_lines = lines[start_index:]
        if len(trailing_lines) < 2:
            continue
        if not _looks_like_listing_series_anchor(lines[start_index - 1]):
            continue
        teaser_like_count = sum(
            1 for line in trailing_lines if _looks_like_listing_teaser_line(line)
        )
        if teaser_like_count >= 2:
            return True
    return False


def _looks_like_listing_series_anchor(text: str) -> bool:
    normalized = " ".join(text.split()).strip()
    if not normalized:
        return False
    return normalized.startswith("【") and "】" in normalized


def _looks_like_listing_teaser_line(text: str) -> bool:
    normalized = " ".join(text.split()).strip()
    if not normalized:
        return False
    if normalized[:1].isdigit() and "张" in normalized[:6]:
        return True
    return " | " in normalized


def _find_listing_context_pollution(rows: list[dict[str, object]]) -> dict[str, object] | None:
    leaf_counts: Counter[str] = Counter()
    clean_texts = {
        _normalize_text(_require_text(row.get("clean_text"), "clean_text")) for row in rows
    }
    for row in rows:
        section_path = _require_section_path(row)
        if not section_path:
            continue
        leaf = _normalize_text(section_path[-1])
        if not _looks_like_listing_context_pollution_leaf(leaf):
            continue
        leaf_counts[leaf] += 1
    if not leaf_counts:
        return None
    leaf, unit_count = leaf_counts.most_common(1)[0]
    if unit_count < _LISTING_CONTEXT_POLLUTION_MIN_UNITS or leaf not in clean_texts:
        return None
    return {
        "issue_code": "listing_context_pollution",
        "section_leaf": leaf,
        "unit_count": unit_count,
    }


def _looks_like_listing_context_pollution_leaf(text: str) -> bool:
    normalized = _normalize_text(text)
    if len(normalized) <= _LISTING_CONTEXT_POLLUTION_MIN_CHARS:
        return False
    return not any(punctuation in normalized for punctuation in {"。", "！", "？", "；"})


def _looks_like_row_id_mismatch_after_cleaning(text: str, row_ids: tuple[str, ...]) -> bool:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return False
    return len(row_ids) >= len(lines) + _ROW_ID_MISMATCH_EXTRA_IDS_THRESHOLD


def _looks_like_article_section_over_aggregation(
    text: str,
    row_ids: tuple[str, ...],
    *,
    content_role: str,
) -> bool:
    if content_role == "notice_fact":
        return False
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    content_lines = _trim_terminal_boilerplate_lines(lines)
    if len(content_lines) < _ARTICLE_SECTION_OVER_AGGREGATION_MIN_LINES:
        return False
    return len(row_ids) >= len(content_lines)


def _trim_terminal_boilerplate_lines(lines: list[str]) -> list[str]:
    trimmed = list(lines)
    while trimmed and _is_terminal_boilerplate_line(trimmed[-1]):
        trimmed.pop()
    return trimmed


def _is_terminal_boilerplate_line(text: str) -> bool:
    normalized = _normalize_text(text)
    if not normalized:
        return False
    if normalized.startswith(_TERMINAL_BOILERPLATE_PREFIXES):
        return True
    if "版权与免责声明" in normalized:
        return True
    lowered = normalized.casefold()
    if "all rights reserved" in lowered:
        return True
    if "转载、摘编或以其它方式使用本网作品" in normalized:
        return True
    if "并不代表本网赞同其观点和对其真实性负责" in normalized:
        return True
    return _TERMINAL_COPYRIGHT_PATTERN.match(normalized) is not None


def _looks_like_source_only_chunk(text: str, metadata: dict[str, object]) -> bool:
    lines = _extract_chunk_content_lines(text=text, metadata=metadata)
    return bool(lines) and all(
        _SOURCE_ATTRIBUTION_PATTERN.match(line) is not None for line in lines
    )


def _looks_like_terminal_boilerplate_chunk(text: str, metadata: dict[str, object]) -> bool:
    lines = _extract_chunk_content_lines(text=text, metadata=metadata)
    return bool(lines) and all(_is_terminal_boilerplate_line(line) for line in lines)


def _looks_like_header_context_drift(
    *,
    text: str,
    metadata: dict[str, object],
    anchor: dict[str, object],
    page_family: str,
) -> bool:
    if page_family == "listing_page":
        return False
    if str(metadata.get("serving_intent") or "").strip() == "audit_only":
        return False
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return False
    first_line = lines[0]
    header_mode = str(metadata.get("header_mode") or "").strip()
    title_text = _normalize_context_text(metadata.get("title"))
    raw_section_path = anchor.get("section_path")
    normalized_section_path = (
        tuple(str(item).strip() for item in raw_section_path if str(item).strip())
        if isinstance(raw_section_path, (list, tuple))
        else ()
    )
    effective_section_path = _dedupe_context_section_path(
        title_text=title_text,
        section_path=normalized_section_path,
    )
    if header_mode == "compact_identity":
        return True
    if not first_line.startswith("标题："):
        return True
    return bool(effective_section_path and "章节：" not in first_line)


def _resolve_content_role(row: dict[str, object]) -> str:
    metadata = row.get("metadata")
    if not isinstance(metadata, dict):
        return ""
    return str(metadata.get("content_role") or "").strip()


def _extract_chunk_content_lines(*, text: str, metadata: dict[str, object]) -> tuple[str, ...]:
    lines = [line.strip() for line in text.splitlines() if line.strip()]
    if not lines:
        return ()
    header_mode = str(metadata.get("header_mode") or "").strip()
    if header_mode and header_mode != "none":
        lines = lines[1:]
    else:
        while lines and lines[0].startswith(_OFFICIAL_WEB_HEADER_LINE_PREFIXES):
            lines.pop(0)
    return tuple(
        line for line in lines if line and not line.startswith(_OFFICIAL_WEB_HEADER_LINE_PREFIXES)
    )


def _require_section_path(row: dict[str, object]) -> tuple[str, ...]:
    anchor = row.get("anchor")
    if not isinstance(anchor, dict):
        raise ValueError("anchor must be an object")
    section_path = anchor.get("section_path")
    if not isinstance(section_path, list):
        return ()
    return tuple(str(item).strip() for item in section_path if str(item).strip())


def _require_row_ids(row: dict[str, object]) -> tuple[str, ...]:
    anchor = row.get("anchor")
    if not isinstance(anchor, dict):
        raise ValueError("anchor must be an object")
    row_ids = anchor.get("row_ids")
    if not isinstance(row_ids, list):
        return ()
    return tuple(str(item).strip() for item in row_ids if str(item).strip())


def _normalize_text(text: str) -> str:
    return " ".join(text.split()).strip()


def _read_json(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"expected JSON object at {path}")
    return payload


def _read_jsonl(path: Path) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for line in path.read_text(encoding="utf-8").splitlines():
        normalized = line.strip()
        if not normalized:
            continue
        payload = json.loads(normalized)
        if not isinstance(payload, dict):
            raise ValueError(f"expected JSON object rows in {path}")
        rows.append(payload)
    return rows


def _require_text(value: object, field_name: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{field_name} must be a non-empty string")
    return value.strip()


__all__ = [
    "OFFICIAL_WEB_PROJECTION_CHUNKING_AUDIT_SCHEMA_VERSION",
    "OfficialWebProjectionChunkingAuditDocumentReport",
    "OfficialWebProjectionChunkingAuditReport",
    "audit_official_web_projection_chunking",
]
