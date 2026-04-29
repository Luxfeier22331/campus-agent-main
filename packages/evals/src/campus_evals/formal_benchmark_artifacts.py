from __future__ import annotations

import json
from collections import Counter
from dataclasses import asdict, is_dataclass
from pathlib import Path

from campus_contracts import EvidenceSource, KnowledgeScope

from campus_evals.models import (
    CaseResult,
    DimensionResult,
    GoldenCase,
    ObservedTrace,
    OrchestrationCaseResults,
    RunReport,
    SummaryCount,
    SupplementalResult,
    WorkflowTraceSummary,
)
from campus_evals.operator_observability import OperatorRequestCorrelation


def _case_set_summary(cases: tuple[GoldenCase, ...]) -> dict[str, object]:
    split_counts = Counter(case.split for case in cases)
    expected_status_counts = Counter(case.expected_status for case in cases)
    return {
        "total_cases": len(cases),
        "case_ids": [case.case_id for case in cases],
        "split_counts": dict(split_counts),
        "expected_status_counts": dict(expected_status_counts),
    }


def _write_run_artifacts(
    *,
    output_dir: Path,
    benchmark_type: str,
    run_number: int,
    report: RunReport,
    extra_payload: dict[str, object] | None = None,
) -> None:
    run_prefix = f"run-{run_number:02d}"
    base_payload = {
        "schema_version": 1,
        "benchmark_type": benchmark_type,
        "run_number": run_number,
    }
    if extra_payload:
        base_payload.update(extra_payload)
    _write_json(
        output_dir / f"{run_prefix}-case-results.json",
        {
            **base_payload,
            "results": [_serialize_case_result(result) for result in report.results],
        },
    )
    _write_json(
        output_dir / f"{run_prefix}-summary.json",
        {
            **base_payload,
            "summary": _serialize_run_report(report),
        },
    )


def _serialize_run_report(report: RunReport) -> dict[str, object]:
    return {
        "total": report.total,
        "passed": report.passed,
        "failed": report.failed,
        "by_split": {
            name: _serialize_summary_count(item) for name, item in report.by_split.items()
        },
        "by_dimension": {
            name: _serialize_summary_count(item) for name, item in report.by_dimension.items()
        },
        "by_metric": {
            name: _serialize_summary_count(item) for name, item in report.by_metric.items()
        },
        "by_supplemental": {
            name: _serialize_dataclass(item) for name, item in report.by_supplemental.items()
        },
    }


def _serialize_case_result(result: CaseResult) -> dict[str, object]:
    return {
        "case_id": result.case_id,
        "passed": result.passed,
        "status_result": _serialize_dimension_result(result.status_result),
        "retrieval_result": _serialize_dimension_result(result.retrieval_result),
        "answer_result": _serialize_dimension_result(result.answer_result),
        "trace_result": _serialize_dimension_result(result.trace_result),
        "metric_results": {
            name: _serialize_dimension_result(metric_result)
            for name, metric_result in result.metric_results.items()
        },
        "observed_trace": (
            _serialize_dataclass(result.observed_trace)
            if result.observed_trace is not None
            else None
        ),
        "request_correlation": (
            _serialize_dataclass(result.request_correlation)
            if result.request_correlation is not None
            else None
        ),
        "workflow_trace_summary": (
            _serialize_dataclass(result.workflow_trace_summary)
            if result.workflow_trace_summary is not None
            else None
        ),
        "orchestration_case_results": (
            _serialize_dataclass(result.orchestration_case_results)
            if result.orchestration_case_results is not None
            else None
        ),
        "supplemental_results": [
            _serialize_dataclass(item) for item in result.supplemental_results
        ],
    }


def _serialize_summary_count(item: SummaryCount) -> dict[str, object]:
    return {
        "total": item.total,
        "passed": item.passed,
        "failed": item.failed,
        "pass_rate": item.pass_rate,
        "reason": item.reason,
    }


def _serialize_dimension_result(item: object) -> dict[str, object]:
    if is_dataclass(item):
        return asdict(item)
    return dict(item)


def _serialize_dataclass(item: object) -> dict[str, object]:
    if is_dataclass(item):
        return asdict(item)
    if isinstance(item, dict):
        return dict(item)
    raise TypeError(f"cannot serialize object of type {type(item)!r}")


def _deserialize_case_result(payload: dict[str, object]) -> CaseResult:
    metric_results = {
        str(name): _deserialize_dimension_result(item)
        for name, item in dict(payload.get("metric_results") or {}).items()
    }
    supplemental_results = tuple(
        _deserialize_supplemental_result(item) for item in payload.get("supplemental_results") or ()
    )
    return CaseResult(
        case_id=str(payload["case_id"]),
        passed=bool(payload["passed"]),
        status_result=_deserialize_dimension_result(payload["status_result"]),
        retrieval_result=_deserialize_dimension_result(payload["retrieval_result"]),
        answer_result=_deserialize_dimension_result(payload["answer_result"]),
        trace_result=_deserialize_dimension_result(payload["trace_result"]),
        metric_results=metric_results,
        observed_trace=_deserialize_observed_trace(payload.get("observed_trace")),
        request_correlation=_deserialize_request_correlation(payload.get("request_correlation")),
        workflow_trace_summary=_deserialize_workflow_trace_summary(
            payload.get("workflow_trace_summary")
        ),
        orchestration_case_results=_deserialize_orchestration_case_results(
            payload.get("orchestration_case_results")
        ),
        supplemental_results=supplemental_results,
    )


