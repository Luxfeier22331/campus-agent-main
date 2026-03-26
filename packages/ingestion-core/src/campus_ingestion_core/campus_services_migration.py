from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import re
from typing import Protocol

from campus_ingestion_core.artifacts import CANONICAL_MARKDOWN_FILENAME, PROVIDER_RESPONSE_FILENAME
from campus_ingestion_core.handbook_cleanup import cleanup_handbook_document, validate_handbook_manifest_title
from campus_ingestion_core.handbook_provider_normalize import normalize_handbook_provider_result
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.object_store import (
    S3ObjectStoreClientFactory,
    build_processed_artifact_key,
    build_processed_asset_artifact_key,
)
from campus_ingestion_core.raw_ingestion import DEFAULT_ONLINE_OCR_MODEL, DEFAULT_ONLINE_OCR_PROVIDER
from campus_ingestion_core.registry import RawAssetRegistry, build_raw_asset_registry_from_env
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.split_manifest import SplitManifestDocument


DEFAULT_SERVICE_PORTAL_DIR = "service_portal"
DEFAULT_STUDENT_HANDBOOK_DIR = "student_handbook"
DEFAULT_PHONE_DOC_NAME = "中央民族大学校内常用电话.md"
LEGACY_PHONE_DOC_ID = "handbook:bf03f0bd6930e89bcc6d2733c1e87a423b510675"
SOURCE_FAITHFUL_TRACK = "source-faithful"
YEAR_RE = re.compile(r"(?<!\d)((?:19|20)\d{2})(?!\d)")
HANDBOOK_DERIVED_DOCUMENTS_SCHEMA_VERSION = "handbook_derived_documents_v1"


