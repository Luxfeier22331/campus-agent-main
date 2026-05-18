from __future__ import annotations

import json
import os
from collections.abc import Mapping, Sequence
from typing import Any
from urllib import error as urllib_error
from urllib import request as urllib_request


class AuthenticatedNoticeProcessingProjectionReportError(RuntimeError):
    def __init__(self, *, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code


class HttpAuthenticatedNoticeProcessingProjectionReporter:
    def __init__(self, *, base_url: str, internal_shared_secret: str) -> None:
        self._base_url = base_url.rstrip("/")
        self._internal_shared_secret = internal_shared_secret

    def report(self, *, snapshots: Sequence[Mapping[str, Any]]) -> None:
        request = urllib_request.Request(
            (f"{self._base_url}/api/internal/operator/authenticated-notices/processing-snapshots"),
            data=json.dumps({"snapshots": list(snapshots)}, ensure_ascii=False).encode("utf-8"),
            headers={
                "content-type": "application/json",
                "x-app-internal-auth": self._internal_shared_secret,
            },
            method="POST",
        )
        try:
            with urllib_request.urlopen(request) as response:
                if response.status < 200 or response.status >= 300:
                    raise AuthenticatedNoticeProcessingProjectionReportError(
                        code="processing_projection_report_failed",
                        message=(
                            "authenticated notice processing projection callback returned "
                            f"unexpected status {response.status}."
                        ),
                    )
        except urllib_error.HTTPError as exc:
            raise AuthenticatedNoticeProcessingProjectionReportError(
                code="processing_projection_report_failed",
                message=(f"authenticated notice processing projection callback failed: {exc.code}"),
            ) from exc
        except urllib_error.URLError as exc:
            raise AuthenticatedNoticeProcessingProjectionReportError(
                code="processing_projection_report_failed",
                message=(
                    f"authenticated notice processing projection callback failed: {exc.reason}"
                ),
            ) from exc


class HttpAuthenticatedNoticeRunProcessingProjectionReporter(
    HttpAuthenticatedNoticeProcessingProjectionReporter
):
    def report(self, *, snapshots: Sequence[Mapping[str, Any]]) -> None:
        request = urllib_request.Request(
            (
                f"{self._base_url}"
                "/api/internal/operator/authenticated-notices/run-processing-snapshots"
            ),
            data=json.dumps({"snapshots": list(snapshots)}, ensure_ascii=False).encode("utf-8"),
            headers={
                "content-type": "application/json",
                "x-app-internal-auth": self._internal_shared_secret,
            },
            method="POST",
        )
        try:
            with urllib_request.urlopen(request) as response:
                if response.status < 200 or response.status >= 300:
                    raise AuthenticatedNoticeProcessingProjectionReportError(
                        code="run_processing_projection_report_failed",
                        message=(
                            "authenticated notice run processing projection callback returned "
                            f"unexpected status {response.status}."
                        ),
                    )
        except urllib_error.HTTPError as exc:
            raise AuthenticatedNoticeProcessingProjectionReportError(
                code="run_processing_projection_report_failed",
                message=(
                    f"authenticated notice run processing projection callback failed: {exc.code}"
                ),
            ) from exc
        except urllib_error.URLError as exc:
            raise AuthenticatedNoticeProcessingProjectionReportError(
                code="run_processing_projection_report_failed",
                message=(
                    f"authenticated notice run processing projection callback failed: {exc.reason}"
                ),
            ) from exc


def build_processing_projection_reporter_from_env(
    env: Mapping[str, str] | None = None,
) -> HttpAuthenticatedNoticeProcessingProjectionReporter | None:
    source = dict(os.environ if env is None else env)
    base_url = source.get("INGESTION_WORKER_APP_API_BASE_URL", "").strip()
    shared_secret = source.get("INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET", "").strip()
    if not (base_url and shared_secret):
        return None
    return HttpAuthenticatedNoticeProcessingProjectionReporter(
        base_url=base_url,
        internal_shared_secret=shared_secret,
    )


def build_run_processing_projection_reporter_from_env(
    env: Mapping[str, str] | None = None,
) -> HttpAuthenticatedNoticeRunProcessingProjectionReporter | None:
    source = dict(os.environ if env is None else env)
    base_url = source.get("INGESTION_WORKER_APP_API_BASE_URL", "").strip()
    shared_secret = source.get("INGESTION_WORKER_APP_API_INTERNAL_SHARED_SECRET", "").strip()
    if not (base_url and shared_secret):
        return None
    return HttpAuthenticatedNoticeRunProcessingProjectionReporter(
        base_url=base_url,
        internal_shared_secret=shared_secret,
    )


__all__ = [
    "AuthenticatedNoticeProcessingProjectionReportError",
    "HttpAuthenticatedNoticeProcessingProjectionReporter",
    "HttpAuthenticatedNoticeRunProcessingProjectionReporter",
    "build_processing_projection_reporter_from_env",
    "build_run_processing_projection_reporter_from_env",
]
