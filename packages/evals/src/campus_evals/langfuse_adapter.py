from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

import httpx


class LangfuseAdapterDisabled(RuntimeError):
    pass


class LangfuseAdapterRequestError(RuntimeError):
    def __init__(self, *, status_code: int, message: str) -> None:
        super().__init__(f"Langfuse score publish failed: {status_code} {message}")
        self.status_code = status_code
        self.message = message


@dataclass(frozen=True, slots=True)
class LangfuseAdapterSettings:
    base_url: str = ""
    public_key: str = ""
    secret_key: str = ""
    environment: str = ""
    timeout_seconds: float = 10.0

    @property
    def enabled(self) -> bool:
        return bool(self.base_url.strip() and self.public_key.strip() and self.secret_key.strip())


class LangfuseEvalAdapter(Protocol):
    def publish_scores(self, scores: object) -> None: ...

    def publish_profile_report(
        self, profile_report_payload: dict[str, object]
    ) -> dict[str, int]: ...


class DisabledLangfuseEvalAdapter:
    def publish_scores(self, scores: object) -> None:
        raise LangfuseAdapterDisabled("Langfuse adapter is disabled")

    def publish_profile_report(self, profile_report_payload: dict[str, object]) -> dict[str, int]:
        raise LangfuseAdapterDisabled("Langfuse adapter is disabled")


class ConfiguredLangfuseEvalAdapter:
    def __init__(
        self,
        settings: LangfuseAdapterSettings,
        *,
        client: httpx.Client | None = None,
    ) -> None:
        self.settings = settings
        self._client = client

    def publish_scores(self, scores: object) -> None:
        if not isinstance(scores, list):
            raise ValueError("Langfuse scores must be provided as a list")
        for score in scores:
            if not isinstance(score, dict):
                raise ValueError("Langfuse score item must be a mapping")
            self._post_score(dict(score))

    def publish_profile_report(self, profile_report_payload: dict[str, object]) -> dict[str, int]:
        published = 0
        skipped = 0
        for score in _build_profile_report_scores(
            profile_report_payload=profile_report_payload,
            environment=self.settings.environment,
        ):
            if score is None:
                skipped += 1
                continue
            self._post_score(score)
            published += 1
        return {"published": published, "skipped": skipped}

    def _post_score(self, payload: dict[str, object]) -> None:
        score_url = f"{self.settings.base_url.strip().rstrip('/')}/api/public/scores"
        if self._client is not None:
            response = self._client.post(
                score_url,
                json=payload,
                auth=(self.settings.public_key.strip(), self.settings.secret_key.strip()),
            )
        else:
            with httpx.Client(
                timeout=self.settings.timeout_seconds,
            ) as client:
                response = client.post(
                    score_url,
                    json=payload,
                    auth=(self.settings.public_key.strip(), self.settings.secret_key.strip()),
                )
        if response.status_code < 400:
            return
        raise LangfuseAdapterRequestError(
            status_code=response.status_code,
            message=_extract_error_message(response),
        )


def verify_langfuse_online_trace_evidence(
    *,
    settings: LangfuseAdapterSettings,
    trace_id: str,
    expected_session_id: str,
    expected_user_id: str,
    expected_release: str,
    expected_tags: tuple[str, ...],
    client: httpx.Client | None = None,
) -> dict[str, object]:
    adapter = create_langfuse_adapter(settings)
    if isinstance(adapter, DisabledLangfuseEvalAdapter):
        raise LangfuseAdapterDisabled("Langfuse adapter is disabled")
    normalized_trace_id = _required_string(trace_id, "trace_id")
    trace_url = f"{settings.base_url.strip().rstrip('/')}/api/public/traces/{normalized_trace_id}"
    if client is not None:
        response = client.get(
            trace_url,
            params={"fields": "core,observations"},
            auth=(settings.public_key.strip(), settings.secret_key.strip()),
        )
    else:
        with httpx.Client(timeout=settings.timeout_seconds) as live_client:
            response = live_client.get(
                trace_url,
                params={"fields": "core,observations"},
                auth=(settings.public_key.strip(), settings.secret_key.strip()),
            )
    if response.status_code >= 400:
        raise LangfuseAdapterRequestError(
            status_code=response.status_code,
            message=_extract_error_message(response),
        )
    trace = dict(response.json() or {})
    _assert_trace_field(trace, "id", normalized_trace_id)
    _assert_trace_field(trace, "name", "online-answer")
    _assert_trace_field(trace, "sessionId", expected_session_id)
    _assert_trace_field(trace, "userId", expected_user_id)
    _assert_trace_field(trace, "release", expected_release)
    tags = tuple(str(value) for value in trace.get("tags") or ())
    missing_tags = tuple(tag for tag in expected_tags if tag not in tags)
    if missing_tags:
        raise LangfuseAdapterRequestError(
            status_code=200,
            message=f"trace evidence missing tags: {', '.join(missing_tags)}",
        )
    observations = trace.get("observations")
    if not isinstance(observations, list) or not observations:
        raise LangfuseAdapterRequestError(
            status_code=200,
            message="trace evidence missing observations",
        )
    return {
        "trace_id": normalized_trace_id,
        "session_id": expected_session_id,
        "user_id": expected_user_id,
        "release": expected_release,
        "tags": tags,
        "observation_count": len(observations),
    }


