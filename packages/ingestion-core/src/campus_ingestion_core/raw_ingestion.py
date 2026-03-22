from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import time
from typing import Protocol

from campus_contracts import ALLOWED_CORPORA
from campus_ingestion_core.campusrag_ingestion_support import (
    DocumentImportInput,
    ImportReport,
    ObjectStoreWriter,
    S3ObjectStoreWriter,
    load_metadata_from_bytes,
    persist_import_documents,
    resolved_raw_asset,
    utc_now,
    write_import_report,
)
from campus_ingestion_core.corpus_profiles import load_corpus_runtime_profile
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.object_store import build_processed_asset_artifact_key
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
DEFAULT_INGESTION_CORPUS = "student_handbook"
DEFAULT_RAW_INGESTION_ARTIFACT_MODE = "normalized"
ALLOWED_RAW_INGESTION_ARTIFACT_MODES = ("normalized", "provider_only")


@dataclass(frozen=True, slots=True)
class OnlineOcrParseResult:
    provider_result_bytes: bytes
    structured_result_bytes: bytes


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
    def parse_pdf(self, pdf_path: Path) -> OnlineOcrParseResult: ...


class PaddleOcrAsyncClient:
    def __init__(self, settings: OnlineOcrSettings) -> None:
        self._settings = settings

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrParseResult:
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
                return build_online_ocr_parse_result(
                    pdf_path=pdf_path,
                    provider_jsonl_bytes=json_response.content,
                    model=self._settings.model,
                )
            if state == "failed":
                error_message = payload.get("errorMsg") or "online OCR job failed"
                raise RuntimeError(error_message)
            if time.monotonic() >= deadline:
                raise TimeoutError(f"online OCR job {job_id} did not finish before timeout")
            time.sleep(self._settings.poll_seconds)


@dataclass(frozen=True, slots=True)
class RawIngestionSubmitSettings:
    raw_root: Path | None
    source_paths: tuple[Path, ...]
    job_dir: Path
    report_dir: Path
    corpus: str

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "RawIngestionSubmitSettings":
        source = env if env is not None else os.environ
        raw_root_value = (source.get("CAMPUSRAG_RAW_ROOT") or "").strip()
        source_paths = _read_raw_ingestion_source_paths(source)
        if not raw_root_value and not source_paths:
            raise ValueError("CAMPUSRAG_RAW_ROOT or RAW_INGESTION_SOURCE_PATHS is required")
        corpus = _read_ingestion_corpus(source)
        return cls(
            raw_root=Path(raw_root_value) if raw_root_value else None,
            source_paths=source_paths,
            job_dir=Path((source.get("RAW_INGESTION_JOB_DIR") or "./var/ingestion-jobs").strip()),
            report_dir=Path((source.get("IMPORT_REPORT_DIR") or "./var/import-reports").strip()),
            corpus=corpus,
        )


@dataclass(frozen=True, slots=True)
class RawIngestionSubmissionReport:
    job_id: str
    status: str
    submitted_count: int
    pdf_paths: tuple[str, ...]
    job_path: str
    report_path: str


