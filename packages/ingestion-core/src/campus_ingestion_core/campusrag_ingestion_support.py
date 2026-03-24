from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re
from typing import Protocol

from campus_contracts import DEFAULT_COLLECTION, DEFAULT_CORPUS
from campus_ingestion_core.artifacts import (
    CANONICAL_MARKDOWN_FILENAME,
    DOCUMENT_UNITS_FILENAME,
    PROVIDER_RESPONSE_FILENAME,
)
from campus_ingestion_core.models import DocumentRegistryRecord, RawAssetRecord, RawAssetRef
from campus_ingestion_core.object_store import build_processed_artifact_key, build_raw_asset_key
from campus_ingestion_core.registry import DocumentRegistry, RawAssetRegistry
from campus_ingestion_core.settings import ObjectStoreSettings


@dataclass(frozen=True, slots=True)
class ImportReport:
    import_mode: str
    success_count: int
    skipped_count: int
    failed_count: int
    raw_uploaded_count: int
    raw_reused_count: int
    document_ids: tuple[str, ...]
    unresolved_source_pdfs: tuple[str, ...]
    errors: tuple[str, ...]
    report_path: str
    created_document_ids: tuple[str, ...] = ()
    updated_document_ids: tuple[str, ...] = ()
    skipped_document_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class PersistImportStats:
    success_count: int
    skipped_count: int
    failed_count: int
    raw_uploaded_count: int
    raw_reused_count: int
    document_ids: tuple[str, ...]
    unresolved_source_pdfs: tuple[str, ...]
    errors: tuple[str, ...]
    timestamp: str
    created_document_ids: tuple[str, ...] = ()
    updated_document_ids: tuple[str, ...] = ()
    skipped_document_ids: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class DocumentImportInput:
    source_label: str
    document_units_bytes: bytes
    provider_response_bytes: bytes | None
    canonical_markdown_bytes: bytes | None
    metadata: dict[str, object]
    import_source: str
    revision_track: str = "source-faithful"
    source_channel: str = "pdf_ocr"
    is_current: bool = False
    corpus: str = DEFAULT_CORPUS
    collection: str = DEFAULT_COLLECTION
    campus_scope: str | None = None
    status: str = "active"
    raw_path: Path | None = None
    raw_source_uri: str | None = None
    raw_asset_id: str | None = None
    raw_version_id: str | None = None
    provider_response_object_key: str | None = None
    additional_processed_object_keys: tuple[str, ...] = field(default_factory=tuple)
    title: str | None = None
    year: str | None = None


@dataclass(frozen=True, slots=True)
class ResolvedRawAsset:
    raw_asset_id: str
    raw_version_id: str
    source_filename: str
    path: Path
    raw_source_uri: str
    content_hash: str
    object_key: str


class ObjectStoreWriter(Protocol):
    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...


class S3ObjectStoreWriter:
    def __init__(self, settings: ObjectStoreSettings) -> None:
        from campus_ingestion_core.object_store import S3ObjectStoreClientFactory

        self._client = S3ObjectStoreClientFactory(settings).create()

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None:
        self._client.put_object(
            Bucket=bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )


def load_metadata_from_bytes(file_bytes: bytes) -> dict[str, object]:
    first_line = file_bytes.decode("utf-8").splitlines()[0]
    raw = json.loads(first_line)
    document_id = str(raw.get("doc_id") or "")
    version_id = str(raw.get("version_id") or "")
    if not document_id or not version_id:
        raise ValueError("doc_id and version_id are required in OCR JSONL")
    acl = raw.get("acl") or {}
    source = raw.get("source") or {}
    return {
        "document_id": document_id,
        "version_id": version_id,
        "revision_track": str(raw.get("revision_track") or "source-faithful"),
        "source_url": raw.get("source_url"),
        "source_md": raw.get("source_md"),
        "source_id": source.get("id"),
        "source_pdf": normalize_optional_text(raw.get("source_pdf")),
        "raw_page_start": normalize_optional_int(raw.get("page_start")),
        "raw_page_end": normalize_optional_int(raw.get("page_end")),
        "acl_groups": tuple(str(item) for item in list(acl.get("allow_groups") or [])),
    }


