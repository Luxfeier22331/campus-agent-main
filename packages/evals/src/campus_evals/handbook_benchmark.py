from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import asdict, is_dataclass, replace
import json
from pathlib import Path
from statistics import fmean
from typing import Callable

from campus_contracts import EvidenceSource, KnowledgeScope
from campus_evals.judge_gate import evaluate_judge_gate, load_judge_gate_policy
from campus_evals.models import (
    CaseResult,
    DimensionResult,
    ExecutionResult,
    GoldenCase,
    ObservedTrace,
    RunReport,
    SupplementalResult,
    SummaryCount,
)
from campus_evals.supplemental_http import classify_runtime_failure
from campus_evals.runner import SupplementalAdapter, run_cases, summarize_case_results


Executor = Callable[[GoldenCase], ExecutionResult]


def run_handbook_formal_benchmark(
    *,
    cases: tuple[GoldenCase, ...],
    executor: Executor,
    supplemental_adapters: tuple[SupplementalAdapter, ...],
    output_dir: str | Path,
    reruns: int,
    policy_path: str | Path | None = None,
    benchmark_type: str = "formal_benchmark",
) -> dict[str, object]:
    if reruns <= 0:
        raise ValueError("reruns must be greater than zero")
    resolved_output_dir = Path(output_dir)
    resolved_output_dir.mkdir(parents=True, exist_ok=True)
    policy = load_judge_gate_policy(policy_path)
    supplemental_preflight = _run_supplemental_preflight(supplemental_adapters)
    supplemental_preflight_path = resolved_output_dir / "supplemental-preflight.json"
    _write_json(supplemental_preflight_path, supplemental_preflight)
    _raise_for_blocking_preflight_entries(supplemental_preflight)
    runnable_supplemental_adapters = _select_runnable_supplemental_adapters(
        supplemental_adapters=supplemental_adapters,
        supplemental_preflight=supplemental_preflight,
    )

    _write_json(
        resolved_output_dir / "benchmark-config.json",
        {
            "schema_version": 1,
            "benchmark_type": benchmark_type,
            "reruns": reruns,
            "policy_path": policy.get("path"),
            "supplemental_adapters": [adapter.adapter_id for adapter in supplemental_adapters],
            "supplemental_preflight_path": str(supplemental_preflight_path),
            "supplemental_preflight": supplemental_preflight["summary"],
            "case_set": _case_set_summary(cases),
        },
    )

    run_reports: list[RunReport] = []
    for run_number in range(1, reruns + 1):
        report = run_cases(
            cases,
            executor=executor,
            supplemental_adapters=runnable_supplemental_adapters,
        )
        run_reports.append(report)
        _write_run_artifacts(
            output_dir=resolved_output_dir,
            benchmark_type=benchmark_type,
            run_number=run_number,
            report=report,
        )

    return _write_benchmark_summary(
        output_dir=resolved_output_dir,
        benchmark_type=benchmark_type,
        reruns=reruns,
        cases=cases,
        policy=policy,
        run_reports=run_reports,
        supplemental_preflight=supplemental_preflight,
    )


def collect_repairable_handbook_benchmark_targets(
    benchmark_dir: str | Path,
) -> list[dict[str, object]]:
    grouped: dict[tuple[int, str, str], dict[str, object]] = {}
    for run_payload in _load_run_case_result_payloads(benchmark_dir):
        run_number = int(run_payload["run_number"])
        for result_payload in run_payload["results"]:
            case_id = str(result_payload["case_id"])
            for supplemental_payload in result_payload["supplemental_results"]:
                failure_reasons = _repairable_failure_reasons(supplemental_payload)
                if not failure_reasons:
                    continue
                adapter_id = str(supplemental_payload["adapter_id"])
                group_key = (run_number, case_id, adapter_id)
                target = grouped.get(group_key)
                if target is None:
                    target = {
                        "run_number": run_number,
                        "case_id": case_id,
                        "adapter_id": adapter_id,
                        "metric_keys": [],
                        "failure_reasons": [],
                        "supplemental_failures": [],
                    }
                    grouped[group_key] = target
                metric_key = _metric_key_from_payload(supplemental_payload)
                target["metric_keys"].append(metric_key)
                target["failure_reasons"].extend(failure_reasons)
                target["supplemental_failures"].append(
                    {
                        "metric_key": metric_key,
                        "rationale": str(supplemental_payload.get("rationale") or ""),
                        "metadata": dict(supplemental_payload.get("metadata") or {}),
                    }
                )
    resolved: list[dict[str, object]] = []
    for target in sorted(grouped.values(), key=lambda item: (item["run_number"], item["case_id"], item["adapter_id"])):
        resolved.append(
            {
                **target,
                "metric_keys": sorted(set(target["metric_keys"])),
                "failure_reasons": list(dict.fromkeys(target["failure_reasons"])),
            }
        )
    return resolved


