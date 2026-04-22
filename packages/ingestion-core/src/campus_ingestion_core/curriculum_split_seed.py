from __future__ import annotations

import ast
import json
import re
from collections.abc import Mapping, Sequence
from dataclasses import dataclass
from pathlib import Path

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION

from campus_ingestion_core.curriculum_title_normalization import (
    canonicalize_curriculum_manifest_heading,
    normalize_curriculum_title_for_match,
)
from campus_ingestion_core.split_manifest import SplitManifest, SplitManifestDocument

_PAGES_SPAN_PATTERN = re.compile(r"(?P<start>\d+)-(?P<end>\d+)")
_HISTORICAL_RETIRED_DOCUMENT_REASONS = {
    "plan:78d25a2033e93fc5940e2d10648ae2d7e887cb74": "synthetic_umbrella_title",
}


@dataclass(frozen=True, slots=True)
class HistoricalCurriculumDocument:
    document_id: str
    title: str
    status: str
    canonical_doc_path: str
    historical_page_start: int | None
    historical_page_end: int | None
    ocr_doc_decision_uri: str | None


@dataclass(frozen=True, slots=True)
class MissingCurriculumSplitDocument:
    document_id: str
    title: str
    canonical_doc_path: str
    historical_page_start: int | None
    historical_page_end: int | None
    reason: str = "title_not_found_in_structured_full"


@dataclass(frozen=True, slots=True)
class RetiredCurriculumSplitDocument:
    document_id: str
    title: str
    canonical_doc_path: str
    historical_page_start: int | None
    historical_page_end: int | None
    reason: str


@dataclass(frozen=True, slots=True)
class CurriculumSplitManifestSeed:
    manifest: SplitManifest
    missing_documents: tuple[MissingCurriculumSplitDocument, ...]
    retired_documents: tuple[RetiredCurriculumSplitDocument, ...] = ()


def build_manifest_document_rows(
    *,
    structured_rows: Sequence[Mapping[str, object]],
    manifest_document: SplitManifestDocument,
    version_id: str,
    source_pdf: str,
    source_uri: str,
    entitlement_groups: Sequence[str] = (),
) -> list[dict[str, object]]:
    page_rows = [
        dict(row)
        for row in structured_rows
        if _row_belongs_to_page_range(
            row=row,
            page_start=manifest_document.page_start,
            page_end=manifest_document.page_end,
        )
    ]
    if not page_rows:
        raise ValueError(
            f"split manifest document {manifest_document.document_id} does not match any structured rows"
        )
    selected_rows = [row for row in page_rows if _row_text(row)]
    if not selected_rows:
        raise ValueError("split-manifest source row is missing normalized text")
    transformed_rows = [
        _transform_split_row(
            row=row,
            document_id=manifest_document.document_id,
            manifest_title=manifest_document.title,
            version_id=version_id,
            source_pdf=source_pdf,
            source_uri=source_uri,
            entitlement_groups=tuple(entitlement_groups)
            or manifest_document.resolved_entitlement_groups(),
        )
        for row in selected_rows
    ]
    summary_row = dict(transformed_rows[0])
    summary_row["chunk_id"] = "document-0000"
    summary_row["clean_text"] = "\n\n".join(
        text
        for text in (str(row.get("clean_text") or "").strip() for row in transformed_rows)
        if text
    )
    summary_row["page_start"] = manifest_document.page_start
    summary_row["page_end"] = manifest_document.page_end
    return [summary_row, *transformed_rows]


def load_historical_curriculum_documents(
    docs_root: Path,
) -> tuple[HistoricalCurriculumDocument, ...]:
    documents: list[HistoricalCurriculumDocument] = []
    for path in sorted(Path(docs_root).glob("*.md")):
        metadata = _load_historical_markdown_metadata(path)
        document_id = str(metadata.get("doc_id") or "").strip()
        title = str(metadata.get("title") or "").strip()
        if not document_id or not title:
            continue
        page_start, page_end = _parse_pages_span(str(metadata.get("pages_span") or "").strip())
        source_refs = _parse_source_refs(str(metadata.get("source_refs") or "[]"))
        documents.append(
            HistoricalCurriculumDocument(
                document_id=document_id,
                title=title,
                status=str(metadata.get("status") or "active"),
                canonical_doc_path=_find_source_ref_uri(
                    source_refs=source_refs,
                    ref_type="canonical_doc_path",
                    default=f"rag-data/canonical/curriculum_plan/docs/{path.name}",
                ),
                historical_page_start=page_start,
                historical_page_end=page_end,
                ocr_doc_decision_uri=_find_source_ref_uri(
                    source_refs=source_refs, ref_type="ocr_doc_decision_v1"
                ),
            )
        )
    return tuple(documents)


