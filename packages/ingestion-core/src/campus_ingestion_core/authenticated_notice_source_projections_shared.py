from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Protocol

from campus_ingestion_core.authenticated_notice_defaults import (
    DEFAULT_AUTHENTICATED_NOTICE_COLLECTION,
    DEFAULT_AUTHENTICATED_NOTICE_CORPUS,
)
from campus_ingestion_core.authenticated_notice_source_truth_blocks import (
    build_authenticated_notice_notice_document_artifacts,
)
from campus_ingestion_core.collection_config import resolve_collection_truth_config
from campus_ingestion_core.file_asset_routing import (
    MINERU_PROVIDER,
    adapt_mineru_archive_to_canonical_provider_payload,
)
from campus_ingestion_core.models import DocumentRegistryRecord
from campus_ingestion_core.object_store import is_source_object_key
from campus_ingestion_core.raw_ingestion_online_ocr import (
    ONLINE_OCR_PROVIDER_ASYNC_JOBS,
    OnlineOcrClient,
)

AUTHENTICATED_NOTICE_SOURCE_PROJECTIONS_SCHEMA_VERSION = (
    "authenticated_notice_source_projections_v1"
)
DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_IMPORT_SOURCE = (
    "authenticated_notice_source_projection"
)
DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_PARSER_VERSION = (
    "authenticated_notice_source_projection_v1"
)
AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_REQUIRED_DOCUMENT = "required_document"
AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_CONDITIONAL_ON_EXTRACTED_TEXT = (
    "conditional_on_extracted_text"
)
AUTHENTICATED_NOTICE_ATTACHMENT_POLICY_MULTIMODAL_PROCESSING = "multimodal_processing"
AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_MATERIALIZED_DOCUMENT = "materialized_document"
AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_NO_EXTRACTABLE_TEXT = "no_extractable_text"
AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_MULTIMODAL_PROCESSING_REQUIRED = (
    "multimodal_processing_required"
)
AUTHENTICATED_NOTICE_ATTACHMENT_OUTCOME_UNSUPPORTED_BINARY = "unsupported_binary"
AUTHENTICATED_NOTICE_ATTACHMENT_REVIEW_REASON_SPATIAL_VISUAL_ASSET = "spatial_visual_asset"
AUTHENTICATED_NOTICE_ATTACHMENT_REVIEW_REASON_OPERATIONAL_SCHEDULE_GUIDE_IMAGE = (
    "operational_schedule_guide_image"
)
_NORMALIZED_NOTICE_PROVIDER_SUFFIX = "provider/bundle-import-v1/normalized-notice.json"

__all__ = ("ONLINE_OCR_PROVIDER_ASYNC_JOBS",)


class AuthenticatedNoticeProjectionObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeAttachmentProjection:
    projection_name: str
    target_corpus: str
    target_collection: str
    projection_family: str
    replay_from_source_truth: bool
    derived_from: str


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeSourceProjectionsConfig:
    source_corpus: str
    source_collection: str
    derived_document_fields: tuple[str, ...]
    attachment_projection: AuthenticatedNoticeAttachmentProjection
    attachment_role_map: dict[str, str]
    attachment_kind_map: dict[str, str]
    extraction_policy_version: str
    text_extractable_extensions: tuple[str, ...]
    ocr_required_mime_types: tuple[str, ...]
    ocr_required_extensions: tuple[str, ...]
    reference_only_storage_providers: tuple[str, ...]
    reference_only_ingest_statuses: tuple[str, ...]
    reference_only_url_substrings: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeSourceProjectionRequest:
    corpus: str = DEFAULT_AUTHENTICATED_NOTICE_CORPUS
    collection: str = DEFAULT_AUTHENTICATED_NOTICE_COLLECTION
    source_projections_path: Path | None = None
    default_visibility_scope: str | None = None
    notice_ids: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.source_projections_path is not None:
            object.__setattr__(self, "source_projections_path", Path(self.source_projections_path))
        object.__setattr__(self, "notice_ids", _normalize_notice_ids(self.notice_ids))


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeSourceProjectionReport:
    corpus: str
    collection: str
    parent_notice_count: int
    attachment_ref_count: int
    projected_attachment_count: int
    text_extractable_attachment_count: int
    ocr_attachment_count: int
    ocr_no_text_attachment_count: int
    reference_only_attachment_count: int
    multimodal_processing_attachment_count: int
    created_document_ids: tuple[str, ...]
    updated_document_ids: tuple[str, ...]
    skipped_document_ids: tuple[str, ...]
    errors: tuple[str, ...]
    unsupported_binary_attachment_count: int = 0


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeAttachmentProjectionOutcome:
    attachment_ref_id: str
    classification: str
    materialization_policy: str
    outcome: str
    document_id: str
    attachment_object_key: str
    attachment_content_sha256: str
    provider_response_bytes: bytes | None = None
    review_reason: str | None = None


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeAttachmentClassificationResult:
    classification: str
    review_reason: str | None = None


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeAttachmentProjectionResult:
    document: object | None
    outcome: AuthenticatedNoticeAttachmentProjectionOutcome


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeProjectedNotice:
    documents: tuple[object, ...]
    attachment_outcomes: tuple[AuthenticatedNoticeAttachmentProjectionOutcome, ...]
    reference_only_attachment_count: int = 0
    unsupported_binary_attachment_count: int = 0


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeOcrProviderRuntime:
    client: OnlineOcrClient
    provider: str


