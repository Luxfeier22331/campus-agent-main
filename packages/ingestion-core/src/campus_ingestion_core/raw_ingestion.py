from __future__ import annotations

import base64
from campus_contracts import DEFAULT_POLICY_PROJECTION_VERSION
from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
from tempfile import TemporaryDirectory
import time
from typing import Any, Protocol
from urllib.parse import urlparse

from campus_ingestion_core.artifacts import (
    LAYOUT_ELEMENTS_FILENAME,
    PROVIDER_RESPONSE_FILENAME,
)
from campus_ingestion_core.campusrag_ingestion_support import (
    DocumentImportInput,
    ImportReport,
    ObjectStoreWriter,
    S3ObjectStoreWriter,
    apply_authorization_projection_metadata,
    build_registered_raw_asset_ref,
    load_metadata_from_bytes,
    persist_import_documents,
    utc_now,
    write_import_report,
)
from campus_ingestion_core.curriculum_provider_normalize import normalize_curriculum_provider_result
from campus_ingestion_core.curriculum_course_facts_projection import (
    build_curriculum_course_facts_scope_refresh_documents,
)
from campus_ingestion_core.curriculum_program_family_facts_projection import (
    build_curriculum_program_family_facts_scope_refresh_documents,
)
from campus_ingestion_core.curriculum_program_semester_facts_projection import (
    build_curriculum_program_semester_facts_scope_refresh_documents,
)
from campus_ingestion_core.curriculum_title_normalization import canonicalize_curriculum_manifest_heading
from campus_ingestion_core.corpus_profiles import load_runtime_profile
from campus_ingestion_core.handbook_source_projections import build_handbook_projection_import_documents
from campus_ingestion_core.handbook_cleanup import (
    cleanup_handbook_document,
    validate_handbook_manifest_title,
    serialize_handbook_document_units,
)
from campus_ingestion_core.handbook_provider_normalize import (
    normalize_handbook_provider_result,
    serialize_handbook_layout_elements,
)
from campus_ingestion_core.models import RawAssetRecord
from campus_ingestion_core.object_store import (
    build_source_model_slug,
    build_source_ocr_artifact_key,
    build_source_truth_artifact_key,
    infer_year_label,
)
from campus_ingestion_core.registry import (
    DocumentRegistry,
    RawAssetRegistry,
    build_document_registry_from_env,
    build_raw_asset_registry_from_env,
)
from campus_ingestion_core.settings import ObjectStoreSettings
from campus_ingestion_core.scope_catalog import assert_known_scope
from campus_ingestion_core.split_manifest import SplitManifest, SplitManifestDocument, load_split_manifest


DEFAULT_ONLINE_OCR_MODEL = "PaddleOCR-VL-1.5"
DEFAULT_ONLINE_OCR_POLL_SECONDS = 5
DEFAULT_ONLINE_OCR_TIMEOUT_SECONDS = 300
DEFAULT_ONLINE_OCR_RESULT_READY_GRACE_SECONDS = 15
DEFAULT_RAW_ONLINE_OCR_PARSER_VERSION = "paddleocr-vl-1.5"
DEFAULT_RAW_INGESTION_ARTIFACT_MODE = "normalized"
ALLOWED_RAW_INGESTION_ARTIFACT_MODES = ("normalized", "source_truth_only")
ONLINE_OCR_PROVIDER_ASYNC_JOBS = "paddleocr_async_jobs"
ONLINE_OCR_PROVIDER_LAYOUT_PARSING_SERVICE = "paddleocr_vl_service"
DEFAULT_ONLINE_OCR_PROVIDER = ONLINE_OCR_PROVIDER_ASYNC_JOBS
NORMALIZED_ONLINE_OCR_PROVIDER_ASYNC = "paddleocr_async"
SPLIT_MANIFEST_LAYOUT_ELEMENTS_SCHEMA_VERSION = "split_manifest_layout_elements_v1"


@dataclass(frozen=True, slots=True)
class OnlineOcrProviderResult:
    provider_result_bytes: bytes


