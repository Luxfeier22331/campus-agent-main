from __future__ import annotations

import argparse
import json
import os
import signal
import socket
import subprocess
import time
import urllib.error
import urllib.request
from collections.abc import Sequence
from dataclasses import asdict, dataclass
from datetime import UTC, datetime, timedelta
from pathlib import Path

from scripts.execution_control_process_smoke_http import wait_for_status

SMOKE_SCHEMA_VERSION = "service_guide_selected_write_runtime_smoke.v1"
DEFAULT_REPORT_NAME = "service-guide-selected-write-runtime-smoke.json"


@dataclass(frozen=True, slots=True)
class ProcessCommandSpec:
    label: str
    command: tuple[str, ...]
    cwd: Path
    env: dict[str, str]
    log_path: Path


@dataclass(frozen=True, slots=True)
class CurrentServiceGuideProjectionSummary:
    release_id: str
    service_guide_records: int
    conflict_records: int
    manual_review_sources: int


@dataclass(frozen=True, slots=True)
class ServiceGuideRuntimeProbe:
    probe_id: str
    payload: dict[str, object]
    expected_status: int = 200
    expected_outcome: str = "resolved_current"
    expected_fail_close_reason: str = ""
    expected_field_status: dict[str, str] | None = None
    expected_body_tokens: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class ServiceGuideSelectedWriteRuntimeSmokePlan:
    repo_root: Path
    output_dir: Path
    api_base_url: str
    structured_query_secret: str
    database_url: str
    probes: tuple[ServiceGuideRuntimeProbe, ...]
    processes: tuple[ProcessCommandSpec, ...]


def build_service_guide_selected_write_runtime_smoke_plan(
    *,
    repo_root: Path,
    output_dir: Path,
    database_url: str | None = None,
    structured_query_secret: str | None = None,
    trusted_time_rfc3339: str | None = None,
    api_host: str = "127.0.0.1",
    api_port: int = 0,
) -> ServiceGuideSelectedWriteRuntimeSmokePlan:
    resolved_database_url = _required_text(
        database_url
        or os.getenv("CAMPUS_SHARED_POSTGRES_URL")
        or _root_env_value(repo_root, "CAMPUS_SHARED_POSTGRES_URL"),
        "database_url",
    )
    resolved_secret = _required_text(
        structured_query_secret
        or os.getenv("EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET")
        or _root_env_value(repo_root, "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET")
        or "query-secret",
        "structured_query_secret",
    )
    resolved_api_port = api_port if api_port > 0 else _available_tcp_port(api_host)
    api_base_url = f"http://{api_host}:{resolved_api_port}"
    process = ProcessCommandSpec(
        label="execution-control",
        command=("go", "run", "./cmd/execution-control"),
        cwd=repo_root / "apps" / "execution-control",
        env={
            "API_AUTH_MODE": "trusted-worker",
            "API_WORKER_SHARED_SECRET": os.getenv(
                "API_WORKER_SHARED_SECRET",
                "service-guide-runtime-smoke-worker-secret",
            ),
            "CAMPUS_AGENT_HTTP_HOST": api_host,
            "CAMPUS_AGENT_HTTP_PORT": str(resolved_api_port),
            "CAMPUS_SHARED_POSTGRES_URL": resolved_database_url,
            "PROMPT_RUNTIME_API_KEY": os.getenv(
                "PROMPT_RUNTIME_API_KEY",
                "service-guide-runtime-smoke-prompt-key",
            ),
            "PROMPT_RUNTIME_MODEL": os.getenv("PROMPT_RUNTIME_MODEL", "gpt-5.5"),
            "PROMPT_RUNTIME_PROVIDER": os.getenv("PROMPT_RUNTIME_PROVIDER", "mock-runtime"),
            "PROMPT_STRICT_STRUCTURED_OUTPUTS": os.getenv(
                "PROMPT_STRICT_STRUCTURED_OUTPUTS",
                "true",
            ),
            "EXECUTION_CONTROL_EXECUTION_AUDIT_ENABLED": "false",
            "EXECUTION_CONTROL_OTEL_ENABLED": "false",
            "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET": resolved_secret,
            "EXECUTION_CONTROL_STRUCTURED_QUERY_TIMEOUT_MS": os.getenv(
                "EXECUTION_CONTROL_STRUCTURED_QUERY_TIMEOUT_MS",
                "2000",
            ),
            "EXECUTION_CONTROL_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339": _required_text(
                trusted_time_rfc3339 or _resolve_trusted_time_rfc3339(repo_root=repo_root),
                "trusted_time_rfc3339",
            ),
        },
        log_path=output_dir / "execution-control.log",
    )
    return ServiceGuideSelectedWriteRuntimeSmokePlan(
        repo_root=repo_root,
        output_dir=output_dir,
        api_base_url=api_base_url,
        structured_query_secret=resolved_secret,
        database_url=resolved_database_url,
        probes=_default_service_guide_runtime_probes(),
        processes=(process,),
    )