def create_langfuse_adapter(
    settings: LangfuseAdapterSettings,
    *,
    client: httpx.Client | None = None,
) -> LangfuseEvalAdapter:
    populated = [
        bool(settings.base_url.strip()),
        bool(settings.public_key.strip()),
        bool(settings.secret_key.strip()),
    ]
    if any(populated) and not all(populated):
        raise ValueError("Langfuse adapter requires base URL, public and secret keys")
    if not settings.enabled:
        return DisabledLangfuseEvalAdapter()
    if settings.timeout_seconds <= 0:
        raise ValueError("Langfuse adapter timeout_seconds must be greater than zero")
    return ConfiguredLangfuseEvalAdapter(settings, client=client)


def _build_profile_report_scores(
    *,
    profile_report_payload: dict[str, object],
    environment: str,
) -> tuple[dict[str, object] | None, ...]:
    schema_version = _required_string(
        profile_report_payload.get("schema_version"), "schema_version"
    )
    profile_id = _required_string(profile_report_payload.get("profile_id"), "profile_id")
    case_family = _required_string(profile_report_payload.get("case_family"), "case_family")
    version_summary = dict(profile_report_payload.get("version_summary") or {})
    grader_version = _optional_string(version_summary.get("runtime_version")) or schema_version
    scores: list[dict[str, object] | None] = []
    for raw_result in profile_report_payload.get("sanitized_results") or ():
        result = dict(raw_result or {})
        raw_correlation = result.get("request_correlation")
        if not isinstance(raw_correlation, dict):
            scores.append(None)
            continue
        trace_id = _required_string(raw_correlation.get("trace_id"), "request_correlation.trace_id")
        case_id = _required_string(result.get("case_id"), "sanitized_results[].case_id")
        request_id = _required_string(
            raw_correlation.get("request_id"),
            "request_correlation.request_id",
        )
        payload: dict[str, object] = {
            "traceId": trace_id,
            "name": f"{profile_id}.profile",
            "value": 1 if bool(result.get("passed")) else 0,
            "dataType": "BOOLEAN",
            "source": "API",
            "metadata": {
                "profile_id": profile_id,
                "case_id": case_id,
                "request_id": request_id,
                "case_family": case_family,
                "schema_version": schema_version,
                "grader_version": grader_version,
                "failure_class": _optional_string(result.get("failure_class")),
            },
        }
        normalized_environment = environment.strip()
        if normalized_environment:
            payload["environment"] = normalized_environment
        scores.append(payload)
    return tuple(scores)


def _required_string(value: object, field: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{field} is required")
    return normalized


def _optional_string(value: object) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def _extract_error_message(response: httpx.Response) -> str:
    try:
        payload = dict(response.json() or {})
    except ValueError:
        return response.text.strip() or "request failed"
    return str(payload.get("message") or payload.get("error") or response.text or "request failed")


def _assert_trace_field(trace: dict[str, object], field: str, expected: str) -> None:
    actual = _optional_string(trace.get(field))
    if actual != expected:
        raise LangfuseAdapterRequestError(
            status_code=200,
            message=f"trace evidence field {field} = {actual or '<missing>'}, want {expected}",
        )


__all__ = [
    "ConfiguredLangfuseEvalAdapter",
    "DisabledLangfuseEvalAdapter",
    "LangfuseAdapterDisabled",
    "LangfuseAdapterRequestError",
    "LangfuseAdapterSettings",
    "LangfuseEvalAdapter",
    "create_langfuse_adapter",
    "verify_langfuse_online_trace_evidence",
]