class CampusServicesObjectStore(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...

    def put_bytes(
        self,
        *,
        bucket: str,
        key: str,
        data: bytes,
        content_type: str,
    ) -> None: ...

    def delete_prefix(self, *, bucket: str, prefix: str, exclude_keys: tuple[str, ...] = ()) -> None: ...


@dataclass(frozen=True, slots=True)
class CampusServicesMigrationEntry:
    collection: str
    source_path: Path
    legacy_document_id: str
    document_id: str
    title: str
    year: str
    content_hash: str
    canonical_markdown_bytes: bytes
    target_object_key: str
    cleanup_prefixes: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class HandbookDerivedDocumentMapping:
    source_document_id: str
    source_title: str
    handbook_section: str
    page_start: int
    page_end: int
    target_collection: str
    target_title: str
    migration_reason: str


@dataclass(frozen=True, slots=True)
class HandbookDerivedDocumentsConfig:
    source_corpus: str
    source_collection: str
    source_pdf: str
    raw_asset_id: str
    documents: tuple[HandbookDerivedDocumentMapping, ...]


@dataclass(frozen=True, slots=True)
class CampusServicesMigrationPlan:
    entries: tuple[CampusServicesMigrationEntry, ...]
    skipped_sources: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class CampusServicesObjectStoreMigrationReport:
    imported_count: int
    skipped_count: int
    imported_object_keys: tuple[str, ...]
    skipped_sources: tuple[str, ...]
    deleted_prefixes: tuple[str, ...]


class S3CampusServicesObjectStore:
    def __init__(self, settings: ObjectStoreSettings) -> None:
        self._client = S3ObjectStoreClientFactory(settings).create()

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        response = self._client.get_object(Bucket=bucket, Key=key)
        return response["Body"].read()

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

    def delete_prefix(self, *, bucket: str, prefix: str, exclude_keys: tuple[str, ...] = ()) -> None:
        excluded = set(exclude_keys)
        continuation_token: str | None = None
        while True:
            request: dict[str, object] = {"Bucket": bucket, "Prefix": prefix}
            if continuation_token is not None:
                request["ContinuationToken"] = continuation_token
            response = self._client.list_objects_v2(**request)
            keys = [
                {"Key": item["Key"]}
                for item in response.get("Contents") or ()
                if item["Key"] not in excluded
            ]
            for start in range(0, len(keys), 1000):
                batch = keys[start : start + 1000]
                if batch:
                    self._client.delete_objects(
                        Bucket=bucket,
                        Delete={"Objects": batch, "Quiet": True},
                    )
            if not response.get("IsTruncated"):
                break
            continuation_token = response.get("NextContinuationToken")


def build_campus_services_migration_plan(
    campusrag_canonical_root: Path,
    *,
    handbook_derived_entries: tuple[CampusServicesMigrationEntry, ...] = (),
) -> CampusServicesMigrationPlan:
    canonical_root = Path(campusrag_canonical_root)
    entries = [
        _build_phone_directory_entry(canonical_root),
        *_build_service_catalog_entries(canonical_root),
        *handbook_derived_entries,
    ]
    skipped_sources = _load_skipped_service_portal_sources(canonical_root)
    return CampusServicesMigrationPlan(
        entries=tuple(sorted(entries, key=lambda entry: (entry.collection, entry.target_object_key))),
        skipped_sources=tuple(skipped_sources),
    )


def migrate_campus_services_canonical_to_object_store(
    *,
    env: dict[str, str] | None = None,
    object_store: CampusServicesObjectStore | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
) -> CampusServicesObjectStoreMigrationReport:
    source = dict(env if env is not None else os.environ)
    canonical_root = _read_required_canonical_root(source)
    object_store_settings = ObjectStoreSettings.from_env(source)
    writer = object_store or S3CampusServicesObjectStore(object_store_settings)
    runtime_raw_asset_registry = raw_asset_registry or build_raw_asset_registry_from_env(source)
    handbook_derived_entries = build_handbook_derived_service_catalog_entries(
        source=source,
        object_store=writer,
        object_store_settings=object_store_settings,
        raw_asset_registry=runtime_raw_asset_registry,
    )
    plan = build_campus_services_migration_plan(
        canonical_root,
        handbook_derived_entries=tuple(handbook_derived_entries),
    )

    for entry in plan.entries:
        writer.put_bytes(
            bucket=object_store_settings.bucket_processed,
            key=entry.target_object_key,
            data=entry.canonical_markdown_bytes,
            content_type="text/markdown; charset=utf-8",
        )

    service_catalog_keys = tuple(
        entry.target_object_key for entry in plan.entries if entry.collection == "service_catalog"
    )
    contact_directory_keys = tuple(
        entry.target_object_key for entry in plan.entries if entry.collection == "contact_directory"
    )
    deleted_prefixes = (
        "campus_services/documents/contact_directory/",
        "campus_services/documents/service_catalog/",
        *tuple(prefix for entry in plan.entries for prefix in entry.cleanup_prefixes),
    )
    writer.delete_prefix(
        bucket=object_store_settings.bucket_processed,
        prefix=deleted_prefixes[0],
        exclude_keys=contact_directory_keys,
    )
    writer.delete_prefix(
        bucket=object_store_settings.bucket_processed,
        prefix=deleted_prefixes[1],
        exclude_keys=service_catalog_keys,
    )
    for prefix in deleted_prefixes[2:]:
        writer.delete_prefix(bucket=object_store_settings.bucket_processed, prefix=prefix)

    return CampusServicesObjectStoreMigrationReport(
        imported_count=len(plan.entries),
        skipped_count=len(plan.skipped_sources),
        imported_object_keys=tuple(entry.target_object_key for entry in plan.entries),
        skipped_sources=plan.skipped_sources,
        deleted_prefixes=deleted_prefixes,
    )


def _build_phone_directory_entry(canonical_root: Path) -> CampusServicesMigrationEntry:
    source_path = canonical_root / DEFAULT_STUDENT_HANDBOOK_DIR / "docs" / DEFAULT_PHONE_DOC_NAME
    if not source_path.exists():
        raise ValueError(f"phone directory canonical markdown not found: {source_path}")
    source_text = source_path.read_text(encoding="utf-8")
    legacy_metadata, body = _parse_yaml_front_matter_document(source_text)
    legacy_document_id = str(legacy_metadata.get("doc_id") or LEGACY_PHONE_DOC_ID)
    title = str(legacy_metadata.get("title") or source_path.stem)
    year = _infer_year(str(legacy_metadata.get("source_doc") or source_path.name))
    document_id = _build_campus_services_document_id("contact_directory", legacy_document_id)
    metadata = {
        "schema_version": legacy_metadata.get("schema_version") or 1,
        "doc_id": document_id,
        "corpus": "campus_services",
        "collection": "contact_directory",
        "title": title,
        "source_kind": legacy_metadata.get("source_kind") or "migrated_canonical",
        "source_doc": legacy_metadata.get("source_doc") or "学生手册_2018.pdf",
        "handbook_section": legacy_metadata.get("handbook_section"),
        "page_start": legacy_metadata.get("page_start"),
        "page_end": legacy_metadata.get("page_end"),
        "migration_source_corpus": "student_handbook",
        "migration_source_path": f"{DEFAULT_STUDENT_HANDBOOK_DIR}/docs/{DEFAULT_PHONE_DOC_NAME}",
        "legacy_doc_id": legacy_document_id,
    }
    rendered_bytes = _render_canonical_markdown(metadata=metadata, body=body).encode("utf-8")
    content_hash = hashlib.sha256(rendered_bytes).hexdigest()
    return CampusServicesMigrationEntry(
        collection="contact_directory",
        source_path=source_path,
        legacy_document_id=legacy_document_id,
        document_id=document_id,
        title=title,
        year=year,
        content_hash=content_hash,
        canonical_markdown_bytes=rendered_bytes,
        target_object_key=build_processed_artifact_key(
            corpus="campus_services",
            collection="contact_directory",
            document_id=document_id,
            revision_track=SOURCE_FAITHFUL_TRACK,
            version_id=f"sha256:{content_hash}",
            filename=CANONICAL_MARKDOWN_FILENAME,
            title=title,
            year=year,
        ),
        cleanup_prefixes=(_legacy_regulations_document_prefix(title=title, legacy_document_id=legacy_document_id),),
    )


def _build_service_catalog_entries(canonical_root: Path) -> list[CampusServicesMigrationEntry]:
    service_root = canonical_root / DEFAULT_SERVICE_PORTAL_DIR
    manifest_path = service_root / "manifests" / "docs.jsonl"
    if not manifest_path.exists():
        raise ValueError(f"service_portal manifest not found: {manifest_path}")

    entries: list[CampusServicesMigrationEntry] = []
    for raw_line in manifest_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        record = json.loads(line)
        if str(record.get("status") or "active") != "active":
            continue
        relative_path = str(record.get("path") or "").strip()
        if not relative_path:
            raise ValueError("service_portal manifest entry path is required")
        source_path = service_root / relative_path
        if not source_path.exists():
            raise ValueError(f"service_portal canonical markdown not found: {source_path}")
        source_text = source_path.read_text(encoding="utf-8")
        legacy_metadata, body = _parse_service_portal_document(source_text)
        legacy_document_id = str(legacy_metadata.get("doc_id") or record.get("id") or "")
        if not legacy_document_id:
            raise ValueError(f"service_portal document_id is required: {source_path}")
        title = str(legacy_metadata.get("title") or source_path.stem)
        year = _infer_service_catalog_year(legacy_metadata, record=record)
        document_id = _build_campus_services_document_id("service_catalog", legacy_document_id)
        metadata = {
            "schema_version": legacy_metadata.get("schema_version") or 1,
            "doc_id": document_id,
            "corpus": "campus_services",
            "collection": "service_catalog",
            "title": title,
            "status": legacy_metadata.get("status") or record.get("status") or "active",
            "effective_from": legacy_metadata.get("effective_from"),
            "effective_to": legacy_metadata.get("effective_to"),
            "source_kind": legacy_metadata.get("source_kind") or "migrated_canonical",
            "source_refs": legacy_metadata.get("source_refs"),
            "source_site": legacy_metadata.get("source_site"),
            "source_url": legacy_metadata.get("source_url"),
            "source_locator_type": legacy_metadata.get("source_locator_type"),
            "source_locator_value": legacy_metadata.get("source_locator_value"),
            "source_updated_at": legacy_metadata.get("source_updated_at") or record.get("updated_at"),
            "source_doc": legacy_metadata.get("source_doc") or title,
            "service_category": legacy_metadata.get("service_category"),
            "migration_source_corpus": "service_portal",
            "migration_source_path": f"{DEFAULT_SERVICE_PORTAL_DIR}/{relative_path}",
            "legacy_doc_id": legacy_document_id,
        }
        rendered_bytes = _render_canonical_markdown(metadata=metadata, body=body).encode("utf-8")
        content_hash = hashlib.sha256(rendered_bytes).hexdigest()
        entries.append(
            CampusServicesMigrationEntry(
                collection="service_catalog",
                source_path=source_path,
                legacy_document_id=legacy_document_id,
                document_id=document_id,
                title=title,
                year=year,
                content_hash=content_hash,
                canonical_markdown_bytes=rendered_bytes,
                target_object_key=build_processed_artifact_key(
                    corpus="campus_services",
                    collection="service_catalog",
                    document_id=document_id,
                    revision_track=SOURCE_FAITHFUL_TRACK,
                    version_id=f"sha256:{content_hash}",
                    filename=CANONICAL_MARKDOWN_FILENAME,
                    title=title,
                    year=year,
                ),
            )
        )
    return entries


def _load_skipped_service_portal_sources(canonical_root: Path) -> list[str]:
    manifest_path = canonical_root / DEFAULT_SERVICE_PORTAL_DIR / "manifests" / "docs.jsonl"
    if not manifest_path.exists():
        return []
    skipped: list[str] = []
    for raw_line in manifest_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line:
            continue
        record = json.loads(line)
        if str(record.get("status") or "active") == "active":
            continue
        skipped.append(str(record.get("path") or record.get("id") or "unknown"))
    return skipped


def build_handbook_derived_service_catalog_entries(
    *,
    source: dict[str, str],
    object_store: CampusServicesObjectStore,
    object_store_settings: ObjectStoreSettings,
    raw_asset_registry: RawAssetRegistry,
) -> list[CampusServicesMigrationEntry]:
    config_path = _read_handbook_derived_documents_config_path(source)
    config = load_handbook_derived_documents_config(config_path)
    raw_asset_record = _select_handbook_raw_asset_record(
        raw_asset_registry=raw_asset_registry,
        source_corpus=config.source_corpus,
        source_collection=config.source_collection,
        raw_asset_id=config.raw_asset_id,
    )
    source_pdf = raw_asset_record.source_filename or config.source_pdf
    provider_response_key = build_processed_asset_artifact_key(
        corpus=config.source_corpus,
        raw_asset_id=raw_asset_record.raw_asset_id,
        raw_version_id=raw_asset_record.raw_version_id,
        filename=PROVIDER_RESPONSE_FILENAME,
        year=_infer_year(source_pdf),
    )
    provider_response_bytes = object_store.get_bytes(
        bucket=object_store_settings.bucket_processed,
        key=provider_response_key,
    )
    structured_rows = normalize_handbook_provider_result(
        source_pdf=source_pdf,
        provider_jsonl_bytes=provider_response_bytes,
        ocr_provider=DEFAULT_ONLINE_OCR_PROVIDER,
        ocr_model=(source.get("OCR_MODEL") or DEFAULT_ONLINE_OCR_MODEL).strip() or DEFAULT_ONLINE_OCR_MODEL,
        source_artifact_id=raw_asset_record.raw_asset_id,
    )
    year = _infer_year(source_pdf)
    entries: list[CampusServicesMigrationEntry] = []
    for mapping in config.documents:
        manifest_document = SplitManifestDocument(
            document_id=mapping.source_document_id,
            title=mapping.source_title,
            page_start=mapping.page_start,
            page_end=mapping.page_end,
            source_uri=f"campus-agent://{config.source_corpus}/{config.source_collection}/docs/{mapping.source_document_id}",
            handbook_section=mapping.handbook_section,
        )
        validate_handbook_manifest_title(
            structured_rows=structured_rows,
            manifest_document=manifest_document,
        )
        cleanup_result = cleanup_handbook_document(
            structured_rows=structured_rows,
            manifest_document=manifest_document,
            source_doc=source_pdf,
        )
        legacy_metadata, cleanup_body = _parse_yaml_front_matter_document(cleanup_result.canonical_markdown)
        rendered_body = _retitle_markdown_heading(
            cleanup_body,
            old_title=cleanup_result.title,
            new_title=mapping.target_title,
        )
        document_id = _build_campus_services_document_id(mapping.target_collection, mapping.source_document_id)
        metadata = {
            "schema_version": legacy_metadata.get("schema_version") or 1,
            "doc_id": document_id,
            "corpus": "campus_services",
            "collection": mapping.target_collection,
            "title": mapping.target_title,
            "source_kind": "handbook_derived_ocr",
            "source_doc": legacy_metadata.get("source_doc") or source_pdf,
            "handbook_section": legacy_metadata.get("handbook_section") or mapping.handbook_section,
            "page_start": legacy_metadata.get("page_start") or mapping.page_start,
            "page_end": legacy_metadata.get("page_end") or mapping.page_end,
            "migration_source_corpus": config.source_corpus,
            "migration_source_collection": config.source_collection,
            "migration_source_document_id": mapping.source_document_id,
            "migration_source_raw_asset_id": raw_asset_record.raw_asset_id,
            "migration_source_raw_version_id": raw_asset_record.raw_version_id,
            "migration_source_provider_response_key": provider_response_key,
            "migration_reason": mapping.migration_reason,
            "legacy_doc_id": mapping.source_document_id,
        }
        rendered_bytes = _render_canonical_markdown(metadata=metadata, body=rendered_body).encode("utf-8")
        content_hash = hashlib.sha256(rendered_bytes).hexdigest()
        entries.append(
            CampusServicesMigrationEntry(
                collection=mapping.target_collection,
                source_path=config_path,
                legacy_document_id=mapping.source_document_id,
                document_id=document_id,
                title=mapping.target_title,
                year=year,
                content_hash=content_hash,
                canonical_markdown_bytes=rendered_bytes,
                target_object_key=build_processed_artifact_key(
                    corpus="campus_services",
                    collection=mapping.target_collection,
                    document_id=document_id,
                    revision_track=SOURCE_FAITHFUL_TRACK,
                    version_id=f"sha256:{content_hash}",
                    filename=CANONICAL_MARKDOWN_FILENAME,
                    title=mapping.target_title,
                    year=year,
                ),
                cleanup_prefixes=(
                    _legacy_regulations_document_prefix(
                        title=mapping.source_title,
                        legacy_document_id=mapping.source_document_id,
                    ),
                ),
            )
        )
    return entries


def _read_required_canonical_root(source: dict[str, str]) -> Path:
    root = (source.get("CAMPUSRAG_CANONICAL_ROOT") or "").strip()
    if not root:
        raise ValueError("CAMPUSRAG_CANONICAL_ROOT is required")
    return Path(root)


def _read_handbook_derived_documents_config_path(source: dict[str, str]) -> Path:
    value = (source.get("HANDBOOK_DERIVED_DOCUMENTS_CONFIG_PATH") or "").strip()
    if value:
        return Path(value)
    return _default_config_root() / "campus_services" / "service_catalog" / "handbook-derived-documents.json"


def load_handbook_derived_documents_config(path: Path) -> HandbookDerivedDocumentsConfig:
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if str(payload.get("schema_version") or "") != HANDBOOK_DERIVED_DOCUMENTS_SCHEMA_VERSION:
        raise ValueError(f"unsupported handbook-derived schema_version: {payload.get('schema_version')!r}")
    documents = tuple(
        HandbookDerivedDocumentMapping(
            source_document_id=str(item.get("source_document_id") or ""),
            source_title=str(item.get("source_title") or ""),
            handbook_section=str(item.get("handbook_section") or ""),
            page_start=int(item["page_start"]),
            page_end=int(item["page_end"]),
            target_collection=str(item.get("target_collection") or ""),
            target_title=str(item.get("target_title") or ""),
            migration_reason=str(item.get("migration_reason") or ""),
        )
        for item in list(payload.get("documents") or [])
    )
    return HandbookDerivedDocumentsConfig(
        source_corpus=str(payload.get("source_corpus") or ""),
        source_collection=str(payload.get("source_collection") or ""),
        source_pdf=str(payload.get("source_pdf") or ""),
        raw_asset_id=str(payload.get("raw_asset_id") or ""),
        documents=documents,
    )


def _parse_yaml_front_matter_document(text: str) -> tuple[dict[str, object], str]:
    if not text.startswith("---\n"):
        return {}, text
    lines = text.splitlines()
    metadata: dict[str, object] = {}
    closing_index = None
    for index, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            closing_index = index
            break
        if ":" not in line:
            continue
        key, value = line.split(":", 1)
        metadata[key.strip()] = _normalize_value(value.strip())
    if closing_index is None:
        return metadata, text
    body = "\n".join(lines[closing_index + 1 :]).lstrip("\n")
    return metadata, body


def _parse_service_portal_document(text: str) -> tuple[dict[str, object], str]:
    lines = text.splitlines()
    metadata: dict[str, object] = {}
    if not lines:
        return metadata, text
    first_line = lines[0].strip()
    if first_line.startswith("# "):
        metadata["title"] = first_line[2:].strip()
    body_start = 1
    separator_index = None
    for index, raw_line in enumerate(lines[1:], start=1):
        line = raw_line.strip()
        if line == "---":
            separator_index = index
            body_start = index + 1
            break
        if not line:
            continue
        if not line.startswith("- ") or ":" not in line[2:]:
            continue
        key, value = line[2:].split(":", 1)
        metadata[key.strip()] = _normalize_value(value.strip())
    body = "\n".join(lines[body_start:]).lstrip("\n") if separator_index is not None else text
    return metadata, body


def _normalize_value(value: str) -> object:
    if not value:
        return ""
    if value in {"null", "Null", "NULL"}:
        return None
    if value[0] in "[{":
        try:
            return json.loads(value)
        except json.JSONDecodeError:
            return value
    if (value[0] == value[-1]) and value[0] in {"'", '"'} and len(value) >= 2:
        return value[1:-1]
    return value


def _build_campus_services_document_id(collection: str, legacy_document_id: str) -> str:
    suffix = legacy_document_id.split(":")[-1].strip()
    if not suffix:
        raise ValueError("legacy_document_id suffix is required")
    return f"campus_services:{collection}:{suffix}"


def _select_handbook_raw_asset_record(
    *,
    raw_asset_registry: RawAssetRegistry,
    source_corpus: str,
    source_collection: str,
    raw_asset_id: str,
) -> RawAssetRecord:
    records = [
        record
        for record in raw_asset_registry.list_by_scope(source_corpus, source_collection)
        if record.raw_asset_id == raw_asset_id
    ]
    if not records:
        raise ValueError(f"raw asset registry record not found for {source_corpus}/{source_collection}:{raw_asset_id}")
    return max(records, key=lambda record: (record.ingestion_timestamp, record.raw_version_id))


def _retitle_markdown_heading(body: str, *, old_title: str, new_title: str) -> str:
    lines = body.splitlines()
    for index, line in enumerate(lines):
        if not line.strip():
            continue
        if line.strip() == f"# {old_title}":
            lines[index] = f"# {new_title}"
            return "\n".join(lines).rstrip()
        break
    if not body.strip():
        return f"# {new_title}"
    return f"# {new_title}\n\n{body.lstrip()}".rstrip()


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


def _infer_service_catalog_year(front_matter: dict[str, object], *, record: dict[str, object]) -> str:
    for field in ("effective_from", "source_updated_at", "updated_at"):
        year = _infer_year(str(front_matter.get(field) or ""))
        if year != "undated":
            return year
    return _infer_year(str(record.get("updated_at") or ""))


def _infer_year(value: str) -> str:
    match = YEAR_RE.search(value)
    return match.group(1) if match is not None else "undated"


def _legacy_regulations_document_prefix(*, title: str, legacy_document_id: str) -> str:
    suffix = legacy_document_id.split(":")[-1].strip()
    if not suffix:
        raise ValueError("legacy_document_id suffix is required")
    return f"regulations/documents/student_handbook/{title}--{suffix[:8]}/"


def _default_config_root() -> Path:
    return Path(__file__).resolve().parents[4] / "configs" / "ingestion"