def repair_handbook_formal_benchmark(
    *,
    cases: tuple[GoldenCase, ...],
    executor: Executor,
    supplemental_adapters: tuple[SupplementalAdapter, ...],
    benchmark_dir: str | Path,
    output_dir: str | Path,
    policy_path: str | Path | None = None,
    benchmark_type: str = "formal_benchmark_repair",
) -> dict[str, object]:
    resolved_benchmark_dir = Path(benchmark_dir)
    resolved_output_dir = Path(output_dir)
    resolved_output_dir.mkdir(parents=True, exist_ok=True)
    original_config = _load_json(resolved_benchmark_dir / "benchmark-config.json")
    policy = load_judge_gate_policy(policy_path or original_config.get("policy_path"))
    targets = collect_repairable_handbook_benchmark_targets(resolved_benchmark_dir)
    grouped_targets = _group_repair_targets_by_run_case(targets)
    case_index = {case.case_id: case for case in cases}
    original_run_payloads = _load_run_case_result_payloads(resolved_benchmark_dir)
    supplemental_preflight = _run_supplemental_preflight(supplemental_adapters)
    supplemental_preflight_path = resolved_output_dir / "supplemental-preflight.json"
    _write_json(supplemental_preflight_path, supplemental_preflight)
    _raise_for_blocking_preflight_entries(supplemental_preflight)
    runnable_supplemental_adapters = _select_runnable_supplemental_adapters(
        supplemental_adapters=supplemental_adapters,
        supplemental_preflight=supplemental_preflight,
    )
    skipped_metric_details = _skipped_supplemental_metric_details(supplemental_preflight)

    _write_json(
        resolved_output_dir / "repair-config.json",
        {
            "schema_version": 1,
            "benchmark_type": benchmark_type,
            "repair_of": str(resolved_benchmark_dir),
            "source_benchmark_type": original_config.get("benchmark_type"),
            "policy_path": policy.get("path"),
            "supplemental_adapters": [adapter.adapter_id for adapter in supplemental_adapters],
            "supplemental_preflight_path": str(supplemental_preflight_path),
            "supplemental_preflight": supplemental_preflight["summary"],
            "selected_target_count": len(targets),
        },
    )
    _write_json(
        resolved_output_dir / "repair-plan.json",
        {
            "schema_version": 1,
            "benchmark_type": benchmark_type,
            "repair_of": str(resolved_benchmark_dir),
            "targets": targets,
        },
    )

    repaired_run_reports: list[RunReport] = []
    applied_target_count = 0
    for run_payload in original_run_payloads:
        run_number = int(run_payload["run_number"])
        original_results = tuple(_deserialize_case_result(item) for item in run_payload["results"])
        results_by_case_id = {result.case_id: result for result in original_results}
        repair_entries: list[dict[str, object]] = []

        for case_id, case_targets in grouped_targets.get(run_number, {}).items():
            case = case_index.get(case_id)
            if case is None:
                raise ValueError(f"repair target references unknown case_id: {case_id}")
            targeted_metric_keys = sorted(
                {
                    metric_key
                    for target in case_targets
                    for metric_key in target["metric_keys"]
                }
            )
            skipped_metric_keys = sorted(
                metric_key
                for metric_key in targeted_metric_keys
                if metric_key in skipped_metric_details
            )
            if skipped_metric_keys and set(skipped_metric_keys) == set(targeted_metric_keys):
                repair_entries.append(
                    {
                        "case_id": case_id,
                        "targets": case_targets,
                        "status": "skipped_provider_unavailable",
                        "skipped_metric_keys": skipped_metric_keys,
                        "preflight_failures": [
                            skipped_metric_details[metric_key]
                            for metric_key in skipped_metric_keys
                        ],
                    }
                )
                continue
            runnable_metric_keys = sorted(set(targeted_metric_keys) - set(skipped_metric_keys))
            selected_adapters = _select_repair_adapters(
                supplemental_adapters=runnable_supplemental_adapters,
                metric_keys=tuple(runnable_metric_keys),
            )
            rerun_report = run_cases(
                (case,),
                executor=executor,
                supplemental_adapters=selected_adapters,
            )
            rerun_case_result = rerun_report.results[0]
            replacement_by_metric_key = {
                _supplemental_metric_key(item): item
                for item in rerun_case_result.supplemental_results
                if _supplemental_metric_key(item) in runnable_metric_keys
            }
            missing_metric_keys = sorted(set(runnable_metric_keys) - set(replacement_by_metric_key))
            if missing_metric_keys:
                raise ValueError(
                    f"repair rerun did not return supplemental results for metric keys: {missing_metric_keys}"
                )

            original_case_result = results_by_case_id[case_id]
            repaired_case_result, replacements = _merge_case_result_supplemental_results(
                original_case_result,
                replacement_by_metric_key,
            )
            results_by_case_id[case_id] = repaired_case_result
            repair_entries.append(
                {
                    "case_id": case_id,
                    "targets": case_targets,
                    "replacements": replacements,
                    "status": "repaired",
                }
            )
            applied_target_count += len(case_targets)

        repaired_results = tuple(results_by_case_id[result.case_id] for result in original_results)
        repaired_report = summarize_case_results(cases, repaired_results)
        repaired_run_reports.append(repaired_report)
        _write_json(
            resolved_output_dir / f"run-{run_number:02d}-repair-results.json",
            {
                "schema_version": 1,
                "benchmark_type": benchmark_type,
                "run_number": run_number,
                "repair_of": str(resolved_benchmark_dir),
                "results": repair_entries,
            },
        )
        _write_run_artifacts(
            output_dir=resolved_output_dir,
            benchmark_type=benchmark_type,
            run_number=run_number,
            report=repaired_report,
            extra_payload={
                "repair_of": str(resolved_benchmark_dir),
                "repaired_case_count": len(repair_entries),
            },
        )

    return _write_benchmark_summary(
        output_dir=resolved_output_dir,
        benchmark_type=benchmark_type,
        reruns=len(original_run_payloads),
        cases=cases,
        policy=policy,
        run_reports=repaired_run_reports,
        provenance={
            "mode": "repair_rerun",
            "repair_of": str(resolved_benchmark_dir),
            "source_benchmark_type": original_config.get("benchmark_type"),
        },
        repair={
            "selected_target_count": len(targets),
            "applied_target_count": applied_target_count,
            "plan_path": str(resolved_output_dir / "repair-plan.json"),
        },
        supplemental_preflight=supplemental_preflight,
    )


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


