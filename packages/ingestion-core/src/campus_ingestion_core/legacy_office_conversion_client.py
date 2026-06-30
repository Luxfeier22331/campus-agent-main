from __future__ import annotations

import base64
import hashlib
import os
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Protocol

import httpx

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
        post=httpx.post,
    ) -> None:
        self._base_url = base_url.rstrip("/")
        self._internal_shared_secret = internal_shared_secret
        self._timeout_seconds = timeout_seconds
        self._post = post

    def convert(
        self,
        request: LegacyOfficeConversionRequest,
    ) -> LegacyOfficeConversionResponse:
        target_format = request.target_format.strip().lower()
        if target_format not in _SUPPORTED_TARGET_FORMATS:
            raise LegacyOfficeConversionClientError(
                f"unsupported target_format for legacy Office conversion: {request.target_format!r}"
            )

        url = f"{self._base_url}/api/internal/legacy-office/conversions"
        try:
            response = self._post(
                url,
                headers={
                    "x-app-internal-auth": self._internal_shared_secret,
                },
                json={
                    "source_media_type": request.source_media_type,
                    "target_format": target_format,
                    "source_sha256": request.source_sha256,
                    "filename": request.filename,
                    "source_bytes_b64": base64.b64encode(request.source_bytes).decode("ascii"),
                },
                timeout=self._timeout_seconds,
            )
            if response.status_code < 200 or response.status_code >= 300:
                raise LegacyOfficeConversionClientError(
                    "legacy Office conversion service returned unexpected "
                    f"status {response.status_code}"
                )
            payload = _parse_json_payload(response.json())
        except httpx.HTTPStatusError as exc:
            raise LegacyOfficeConversionClientError(
                f"legacy Office conversion service returned http {exc.response.status_code}"
            ) from exc
        except httpx.HTTPError as exc:
            raise LegacyOfficeConversionClientError(
                f"legacy Office conversion service request failed: {exc}"
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
    post=httpx.post,
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
            f"legacy Office conversion service timeout is invalid: {timeout_seconds_raw!r}"
        ) from exc

    return LegacyOfficeConversionClient(
        base_url=base_url,
        internal_shared_secret=internal_shared_secret,
        timeout_seconds=timeout_seconds,
        post=post,
    )


def _parse_json_payload(payload: object) -> Mapping[str, object]:
    if not isinstance(payload, Mapping):
        raise LegacyOfficeConversionClientError(
            "legacy Office conversion service returned a non-object payload"
        )
    return payload


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