def persist_import_documents(
    *,
    documents: list[DocumentImportInput],
    registry: DocumentRegistry,
    raw_asset_registry: RawAssetRegistry,
    writer: ObjectStoreWriter,
    object_store: ObjectStoreSettings,
    parser_version: str,
    embedding_model: str,
    cleaning_policy_version: str,
    default_campus_scope: str | None,
    import_mode: str,
    report_dir: Path,
    report_prefix: str,
    unresolved_source_pdfs: tuple[str, ...] = (),
    initial_errors: list[str] | None = None,
) -> ImportReport:
    stats = collect_import_document_stats(
        documents=documents,
        registry=registry,
        raw_asset_registry=raw_asset_registry,
        writer=writer,
        object_store=object_store,
        parser_version=parser_version,
        embedding_model=embedding_model,
        cleaning_policy_version=cleaning_policy_version,
        default_campus_scope=default_campus_scope,
        unresolved_source_pdfs=unresolved_source_pdfs,
        initial_errors=initial_errors,
    )
    return write_import_report(
        import_mode=import_mode,
        report_dir=report_dir,
        report_prefix=report_prefix,
        success_count=stats.success_count,
        skipped_count=stats.skipped_count,
        failed_count=stats.failed_count,
        raw_uploaded_count=stats.raw_uploaded_count,
        raw_reused_count=stats.raw_reused_count,
        document_ids=stats.document_ids,
        created_document_ids=stats.created_document_ids,
        updated_document_ids=stats.updated_document_ids,
        skipped_document_ids=stats.skipped_document_ids,
        unresolved_source_pdfs=stats.unresolved_source_pdfs,
        errors=stats.errors,
        timestamp=stats.timestamp,
    )