@dataclass(frozen=True, slots=True)
class RawIngestionProcessSettings:
    raw_root: Path | None
    job_path: Path | None
    source_paths: tuple[Path, ...]
    report_dir: Path
    corpus: str
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
        raw_root_value = (source.get("CAMPUSRAG_RAW_ROOT") or "").strip()
        job_path_value = (source.get("RAW_INGESTION_JOB_PATH") or "").strip()
        source_paths = _read_raw_ingestion_source_paths(source)
        if not raw_root_value and not job_path_value and not source_paths:
            raise ValueError("CAMPUSRAG_RAW_ROOT, RAW_INGESTION_JOB_PATH, or RAW_INGESTION_SOURCE_PATHS is required")
        corpus = _read_ingestion_corpus(source)
        profile = load_corpus_runtime_profile(corpus)
        artifact_mode = _read_raw_ingestion_artifact_mode(source)
        split_manifest_path_value = (source.get("INGESTION_SPLIT_MANIFEST_PATH") or "").strip()
        online_ocr = OnlineOcrSettings.from_env(source, required=True)
        if online_ocr is None:
            raise ValueError("OCR_BASE_URL and OCR_API_KEY must be configured together")
        if artifact_mode not in profile.allowed_artifact_modes:
            raise ValueError(
                f"{corpus} does not support RAW_INGESTION_ARTIFACT_MODE={artifact_mode}"
            )
        if artifact_mode == "provider_only" and split_manifest_path_value:
            raise ValueError("provider_only does not support split manifest ingestion")
        if profile.split_manifest_required and not split_manifest_path_value:
            raise ValueError(f"INGESTION_SPLIT_MANIFEST_PATH is required for {corpus} raw ingestion")
        return cls(
            raw_root=Path(raw_root_value) if raw_root_value else None,
            job_path=Path(job_path_value) if job_path_value else None,
            source_paths=source_paths,
            report_dir=Path((source.get("IMPORT_REPORT_DIR") or "./var/import-reports").strip()),
            corpus=corpus,
            artifact_mode=artifact_mode,
            split_manifest_path=Path(split_manifest_path_value) if split_manifest_path_value else None,
            parser_version=DEFAULT_RAW_ONLINE_OCR_PARSER_VERSION,
            embedding_model=(source.get("INGESTION_EMBEDDING_MODEL") or source.get("EMBEDDING_MODEL") or "").strip(),
            cleaning_policy_version=profile.cleaning_policy_version,
            default_campus_scope=(source.get("INGESTION_DEFAULT_CAMPUS_SCOPE") or "").strip() or None,
            online_ocr=online_ocr,
            object_store=ObjectStoreSettings.from_env(source),
        )


