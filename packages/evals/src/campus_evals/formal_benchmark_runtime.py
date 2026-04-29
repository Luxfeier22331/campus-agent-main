from __future__ import annotations

from collections import defaultdict
from collections.abc import Callable
from dataclasses import replace
from pathlib import Path

from campus_evals.faithfulness_runtime import bind_faithfulness_artifact_context
from campus_evals.formal_benchmark_artifacts import (
    _case_set_summary,
    _deserialize_case_result,
    _load_json,
    _load_optional_json,
    _load_run_case_result_payloads,
    _metric_key_from_payload,
    _serialize_dataclass,
    _write_json,
    _write_repair_summary,
    _write_run_artifacts,
)
from campus_evals.formal_benchmark_preflight import (
    _raise_for_blocking_preflight_entries,
    _run_supplemental_preflight,
    _select_repair_adapters,
    _select_runnable_supplemental_adapters,
    _skipped_supplemental_metric_details,
)
from campus_evals.formal_benchmark_summary import _write_benchmark_summary
from campus_evals.judge_gate import load_judge_gate_policy
from campus_evals.models import (
    CaseResult,
    ExecutionResult,
    GoldenCase,
    RunReport,
    SupplementalResult,
)
from campus_evals.runner import SupplementalAdapter, run_cases, summarize_case_results
from campus_evals.runtime_observability import (
    RuntimeEventWriter,
    bind_runtime_event_context,
    bind_runtime_event_sink,
    summarize_provider_events,
)
from campus_evals.supplemental_http import classify_runtime_failure

Executor = Callable[[GoldenCase], ExecutionResult]


def run_formal_benchmark(
    *,
    cases: tuple[GoldenCase, ...],
    executor: Executor,
    supplemental_adapters: tuple[SupplementalAdapter, ...],
    output_dir: str | Path,
    reruns: int,
    case_workers: int = 1,
    policy_path: str | Path | None = None,
    benchmark_type: str = "formal_benchmark",
    verbose: bool = False,
    runtime_events_path: str | Path | None = None,
) -> dict[str, object]:
    if reruns <= 0:
        raise ValueError("reruns must be greater than zero")
    if case_workers <= 0:
        raise ValueError("case_workers must be greater than zero")
    resolved_output_dir = Path(output_dir)
    resolved_output_dir.mkdir(parents=True, exist_ok=True)
    resolved_runtime_events_path = (
        Path(runtime_events_path)
        if runtime_events_path is not None
        else resolved_output_dir / "supplemental-runtime-events.jsonl"
    )
    event_writer = RuntimeEventWriter(path=resolved_runtime_events_path, verbose=verbose)
    with (
        bind_runtime_event_sink(event_writer),
        bind_runtime_event_context(
            benchmark_type=benchmark_type,
            benchmark_session_id=event_writer.session_id,
            benchmark_mode="run",
        ),
    ):
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
                "case_workers": case_workers,
                "policy_path": policy.get("path"),
                "supplemental_adapters": [adapter.adapter_id for adapter in supplemental_adapters],
                "supplemental_preflight_path": str(supplemental_preflight_path),
                "supplemental_preflight": supplemental_preflight["summary"],
                "runtime_events_path": str(resolved_runtime_events_path),
                "case_set": _case_set_summary(cases),
            },
        )

        run_reports: list[RunReport] = []
        for run_number in range(1, reruns + 1):
            with bind_faithfulness_artifact_context(
                output_dir=resolved_output_dir,
                run_number=run_number,
                benchmark_mode="run",
            ):
                report = run_cases(
                    cases,
                    executor=executor,
                    supplemental_adapters=runnable_supplemental_adapters,
                    run_number=run_number,
                    benchmark_mode="run",
                    case_workers=case_workers,
                )
            run_reports.append(report)
            _write_run_artifacts(
                output_dir=resolved_output_dir,
                benchmark_type=benchmark_type,
                run_number=run_number,
                report=report,
            )

    provider_summary = summarize_provider_events(
        resolved_runtime_events_path,
        session_id=event_writer.session_id,
    )
    _write_json(resolved_output_dir / "supplemental-provider-summary.json", provider_summary)
    return _write_benchmark_summary(
        output_dir=resolved_output_dir,
        benchmark_type=benchmark_type,
        reruns=reruns,
        cases=cases,
        policy=policy,
        run_reports=run_reports,
        supplemental_preflight=supplemental_preflight,
        provider_summary=provider_summary,
        runtime_events_path=resolved_runtime_events_path,
        runtime_event_session_id=event_writer.session_id,
    )