def collect_import_document_stats(
    *,
    documents: list[DocumentImportInput],
    registry: DocumentRegistry,
    raw_asset_registry: RawAssetRegistry,
    writer: ObjectStoreWriter,
    object_store: ObjectStoreSettings,
    parser_version: str,
    embedding_model: str,
    cleaning_policy_version: str,
    default_campus_scope: str | None,
    unresolved_source_pdfs: tuple[str, ...] = (),
    initial_errors: list[str] | None = None,
) -> PersistImportStats:
    success_count = 0
    skipped_count = 0
    failed_count = len(initial_errors or [])
    raw_uploaded_count = 0
    raw_reused_count = 0
    document_ids: list[str] = []
    created_document_ids: list[str] = []
    updated_document_ids: list[str] = []
    skipped_document_ids: list[str] = []
    errors = list(initial_errors or [])
    timestamp = utc_now()
    uploaded_raw_assets: set[tuple[str, str]] = set()

    for document in documents:
        metadata = document.metadata
        source_label = document.source_label
        try:
            document_id = str(metadata["document_id"])
            version_id = str(metadata["version_id"])
            raw_asset = resolved_raw_asset(
                raw_path=document.raw_path,
                raw_source_uri=document.raw_source_uri,
                corpus=document.corpus,
                raw_asset_id_override=document.raw_asset_id,
            )
            if raw_asset is not None:
                raw_asset_key = (raw_asset.raw_asset_id, raw_asset.raw_version_id)
                existing_raw_record = raw_asset_registry.get(*raw_asset_key)
                if existing_raw_record is not None or raw_asset_key in uploaded_raw_assets:
                    raw_reused_count += 1
                else:
                    writer.put_bytes(
                        bucket=object_store.bucket_raw,
                        key=raw_asset.object_key,
                        data=document.raw_path.read_bytes(),
                        content_type="application/pdf",
                    )
                    raw_asset_registry.upsert(
                        RawAssetRecord(
                            raw_asset_id=raw_asset.raw_asset_id,
                            raw_version_id=raw_asset.raw_version_id,
                            corpus=document.corpus,
                            collection=document.collection,
                            raw_source_uri=raw_asset.raw_source_uri,
                            content_hash=raw_asset.content_hash,
                            source_filename=raw_asset.source_filename,
                            object_key=raw_asset.object_key,
                            ingestion_timestamp=timestamp,
                            import_source=document.import_source,
                        )
                    )
                    uploaded_raw_assets.add(raw_asset_key)
                    raw_uploaded_count += 1

            document_units_bytes = document.document_units_bytes
            content_hash = hashlib.sha256(document_units_bytes).hexdigest()
            title = document.title or _derive_document_title(metadata=metadata, document_id=document_id)
            year = document.year or _derive_document_year(metadata=metadata)
            provider_response_key = document.provider_response_object_key
            if document.provider_response_bytes is not None and provider_response_key is None:
                provider_response_key = build_processed_artifact_key(
                    corpus=document.corpus,
                    collection=document.collection,
                    document_id=document_id,
                    revision_track=document.revision_track,
                    version_id=version_id,
                    filename=PROVIDER_RESPONSE_FILENAME,
                    title=title,
                    year=year,
                )
            if document.provider_response_bytes is not None and provider_response_key is not None:
                writer.put_bytes(
                    bucket=object_store.bucket_processed,
                    key=provider_response_key,
                    data=document.provider_response_bytes,
                    content_type="application/x-ndjson",
                )

            document_units_key = build_processed_artifact_key(
                corpus=document.corpus,
                collection=document.collection,
                document_id=document_id,
                revision_track=document.revision_track,
                version_id=version_id,
                filename=DOCUMENT_UNITS_FILENAME,
                title=title,
                year=year,
            )
            canonical_markdown_key = None
            if document.canonical_markdown_bytes is not None:
                canonical_markdown_key = build_processed_artifact_key(
                    corpus=document.corpus,
                    collection=document.collection,
                    document_id=document_id,
                    revision_track=document.revision_track,
                    version_id=version_id,
                    filename=CANONICAL_MARKDOWN_FILENAME,
                    title=title,
                    year=year,
                )
                writer.put_bytes(
                    bucket=object_store.bucket_processed,
                    key=canonical_markdown_key,
                    data=document.canonical_markdown_bytes,
                    content_type="text/markdown; charset=utf-8",
                )
            processed_object_keys = tuple(
                dict.fromkeys(
                    key
                    for key in (
                        provider_response_key,
                        canonical_markdown_key,
                        document_units_key,
                        *document.additional_processed_object_keys,
                    )
                    if key is not None
                )
            )
            document_records = _list_document_records(
                registry=registry,
                corpus=document.corpus,
                collection=document.collection,
                document_id=document_id,
                revision_track=document.revision_track,
            )
            matching_content_record = next(
                (record for record in document_records if record.content_hash == content_hash),
                None,
            )
            if matching_content_record is not None:
                if _registry_record_needs_refresh(
                    existing=matching_content_record,
                    document_units_key=document_units_key,
                    provider_response_key=provider_response_key,
                    canonical_markdown_key=canonical_markdown_key,
                    processed_object_keys=processed_object_keys,
                ):
                    registry.upsert(
                        _build_registry_record(
                            document_id=document_id,
                            version_id=version_id,
                            metadata=metadata,
                            content_hash=content_hash,
                            document=document,
                            default_campus_scope=default_campus_scope,
                            parser_version=parser_version,
                            embedding_model=embedding_model,
                            cleaning_policy_version=cleaning_policy_version,
                            raw_asset=raw_asset,
                            document_units_key=document_units_key,
                            provider_response_key=provider_response_key,
                            canonical_markdown_key=canonical_markdown_key,
                            processed_object_keys=processed_object_keys,
                            timestamp=timestamp,
                        )
                    )
                skipped_count += 1
                skipped_document_ids.append(document_id)
                continue

            writer.put_bytes(
                bucket=object_store.bucket_processed,
                key=document_units_key,
                data=document_units_bytes,
                content_type="application/x-ndjson",
            )
            registry.upsert(
                _build_registry_record(
                    document_id=document_id,
                    version_id=version_id,
                    metadata=metadata,
                    content_hash=content_hash,
                    document=document,
                    default_campus_scope=default_campus_scope,
                    parser_version=parser_version,
                    embedding_model=embedding_model,
                    cleaning_policy_version=cleaning_policy_version,
                    raw_asset=raw_asset,
                    document_units_key=document_units_key,
                    provider_response_key=provider_response_key,
                    canonical_markdown_key=canonical_markdown_key,
                    processed_object_keys=processed_object_keys,
                    timestamp=timestamp,
                )
            )
            success_count += 1
            document_ids.append(document_id)
            if document_records:
                updated_document_ids.append(document_id)
            else:
                created_document_ids.append(document_id)
        except Exception as exc:
            failed_count += 1
            errors.append(f"{source_label}: {exc}")

    return PersistImportStats(
        success_count=success_count,
        skipped_count=skipped_count,
        failed_count=failed_count,
        raw_uploaded_count=raw_uploaded_count,
        raw_reused_count=raw_reused_count,
        document_ids=tuple(document_ids),
        created_document_ids=tuple(created_document_ids),
        updated_document_ids=tuple(updated_document_ids),
        skipped_document_ids=tuple(skipped_document_ids),
        unresolved_source_pdfs=unresolved_source_pdfs,
        errors=tuple(errors),
        timestamp=timestamp,
    )