@dataclass(frozen=True, slots=True)
class AuthenticatedNoticeOcrRuntime:
    client: OnlineOcrClient
    provider: str
    fallback_runtimes: tuple[AuthenticatedNoticeOcrProviderRuntime, ...] = ()


@dataclass(frozen=True, slots=True)
class _AuthenticatedNoticeParentSourceTruth:
    record: DocumentRegistryRecord
    manifest: dict[str, Any]
    content_blocks: tuple[dict[str, Any], ...]
    attachment_refs: tuple[dict[str, Any], ...]
    source_keys: tuple[str, ...]
    notice_manifest_key: str
    content_blocks_key: str
    attachment_refs_key: str


def read_authenticated_notice_source_projections_config_path(source: dict[str, str]) -> Path:
    value = (source.get("AUTHENTICATED_NOTICE_SOURCE_PROJECTIONS_PATH") or "").strip()
    if value:
        return Path(value)
    config = resolve_collection_truth_config(
        DEFAULT_AUTHENTICATED_NOTICE_CORPUS, DEFAULT_AUTHENTICATED_NOTICE_COLLECTION
    )
    if config.source_projections_path is None:
        raise ValueError("internal_notice source-projections.v1.json is required")
    return config.source_projections_path


def load_authenticated_notice_source_projections_config(
    path: Path,
) -> AuthenticatedNoticeSourceProjectionsConfig:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if (
        str(payload.get("schema_version") or "")
        != AUTHENTICATED_NOTICE_SOURCE_PROJECTIONS_SCHEMA_VERSION
    ):
        raise ValueError(
            "unsupported authenticated notice source projections schema_version: "
            f"{payload.get('schema_version')!r}"
        )
    attachment_projection_payload = dict(payload.get("attachment_projection") or {})
    return AuthenticatedNoticeSourceProjectionsConfig(
        source_corpus=str(payload.get("source_corpus") or ""),
        source_collection=str(payload.get("source_collection") or ""),
        derived_document_fields=tuple(
            str(item).strip()
            for item in list(payload.get("derived_document_fields") or [])
            if str(item).strip()
        ),
        attachment_projection=AuthenticatedNoticeAttachmentProjection(
            projection_name=str(attachment_projection_payload.get("projection_name") or ""),
            target_corpus=str(attachment_projection_payload.get("target_corpus") or ""),
            target_collection=str(attachment_projection_payload.get("target_collection") or ""),
            projection_family=str(attachment_projection_payload.get("projection_family") or ""),
            replay_from_source_truth=bool(
                attachment_projection_payload.get("replay_from_source_truth", False)
            ),
            derived_from=str(attachment_projection_payload.get("derived_from") or ""),
        ),
        attachment_role_map={
            str(key).strip(): str(value).strip()
            for key, value in dict(payload.get("attachment_role_map") or {}).items()
            if str(key).strip() and str(value).strip()
        },
        attachment_kind_map={
            str(key).strip(): str(value).strip()
            for key, value in dict(payload.get("attachment_kind_map") or {}).items()
            if str(key).strip() and str(value).strip()
        },
        extraction_policy_version=str(payload.get("extraction_policy_version") or ""),
        text_extractable_extensions=tuple(
            _normalize_extension(item)
            for item in list(payload.get("text_extractable_extensions") or [])
            if _normalize_extension(item) is not None
        ),
        ocr_required_mime_types=tuple(
            str(item).strip().lower()
            for item in list(payload.get("ocr_required_mime_types") or [])
            if str(item).strip()
        ),
        ocr_required_extensions=tuple(
            _normalize_extension(item)
            for item in list(payload.get("ocr_required_extensions") or [])
            if _normalize_extension(item) is not None
        ),
        reference_only_storage_providers=tuple(
            str(item).strip().lower()
            for item in list(payload.get("reference_only_storage_providers") or [])
            if str(item).strip()
        ),
        reference_only_ingest_statuses=tuple(
            str(item).strip().lower()
            for item in list(payload.get("reference_only_ingest_statuses") or [])
            if str(item).strip()
        ),
        reference_only_url_substrings=tuple(
            str(item).strip().lower()
            for item in list(payload.get("reference_only_url_substrings") or [])
            if str(item).strip()
        ),
    )


