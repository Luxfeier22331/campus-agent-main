from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path

EVAL_OPERATIONS_PROFILE_POLICY_PATH = (
    Path(__file__).resolve().parents[2] / "fixtures" / "eval_operations_profile_policy.v1.json"
)


@dataclass(frozen=True, slots=True)
class EvalOperationsBudget:
    max_cases_per_run: int
    max_provider_calls_per_run: int


@dataclass(frozen=True, slots=True)
class EvalOperationsBreakerPolicy:
    failure_threshold: int
    cooldown_seconds: int


@dataclass(frozen=True, slots=True)
class EvalOperationsRetentionPolicy:
    artifact_days: int
    promoted_artifact_days: int


@dataclass(frozen=True, slots=True)
class EvalOperationsQuarantinePolicy:
    allowed: bool
    max_days: int
    readmission_rule: str


@dataclass(frozen=True, slots=True)
class EvalOperationsProfilePolicy:
    profile_id: str
    budget: EvalOperationsBudget
    runtime_timeout_seconds: int
    max_retries: int
    pacing_seconds: float
    breaker: EvalOperationsBreakerPolicy
    retention: EvalOperationsRetentionPolicy
    allowed_gate_modes: tuple[str, ...]
    failure_dispositions: tuple[str, ...]
    quarantine: EvalOperationsQuarantinePolicy
    required_version_fields: tuple[str, ...]


@dataclass(frozen=True, slots=True)
class EvalOperationsPolicy:
    schema_version: int
    policy_id: str
    profiles: dict[str, EvalOperationsProfilePolicy]


@dataclass(frozen=True, slots=True)
class EvalOperationsObservation:
    profile_id: str
    gate_mode: str
    cases_run: int
    runtime_seconds: int
    retry_count: int
    artifact_age_days: int
    provider_calls: int = 0
    failed_cases: tuple[str, ...] = ()
    skipped_cases: tuple[str, ...] = ()
    quarantined_cases: tuple[str, ...] = ()
    repaired_cases: tuple[str, ...] = ()
    case_dispositions: dict[str, str] = field(default_factory=dict)
    quarantine_readmission_cases: tuple[str, ...] = ()
    version_summary: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class EvalOperationsProfileResult:
    profile_id: str
    passed: bool
    failure_classes: tuple[str, ...]
    reason: str


@dataclass(frozen=True, slots=True)
class EvalOperationsGovernanceReport:
    passed: bool
    total: int
    passed_count: int
    failed_count: int
    results: tuple[EvalOperationsProfileResult, ...]


def load_eval_operations_profile_policy(
    path: str | Path | None = None,
    *,
    payload: dict[str, object] | None = None,
) -> EvalOperationsPolicy:
    raw_payload = (
        payload
        if payload is not None
        else _load_json(Path(path) if path is not None else EVAL_OPERATIONS_PROFILE_POLICY_PATH)
    )
    if int(raw_payload.get("schema_version") or 0) != 1:
        raise ValueError("eval operations policy schema_version must be 1")
    policy_id = _required_string(raw_payload.get("policy_id"), "policy_id")
    if policy_id != "eval_operations_profile_policy.v1":
        raise ValueError("unsupported eval operations policy_id")
    raw_profiles = raw_payload.get("profiles")
    if not isinstance(raw_profiles, list) or not raw_profiles:
        raise ValueError("eval operations profiles must be a non-empty list")
    profiles = tuple(_parse_profile(item) for item in raw_profiles)
    profile_map: dict[str, EvalOperationsProfilePolicy] = {}
    for profile in profiles:
        if profile.profile_id in profile_map:
            raise ValueError(f"duplicate eval operations profile_id: {profile.profile_id}")
        profile_map[profile.profile_id] = profile
    return EvalOperationsPolicy(schema_version=1, policy_id=policy_id, profiles=profile_map)


def evaluate_eval_operations_governance(
    policy: EvalOperationsPolicy,
    observations: dict[str, EvalOperationsObservation],
) -> EvalOperationsGovernanceReport:
    results = tuple(
        _evaluate_profile(profile, observations.get(profile.profile_id))
        for profile in policy.profiles.values()
    )
    passed_count = sum(1 for result in results if result.passed)
    return EvalOperationsGovernanceReport(
        passed=passed_count == len(results),
        total=len(results),
        passed_count=passed_count,
        failed_count=len(results) - passed_count,
        results=results,
    )