def load_layout_elements_rows(path: Path) -> list[dict[str, object]]:
    return [
        json.loads(line)
        for line in Path(path).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def derive_curriculum_source_uri_from_canonical_path(canonical_doc_path: str) -> str:
    normalized = canonical_doc_path.strip().lstrip("/")
    if not normalized:
        raise ValueError("canonical_doc_path is required")
    return f"campusrag://{normalized}"


def build_curriculum_split_manifest_seed(
    *,
    historical_documents: Sequence[HistoricalCurriculumDocument],
    structured_rows: Sequence[Mapping[str, object]],
    raw_asset_id: str,
    manifest_version: str = "curriculum_plan_split_manifest_seed_v1",
) -> CurriculumSplitManifestSeed:
    if not raw_asset_id:
        raise ValueError("raw_asset_id is required")
    title_to_pages = _build_title_to_candidate_pages(structured_rows)
    max_page = _resolve_max_page(structured_rows)
    matched: list[tuple[HistoricalCurriculumDocument, int]] = []
    missing: list[MissingCurriculumSplitDocument] = []
    retired: list[RetiredCurriculumSplitDocument] = []
    for document in historical_documents:
        retirement_reason = _resolve_historical_document_retirement_reason(document)
        if retirement_reason is not None:
            retired.append(
                RetiredCurriculumSplitDocument(
                    document_id=document.document_id,
                    title=document.title,
                    canonical_doc_path=document.canonical_doc_path,
                    historical_page_start=document.historical_page_start,
                    historical_page_end=document.historical_page_end,
                    reason=retirement_reason,
                )
            )
            continue
        candidate_pages = title_to_pages.get(_normalize_split_title(document.title), ())
        if len(candidate_pages) > 1:
            missing.append(
                MissingCurriculumSplitDocument(
                    document_id=document.document_id,
                    title=document.title,
                    canonical_doc_path=document.canonical_doc_path,
                    historical_page_start=document.historical_page_start,
                    historical_page_end=document.historical_page_end,
                    reason="ambiguous_title_in_structured_headings",
                )
            )
            continue
        if not candidate_pages:
            missing.append(
                MissingCurriculumSplitDocument(
                    document_id=document.document_id,
                    title=document.title,
                    canonical_doc_path=document.canonical_doc_path,
                    historical_page_start=document.historical_page_start,
                    historical_page_end=document.historical_page_end,
                    reason="title_not_found_in_structured_headings",
                )
            )
            continue
        page_start = candidate_pages[0]
        matched.append((document, page_start))
    matched.sort(key=lambda item: (item[1], item[0].document_id))
    documents: list[SplitManifestDocument] = []
    for index, (document, page_start) in enumerate(matched):
        next_start = matched[index + 1][1] if index + 1 < len(matched) else max_page + 1
        page_end = next_start - 1
        documents.append(
            SplitManifestDocument(
                document_id=document.document_id,
                title=document.title,
                page_start=page_start,
                page_end=page_end,
                status=document.status or "active",
            )
        )
    return CurriculumSplitManifestSeed(
        manifest=SplitManifest(
            manifest_version=manifest_version,
            corpus="curriculum",
            collection="curriculum_plan",
            raw_asset_id=raw_asset_id,
            documents=tuple(documents),
        ),
        missing_documents=tuple(missing),
        retired_documents=tuple(retired),
    )


def _load_historical_markdown_metadata(path: Path) -> dict[str, str]:
    metadata: dict[str, str] = {}
    for line in Path(path).read_text(encoding="utf-8").splitlines():
        if line == "---":
            break
        if not line.startswith("- "):
            continue
        key, value = line[2:].split(": ", 1)
        metadata[key] = value
    return metadata


def _parse_pages_span(value: str) -> tuple[int | None, int | None]:
    if not value:
        return None, None
    match = _PAGES_SPAN_PATTERN.fullmatch(value)
    if match is None:
        raise ValueError(f"invalid pages_span: {value}")
    return int(match.group("start")), int(match.group("end"))


def _parse_source_refs(value: str) -> tuple[dict[str, str], ...]:
    if not value:
        return ()
    parsed = ast.literal_eval(value)
    refs: list[dict[str, str]] = []
    for item in parsed:
        if not isinstance(item, dict):
            continue
        ref_type = item.get("type")
        uri = item.get("uri")
        if isinstance(ref_type, str) and isinstance(uri, str):
            refs.append({"type": ref_type, "uri": uri})
    return tuple(refs)


def _find_source_ref_uri(
    *,
    source_refs: Sequence[Mapping[str, str]],
    ref_type: str,
    default: str | None = None,
) -> str | None:
    for item in source_refs:
        if item.get("type") == ref_type:
            uri = item.get("uri")
            if isinstance(uri, str) and uri.strip():
                return uri.strip()
    return default


def _build_title_to_candidate_pages(
    structured_rows: Sequence[Mapping[str, object]],
) -> dict[str, tuple[int, ...]]:
    title_to_pages: dict[str, set[int]] = {}
    for row in structured_rows:
        page_start = row.get("page_start")
        if not isinstance(page_start, int):
            continue
        if not _row_is_title_candidate(row):
            continue
        text = _row_text(row)
        if not text:
            continue
        normalized_title = _normalize_split_title(text)
        if not normalized_title:
            continue
        title_to_pages.setdefault(normalized_title, set()).add(page_start)
    return {key: tuple(sorted(value)) for key, value in title_to_pages.items()}


def _normalize_split_title(value: str) -> str:
    return normalize_curriculum_title_for_match(value)


def _resolve_historical_document_retirement_reason(
    document: HistoricalCurriculumDocument,
) -> str | None:
    return _HISTORICAL_RETIRED_DOCUMENT_REASONS.get(document.document_id)


def _resolve_max_page(structured_rows: Sequence[Mapping[str, object]]) -> int:
    max_page = max(
        int(row["page_end"]) for row in structured_rows if isinstance(row.get("page_end"), int)
    )
    if max_page <= 0:
        raise ValueError("structured_rows must contain positive page_end values")
    return max_page


def _row_is_title_candidate(row: Mapping[str, object]) -> bool:
    if str(row.get("row_type") or "") != "heading":
        return False
    block_role = _optional_string(row.get("block_role"))
    if block_role in {"doc_title", "paragraph_title", "text_heading_candidate"}:
        return True
    title_candidate_score = row.get("title_candidate_score")
    return isinstance(title_candidate_score, (int, float)) and float(title_candidate_score) > 0


def _row_text(row: Mapping[str, object]) -> str:
    for field_name in ("text_normalized", "text_raw", "html"):
        value = row.get(field_name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _row_belongs_to_page_range(
    *, row: Mapping[str, object], page_start: int, page_end: int
) -> bool:
    row_page_start = row.get("page_start")
    row_page_end = row.get("page_end")
    if not isinstance(row_page_start, int) or not isinstance(row_page_end, int):
        return False
    return row_page_start >= page_start and row_page_end <= page_end


def _transform_split_row(
    *,
    row: Mapping[str, object],
    document_id: str,
    manifest_title: str,
    version_id: str,
    source_pdf: str,
    source_uri: str,
    entitlement_groups: tuple[str, ...],
) -> dict[str, object]:
    clean_text = _row_text(row)
    if not clean_text:
        raise ValueError("split-manifest source row is missing normalized text")
    clean_text = canonicalize_curriculum_manifest_heading(
        row=row,
        clean_text=clean_text,
        manifest_title=manifest_title,
    )
    page_start = int(row["page_start"])
    page_end = int(row["page_end"])
    projected = {
        "doc_id": document_id,
        "version_id": version_id,
        "chunk_id": _projected_chunk_id(row=row, page_start=page_start),
        "row_id": _required_row_id(row),
        "row_type": _optional_string(row.get("row_type")),
        "heading_level": row.get("heading_level"),
        "row_index": row.get("row_index"),
        "reading_order": row.get("reading_order"),
        "section_hint": _optional_string(row.get("section_hint")),
        "clean_text": clean_text,
        "html": row.get("html"),
        "table_cells": row.get("table_cells"),
        "owner_row_id": _optional_string(row.get("owner_row_id")),
        "relation_type": _optional_string(row.get("relation_type")),
        "continuation_group_id": _optional_string(row.get("continuation_group_id")),
        "source_pdf": source_pdf,
        "source_url": source_uri,
        "source_md": None,
        "source": {"id": source_uri},
        "page_start": page_start,
        "page_end": page_end,
        "entitlement_groups": list(entitlement_groups),
        "visibility_scope": None,
        "visibility_level": "restricted" if entitlement_groups else "public",
        "policy_projection_version": DEFAULT_POLICY_PROJECTION_VERSION,
    }
    return projected


def _required_row_id(row: Mapping[str, object]) -> str:
    row_id = _optional_string(row.get("row_id"))
    if row_id is None:
        raise ValueError("split-manifest source row is missing row_id")
    return row_id


def _projected_chunk_id(*, row: Mapping[str, object], page_start: int) -> str:
    row_id = _optional_string(row.get("row_id"))
    if row_id is not None:
        return row_id
    return f"page-{page_start:04d}"


def _optional_string(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None
