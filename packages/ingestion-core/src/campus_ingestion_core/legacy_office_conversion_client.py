from __future__ import annotations

import base64
from collections.abc import Mapping
from dataclasses import dataclass
import hashlib
import json
import os
from typing import Protocol
from urllib import error as urllib_error
from urllib import request as urllib_request


_SUPPORTED_TARGET_FORMATS = {"docx", "xlsx"}


class LegacyOfficeConversionClientError(RuntimeError):
    pass


@dataclass(frozen=True, slots=True)
class LegacyOfficeConversionRequest:
    source_media_type: str
    target_format: str
    source_sha256: str
    filename: str
    source_bytes: bytes


@dataclass(frozen=True, slots=True)
class LegacyOfficeConversionResponse:
    target_format: str
    normalized_media_type: str
    normalized_sha256: str
    normalized_bytes: bytes
    engine_name: str
    engine_version: str
    warnings: tuple[str, ...] = ()


class LegacyOfficeConversionClientProtocol(Protocol):
    def convert(
        self,
        request: LegacyOfficeConversionRequest,
    ) -> LegacyOfficeConversionResponse: ...


class LegacyOfficeConversionClient:
    def __init__(
        self,
        *,
        base_url: str,
        internal_shared_secret: str,
        timeout_seconds: float = 120.0,
        urlopen=urllib_request.urlopen,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._internal_shared_secret = internal_shared_secret
        self._timeout_seconds = timeout_seconds
        self._urlopen = urlopen

    def convert(
        self,
        request: LegacyOfficeConversionRequest,
    ) -> LegacyOfficeConversionResponse:
        target_format = request.target_format.strip().lower()
        if target_format not in _SUPPORTED_TARGET_FORMATS:
            raise LegacyOfficeConversionClientError(
                f"unsupported target_format for legacy Office conversion: {request.target_format!r}"
            )

        http_request = urllib_request.Request(
            f"{self._base_url}/api/internal/legacy-office/conversions",
            data=json.dumps(
                {
                    "source_media_type": request.source_media_type,
                    "target_format": target_format,
                    "source_sha256": request.source_sha256,
                    "filename": request.filename,
                    "source_bytes_b64": base64.b64encode(request.source_bytes).decode("ascii"),
                },
                ensure_ascii=False,
            ).encode("utf-8"),
            headers={
                "content-type": "application/json",
                "x-app-internal-auth": self._internal_shared_secret,
            },
            method="POST",
        )
        try:
            with self._urlopen(http_request, timeout=self._timeout_seconds) as response:
                if response.status < 200 or response.status >= 300:
                    raise LegacyOfficeConversionClientError(
                        "legacy Office conversion service returned unexpected "
                        f"status {response.status}"
                    )
                payload = _parse_json_payload(response.read())
        except urllib_error.HTTPError as exc:
            raise LegacyOfficeConversionClientError(
                f"legacy Office conversion service returned http {exc.code}"
            ) from exc
        except urllib_error.URLError as exc:
            raise LegacyOfficeConversionClientError(
                f"legacy Office conversion service request failed: {exc.reason}"
            ) from exc

        response_target_format = _require_string(payload, "target_format").strip().lower()
        if response_target_format != target_format:
            raise LegacyOfficeConversionClientError(
                "legacy Office conversion service returned mismatched target_format: "
                f"expected {target_format}, got {response_target_format}"
            )

        normalized_bytes_b64 = _require_string(payload, "normalized_bytes_b64")
        try:
            normalized_bytes = base64.b64decode(normalized_bytes_b64.encode("ascii"), validate=True)
        except Exception as exc:  # pragma: no cover - defensive error fan-in
            raise LegacyOfficeConversionClientError(
                "legacy Office conversion service returned invalid normalized_bytes_b64"
            ) from exc

        normalized_sha256 = _require_string(payload, "normalized_sha256")
        actual_sha256 = hashlib.sha256(normalized_bytes).hexdigest()
        if normalized_sha256 != actual_sha256:
            raise LegacyOfficeConversionClientError(
                "legacy Office conversion service normalized sha256 mismatch: "
                f"expected {normalized_sha256}, got {actual_sha256}"
            )

        warnings_payload = payload.get("warnings")
        if warnings_payload is None:
            warnings_payload = []
        if not isinstance(warnings_payload, (list, tuple)):
            raise LegacyOfficeConversionClientError(
                "legacy Office conversion service returned invalid 'warnings'"
            )

        return LegacyOfficeConversionResponse(
            target_format=response_target_format,
            normalized_media_type=_require_string(payload, "normalized_media_type"),
            normalized_sha256=normalized_sha256,
            normalized_bytes=normalized_bytes,
            engine_name=_require_string(payload, "engine_name"),
            engine_version=_require_string(payload, "engine_version"),
            warnings=tuple(str(item) for item in warnings_payload),
        )


def build_legacy_office_conversion_client_from_env(
    *,
    env: Mapping[str, str] | None = None,
    urlopen=urllib_request.urlopen,
) -> LegacyOfficeConversionClient:
    source_env = env if env is not None else os.environ
    base_url = str(source_env.get("LEGACY_OFFICE_CONVERSION_BASE_URL", "")).strip()
    internal_shared_secret = str(
        source_env.get("LEGACY_OFFICE_CONVERSION_INTERNAL_SHARED_SECRET", "")
    ).strip()
    if not base_url or not internal_shared_secret:
        raise LegacyOfficeConversionClientError(
            "legacy Office conversion service is not configured"
        )

    timeout_seconds_raw = str(
        source_env.get("LEGACY_OFFICE_CONVERSION_TIMEOUT_SECONDS", "120")
    ).strip()
    try:
        timeout_seconds = float(timeout_seconds_raw)
    except ValueError as exc:
        raise LegacyOfficeConversionClientError(
            "legacy Office conversion service timeout is invalid: "
            f"{timeout_seconds_raw!r}"
        ) from exc

    return LegacyOfficeConversionClient(
        base_url=base_url,
        internal_shared_secret=internal_shared_secret,
        timeout_seconds=timeout_seconds,
        urlopen=urlopen,
    )


def _parse_json_payload(payload: bytes) -> Mapping[str, object]:
    try:
        parsed = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise LegacyOfficeConversionClientError(
            "legacy Office conversion service returned invalid json"
        ) from exc
    if not isinstance(parsed, Mapping):
        raise LegacyOfficeConversionClientError(
            "legacy Office conversion service returned a non-object payload"
        )
    return parsed


def _require_string(payload: Mapping[str, object], key: str) -> str:
    value = payload.get(key)
    if value is None:
        raise LegacyOfficeConversionClientError(
            f"legacy Office conversion service payload missing required field {key!r}"
        )
    normalized = str(value).strip()
    if not normalized:
        raise LegacyOfficeConversionClientError(
            f"legacy Office conversion service payload field {key!r} is empty"
        )
    return normalized


__all__ = [
    "LegacyOfficeConversionClient",
    "LegacyOfficeConversionClientError",
    "LegacyOfficeConversionClientProtocol",
    "LegacyOfficeConversionRequest",
    "LegacyOfficeConversionResponse",
    "build_legacy_office_conversion_client_from_env",
]
