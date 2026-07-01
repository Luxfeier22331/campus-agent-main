from __future__ import annotations

import hashlib
import json
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION

from campus_ingestion_core.artifacts import LAYOUT_ELEMENTS_FILENAME, PROVIDER_RESPONSE_FILENAME
from campus_ingestion_core.campus_agent_ingestion_support import (
    DocumentImportInput,
    ObjectStoreWriter,
    apply_authorization_projection_metadata,
    load_metadata_from_bytes,
)
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.object_store import (
    build_source_model_slug,
    build_source_ocr_artifact_key,
    build_source_truth_artifact_key,
    infer_year_label,
)
from campus_ingestion_core.online_ocr_evidence import extract_online_ocr_text
from campus_ingestion_core.raw_ingestion_online_ocr import OnlineOcrProviderResult
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.split_manifest import SplitManifest, SplitManifestDocument
from campus_ingestion_core.split_manifest_canonical_markdown import (
    build_split_document_canonical_markdown,
)

SPLIT_MANIFEST_LAYOUT_ELEMENTS_SCHEMA_VERSION = "split_manifest_layout_elements_v1"
SplitManifestTextNormalizer = Callable[[dict[str, object], str, str], str]
SplitManifestSkipPredicate = Callable[[dict[str, object]], bool]


@dataclass(frozen=True, slots=True)
class SplitManifestRowPolicy:
    normalize_clean_text: SplitManifestTextNormalizer
    should_skip_row: SplitManifestSkipPredicate


def _build_split_manifest_documents(
    *,
    raw_asset_record: RawAssetRecord,
    provider_result: OnlineOcrProviderResult,
    split_manifest: SplitManifest,
    writer: ObjectStoreWriter,
    object_store: ObjectStoreSettings,
    default_visibility_scope: str | None,
    corpus: str,
    collection: str,
    ocr_provider: str,
    ocr_model: str,
    structured_rows: list[dict[str, object]] | None = None,
    artifact_keys: tuple[str, str] | None = None,
    row_policy: SplitManifestRowPolicy | None = None,
) -> list[DocumentImportInput]:
    if structured_rows is not None:
        resolved_structured_rows = structured_rows
    else:
        resolved_structured_rows = _normalize_split_manifest_provider_result(
            corpus=corpus,
            collection=collection,
            source_pdf=raw_asset_record.source_filename,
            provider_jsonl_bytes=provider_result.provider_result_bytes,
            ocr_provider=ocr_provider,
            ocr_model=ocr_model,
            source_artifact_id=raw_asset_record.raw_asset_id,
        )
    if artifact_keys is not None:
        provider_response_key, layout_elements_key = artifact_keys
    else:
        layout_elements_bytes = _serialize_rows(resolved_structured_rows)
        provider_response_key, layout_elements_key = _write_processed_asset_artifacts(
            writer=writer,
            object_store=object_store,
            corpus=corpus,
            raw_asset_id=raw_asset_record.raw_asset_id,
            raw_version_id=raw_asset_record.raw_version_id,
            source_filename=raw_asset_record.source_filename,
            ocr_model=ocr_model,
            provider_response_bytes=provider_result.provider_result_bytes,
            layout_elements_bytes=layout_elements_bytes,
        )
    return [
        _build_split_manifest_document_input(
            raw_asset_record=raw_asset_record,
            manifest_version=split_manifest.manifest_version,
            manifest_document=manifest_document,
            structured_rows=resolved_structured_rows,
            provider_response_key=provider_response_key,
            layout_elements_key=layout_elements_key,
            corpus=corpus,
            collection=collection,
            default_visibility_scope=default_visibility_scope,
            row_policy=row_policy,
        )
        for manifest_document in split_manifest.documents
    ]


def _write_processed_asset_artifacts(
    *,
    writer: ObjectStoreWriter,
    object_store: ObjectStoreSettings,
    corpus: str,
    raw_asset_id: str,
    raw_version_id: str,
    source_filename: str,
    ocr_model: str,
    provider_response_bytes: bytes,
    layout_elements_bytes: bytes,
) -> tuple[str, str]:
    year = infer_year_label(source_filename)
    provider_response_key = build_source_ocr_artifact_key(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        filename=PROVIDER_RESPONSE_FILENAME,
        model_slug=build_source_model_slug(ocr_model),
        year=year,
    )
    layout_elements_key = build_source_truth_artifact_key(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        filename=LAYOUT_ELEMENTS_FILENAME,
        year=year,
    )
    writer.put_bytes(
        bucket=object_store.bucket_source,
        key=provider_response_key,
        data=provider_response_bytes,
        content_type="application/x-ndjson",
    )
    writer.put_bytes(
        bucket=object_store.bucket_source,
        key=layout_elements_key,
        data=layout_elements_bytes,
        content_type="application/x-ndjson",
    )
    return provider_response_key, layout_elements_key


