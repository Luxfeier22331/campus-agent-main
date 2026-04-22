from __future__ import annotations

from collections import Counter
from dataclasses import asdict, is_dataclass

from campus_evals.runner import SupplementalAdapter
from campus_evals.runtime_observability import (
    bind_runtime_event_context,
    emit_runtime_event,
)
from campus_evals.supplemental_http import classify_runtime_failure


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
            emit_runtime_event(
                "supplemental_preflight_result",
                adapter_id=adapter.adapter_id,
                metric_keys=metric_keys,
                status="not_supported",
                run_action="not_supported",
            )
            continue
        with bind_runtime_event_context(
            adapter_id=adapter.adapter_id, preflight_metric_keys=tuple(metric_keys)
        ):
            try:
                result = preflight_fn()
            except Exception as exc:
                classification = _classify_preflight_failure(exc)
                failure_reasons = list(getattr(exc, "reasons", ()) or classification.reasons)
                failure_disposition = (
                    getattr(exc, "disposition", None) or classification.disposition
                )
                run_action = _run_action_for_preflight_failure(failure_disposition)
                entries.append(
                    {
                        **entry,
                        "status": "failed",
                        "error_type": type(exc).__name__,
                        "error": str(exc),
                        "failure_reasons": failure_reasons,
                        "failure_disposition": failure_disposition,
                        "run_action": run_action,
                    }
                )
                emit_runtime_event(
                    "supplemental_preflight_result",
                    adapter_id=adapter.adapter_id,
                    metric_keys=metric_keys,
                    status="failed",
                    failure_reasons=failure_reasons,
                    failure_disposition=failure_disposition,
                    run_action=run_action,
                    error_type=type(exc).__name__,
                    error=str(exc),
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
            emit_runtime_event(
                "supplemental_preflight_result",
                adapter_id=adapter.adapter_id,
                metric_keys=metric_keys,
                status="passed",
                run_action="use_adapter",
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