def build_registered_raw_asset_ref(
    *,
    raw_asset_id: str,
    raw_version_id: str,
    page_start: int | None = None,
    page_end: int | None = None,
) -> RawAssetRef:
    return RawAssetRef(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        page_start=page_start,
        page_end=page_end,
    )


def resolved_raw_asset(
    *,
    raw_path: Path | None,
    raw_source_uri: str | None,
    corpus: str,
    raw_asset_id_override: str | None = None,
) -> ResolvedRawAsset | None:
    if raw_path is None:
        return None
    raw_hash = hashlib.sha256(raw_path.read_bytes()).hexdigest()
    raw_asset_id = raw_asset_id_override or build_raw_asset_id(raw_path.name)
    raw_version_id = f"sha256:{raw_hash}"
    object_key = build_raw_asset_key(
        corpus=corpus,
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        filename=raw_path.name,
    )
    return ResolvedRawAsset(
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        source_filename=raw_path.name,
        path=raw_path,
        raw_source_uri=raw_source_uri or f"file://{raw_path.resolve()}",
        content_hash=raw_hash,
        object_key=object_key,
    )


def resolve_raw_path(raw_root: Path, source_pdf: str) -> Path | None:
    for candidate_name in raw_filename_candidates(source_pdf):
        candidate = raw_root / candidate_name
        if candidate.exists() and candidate.is_file():
            return candidate
    return None


def raw_filename_candidates(source_pdf: str) -> tuple[str, ...]:
    exact = source_pdf.strip()
    aliases = {
        "学生手册.pdf": ("学生手册_2018.pdf", "student-handbook.pdf"),
        "学生手册_2018.pdf": ("学生手册.pdf", "student-handbook.pdf"),
        "student-handbook.pdf": ("学生手册_2018.pdf", "学生手册.pdf"),
    }
    candidates = [exact]
    for alias in aliases.get(exact, ()):
        candidates.append(alias)
    return tuple(dict.fromkeys(name for name in candidates if name))


def build_raw_asset_id(filename: str) -> str:
    return f"asset:{slugify_label(filename)}"


def slugify_label(value: str) -> str:
    normalized = value.strip().lower()
    slug = "".join(ch if ch.isalnum() else "-" for ch in normalized).strip("-")
    while "--" in slug:
        slug = slug.replace("--", "-")
    return slug or "asset"


