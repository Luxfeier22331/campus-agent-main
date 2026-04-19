from __future__ import annotations

from campus_ingestion_core.file_asset_contract import ExtractionOutcome
from campus_ingestion_core.file_asset_legacy_office import extract_legacy_office_text_blocks
from campus_ingestion_core.file_asset_ooxml import (
    extract_docx_text_blocks,
    extract_xlsx_text_blocks,
)


def extract_text_extractable_file_asset(
    file_bytes: bytes,
    *,
    filename: str,
    media_type: str | None = None,
    source_object_key: str | None = None,
) -> ExtractionOutcome:
    extension = filename.rsplit(".", 1)[-1].strip().lower() if "." in filename else ""
    if extension == "docx":
        return extract_docx_text_blocks(
            file_bytes,
            filename=filename,
            media_type=media_type,
            source_object_key=source_object_key,
        )
    if extension == "xlsx":
        return extract_xlsx_text_blocks(
            file_bytes,
            filename=filename,
            media_type=media_type,
            source_object_key=source_object_key,
        )
    if extension == "xls":
        return extract_legacy_office_text_blocks(
            file_bytes,
            filename=filename,
            media_type=media_type,
            source_object_key=source_object_key,
        )
    raise ValueError(f"unsupported text_extractable asset extension: {filename}")


__all__ = ["extract_text_extractable_file_asset"]
