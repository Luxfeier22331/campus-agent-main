from __future__ import annotations

import base64
import hashlib
import json
import os
import time
from dataclasses import dataclass
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Protocol
from urllib.parse import urlparse

DEFAULT_ONLINE_OCR_MODEL = "PaddleOCR-VL-1.5"
DEFAULT_ONLINE_OCR_POLL_SECONDS = 5
DEFAULT_ONLINE_OCR_TIMEOUT_SECONDS = 300
DEFAULT_ONLINE_OCR_RESULT_READY_GRACE_SECONDS = 15
ONLINE_OCR_PROVIDER_ASYNC_JOBS = "paddleocr_async_jobs"
ONLINE_OCR_PROVIDER_LAYOUT_PARSING_SERVICE = "paddleocr_vl_service"
ONLINE_OCR_PROVIDER_MINERU_API = "mineru_api"
DEFAULT_ONLINE_OCR_PROVIDER = ONLINE_OCR_PROVIDER_ASYNC_JOBS
NORMALIZED_ONLINE_OCR_PROVIDER_ASYNC = "paddleocr_async"
DEFAULT_MINERU_ONLINE_OCR_MODEL = "vlm"
DEFAULT_ONLINE_OCR_LANGUAGE = "ch"


@dataclass(frozen=True, slots=True)
class OnlineOcrProviderResult:
    provider_result_bytes: bytes
    metadata: dict[str, object] | None = None


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
class OnlineOcrSettings:
    base_url: str
    api_key: str
    model: str = DEFAULT_ONLINE_OCR_MODEL
    provider: str = DEFAULT_ONLINE_OCR_PROVIDER
    language: str = DEFAULT_ONLINE_OCR_LANGUAGE
    enable_formula: bool = True
    force_ocr: bool = True
    poll_seconds: int = DEFAULT_ONLINE_OCR_POLL_SECONDS
    timeout_seconds: int = DEFAULT_ONLINE_OCR_TIMEOUT_SECONDS
    result_ready_grace_seconds: int = DEFAULT_ONLINE_OCR_RESULT_READY_GRACE_SECONDS

    @classmethod
    def from_env(
        cls,
        env: dict[str, str] | None = None,
        *,
        required: bool = False,
        prefix: str = "OCR_",
        default_provider: str | None = None,
    ) -> "OnlineOcrSettings | None":
        source = env if env is not None else os.environ
        normalized_prefix = prefix if prefix.endswith("_") else f"{prefix}_"
        base_url_key = f"{normalized_prefix}BASE_URL"
        api_key_key = f"{normalized_prefix}API_KEY"
        provider_mode_key = f"{normalized_prefix}PROVIDER_MODE"
        model_key = f"{normalized_prefix}MODEL"
        language_key = f"{normalized_prefix}LANGUAGE"
        enable_formula_key = f"{normalized_prefix}ENABLE_FORMULA"
        force_ocr_key = f"{normalized_prefix}FORCE_OCR"
        poll_seconds_key = f"{normalized_prefix}POLL_SECONDS"
        timeout_seconds_key = f"{normalized_prefix}TIMEOUT_SECONDS"
        result_ready_grace_seconds_key = f"{normalized_prefix}RESULT_READY_GRACE_SECONDS"

        base_url = (source.get(base_url_key) or "").strip()
        api_key = (source.get(api_key_key) or "").strip()
        if not base_url and not api_key:
            if required:
                raise ValueError(f"{base_url_key} and {api_key_key} must be configured together")
            return None
        if not base_url or not api_key:
            raise ValueError(f"{base_url_key} and {api_key_key} must be configured together")
        provider = _resolve_online_ocr_provider_mode(
            base_url=base_url,
            provider_override=source.get(provider_mode_key) or default_provider,
            provider_key_name=provider_mode_key,
        )
        default_model = _default_online_ocr_model(provider)
        model = (source.get(model_key) or default_model).strip() or default_model
        language = (
            source.get(language_key) or DEFAULT_ONLINE_OCR_LANGUAGE
        ).strip() or DEFAULT_ONLINE_OCR_LANGUAGE
        enable_formula = _parse_online_ocr_bool(
            source.get(enable_formula_key),
            default=(provider == ONLINE_OCR_PROVIDER_MINERU_API),
        )
        force_ocr = _parse_online_ocr_bool(
            source.get(force_ocr_key),
            default=(provider == ONLINE_OCR_PROVIDER_MINERU_API),
        )
        poll_seconds = max(
            1, int((source.get(poll_seconds_key) or str(DEFAULT_ONLINE_OCR_POLL_SECONDS)).strip())
        )
        timeout_seconds = max(
            poll_seconds,
            int(
                (source.get(timeout_seconds_key) or str(DEFAULT_ONLINE_OCR_TIMEOUT_SECONDS)).strip()
            ),
        )
        result_ready_grace_seconds = max(
            poll_seconds,
            int(
                (
                    source.get(result_ready_grace_seconds_key)
                    or str(DEFAULT_ONLINE_OCR_RESULT_READY_GRACE_SECONDS)
                ).strip()
            ),
        )
        return cls(
            base_url=base_url,
            api_key=api_key,
            model=model,
            provider=provider,
            language=language,
            enable_formula=enable_formula,
            force_ocr=force_ocr,
            poll_seconds=poll_seconds,
            timeout_seconds=timeout_seconds,
            result_ready_grace_seconds=min(timeout_seconds, result_ready_grace_seconds),
        )