def _build_parent_notice_document(
    *,
    parent_source_truth: _AuthenticatedNoticeParentSourceTruth,
    runtime_profile,
):
    from campus_ingestion_core.campusrag_ingestion_support import (
        DocumentImportInput,
        apply_authorization_projection_metadata,
    )

    manifest = parent_source_truth.manifest
    title = str(
        manifest.get("notice_title_normalized")
        or manifest.get("notice_title_raw")
        or parent_source_truth.record.document_id
    )
    source_uri = str(manifest.get("source_notice_link") or parent_source_truth.record.source_uri)
    canonical_markdown_bytes, document_units_bytes = (
        build_authenticated_notice_notice_document_artifacts(
            document_id=parent_source_truth.record.document_id,
            version_id=parent_source_truth.record.version_id,
            source_uri=source_uri,
            title=title,
            content_blocks=parent_source_truth.content_blocks,
        )
    )
    metadata: dict[str, object] = {
        "document_id": parent_source_truth.record.document_id,
        "version_id": parent_source_truth.record.version_id,
        "source_url": source_uri,
        "source_id": parent_source_truth.record.document_id,
        "raw_page_start": None,
        "raw_page_end": None,
    }
    apply_authorization_projection_metadata(
        metadata,
        entitlement_groups=parent_source_truth.record.entitlement_groups,
        visibility_scope=parent_source_truth.record.visibility_scope,
        visibility_level=parent_source_truth.record.visibility_level,
        policy_projection_version=parent_source_truth.record.policy_projection_version,
    )
    metadata["status"] = parent_source_truth.record.status
    return DocumentImportInput(
        source_label=f"{parent_source_truth.record.document_id}#primary",
        document_units_bytes=document_units_bytes,
        provider_response_bytes=None,
        canonical_markdown_bytes=canonical_markdown_bytes,
        metadata=metadata,
        import_source=DEFAULT_AUTHENTICATED_NOTICE_SOURCE_PROJECTION_IMPORT_SOURCE,
        revision_track=parent_source_truth.record.revision_track,
        source_channel=parent_source_truth.record.source_channel,
        is_current=parent_source_truth.record.is_current,
        corpus=parent_source_truth.record.corpus,
        collection=parent_source_truth.record.collection,
        visibility_scope=parent_source_truth.record.visibility_scope,
        status=parent_source_truth.record.status,
        raw_source_uri=source_uri,
        raw_asset_id=str(manifest.get("raw_asset_id") or ""),
        raw_version_id=str(manifest.get("raw_version_id") or ""),
        provider_response_object_key=parent_source_truth.record.provider_response_object_key,
        additional_processed_object_keys=tuple(
            key
            for key in parent_source_truth.source_keys
            if key != parent_source_truth.record.provider_response_object_key
        ),
        title=title,
        year=_derive_notice_year(manifest=manifest, runtime_profile=runtime_profile),
    )


def _resolve_embedding_model(
    parent_source_truths: tuple[_AuthenticatedNoticeParentSourceTruth, ...],
) -> str:
    embedding_model = next(
        (
            record.record.embedding_model.strip()
            for record in parent_source_truths
            if record.record.embedding_model.strip()
        ),
        "",
    )
    if not embedding_model:
        raise ValueError(
            "authenticated notice source projection requires a non-empty embedding_model"
        )
    return embedding_model


def _derive_notice_year(*, manifest: dict[str, Any], runtime_profile) -> str | None:
    del runtime_profile
    for field_name in ("notice_release_time", "notice_create_time", "notice_first_time"):
        value = _normalize_optional_text(manifest.get(field_name))
        if value is None:
            continue
        if len(value) >= 4 and value[:4].isdigit():
            return value[:4]
    return None