def _write_benchmark_summary(
    *,
    output_dir: Path,
    benchmark_type: str,
    reruns: int,
    cases: tuple[GoldenCase, ...],
    policy: dict[str, object],
    run_reports: list[RunReport],
    provenance: dict[str, object] | None = None,
    repair: dict[str, object] | None = None,
    supplemental_preflight: dict[str, object] | None = None,
) -> dict[str, object]:
    case_index = {case.case_id: case for case in cases}
    supplemental_summary = _summarize_supplemental_across_runs(
        run_reports=run_reports,
        case_index=case_index,
        supplemental_preflight=supplemental_preflight,
    )
    supplemental_runtime = _summarize_supplemental_runtime_health(supplemental_summary)
    gate_report = evaluate_judge_gate(policy, supplemental_summary)
    gate_report = {
        **gate_report,
        "supplemental_runtime": supplemental_runtime,
    }
    if provenance is not None:
        gate_report = {
            **gate_report,
            "provenance": provenance,
        }
    if repair is not None:
        gate_report = {
            **gate_report,
            "repair": repair,
        }
    summary = {
        "schema_version": 1,
        "benchmark_type": benchmark_type,
        "reruns": reruns,
        "case_set": _case_set_summary(cases),
        "deterministic": _summarize_deterministic_runs(run_reports),
        "aggregate": {
            "supplemental": supplemental_summary,
        },
        "supplemental_runtime": supplemental_runtime,
        "gate_report": gate_report,
    }
    if provenance is not None:
        summary["provenance"] = provenance
    if repair is not None:
        summary["repair"] = repair
    if supplemental_preflight is not None:
        summary["supplemental_preflight"] = supplemental_preflight
    _write_json(output_dir / "summary.json", summary)
    _write_json(output_dir / "gate-report.json", gate_report)
    (output_dir / "SUMMARY.md").write_text(
        _render_summary_markdown(summary),
        encoding="utf-8",
    )
    return summary