class OnlineOcrClient(Protocol):
    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult: ...

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult: ...


def parse_online_ocr_bytes(
    *,
    ocr_client: OnlineOcrClient,
    file_bytes: bytes,
    filename: str,
    media_type: str | None = None,
    asset_subkind: str | None = None,
) -> OnlineOcrProviderResult:
    with TemporaryDirectory() as temp_dir:
        file_path = Path(temp_dir) / filename
        file_path.write_bytes(file_bytes)
        normalized_asset_subkind = str(asset_subkind or "").strip().lower()
        normalized_media_type = str(media_type or "").strip().lower()
        parse_pdf = getattr(ocr_client, "parse_pdf", None)
        if (
            normalized_asset_subkind == "pdf"
            or file_path.suffix.strip().lower() == ".pdf"
            or normalized_media_type == "application/pdf"
        ) and callable(parse_pdf):
            return parse_pdf(file_path)
        return ocr_client.parse_file(file_path)


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
                    return OnlineOcrProviderResult(provider_result_bytes=json_response.content)
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


class MineruApiClient:
    def __init__(self, settings: OnlineOcrSettings) -> None:
        self._settings = settings

    def parse_pdf(self, pdf_path: Path) -> OnlineOcrProviderResult:
        return self.parse_file(pdf_path)

    def parse_file(self, file_path: Path) -> OnlineOcrProviderResult:
        try:
            import requests
        except ImportError as exc:  # pragma: no cover
            raise RuntimeError("requests is required to use the online OCR service") from exc

        file_bytes = file_path.read_bytes()
        data_id = hashlib.sha256(file_bytes).hexdigest()[:16]
        headers = {"Authorization": f"Bearer {self._settings.api_key}"}
        upload_response = requests.post(
            _resolve_mineru_file_upload_url(self._settings.base_url),
            headers=headers,
            json={
                "enable_formula": self._settings.enable_formula,
                "language": self._settings.language,
                "files": [
                    {
                        "name": file_path.name,
                        "is_ocr": self._settings.force_ocr,
                        "data_id": data_id,
                    }
                ],
                "model_version": self._settings.model,
            },
            timeout=self._settings.timeout_seconds,
        )
        upload_response.raise_for_status()
        upload_payload = _require_mineru_success_payload(
            response_payload=upload_response.json(),
            action=f"create upload URL for {file_path.name}",
        )
        batch_id = str(upload_payload.get("batch_id") or "").strip()
        if not batch_id:
            raise RuntimeError(f"MinerU upload response for {file_path.name} is missing batch_id")
        file_urls = upload_payload.get("file_urls")
        if not isinstance(file_urls, list) or not file_urls or not isinstance(file_urls[0], str):
            raise RuntimeError(f"MinerU upload response for {file_path.name} is missing file_urls")
        upload_file_response = requests.put(
            str(file_urls[0]),
            data=file_bytes,
            timeout=self._settings.timeout_seconds,
        )
        upload_file_response.raise_for_status()

        deadline = time.monotonic() + self._settings.timeout_seconds
        while True:
            status_response = requests.get(
                _resolve_mineru_extract_results_url(self._settings.base_url, batch_id=batch_id),
                headers=headers,
                timeout=self._settings.timeout_seconds,
            )
            status_response.raise_for_status()
            status_payload = _require_mineru_success_payload(
                response_payload=status_response.json(),
                action=f"query extract result for {file_path.name}",
            )
            extract_results = status_payload.get("extract_result")
            if not isinstance(extract_results, list) or not extract_results:
                raise RuntimeError(
                    f"MinerU extract result for {file_path.name} is missing extract_result"
                )
            result_payload = next(
                (
                    item
                    for item in extract_results
                    if isinstance(item, dict) and str(item.get("file_name") or "") == file_path.name
                ),
                extract_results[0],
            )
            if not isinstance(result_payload, dict):
                raise RuntimeError(f"MinerU extract result for {file_path.name} must be an object")
            state = str(result_payload.get("state") or "").strip().lower()
            if state == "done":
                full_zip_url = str(result_payload.get("full_zip_url") or "").strip()
                if not full_zip_url:
                    raise RuntimeError(
                        f"MinerU extract result for {file_path.name} is missing full_zip_url"
                    )
                archive_response = requests.get(
                    full_zip_url,
                    timeout=self._settings.timeout_seconds,
                )
                archive_response.raise_for_status()
                return OnlineOcrProviderResult(
                    provider_result_bytes=archive_response.content,
                    metadata={
                        "provider": ONLINE_OCR_PROVIDER_MINERU_API,
                        "batch_id": batch_id,
                        "file_name": file_path.name,
                        "state": "done",
                        "full_zip_url": full_zip_url,
                    },
                )
            if state == "failed":
                error_message = str(result_payload.get("err_msg") or "MinerU OCR job failed")
                raise RuntimeError(error_message)
            if time.monotonic() >= deadline:
                raise TimeoutError(f"MinerU OCR job {batch_id} did not finish before timeout")
            time.sleep(self._settings.poll_seconds)