def _deserialize_dimension_result(payload: object) -> DimensionResult:
    item = dict(payload or {})
    return DimensionResult(
        passed=bool(item.get("passed")),
        reason=str(item.get("reason") or ""),
    )


def _deserialize_supplemental_result(payload: object) -> SupplementalResult:
    item = dict(payload or {})
    raw_score = item.get("score")
    return SupplementalResult(
        adapter_id=str(item["adapter_id"]),
        metric_name=str(item["metric_name"]),
        score=float(raw_score) if raw_score is not None else None,
        verdict=item.get("verdict"),
        rationale=str(item.get("rationale") or ""),
        gating=bool(item.get("gating") or False),
        metadata=dict(item.get("metadata") or {}),
    )


def _deserialize_observed_trace(payload: object) -> ObservedTrace | None:
    if not isinstance(payload, dict):
        return None
    selected_scope_payload = payload.get("selected_scope")
    selected_scope = None
    if isinstance(selected_scope_payload, dict):
        selected_scope = KnowledgeScope(
            corpus=str(selected_scope_payload.get("corpus") or ""),
            collection=str(selected_scope_payload.get("collection") or ""),
        )
    return ObservedTrace(
        selected_scope=selected_scope,
        retrieval_called=_deserialize_optional_bool(payload.get("retrieval_called")),
        clarification_emitted=_deserialize_optional_bool(payload.get("clarification_emitted")),
        error_path=_deserialize_optional_bool(payload.get("error_path")),
        retrieved_sources=_deserialize_evidence_sources(payload.get("retrieved_sources")),
        supporting_sources=_deserialize_evidence_sources(payload.get("supporting_sources")),
    )


def _deserialize_request_correlation(payload: object) -> OperatorRequestCorrelation | None:
    if not isinstance(payload, dict):
        return None
    return OperatorRequestCorrelation(
        case_id=str(payload.get("case_id") or ""),
        request_id=str(payload.get("request_id") or ""),
        trace_id=str(payload.get("trace_id") or ""),
        sampled_at=str(payload.get("sampled_at") or ""),
        trace_link=_deserialize_optional_string(payload.get("trace_link")),
        issue_link=_deserialize_optional_string(payload.get("issue_link")),
        issue_fingerprint=_deserialize_optional_string(payload.get("issue_fingerprint")),
    )


def _deserialize_workflow_trace_summary(payload: object) -> WorkflowTraceSummary | None:
    if not isinstance(payload, dict):
        return None
    selected_tools = payload.get("selected_tools")
    trace_steps = payload.get("trace_steps")
    tool_call_summaries = payload.get("tool_call_summaries")
    return WorkflowTraceSummary(
        routing_frame=dict(payload.get("routing_frame") or {}),
        context_resolution=dict(payload.get("context_resolution") or {}),
        planning_outcome=str(payload.get("planning_outcome") or ""),
        direct_vs_delegate_branch=str(payload.get("direct_vs_delegate_branch") or ""),
        handoff=dict(payload.get("handoff") or {}),
        selected_target=str(payload.get("selected_target") or ""),
        selected_tools=tuple(str(item) for item in selected_tools)
        if isinstance(selected_tools, list)
        else (),
        tool_argument_summary=dict(payload.get("tool_argument_summary") or {}),
        trace_steps=tuple(dict(item) for item in trace_steps)
        if isinstance(trace_steps, list)
        else (),
        tool_call_summaries=tuple(dict(item) for item in tool_call_summaries)
        if isinstance(tool_call_summaries, list)
        else (),
        guardrail_outcomes=dict(payload.get("guardrail_outcomes") or {}),
        fail_close_reason=str(payload.get("fail_close_reason") or ""),
        runtime_versions=dict(payload.get("runtime_versions") or {}),
        policy_artifact_versions=dict(payload.get("policy_artifact_versions") or {}),
    )


def _deserialize_orchestration_case_results(
    payload: object,
) -> OrchestrationCaseResults | None:
    if not isinstance(payload, dict):
        return None
    return OrchestrationCaseResults(
        direct_vs_delegate_branch_correctness=_deserialize_dimension_result(
            payload.get("direct_vs_delegate_branch_correctness")
        ),
        handoff_correctness=_deserialize_dimension_result(payload.get("handoff_correctness")),
        tool_argument_precision=_deserialize_dimension_result(
            payload.get("tool_argument_precision")
        ),
        guardrail_correctness=_deserialize_dimension_result(payload.get("guardrail_correctness")),
        fail_close_correctness=_deserialize_dimension_result(payload.get("fail_close_correctness")),
        trace_projection_completeness=_deserialize_dimension_result(
            payload.get("trace_projection_completeness")
        ),
        tool_order_correctness=_deserialize_dimension_result(
            payload.get("tool_order_correctness")
            or {"passed": True, "reason": "not_applicable"}
        ),
        tool_result_status_correctness=_deserialize_dimension_result(
            payload.get("tool_result_status_correctness")
            or {"passed": True, "reason": "not_applicable"}
        ),
        fail_close_provenance=_deserialize_dimension_result(
            payload.get("fail_close_provenance")
            or {"passed": True, "reason": "not_applicable"}
        ),
        evidence_source_selection=_deserialize_dimension_result(
            payload.get("evidence_source_selection")
            or {"passed": True, "reason": "not_applicable"}
        ),
    )


