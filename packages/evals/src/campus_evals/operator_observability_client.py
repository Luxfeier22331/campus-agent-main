from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Protocol

import httpx


@dataclass(frozen=True, slots=True)
class OperatorObservabilityClientSettings:
    app_api_base_url: str
    internal_shared_secret: str
    timeout_seconds: float = 10.0

    def __post_init__(self) -> None:
        if not self.app_api_base_url.strip():
            raise ValueError("app_api_base_url is required")
        if not self.internal_shared_secret.strip():
            raise ValueError("internal_shared_secret is required")
        if self.timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be greater than zero")

    @classmethod
    def from_env(
        cls,
        env: dict[str, str] | None = None,
    ) -> OperatorObservabilityClientSettings:
        source = env if env is not None else os.environ
        app_api_base_url = str(source.get("APP_API_BASE_URL") or "").strip()
        internal_shared_secret = str(source.get("APP_API_INTERNAL_SHARED_SECRET") or "").strip()
        timeout_raw = str(source.get("OPERATOR_OBSERVABILITY_HTTP_TIMEOUT_SECONDS") or "").strip()
        timeout_seconds = float(timeout_raw) if timeout_raw else 10.0
        return cls(
            app_api_base_url=app_api_base_url,
            internal_shared_secret=internal_shared_secret,
            timeout_seconds=timeout_seconds,
        )


class OperatorObservabilityClientError(RuntimeError):
    def __init__(
        self,
        *,
        status_code: int,
        code: str,
        message: str,
        details: object = None,
    ) -> None:
        super().__init__(f"{code}: {message}")
        self.status_code = status_code
        self.code = code
        self.details = details


class _OperatorQualityGrade(Protocol):
    request_id: str
    trace_id: str
    grade_source: str
    grade_domain: str
    verdict: str
    score: float | None
    grader_version: str
    sampled_at: str
    rationale_summary: str | None


class _OperatorTraceBacklink(Protocol):
    request_id: str
    trace_id: str
    trace_link: str | None
    issue_link: str | None
    issue_fingerprint: str | None


class _OperatorLangfuseEvalBacklink(Protocol):
    request_id: str
    trace_id: str
    eval_run_id: str
    score_name: str
    score_value: float | int | str
    release: str
    environment: str
    langfuse_url: str


class OperatorObservabilityClient:
    def __init__(
        self,
        *,
        settings: OperatorObservabilityClientSettings,
        client: httpx.Client | None = None,
    ) -> None:
        self.settings = settings
        self._client = client

    def ingest_quality_grades(self, grades: tuple[_OperatorQualityGrade, ...]) -> int:
        response = self._request(
            "/api/internal/operator/quality/grades",
            {
                "grades": [
                    {
                        "requestId": item.request_id,
                        "traceId": item.trace_id,
                        "gradeSource": item.grade_source,
                        "gradeDomain": item.grade_domain,
                        "verdict": item.verdict,
                        "score": item.score,
                        "graderVersion": item.grader_version,
                        "sampledAt": item.sampled_at,
                        "rationaleSummary": item.rationale_summary,
                    }
                    for item in grades
                ]
            },
        )
        payload = _decode_json(response)
        return int(payload.get("accepted") or 0)

    def ingest_trace_backlinks(self, backlinks: tuple[_OperatorTraceBacklink, ...]) -> int:
        response = self._request(
            "/api/internal/operator/trace-backlinks",
            {
                "backlinks": [
                    {
                        "requestId": item.request_id,
                        "traceId": item.trace_id,
                        "traceLink": item.trace_link,
                        "issueLink": item.issue_link,
                        "issueFingerprint": item.issue_fingerprint,
                    }
                    for item in backlinks
                ]
            },
        )
        payload = _decode_json(response)
        return int(payload.get("accepted") or 0)

    def ingest_langfuse_eval_backlinks(
        self,
        backlinks: tuple[_OperatorLangfuseEvalBacklink, ...],
    ) -> int:
        response = self._request(
            "/api/internal/operator/langfuse/eval-backlinks",
            {
                "backlinks": [
                    {
                        "requestId": item.request_id,
                        "traceId": item.trace_id,
                        "evalRunId": item.eval_run_id,
                        "scoreName": item.score_name,
                        "scoreValue": item.score_value,
                        "release": item.release,
                        "environment": item.environment,
                        "langfuseUrl": item.langfuse_url,
                    }
                    for item in backlinks
                ]
            },
        )
        payload = _decode_json(response)
        return int(payload.get("accepted") or 0)

    def fetch_request_observability(self, request_id: str) -> dict[str, object]:
        normalized_request_id = _required_string(request_id, "request_id")
        response = self._get(f"/api/operator/requests/{normalized_request_id}/observability")
        return _decode_json(response)

    def _request(self, path: str, body: dict[str, object]) -> httpx.Response:
        if self._client is not None:
            response = self._client.post(
                path,
                json=body,
                headers={"x-app-internal-auth": self.settings.internal_shared_secret},
            )
        else:
            with httpx.Client(
                base_url=self.settings.app_api_base_url.rstrip("/"),
                timeout=self.settings.timeout_seconds,
            ) as client:
                response = client.post(
                    path,
                    json=body,
                    headers={"x-app-internal-auth": self.settings.internal_shared_secret},
                )
        if response.status_code < 400:
            return response
        payload = _decode_json(response)
        error_payload = dict(payload.get("error") or {})
        raise OperatorObservabilityClientError(
            status_code=response.status_code,
            code=str(error_payload.get("code") or "operator_observability_request_failed"),
            message=str(error_payload.get("message") or response.text or "request failed"),
            details=error_payload.get("details"),
        )

    def _get(self, path: str) -> httpx.Response:
        headers = {
            "x-app-internal-auth": self.settings.internal_shared_secret,
            "x-app-operator-email": "execution-control-runtime@internal",
            "x-app-operator-id": "execution-control-runtime",
            "x-app-operator-name": "Execution Control Runtime",
            "x-app-operator-roles": "operator,execution_control_runtime",
        }
        if self._client is not None:
            response = self._client.get(path, headers=headers)
        else:
            with httpx.Client(
                base_url=self.settings.app_api_base_url.rstrip("/"),
                timeout=self.settings.timeout_seconds,
            ) as client:
                response = client.get(path, headers=headers)
        if response.status_code < 400:
            return response
        payload = _decode_json(response)
        error_payload = dict(payload.get("error") or {})
        raise OperatorObservabilityClientError(
            status_code=response.status_code,
            code=str(error_payload.get("code") or "operator_observability_request_failed"),
            message=str(error_payload.get("message") or response.text or "request failed"),
            details=error_payload.get("details"),
        )


def _required_string(value: object, field: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{field} is required")
    return normalized


def _decode_json(response: httpx.Response) -> dict[str, object]:
    try:
        payload = response.json()
    except ValueError:
        return {}
    return dict(payload or {})