def build_online_ocr_client(settings: OnlineOcrSettings) -> OnlineOcrClient:
    if settings.provider == ONLINE_OCR_PROVIDER_ASYNC_JOBS:
        return PaddleOcrAsyncClient(settings)
    if settings.provider == ONLINE_OCR_PROVIDER_LAYOUT_PARSING_SERVICE:
        return PaddleOcrLayoutParsingServiceClient(settings)
    if settings.provider == ONLINE_OCR_PROVIDER_MINERU_API:
        return MineruApiClient(settings)
    raise ValueError(f"unsupported OCR provider mode: {settings.provider}")


def normalize_online_ocr_provider_label(provider: str) -> str:
    normalized = str(provider or "").strip().lower()
    if normalized in {"", NORMALIZED_ONLINE_OCR_PROVIDER_ASYNC, ONLINE_OCR_PROVIDER_ASYNC_JOBS}:
        return NORMALIZED_ONLINE_OCR_PROVIDER_ASYNC
    if normalized == ONLINE_OCR_PROVIDER_LAYOUT_PARSING_SERVICE:
        return ONLINE_OCR_PROVIDER_LAYOUT_PARSING_SERVICE
    if normalized == ONLINE_OCR_PROVIDER_MINERU_API:
        return ONLINE_OCR_PROVIDER_MINERU_API
    return normalized


def _resolve_online_ocr_provider_mode(
    *,
    base_url: str,
    provider_override: str | None,
    provider_key_name: str = "OCR_PROVIDER_MODE",
) -> str:
    normalized_override = str(provider_override or "").strip().lower()
    if normalized_override:
        if normalized_override not in {
            ONLINE_OCR_PROVIDER_ASYNC_JOBS,
            ONLINE_OCR_PROVIDER_LAYOUT_PARSING_SERVICE,
            ONLINE_OCR_PROVIDER_MINERU_API,
        }:
            raise ValueError(f"unsupported {provider_key_name}: {provider_override}")
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


def _default_online_ocr_model(provider: str) -> str:
    if provider == ONLINE_OCR_PROVIDER_MINERU_API:
        return DEFAULT_MINERU_ONLINE_OCR_MODEL
    return DEFAULT_ONLINE_OCR_MODEL


def _parse_online_ocr_bool(value: str | None, *, default: bool) -> bool:
    if value is None or value == "":
        return default
    normalized = value.strip().lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"invalid boolean value: {value}")


def _resolve_mineru_api_root(base_url: str) -> str:
    normalized = base_url.rstrip("/")
    suffixes = (
        "/api/v4/file-urls/batch",
        "/api/v4/extract-results/batch",
        "/api/v4/extract/task",
        "/api/v4",
        "/api",
    )
    lower_normalized = normalized.lower()
    for suffix in suffixes:
        if lower_normalized.endswith(suffix):
            return normalized[: -len(suffix)] + "/api/v4"
    return f"{normalized}/api/v4"


def _resolve_mineru_file_upload_url(base_url: str) -> str:
    return f"{_resolve_mineru_api_root(base_url)}/file-urls/batch"


def _resolve_mineru_extract_results_url(base_url: str, *, batch_id: str) -> str:
    return f"{_resolve_mineru_api_root(base_url)}/extract-results/batch/{batch_id}"


def _require_mineru_success_payload(
    *,
    response_payload: object,
    action: str,
) -> dict[str, object]:
    if not isinstance(response_payload, dict):
        raise RuntimeError(f"MinerU response must be a JSON object while trying to {action}")
    code = response_payload.get("code")
    if code not in {0, "0", None}:
        raise RuntimeError(
            f"MinerU API failed to {action}: code={code}, msg={response_payload.get('msg')}"
        )
    payload = response_payload.get("data")
    if not isinstance(payload, dict):
        raise RuntimeError(f"MinerU response is missing data while trying to {action}")
    return payload


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
        raise RuntimeError(f"online OCR layout-parsing response for {file_name} is missing result")
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
    if file_path.suffix.strip().lower() == ".pdf":
        return 0
    return 1