def _deserialize_evidence_sources(payload: object) -> tuple[EvidenceSource, ...]:
    if not isinstance(payload, list):
        return ()
    return tuple(_deserialize_evidence_source(item) for item in payload if isinstance(item, dict))


def _deserialize_evidence_source(payload: dict[str, object]) -> EvidenceSource:
    structural_path = payload.get("structural_path")
    return EvidenceSource(
        doc_id=str(payload.get("doc_id") or ""),
        revision_track=str(payload.get("revision_track") or "source-faithful"),
        version_id=str(payload.get("version_id") or ""),
        chunk_id=str(payload.get("chunk_id") or ""),
        anchor=dict(payload.get("anchor") or {}),
        canonical_url=str(payload.get("canonical_url") or ""),
        latest_url=str(payload.get("latest_url") or ""),
        source_channel=str(payload.get("source_channel") or "pdf_ocr"),
        collection=str(payload.get("collection") or ""),
        is_current=bool(payload.get("is_current")),
        snippet=str(payload.get("snippet") or ""),
        score=float(payload.get("score") or 0.0),
        source_title=str(payload.get("source_title") or ""),
        structural_path=tuple(str(item) for item in structural_path)
        if isinstance(structural_path, list)
        else (),
        content_kind=str(payload.get("content_kind") or ""),
        content_role=str(payload.get("content_role") or ""),
        detail_label=str(payload.get("detail_label") or ""),
        is_answer_bearing=bool(payload.get("is_answer_bearing")),
    )


def _deserialize_optional_bool(value: object) -> bool | None:
    if value is None:
        return None
    return bool(value)


def _deserialize_optional_string(value: object) -> str | None:
    normalized = str(value or "").strip()
    return normalized or None


def _load_run_case_result_payloads(benchmark_dir: str | Path) -> list[dict[str, object]]:
    resolved_dir = Path(benchmark_dir)
    payloads: list[dict[str, object]] = []
    for path in sorted(resolved_dir.glob("run-*-case-results.json")):
        payload = _load_json(path)
        payloads.append(
            {
                "run_number": int(payload["run_number"]),
                "results": [dict(item) for item in payload.get("results") or ()],
            }
        )
    payloads.sort(key=lambda item: item["run_number"])
    return payloads


def _load_json(path: Path) -> dict[str, object]:
    return json.loads(path.read_text(encoding="utf-8"))


def _load_optional_json(path: Path) -> dict[str, object] | None:
    if not path.exists():
        return None
    return _load_json(path)


def _metric_key_from_payload(payload: dict[str, object]) -> str:
    return f"{payload['adapter_id']}.{payload['metric_name']}"


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _write_repair_summary(
    *,
    output_dir: Path,
    benchmark_dir: Path,
    targets: list[dict[str, object]],
    repair_entries: list[dict[str, object]],
    applied_target_count: int,
) -> None:
    target_metric_keys = sorted(
        {metric_key for target in targets for metric_key in target.get("metric_keys", [])}
    )
    repaired_metric_keys = sorted(
        {
            str(metric_key)
            for entry in repair_entries
            for metric_key in entry.get("recovered_metric_keys", [])
            if metric_key is not None
        }
    )
    failed_metric_keys = sorted(
        {
            str(metric_key)
            for entry in repair_entries
            for metric_key in entry.get("remaining_metric_keys", [])
            if metric_key is not None
        }
    )
    skipped_metric_keys = sorted(
        {
            str(metric_key)
            for entry in repair_entries
            if entry.get("status") == "skipped_provider_unavailable"
            for metric_key in entry.get("skipped_metric_keys", [])
            if metric_key is not None
        }
    )
    remaining_metric_keys = sorted(set(target_metric_keys) - set(repaired_metric_keys))
    _write_json(
        output_dir / "repair-summary.json",
        {
            "schema_version": 1,
            "repair_of": str(benchmark_dir),
            "selected_target_count": len(targets),
            "applied_target_count": applied_target_count,
            "status_counts": dict(
                Counter(str(entry.get("status") or "unknown") for entry in repair_entries)
            ),
            "target_metric_keys": target_metric_keys,
            "repaired_metric_keys": repaired_metric_keys,
            "failed_metric_keys": failed_metric_keys,
            "skipped_metric_keys": skipped_metric_keys,
            "remaining_metric_keys": remaining_metric_keys,
        },
    )