def _find_processed_key(record: DocumentRegistryRecord, suffix: str) -> str | None:
    for key in record.processed_object_keys:
        normalized = str(key).strip()
        if normalized.endswith(suffix):
            return normalized
    return None


def _load_json_payload(file_bytes: bytes) -> dict[str, Any]:
    payload = json.loads(file_bytes.decode("utf-8"))
    if not isinstance(payload, dict):
        raise ValueError("authenticated notice source projection expects a JSON object")
    return payload


def _load_jsonl_rows(file_bytes: bytes) -> tuple[dict[str, Any], ...]:
    rows: list[dict[str, Any]] = []
    for line in file_bytes.decode("utf-8").splitlines():
        normalized = line.strip()
        if not normalized:
            continue
        payload = json.loads(normalized)
        if isinstance(payload, dict):
            rows.append(payload)
    return tuple(rows)


def _sorted_layout_rows(layout_rows: Sequence[dict[str, Any]]) -> tuple[dict[str, Any], ...]:
    return tuple(
        sorted(
            layout_rows,
            key=lambda item: (
                str(item.get("sheet_name") or ""),
                int(item.get("row_index") or 0),
                int(item.get("worksheet_row_number") or 0),
            ),
        )
    )


def _render_layout_row_markdown(layout_row: dict[str, Any]) -> str:
    row_type = str(layout_row.get("row_type") or "")
    text = str(layout_row.get("text_normalized") or "").strip()
    if row_type == "table":
        return _render_layout_table_markdown(layout_row)
    if not text:
        return ""
    if row_type == "heading":
        heading_level = max(2, min(6, int(layout_row.get("heading_level") or 1) + 1))
        return f"{'#' * heading_level} {text}"
    if row_type == "list_item":
        return f"- {text}"
    return text


def _render_layout_row_text(layout_row: dict[str, Any]) -> str:
    row_type = str(layout_row.get("row_type") or "")
    if row_type == "table":
        return _render_layout_table_markdown(layout_row)
    return str(layout_row.get("text_normalized") or "").strip()


def _render_layout_table_markdown(layout_row: dict[str, Any]) -> str:
    table_rows = _layout_row_table_matrix(layout_row.get("table_cells"))
    if not table_rows:
        return ""
    header = table_rows[0]
    body = table_rows[1:] if len(table_rows) > 1 else []
    parts: list[str] = []
    if header:
        parts.append(f"| {' | '.join(header)} |")
        parts.append(f"| {' | '.join('---' for _ in header)} |")
    for row in body:
        if any(cell.strip() for cell in row):
            parts.append(f"| {' | '.join(row)} |")
    return "\n".join(parts).strip()


def _layout_row_table_matrix(table_cells: object) -> list[list[str]]:
    if not isinstance(table_cells, list) or not table_cells:
        return []
    if all(isinstance(row, list) for row in table_cells):
        return [[str(cell).strip() for cell in list(row)] for row in table_cells]
    if not all(isinstance(cell, dict) for cell in table_cells):
        return []
    row_numbers = sorted(
        {int(cell.get("row") or 0) for cell in table_cells if int(cell.get("row") or 0) > 0}
    )
    max_column = max((int(cell.get("col") or 0) for cell in table_cells), default=0)
    matrix: list[list[str]] = []
    for row_number in row_numbers:
        row_payload = [""] * max_column
        for cell in table_cells:
            if int(cell.get("row") or 0) != row_number:
                continue
            column_number = int(cell.get("col") or 0)
            if column_number <= 0 or column_number > max_column:
                continue
            row_payload[column_number - 1] = str(cell.get("text") or "").strip()
        matrix.append(row_payload)
    return matrix


def _render_canonical_markdown(*, metadata: dict[str, object], body: str) -> str:
    lines = ["---"]
    for key, value in metadata.items():
        if value is None or value == "":
            continue
        lines.append(f"{key}: {_format_front_matter_value(value)}")
    lines.extend(["---", "", body.rstrip(), ""])
    return "\n".join(lines)


def _format_front_matter_value(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (list, dict)):
        return json.dumps(value, ensure_ascii=False, separators=(",", ":"))
    text = str(value)
    if not text:
        return '""'
    if any(ch in text for ch in ["#", "[", "]", "{", "}", ","]) or text != text.strip():
        return json.dumps(text, ensure_ascii=False)
    return text


def _build_attachment_markdown_body(*, title: str, text_blocks: tuple[str, ...]) -> str:
    return "\n\n".join((f"# {title}", *text_blocks)).strip() + "\n"