class OnlineOcrProviderContractError(RuntimeError):
    def __init__(
        self,
        *,
        file_name: str,
        job_id: str,
        state: str,
        json_url: str | None,
        elapsed_seconds: float,
        status_code: int | None,
        response_text: str | None,
        status_payload: dict[str, Any] | None = None,
    ) -> None:
        self.file_name = file_name
        self.job_id = job_id
        self.state = state
        self.json_url = json_url
        self.elapsed_seconds = elapsed_seconds
        self.status_code = status_code
        self.response_text = response_text
        self.status_payload = status_payload
        details: list[str] = [
            f"file={file_name}",
            f"job_id={job_id}",
            f"state={state}",
            f"elapsed_seconds={elapsed_seconds:.2f}",
        ]
        if status_code is not None:
            details.append(f"status_code={status_code}")
        if json_url:
            details.append(f"json_url={json_url}")
        if response_text:
            details.append(f"response_text={response_text[:200]}")
        super().__init__(
            "online OCR provider returned an unusable resultUrl after reporting done: "
            + ", ".join(details)
        )


@dataclass(frozen=True, slots=True)
class RawIngestionRequest:
    raw_asset_id: str
    raw_version_id: str
    corpus: str
    collection: str
    artifact_mode: str = DEFAULT_RAW_INGESTION_ARTIFACT_MODE
    split_manifest_path: Path | None = None
    report_dir: Path = Path("./var/import-reports")
    default_visibility_scope: str | None = None

    def __post_init__(self) -> None:
        if not self.raw_asset_id:
            raise ValueError("raw_asset_id is required")
        if not self.raw_version_id:
            raise ValueError("raw_version_id is required")
        assert_known_scope(self.corpus, self.collection)
        if self.artifact_mode not in ALLOWED_RAW_INGESTION_ARTIFACT_MODES:
            raise ValueError(f"unsupported artifact_mode: {self.artifact_mode}")


@dataclass(frozen=True, slots=True)
class OnlineOcrSettings:
    base_url: str
    api_key: str
    model: str = DEFAULT_ONLINE_OCR_MODEL
    provider: str = DEFAULT_ONLINE_OCR_PROVIDER
    poll_seconds: int = DEFAULT_ONLINE_OCR_POLL_SECONDS
    timeout_seconds: int = DEFAULT_ONLINE_OCR_TIMEOUT_SECONDS
    result_ready_grace_seconds: int = DEFAULT_ONLINE_OCR_RESULT_READY_GRACE_SECONDS

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
        provider = _resolve_online_ocr_provider_mode(
            base_url=base_url,
            provider_override=source.get("OCR_PROVIDER_MODE"),
        )
        poll_seconds = max(1, int((source.get("OCR_POLL_SECONDS") or str(DEFAULT_ONLINE_OCR_POLL_SECONDS)).strip()))
        timeout_seconds = max(
            poll_seconds,
            int((source.get("OCR_TIMEOUT_SECONDS") or str(DEFAULT_ONLINE_OCR_TIMEOUT_SECONDS)).strip()),
        )
        result_ready_grace_seconds = max(
            poll_seconds,
            int(
                (
                    source.get("OCR_RESULT_READY_GRACE_SECONDS")
                    or str(DEFAULT_ONLINE_OCR_RESULT_READY_GRACE_SECONDS)
                ).strip()
            ),
        )
        return cls(
            base_url=base_url,
            api_key=api_key,
            model=model,
            provider=provider,
            poll_seconds=poll_seconds,
            timeout_seconds=timeout_seconds,
            result_ready_grace_seconds=min(timeout_seconds, result_ready_grace_seconds),
        )


class OnlineOcrClient(Protocol):
    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult: ...
    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult: ...


class ObjectStoreReader(Protocol):
    def get_bytes(self, *, bucket: str, key: str) -> bytes: ...