def _evaluate_profile(
    profile: EvalOperationsProfilePolicy,
    observation: EvalOperationsObservation | None,
) -> EvalOperationsProfileResult:
    if observation is None:
        return EvalOperationsProfileResult(
            profile_id=profile.profile_id,
            passed=False,
            failure_classes=("missing_observation",),
            reason="missing observation",
        )

    failures: list[tuple[str, str]] = []
    if observation.gate_mode not in profile.allowed_gate_modes:
        failures.append(("unsupported_gate_mode", "gate mode is not allowed"))
    if observation.cases_run > profile.budget.max_cases_per_run:
        failures.append(("budget_exceeded", "case budget exceeded"))
    if observation.provider_calls > profile.budget.max_provider_calls_per_run:
        failures.append(("budget_exceeded", "provider call budget exceeded"))
    if observation.runtime_seconds > profile.runtime_timeout_seconds:
        failures.append(("runtime_policy_violation", "runtime timeout exceeded"))
    if observation.retry_count > profile.max_retries:
        failures.append(("runtime_policy_violation", "retry policy exceeded"))
    if observation.artifact_age_days > profile.retention.artifact_days:
        failures.append(("retention_violation", "artifact retention exceeded"))
    failures.extend(_failure_disposition_failures(profile, observation))
    failures.extend(_quarantine_failures(profile, observation))
    failures.extend(_version_failures(profile, observation))

    failure_classes = _unique_failure_classes(failures)
    return EvalOperationsProfileResult(
        profile_id=profile.profile_id,
        passed=not failure_classes,
        failure_classes=failure_classes,
        reason="ok" if not failures else "; ".join(reason for _, reason in failures),
    )


def _failure_disposition_failures(
    profile: EvalOperationsProfilePolicy,
    observation: EvalOperationsObservation,
) -> list[tuple[str, str]]:
    failures: list[tuple[str, str]] = []
    case_statuses = {
        "failed": observation.failed_cases,
        "skipped": observation.skipped_cases,
        "quarantined": observation.quarantined_cases,
        "repaired": observation.repaired_cases,
    }
    for disposition, case_ids in case_statuses.items():
        if case_ids and disposition not in profile.failure_dispositions:
            failures.append(("missing_failure_disposition", f"{disposition} is not allowed"))
        for case_id in case_ids:
            if not observation.case_dispositions.get(case_id):
                failures.append(("missing_failure_disposition", f"{case_id} lacks disposition"))
    return failures


def _quarantine_failures(
    profile: EvalOperationsProfilePolicy,
    observation: EvalOperationsObservation,
) -> list[tuple[str, str]]:
    if not observation.quarantined_cases:
        return []
    if not profile.quarantine.allowed:
        return [("invalid_quarantine", "quarantine is not allowed")]
    readmission_cases = set(observation.quarantine_readmission_cases)
    missing_readmission = [
        case_id for case_id in observation.quarantined_cases if case_id not in readmission_cases
    ]
    if missing_readmission:
        return [("invalid_quarantine", "quarantined cases lack readmission evidence")]
    return []


def _version_failures(
    profile: EvalOperationsProfilePolicy,
    observation: EvalOperationsObservation,
) -> list[tuple[str, str]]:
    missing = [
        field_name
        for field_name in profile.required_version_fields
        if not str(observation.version_summary.get(field_name) or "").strip()
    ]
    if missing:
        return [("version_drift", f"missing version fields: {', '.join(missing)}")]
    return []