def _build_split_manifest_document_input(
    *,
    raw_asset_record: RawAssetRecord,
    manifest_version: str,
    manifest_document: SplitManifestDocument,
    structured_rows: list[dict[str, object]],
    provider_response_key: str,
    layout_elements_key: str,
    corpus: str,
    collection: str,
    default_campus_scope: str | None = None,
    default_visibility_scope: str | None = None,
    row_policy: SplitManifestRowPolicy | None = None,
) -> DocumentImportInput:
    resolved_default_scope = default_campus_scope or default_visibility_scope
    version_id = _build_split_version_id(
        raw_version_id=raw_asset_record.raw_version_id,
        manifest_version=manifest_version,
        manifest_document=manifest_document,
    )
    source_uri = _build_manifest_document_source_uri(
        corpus=corpus,
        raw_asset_id=raw_asset_record.raw_asset_id,
        raw_version_id=raw_asset_record.raw_version_id,
        page_start=manifest_document.page_start,
        page_end=manifest_document.page_end,
    )
    split_rows = _slice_structured_rows_for_manifest_document(
        structured_rows=structured_rows,
        manifest_document=manifest_document,
        document_id=manifest_document.document_id,
        version_id=version_id,
        source_pdf=raw_asset_record.source_filename,
        source_uri=source_uri,
        row_policy=row_policy,
    )
    document_units_bytes = _serialize_rows(split_rows)
    canonical_markdown_bytes = build_split_document_canonical_markdown(
        manifest_document=manifest_document,
        split_rows=split_rows,
    )
    metadata = load_metadata_from_bytes(document_units_bytes)
    metadata["title"] = manifest_document.title
    apply_authorization_projection_metadata(
        metadata,
        entitlement_groups=manifest_document.resolved_entitlement_groups(),
        visibility_scope=manifest_document.resolved_visibility_scope(default_visibility_scope),
        visibility_level=manifest_document.resolved_visibility_level(),
    )
    metadata["status"] = manifest_document.status
    return DocumentImportInput(
        source_label=f"{raw_asset_record.object_key}#{manifest_document.document_id}",
        document_units_bytes=document_units_bytes,
        provider_response_bytes=None,
        canonical_markdown_bytes=canonical_markdown_bytes,
        metadata=metadata,
        import_source="raw_online_ocr",
        revision_track="source-faithful",
        source_channel="pdf_ocr",
        is_current=True,
        corpus=corpus,
        collection=collection,
        visibility_scope=manifest_document.resolved_visibility_scope(resolved_default_scope),
        status=manifest_document.status,
        raw_path=None,
        raw_source_uri=raw_asset_record.raw_source_uri,
        raw_asset_id=raw_asset_record.raw_asset_id,
        raw_version_id=raw_asset_record.raw_version_id,
        provider_response_object_key=provider_response_key,
        additional_processed_object_keys=(layout_elements_key,),
        title=manifest_document.title,
    )


def _build_split_version_id(
    *,
    raw_version_id: str,
    manifest_version: str,
    manifest_document: SplitManifestDocument,
) -> str:
    digest = hashlib.sha256(
        "|".join(
            [
                raw_version_id,
                manifest_version,
                manifest_document.document_id,
                str(manifest_document.page_start),
                str(manifest_document.page_end),
            ]
        ).encode("utf-8")
    ).hexdigest()[:12]
    return f"{raw_version_id}:split:{_split_document_slug(manifest_document.document_id)}:{digest}"


def _split_document_slug(document_id: str) -> str:
    parts = [part.strip() for part in document_id.split(":") if part.strip()]
    if not parts:
        raise ValueError("document_id is required")
    return parts[-1]


