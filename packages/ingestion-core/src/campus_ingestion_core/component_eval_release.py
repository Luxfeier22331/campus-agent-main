from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass

COMPONENT_EVAL_CASE_FAMILY = "answer_ready_component_eval.v1"
_FALLBACK_BUDGET_FAILURE_CLASS = "fallback_budget_regression"


@dataclass(frozen=True, slots=True)
class ComponentEvalReleaseStatus:
    component_eval_status: str
    semantic_oracle_status: str
    fallback_budget_status: str
    passed_case_count: int
    failed_case_count: int
    fallback_budget_regression_count: int


def derive_component_eval_release_status(
    component_eval_summary: Mapping[str, object] | None,
) -> ComponentEvalReleaseStatus:
    if component_eval_summary is None:
        return ComponentEvalReleaseStatus(
            component_eval_status="",
            semantic_oracle_status="pending_phase8",
            fallback_budget_status="not_applicable",
            passed_case_count=0,
            failed_case_count=0,
            fallback_budget_regression_count=0,
        )
    _validate_component_eval_summary(component_eval_summary)
    summary_payload = component_eval_summary.get("summary")
    if not isinstance(summary_payload, Mapping):
        raise ValueError("component eval summary.summary must be an object")
    overall_passed = bool(summary_payload.get("overall_passed"))
    passed_case_count = int(summary_payload.get("passed") or 0)
    failed_case_count = int(summary_payload.get("failed") or 0)
    failure_classes = _failure_classes_from_results(component_eval_summary.get("results"))
    fallback_budget_regression_count = sum(
        1 for failure_class in failure_classes if failure_class == _FALLBACK_BUDGET_FAILURE_CLASS
    )
    component_eval_status = "passed" if overall_passed else "failed"
    return ComponentEvalReleaseStatus(
        component_eval_status=component_eval_status,
        semantic_oracle_status="passed" if overall_passed else "failed",
        fallback_budget_status=("failed" if fallback_budget_regression_count > 0 else "passed"),
        passed_case_count=passed_case_count,
        failed_case_count=failed_case_count,
        fallback_budget_regression_count=fallback_budget_regression_count,
    )


def _validate_component_eval_summary(component_eval_summary: Mapping[str, object]) -> None:
    case_family = str(component_eval_summary.get("case_family") or "").strip()
    if case_family != COMPONENT_EVAL_CASE_FAMILY:
        raise ValueError(
            "component eval summary case_family must be answer_ready_component_eval.v1"
        )
    if not isinstance(component_eval_summary.get("summary"), Mapping):
        raise ValueError("component eval summary must include summary object")
    results = component_eval_summary.get("results")
    if not isinstance(results, list):
        raise ValueError("component eval summary results must be a list")


def _failure_classes_from_results(results: object) -> tuple[str, ...]:
    values: list[str] = []
    for item in results if isinstance(results, Sequence) else ():
        if not isinstance(item, Mapping):
            continue
        raw_failure_classes = item.get("failure_classes")
        if not isinstance(raw_failure_classes, Sequence) or isinstance(
            raw_failure_classes,
            (str, bytes),
        ):
            continue
        for failure_class in raw_failure_classes:
            normalized = str(failure_class or "").strip()
            if normalized:
                values.append(normalized)
    return tuple(values)


__all__ = [
    "COMPONENT_EVAL_CASE_FAMILY",
    "ComponentEvalReleaseStatus",
    "derive_component_eval_release_status",
]
