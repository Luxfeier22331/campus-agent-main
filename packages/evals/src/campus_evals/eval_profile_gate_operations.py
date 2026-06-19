from __future__ import annotations

from collections.abc import Sequence
from pathlib import Path

from campus_evals.eval_operations_governance import (
    EvalOperationsObservation,
    EvalOperationsPolicy,
)
from campus_evals.eval_profile_gate_loading import (
    _list_of_mappings,
    _load_json,
    _mapping,
    _non_negative_int,
    _required_string,
    _result_disposition,
    _runtime_metrics_missing,
)
from campus_evals.eval_profile_gate_models import DEFAULT_POLICY_ARTIFACT
from campus_evals.profile_registry import get_profile_definition, resolve_profile_id


def derive_eval_operations_observations_from_artifacts(
    artifact_paths: Sequence[Path],
    *,
    gate_mode: str,
) -> dict[str, EvalOperationsObservation]:
    observations: dict[str, EvalOperationsObservation] = {}
    for path in artifact_paths:
        payload = _load_json(path)
        profile_id = _artifact_profile_id(payload)
        summary = _mapping(payload.get("summary") or {}, "summary")
        results = _list_of_mappings(payload.get("sanitized_results") or [], "sanitized_results")
        if not results and isinstance(payload.get("checks"), list):
            results = tuple(
                {
                    "case_id": _required_string(check.get("check_id"), "check.check_id"),
                    "passed": bool(check.get("passed")),
                    "failure_class": "failed_check",
                }
                for check in _list_of_mappings(payload.get("checks"), "checks")
            )
        failed_cases = tuple(
            _required_string(result.get("case_id"), "result.case_id")
            for result in results
            if result.get("passed") is False
        )
        case_dispositions = {
            case_id: _result_disposition(result)
            for case_id, result in (
                (_required_string(item.get("case_id"), "result.case_id"), item)
                for item in results
                if item.get("passed") is False
            )
        }
        observations[profile_id] = EvalOperationsObservation(
            profile_id=profile_id,
            gate_mode=gate_mode,
            cases_run=_non_negative_int(
                summary.get("total") or summary.get("total_checks"),
                "summary.total",
            ),
            runtime_seconds=_non_negative_int(
                summary.get("runtime_seconds") or 0,
                "summary.runtime_seconds",
            ),
            retry_count=_non_negative_int(summary.get("retry_count") or 0, "summary.retry_count"),
            artifact_age_days=_non_negative_int(
                summary.get("artifact_age_days") or 0,
                "summary.artifact_age_days",
            ),
            provider_calls=_non_negative_int(
                summary.get("provider_calls") or 0,
                "summary.provider_calls",
            ),
            metrics_missing=_runtime_metrics_missing(summary),
            failed_cases=failed_cases,
            case_dispositions=case_dispositions,
            version_summary=_artifact_version_summary(payload, profile_id),
        )
    return observations


def _filter_eval_operations_policy(
    policy: EvalOperationsPolicy,
    profile_ids: tuple[str, ...],
) -> EvalOperationsPolicy:
    profile_id_set = set(profile_ids)
    return EvalOperationsPolicy(
        schema_version=policy.schema_version,
        policy_id=policy.policy_id,
        profiles={
            profile_id: profile
            for profile_id, profile in policy.profiles.items()
            if profile_id in profile_id_set
        },
    )


def _artifact_profile_id(payload: dict[str, object]) -> str:
    raw_profile_id = str(payload.get("profile_id") or "").strip()
    if raw_profile_id:
        return _operations_profile_id(raw_profile_id)
    gate_id = str(payload.get("gate_id") or "").strip()
    if gate_id:
        return gate_id
    benchmark_type = str(payload.get("benchmark_type") or "").strip()
    if benchmark_type:
        return benchmark_type
    return _required_string(payload.get("profile_id"), "profile_id")


def _operations_profile_id(profile_id: str) -> str:
    try:
        return get_profile_definition(resolve_profile_id(profile_id)).policy_profile_id
    except ValueError:
        return profile_id


def _artifact_version_summary(
    payload: dict[str, object],
    profile_id: str,
) -> dict[str, object]:
    version_summary = _mapping(payload.get("version_summary") or {}, "version_summary")
    if version_summary.get("case_set_version") and version_summary.get("policy_artifact"):
        return version_summary
    return {
        **version_summary,
        "case_set_version": version_summary.get("case_set_version") or profile_id,
        "policy_artifact": version_summary.get("policy_artifact") or DEFAULT_POLICY_ARTIFACT,
        "runtime_version": version_summary.get("runtime_version")
        or version_summary.get("runner")
        or payload.get("schema_version")
        or "unknown",
    }


__all__ = [
    "derive_eval_operations_observations_from_artifacts",
]