class PaddleOcrAsyncClient:
    def __init__(self, settings: OnlineOcrSettings) -> None:
        self._settings = settings

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        return self.parse_file(pdf_path)

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        try:
            import requests
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("requests is required to use the online OCR service") from exc

        start_monotonic = time.monotonic()
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
        with file_path.open("rb") as file_obj:
            response = requests.post(
                self._settings.base_url,
                headers=headers,
                data=data,
                files={"file": file_obj},
                timeout=self._settings.timeout_seconds,
            )
        response.raise_for_status()
        job_id = response.json()["data"]["jobId"]

        deadline = start_monotonic + self._settings.timeout_seconds
        while True:
            status_response = requests.get(
                f"{self._settings.base_url}/{job_id}",
                headers=headers,
                timeout=self._settings.timeout_seconds,
            )
            status_response.raise_for_status()
            status_payload = status_response.json()
            payload = status_payload["data"]
            state = payload["state"]
            if state == "done":
                result_url_payload = payload.get("resultUrl") or {}
                json_url = result_url_payload.get("jsonUrl")
                if not json_url:
                    raise OnlineOcrProviderContractError(
                        file_name=file_path.name,
                        job_id=str(job_id),
                        state=str(state),
                        json_url=None,
                        elapsed_seconds=time.monotonic() - start_monotonic,
                        status_code=None,
                        response_text=None,
                        status_payload=status_payload,
                    )
                result_deadline = time.monotonic() + self._settings.result_ready_grace_seconds
                while True:
                    json_response = requests.get(
                        json_url,
                        timeout=self._settings.timeout_seconds,
                    )
                    if json_response.status_code == 404:
                        if time.monotonic() >= result_deadline:
                            raise OnlineOcrProviderContractError(
                                file_name=file_path.name,
                                job_id=str(job_id),
                                state=str(state),
                                json_url=str(json_url),
                                elapsed_seconds=time.monotonic() - start_monotonic,
                                status_code=json_response.status_code,
                                response_text=json_response.text,
                                status_payload=status_payload,
                            )
                        time.sleep(self._settings.poll_seconds)
                        continue
                    json_response.raise_for_status()
                    return OnlineOcrProviderResult(
                        provider_result_bytes=json_response.content
                    )
            if state == "failed":
                error_message = payload.get("errorMsg") or "online OCR job failed"
                raise RuntimeError(error_message)
            if time.monotonic() >= deadline:
                raise TimeoutError(f"online OCR job {job_id} did not finish before timeout")
            time.sleep(self._settings.poll_seconds)


class PaddleOcrLayoutParsingServiceClient:
    def __init__(self, settings: OnlineOcrSettings) -> None:
        self._settings = settings

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        return self.parse_file(pdf_path)

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        try:
            import requests
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("requests is required to use the online OCR service") from exc

        payload = {
            "file": base64.b64encode(file_path.read_bytes()).decode("ascii"),
            "fileType": _layout_parsing_file_type(file_path),
            "restructurePages": False,
            "visualize": False,
            "useDocOrientationClassify": False,
            "useDocUnwarping": False,
            "useChartRecognition": False,
        }
        response = requests.post(
            _resolve_layout_parsing_url(self._settings.base_url),
            headers={"Authorization": f"bearer {self._settings.api_key}"},
            json=payload,
            timeout=self._settings.timeout_seconds,
        )
        response.raise_for_status()
        result_payload = _require_layout_parsing_result_payload(
            response_payload=response.json(),
            file_name=file_path.name,
        )
        return OnlineOcrProviderResult(
            provider_result_bytes=(
                json.dumps({"result": result_payload}, ensure_ascii=False) + "\n"
            ).encode("utf-8")
        )


def build_online_ocr_client(settings: OnlineOcrSettings) -> OnlineOcrClient:
    if settings.provider == ONLINE_OCR_PROVIDER_ASYNC_JOBS:
        return PaddleOcrAsyncClient(settings)
    if settings.provider == ONLINE_OCR_PROVIDER_LAYOUT_PARSING_SERVICE:
        return PaddleOcrLayoutParsingServiceClient(settings)
    raise ValueError(f"unsupported OCR provider mode: {settings.provider}")