def collect_repairable_benchmark_targets(
    benchmark_dir: str | Path,
) -> list[dict[str, object]]:
    grouped: dict[tuple[int, str, str], dict[str, object]] = {}
    run_payloads = _load_run_case_result_payloads(benchmark_dir)
    for run_payload in run_payloads:
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
                    target = _build_repair_target(
                        run_number=run_number,
                        case_id=case_id,
                        adapter_id=adapter_id,
                        target_source="supplemental_failure",
                    )
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
    _collect_preflight_unavailable_backfill_targets(
        benchmark_dir=benchmark_dir,
        run_payloads=run_payloads,
        grouped=grouped,
    )
    resolved: list[dict[str, object]] = []
    for target in sorted(
        grouped.values(), key=lambda item: (item["run_number"], item["case_id"], item["adapter_id"])
    ):
        resolved.append(
            {
                **target,
                "metric_keys": sorted(set(target["metric_keys"])),
                "failure_reasons": list(dict.fromkeys(target["failure_reasons"])),
            }
        )
    return resolved


def repair_formal_benchmark(
    *,
    cases: tuple[GoldenCase, ...],
    executor: Executor,
    supplemental_adapters: tuple[SupplementalAdapter, ...],
    benchmark_dir: str | Path,
    output_dir: str | Path,
    case_workers: int = 1,
    policy_path: str | Path | None = None,
    benchmark_type: str = "formal_benchmark_repair",
    verbose: bool = False,
    runtime_events_path: str | Path | None = None,
) -> dict[str, object]:
    if case_workers <= 0:
        raise ValueError("case_workers must be greater than zero")
    resolved_benchmark_dir = Path(benchmark_dir)
    resolved_output_dir = Path(output_dir)
    resolved_output_dir.mkdir(parents=True, exist_ok=True)
    resolved_runtime_events_path = (
        Path(runtime_events_path)
        if runtime_events_path is not None
        else resolved_output_dir / "supplemental-runtime-events.jsonl"
    )
    event_writer = RuntimeEventWriter(path=resolved_runtime_events_path, verbose=verbose)
    with (
        bind_runtime_event_sink(event_writer),
        bind_runtime_event_context(
            benchmark_type=benchmark_type,
            benchmark_session_id=event_writer.session_id,
            benchmark_mode="repair",
        ),
    ):
        original_config = _load_json(resolved_benchmark_dir / "benchmark-config.json")
        policy = load_judge_gate_policy(policy_path or original_config.get("policy_path"))
        targets = collect_repairable_benchmark_targets(resolved_benchmark_dir)
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
                "case_workers": case_workers,
                "policy_path": policy.get("path"),
                "supplemental_adapters": [adapter.adapter_id for adapter in supplemental_adapters],
                "supplemental_preflight_path": str(supplemental_preflight_path),
                "supplemental_preflight": supplemental_preflight["summary"],
                "runtime_events_path": str(resolved_runtime_events_path),
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
        all_repair_entries: list[dict[str, object]] = []
        for run_payload in original_run_payloads:
            run_number = int(run_payload["run_number"])
            original_results = tuple(
                _deserialize_case_result(item) for item in run_payload["results"]
            )
            results_by_case_id = {result.case_id: result for result in original_results}
            repair_entries: list[dict[str, object]] = []

            for case_id, case_targets in grouped_targets.get(run_number, {}).items():
                case = case_index.get(case_id)
                if case is None:
                    raise ValueError(f"repair target references unknown case_id: {case_id}")
                targeted_metric_keys = sorted(
                    {metric_key for target in case_targets for metric_key in target["metric_keys"]}
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
                with bind_faithfulness_artifact_context(
                    output_dir=resolved_output_dir,
                    run_number=run_number,
                    benchmark_mode="repair",
                    source_output_dir=resolved_benchmark_dir,
                ):
                    rerun_report = run_cases(
                        (case,),
                        executor=executor,
                        supplemental_adapters=selected_adapters,
                        run_number=run_number,
                        benchmark_mode="repair",
                        case_workers=case_workers,
                    )
                rerun_case_result = rerun_report.results[0]
                replacement_by_metric_key = {
                    _supplemental_metric_key(item): item
                    for item in rerun_case_result.supplemental_results
                    if _supplemental_metric_key(item) in runnable_metric_keys
                }
                missing_metric_keys = sorted(
                    set(runnable_metric_keys) - set(replacement_by_metric_key)
                )
                if missing_metric_keys:
                    raise ValueError(
                        f"repair rerun did not return supplemental results for metric keys: {missing_metric_keys}"
                    )

                original_case_result = results_by_case_id[case_id]
                repaired_case_result, replacements = _merge_case_result_supplemental_results(
                    original_case_result,
                    replacement_by_metric_key,
                )
                repair_status, recovered_metric_keys, remaining_metric_keys = (
                    _classify_repair_replacements(
                        replacement_by_metric_key,
                        metric_keys=tuple(runnable_metric_keys),
                    )
                )
                results_by_case_id[case_id] = repaired_case_result
                repair_entries.append(
                    {
                        "case_id": case_id,
                        "targets": case_targets,
                        "replacements": replacements,
                        "status": repair_status,
                        "recovered_metric_keys": recovered_metric_keys,
                        "remaining_metric_keys": remaining_metric_keys,
                    }
                )
                applied_target_count += len(case_targets)

            repaired_results = tuple(
                results_by_case_id[result.case_id] for result in original_results
            )
            repaired_report = summarize_case_results(cases, repaired_results)
            repaired_run_reports.append(repaired_report)
            all_repair_entries.extend(repair_entries)
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

    provider_summary = summarize_provider_events(
        resolved_runtime_events_path,
        session_id=event_writer.session_id,
    )
    _write_json(resolved_output_dir / "supplemental-provider-summary.json", provider_summary)
    repaired_summary = _write_benchmark_summary(
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
        provider_summary=provider_summary,
        runtime_events_path=resolved_runtime_events_path,
        runtime_event_session_id=event_writer.session_id,
    )
    _write_repair_summary(
        output_dir=resolved_output_dir,
        benchmark_dir=resolved_benchmark_dir,
        targets=targets,
        repair_entries=all_repair_entries,
        applied_target_count=applied_target_count,
    )
    return repaired_summary


def _build_repair_target(
    *,
    run_number: int,
    case_id: str,
    adapter_id: str,
    target_source: str,
) -> dict[str, object]:
    return {
        "run_number": run_number,
        "case_id": case_id,
        "adapter_id": adapter_id,
        "target_source": target_source,
        "metric_keys": [],
        "failure_reasons": [],
        "supplemental_failures": [],
        "preflight_failures": [],
    }


def _collect_preflight_unavailable_backfill_targets(
    *,
    benchmark_dir: str | Path,
    run_payloads: list[dict[str, object]],
    grouped: dict[tuple[int, str, str], dict[str, object]],
) -> None:
    supplemental_preflight = _load_optional_json(
        Path(benchmark_dir) / "supplemental-preflight.json"
    )
    if supplemental_preflight is None:
        return
    skipped_entries = [
        entry
        for entry in supplemental_preflight.get("adapters", [])
        if entry.get("run_action") == "skip_adapter"
        and str(entry.get("failure_disposition") or "")
        in {"transient_retryable", "hard_unavailable"}
    ]
    if not skipped_entries:
        return

    for run_payload in run_payloads:
        run_number = int(run_payload["run_number"])
        for result_payload in run_payload["results"]:
            case_id = str(result_payload["case_id"])
            existing_metric_keys = {
                _metric_key_from_payload(dict(item))
                for item in result_payload.get("supplemental_results") or ()
            }
            for entry in skipped_entries:
                adapter_id = str(entry.get("adapter_id") or "")
                metric_keys = sorted(
                    metric_key
                    for metric_key in {
                        str(metric_key)
                        for metric_key in entry.get("metric_keys", [])
                        if str(metric_key)
                    }
                    if metric_key not in existing_metric_keys
                )
                if not metric_keys:
                    continue
                group_key = (run_number, case_id, adapter_id)
                target = grouped.get(group_key)
                if target is None:
                    target = _build_repair_target(
                        run_number=run_number,
                        case_id=case_id,
                        adapter_id=adapter_id,
                        target_source="preflight_unavailable_backfill",
                    )
                    grouped[group_key] = target
                target["metric_keys"].extend(metric_keys)
                target["failure_reasons"].extend(
                    str(reason) for reason in entry.get("failure_reasons") or ()
                )
                target["preflight_failures"].append(
                    {
                        "adapter_id": adapter_id,
                        "metric_keys": metric_keys,
                        "failure_reasons": list(entry.get("failure_reasons") or []),
                        "failure_disposition": entry.get("failure_disposition"),
                        "error_type": entry.get("error_type"),
                        "error": entry.get("error"),
                    }
                )


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


def _classify_repair_replacements(
    replacement_by_metric_key: dict[str, SupplementalResult],
    *,
    metric_keys: tuple[str, ...],
) -> tuple[str, list[str], list[str]]:
    recovered_metric_keys: list[str] = []
    remaining_metric_keys: list[str] = []

    for metric_key in metric_keys:
        replacement = replacement_by_metric_key[metric_key]
        if _supplemental_result_remains_unresolved(replacement):
            remaining_metric_keys.append(metric_key)
            continue
        recovered_metric_keys.append(metric_key)

    if not remaining_metric_keys:
        status = "repaired"
    elif not recovered_metric_keys:
        status = "rerun_failed"
    else:
        status = "partially_repaired"
    return status, recovered_metric_keys, remaining_metric_keys


def _supplemental_result_remains_unresolved(item: SupplementalResult) -> bool:
    return item.verdict == "failed" and item.score is None


def _supplemental_metric_key(item: SupplementalResult) -> str:
    return f"{item.adapter_id}.{item.metric_name}"