def run_service_guide_selected_write_runtime_smoke(
    plan: ServiceGuideSelectedWriteRuntimeSmokePlan,
    *,
    timeout_seconds: float = 20.0,
    startup_timeout_seconds: float = 90.0,
) -> dict[str, object]:
    plan.output_dir.mkdir(parents=True, exist_ok=True)
    started: list[subprocess.Popen[bytes]] = []
    log_files = []
    process_logs: dict[str, str] = {}
    projection: CurrentServiceGuideProjectionSummary | None = None
    try:
        projection = load_current_service_guide_projection_summary(plan.database_url)
        for process_spec in plan.processes:
            process_spec.log_path.parent.mkdir(parents=True, exist_ok=True)
            log_file = process_spec.log_path.open("ab")
            log_files.append(log_file)
            process_logs[process_spec.label] = str(process_spec.log_path)
            started.append(
                subprocess.Popen(
                    process_spec.command,
                    cwd=process_spec.cwd,
                    env={**os.environ, **process_spec.env},
                    stdout=log_file,
                    stderr=subprocess.STDOUT,
                    start_new_session=True,
                )
            )
        healthz_status = wait_for_status(
            f"{plan.api_base_url}/healthz",
            expected_statuses={200},
            timeout_seconds=startup_timeout_seconds,
        )
        probe_reports = [
            _run_probe(
                base_url=plan.api_base_url,
                probe=probe,
                secret=plan.structured_query_secret,
                timeout_seconds=timeout_seconds,
            )
            for probe in plan.probes
        ]
        failed_probe_ids = [
            str(report["probe_id"]) for report in probe_reports if report["passed"] is not True
        ]
        passed = (
            healthz_status == 200
            and projection.service_guide_records > 0
            and projection.conflict_records == 0
            and projection.manual_review_sources == 0
            and not failed_probe_ids
        )
        summary: dict[str, object] = {
            "schema_version": SMOKE_SCHEMA_VERSION,
            "passed": passed,
            "api_base_url": plan.api_base_url,
            "processes": [_process_spec_to_artifact(process) for process in plan.processes],
            "process_logs": process_logs,
            "projection": asdict(projection),
            "probes": {
                "healthz_status": healthz_status,
                "startup_timeout_seconds": startup_timeout_seconds,
                "query_timeout_seconds": timeout_seconds,
                "service_guide_queries": probe_reports,
                "failed_probe_ids": failed_probe_ids,
            },
        }
    except Exception as exc:
        summary = {
            "schema_version": SMOKE_SCHEMA_VERSION,
            "passed": False,
            "api_base_url": plan.api_base_url,
            "process_logs": process_logs,
            "projection": asdict(projection) if projection is not None else {},
            "error": str(exc),
        }
    finally:
        _terminate_processes(started)
        for log_file in log_files:
            log_file.close()
    (plan.output_dir / DEFAULT_REPORT_NAME).write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, default=str) + "\n",
        encoding="utf-8",
    )
    return summary