def derive_source_uri(metadata: dict[str, object]) -> str:
    source_url = metadata.get("source_url")
    if isinstance(source_url, str) and source_url:
        return source_url
    for candidate in (metadata.get("source_md"), metadata.get("source_id")):
        relative = extract_canonical_relative_path(candidate)
        if relative is not None:
            return f"campusrag://canonical/{relative}"
    return f"campusrag://import/{metadata['document_id']}/{metadata['version_id']}"


def _build_registry_record(
    *,
    document_id: str,
    version_id: str,
    metadata: dict[str, object],
    content_hash: str,
    document: DocumentImportInput,
    default_campus_scope: str | None,
    parser_version: str,
    embedding_model: str,
    cleaning_policy_version: str,
    raw_asset: ResolvedRawAsset | None,
    document_units_key: str,
    provider_response_key: str | None,
    canonical_markdown_key: str | None,
    processed_object_keys: tuple[str, ...],
    timestamp: str,
) -> DocumentRegistryRecord:
    return DocumentRegistryRecord(
        document_id=document_id,
        revision_track=document.revision_track,
        version_id=version_id,
        source_uri=derive_source_uri(metadata),
        content_hash=content_hash,
        corpus=document.corpus,
        collection=document.collection,
        cleaning_policy_version=cleaning_policy_version,
        acl_groups=tuple(str(item) for item in metadata["acl_groups"]),
        campus_scope=_resolve_campus_scope(
            metadata=metadata,
            document=document,
            default_campus_scope=default_campus_scope,
        ),
        status=_resolve_status(metadata=metadata, document=document),
        ingestion_timestamp=timestamp,
        parser_version=parser_version,
        embedding_model=embedding_model,
        source_channel=document.source_channel,
        is_current=document.is_current,
        effective_date=normalize_optional_text(metadata.get("effective_date")),
        published_date=normalize_optional_text(metadata.get("published_date")),
        raw_asset=_resolve_registry_raw_asset_ref(
            raw_asset=raw_asset,
            document=document,
            metadata=metadata,
        ),
        document_units_object_key=document_units_key,
        provider_response_object_key=provider_response_key,
        canonical_markdown_object_key=canonical_markdown_key,
        processed_object_keys=processed_object_keys,
        import_source=document.import_source,
    )


def _resolve_registry_raw_asset_ref(
    *,
    raw_asset: ResolvedRawAsset | None,
    document: DocumentImportInput,
    metadata: dict[str, object],
) -> RawAssetRef | None:
    if raw_asset is not None:
        return RawAssetRef(
            raw_asset_id=raw_asset.raw_asset_id,
            raw_version_id=raw_asset.raw_version_id,
            page_start=metadata.get("raw_page_start"),
            page_end=metadata.get("raw_page_end"),
        )
    if document.raw_asset_id and document.raw_version_id:
        return RawAssetRef(
            raw_asset_id=document.raw_asset_id,
            raw_version_id=document.raw_version_id,
            page_start=metadata.get("raw_page_start"),
            page_end=metadata.get("raw_page_end"),
        )
    return None


def _registry_record_needs_refresh(
    *,
    existing: DocumentRegistryRecord,
    document_units_key: str,
    provider_response_key: str | None,
    canonical_markdown_key: str | None,
    processed_object_keys: tuple[str, ...],
) -> bool:
    if existing.document_units_object_key != document_units_key:
        return True
    if existing.provider_response_object_key != provider_response_key:
        return True
    if existing.canonical_markdown_object_key != canonical_markdown_key:
        return True
    return tuple(existing.processed_object_keys) != processed_object_keys


def _list_document_records(
    *,
    registry: DocumentRegistry,
    corpus: str,
    collection: str,
    document_id: str,
    revision_track: str,
) -> tuple[DocumentRegistryRecord, ...]:
    return tuple(
        record
        for record in registry.list_by_scope(corpus, collection)
        if record.document_id == document_id and record.revision_track == revision_track
    )


