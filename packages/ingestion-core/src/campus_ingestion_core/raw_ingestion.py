from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import time
from typing import Protocol

from campus_contracts import (
    ALLOWED_CORPORA,
    DEFAULT_COLLECTION,
    DEFAULT_CORPUS,
    KNOWN_COLLECTION_TO_CORPUS,
)
from campus_ingestion_core.artifacts import (
    LAYOUT_ELEMENTS_FILENAME,
    PROVIDER_RESPONSE_FILENAME,
)
from campus_ingestion_core.campusrag_ingestion_support import (
    DocumentImportInput,
    ImportReport,
    ObjectStoreWriter,
    S3ObjectStoreWriter,
    build_registered_raw_asset_ref,
    load_metadata_from_bytes,
    persist_import_documents,
    utc_now,
    write_import_report,
)
from campus_ingestion_core.curriculum_provider_normalize import normalize_curriculum_provider_result
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.handbook_cleanup import (
    cleanup_handbook_document,
    serialize_handbook_document_units,
)
from campus_ingestion_core.handbook_provider_normalize import (
    normalize_handbook_provider_result,
    serialize_handbook_layout_elements,
)
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.object_store import build_processed_asset_artifact_key, infer_year_label
from campus_ingestion_core.registry import (
    DocumentRegistry,
    RawAssetRegistry,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.split_manifest import SplitManifest, SplitManifestDocument, load_split_manifest


DEFAULT_ONLINE_OCR_MODEL = "PaddleOCR-VL-1.5"
DEFAULT_ONLINE_OCR_POLL_SECONDS = 5
DEFAULT_ONLINE_OCR_TIMEOUT_SECONDS = 300
DEFAULT_RAW_ONLINE_OCR_PARSER_VERSION = "paddleocr-vl-1.5"
DEFAULT_INGESTION_CORPUS = DEFAULT_CORPUS
DEFAULT_INGESTION_COLLECTION = DEFAULT_COLLECTION
DEFAULT_RAW_INGESTION_ARTIFACT_MODE = "normalized"
ALLOWED_RAW_INGESTION_ARTIFACT_MODES = ("normalized", "provider_only")
DEFAULT_ONLINE_OCR_PROVIDER = "paddleocr_async"
SPLIT_MANIFEST_LAYOUT_ELEMENTS_SCHEMA_VERSION = "split_manifest_layout_elements_v1"


@dataclass(frozen=True, slots=True)
class OnlineOcrProviderResult:
    provider_result_bytes: bytes


@dataclass(frozen=True, slots=True)
class OnlineOcrSettings:
    base_url: str
    api_key: str
    model: str = DEFAULT_ONLINE_OCR_MODEL
    poll_seconds: int = DEFAULT_ONLINE_OCR_POLL_SECONDS
    timeout_seconds: int = DEFAULT_ONLINE_OCR_TIMEOUT_SECONDS

    @classmethod
    def from_env(
        cls,
        env: dict[str, str] | None = None,
        *,
        required: bool = False,
    ) -> "OnlineOcrSettings | None":
        source = env if env is not None else os.environ
        base_url = (source.get("OCR_BASE_URL") or "").strip()
        api_key = (source.get("OCR_API_KEY") or "").strip()
        if not base_url and not api_key:
            if required:
                raise ValueError("OCR_BASE_URL and OCR_API_KEY must be configured together")
            return None
        if not base_url or not api_key:
            raise ValueError("OCR_BASE_URL and OCR_API_KEY must be configured together")
        model = (source.get("OCR_MODEL") or DEFAULT_ONLINE_OCR_MODEL).strip() or DEFAULT_ONLINE_OCR_MODEL
        poll_seconds = max(1, int((source.get("OCR_POLL_SECONDS") or str(DEFAULT_ONLINE_OCR_POLL_SECONDS)).strip()))
        timeout_seconds = max(
            poll_seconds,
            int((source.get("OCR_TIMEOUT_SECONDS") or str(DEFAULT_ONLINE_OCR_TIMEOUT_SECONDS)).strip()),
        )
        return cls(
            base_url=base_url,
            api_key=api_key,
            model=model,
            poll_seconds=poll_seconds,
            timeout_seconds=timeout_seconds,
        )


class OnlineOcrClient(Protocol):
    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult: ...


class ObjectStoreReader(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


class PaddleOcrAsyncClient:
    def __init__(self, settings: OnlineOcrSettings) -> None:
        self._settings = settings

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        try:
            import requests
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("requests is required to use the online OCR service") from exc

        headers = {"Authorization": f"bearer {self._settings.api_key}"}
        data = {
            "model": self._settings.model,
            "optionalPayload": json.dumps(
                {
                    "useDocOrientationClassify": False,
                    "useDocUnwarping": False,
                    "useChartRecognition": False,
                }
            ),
        }
        with pdf_path.open("rb") as file_obj:
            response = requests.post(
                self._settings.base_url,
                headers=headers,
                data=data,
                files={"file": file_obj},
                timeout=self._settings.timeout_seconds,
            )
        response.raise_for_status()
        job_id = response.json()["data"]["jobId"]

        deadline = time.monotonic() + self._settings.timeout_seconds
        while True:
            status_response = requests.get(
                f"{self._settings.base_url}/{job_id}",
                headers=headers,
                timeout=self._settings.timeout_seconds,
            )
            status_response.raise_for_status()
            payload = status_response.json()["data"]
            state = payload["state"]
            if state == "done":
                json_url = payload["resultUrl"]["jsonUrl"]
                json_response = requests.get(json_url, timeout=self._settings.timeout_seconds)
                json_response.raise_for_status()
                return OnlineOcrProviderResult(provider_result_bytes=json_response.content)
            if state == "failed":
                error_message = payload.get("errorMsg") or "online OCR job failed"
                raise RuntimeError(error_message)
            if time.monotonic() >= deadline:
                raise TimeoutError(f"online OCR job {job_id} did not finish before timeout")
            time.sleep(self._settings.poll_seconds)


@dataclass(frozen=True, slots=True)
class RawIngestionProcessSettings:
    raw_asset_id: str
    raw_version_id: str
    report_dir: Path
    corpus: str
    collection: str
    artifact_mode: str
    split_manifest_path: Path | None
    parser_version: str
    embedding_model: str
    cleaning_policy_version: str
    default_campus_scope: str | None
    online_ocr: OnlineOcrSettings
    object_store: ObjectStoreSettings

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "RawIngestionProcessSettings":
        source = env if env is not None else os.environ
        raw_asset_id = (source.get("RAW_ASSET_ID") or "").strip()
        raw_version_id = (source.get("RAW_VERSION_ID") or "").strip()
        if not raw_asset_id or not raw_version_id:
            raise ValueError("RAW_ASSET_ID and RAW_VERSION_ID are required")
        corpus = _read_ingestion_corpus(source)
        collection = _read_ingestion_collection(source, corpus=corpus)
        profile = load_runtime_profile(corpus, collection)
        artifact_mode = _read_raw_ingestion_artifact_mode(source)
        split_manifest_path_value = (source.get("INGESTION_SPLIT_MANIFEST_PATH") or "").strip()
        online_ocr = OnlineOcrSettings.from_env(source, required=True)
        if online_ocr is None:
            raise ValueError("OCR_BASE_URL and OCR_API_KEY must be configured together")
        if artifact_mode not in profile.allowed_artifact_modes:
            raise ValueError(
                f"{corpus}/{collection} does not support RAW_INGESTION_ARTIFACT_MODE={artifact_mode}"
            )
        if artifact_mode == "provider_only" and split_manifest_path_value:
            raise ValueError("provider_only does not support split manifest ingestion")
        if artifact_mode != "provider_only" and profile.split_manifest_required and not split_manifest_path_value:
            raise ValueError(
                f"INGESTION_SPLIT_MANIFEST_PATH is required for {corpus}/{collection} raw ingestion"
            )
        return cls(
            raw_asset_id=raw_asset_id,
            raw_version_id=raw_version_id,
            report_dir=Path((source.get("IMPORT_REPORT_DIR") or "./var/import-reports").strip()),
            corpus=corpus,
            collection=collection,
            artifact_mode=artifact_mode,
            split_manifest_path=Path(split_manifest_path_value) if split_manifest_path_value else None,
            parser_version=DEFAULT_RAW_ONLINE_OCR_PARSER_VERSION,
            embedding_model=(source.get("INGESTION_EMBEDDING_MODEL") or source.get("EMBEDDING_MODEL") or "").strip(),
            cleaning_policy_version=profile.cleaning_policy_version,
            default_campus_scope=(source.get("INGESTION_DEFAULT_CAMPUS_SCOPE") or "").strip() or None,
            online_ocr=online_ocr,
            object_store=ObjectStoreSettings.from_env(source),
        )

def process_raw_ingestion_job(
    *,
    env: dict[str, str] | None = None,
    object_store: ObjectStoreWriter | ObjectStoreReader | None = None,
    online_ocr: OnlineOcrClient | None = None,
    registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
) -> ImportReport:
    settings = RawIngestionProcessSettings.from_env(env)
    raw_asset_registry = raw_asset_registry or build_raw_asset_registry_from_env(env)
    writer = object_store or S3ObjectStoreClient(settings.object_store)
    if not hasattr(writer, "get_bytes"):
        raise TypeError("object_store must support get_bytes for process_raw_ingestion_job")
    ocr_client = online_ocr or PaddleOcrAsyncClient(settings.online_ocr)
    raw_asset_record = _resolve_registered_raw_asset(settings=settings, raw_asset_registry=raw_asset_registry)
    if settings.artifact_mode == "provider_only":
        return _persist_provider_only_ocr_results(
            settings=settings,
            writer=writer,
            reader=writer,  # type: ignore[arg-type]
            ocr_client=ocr_client,
            raw_asset_registry=raw_asset_registry,
            raw_asset_record=raw_asset_record,
        )

    registry = registry or build_document_registry_from_env(env)
    split_manifest = (
        load_split_manifest(
            settings.split_manifest_path,
            expected_corpus=settings.corpus,
            expected_collection=settings.collection,
        )
        if settings.split_manifest_path is not None
        else None
    )
    if split_manifest is None:
        raise ValueError(
            "INGESTION_SPLIT_MANIFEST_PATH is required for "
            f"{settings.corpus}/{settings.collection} raw ingestion"
        )

    documents: list[DocumentImportInput] = []
    errors: list[str] = []
    try:
        provider_result = _parse_registered_raw_asset(
            raw_asset_record=raw_asset_record,
            reader=writer,  # type: ignore[arg-type]
            bucket=settings.object_store.bucket_raw,
            ocr_client=ocr_client,
        )

        if settings.collection == "student_handbook":
            documents.extend(
                _build_handbook_split_manifest_documents(
                    raw_asset_record=raw_asset_record,
                    provider_result=provider_result,
                    split_manifest=split_manifest,
                    writer=writer,
                    object_store=settings.object_store,
                    default_campus_scope=settings.default_campus_scope,
                    corpus=settings.corpus,
                    collection=settings.collection,
                    ocr_model=settings.online_ocr.model,
                )
            )
        else:
            documents.extend(
                _build_split_manifest_documents(
                    raw_asset_record=raw_asset_record,
                    provider_result=provider_result,
                    split_manifest=split_manifest,
                    writer=writer,
                    object_store=settings.object_store,
                    default_campus_scope=settings.default_campus_scope,
                    corpus=settings.corpus,
                    collection=settings.collection,
                    ocr_model=settings.online_ocr.model,
                )
            )
    except Exception as exc:
        errors.append(f"{raw_asset_record.object_key}: {exc}")

    return persist_import_documents(
        documents=documents,
        registry=registry,
        raw_asset_registry=raw_asset_registry,
        writer=writer,
        object_store=settings.object_store,
        parser_version=settings.parser_version,
        embedding_model=settings.embedding_model,
        cleaning_policy_version=settings.cleaning_policy_version,
        default_campus_scope=settings.default_campus_scope,
        import_mode="raw_ingestion",
        report_dir=settings.report_dir,
        report_prefix="process-raw-ingestion-job",
        initial_errors=errors,
    )


def _persist_provider_only_ocr_results(
    *,
    settings: RawIngestionProcessSettings,
    writer: ObjectStoreWriter,
    reader: ObjectStoreReader,
    ocr_client: OnlineOcrClient,
    raw_asset_registry: RawAssetRegistry,
    raw_asset_record: RawAssetRecord,
) -> ImportReport:
    success_count = 0
    failed_count = 0
    raw_uploaded_count = 0
    raw_reused_count = 0
    errors: list[str] = []
    timestamp = utc_now()
    try:
        parse_result = _parse_registered_raw_asset(
            raw_asset_record=raw_asset_record,
            reader=reader,
            bucket=settings.object_store.bucket_raw,
            ocr_client=ocr_client,
        )
        raw_reused_count = 1 if raw_asset_registry.get(raw_asset_record.raw_asset_id, raw_asset_record.raw_version_id) else 0
        provider_response_key = build_processed_asset_artifact_key(
            corpus=settings.corpus,
            raw_asset_id=raw_asset_record.raw_asset_id,
            raw_version_id=raw_asset_record.raw_version_id,
            filename=PROVIDER_RESPONSE_FILENAME,
            year=infer_year_label(raw_asset_record.source_filename),
        )
        writer.put_bytes(
            bucket=settings.object_store.bucket_processed,
            key=provider_response_key,
            data=parse_result.provider_result_bytes,
            content_type="application/x-ndjson",
        )
        success_count = 1
    except Exception as exc:
        failed_count = 1
        errors.append(f"{raw_asset_record.object_key}: {exc}")

    return write_import_report(
        import_mode="raw_ingestion",
        report_dir=settings.report_dir,
        report_prefix="process-raw-ingestion-job",
        success_count=success_count,
        skipped_count=0,
        failed_count=failed_count,
        raw_uploaded_count=raw_uploaded_count,
        raw_reused_count=raw_reused_count,
        document_ids=(),
        unresolved_source_pdfs=(),
        errors=tuple(errors),
        timestamp=timestamp,
    )


def _build_split_manifest_documents(
    *,
    raw_asset_record: RawAssetRecord,
    provider_result: OnlineOcrProviderResult,
    split_manifest: SplitManifest,
    writer: ObjectStoreWriter,
    object_store: ObjectStoreSettings,
    default_campus_scope: str | None,
    corpus: str,
    collection: str,
    ocr_model: str,
) -> list[DocumentImportInput]:
    if collection == "curriculum_plan":
        structured_rows = _load_structured_rows(
            normalize_curriculum_provider_result(
                provider_jsonl_bytes=provider_result.provider_result_bytes,
                source_pdf=raw_asset_record.source_filename,
                ocr_model=ocr_model,
            )
        )
    else:
        structured_rows = _normalize_split_manifest_provider_result(
            corpus=corpus,
            collection=collection,
            source_pdf=raw_asset_record.source_filename,
            provider_jsonl_bytes=provider_result.provider_result_bytes,
            ocr_provider=DEFAULT_ONLINE_OCR_PROVIDER,
            ocr_model=ocr_model,
            source_artifact_id=raw_asset_record.raw_asset_id,
        )
    layout_elements_bytes = _serialize_rows(structured_rows)
    provider_response_key, layout_elements_key = _write_processed_asset_artifacts(
        writer=writer,
        object_store=object_store,
        corpus=corpus,
        raw_asset_id=raw_asset_record.raw_asset_id,
        raw_version_id=raw_asset_record.raw_version_id,
        source_filename=raw_asset_record.source_filename,
        provider_response_bytes=provider_result.provider_result_bytes,
        layout_elements_bytes=layout_elements_bytes,
    )
    return [
        _build_split_manifest_document_input(
            raw_asset_record=raw_asset_record,
            manifest_version=split_manifest.manifest_version,
            manifest_document=document,
            structured_rows=structured_rows,
            provider_response_key=provider_response_key,
            layout_elements_key=layout_elements_key,
            default_campus_scope=default_campus_scope,
            corpus=corpus,
            collection=collection,
        )
        for document in split_manifest.documents
    ]


def _build_handbook_split_manifest_documents(
    *,
    raw_asset_record: RawAssetRecord,
    provider_result: OnlineOcrProviderResult,
    split_manifest: SplitManifest,
    writer: ObjectStoreWriter,
    object_store: ObjectStoreSettings,
    default_campus_scope: str | None,
    corpus: str,
    collection: str,
    ocr_model: str,
) -> list[DocumentImportInput]:
    structured_rows = normalize_handbook_provider_result(
        source_pdf=raw_asset_record.source_filename,
        provider_jsonl_bytes=provider_result.provider_result_bytes,
        ocr_provider=DEFAULT_ONLINE_OCR_PROVIDER,
        ocr_model=ocr_model,
        source_artifact_id=raw_asset_record.raw_asset_id,
    )
    layout_elements_bytes = serialize_handbook_layout_elements(structured_rows)
    provider_response_key, layout_elements_key = _write_processed_asset_artifacts(
        writer=writer,
        object_store=object_store,
        corpus=corpus,
        raw_asset_id=raw_asset_record.raw_asset_id,
        raw_version_id=raw_asset_record.raw_version_id,
        source_filename=raw_asset_record.source_filename,
        provider_response_bytes=provider_result.provider_result_bytes,
        layout_elements_bytes=layout_elements_bytes,
    )
    return [
        _build_handbook_manifest_document_input(
            raw_asset_record=raw_asset_record,
            manifest_document=document,
            structured_rows=structured_rows,
            provider_response_key=provider_response_key,
            layout_elements_key=layout_elements_key,
            default_campus_scope=default_campus_scope,
            corpus=corpus,
            collection=collection,
        )
        for document in split_manifest.documents
    ]


def _write_processed_asset_artifacts(
    *,
    writer: ObjectStoreWriter,
    object_store: ObjectStoreSettings,
    corpus: str,
    raw_asset_id: str,
    raw_version_id: str,
    source_filename: str,
    provider_response_bytes: bytes,
    layout_elements_bytes: bytes,
) -> tuple[str, str]:
    year = infer_year_label(source_filename)
    provider_response_key = build_processed_asset_artifact_key(
        corpus=corpus,
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        filename=PROVIDER_RESPONSE_FILENAME,
        year=year,
    )
    layout_elements_key = build_processed_asset_artifact_key(
        corpus=corpus,
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        filename=LAYOUT_ELEMENTS_FILENAME,
        year=year,
    )
    writer.put_bytes(
        bucket=object_store.bucket_processed,
        key=provider_response_key,
        data=provider_response_bytes,
        content_type="application/x-ndjson",
    )
    writer.put_bytes(
        bucket=object_store.bucket_processed,
        key=layout_elements_key,
        data=layout_elements_bytes,
        content_type="application/x-ndjson",
    )
    return provider_response_key, layout_elements_key


def _build_handbook_manifest_document_input(
    *,
    raw_asset_record: RawAssetRecord,
    manifest_document: SplitManifestDocument,
    structured_rows: list[dict[str, object]],
    provider_response_key: str,
    layout_elements_key: str,
    default_campus_scope: str | None,
    corpus: str,
    collection: str,
) -> DocumentImportInput:
    cleanup_result = cleanup_handbook_document(
        structured_rows=structured_rows,
        manifest_document=manifest_document,
        source_doc=raw_asset_record.source_filename,
    )
    document_units_bytes = serialize_handbook_document_units(cleanup_result.document_units)
    metadata = load_metadata_from_bytes(document_units_bytes)
    metadata["title"] = cleanup_result.title
    metadata["raw_page_start"] = manifest_document.page_start
    metadata["raw_page_end"] = manifest_document.page_end
    metadata["campus_scope"] = manifest_document.campus_scope or default_campus_scope
    metadata["status"] = manifest_document.status
    return DocumentImportInput(
        source_label=f"{raw_asset_record.object_key}#{manifest_document.document_id}",
        document_units_bytes=document_units_bytes,
        provider_response_bytes=None,
        canonical_markdown_bytes=cleanup_result.canonical_markdown.encode("utf-8"),
        metadata=metadata,
        import_source="raw_online_ocr",
        revision_track="source-faithful",
        source_channel="pdf_ocr",
        is_current=False,
        corpus=corpus,
        collection=collection,
        campus_scope=manifest_document.campus_scope or default_campus_scope,
        status=manifest_document.status,
        raw_path=None,
        raw_source_uri=raw_asset_record.raw_source_uri,
        raw_asset_id=raw_asset_record.raw_asset_id,
        raw_version_id=raw_asset_record.raw_version_id,
        provider_response_object_key=provider_response_key,
        additional_processed_object_keys=(layout_elements_key,),
        title=cleanup_result.title,
    )


def _build_split_manifest_document_input(
    *,
    raw_asset_record: RawAssetRecord,
    manifest_version: str,
    manifest_document: SplitManifestDocument,
    structured_rows: list[dict[str, object]],
    provider_response_key: str,
    layout_elements_key: str,
    default_campus_scope: str | None,
    corpus: str,
    collection: str,
) -> DocumentImportInput:
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
    )
    document_units_bytes = _serialize_rows(split_rows)
    metadata = load_metadata_from_bytes(document_units_bytes)
    metadata["title"] = manifest_document.title
    metadata["campus_scope"] = manifest_document.campus_scope or default_campus_scope
    metadata["status"] = manifest_document.status
    return DocumentImportInput(
        source_label=f"{raw_asset_record.object_key}#{manifest_document.document_id}",
        document_units_bytes=document_units_bytes,
        provider_response_bytes=None,
        canonical_markdown_bytes=None,
        metadata=metadata,
        import_source="raw_online_ocr",
        revision_track="source-faithful",
        source_channel="pdf_ocr",
        is_current=False,
        corpus=corpus,
        collection=collection,
        campus_scope=manifest_document.campus_scope or default_campus_scope,
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
    return (
        f"campusrag://source/{corpus}/{raw_asset_slug}/{raw_version_path}/pages/{page_start}-{page_end}"
    )


def _slice_structured_rows_for_manifest_document(
    *,
    structured_rows: list[dict[str, object]],
    manifest_document: SplitManifestDocument,
    document_id: str,
    version_id: str,
    source_pdf: str,
    source_uri: str,
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

    transformed_rows = [
        transformed
        for row in selected_rows
        for transformed in (
            _transform_split_row(
                row=row,
                document_id=document_id,
                version_id=version_id,
                source_pdf=source_pdf,
                source_uri=source_uri,
                acl_groups=manifest_document.acl_groups,
            ),
        )
        if transformed is not None
    ]
    if not transformed_rows:
        raise ValueError(
            f"split manifest document {manifest_document.document_id} does not contain any indexable OCR rows"
        )
    return transformed_rows


def _transform_split_row(
    *,
    row: dict[str, object],
    document_id: str,
    version_id: str,
    source_pdf: str,
    source_uri: str,
    acl_groups: tuple[str, ...],
) -> dict[str, object] | None:
    page_start = int(row["page_start"])
    page_end = int(row["page_end"])
    clean_text = _split_manifest_row_text(row)
    if not clean_text:
        return None
    source_chunk_id = _normalize_optional_text(row.get("chunk_id")) or f"page-{page_start:04d}"
    return {
        "doc_id": document_id,
        "version_id": version_id,
        "chunk_id": source_chunk_id,
        "row_id": _normalize_optional_text(row.get("row_id")) or source_chunk_id,
        "row_type": _normalize_optional_text(row.get("row_type")) or "paragraph",
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
        "acl": {
            "level": "restricted" if acl_groups else "public",
            "allow_groups": list(acl_groups),
        },
    }


def _row_belongs_to_page_range(*, row: dict[str, object], page_start: int, page_end: int) -> bool:
    row_page_start = row.get("page_start")
    row_page_end = row.get("page_end")
    if not isinstance(row_page_start, int) or not isinstance(row_page_end, int):
        return False
    return row_page_start >= page_start and row_page_end <= page_end


def _serialize_rows(rows: list[dict[str, object]]) -> bytes:
    return ("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n").encode("utf-8")


def _load_structured_rows(file_bytes: bytes) -> list[dict[str, object]]:
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


def extract_online_ocr_text(result_payload: dict[str, object]) -> str:
    layout_results = result_payload.get("layoutParsingResults")
    if not isinstance(layout_results, list):
        return ""
    texts: list[str] = []
    for item in layout_results:
        if not isinstance(item, dict):
            continue
        markdown = item.get("markdown")
        if not isinstance(markdown, dict):
            continue
        text = markdown.get("text")
        if isinstance(text, str) and text.strip():
            texts.append(text.strip())
    return "\n\n".join(texts)


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
    for field_name in ("clean_text", "text_normalized", "text_raw", "html"):
        value = row.get(field_name)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return ""


def _normalize_optional_text(value: object) -> str | None:
    if not isinstance(value, str):
        return None
    normalized = value.strip()
    return normalized or None


def _read_ingestion_corpus(source: dict[str, str]) -> str:
    corpus = (source.get("INGESTION_CORPUS") or DEFAULT_INGESTION_CORPUS).strip() or DEFAULT_INGESTION_CORPUS
    if corpus not in ALLOWED_CORPORA:
        raise ValueError(f"unsupported corpus: {corpus}")
    return corpus


def _read_ingestion_collection(source: dict[str, str], *, corpus: str) -> str:
    collection = (
        source.get("INGESTION_COLLECTION") or DEFAULT_INGESTION_COLLECTION
    ).strip() or DEFAULT_INGESTION_COLLECTION
    expected_corpus = KNOWN_COLLECTION_TO_CORPUS.get(collection)
    if expected_corpus is not None and expected_corpus != corpus:
        raise ValueError(f"unsupported collection scope: {collection} does not belong to {corpus}")
    return collection


def _read_raw_ingestion_artifact_mode(source: dict[str, str]) -> str:
    mode = (source.get("RAW_INGESTION_ARTIFACT_MODE") or DEFAULT_RAW_INGESTION_ARTIFACT_MODE).strip().lower()
    normalized_mode = mode or DEFAULT_RAW_INGESTION_ARTIFACT_MODE
    if normalized_mode not in ALLOWED_RAW_INGESTION_ARTIFACT_MODES:
        raise ValueError(f"unsupported RAW_INGESTION_ARTIFACT_MODE: {normalized_mode}")
    return normalized_mode


def _resolve_registered_raw_asset(
    *,
    settings: RawIngestionProcessSettings,
    raw_asset_registry: RawAssetRegistry,
) -> RawAssetRecord:
    record = raw_asset_registry.get(settings.raw_asset_id, settings.raw_version_id)
    if record is None:
        raise ValueError("registered raw asset not found")
    if record.corpus != settings.corpus:
        raise ValueError(f"registered raw asset corpus mismatch: expected {settings.corpus}, got {record.corpus}")
    if record.collection != settings.collection:
        raise ValueError(
            "registered raw asset collection mismatch: "
            f"expected {settings.collection}, got {record.collection}"
        )
    return record


def _parse_registered_raw_asset(
    *,
    raw_asset_record: RawAssetRecord,
    reader: ObjectStoreReader,
    bucket: str,
    ocr_client: OnlineOcrClient,
) -> OnlineOcrProviderResult:
    pdf_bytes = reader.get_bytes(bucket=bucket, key=raw_asset_record.object_key)
    with TemporaryDirectory() as temp_dir:
        pdf_path = Path(temp_dir) / raw_asset_record.source_filename
        pdf_path.write_bytes(pdf_bytes)
        return ocr_client.parse_pdf(pdf_path)


class S3ObjectStoreClient(S3ObjectStoreWriter):
    def __init__(self, settings: ObjectStoreSettings) -> None:
        super().__init__(settings)

    def get_bytes(self, *, bucket: str, key: str) -> bytes:
        response = self._client.get_object(Bucket=bucket, Key=key)
        return response["Body"].read()