def submit_raw_ingestion_job(
    *,
    env: dict[str, str] | None = None,
) -> RawIngestionSubmissionReport:
    settings = RawIngestionSubmitSettings.from_env(env)
    pdf_paths = tuple(str(path) for path in _collect_submit_pdf_paths(settings))
    timestamp = utc_now()
    safe_timestamp = timestamp.replace(":", "").replace("+", "_plus_")
    digest = hashlib.sha256("\n".join(pdf_paths).encode("utf-8")).hexdigest()[:12]
    job_id = f"raw-ingestion-{safe_timestamp}-{digest}"

    job_payload = {
        "job_id": job_id,
        "status": "queued_placeholder",
        "corpus": settings.corpus,
        "raw_root": str(settings.raw_root) if settings.raw_root is not None else None,
        "pdf_paths": list(pdf_paths),
        "submitted_at": timestamp,
    }
    settings.job_dir.mkdir(parents=True, exist_ok=True)
    job_path = settings.job_dir / f"{job_id}.json"
    job_path.write_text(json.dumps(job_payload, ensure_ascii=False, indent=2), encoding="utf-8")

    settings.report_dir.mkdir(parents=True, exist_ok=True)
    report_path = settings.report_dir / f"submit-raw-ingestion-job-{safe_timestamp}.json"
    report_path.write_text(
        json.dumps(
            {
                "job_id": job_id,
                "status": "queued_placeholder",
                "submitted_count": len(pdf_paths),
                "pdf_paths": list(pdf_paths),
                "job_path": str(job_path),
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    return RawIngestionSubmissionReport(
        job_id=job_id,
        status="queued_placeholder",
        submitted_count=len(pdf_paths),
        pdf_paths=pdf_paths,
        job_path=str(job_path),
        report_path=str(report_path),
    )


def process_raw_ingestion_job(
    *,
    env: dict[str, str] | None = None,
    object_store: ObjectStoreWriter | None = None,
    online_ocr: OnlineOcrClient | None = None,
    registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
) -> ImportReport:
    settings = RawIngestionProcessSettings.from_env(env)
    raw_asset_registry = raw_asset_registry or build_raw_asset_registry_from_env(env)
    writer = object_store or S3ObjectStoreWriter(settings.object_store)
    ocr_client = online_ocr or PaddleOcrAsyncClient(settings.online_ocr)
    if settings.artifact_mode == "provider_only":
        return _persist_provider_only_ocr_results(
            settings=settings,
            writer=writer,
            ocr_client=ocr_client,
            raw_asset_registry=raw_asset_registry,
        )

    registry = registry or build_document_registry_from_env(env)
    split_manifest = (
        load_split_manifest(settings.split_manifest_path, expected_corpus=settings.corpus)
        if settings.split_manifest_path is not None
        else None
    )

    documents: list[DocumentImportInput] = []
    errors: list[str] = []
    pdf_paths = _collect_job_pdf_paths(settings)
    if split_manifest is not None and len(pdf_paths) != 1:
        raise ValueError("split manifest ingestion currently expects exactly one source PDF")
    for pdf_path in pdf_paths:
        try:
            parse_result = ocr_client.parse_pdf(pdf_path)
            if split_manifest is None:
                metadata = load_metadata_from_bytes(parse_result.structured_result_bytes)
                documents.append(
                    DocumentImportInput(
                        source_label=str(pdf_path),
                        structured_result_bytes=parse_result.structured_result_bytes,
                        provider_result_bytes=parse_result.provider_result_bytes,
                        metadata=metadata,
                        import_source="raw_online_ocr",
                        corpus=settings.corpus,
                        raw_path=pdf_path,
                        raw_source_uri=f"file://{pdf_path.resolve()}",
                    )
                )
                continue

            documents.extend(
                _build_split_manifest_documents(
                    pdf_path=pdf_path,
                    parse_result=parse_result,
                    split_manifest=split_manifest,
                    writer=writer,
                    object_store=settings.object_store,
                    default_campus_scope=settings.default_campus_scope,
                    corpus=settings.corpus,
                )
            )
        except Exception as exc:
            errors.append(f"{pdf_path}: {exc}")

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
    ocr_client: OnlineOcrClient,
    raw_asset_registry: RawAssetRegistry,
) -> ImportReport:
    success_count = 0
    failed_count = 0
    raw_uploaded_count = 0
    raw_reused_count = 0
    errors: list[str] = []
    timestamp = utc_now()
    uploaded_raw_assets: set[tuple[str, str]] = set()

    for pdf_path in _collect_job_pdf_paths(settings):
        try:
            parse_result = ocr_client.parse_pdf(pdf_path)
            raw_asset = resolved_raw_asset(
                raw_path=pdf_path,
                raw_source_uri=f"file://{pdf_path.resolve()}",
                corpus=settings.corpus,
            )
            if raw_asset is None:
                raise ValueError(f"unable to resolve raw asset for {pdf_path}")

            raw_asset_key = (raw_asset.raw_asset_id, raw_asset.raw_version_id)
            existing_raw_record = raw_asset_registry.get(*raw_asset_key)
            if existing_raw_record is not None or raw_asset_key in uploaded_raw_assets:
                raw_reused_count += 1
            else:
                writer.put_bytes(
                    bucket=settings.object_store.bucket_raw,
                    key=raw_asset.object_key,
                    data=pdf_path.read_bytes(),
                    content_type="application/pdf",
                )
                raw_asset_registry.upsert(
                    RawAssetRecord(
                        raw_asset_id=raw_asset.raw_asset_id,
                        raw_version_id=raw_asset.raw_version_id,
                        corpus=settings.corpus,
                        raw_source_uri=raw_asset.raw_source_uri,
                        content_hash=raw_asset.content_hash,
                        source_filename=raw_asset.source_filename,
                        object_key=raw_asset.object_key,
                        ingestion_timestamp=timestamp,
                        import_source="raw_online_ocr",
                    )
                )
                uploaded_raw_assets.add(raw_asset_key)
                raw_uploaded_count += 1

            provider_result_key = build_processed_asset_artifact_key(
                corpus=settings.corpus,
                raw_asset_id=raw_asset.raw_asset_id,
                raw_version_id=raw_asset.raw_version_id,
                filename="provider-result.jsonl",
            )
            writer.put_bytes(
                bucket=settings.object_store.bucket_processed,
                key=provider_result_key,
                data=parse_result.provider_result_bytes,
                content_type="application/x-ndjson",
            )
            success_count += 1
        except Exception as exc:
            failed_count += 1
            errors.append(f"{pdf_path}: {exc}")

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
    pdf_path: Path,
    parse_result: OnlineOcrParseResult,
    split_manifest: SplitManifest,
    writer: ObjectStoreWriter,
    object_store: ObjectStoreSettings,
    default_campus_scope: str | None,
    corpus: str,
) -> list[DocumentImportInput]:
    raw_source_uri = f"file://{pdf_path.resolve()}"
    raw_asset = resolved_raw_asset(
        raw_path=pdf_path,
        raw_source_uri=raw_source_uri,
        corpus=corpus,
        raw_asset_id_override=split_manifest.raw_asset_id,
    )
    if raw_asset is None:
        raise ValueError(f"unable to resolve raw asset for {pdf_path}")
    provider_result_key, structured_full_key = _write_processed_asset_artifacts(
        writer=writer,
        object_store=object_store,
        corpus=corpus,
        raw_asset_id=raw_asset.raw_asset_id,
        raw_version_id=raw_asset.raw_version_id,
        provider_result_bytes=parse_result.provider_result_bytes,
        structured_result_bytes=parse_result.structured_result_bytes,
    )
    structured_rows = _load_structured_rows(parse_result.structured_result_bytes)
    return [
        _build_split_manifest_document_input(
            pdf_path=pdf_path,
            raw_source_uri=raw_source_uri,
            raw_asset_id=raw_asset.raw_asset_id,
            raw_version_id=raw_asset.raw_version_id,
            manifest_version=split_manifest.manifest_version,
            manifest_document=document,
            structured_rows=structured_rows,
            provider_result_key=provider_result_key,
            structured_full_key=structured_full_key,
            default_campus_scope=default_campus_scope,
            corpus=corpus,
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
    provider_result_bytes: bytes,
    structured_result_bytes: bytes,
) -> tuple[str, str]:
    provider_result_key = build_processed_asset_artifact_key(
        corpus=corpus,
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        filename="provider-result.jsonl",
    )
    structured_full_key = build_processed_asset_artifact_key(
        corpus=corpus,
        raw_asset_id=raw_asset_id,
        raw_version_id=raw_version_id,
        filename="structured-full.jsonl",
    )
    writer.put_bytes(
        bucket=object_store.bucket_processed,
        key=provider_result_key,
        data=provider_result_bytes,
        content_type="application/x-ndjson",
    )
    writer.put_bytes(
        bucket=object_store.bucket_processed,
        key=structured_full_key,
        data=structured_result_bytes,
        content_type="application/x-ndjson",
    )
    return provider_result_key, structured_full_key


def _build_split_manifest_document_input(
    *,
    pdf_path: Path,
    raw_source_uri: str,
    raw_asset_id: str,
    raw_version_id: str,
    manifest_version: str,
    manifest_document: SplitManifestDocument,
    structured_rows: list[dict[str, object]],
    provider_result_key: str,
    structured_full_key: str,
    default_campus_scope: str | None,
    corpus: str,
) -> DocumentImportInput:
    version_id = _build_split_version_id(
        raw_version_id=raw_version_id,
        manifest_version=manifest_version,
        manifest_document=manifest_document,
    )
    split_rows = _slice_structured_rows_for_manifest_document(
        structured_rows=structured_rows,
        manifest_document=manifest_document,
        document_id=manifest_document.document_id,
        version_id=version_id,
        source_pdf=pdf_path.name,
    )
    structured_result_bytes = _serialize_rows(split_rows)
    metadata = load_metadata_from_bytes(structured_result_bytes)
    metadata["campus_scope"] = manifest_document.campus_scope or default_campus_scope
    metadata["status"] = manifest_document.status
    return DocumentImportInput(
        source_label=f"{pdf_path}#{manifest_document.document_id}",
        structured_result_bytes=structured_result_bytes,
        provider_result_bytes=None,
        metadata=metadata,
        import_source="raw_online_ocr",
        corpus=corpus,
        campus_scope=manifest_document.campus_scope or default_campus_scope,
        status=manifest_document.status,
        raw_path=pdf_path,
        raw_source_uri=raw_source_uri,
        raw_asset_id=raw_asset_id,
        provider_result_object_key=provider_result_key,
        additional_processed_object_keys=(structured_full_key,),
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


def _load_structured_rows(structured_result_bytes: bytes) -> list[dict[str, object]]:
    rows: list[dict[str, object]] = []
    for line in structured_result_bytes.decode("utf-8").splitlines():
        stripped = line.strip()
        if not stripped:
            continue
        payload = json.loads(stripped)
        if not isinstance(payload, dict):
            raise ValueError("structured OCR row must be a JSON object")
        rows.append(payload)
    if not rows:
        raise ValueError("structured OCR result is empty")
    return rows


def _slice_structured_rows_for_manifest_document(
    *,
    structured_rows: list[dict[str, object]],
    manifest_document: SplitManifestDocument,
    document_id: str,
    version_id: str,
    source_pdf: str,
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
        _transform_split_row(
            row=row,
            document_id=document_id,
            version_id=version_id,
            source_pdf=source_pdf,
            source_uri=manifest_document.source_uri,
            acl_groups=manifest_document.acl_groups,
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


def _row_belongs_to_page_range(*, row: dict[str, object], page_start: int, page_end: int) -> bool:
    if str(row.get("chunk_id") or "") == "document-0000":
        return False
    row_page_start = row.get("page_start")
    row_page_end = row.get("page_end")
    if not isinstance(row_page_start, int) or not isinstance(row_page_end, int):
        return False
    return row_page_start >= page_start and row_page_end <= page_end


def _transform_split_row(
    *,
    row: dict[str, object],
    document_id: str,
    version_id: str,
    source_pdf: str,
    source_uri: str,
    acl_groups: tuple[str, ...],
) -> dict[str, object]:
    transformed = dict(row)
    transformed["doc_id"] = document_id
    transformed["version_id"] = version_id
    transformed["source_pdf"] = source_pdf
    transformed["source_url"] = source_uri
    transformed["source_md"] = None
    transformed["source"] = {"id": source_uri}
    transformed["acl"] = {"level": "public", "allow_groups": list(acl_groups)}
    return transformed


def _serialize_rows(rows: list[dict[str, object]]) -> bytes:
    return ("\n".join(json.dumps(row, ensure_ascii=False) for row in rows) + "\n").encode("utf-8")


def build_online_ocr_parse_result(
    *,
    pdf_path: Path,
    provider_jsonl_bytes: bytes,
    model: str,
) -> OnlineOcrParseResult:
    provider_jsonl = provider_jsonl_bytes.decode("utf-8")
    raw_lines = [line.strip() for line in provider_jsonl.splitlines() if line.strip()]
    if not raw_lines:
        raise ValueError(f"online OCR result for {pdf_path.name} is empty")

    slug = slugify_filename(pdf_path.name)
    document_id = f"handbook:{slug}"
    raw_hash = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
    version_id = f"sha256:{raw_hash}"
    page_payloads: list[dict[str, object]] = []
    merged_text_parts: list[str] = []

    for index, line in enumerate(raw_lines, start=1):
        provider_payload = json.loads(line)
        result_payload = provider_payload.get("result") or {}
        page_text = extract_online_ocr_text(result_payload)
        if page_text:
            merged_text_parts.append(page_text)
        page_payloads.append(
            {
                "doc_id": document_id,
                "version_id": version_id,
                "chunk_id": f"page-{index:04d}",
                "clean_text": page_text,
                "source_url": f"file://{pdf_path.resolve()}",
                "source_md": None,
                "source": {"id": str(pdf_path.resolve())},
                "source_pdf": pdf_path.name,
                "page_start": index,
                "page_end": index,
                "acl": {"level": "public", "allow_groups": []},
                "ocr_provider": "paddleocr_async",
                "ocr_model": model,
            }
        )

    summary = dict(page_payloads[0])
    summary["chunk_id"] = "document-0000"
    summary["clean_text"] = "\n\n".join(part for part in merged_text_parts if part)
    summary["page_start"] = 1
    summary["page_end"] = len(page_payloads)

    lines = [json.dumps(summary, ensure_ascii=False)]
    lines.extend(json.dumps(page_payload, ensure_ascii=False) for page_payload in page_payloads)
    return OnlineOcrParseResult(
        provider_result_bytes=provider_jsonl_bytes,
        structured_result_bytes=("\n".join(lines) + "\n").encode("utf-8"),
    )


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


def _read_ingestion_corpus(source: dict[str, str]) -> str:
    corpus = (source.get("INGESTION_CORPUS") or DEFAULT_INGESTION_CORPUS).strip() or DEFAULT_INGESTION_CORPUS
    if corpus not in ALLOWED_CORPORA:
        raise ValueError(f"unsupported corpus: {corpus}")
    return corpus


def _read_raw_ingestion_artifact_mode(source: dict[str, str]) -> str:
    mode = (source.get("RAW_INGESTION_ARTIFACT_MODE") or DEFAULT_RAW_INGESTION_ARTIFACT_MODE).strip().lower()
    normalized_mode = mode or DEFAULT_RAW_INGESTION_ARTIFACT_MODE
    if normalized_mode not in ALLOWED_RAW_INGESTION_ARTIFACT_MODES:
        raise ValueError(f"unsupported RAW_INGESTION_ARTIFACT_MODE: {normalized_mode}")
    return normalized_mode


def _collect_job_pdf_paths(settings: RawIngestionProcessSettings) -> tuple[Path, ...]:
    if settings.source_paths:
        return settings.source_paths
    if settings.job_path is not None:
        payload = json.loads(settings.job_path.read_text(encoding="utf-8"))
        payload_corpus = str(payload.get("corpus") or "").strip()
        if payload_corpus and payload_corpus != settings.corpus:
            raise ValueError(
                f"raw ingestion job corpus mismatch: expected {settings.corpus}, got {payload_corpus}"
            )
        pdf_paths = tuple(Path(value) for value in payload.get("pdf_paths") or [])
        if pdf_paths:
            return pdf_paths
    if settings.raw_root is None:
        return ()
    return tuple(
        path
        for path in sorted(settings.raw_root.iterdir())
        if path.is_file() and path.suffix.lower() == ".pdf"
    )


def _collect_submit_pdf_paths(settings: RawIngestionSubmitSettings) -> tuple[Path, ...]:
    if settings.source_paths:
        return settings.source_paths
    if settings.raw_root is None:
        return ()
    return tuple(
        path
        for path in sorted(settings.raw_root.iterdir())
        if path.is_file() and path.suffix.lower() == ".pdf"
    )


def _read_raw_ingestion_source_paths(source: dict[str, str]) -> tuple[Path, ...]:
    raw = (source.get("RAW_INGESTION_SOURCE_PATHS") or "").strip()
    if not raw:
        return ()
    paths: list[Path] = []
    for part in raw.split(","):
        normalized = part.strip()
        if not normalized:
            continue
        path = Path(normalized)
        if not path.is_absolute():
            raise ValueError("RAW_INGESTION_SOURCE_PATHS entries must be absolute paths")
        paths.append(path)
    return tuple(paths)
