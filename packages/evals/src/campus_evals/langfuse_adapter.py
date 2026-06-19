from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol

import httpx

_LANGFUSE_TRACE_SALT = "campus-agent-langfuse-trace-v1"
_REQUIRED_TRACE_IDENTITY_ATTRIBUTES = (
    "request_id",
    "run_id",
    "workflow_id",
    "trace_id",
)
_REQUIRED_OBSERVATION_ATTRIBUTES = (
    "activity_attempt",
    "activity_type",
    "duration_ms",
    "fail_close_reason",
    "projection_ref",
    "schedule_to_start_ms",
    "selected_capability",
    "selected_tool",
    "status",
    "step_id",
    "step_kind",
    "task_queue",
)
_FORBIDDEN_LANGFUSE_PAYLOAD_FIELDS = frozenset(
    {
        "api_key",
        "authorization",
        "cookie",
        "cookies",
        "database_url",
        "jwt",
        "object_store_secret",
        "provider_raw_response",
        "raw_answer",
        "raw_prompt",
        "raw_retrieved_snippet",
        "raw_transcript",
        "retrieved_snippet",
        "source_body_text",
    }
)


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
    ) -> dict[str, object]: ...


class DisabledLangfuseEvalAdapter:
    def publish_scores(self, scores: object) -> None:
        raise LangfuseAdapterDisabled("Langfuse adapter is disabled")

    def publish_profile_report(
        self, profile_report_payload: dict[str, object]
    ) -> dict[str, object]:
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

    def publish_profile_report(
        self, profile_report_payload: dict[str, object]
    ) -> dict[str, object]:
        from campus_evals.langfuse_score_report import (
            build_score_report_from_profile_report,
            publish_langfuse_score_report,
        )

        score_report_payload = build_score_report_from_profile_report(
            profile_report_payload=profile_report_payload,
            profile_report_path=Path("profile-report.json"),
            environment=self.settings.environment,
        )
        return publish_langfuse_score_report(
            score_report_payload=score_report_payload,
            score_report_path=None,
            settings=self.settings,
            client=self._client,
        )

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
    expected_request_id: str | None = None,
    expected_run_id: str | None = None,
    expected_workflow_id: str | None = None,
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
    _assert_forbidden_payload_fields_absent(trace, observations)
    trace_identity = _assert_trace_identity_contract(trace, observations)
    _assert_expected_trace_identity(
        trace_identity,
        {
            "request_id": expected_request_id,
            "run_id": expected_run_id,
            "workflow_id": expected_workflow_id,
        },
    )
    repo_owned_observations = _assert_observation_attribute_contract(observations)
    return {
        "trace_id": normalized_trace_id,
        "session_id": expected_session_id,
        "user_id": expected_user_id,
        "release": expected_release,
        "tags": tags,
        "trace_identity": trace_identity,
        "observation_count": len(observations),
        "repo_owned_observation_count": len(repo_owned_observations),
        "contract_checked_observation_count": len(repo_owned_observations),
        "non_repo_observation_count": len(observations) - len(repo_owned_observations),
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
    raw_results = profile_report_payload.get("sanitized_results")
    if not isinstance(raw_results, list) or not raw_results:
        raise ValueError("sanitized_results must be a non-empty list")
    scores: list[dict[str, object] | None] = []
    for raw_result in raw_results:
        result = dict(raw_result or {})
        raw_correlation = result.get("request_correlation")
        if not isinstance(raw_correlation, dict):
            scores.append(None)
            continue
        trace_id = derive_langfuse_trace_id(
            _required_string(raw_correlation.get("trace_id"), "request_correlation.trace_id")
        )
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


def derive_langfuse_trace_id(product_trace_id: str) -> str:
    normalized = product_trace_id.strip()
    if not normalized:
        raise ValueError("Langfuse trace id derivation requires a non-empty product trace id")
    seed = f"{_LANGFUSE_TRACE_SALT}:{normalized}"
    hash_value = 0x811C9DC5
    output = ""
    index = 0
    while len(output) < 32:
        for character in seed:
            hash_value ^= ord(character) + index
            hash_value = (hash_value * 0x01000193) & 0xFFFFFFFF
        output += f"{hash_value:08x}"
        index += 1
    return output[:32]


def _optional_string(value: object) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def _extract_error_message(response: httpx.Response) -> str:
    try:
        payload = dict(response.json() or {})
    except ValueError:
        return response.text.strip() or "request failed"
    return str(payload.get("message") or payload.get("error") or response.text or "request failed")


def _assert_observation_attribute_contract(observations: list[object]) -> tuple[object, ...]:
    repo_owned_observations = tuple(
        observation
        for observation in observations
        if _is_repo_owned_observation(_observation_attributes(observation))
    )
    if not repo_owned_observations:
        raise LangfuseAdapterRequestError(
            status_code=200,
            message="trace evidence missing repo-owned workflow or activity observations",
        )
    for observation in repo_owned_observations:
        attributes = _observation_attributes(observation)
        missing = tuple(key for key in _REQUIRED_OBSERVATION_ATTRIBUTES if key not in attributes)
        if missing:
            raise LangfuseAdapterRequestError(
                status_code=200,
                message=(
                    "trace evidence observation "
                    + _observation_label(observation)
                    + " missing observation attributes: "
                    + ", ".join(missing)
                ),
            )
    return repo_owned_observations


def _is_repo_owned_observation(attributes: dict[str, object]) -> bool:
    return any(
        _optional_string(attributes.get(key))
        for key in (
            "telemetry.allowed_attributes_version",
            "step_id",
            "step_kind",
            "activity_type",
        )
    )


def _observation_label(observation: object) -> str:
    if not isinstance(observation, dict):
        return "<unknown>"
    return (
        _optional_string(observation.get("id"))
        or _optional_string(observation.get("name"))
        or "<unknown>"
    )


def _assert_trace_identity_contract(
    trace: dict[str, object],
    observations: list[object],
) -> dict[str, str]:
    identity_values: dict[str, set[str]] = {
        key: set() for key in _REQUIRED_TRACE_IDENTITY_ATTRIBUTES
    }
    _collect_trace_identity_values(identity_values, _nested_attributes(trace))
    for observation in observations:
        _collect_trace_identity_values(identity_values, _observation_attributes(observation))
    conflicting = tuple(key for key, values in identity_values.items() if len(values) > 1)
    if conflicting:
        key = conflicting[0]
        values = ", ".join(sorted(identity_values[key]))
        raise LangfuseAdapterRequestError(
            status_code=200,
            message=(f"trace evidence has conflicting trace identity attribute {key}: {values}"),
        )
    missing = tuple(key for key in _REQUIRED_TRACE_IDENTITY_ATTRIBUTES if not identity_values[key])
    if missing:
        raise LangfuseAdapterRequestError(
            status_code=200,
            message=f"trace evidence missing trace identity attributes: {', '.join(missing)}",
        )
    return {key: next(iter(identity_values[key])) for key in _REQUIRED_TRACE_IDENTITY_ATTRIBUTES}


def _collect_trace_identity_values(
    identity_values: dict[str, set[str]], attributes: dict[str, object]
) -> None:
    for key in _REQUIRED_TRACE_IDENTITY_ATTRIBUTES:
        value = _optional_string(attributes.get(key))
        if value:
            identity_values[key].add(value)


def _assert_forbidden_payload_fields_absent(trace: object, observations: list[object]) -> None:
    forbidden = sorted(
        _collect_forbidden_payload_fields(trace)
        | {
            field
            for observation in observations
            for field in _collect_forbidden_payload_fields(observation)
        }
    )
    if forbidden:
        raise LangfuseAdapterRequestError(
            status_code=200,
            message=(
                "trace evidence includes forbidden Langfuse payload fields: " + ", ".join(forbidden)
            ),
        )


def _collect_forbidden_payload_fields(value: object) -> set[str]:
    if isinstance(value, dict):
        fields: set[str] = set()
        for key, nested in value.items():
            normalized_key = str(key).strip().lower()
            if normalized_key in _FORBIDDEN_LANGFUSE_PAYLOAD_FIELDS:
                fields.add(normalized_key)
            fields.update(_collect_forbidden_payload_fields(nested))
        return fields
    if isinstance(value, list):
        fields: set[str] = set()
        for item in value:
            fields.update(_collect_forbidden_payload_fields(item))
        return fields
    return set()


def _assert_expected_trace_identity(
    attributes: dict[str, str],
    expected: dict[str, str | None],
) -> None:
    for key, expected_value in expected.items():
        normalized_expected = _optional_string(expected_value)
        if normalized_expected is None:
            continue
        actual = _optional_string(attributes.get(key))
        if actual != normalized_expected:
            raise LangfuseAdapterRequestError(
                status_code=200,
                message=(
                    f"trace evidence attribute {key} = {actual or '<missing>'}, "
                    f"want {normalized_expected}"
                ),
            )


def _observation_attributes(observation: object) -> dict[str, object]:
    if not isinstance(observation, dict):
        return {}
    return _nested_attributes(observation)


def _nested_attributes(value: dict[str, object]) -> dict[str, object]:
    attributes = dict(value)
    metadata = value.get("metadata")
    if isinstance(metadata, dict):
        attributes.update(metadata)
    return attributes


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
    "derive_langfuse_trace_id",
    "verify_langfuse_online_trace_evidence",
]