def _serialize_run_report(report: RunReport) -> dict[str, object]:
    return {
        "total": report.total,
        "passed": report.passed,
        "failed": report.failed,
        "by_split": {name: _serialize_summary_count(item) for name, item in report.by_split.items()},
        "by_dimension": {name: _serialize_summary_count(item) for name, item in report.by_dimension.items()},
        "by_metric": {name: _serialize_summary_count(item) for name, item in report.by_metric.items()},
        "by_supplemental": {
            name: _serialize_dataclass(item)
            for name, item in report.by_supplemental.items()
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
        "supplemental_results": [
            _serialize_dataclass(item)
            for item in result.supplemental_results
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
        _deserialize_supplemental_result(item)
        for item in payload.get("supplemental_results") or ()
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


def _deserialize_evidence_sources(payload: object) -> tuple[EvidenceSource, ...]:
    if not isinstance(payload, list):
        return ()
    return tuple(
        _deserialize_evidence_source(item)
        for item in payload
        if isinstance(item, dict)
    )


def _deserialize_evidence_source(payload: dict[str, object]) -> EvidenceSource:
    structural_path = payload.get("structural_path")
    return EvidenceSource(
        doc_id=str(payload.get("doc_id") or ""),
        revision_track=str(payload.get("revision_track") or "source-faithful"),
        version_id=str(payload.get("version_id") or ""),
        chunk_id=str(payload.get("chunk_id") or ""),
        anchor=dict(payload.get("anchor") or {}),
        acl_level=str(payload.get("acl_level") or "public"),
        canonical_url=str(payload.get("canonical_url") or ""),
        latest_url=str(payload.get("latest_url") or ""),
        source_channel=str(payload.get("source_channel") or "pdf_ocr"),
        collection=str(payload.get("collection") or ""),
        is_current=bool(payload.get("is_current")),
        snippet=str(payload.get("snippet") or ""),
        score=float(payload.get("score") or 0.0),
        source_title=str(payload.get("source_title") or ""),
        structural_path=tuple(str(item) for item in structural_path) if isinstance(structural_path, list) else (),
        content_kind=str(payload.get("content_kind") or ""),
        content_role=str(payload.get("content_role") or ""),
        detail_label=str(payload.get("detail_label") or ""),
        is_answer_bearing=bool(payload.get("is_answer_bearing")),
    )


def _deserialize_optional_bool(value: object) -> bool | None:
    if value is None:
        return None
    return bool(value)


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


def _metric_key_from_payload(payload: dict[str, object]) -> str:
    return f"{payload['adapter_id']}.{payload['metric_name']}"


def _repairable_failure_reasons(payload: dict[str, object]) -> tuple[str, ...]:
    if payload.get("verdict") != "failed" or payload.get("score") is not None:
        return ()
    metadata = dict(payload.get("metadata") or {})
    metadata_reasons = tuple(str(reason) for reason in metadata.get("failure_reasons") or ())
    metadata_disposition = str(metadata.get("failure_disposition") or "")
    if metadata_disposition == "transient_retryable":
        return metadata_reasons
    classification = classify_runtime_failure(
        str(payload.get("rationale") or ""),
        error_type=str(metadata.get("judge_error") or ""),
    )
    if classification.disposition != "transient_retryable":
        return ()
    return classification.reasons


def _group_repair_targets_by_run_case(
    targets: list[dict[str, object]],
) -> dict[int, dict[str, list[dict[str, object]]]]:
    grouped: dict[int, dict[str, list[dict[str, object]]]] = defaultdict(lambda: defaultdict(list))
    for target in targets:
        grouped[int(target["run_number"])][str(target["case_id"])].append(target)
    return grouped


def _select_repair_adapters(
    *,
    supplemental_adapters: tuple[SupplementalAdapter, ...],
    metric_keys: tuple[str, ...],
) -> tuple[SupplementalAdapter, ...]:
    requested_keys = set(metric_keys)
    selected: list[SupplementalAdapter] = []
    covered_keys: set[str] = set()
    for adapter in supplemental_adapters:
        adapter_metric_keys = set(_adapter_metric_keys(adapter))
        if adapter_metric_keys & requested_keys:
            selected.append(adapter)
            covered_keys.update(adapter_metric_keys & requested_keys)
    missing_keys = sorted(requested_keys - covered_keys)
    if missing_keys:
        raise ValueError(f"repair rerun could not resolve adapters for metric keys: {missing_keys}")
    return tuple(selected)


def _adapter_metric_keys(adapter: SupplementalAdapter) -> tuple[str, ...]:
    if hasattr(adapter, "metric_names"):
        metric_names = tuple(str(item) for item in getattr(adapter, "metric_names"))
        return tuple(f"{adapter.adapter_id}.{metric_name}" for metric_name in metric_names)
    metric_name = getattr(adapter, "metric_name", None)
    if isinstance(metric_name, str) and metric_name.strip():
        return (f"{adapter.adapter_id}.{metric_name}",)
    return ()


def _merge_case_result_supplemental_results(
    original: CaseResult,
    replacement_by_metric_key: dict[str, SupplementalResult],
) -> tuple[CaseResult, list[dict[str, object]]]:
    merged: list[SupplementalResult] = []
    replacements: list[dict[str, object]] = []
    seen_metric_keys: set[str] = set()

    for item in original.supplemental_results:
        metric_key = _supplemental_metric_key(item)
        replacement = replacement_by_metric_key.get(metric_key)
        if replacement is None:
            merged.append(item)
            continue
        merged.append(replacement)
        replacements.append(
            {
                "metric_key": metric_key,
                "before": _serialize_dataclass(item),
                "after": _serialize_dataclass(replacement),
            }
        )
        seen_metric_keys.add(metric_key)

    for metric_key, replacement in sorted(replacement_by_metric_key.items()):
        if metric_key in seen_metric_keys:
            continue
        merged.append(replacement)
        replacements.append(
            {
                "metric_key": metric_key,
                "before": None,
                "after": _serialize_dataclass(replacement),
            }
        )

    return replace(original, supplemental_results=tuple(merged)), replacements


def _supplemental_metric_key(item: SupplementalResult) -> str:
    return f"{item.adapter_id}.{item.metric_name}"


def _summarize_deterministic_runs(run_reports: list[RunReport]) -> dict[str, object]:
    run_pass_counts = [report.passed for report in run_reports]
    run_pass_rates = [
        (report.passed / report.total) if report.total else None
        for report in run_reports
    ]
    return {
        "run_count": len(run_reports),
        "run_pass_counts": run_pass_counts,
        "run_failed_counts": [report.failed for report in run_reports],
        "run_pass_rates": run_pass_rates,
        "mean_pass_rate": fmean(item for item in run_pass_rates if item is not None) if run_pass_rates else None,
        "stable_across_runs": len(set(run_pass_counts)) == 1,
    }


def _summarize_supplemental_across_runs(
    *,
    run_reports: list[RunReport],
    case_index: dict[str, GoldenCase],
    supplemental_preflight: dict[str, object] | None = None,
) -> dict[str, dict[str, object]]:
    per_metric_items: dict[str, list[tuple[GoldenCase, SupplementalResult]]] = defaultdict(list)
    per_metric_run_averages: dict[str, list[float]] = defaultdict(list)
    all_metric_keys: set[str] = set()

    for report in run_reports:
        all_metric_keys.update(report.by_supplemental.keys())
        for metric_key, metric_summary in report.by_supplemental.items():
            if metric_summary.average_score is not None:
                per_metric_run_averages[metric_key].append(metric_summary.average_score)
        for result in report.results:
            case = case_index[result.case_id]
            for supplemental in result.supplemental_results:
                metric_key = f"{supplemental.adapter_id}.{supplemental.metric_name}"
                all_metric_keys.add(metric_key)
                per_metric_items[metric_key].append((case, supplemental))

    aggregate: dict[str, dict[str, object]] = {}
    for metric_key in sorted(all_metric_keys):
        items = per_metric_items.get(metric_key, [])
        by_expected_status: dict[str, dict[str, object]] = {}
        for expected_status in sorted({case.expected_status for case, _ in items}):
            bucket = [supplemental for case, supplemental in items if case.expected_status == expected_status]
            by_expected_status[expected_status] = _summarize_supplemental_bucket(bucket)
        run_average_scores = per_metric_run_averages.get(metric_key, [])
        aggregate[metric_key] = {
            "metric_key": metric_key,
            "run_count": len(run_reports),
            "applicable_runs": len(run_average_scores),
            "run_average_scores": run_average_scores,
            "mean_average_score": fmean(run_average_scores) if run_average_scores else None,
            "min_run_average_score": min(run_average_scores) if run_average_scores else None,
            "max_run_average_score": max(run_average_scores) if run_average_scores else None,
            "run_average_drift": (max(run_average_scores) - min(run_average_scores)) if run_average_scores else None,
            "by_expected_status": by_expected_status,
            "overall": _summarize_supplemental_bucket([supplemental for _, supplemental in items]),
        }
    if supplemental_preflight is not None:
        for metric_key, metric_payload in _build_preflight_unavailable_metric_aggregates(
            run_reports=run_reports,
            supplemental_preflight=supplemental_preflight,
        ).items():
            aggregate.setdefault(metric_key, metric_payload)
    return aggregate


def _summarize_supplemental_bucket(items: list[SupplementalResult]) -> dict[str, object]:
    scored_items = [item.score for item in items if item.score is not None]
    runtime_failures = [
        _supplemental_runtime_failure(item)
        for item in items
        if item.verdict == "failed" and item.score is None
    ]
    transient_runtime_failure_count = sum(
        1
        for failure in runtime_failures
        if failure["disposition"] == "transient_retryable"
    )
    hard_unavailable_failure_count = sum(
        1
        for failure in runtime_failures
        if failure["disposition"] == "hard_unavailable"
    )
    non_retryable_runtime_failure_count = sum(
        1
        for failure in runtime_failures
        if failure["disposition"] == "non_retryable_request"
    )
    failure_disposition_counts = Counter(
        failure["disposition"]
        for failure in runtime_failures
        if failure["disposition"]
    )
    verdict_counts = Counter(
        item.verdict
        for item in items
        if item.verdict is not None
    )
    runtime_status = _resolve_supplemental_runtime_status(
        score_count=len(scored_items),
        verdict_counts=verdict_counts,
        transient_runtime_failure_count=transient_runtime_failure_count,
        hard_unavailable_failure_count=hard_unavailable_failure_count,
        non_retryable_runtime_failure_count=non_retryable_runtime_failure_count,
    )
    return {
        "total": len(items),
        "score_count": len(scored_items),
        "average_score": fmean(scored_items) if scored_items else None,
        "verdict_counts": dict(verdict_counts),
        "runtime_status": runtime_status,
        "transient_runtime_failure_count": transient_runtime_failure_count,
        "hard_unavailable_failure_count": hard_unavailable_failure_count,
        "non_retryable_runtime_failure_count": non_retryable_runtime_failure_count,
        "failure_disposition_counts": dict(failure_disposition_counts),
        "preflight_failure_count": 0,
        "preflight_failure_reasons": [],
        "skip_reason": "",
        "runtime_failure_reasons": sorted(
            {
                reason
                for failure in runtime_failures
                for reason in failure["reasons"]
            }
        ),
    }


def _supplemental_runtime_failure(item: SupplementalResult) -> dict[str, object]:
    if item.verdict != "failed" or item.score is not None:
        return {"reasons": (), "disposition": None}
    metadata = dict(item.metadata or {})
    metadata_reasons = tuple(str(reason) for reason in metadata.get("failure_reasons") or ())
    metadata_disposition = metadata.get("failure_disposition")
    if metadata_reasons or metadata_disposition:
        return {
            "reasons": metadata_reasons,
            "disposition": str(metadata_disposition) if metadata_disposition is not None else None,
        }
    classification = classify_runtime_failure(
        item.rationale,
        error_type=str(metadata.get("judge_error") or ""),
    )
    return {
        "reasons": classification.reasons,
        "disposition": classification.disposition,
    }


def _resolve_supplemental_runtime_status(
    *,
    score_count: int,
    verdict_counts: Counter[str],
    transient_runtime_failure_count: int,
    hard_unavailable_failure_count: int,
    non_retryable_runtime_failure_count: int,
) -> str:
    if score_count > 0:
        return "available"
    failed_count = int(verdict_counts.get("failed", 0))
    if failed_count == 0:
        return "not_applicable_only"
    runtime_unavailable_failure_count = transient_runtime_failure_count + hard_unavailable_failure_count
    if runtime_unavailable_failure_count == failed_count and non_retryable_runtime_failure_count == 0:
        return "unavailable"
    return "degraded"


def _summarize_supplemental_runtime_health(
    aggregate: dict[str, dict[str, object]],
) -> dict[str, object]:
    status_to_metric_keys: dict[str, list[str]] = defaultdict(list)
    for metric_key, metric_summary in aggregate.items():
        overall = dict(metric_summary.get("overall") or {})
        status = str(overall.get("runtime_status") or "unknown")
        status_to_metric_keys[status].append(metric_key)
    return {
        "status_counts": {
            status: len(metric_keys)
            for status, metric_keys in sorted(status_to_metric_keys.items())
        },
        "metric_keys_by_status": {
            status: sorted(metric_keys)
            for status, metric_keys in sorted(status_to_metric_keys.items())
        },
    }


def _render_summary_markdown(summary: dict[str, object]) -> str:
    deterministic = summary["deterministic"]
    gate_report = summary["gate_report"]
    lines = [
        "# Student Handbook Formal Benchmark",
        "",
        f"- benchmark_type: `{summary['benchmark_type']}`",
        f"- reruns: `{summary['reruns']}`",
        f"- total_cases: `{summary['case_set']['total_cases']}`",
        f"- gate verdict: `{gate_report['overall_verdict']}`",
    ]
    provenance = summary.get("provenance")
    if isinstance(provenance, dict):
        lines.append(f"- provenance.mode: `{provenance.get('mode')}`")
        lines.append(f"- provenance.repair_of: `{provenance.get('repair_of')}`")
    repair = summary.get("repair")
    if isinstance(repair, dict):
        lines.append(f"- repair.selected_target_count: `{repair.get('selected_target_count')}`")
        lines.append(f"- repair.applied_target_count: `{repair.get('applied_target_count')}`")
    supplemental_preflight = summary.get("supplemental_preflight")
    if isinstance(supplemental_preflight, dict):
        lines.append(
            f"- supplemental_preflight.status_counts: `{supplemental_preflight.get('summary', {}).get('status_counts')}`"
        )
    supplemental_runtime = summary.get("supplemental_runtime")
    if isinstance(supplemental_runtime, dict):
        lines.append(
            f"- supplemental_runtime.status_counts: `{supplemental_runtime.get('status_counts')}`"
        )
    lines.extend(
        (
            "",
            "## Deterministic Stability",
            "",
            f"- run_pass_counts: `{deterministic['run_pass_counts']}`",
            f"- run_pass_rates: `{deterministic['run_pass_rates']}`",
            f"- stable_across_runs: `{deterministic['stable_across_runs']}`",
            "",
            "## Supplemental Metrics",
            "",
        )
    )
    supplemental = summary["aggregate"]["supplemental"]
    if not supplemental:
        lines.append("- none")
    else:
        for metric_key, metric_summary in supplemental.items():
            lines.append(
                f"- `{metric_key}`: mean={metric_summary['mean_average_score']}, min_run={metric_summary['min_run_average_score']}, drift={metric_summary['run_average_drift']}, applicable_runs={metric_summary['applicable_runs']}, runtime={metric_summary['overall']['runtime_status']}"
            )
    lines.extend(
        (
            "",
            "## Gate",
            "",
        )
    )
    for metric_report in gate_report["metrics"]:
        lines.append(
            f"- `{metric_report['metric_key']}`: verdict={metric_report['verdict']}, reasons={metric_report['reasons']}"
        )
    return "\n".join(lines) + "\n"


def _write_json(path: Path, payload: dict[str, object]) -> None:
    path.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _run_supplemental_preflight(
    supplemental_adapters: tuple[SupplementalAdapter, ...],
) -> dict[str, object]:
    entries: list[dict[str, object]] = []
    for adapter in supplemental_adapters:
        preflight_fn = getattr(adapter, "preflight", None)
        metric_keys = list(_adapter_metric_keys(adapter))
        entry = {
            "adapter_id": adapter.adapter_id,
            "metric_keys": metric_keys,
        }
        if not callable(preflight_fn):
            entries.append(
                {
                    **entry,
                    "status": "not_supported",
                }
            )
            continue
        try:
            result = preflight_fn()
        except Exception as exc:
            classification = _classify_preflight_failure(exc)
            failure_reasons = list(
                getattr(exc, "reasons", ())
                or classification.reasons
            )
            failure_disposition = getattr(exc, "disposition", None) or classification.disposition
            entries.append(
                {
                    **entry,
                    "status": "failed",
                    "error_type": type(exc).__name__,
                    "error": str(exc),
                    "failure_reasons": failure_reasons,
                    "failure_disposition": failure_disposition,
                    "run_action": _run_action_for_preflight_failure(failure_disposition),
                }
            )
            continue
        entries.append(
            {
                **entry,
                "status": "passed",
                "result": _serialize_preflight_result(result),
                "run_action": "use_adapter",
            }
        )
    return {
        "schema_version": 1,
        "adapter_count": len(supplemental_adapters),
        "summary": _summarize_preflight_entries(entries),
        "adapters": entries,
    }


def _summarize_preflight_entries(entries: list[dict[str, object]]) -> dict[str, object]:
    status_counts = Counter(str(entry.get("status") or "unknown") for entry in entries)
    run_action_counts = Counter(str(entry.get("run_action") or "unknown") for entry in entries)
    failure_disposition_counts = Counter(
        str(entry.get("failure_disposition") or "unknown")
        for entry in entries
        if entry.get("status") == "failed"
    )
    return {
        "total": len(entries),
        "status_counts": dict(status_counts),
        "run_action_counts": dict(run_action_counts),
        "failure_disposition_counts": dict(failure_disposition_counts),
    }


def _serialize_preflight_result(result: object) -> object:
    if result is None:
        return None
    if is_dataclass(result):
        return asdict(result)
    if isinstance(result, dict):
        return {str(key): _serialize_preflight_result(value) for key, value in result.items()}
    if isinstance(result, (list, tuple)):
        return [_serialize_preflight_result(item) for item in result]
    if isinstance(result, (str, int, float, bool)):
        return result
    return str(result)


def _classify_preflight_failure(exc: Exception) -> object:
    return classify_runtime_failure(
        str(exc),
        error_type=type(exc).__name__,
    )


def _run_action_for_preflight_failure(failure_disposition: str | None) -> str:
    if failure_disposition in {"transient_retryable", "hard_unavailable"}:
        return "skip_adapter"
    return "abort_benchmark"


def _raise_for_blocking_preflight_entries(supplemental_preflight: dict[str, object]) -> None:
    blocking_entries = [
        entry
        for entry in supplemental_preflight.get("adapters", [])
        if entry.get("run_action") == "abort_benchmark"
    ]
    if not blocking_entries:
        return
    formatted_entries = ", ".join(
        f"{entry.get('adapter_id')}[{','.join(entry.get('metric_keys') or ())}]={entry.get('error')}"
        for entry in blocking_entries
    )
    raise RuntimeError(f"non-retryable supplemental preflight failure: {formatted_entries}")


def _select_runnable_supplemental_adapters(
    *,
    supplemental_adapters: tuple[SupplementalAdapter, ...],
    supplemental_preflight: dict[str, object],
) -> tuple[SupplementalAdapter, ...]:
    entries = tuple(supplemental_preflight.get("adapters") or ())
    runnable: list[SupplementalAdapter] = []
    for adapter, entry in zip(supplemental_adapters, entries, strict=True):
        if str(entry.get("run_action") or "use_adapter") == "use_adapter":
            runnable.append(adapter)
    return tuple(runnable)


def _skipped_supplemental_metric_details(
    supplemental_preflight: dict[str, object],
) -> dict[str, dict[str, object]]:
    skipped: dict[str, dict[str, object]] = {}
    for entry in supplemental_preflight.get("adapters", []):
        if entry.get("run_action") != "skip_adapter":
            continue
        for metric_key in entry.get("metric_keys", []):
            skipped[str(metric_key)] = {
                "adapter_id": entry.get("adapter_id"),
                "metric_key": metric_key,
                "failure_reasons": list(entry.get("failure_reasons") or []),
                "failure_disposition": entry.get("failure_disposition"),
            }
    return skipped


def _build_preflight_unavailable_metric_aggregates(
    *,
    run_reports: list[RunReport],
    supplemental_preflight: dict[str, object],
) -> dict[str, dict[str, object]]:
    skipped_metrics = _skipped_supplemental_metric_details(supplemental_preflight)
    aggregates: dict[str, dict[str, object]] = {}
    for metric_key, details in skipped_metrics.items():
        failure_disposition = str(details.get("failure_disposition") or "unknown")
        failure_reasons = list(details.get("failure_reasons") or [])
        failure_disposition_counts = {failure_disposition: 1} if failure_disposition else {}
        aggregates[metric_key] = {
            "metric_key": metric_key,
            "run_count": len(run_reports),
            "applicable_runs": 0,
            "run_average_scores": [],
            "mean_average_score": None,
            "min_run_average_score": None,
            "max_run_average_score": None,
            "run_average_drift": None,
            "by_expected_status": {},
            "overall": {
                "total": 0,
                "score_count": 0,
                "average_score": None,
                "verdict_counts": {},
                "runtime_status": "unavailable",
                "transient_runtime_failure_count": 1 if failure_disposition == "transient_retryable" else 0,
                "hard_unavailable_failure_count": 1 if failure_disposition == "hard_unavailable" else 0,
                "non_retryable_runtime_failure_count": 0,
                "failure_disposition_counts": failure_disposition_counts,
                "preflight_failure_count": 1,
                "preflight_failure_reasons": failure_reasons,
                "skip_reason": "preflight_unavailable",
                "runtime_failure_reasons": failure_reasons,
            },
        }
    return aggregates
