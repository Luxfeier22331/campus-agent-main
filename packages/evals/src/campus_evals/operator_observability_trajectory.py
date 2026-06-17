from __future__ import annotations

from collections.abc import Mapping
from typing import Protocol


class _OperatorRequestCorrelation(Protocol):
    request_id: str


class _OperatorObservabilityDetailClient(Protocol):
    def fetch_request_observability(self, request_id: str) -> dict[str, object]: ...


def inject_operator_step_trajectories(
    combined_report: dict[str, object],
    *,
    correlations: Mapping[str, _OperatorRequestCorrelation],
    client: _OperatorObservabilityDetailClient,
    release_strict: bool = False,
) -> dict[str, object]:
    cases = combined_report.get("cases")
    if not isinstance(cases, list):
        raise ValueError("cases is required")
    enriched = {**combined_report, "cases": []}
    enriched_cases: list[dict[str, object]] = []
    for index, raw_case in enumerate(cases):
        if not isinstance(raw_case, dict):
            raise ValueError(f"cases[{index}] must be an object")
        case = dict(raw_case)
        case_id = _required_string(case.get("case_id"), f"cases[{index}].case_id")
        correlation = correlations.get(case_id)
        if correlation is None:
            if release_strict:
                raise ValueError(f"request correlation is required for case {case_id}")
            enriched_cases.append(case)
            continue
        from campus_evals.operator_step_trajectory import normalize_operator_step_trajectory

        detail = client.fetch_request_observability(correlation.request_id)
        trajectory = normalize_operator_step_trajectory(detail)
        if trajectory.get("requestId") != correlation.request_id:
            raise ValueError(f"operator step trajectory request id mismatch for case {case_id}")
        case["operator_step_trajectory"] = trajectory
        enriched_cases.append(case)
    enriched["cases"] = enriched_cases
    return enriched


def _required_string(value: object, field: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{field} is required")
    return normalized
