from __future__ import annotations

from pathlib import Path

from .workstream_runtime_shared import (
    _append_jsonl,
    _load_json,
    _write_json_atomic,
    ensure_runtime_layout,
    isoformat_utc,
    resolve_repo_root,
    utc_now,
    validate_operator_id,
    validate_workstream_name,
)

RUN_SCHEMA_VERSION = 1


def harness_root(repo_root: Path | str) -> Path:
    repo = resolve_repo_root(repo_root)
    return repo / ".planning" / "runtime" / "harness"


def harness_runs_root(repo_root: Path | str) -> Path:
    return harness_root(repo_root) / "runs"


def harness_events_root(repo_root: Path | str) -> Path:
    return harness_root(repo_root) / "events"


def harness_latest_root(repo_root: Path | str) -> Path:
    return harness_root(repo_root) / "latest"


def harness_outputs_root(repo_root: Path | str) -> Path:
    return harness_root(repo_root) / "outputs"


def ensure_harness_layout(repo_root: Path | str) -> None:
    ensure_runtime_layout(repo_root)
    harness_runs_root(repo_root).mkdir(parents=True, exist_ok=True)
    harness_events_root(repo_root).mkdir(parents=True, exist_ok=True)
    harness_latest_root(repo_root).mkdir(parents=True, exist_ok=True)
    harness_outputs_root(repo_root).mkdir(parents=True, exist_ok=True)


def run_file_path(repo_root: Path | str, run_id: str) -> Path:
    return harness_runs_root(repo_root) / f"{run_id}.json"


def event_file_path(repo_root: Path | str, run_id: str) -> Path:
    return harness_events_root(repo_root) / f"{run_id}.jsonl"


def latest_file_path(repo_root: Path | str, workstream: str) -> Path:
    return harness_latest_root(repo_root) / f"{validate_workstream_name(workstream)}.json"


def output_file_path(repo_root: Path | str, run_id: str) -> Path:
    return harness_outputs_root(repo_root) / f"{run_id}.json"


def create_run_record(
    repo_root: Path | str,
    *,
    run_id: str,
    workstream: str,
    operator_id: str,
    session_key: str,
    mode: str,
    command: list[str],
    claim_id: str | None,
    state: str = "running",
    verification: dict[str, object] | None = None,
    blocker: dict[str, object] | None = None,
    summary: str | None = None,
    result: str | None = None,
    exit_code: int | None = None,
    artifacts: dict[str, object] | None = None,
    result_payload: dict[str, object] | None = None,
) -> dict[str, object]:
    ensure_harness_layout(repo_root)
    now = utc_now()
    payload: dict[str, object] = {
        "schema_version": RUN_SCHEMA_VERSION,
        "run_id": run_id,
        "workstream": validate_workstream_name(workstream),
        "operator_id": validate_operator_id(operator_id),
        "session_key": session_key,
        "mode": mode,
        "command": list(command),
        "claim_id": claim_id,
        "state": state,
        "started_at": isoformat_utc(now),
        "updated_at": isoformat_utc(now),
        "verification": dict(
            verification or {"status": "not_applicable", "commands": [], "notes": ""}
        ),
        "blocker": blocker,
        "summary": summary,
        "result": result,
        "exit_code": exit_code,
        "artifacts": dict(artifacts or {}),
        "result_payload": result_payload,
    }
    _write_json_atomic(run_file_path(repo_root, run_id), payload)
    _write_json_atomic(latest_file_path(repo_root, workstream), payload)
    return payload


def load_run_record(repo_root: Path | str, run_id: str) -> dict[str, object] | None:
    return _load_json(run_file_path(repo_root, run_id))


def update_run_record(
    repo_root: Path | str,
    *,
    run_id: str,
    updates: dict[str, object],
) -> dict[str, object]:
    existing = load_run_record(repo_root, run_id)
    if existing is None:
        raise FileNotFoundError(f"Harness run {run_id} does not exist")
    payload = dict(existing)
    payload.update(updates)
    payload["updated_at"] = isoformat_utc(utc_now())
    _write_json_atomic(run_file_path(repo_root, run_id), payload)
    _write_json_atomic(latest_file_path(repo_root, str(payload["workstream"])), payload)
    return payload


def append_run_event(
    repo_root: Path | str,
    *,
    run_id: str,
    event_type: str,
    details: dict[str, object] | None = None,
) -> None:
    ensure_harness_layout(repo_root)
    row: dict[str, object] = {
        "timestamp": isoformat_utc(utc_now()),
        "run_id": run_id,
        "event_type": event_type,
    }
    if details:
        row["details"] = details
    _append_jsonl(event_file_path(repo_root, run_id), row)


def latest_run_for_workstream(
    repo_root: Path | str,
    workstream: str,
) -> dict[str, object] | None:
    return _load_json(latest_file_path(repo_root, workstream))
