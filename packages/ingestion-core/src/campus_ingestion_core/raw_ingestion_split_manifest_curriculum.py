from __future__ import annotations

import re
from collections.abc import Sequence

from campus_ingestion_core.campus_agent_ingestion_support import DocumentImportInput
from campus_ingestion_core.curriculum_chunk_units_shared import (
    _looks_like_curriculum_page_marker_line,
)
from campus_ingestion_core.curriculum_course_facts_projection import (
    build_curriculum_course_facts_scope_refresh_documents,
)
from campus_ingestion_core.curriculum_program_family_facts_projection import (
    build_curriculum_program_family_facts_scope_refresh_documents,
)
from campus_ingestion_core.curriculum_program_semester_facts_projection import (
    build_curriculum_program_semester_facts_scope_refresh_documents,
)
from campus_ingestion_core.curriculum_title_normalization import (
    canonicalize_curriculum_manifest_heading,
)
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.raw_ingestion_split_manifest import (
    SplitManifestRowPolicy,
    _split_manifest_row_text,
)
from campus_ingestion_core.split_manifest import SplitManifestDocument

_CURRICULUM_STRUCTURAL_HEADING_RE = re.compile(
    r"^(?:[一二三四五六七八九十]+、|[（(][一二三四五六七八九十]+[)）]|\d+[\.．、])"
)


def build_curriculum_projection_documents(
    *,
    raw_asset_record: RawAssetRecord,
    source_pdf: str,
    split_manifest_documents: Sequence[SplitManifestDocument],
    structured_rows: list[dict[str, object]],
    provider_response_key: str,
    layout_elements_key: str,
    import_source: str,
) -> list[DocumentImportInput]:
    documents: list[DocumentImportInput] = []
    documents.extend(
        build_curriculum_course_facts_scope_refresh_documents(
            raw_asset_record=raw_asset_record,
            source_pdf=source_pdf,
            split_manifest_documents=split_manifest_documents,
            structured_rows=structured_rows,
            provider_response_key=provider_response_key,
            layout_elements_key=layout_elements_key,
            import_source=import_source,
        )
    )
    documents.extend(
        build_curriculum_program_family_facts_scope_refresh_documents(
            raw_asset_record=raw_asset_record,
            source_pdf=source_pdf,
            split_manifest_documents=split_manifest_documents,
            import_source=import_source,
        )
    )
    documents.extend(
        build_curriculum_program_semester_facts_scope_refresh_documents(
            raw_asset_record=raw_asset_record,
            source_pdf=source_pdf,
            split_manifest_documents=split_manifest_documents,
            structured_rows=structured_rows,
            provider_response_key=provider_response_key,
            layout_elements_key=layout_elements_key,
            import_source=import_source,
        )
    )
    return documents


def _normalize_curriculum_split_manifest_clean_text(
    row: dict[str, object],
    clean_text: str,
    manifest_title: str,
) -> str:
    return canonicalize_curriculum_manifest_heading(
        row=row,
        clean_text=clean_text,
        manifest_title=manifest_title,
    )


def _should_skip_curriculum_split_manifest_row(row: dict[str, object]) -> bool:
    row_type = str(row.get("row_type") or "")
    if _is_curriculum_table_continuation(row_type=row_type, row=row):
        return False
    if bool(row.get("is_repeated_candidate")) and not _is_curriculum_structural_heading(row):
        return True
    if row_type in {"header", "footer", "page_number"}:
        return True
    return bool(
        row_type in {"paragraph", "list_item", "note"}
        and _looks_like_curriculum_page_marker_line(_split_manifest_row_text(row))
    )


def _is_curriculum_table_continuation(*, row_type: str, row: dict[str, object]) -> bool:
    return row_type == "table" and str(row.get("relation_type") or "") == "table_continuation"


def _is_curriculum_structural_heading(row: dict[str, object]) -> bool:
    if str(row.get("row_type") or "") != "heading":
        return False
    if str(row.get("section_hint") or "").strip():
        return True
    return bool(_CURRICULUM_STRUCTURAL_HEADING_RE.match(_split_manifest_row_text(row).strip()))


CURRICULUM_SPLIT_MANIFEST_ROW_POLICY = SplitManifestRowPolicy(
    normalize_clean_text=_normalize_curriculum_split_manifest_clean_text,
    should_skip_row=_should_skip_curriculum_split_manifest_row,
)