def _resolve_online_ocr_provider_mode(
    *,
    base_url: str,
    provider_override: str | None,
) -> str:
    normalized_override = str(provider_override or "").strip().lower()
    if normalized_override:
        if normalized_override not in {
            ONLINE_OCR_PROVIDER_ASYNC_JOBS,
            ONLINE_OCR_PROVIDER_LAYOUT_PARSING_SERVICE,
        }:
            raise ValueError(f"unsupported OCR_PROVIDER_MODE: {provider_override}")
        return normalized_override
    path = urlparse(base_url).path.rstrip("/").lower()
    if path.endswith("/jobs"):
        return ONLINE_OCR_PROVIDER_ASYNC_JOBS
    return ONLINE_OCR_PROVIDER_LAYOUT_PARSING_SERVICE


def _resolve_layout_parsing_url(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    if normalized.lower().endswith("/layout-parsing"):
        return normalized
    return f"{normalized}/layout-parsing"


def normalize_online_ocr_provider_label(provider: str) -> str:
    normalized = str(provider or "").strip().lower()
    if normalized in {"", NORMALIZED_ONLINE_OCR_PROVIDER_ASYNC, ONLINE_OCR_PROVIDER_ASYNC_JOBS}:
        return NORMALIZED_ONLINE_OCR_PROVIDER_ASYNC
    if normalized == ONLINE_OCR_PROVIDER_LAYOUT_PARSING_SERVICE:
        return ONLINE_OCR_PROVIDER_LAYOUT_PARSING_SERVICE
    return normalized


def _require_layout_parsing_result_payload(
    *,
    response_payload: object,
    file_name: str,
) -> dict[str, object]:
    if not isinstance(response_payload, dict):
        raise RuntimeError(
            f"online OCR layout-parsing response for {file_name} must be a JSON object"
        )
    result_payload = response_payload.get("result")
    if not isinstance(result_payload, dict):
        raise RuntimeError(
            f"online OCR layout-parsing response for {file_name} is missing result"
        )
    layout_results = result_payload.get("layoutParsingResults")
    if not isinstance(layout_results, list) or not layout_results:
        raise RuntimeError(
            f"online OCR layout-parsing response for {file_name} is missing layoutParsingResults"
        )
    if not all(isinstance(item, dict) for item in layout_results):
        raise RuntimeError(
            f"online OCR layout-parsing response for {file_name} contains non-object layoutParsingResults entries"
        )
    return result_payload


def _layout_parsing_file_type(file_path: Path) -> int:
    suffix = file_path.suffix.strip().lower()
    if suffix == ".pdf":
        return 0
    return 1


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
    default_visibility_scope: str | None
    online_ocr: OnlineOcrSettings
    object_store: ObjectStoreSettings

    @classmethod
    def from_request(
        cls,
        request: RawIngestionRequest,
        env: dict[str, str] | None = None,
    ) -> "RawIngestionProcessSettings":
        source = env if env is not None else os.environ
        profile = load_runtime_profile(request.corpus, request.collection)
        online_ocr = OnlineOcrSettings.from_env(source, required=True)
        if online_ocr is None:
            raise ValueError("OCR_BASE_URL and OCR_API_KEY must be configured together")
        if request.artifact_mode not in profile.allowed_artifact_modes:
            raise ValueError(
                f"{request.corpus}/{request.collection} does not support artifact_mode={request.artifact_mode}"
            )
        if request.artifact_mode == "source_truth_only" and request.split_manifest_path is not None:
            raise ValueError("source_truth_only does not support split manifest ingestion")
        if (
            request.artifact_mode != "source_truth_only"
            and profile.split_manifest_required
            and request.split_manifest_path is None
        ):
            raise ValueError(
                f"split_manifest_path is required for {request.corpus}/{request.collection} raw ingestion"
            )
        return cls(
            raw_asset_id=request.raw_asset_id,
            raw_version_id=request.raw_version_id,
            report_dir=request.report_dir,
            corpus=request.corpus,
            collection=request.collection,
            artifact_mode=request.artifact_mode,
            split_manifest_path=request.split_manifest_path,
            parser_version=DEFAULT_RAW_ONLINE_OCR_PARSER_VERSION,
            embedding_model=(source.get("INGESTION_EMBEDDING_MODEL") or source.get("EMBEDDING_MODEL") or "").strip(),
            cleaning_policy_version=profile.cleaning_policy_version,
            default_visibility_scope=request.default_visibility_scope,
            online_ocr=online_ocr,
            object_store=ObjectStoreSettings.from_env(source),
        )

def process_raw_ingestion_job(
    *,
    request: RawIngestionRequest,
    env: dict[str, str] | None = None,
    object_store: ObjectStoreWriter | ObjectStoreReader | None = None,
    online_ocr: OnlineOcrClient | None = None,
    registry: DocumentRegistry | None = None,
    raw_asset_registry: RawAssetRegistry | None = None,
) -> ImportReport:
    source = dict(env if env is not None else os.environ)
    settings = RawIngestionProcessSettings.from_request(request, source)
    ocr_provider = normalize_online_ocr_provider_label(settings.online_ocr.provider)
    raw_asset_registry = raw_asset_registry or build_raw_asset_registry_from_env(source)
    writer = object_store or S3ObjectStoreClient(settings.object_store)
    if not hasattr(writer, "get_bytes"):
        raise TypeError("object_store must support get_bytes for process_raw_ingestion_job")
    ocr_client = online_ocr or build_online_ocr_client(settings.online_ocr)
    raw_asset_record = _resolve_registered_raw_asset(settings=settings, raw_asset_registry=raw_asset_registry)
    if settings.artifact_mode == "source_truth_only":
        return _persist_source_truth_only_ocr_results(
            settings=settings,
            writer=writer,
            reader=writer,  # type: ignore[arg-type]
            ocr_client=ocr_client,
            raw_asset_registry=raw_asset_registry,
            raw_asset_record=raw_asset_record,
        )

    registry = registry or build_document_registry_from_env(source)
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
    if split_manifest.raw_asset_id != raw_asset_record.raw_asset_id:
        raise ValueError(
            "split manifest raw_asset_id mismatch: "
            f"expected {raw_asset_record.raw_asset_id}, got {split_manifest.raw_asset_id}"
        )

    documents: list[DocumentImportInput] = []
    errors: list[str] = []
    try:
        provider_result = _parse_registered_raw_asset(
            raw_asset_record=raw_asset_record,
            reader=writer,  # type: ignore[arg-type]
            bucket=settings.object_store.bucket_source,
            ocr_client=ocr_client,
        )

        if settings.collection == "student_handbook":
            handbook_documents, handbook_errors = _build_handbook_split_manifest_documents(
                raw_asset_record=raw_asset_record,
                provider_result=provider_result,
                split_manifest=split_manifest,
                writer=writer,
                object_store=settings.object_store,
                default_visibility_scope=settings.default_visibility_scope,
                corpus=settings.corpus,
                collection=settings.collection,
                ocr_provider=ocr_provider,
                ocr_model=settings.online_ocr.model,
                source=source,
            )
            documents.extend(handbook_documents)
            errors.extend(handbook_errors)
        else:
            documents.extend(
                _build_split_manifest_documents(
                    raw_asset_record=raw_asset_record,
                    provider_result=provider_result,
                    split_manifest=split_manifest,
                    writer=writer,
                    object_store=settings.object_store,
                    default_visibility_scope=settings.default_visibility_scope,
                    corpus=settings.corpus,
                    collection=settings.collection,
                    ocr_provider=ocr_provider,
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
        default_visibility_scope=settings.default_visibility_scope,
        import_mode="raw_ingestion",
        report_dir=settings.report_dir,
        report_prefix="process-raw-ingestion-job",
        initial_errors=errors,
    )


def _persist_source_truth_only_ocr_results(
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
            bucket=settings.object_store.bucket_source,
            ocr_client=ocr_client,
        )
        raw_reused_count = 1 if raw_asset_registry.get(raw_asset_record.raw_asset_id, raw_asset_record.raw_version_id) else 0
        provider_response_key = build_source_ocr_artifact_key(
            raw_asset_id=raw_asset_record.raw_asset_id,
            raw_version_id=raw_asset_record.raw_version_id,
            filename=PROVIDER_RESPONSE_FILENAME,
            model_slug=build_source_model_slug(settings.online_ocr.model),
            year=infer_year_label(raw_asset_record.source_filename),
        )
        writer.put_bytes(
            bucket=settings.object_store.bucket_source,
            key=provider_response_key,
            data=parse_result.provider_result_bytes,
            content_type="application/x-ndjson",
        )
        layout_elements_bytes: bytes | None = None
        if settings.collection == "curriculum_plan":
            layout_elements_bytes = normalize_curriculum_provider_result(
                provider_jsonl_bytes=parse_result.provider_result_bytes,
                source_pdf=raw_asset_record.source_filename,
                ocr_provider=normalize_online_ocr_provider_label(settings.online_ocr.provider),
                ocr_model=settings.online_ocr.model,
            )
        elif settings.collection == "student_handbook":
            layout_elements_bytes = serialize_handbook_layout_elements(
                normalize_handbook_provider_result(
                    source_pdf=raw_asset_record.source_filename,
                    provider_jsonl_bytes=parse_result.provider_result_bytes,
                    ocr_provider=normalize_online_ocr_provider_label(settings.online_ocr.provider),
                    ocr_model=settings.online_ocr.model,
                    source_artifact_id=raw_asset_record.raw_asset_id,
                )
            )
        if layout_elements_bytes is not None:
            layout_elements_key = build_source_truth_artifact_key(
                raw_asset_id=raw_asset_record.raw_asset_id,
                raw_version_id=raw_asset_record.raw_version_id,
                filename=LAYOUT_ELEMENTS_FILENAME,
                year=infer_year_label(raw_asset_record.source_filename),
            )
            writer.put_bytes(
                bucket=settings.object_store.bucket_source,
                key=layout_elements_key,
                data=layout_elements_bytes,
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
    default_visibility_scope: str | None,
    corpus: str,
    collection: str,
    ocr_provider: str,
    ocr_model: str,
) -> list[DocumentImportInput]:
    if collection == "curriculum_plan":
        structured_rows = _load_layout_elements_rows(
            normalize_curriculum_provider_result(
                provider_jsonl_bytes=provider_result.provider_result_bytes,
                source_pdf=raw_asset_record.source_filename,
                ocr_provider=ocr_provider,
                ocr_model=ocr_model,
            )
        )
    else:
        structured_rows = _normalize_split_manifest_provider_result(
            corpus=corpus,
            collection=collection,
            source_pdf=raw_asset_record.source_filename,
            provider_jsonl_bytes=provider_result.provider_result_bytes,
            ocr_provider=ocr_provider,
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
        ocr_model=ocr_model,
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
            default_visibility_scope=default_visibility_scope,
            corpus=corpus,
            collection=collection,
        )
        for document in split_manifest.documents
    ]


def _build_handbook_split_manifest_documents(
    *,
    source: dict[str, str],
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
) -> tuple[list[DocumentImportInput], list[str]]:
    structured_rows = normalize_handbook_provider_result(
        source_pdf=raw_asset_record.source_filename,
        provider_jsonl_bytes=provider_result.provider_result_bytes,
        ocr_provider=ocr_provider,
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
        ocr_model=ocr_model,
        provider_response_bytes=provider_result.provider_result_bytes,
        layout_elements_bytes=layout_elements_bytes,
    )
    documents: list[DocumentImportInput] = []
    errors: list[str] = []
    for document in split_manifest.documents:
        try:
            documents.append(
                _build_handbook_manifest_document_input(
                    raw_asset_record=raw_asset_record,
                    manifest_document=document,
                    structured_rows=structured_rows,
                    provider_response_key=provider_response_key,
                    layout_elements_key=layout_elements_key,
                    default_visibility_scope=default_visibility_scope,
                    corpus=corpus,
                    collection=collection,
                )
            )
        except Exception as exc:
            errors.append(f"{raw_asset_record.object_key}#{document.document_id}: {exc}")
    if collection == "student_handbook":
        try:
            documents.extend(
                build_handbook_projection_import_documents(
                    source=source,
                    raw_asset_record=raw_asset_record,
                    provider_response_key=provider_response_key,
                    layout_elements_key=layout_elements_key,
                    structured_rows=structured_rows,
                    split_manifest_documents=split_manifest.documents,
                )
            )
        except Exception as exc:
            errors.append(f"{raw_asset_record.object_key}#declared-projections: {exc}")
    if collection == "curriculum_plan":
        try:
            documents.extend(
                build_curriculum_course_facts_scope_refresh_documents(
                    raw_asset_record=raw_asset_record,
                    source_pdf=raw_asset_record.source_filename,
                    split_manifest_documents=split_manifest.documents,
                    structured_rows=structured_rows,
                    provider_response_key=provider_response_key,
                    layout_elements_key=layout_elements_key,
                    import_source="raw_online_ocr",
                )
            )
        except Exception as exc:
            errors.append(f"{raw_asset_record.object_key}#course-facts-projection: {exc}")
        try:
            documents.extend(
                build_curriculum_program_family_facts_scope_refresh_documents(
                    raw_asset_record=raw_asset_record,
                    source_pdf=raw_asset_record.source_filename,
                    split_manifest_documents=split_manifest.documents,
                    import_source="raw_online_ocr",
                )
            )
        except Exception as exc:
            errors.append(f"{raw_asset_record.object_key}#program-family-facts-projection: {exc}")
        try:
            documents.extend(
                build_curriculum_program_semester_facts_scope_refresh_documents(
                    raw_asset_record=raw_asset_record,
                    source_pdf=raw_asset_record.source_filename,
                    split_manifest_documents=split_manifest.documents,
                    structured_rows=structured_rows,
                    provider_response_key=provider_response_key,
                    layout_elements_key=layout_elements_key,
                    import_source="raw_online_ocr",
                )
            )
        except Exception as exc:
            errors.append(f"{raw_asset_record.object_key}#program-semester-facts-projection: {exc}")
    return documents, errors


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


def _build_handbook_manifest_document_input(
    *,
    raw_asset_record: RawAssetRecord,
    manifest_document: SplitManifestDocument,
    structured_rows: list[dict[str, object]],
    provider_response_key: str,
    layout_elements_key: str,
    default_visibility_scope: str | None,
    corpus: str,
    collection: str,
) -> DocumentImportInput:
    validate_handbook_manifest_title(
        structured_rows=structured_rows,
        manifest_document=manifest_document,
    )
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
        canonical_markdown_bytes=cleanup_result.canonical_markdown.encode("utf-8"),
        metadata=metadata,
        import_source="raw_online_ocr",
        revision_track="source-faithful",
        source_channel="pdf_ocr",
        is_current=True,
        corpus=corpus,
        collection=collection,
        visibility_scope=manifest_document.resolved_visibility_scope(default_visibility_scope),
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
    default_visibility_scope: str | None,
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
        canonical_markdown_bytes=None,
        metadata=metadata,
        import_source="raw_online_ocr",
        revision_track="source-faithful",
        source_channel="pdf_ocr",
        is_current=True,
        corpus=corpus,
        collection=collection,
        visibility_scope=manifest_document.resolved_visibility_scope(default_visibility_scope),
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
        f"campusrag://source/{corpus}/{raw_asset_slug}/{raw_version_path}/capture/pages/{page_start}-{page_end}"
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
                manifest_title=manifest_document.title,
                version_id=version_id,
                source_pdf=source_pdf,
                source_uri=source_uri,
                entitlement_groups=manifest_document.resolved_entitlement_groups(),
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
    manifest_title: str,
    version_id: str,
    source_pdf: str,
    source_uri: str,
    entitlement_groups: tuple[str, ...],
) -> dict[str, object] | None:
    page_start = int(row["page_start"])
    page_end = int(row["page_end"])
    clean_text = _split_manifest_row_text(row)
    if not clean_text:
        return None
    clean_text = canonicalize_curriculum_manifest_heading(
        row=row,
        clean_text=clean_text,
        manifest_title=manifest_title,
    )
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