def _derive_document_title(*, metadata: dict[str, object], document_id: str) -> str:
    for key in ("title", "document_title"):
        title = normalize_optional_text(metadata.get(key))
        if title is not None:
            return title
    return document_id.split(":")[-1]


def _derive_document_year(*, metadata: dict[str, object]) -> str | None:
    for key in ("published_date", "effective_date", "year", "source_pdf", "source_doc", "source_label"):
        year = _extract_year_label(metadata.get(key))
        if year is not None:
            return year
    return None


def _extract_year_label(value: object) -> str | None:
    text = normalize_optional_text(value)
    if text is None:
        return None
    match = re.search(r"(?<!\d)((?:19|20)\d{2})(?!\d)", text)
    if match is None:
        return None
    return match.group(1)


def normalize_optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _resolve_campus_scope(
    *,
    metadata: dict[str, object],
    document: DocumentImportInput,
    default_campus_scope: str | None,
) -> str | None:
    metadata_scope = normalize_optional_text(metadata.get("campus_scope"))
    if metadata_scope is not None:
        return metadata_scope
    if document.campus_scope is not None:
        return document.campus_scope
    return default_campus_scope


def _resolve_status(*, metadata: dict[str, object], document: DocumentImportInput) -> str:
    metadata_status = normalize_optional_text(metadata.get("status"))
    if metadata_status is not None:
        return metadata_status
    return document.status


def normalize_optional_int(value: object) -> int | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ValueError("boolean is not a valid page number")
    if isinstance(value, int):
        return value
    if isinstance(value, str):
        return int(value)
    raise ValueError(f"invalid integer value: {value!r}")


def extract_canonical_relative_path(value: object) -> str | None:
    if not isinstance(value, str) or not value:
        return None
    normalized = value.replace("\\", "/")
    marker = "rag-data/canonical/"
    if marker not in normalized:
        return None
    return normalized.split(marker, 1)[1].lstrip("/")


def write_import_report(
    *,
    import_mode: str,
    report_dir: Path,
    report_prefix: str,
    success_count: int,
    skipped_count: int,
    failed_count: int,
    raw_uploaded_count: int,
    raw_reused_count: int,
    document_ids: tuple[str, ...],
    unresolved_source_pdfs: tuple[str, ...],
    errors: tuple[str, ...],
    timestamp: str,
    created_document_ids: tuple[str, ...] = (),
    updated_document_ids: tuple[str, ...] = (),
    skipped_document_ids: tuple[str, ...] = (),
) -> ImportReport:
    report_dir.mkdir(parents=True, exist_ok=True)
    safe_timestamp = timestamp.replace(":", "").replace("+", "_plus_")
    report_path = report_dir / f"{report_prefix}-{safe_timestamp}.json"
    payload = {
        "import_mode": import_mode,
        "success_count": success_count,
        "skipped_count": skipped_count,
        "failed_count": failed_count,
        "raw_uploaded_count": raw_uploaded_count,
        "raw_reused_count": raw_reused_count,
        "document_ids": list(document_ids),
        "created_document_ids": list(created_document_ids),
        "updated_document_ids": list(updated_document_ids),
        "skipped_document_ids": list(skipped_document_ids),
        "unresolved_source_pdfs": list(unresolved_source_pdfs),
        "errors": list(errors),
    }
    report_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    return ImportReport(
        import_mode=import_mode,
        success_count=success_count,
        skipped_count=skipped_count,
        failed_count=failed_count,
        raw_uploaded_count=raw_uploaded_count,
        raw_reused_count=raw_reused_count,
        document_ids=document_ids,
        report_path=str(report_path),
        created_document_ids=created_document_ids,
        updated_document_ids=updated_document_ids,
        skipped_document_ids=skipped_document_ids,
        unresolved_source_pdfs=unresolved_source_pdfs,
        errors=errors,
    )


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()