def _parse_profile(payload: object) -> EvalOperationsProfilePolicy:
    item = _mapping(payload, "profile")
    budget = _mapping(item.get("budget"), "profile.budget")
    breaker = _mapping(item.get("breaker"), "profile.breaker")
    retention = _mapping(item.get("retention"), "profile.retention")
    quarantine = _mapping(item.get("quarantine"), "profile.quarantine")
    profile = EvalOperationsProfilePolicy(
        profile_id=_required_string(item.get("profile_id"), "profile_id"),
        budget=EvalOperationsBudget(
            max_cases_per_run=_positive_int(
                budget.get("max_cases_per_run"),
                "budget.max_cases_per_run",
            ),
            max_provider_calls_per_run=_non_negative_int(
                budget.get("max_provider_calls_per_run"),
                "budget.max_provider_calls_per_run",
            ),
        ),
        runtime_timeout_seconds=_positive_int(
            item.get("runtime_timeout_seconds"),
            "runtime_timeout_seconds",
        ),
        max_retries=_non_negative_int(item.get("max_retries"), "max_retries"),
        pacing_seconds=_non_negative_float(item.get("pacing_seconds"), "pacing_seconds"),
        breaker=EvalOperationsBreakerPolicy(
            failure_threshold=_positive_int(
                breaker.get("failure_threshold"),
                "breaker.failure_threshold",
            ),
            cooldown_seconds=_positive_int(
                breaker.get("cooldown_seconds"),
                "breaker.cooldown_seconds",
            ),
        ),
        retention=EvalOperationsRetentionPolicy(
            artifact_days=_positive_int(retention.get("artifact_days"), "retention.artifact_days"),
            promoted_artifact_days=_positive_int(
                retention.get("promoted_artifact_days"),
                "retention.promoted_artifact_days",
            ),
        ),
        allowed_gate_modes=_string_tuple(item.get("allowed_gate_modes"), "allowed_gate_modes"),
        failure_dispositions=_string_tuple(
            item.get("failure_dispositions"),
            "failure_dispositions",
        ),
        quarantine=EvalOperationsQuarantinePolicy(
            allowed=bool(quarantine.get("allowed")),
            max_days=_positive_int(quarantine.get("max_days"), "quarantine.max_days"),
            readmission_rule=_required_string(
                quarantine.get("readmission_rule"),
                "quarantine readmission_rule",
            ),
        ),
        required_version_fields=_string_tuple(
            item.get("required_version_fields"),
            "required_version_fields",
        ),
    )
    if profile.retention.promoted_artifact_days < profile.retention.artifact_days:
        raise ValueError("promoted_artifact_days must be >= artifact_days")
    return profile


def _unique_failure_classes(failures: list[tuple[str, str]]) -> tuple[str, ...]:
    ordered: list[str] = []
    for failure_class, _ in failures:
        if failure_class not in ordered:
            ordered.append(failure_class)
    return tuple(ordered)


def _load_json(path: Path) -> dict[str, object]:
    payload = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(payload, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return payload


def _mapping(value: object, field_name: str) -> dict[str, object]:
    if not isinstance(value, dict):
        raise ValueError(f"{field_name} must be an object")
    return dict(value)


def _string_tuple(value: object, field_name: str) -> tuple[str, ...]:
    if not isinstance(value, list | tuple) or not value:
        raise ValueError(f"{field_name} must be a non-empty list")
    items = tuple(_required_string(item, field_name) for item in value)
    if len(set(items)) != len(items):
        raise ValueError(f"{field_name} must not contain duplicates")
    return items


def _required_string(value: object, field_name: str) -> str:
    normalized = "" if value is None else str(value).strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    return normalized


def _positive_int(value: object, field_name: str) -> int:
    parsed = int(value or 0)
    if parsed <= 0:
        raise ValueError(f"{field_name} must be positive")
    return parsed


def _non_negative_int(value: object, field_name: str) -> int:
    parsed = int(value or 0)
    if parsed < 0:
        raise ValueError(f"{field_name} must be non-negative")
    return parsed


def _non_negative_float(value: object, field_name: str) -> float:
    parsed = float(value or 0.0)
    if parsed < 0:
        raise ValueError(f"{field_name} must be non-negative")
    return parsed


__all__ = [
    "EVAL_OPERATIONS_PROFILE_POLICY_PATH",
    "EvalOperationsBreakerPolicy",
    "EvalOperationsBudget",
    "EvalOperationsGovernanceReport",
    "EvalOperationsObservation",
    "EvalOperationsPolicy",
    "EvalOperationsProfilePolicy",
    "EvalOperationsProfileResult",
    "EvalOperationsQuarantinePolicy",
    "EvalOperationsRetentionPolicy",
    "evaluate_eval_operations_governance",
    "load_eval_operations_profile_policy",
]