def _build_attachment_markdown_body_from_layout_rows(
    *,
    title: str,
    layout_rows: Sequence[dict[str, Any]],
) -> str:
    parts = [f"# {title}"]
    for layout_row in _sorted_layout_rows(layout_rows):
        markdown = _render_layout_row_markdown(layout_row)
        if markdown:
            parts.append(markdown)
    return "\n\n".join(part for part in parts if part.strip()).strip() + "\n"


def _build_attachment_document_units_bytes(
    *,
    document_id: str,
    version_id: str,
    source_uri: str,
    title: str,
    text_blocks: tuple[str, ...],
    attachment_ref: dict[str, Any],
    metadata: dict[str, object],
) -> bytes:
    shared_anchor = {
        "source_uri": source_uri,
        "attachment_ref_id": attachment_ref.get("attachment_ref_id"),
        "resource_role": attachment_ref.get("resource_role"),
    }
    shared_metadata = {
        "projection_name": metadata.get("projection_name"),
        "parent_document_id": metadata.get("parent_document_id"),
        "attachment_ref_id": metadata.get("attachment_ref_id"),
        "attachment_kind": metadata.get("attachment_kind"),
        "attachment_role": metadata.get("attachment_role"),
        "attachment_filename": metadata.get("attachment_filename"),
        "attachment_mime_type": metadata.get("attachment_mime_type"),
        "extraction_class": metadata.get("extraction_class"),
    }
    rows = [
        {
            "doc_id": document_id,
            "version_id": version_id,
            "chunk_id": "attachment-title",
            "root_unit_id": "attachment-title",
            "unit_type": "attachment_title",
            "text": title,
            "raw_text": title,
            "clean_text": title,
            "anchor": dict(shared_anchor),
            "metadata": dict(shared_metadata),
        }
    ]
    for index, text in enumerate(text_blocks, start=1):
        rows.append(
            {
                "doc_id": document_id,
                "version_id": version_id,
                "chunk_id": f"attachment-body-{index:04d}",
                "root_unit_id": f"attachment-body-{index:04d}",
                "unit_type": "attachment_body",
                "text": text,
                "raw_text": text,
                "clean_text": text,
                "anchor": dict(shared_anchor),
                "metadata": dict(shared_metadata),
            }
        )
    return _jsonl_bytes(rows)


def _build_attachment_document_units_bytes_from_layout_rows(
    *,
    document_id: str,
    version_id: str,
    source_uri: str,
    title: str,
    layout_rows: Sequence[dict[str, Any]],
    attachment_ref: dict[str, Any],
    metadata: dict[str, object],
) -> bytes:
    shared_anchor = {
        "source_uri": source_uri,
        "attachment_ref_id": attachment_ref.get("attachment_ref_id"),
        "resource_role": attachment_ref.get("resource_role"),
    }
    shared_metadata = {
        "projection_name": metadata.get("projection_name"),
        "parent_document_id": metadata.get("parent_document_id"),
        "attachment_ref_id": metadata.get("attachment_ref_id"),
        "attachment_kind": metadata.get("attachment_kind"),
        "attachment_role": metadata.get("attachment_role"),
        "attachment_filename": metadata.get("attachment_filename"),
        "attachment_mime_type": metadata.get("attachment_mime_type"),
        "extraction_class": metadata.get("extraction_class"),
    }
    rows = [
        {
            "doc_id": document_id,
            "version_id": version_id,
            "chunk_id": "attachment-title",
            "root_unit_id": "attachment-title",
            "unit_type": "attachment_title",
            "text": title,
            "raw_text": title,
            "clean_text": title,
            "anchor": dict(shared_anchor),
            "metadata": dict(shared_metadata),
        }
    ]
    for index, layout_row in enumerate(_sorted_layout_rows(layout_rows), start=1):
        clean_text = _render_layout_row_text(layout_row)
        if not clean_text:
            continue
        row_type = str(layout_row.get("row_type") or "attachment_body")
        unit_type = (
            "attachment_heading"
            if row_type == "heading"
            else ("attachment_table" if row_type == "table" else "attachment_body")
        )
        anchor = dict(shared_anchor)
        if layout_row.get("sheet_name"):
            anchor["sheet_name"] = layout_row.get("sheet_name")
        if layout_row.get("row_id"):
            anchor["layout_row_id"] = layout_row.get("row_id")
        metadata_payload = dict(shared_metadata)
        metadata_payload["layout_row_type"] = row_type
        metadata_payload["heading_level"] = layout_row.get("heading_level")
        metadata_payload["source_format"] = layout_row.get("source_format")
        if layout_row.get("sheet_name") is not None:
            metadata_payload["sheet_name"] = layout_row.get("sheet_name")
        row = {
            "doc_id": document_id,
            "version_id": version_id,
            "chunk_id": f"attachment-body-{index:04d}",
            "root_unit_id": f"attachment-body-{index:04d}",
            "unit_type": unit_type,
            "text": clean_text,
            "raw_text": clean_text,
            "clean_text": clean_text,
            "anchor": anchor,
            "metadata": metadata_payload,
        }
        if row_type == "table" and layout_row.get("table_cells") is not None:
            row["table_cells"] = layout_row.get("table_cells")
        rows.append(row)
    return _jsonl_bytes(rows)


