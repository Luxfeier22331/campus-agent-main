from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

COMPONENT_EVAL_CASE_FAMILY = "answer_ready_component_eval.v1"


@dataclass(frozen=True, slots=True)
class ComponentEvalReleaseStatus:
    component_eval_status: str
    semantic_oracle_status: str
    passed_case_count: int
    failed_case_count: int


def derive_component_eval_release_status(
    component_eval_summary: Mapping[str, object] | None,
) -> ComponentEvalReleaseStatus:
    if component_eval_summary is None:
        return ComponentEvalReleaseStatus(
            component_eval_status="",
            semantic_oracle_status="failed",
            passed_case_count=0,
            failed_case_count=0,
        )
    _validate_component_eval_summary(component_eval_summary)
    summary_payload = component_eval_summary.get("summary")
    if not isinstance(summary_payload, Mapping):
        raise ValueError("component eval summary.summary must be an object")
    overall_passed = bool(summary_payload.get("overall_passed"))
    passed_case_count = int(summary_payload.get("passed") or 0)
    failed_case_count = int(summary_payload.get("failed") or 0)
    component_eval_status = "passed" if overall_passed else "failed"
    return ComponentEvalReleaseStatus(
        component_eval_status=component_eval_status,
        semantic_oracle_status="passed" if overall_passed else "failed",
        passed_case_count=passed_case_count,
        failed_case_count=failed_case_count,
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


__all__ = [
    "COMPONENT_EVAL_CASE_FAMILY",
    "ComponentEvalReleaseStatus",
    "derive_component_eval_release_status",
]
