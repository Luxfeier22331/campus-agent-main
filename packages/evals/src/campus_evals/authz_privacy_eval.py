from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

from campus_evals.fixture_registry import fixture_path
from campus_evals.models import reject_forbidden_workflow_trace_keys

AUTHZ_PRIVACY_CASES_PATH = fixture_path("e2e.authz_privacy")


@dataclass(frozen=True, slots=True)
class AuthzPrivacyCase:
    case_id: str
    expected_terminal_outcome: str
    expected_fail_close_reason: str
    expected_authorization_summary: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class AuthzPrivacyCaseSet:
    schema_version: int
    cases: tuple[AuthzPrivacyCase, ...]


@dataclass(frozen=True, slots=True)
class AuthzPrivacyObservation:
    case_id: str
    terminal_outcome: str
    fail_close_reason: str
    authorization_summary: dict[str, object] = field(default_factory=dict)
    artifact_payload: dict[str, object] = field(default_factory=dict)

    def __post_init__(self) -> None:
        reject_forbidden_workflow_trace_keys(
            {
                "authorization_summary": self.authorization_summary,
                "artifact_payload": self.artifact_payload,
            },
            "authz_privacy_observation",
        )


@dataclass(frozen=True, slots=True)
class AuthzPrivacyResult:
    case_id: str
    passed: bool
    failure_class: str
    reason: str


@dataclass(frozen=True, slots=True)
class AuthzPrivacyReport:
    passed: bool
    total: int
    passed_count: int
    failed_count: int
    results: tuple[AuthzPrivacyResult, ...]


def load_authz_privacy_cases(path: str | Path | None = None) -> AuthzPrivacyCaseSet:
    payload = _load_json(Path(path) if path is not None else AUTHZ_PRIVACY_CASES_PATH)
    if int(payload.get("schema_version") or 0) != 1:
        raise ValueError("authz privacy schema_version must be 1")
    raw_cases = payload.get("cases")
    if not isinstance(raw_cases, list) or not raw_cases:
        raise ValueError("authz privacy cases must be a non-empty list")
    cases = tuple(_parse_case(item) for item in raw_cases)
    return AuthzPrivacyCaseSet(schema_version=1, cases=cases)


def evaluate_authz_privacy_cases(
    cases: tuple[AuthzPrivacyCase, ...],
    observations: dict[str, AuthzPrivacyObservation],
) -> AuthzPrivacyReport:
    results = tuple(_evaluate_case(case, observations.get(case.case_id)) for case in cases)
    passed_count = sum(1 for result in results if result.passed)
    return AuthzPrivacyReport(
        passed=passed_count == len(results),
        total=len(results),
        passed_count=passed_count,
        failed_count=len(results) - passed_count,
        results=results,
    )


def _evaluate_case(
    case: AuthzPrivacyCase,
    observation: AuthzPrivacyObservation | None,
) -> AuthzPrivacyResult:
    if observation is None:
        return AuthzPrivacyResult(case.case_id, False, "missing_observation", "missing observation")
    failures: list[str] = []
    if observation.terminal_outcome != case.expected_terminal_outcome:
        failures.append(
            f"terminal_outcome expected {case.expected_terminal_outcome!r}, got {observation.terminal_outcome!r}"
        )
    if observation.fail_close_reason != case.expected_fail_close_reason:
        failures.append(
            f"fail_close_reason expected {case.expected_fail_close_reason!r}, got {observation.fail_close_reason!r}"
        )
    for key, expected_value in case.expected_authorization_summary.items():
        if observation.authorization_summary.get(key) != expected_value:
            failures.append(f"authorization_summary.{key} mismatch")
    if not failures:
        return AuthzPrivacyResult(case.case_id, True, "", "ok")
    return AuthzPrivacyResult(
        case.case_id,
        False,
        _failure_class(case, observation),
        "; ".join(failures),
    )


def _failure_class(case: AuthzPrivacyCase, observation: AuthzPrivacyObservation) -> str:
    if (
        case.expected_fail_close_reason == "restricted_access_denied"
        and observation.terminal_outcome == "no_hit"
    ):
        return "restricted_deny_mismatch"
    if case.expected_fail_close_reason == "policy_unavailable":
        return "policy_unavailable_mismatch"
    if case.expected_fail_close_reason == "tool_closed":
        return "closed_scope_mismatch"
    return "authorization_mismatch"


def _parse_case(payload: object) -> AuthzPrivacyCase:
    item = _mapping(payload, "case")
    return AuthzPrivacyCase(
        case_id=_required_string(item.get("case_id"), "case_id"),
        expected_terminal_outcome=_required_string(
            item.get("expected_terminal_outcome"),
            "expected_terminal_outcome",
        ),
        expected_fail_close_reason=str(item.get("expected_fail_close_reason") or ""),
        expected_authorization_summary=_mapping(
            item.get("expected_authorization_summary") or {},
            "expected_authorization_summary",
        ),
    )


def _load_json(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return payload


def _mapping(value: object, field_name: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} must be an object")
    return dict(value)


def _required_string(value: object, field_name: str) -> str:
    normalized = "" if value is None else str(value).strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    return normalized


__all__ = [
    "AUTHZ_PRIVACY_CASES_PATH",
    "AuthzPrivacyCase",
    "AuthzPrivacyCaseSet",
    "AuthzPrivacyObservation",
    "AuthzPrivacyReport",
    "AuthzPrivacyResult",
    "evaluate_authz_privacy_cases",
    "load_authz_privacy_cases",
]