def load_current_service_guide_projection_summary(
    database_url: str,
) -> CurrentServiceGuideProjectionSummary:
    try:
        import psycopg
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("psycopg is required for service guide runtime smoke") from exc

    with psycopg.connect(database_url) as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            select release_id
            from ingestion_projection.structured_projection_current
            where corpus = 'campus_services' and collection = 'service_guide'
            """
        )
        row = cursor.fetchone()
        if row is None or not str(row[0] or "").strip():
            raise RuntimeError("current campus_services/service_guide release is missing")
        release_id = str(row[0])
        counts = {
            "service_guide_records": _count_release_rows(
                cursor,
                "ingestion_projection.service_guide_read_model",
                release_id,
            ),
            "conflict_records": _count_release_rows(
                cursor,
                "ingestion_projection.service_guide_conflicts",
                release_id,
            ),
            "manual_review_sources": _count_release_rows(
                cursor,
                "ingestion_projection.service_guide_manual_review_sources",
                release_id,
            ),
        }
    return CurrentServiceGuideProjectionSummary(release_id=release_id, **counts)


def _resolve_trusted_time_rfc3339(*, repo_root: Path) -> str:
    override = os.getenv("EXECUTION_CONTROL_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339", "").strip()
    if override:
        return override
    preview_report_path = (
        repo_root
        / "var"
        / "official-web-service-guide-no-promotion-proof"
        / ("owrun_source_pack_replay_partial_20260503T033001Z")
        / "selected-write-preview"
        / "official-web-selected-write-preview-report.json"
    )
    if preview_report_path.exists():
        try:
            payload = json.loads(preview_report_path.read_text(encoding="utf-8"))
            for item in payload.get("results", []):
                if not isinstance(item, dict):
                    continue
                full_bundle = item.get("full_bundle")
                if not isinstance(full_bundle, dict):
                    continue
                for record in full_bundle.get("service_guide_records", []):
                    if not isinstance(record, dict):
                        continue
                    effective_from = str(record.get("effective_from") or "").strip()
                    if not effective_from:
                        continue
                    parsed = datetime.fromisoformat(
                        effective_from.replace("Z", "+00:00")
                    ).astimezone(UTC)
                    return (parsed + timedelta(seconds=1)).isoformat().replace("+00:00", "Z")
        except Exception:
            pass
    return "2026-05-03T00:00:01Z"


def _count_release_rows(cursor: object, table_name: str, release_id: str) -> int:
    cursor.execute(
        f"select count(*) from {table_name} where release_id = %s",
        (release_id,),
    )
    row = cursor.fetchone()
    return int(row[0] if row is not None else 0)


def _run_probe(
    *,
    base_url: str,
    probe: ServiceGuideRuntimeProbe,
    secret: str,
    timeout_seconds: float,
) -> dict[str, object]:
    status, body = _post_service_guide_probe(
        f"{base_url}/internal/query/campus-services/service-guide",
        probe,
        secret=secret,
        timeout_seconds=timeout_seconds,
    )
    passed, failures = _validate_probe_response(status=status, body=body, probe=probe)
    return {
        "probe_id": probe.probe_id,
        "passed": passed,
        "status": status,
        "expected_status": probe.expected_status,
        "outcome": body.get("outcome") if isinstance(body, dict) else "",
        "expected_outcome": probe.expected_outcome,
        "failures": failures,
        "body": body,
    }


def _post_service_guide_probe(
    url: str,
    probe: ServiceGuideRuntimeProbe,
    *,
    secret: str,
    timeout_seconds: float,
) -> tuple[int, object]:
    request = urllib.request.Request(
        url,
        data=json.dumps(probe.payload, ensure_ascii=False).encode("utf-8"),
        method="POST",
        headers={
            "content-type": "application/json",
            "x-execution-query-auth": secret,
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            return int(response.status), json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        return int(exc.code), json.loads(exc.read().decode("utf-8") or "{}")


def _validate_probe_response(
    *,
    status: int,
    body: object,
    probe: ServiceGuideRuntimeProbe,
) -> tuple[bool, list[str]]:
    failures: list[str] = []
    if status != probe.expected_status:
        failures.append(f"status={status}; expected={probe.expected_status}")
    if not isinstance(body, dict):
        failures.append("body_not_json_object")
        return False, failures
    if body.get("outcome") != probe.expected_outcome:
        failures.append(f"outcome={body.get('outcome')}; expected={probe.expected_outcome}")
    if probe.expected_fail_close_reason and (
        body.get("fail_close_reason") != probe.expected_fail_close_reason
    ):
        failures.append(
            "fail_close_reason="
            f"{body.get('fail_close_reason')}; expected={probe.expected_fail_close_reason}"
        )
    field_status = body.get("field_status")
    expected_field_status = probe.expected_field_status or {}
    if expected_field_status:
        if not isinstance(field_status, dict):
            failures.append("field_status_missing")
        else:
            for key, expected in expected_field_status.items():
                if field_status.get(key) != expected:
                    failures.append(
                        f"field_status.{key}={field_status.get(key)}; expected={expected}"
                    )
    body_text = json.dumps(body, ensure_ascii=False, sort_keys=True)
    for token in probe.expected_body_tokens:
        if token not in body_text:
            failures.append(f"missing_body_token={token}")
    return not failures, failures


def _default_service_guide_runtime_probes() -> tuple[ServiceGuideRuntimeProbe, ...]:
    return (
        ServiceGuideRuntimeProbe(
            probe_id="procedure_current",
            payload={
                "service_query": "信息公开申请流程怎么办理",
                "guide_focus": "procedure",
                "temporal_query": {"mode": "current"},
                "audience": "student",
            },
            expected_outcome="resolved_current",
            expected_body_tokens=("信息公开",),
        ),
        ServiceGuideRuntimeProbe(
            probe_id="phone_current",
            payload={
                "service_query": "信息公开申请联系电话是多少",
                "guide_focus": "contact",
                "temporal_query": {"mode": "current"},
                "audience": "student",
            },
            expected_outcome="resolved_current",
            expected_field_status={"phone": "present"},
            expected_body_tokens=("010-68932551", "010-68933983"),
        ),
        ServiceGuideRuntimeProbe(
            probe_id="responsible_department_current",
            payload={
                "service_query": "信息公开申请负责部门是谁",
                "guide_focus": "contact",
                "temporal_query": {"mode": "current"},
                "audience": "student",
            },
            expected_outcome="resolved_current",
            expected_body_tokens=("学校信息公开办公室",),
        ),
    )


def _terminate_processes(processes: list[subprocess.Popen[bytes]]) -> None:
    for process in reversed(processes):
        if process.poll() is None:
            _signal_process_group(process, signal.SIGTERM)
    deadline = time.monotonic() + 8
    for process in reversed(processes):
        remaining = max(0.1, deadline - time.monotonic())
        try:
            process.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            _signal_process_group(process, signal.SIGKILL)
            process.wait(timeout=2)


def _signal_process_group(process: subprocess.Popen[bytes], sig: signal.Signals) -> None:
    try:
        os.killpg(process.pid, sig)
    except ProcessLookupError:
        return
    except OSError:
        try:
            process.send_signal(sig)
        except ProcessLookupError:
            return


def _process_spec_to_artifact(process: ProcessCommandSpec) -> dict[str, object]:
    return {
        "label": process.label,
        "command": process.command,
        "cwd": str(process.cwd),
        "env": {
            key: _artifact_env_value(key, value)
            for key, value in sorted(process.env.items(), key=lambda item: item[0])
        },
        "log_path": str(process.log_path),
    }


def _artifact_env_value(key: str, value: str) -> str:
    normalized = key.upper()
    if any(token in normalized for token in ("SECRET", "TOKEN", "API_KEY", "DATABASE_URL")):
        return "<redacted>"
    if normalized.endswith("_URL") and "POSTGRES" in value.upper():
        return "<redacted>"
    return value


def _root_env_value(repo_root: Path, key: str) -> str:
    env_path = repo_root / ".env"
    if not env_path.exists():
        return ""
    prefix = f"{key}="
    for raw_line in env_path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or not line.startswith(prefix):
            continue
        value = line[len(prefix) :].strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
            return value[1:-1]
        return value
    return ""


def _required_text(value: str | None, field_name: str) -> str:
    normalized = str(value or "").strip()
    if not normalized:
        raise ValueError(f"{field_name} is required")
    return normalized


def _available_tcp_port(host: str) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return int(sock.getsockname()[1])


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Run a local read-only smoke for current selected-write "
            "campus_services/service_guide projection consumption."
        )
    )
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--database-url", default=None)
    parser.add_argument("--structured-query-secret", default=None)
    parser.add_argument(
        "--api-port",
        type=int,
        default=0,
        help="Port for execution-control. Defaults to an available local port.",
    )
    parser.add_argument("--timeout-seconds", type=float, default=20.0)
    parser.add_argument("--startup-timeout-seconds", type=float, default=90.0)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    repo_root = Path(__file__).resolve().parents[1]
    plan = build_service_guide_selected_write_runtime_smoke_plan(
        repo_root=repo_root,
        output_dir=Path(args.output_dir),
        database_url=args.database_url,
        structured_query_secret=args.structured_query_secret,
        api_port=args.api_port,
    )
    report = run_service_guide_selected_write_runtime_smoke(
        plan,
        timeout_seconds=args.timeout_seconds,
        startup_timeout_seconds=args.startup_timeout_seconds,
    )
    print(json.dumps(report, ensure_ascii=False, default=str))
    return 0 if report.get("passed") is True else 1


if __name__ == "__main__":
    raise SystemExit(main())
