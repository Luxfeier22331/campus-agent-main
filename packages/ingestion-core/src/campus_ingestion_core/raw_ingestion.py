from __future__ import annotations

from dataclasses import dataclass
import hashlib
import json
import os
from pathlib import Path
import time
from typing import Protocol

from campus_ingestion_core.campusrag_ingestion_support import (
    DocumentImportInput,
    ImportReport,
    ObjectStoreWriter,
    S3ObjectStoreWriter,
    load_metadata_from_bytes,
    persist_import_documents,
    utc_now,
)
from campus_ingestion_core.registry import FileDocumentRegistry
from campus_ingestion_core.settings import ObjectStoreSettings


DEFAULT_ONLINE_OCR_MODEL = "PaddleOCR-VL-1.5"
DEFAULT_ONLINE_OCR_POLL_SECONDS = 5
DEFAULT_ONLINE_OCR_TIMEOUT_SECONDS = 300
DEFAULT_RAW_ONLINE_OCR_PARSER_VERSION = "paddleocr-vl-1.5"


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
    raw_root: Path
    job_dir: Path
    report_dir: Path

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "RawIngestionSubmitSettings":
        source = env if env is not None else os.environ
        raw_root_value = (source.get("CAMPUSRAG_RAW_ROOT") or "").strip()
        if not raw_root_value:
            raise ValueError("CAMPUSRAG_RAW_ROOT is required")
        return cls(
            raw_root=Path(raw_root_value),
            job_dir=Path((source.get("RAW_INGESTION_JOB_DIR") or "./var/ingestion-jobs").strip()),
            report_dir=Path((source.get("IMPORT_REPORT_DIR") or "./var/import-reports").strip()),
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
    registry_path: Path
    report_dir: Path
    parser_version: str
    embedding_model: str
    default_campus_scope: str | None
    online_ocr: OnlineOcrSettings
    object_store: ObjectStoreSettings

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "RawIngestionProcessSettings":
        source = env if env is not None else os.environ
        raw_root_value = (source.get("CAMPUSRAG_RAW_ROOT") or "").strip()
        job_path_value = (source.get("RAW_INGESTION_JOB_PATH") or "").strip()
        if not raw_root_value and not job_path_value:
            raise ValueError("CAMPUSRAG_RAW_ROOT or RAW_INGESTION_JOB_PATH is required")
        online_ocr = OnlineOcrSettings.from_env(source, required=True)
        if online_ocr is None:
            raise ValueError("OCR_BASE_URL and OCR_API_KEY must be configured together")
        return cls(
            raw_root=Path(raw_root_value) if raw_root_value else None,
            job_path=Path(job_path_value) if job_path_value else None,
            registry_path=Path(
                (source.get("DOCUMENT_REGISTRY_PATH") or "./var/registry/student_handbook.json").strip()
            ),
            report_dir=Path((source.get("IMPORT_REPORT_DIR") or "./var/import-reports").strip()),
            parser_version=DEFAULT_RAW_ONLINE_OCR_PARSER_VERSION,
            embedding_model=(source.get("INGESTION_EMBEDDING_MODEL") or source.get("EMBEDDING_MODEL") or "").strip(),
            default_campus_scope=(source.get("DEFAULT_CAMPUS_SCOPE") or "").strip() or None,
            online_ocr=online_ocr,
            object_store=ObjectStoreSettings.from_env(source),
        )


def submit_raw_ingestion_job(
    *,
    env: dict[str, str] | None = None,
) -> RawIngestionSubmissionReport:
    settings = RawIngestionSubmitSettings.from_env(env)
    pdf_paths = tuple(
        str(path)
        for path in sorted(settings.raw_root.iterdir())
        if path.is_file() and path.suffix.lower() == ".pdf"
    )
    timestamp = utc_now()
    safe_timestamp = timestamp.replace(":", "").replace("+", "_plus_")
    digest = hashlib.sha256("\n".join(pdf_paths).encode("utf-8")).hexdigest()[:12]
    job_id = f"raw-ingestion-{safe_timestamp}-{digest}"

    job_payload = {
        "job_id": job_id,
        "status": "queued_placeholder",
        "corpus": "student_handbook",
        "raw_root": str(settings.raw_root),
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
) -> ImportReport:
    settings = RawIngestionProcessSettings.from_env(env)
    registry = FileDocumentRegistry(settings.registry_path)
    writer = object_store or S3ObjectStoreWriter(settings.object_store)
    ocr_client = online_ocr or PaddleOcrAsyncClient(settings.online_ocr)

    documents: list[DocumentImportInput] = []
    errors: list[str] = []
    for pdf_path in _collect_job_pdf_paths(settings):
        try:
            parse_result = ocr_client.parse_pdf(pdf_path)
            metadata = load_metadata_from_bytes(parse_result.structured_result_bytes)
        except Exception as exc:
            errors.append(f"{pdf_path}: {exc}")
            continue
        documents.append(
            DocumentImportInput(
                source_label=str(pdf_path),
                structured_result_bytes=parse_result.structured_result_bytes,
                provider_result_bytes=parse_result.provider_result_bytes,
                metadata=metadata,
                import_source="raw_online_ocr",
                raw_path=pdf_path,
            )
        )

    return persist_import_documents(
        documents=documents,
        registry=registry,
        writer=writer,
        object_store=settings.object_store,
        parser_version=settings.parser_version,
        embedding_model=settings.embedding_model,
        default_campus_scope=settings.default_campus_scope,
        import_mode="raw_ingestion",
        report_dir=settings.report_dir,
        report_prefix="process-raw-ingestion-job",
        initial_errors=errors,
    )


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


def _collect_job_pdf_paths(settings: RawIngestionProcessSettings) -> tuple[Path, ...]:
    if settings.job_path is not None:
        payload = json.loads(settings.job_path.read_text(encoding="utf-8"))
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
