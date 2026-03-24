from __future__ import annotations

import ast
from dataclasses import dataclass
import json
from pathlib import Path
import re
from typing import Mapping, Sequence
import unicodedata

from campus_ingestion_core.split_manifest import SplitManifest, SplitManifestDocument

_PAGES_SPAN_PATTERN = re.compile(r"(?P<start>\d+)-(?P<end>\d+)")
_TRAILING_EDITION_SUFFIX_PATTERN = re.compile(r"\(\s*20\d{2}\s*版\s*\)$")
_LEGACY_RETIRED_DOCUMENT_REASONS = {
    "plan:78d25a2033e93fc5940e2d10648ae2d7e887cb74": "legacy_synthetic_umbrella_title",
}


@dataclass(frozen=True, slots=True)
class LegacyCurriculumDocument:
    document_id: str
    title: str
    status: str
    canonical_doc_path: str
    legacy_page_start: int | None
    legacy_page_end: int | None
    ocr_doc_decision_uri: str | None


@dataclass(frozen=True, slots=True)
class MissingCurriculumSplitDocument:
    document_id: str
    title: str
    canonical_doc_path: str
    legacy_page_start: int | None
    legacy_page_end: int | None
    reason: str = "title_not_found_in_structured_full"


@dataclass(frozen=True, slots=True)
class RetiredCurriculumSplitDocument:
    document_id: str
    title: str
    canonical_doc_path: str
    legacy_page_start: int | None
    legacy_page_end: int | None
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
    acl_groups: Sequence[str] = (),
) -> list[dict[str, object]]:
    selected_rows = [
        dict(row)
        for row in structured_rows
        if _row_belongs_to_page_range(
            row=row,
            page_start=manifest_document.page_start,
            page_end=manifest_document.page_end,
        )
        and _row_text(row)
    ]
    if not selected_rows:
        raise ValueError(
            f"split manifest document {manifest_document.document_id} does not match any structured rows"
        )
    transformed_rows = [
        _transform_split_row(
            row=row,
            document_id=manifest_document.document_id,
            version_id=version_id,
            source_pdf=source_pdf,
            source_uri=source_uri,
            acl_groups=tuple(acl_groups) or manifest_document.acl_groups,
        )
        for row in selected_rows
    ]
    summary_row = dict(transformed_rows[0])
    summary_row["chunk_id"] = "document-0000"
    summary_row["clean_text"] = "\n\n".join(
        text for text in (str(row.get("clean_text") or "").strip() for row in transformed_rows) if text
    )
    summary_row["page_start"] = manifest_document.page_start
    summary_row["page_end"] = manifest_document.page_end
    return [summary_row, *transformed_rows]


def load_legacy_curriculum_documents(docs_root: Path) -> tuple[LegacyCurriculumDocument, ...]:
    documents: list[LegacyCurriculumDocument] = []
    for path in sorted(Path(docs_root).glob("*.md")):
        metadata = _load_legacy_markdown_metadata(path)
        document_id = str(metadata.get("doc_id") or "").strip()
        title = str(metadata.get("title") or "").strip()
        if not document_id or not title:
            continue
        page_start, page_end = _parse_pages_span(str(metadata.get("pages_span") or "").strip())
        source_refs = _parse_source_refs(str(metadata.get("source_refs") or "[]"))
        documents.append(
            LegacyCurriculumDocument(
                document_id=document_id,
                title=title,
                status=str(metadata.get("status") or "active"),
                canonical_doc_path=_find_source_ref_uri(
                    source_refs=source_refs,
                    ref_type="canonical_doc_path",
                    default=f"rag-data/canonical/curriculum_plan/docs/{path.name}",
                ),
                legacy_page_start=page_start,
                legacy_page_end=page_end,
                ocr_doc_decision_uri=_find_source_ref_uri(source_refs=source_refs, ref_type="ocr_doc_decision_v1"),
            )
        )
    return tuple(documents)


def load_structured_rows(path: Path) -> list[dict[str, object]]:
    return [
        json.loads(line)
        for line in Path(path).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]


def derive_legacy_curriculum_source_uri(canonical_doc_path: str) -> str:
    normalized = canonical_doc_path.strip().lstrip("/")
    if not normalized:
        raise ValueError("canonical_doc_path is required")
    return f"campusrag://{normalized}"