def _normalize_split_manifest_provider_result(
    *,
    corpus: str,
    collection: str,
    source_pdf: str,
    provider_jsonl_bytes: bytes,
    ocr_provider: str,
    ocr_model: str,
    source_artifact_id: str,
) -> list[dict[str, object]]:
    provider_jsonl = provider_jsonl_bytes.decode("utf-8")
    raw_lines = [line.strip() for line in provider_jsonl.splitlines() if line.strip()]
    if not raw_lines:
        raise ValueError("provider result is empty")

    rows: list[dict[str, object]] = []
    expected_page_id = 1
    for line_index, line in enumerate(raw_lines, start=1):
        try:
            payload = json.loads(line)
        except json.JSONDecodeError as exc:
            raise ValueError(f"provider result line {line_index} is not valid JSON") from exc
        if not isinstance(payload, dict):
            raise ValueError(f"provider result line {line_index} must be a JSON object")
        provider_page_id = _resolve_provider_page_id(payload, expected_page_id)
        if provider_page_id != expected_page_id:
            raise ValueError("provider pages must be contiguous and 1-based")
        result_payload = payload.get("result")
        if not isinstance(result_payload, dict):
            raise ValueError(f"provider page {provider_page_id} is missing result payload")
        page_text = _normalize_source_text(extract_online_ocr_text(result_payload))
        if not page_text:
            raise ValueError(f"provider page {provider_page_id} produced no source text")
        rows.append(
            {
                "schema_version": SPLIT_MANIFEST_LAYOUT_ELEMENTS_SCHEMA_VERSION,
                "corpus": corpus,
                "collection": collection,
                "source_artifact_id": source_artifact_id,
                "source_pdf": source_pdf,
                "page_start": provider_page_id,
                "page_end": provider_page_id,
                "row_id": f"page-{provider_page_id:04d}",
                "row_index": provider_page_id,
                "ocr_provider": ocr_provider,
                "ocr_model": ocr_model,
                "provider_page_id": provider_page_id,
                "provider_payload_ref": f"line:{line_index}",
                "row_type": "paragraph",
                "text_raw": page_text,
                "text_normalized": page_text,
                "is_blank": False,
            }
        )
        expected_page_id += 1
    return rows


def _build_manifest_document_source_uri(
    *,
    corpus: str,
    raw_asset_id: str,
    raw_version_id: str,
    page_start: int,
    page_end: int,
) -> str:
    raw_asset_slug = _split_document_slug(raw_asset_id)
    raw_version_path = "/".join(part.strip() for part in raw_version_id.split(":") if part.strip())
    return f"campus-agent://source/{corpus}/{raw_asset_slug}/{raw_version_path}/capture/pages/{page_start}-{page_end}"


def _slice_structured_rows_for_manifest_document(
    *,
    structured_rows: list[dict[str, object]],
    manifest_document: SplitManifestDocument,
    document_id: str,
    version_id: str,
    source_pdf: str,
    source_uri: str,
    row_policy: SplitManifestRowPolicy | None = None,
) -> list[dict[str, object]]:
    selected_rows = [
        row
        for row in structured_rows
        if _row_belongs_to_page_range(
            row=row,
            page_start=manifest_document.page_start,
            page_end=manifest_document.page_end,
        )
    ]
    if not selected_rows:
        raise ValueError(
            f"split manifest document {manifest_document.document_id} does not match any OCR pages"
        )

    transformed_rows: list[dict[str, object]] = []
    last_emitted_source_row: dict[str, object] | None = None
    resolved_row_policy = row_policy or DEFAULT_SPLIT_MANIFEST_ROW_POLICY
    for row in selected_rows:
        if resolved_row_policy.should_skip_row(row):
            continue
        transformed = _transform_split_row(
            row=row,
            document_id=document_id,
            manifest_title=manifest_document.title,
            version_id=version_id,
            source_pdf=source_pdf,
            source_uri=source_uri,
            entitlement_groups=manifest_document.resolved_entitlement_groups(),
            row_policy=resolved_row_policy,
        )
        if transformed is None:
            continue
        if _should_merge_split_manifest_row(
            previous_source_row=last_emitted_source_row,
            current_source_row=row,
            previous_transformed_row=transformed_rows[-1] if transformed_rows else None,
            current_transformed_row=transformed,
        ):
            _merge_split_manifest_row(
                target_row=transformed_rows[-1],
                incoming_row=transformed,
            )
            last_emitted_source_row = row
            continue
        transformed_rows.append(transformed)
        last_emitted_source_row = row
    if not transformed_rows:
        raise ValueError(
            f"split manifest document {manifest_document.document_id} does not contain any indexable OCR rows"
        )
    return transformed_rows


