from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
from typing import Protocol

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


@dataclass(frozen=True, slots=True)
class DocumentImportInput:
    source_label: str
    structured_result_bytes: bytes
    provider_result_bytes: bytes | None
    metadata: dict[str, object]
    import_source: str
    raw_path: Path | None = None
    raw_source_uri: str | None = None


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
        "source_url": raw.get("source_url"),
        "source_md": raw.get("source_md"),
        "source_id": source.get("id"),
        "source_pdf": normalize_optional_text(raw.get("source_pdf")),
        "raw_page_start": normalize_optional_int(raw.get("page_start")),
        "raw_page_end": normalize_optional_int(raw.get("page_end")),
        "acl_groups": tuple(str(item) for item in list(acl.get("allow_groups") or [])),
    }


def bind_existing_ocr_raw_provenance(
    documents: list[DocumentImportInput],
    raw_root: Path,
) -> tuple[list[DocumentImportInput], tuple[str, ...]]:
    resolved_paths: dict[str, Path] = {}
    unresolved: list[str] = []
    bound: list[DocumentImportInput] = []
    for document in documents:
        source_pdf = str(document.metadata.get("source_pdf") or "")
        if not source_pdf:
            unresolved.append("<missing>")
            continue
        raw_path = resolved_paths.get(source_pdf)
        if raw_path is None:
            raw_path = resolve_raw_path(raw_root, source_pdf)
            if raw_path is None:
                unresolved.append(source_pdf)
                continue
            resolved_paths[source_pdf] = raw_path
        bound.append(
            replace(
                document,
                raw_path=raw_path,
                raw_source_uri=f"campusrag://raw/student_handbook/{raw_path.name}",
            )
        )
    return bound, tuple(sorted(set(unresolved)))


def persist_import_documents(
    *,
    documents: list[DocumentImportInput],
    registry: DocumentRegistry,
    raw_asset_registry: RawAssetRegistry,
    writer: ObjectStoreWriter,
    object_store: ObjectStoreSettings,
    parser_version: str,
    embedding_model: str,
    default_campus_scope: str | None,
    import_mode: str,
    report_dir: Path,
    report_prefix: str,
    unresolved_source_pdfs: tuple[str, ...] = (),
    initial_errors: list[str] | None = None,
) -> ImportReport:
    success_count = 0
    skipped_count = 0
    failed_count = len(initial_errors or [])
    raw_uploaded_count = 0
    raw_reused_count = 0
    document_ids: list[str] = []
    errors = list(initial_errors or [])
    timestamp = utc_now()
    uploaded_raw_assets: set[tuple[str, str]] = set()

    for document in documents:
        metadata = document.metadata
        source_label = document.source_label
        try:
            document_id = str(metadata["document_id"])
            version_id = str(metadata["version_id"])
            _validate_phase1_document_identity(document_id=document_id, version_id=version_id)
            raw_asset = resolved_raw_asset(
                raw_path=document.raw_path,
                raw_source_uri=document.raw_source_uri,
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
                            corpus="student_handbook",
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

            structured_bytes = document.structured_result_bytes
            content_hash = hashlib.sha256(structured_bytes).hexdigest()
            existing = registry.get(str(metadata["document_id"]), str(metadata["version_id"]))
            if existing is not None and existing.content_hash == content_hash:
                skipped_count += 1
                continue

            provider_result_key = None
            if document.provider_result_bytes is not None:
                provider_result_key = build_processed_artifact_key(
                    corpus="student_handbook",
                    document_id=document_id,
                    version_id=version_id,
                    filename="provider-result.jsonl",
                )
                writer.put_bytes(
                    bucket=object_store.bucket_processed,
                    key=provider_result_key,
                    data=document.provider_result_bytes,
                    content_type="application/x-ndjson",
                )

            structured_key = build_processed_artifact_key(
                corpus="student_handbook",
                document_id=document_id,
                version_id=version_id,
                filename="structured.jsonl",
            )
            writer.put_bytes(
                bucket=object_store.bucket_processed,
                key=structured_key,
                data=structured_bytes,
                content_type="application/x-ndjson",
            )
            processed_object_keys = tuple(
                key for key in (provider_result_key, structured_key) if key is not None
            )
            registry.upsert(
                DocumentRegistryRecord(
                    document_id=document_id,
                    version_id=version_id,
                    source_uri=derive_source_uri(metadata),
                    content_hash=content_hash,
                    corpus="student_handbook",
                    acl_groups=tuple(str(item) for item in metadata["acl_groups"]),
                    campus_scope=default_campus_scope,
                    status="active",
                    ingestion_timestamp=timestamp,
                    parser_version=parser_version,
                    embedding_model=embedding_model,
                    raw_asset=(
                        RawAssetRef(
                            raw_asset_id=raw_asset.raw_asset_id,
                            raw_version_id=raw_asset.raw_version_id,
                            page_start=metadata.get("raw_page_start"),
                            page_end=metadata.get("raw_page_end"),
                        )
                        if raw_asset is not None
                        else None
                    ),
                    structured_object_key=structured_key,
                    provider_result_object_key=provider_result_key,
                    processed_object_keys=processed_object_keys,
                    import_source=document.import_source,
                )
            )
            success_count += 1
            document_ids.append(str(metadata["document_id"]))
        except Exception as exc:
            failed_count += 1
            errors.append(f"{source_label}: {exc}")

    return write_import_report(
        import_mode=import_mode,
        report_dir=report_dir,
        report_prefix=report_prefix,
        success_count=success_count,
        skipped_count=skipped_count,
        failed_count=failed_count,
        raw_uploaded_count=raw_uploaded_count,
        raw_reused_count=raw_reused_count,
        document_ids=tuple(document_ids),
        unresolved_source_pdfs=unresolved_source_pdfs,
        errors=tuple(errors),
        timestamp=timestamp,
    )


def resolved_raw_asset(
    *,
    raw_path: Path | None,
    raw_source_uri: str | None,
) -> ResolvedRawAsset | None:
    if raw_path is None:
        return None
    raw_hash = hashlib.sha256(raw_path.read_bytes()).hexdigest()
    raw_asset_id = build_raw_asset_id(raw_path.name)
    raw_version_id = f"sha256:{raw_hash}"
    object_key = build_raw_asset_key(
        corpus="student_handbook",
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
        "学生手册.pdf": "student-handbook.pdf",
    }
    candidates = [exact]
    alias = aliases.get(exact)
    if alias is not None:
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


def normalize_optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _validate_phase1_document_identity(*, document_id: str, version_id: str) -> None:
    if not document_id.startswith("handbook:"):
        raise ValueError(f"phase-1 only supports handbook document ids: {document_id}")
    if not version_id:
        raise ValueError("version_id is required")


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
        unresolved_source_pdfs=unresolved_source_pdfs,
        errors=errors,
        report_path=str(report_path),
    )


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()
