from __future__ import annotations

from math import isnan

from campus_contracts import SpecialistResponse, SupervisorResponse

from campus_evals.models import GoldenCase, SupplementalResult
from campus_evals.supplemental_http import format_runtime_exception_message


def _extract_ragas_score_row(evaluation: object) -> dict[str, object]:
    scores = getattr(evaluation, "scores", None)
    if not isinstance(scores, list) or len(scores) != 1 or not isinstance(scores[0], dict):
        raise ValueError("ragas evaluation must return exactly one score row")
    return scores[0]


def _extract_metric_value(
    row: dict[str, object], *, requested_name: str, actual_name: str
) -> object:
    if actual_name in row:
        return row.get(actual_name)
    return row.get(requested_name)


def _build_supplemental_result(
    *,
    metric_name: str,
    value: object,
    projection,
    metadata: dict[str, object] | None = None,
) -> SupplementalResult:
    score = _coerce_score(value)
    if score is None:
        return SupplementalResult(
            adapter_id="ragas",
            metric_name=metric_name,
            verdict="not_applicable",
            rationale=f"ragas metric {metric_name} did not return a numeric score",
            metadata={
                "case_id": projection.case_id,
                **dict(metadata or {}),
            },
        )
    return SupplementalResult(
        adapter_id="ragas",
        metric_name=metric_name,
        score=score,
        rationale=f"ragas metric {metric_name} scored projection {projection.case_id}",
        metadata={
            "case_id": projection.case_id,
            "metric_applicable": True,
            **dict(metadata or {}),
        },
    )


def _build_runtime_failed_supplemental_result(
    *,
    metric_name: str,
    projection,
    exc: Exception,
) -> SupplementalResult:
    return SupplementalResult(
        adapter_id="ragas",
        metric_name=metric_name,
        score=None,
        verdict="failed",
        rationale=f"ragas runtime error: {format_runtime_exception_message(exc)}",
        metadata={
            "case_id": projection.case_id,
            "metric_applicable": True,
            **_runtime_failure_metadata(exc),
        },
    )


def _coerce_score(value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return float(value)
    if isinstance(value, (int, float)):
        numeric = float(value)
        return None if isnan(numeric) else numeric
    return None


def _attach_case_metadata(
    *,
    result: SupplementalResult,
    case: GoldenCase,
    response: SpecialistResponse | SupervisorResponse,
) -> SupplementalResult:
    return SupplementalResult(
        adapter_id=result.adapter_id,
        metric_name=result.metric_name,
        score=result.score,
        verdict=result.verdict,
        rationale=result.rationale,
        gating=result.gating,
        metadata={
            "case_id": case.case_id,
            "expected_status": case.expected_status,
            "response_status": response.status,
            "metric_applicable": dict(result.metadata).get("metric_applicable", True),
            **dict(result.metadata),
        },
    )


def _build_not_applicable_result(
    *,
    metric_name: str,
    case: GoldenCase,
    response: SpecialistResponse | SupervisorResponse,
    rationale: str,
    metric_applicable: bool,
) -> SupplementalResult:
    return SupplementalResult(
        adapter_id="ragas",
        metric_name=metric_name,
        verdict="not_applicable",
        rationale=rationale,
        metadata={
            "case_id": case.case_id,
            "expected_status": case.expected_status,
            "response_status": response.status,
            "metric_applicable": metric_applicable,
        },
    )


def _build_failed_result(
    *,
    metric_name: str,
    case: GoldenCase,
    response: SpecialistResponse | SupervisorResponse,
    rationale: str,
    score: float | None,
    metadata: dict[str, object] | None = None,
) -> SupplementalResult:
    return SupplementalResult(
        adapter_id="ragas",
        metric_name=metric_name,
        score=score,
        verdict="failed",
        rationale=rationale,
        metadata={
            "case_id": case.case_id,
            "expected_status": case.expected_status,
            "response_status": response.status,
            **dict(metadata or {}),
        },
    )


def _runtime_failure_metadata(exc: Exception) -> dict[str, object]:
    metadata: dict[str, object] = {
        "judge_error": type(exc).__name__,
    }
    reasons = tuple(str(item) for item in getattr(exc, "reasons", ()) if str(item))
    if reasons:
        metadata["failure_reasons"] = list(reasons)
    disposition = getattr(exc, "disposition", None)
    if isinstance(disposition, str) and disposition.strip():
        metadata["failure_disposition"] = disposition
    for attr in (
        "provider_origin",
        "http_status",
        "request_id",
        "faithfulness_stage",
        "checkpoint_path",
        "source_checkpoint_path",
        "sample_hash",
        "statement_count",
        "completed_batch_count",
        "remaining_batch_count",
    ):
        value = getattr(exc, attr, None)
        if value not in (None, "", (), []):
            metadata[attr] = value
    return metadata