def build_curriculum_split_manifest_seed(
    *,
    legacy_documents: Sequence[LegacyCurriculumDocument],
    structured_rows: Sequence[Mapping[str, object]],
    raw_asset_id: str,
    manifest_version: str = "curriculum_plan_split_manifest_seed_v1",
) -> CurriculumSplitManifestSeed:
    if not raw_asset_id:
        raise ValueError("raw_asset_id is required")
    title_to_page = _build_title_to_first_page(structured_rows)
    max_page = _resolve_max_page(structured_rows)
    matched: list[tuple[LegacyCurriculumDocument, int]] = []
    missing: list[MissingCurriculumSplitDocument] = []
    retired: list[RetiredCurriculumSplitDocument] = []
    for document in legacy_documents:
        retirement_reason = _resolve_legacy_document_retirement_reason(document)
        if retirement_reason is not None:
            retired.append(
                RetiredCurriculumSplitDocument(
                    document_id=document.document_id,
                    title=document.title,
                    canonical_doc_path=document.canonical_doc_path,
                    legacy_page_start=document.legacy_page_start,
                    legacy_page_end=document.legacy_page_end,
                    reason=retirement_reason,
                )
            )
            continue
        page_start = title_to_page.get(_normalize_split_title(document.title))
        if page_start is None:
            missing.append(
                MissingCurriculumSplitDocument(
                    document_id=document.document_id,
                    title=document.title,
                    canonical_doc_path=document.canonical_doc_path,
                    legacy_page_start=document.legacy_page_start,
                    legacy_page_end=document.legacy_page_end,
                )
            )
            continue
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
            corpus="curriculum_plan",
            raw_asset_id=raw_asset_id,
            documents=tuple(documents),
        ),
        missing_documents=tuple(missing),
        retired_documents=tuple(retired),
    )


def _load_legacy_markdown_metadata(path: Path) -> dict[str, str]:
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


def _build_title_to_first_page(structured_rows: Sequence[Mapping[str, object]]) -> dict[str, int]:
    title_to_page: dict[str, int] = {}
    for row in structured_rows:
        page_start = row.get("page_start")
        if not isinstance(page_start, int):
            continue
        text = _row_text(row)
        if not text:
            continue
        normalized_title = _normalize_split_title(text)
        if not normalized_title or normalized_title in title_to_page:
            continue
        title_to_page[normalized_title] = page_start
    return title_to_page


def _normalize_split_title(value: str) -> str:
    normalized = unicodedata.normalize("NFKC", value).strip()
    if not normalized:
        return ""
    normalized = " ".join(normalized.split())
    normalized = _TRAILING_EDITION_SUFFIX_PATTERN.sub("", normalized).strip()
    return normalized


def _resolve_legacy_document_retirement_reason(document: LegacyCurriculumDocument) -> str | None:
    return _LEGACY_RETIRED_DOCUMENT_REASONS.get(document.document_id)


def _resolve_max_page(structured_rows: Sequence[Mapping[str, object]]) -> int:
    max_page = max(
        int(row["page_end"])
        for row in structured_rows
        if isinstance(row.get("page_end"), int)
    )
    if max_page <= 0:
        raise ValueError("structured_rows must contain positive page_end values")
    return max_page


def _row_text(row: Mapping[str, object]) -> str:
    for field_name in ("clean_text", "text_normalized", "text_raw"):
        value = row.get(field_name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _row_belongs_to_page_range(*, row: Mapping[str, object], page_start: int, page_end: int) -> bool:
    row_page_start = row.get("page_start")
    row_page_end = row.get("page_end")
    if not isinstance(row_page_start, int) or not isinstance(row_page_end, int):
        return False
    return row_page_start >= page_start and row_page_end <= page_end


def _transform_split_row(
    *,
    row: Mapping[str, object],
    document_id: str,
    version_id: str,
    source_pdf: str,
    source_uri: str,
    acl_groups: tuple[str, ...],
) -> dict[str, object]:
    clean_text = _row_text(row)
    if not clean_text:
        raise ValueError("split-manifest source row is missing normalized text")
    page_start = int(row["page_start"])
    page_end = int(row["page_end"])
    return {
        "doc_id": document_id,
        "version_id": version_id,
        "chunk_id": f"page-{page_start:04d}",
        "clean_text": clean_text,
        "source_pdf": source_pdf,
        "source_url": source_uri,
        "source_md": None,
        "source": {"id": source_uri},
        "page_start": page_start,
        "page_end": page_end,
        "acl": {"level": "public", "allow_groups": list(acl_groups)},
    }