def _transform_split_row(
    *,
    row: dict[str, object],
    document_id: str,
    manifest_title: str,
    version_id: str,
    source_pdf: str,
    source_uri: str,
    entitlement_groups: tuple[str, ...],
    row_policy: SplitManifestRowPolicy,
) -> dict[str, object] | None:
    page_start = int(row["page_start"])
    page_end = int(row["page_end"])
    clean_text = _split_manifest_row_text(row)
    if not clean_text:
        return None
    clean_text = row_policy.normalize_clean_text(row, clean_text, manifest_title)
    source_chunk_id = _normalize_optional_text(row.get("row_id")) or f"page-{page_start:04d}"
    return {
        "doc_id": document_id,
        "version_id": version_id,
        "chunk_id": source_chunk_id,
        "row_id": _normalize_optional_text(row.get("row_id")) or source_chunk_id,
        "row_type": _normalize_optional_text(row.get("row_type")) or "paragraph",
        "heading_level": row.get("heading_level"),
        "row_index": row.get("row_index"),
        "reading_order": row.get("reading_order"),
        "section_hint": _normalize_optional_text(row.get("section_hint")),
        "clean_text": clean_text,
        "html": row.get("html"),
        "table_cells": row.get("table_cells"),
        "owner_row_id": row.get("owner_row_id"),
        "relation_type": row.get("relation_type"),
        "continuation_group_id": row.get("continuation_group_id"),
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


def _normalize_default_split_manifest_clean_text(
    row: dict[str, object],
    clean_text: str,
    manifest_title: str,
) -> str:
    del row, manifest_title
    return clean_text


def _should_skip_split_manifest_row(row: dict[str, object]) -> bool:
    row_type = str(row.get("row_type") or "")
    if _is_table_continuation(row_type=row_type, row=row):
        return False
    if bool(row.get("is_repeated_candidate")) and not _is_structural_heading(row):
        return True
    return row_type in {"header", "footer", "page_number"}


def _is_table_continuation(*, row_type: str, row: dict[str, object]) -> bool:
    return row_type == "table" and str(row.get("relation_type") or "") == "table_continuation"


def _is_structural_heading(row: dict[str, object]) -> bool:
    if str(row.get("row_type") or "") != "heading":
        return False
    return bool(str(row.get("section_hint") or "").strip())


def _should_merge_split_manifest_row(
    *,
    previous_source_row: dict[str, object] | None,
    current_source_row: dict[str, object],
    previous_transformed_row: dict[str, object] | None,
    current_transformed_row: dict[str, object],
) -> bool:
    if previous_source_row is None or previous_transformed_row is None:
        return False
    if not bool(current_source_row.get("continues_from_previous_page")):
        return False
    if not bool(previous_source_row.get("continues_to_next_page")):
        return False
    current_row_type = str(current_source_row.get("row_type") or "")
    if current_row_type not in {"paragraph", "list_item"}:
        return False
    return str(previous_transformed_row.get("row_type") or "") == current_row_type


def _merge_split_manifest_row(
    *,
    target_row: dict[str, object],
    incoming_row: dict[str, object],
) -> None:
    target_text = str(target_row.get("clean_text") or "").strip()
    incoming_text = str(incoming_row.get("clean_text") or "").strip()
    target_row["clean_text"] = (
        f"{target_text}{_text_joiner(target_text, incoming_text)}{incoming_text}"
    )
    target_row["page_end"] = max(
        int(target_row.get("page_end") or 0),
        int(incoming_row.get("page_end") or 0),
    )


def _text_joiner(previous: str, current: str) -> str:
    if not previous or not current:
        return ""
    if (
        previous[-1].isascii()
        and previous[-1].isalnum()
        and current[0].isascii()
        and current[0].isalnum()
    ):
        return " "
    return ""


def _row_belongs_to_page_range(*, row: dict[str, object], page_start: int, page_end: int) -> bool:
    row_page_start = row.get("page_start")
    row_page_end = row.get("page_end")
    if not isinstance(row_page_start, int) or not isinstance(row_page_end, int):
        return False
    return row_page_start >= page_start and row_page_end <= page_end


def _serialize_rows(rows: list[dict[str, object]]) -> bytes:
    return ("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n").encode("utf-8")


def _load_layout_elements_rows(file_bytes: bytes) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for line_number, line in enumerate(file_bytes.decode("utf-8").splitlines(), start=1):
        normalized = line.strip()
        if not normalized:
            continue
        payload = json.loads(normalized)
        if not isinstance(payload, dict):
            raise ValueError(f"structured rows line {line_number} must be a JSON object")
        rows.append(payload)
    return rows


def slugify_filename(filename: str) -> str:
    stem = Path(filename).stem.strip().lower()
    slug = "".join(ch if ch.isalnum() else "-" for ch in stem).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "document"


def _resolve_provider_page_id(payload: dict[str, object], expected_page_id: int) -> int:
    for key in ("pageNumber", "page_number", "providerPageId", "provider_page_id"):
        value = payload.get(key)
        if value is not None:
            return int(value)
    return expected_page_id


def _normalize_source_text(text: str) -> str:
    normalized = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [" ".join(line.split()).strip() for line in normalized.split("\n")]
    return "\n".join(line for line in lines if line)


def _split_manifest_row_text(row: dict[str, object]) -> str:
    for field_name in ("text_normalized", "text_raw", "html"):
        value = row.get(field_name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _normalize_optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


DEFAULT_SPLIT_MANIFEST_ROW_POLICY = SplitManifestRowPolicy(
    normalize_clean_text=_normalize_default_split_manifest_clean_text,
    should_skip_row=_should_skip_split_manifest_row,
)