def _parse_notice_document_id(document_id: str) -> tuple[str, str]:
    parts = [part.strip() for part in document_id.split(":")]
    if len(parts) != 3 or parts[0] != "notice" or not parts[1] or not parts[2]:
        raise ValueError(f"unsupported authenticated notice parent document_id: {document_id!r}")
    return parts[1], parts[2]


def _normalize_authenticated_notice_ocr_provider_payload(
    *,
    provider_response_bytes: bytes,
    provider: str,
) -> bytes:
    if provider == MINERU_PROVIDER:
        return adapt_mineru_archive_to_canonical_provider_payload(provider_response_bytes)
    return provider_response_bytes


def _normalize_extension(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    if not normalized:
        return None
    suffix = Path(normalized).suffix.lower().strip()
    if suffix.startswith("."):
        suffix = suffix[1:]
    if suffix:
        return suffix
    return normalized.lstrip(".") or None


def _normalize_optional_text(value: object) -> str | None:
    if value is None:
        return None
    normalized = str(value).strip()
    return normalized or None


def _normalize_notice_ids(values: tuple[str, ...]) -> tuple[str, ...]:
    return tuple(sorted({str(item).strip() for item in values if str(item).strip()}))


def _jsonl_bytes(rows: list[dict[str, Any]]) -> bytes:
    return ("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n").encode("utf-8")


def _load_parent_source_truths(
    *,
    registry,
    object_store: AuthenticatedNoticeProjectionObjectStore,
    object_store_settings,
    corpus: str,
    collection: str,
    notice_ids: tuple[str, ...] = (),
) -> tuple[_AuthenticatedNoticeParentSourceTruth, ...]:
    selected_notice_ids = set(notice_ids)
    records = tuple(
        sorted(
            registry.list_by_scope(corpus, collection),
            key=lambda record: (record.document_id, record.revision_track, record.version_id),
        )
    )
    parents: list[_AuthenticatedNoticeParentSourceTruth] = []
    for record in records:
        if record.source_channel != "authenticated_notice_portal":
            continue
        if not str(record.document_id).startswith("notice:"):
            continue
        notice_manifest_key = _find_processed_key(record, "source-truth/notice-manifest.json")
        content_blocks_key = _find_processed_key(record, "source-truth/content-blocks.jsonl")
        attachment_refs_key = _find_processed_key(record, "source-truth/attachment-refs.jsonl")
        if notice_manifest_key is None or content_blocks_key is None or attachment_refs_key is None:
            continue
        _site_id, notice_id = _parse_notice_document_id(record.document_id)
        if selected_notice_ids and notice_id not in selected_notice_ids:
            continue
        manifest = _load_json_payload(
            object_store.get_bytes(
                bucket=object_store_settings.bucket_source, key=notice_manifest_key
            )
        )
        content_blocks = _load_jsonl_rows(
            object_store.get_bytes(
                bucket=object_store_settings.bucket_source, key=content_blocks_key
            )
        )
        attachment_refs = _load_jsonl_rows(
            object_store.get_bytes(
                bucket=object_store_settings.bucket_source, key=attachment_refs_key
            )
        )
        parents.append(
            _AuthenticatedNoticeParentSourceTruth(
                record=record,
                manifest=manifest,
                content_blocks=content_blocks,
                attachment_refs=attachment_refs,
                source_keys=tuple(
                    key
                    for key in record.processed_object_keys
                    if key and is_source_object_key(str(key))
                ),
                notice_manifest_key=notice_manifest_key,
                content_blocks_key=content_blocks_key,
                attachment_refs_key=attachment_refs_key,
            )
        )
    return tuple(parents)
