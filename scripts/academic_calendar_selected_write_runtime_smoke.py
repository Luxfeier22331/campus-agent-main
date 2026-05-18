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
from pathlib import Path

if __package__ in {None, ""}:
    import sys

    sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.supervisor_runtime_process_smoke_http import wait_for_status

SMOKE_SCHEMA_VERSION = "academic_calendar_selected_write_runtime_smoke.v1"
DEFAULT_REPORT_NAME = "academic-calendar-selected-write-runtime-smoke.json"


@dataclass(frozen=True, slots=True)
class ProcessCommandSpec:
    label: str
    command: tuple[str, ...]
    cwd: Path
    env: dict[str, str]
    log_path: Path


@dataclass(frozen=True, slots=True)
class CurrentAcademicCalendarProjectionSummary:
    release_id: str
    academic_calendar_records: int


@dataclass(frozen=True, slots=True)
class AcademicCalendarRuntimeProbe:
    probe_id: str
    payload: dict[str, object]
    expected_status: int = 200
    expected_outcome: str = "resolved_current"
    expected_fail_close_reason: str = ""
    expected_body_tokens: tuple[str, ...] = ()
    expected_fields: dict[str, object] | None = None


@dataclass(frozen=True, slots=True)
class AcademicCalendarSelectedWriteRuntimeSmokePlan:
    repo_root: Path
    output_dir: Path
    api_base_url: str
    structured_query_secret: str
    database_url: str
    probes: tuple[AcademicCalendarRuntimeProbe, ...]
    processes: tuple[ProcessCommandSpec, ...]


def build_academic_calendar_selected_write_runtime_smoke_plan(
    *,
    repo_root: Path,
    output_dir: Path,
    database_url: str | None = None,
    structured_query_secret: str | None = None,
    trusted_time_rfc3339: str | None = None,
    api_host: str = "127.0.0.1",
    api_port: int = 0,
) -> AcademicCalendarSelectedWriteRuntimeSmokePlan:
    resolved_database_url = _required_text(
        database_url
        or os.getenv("CAMPUS_SHARED_POSTGRES_URL")
        or _root_env_value(repo_root, "CAMPUS_SHARED_POSTGRES_URL"),
        "database_url",
    )
    resolved_secret = _required_text(
        structured_query_secret
        or os.getenv("SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET")
        or _root_env_value(repo_root, "SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET")
        or "query-secret",
        "structured_query_secret",
    )
    resolved_api_port = api_port if api_port > 0 else _available_tcp_port(api_host)
    api_base_url = f"http://{api_host}:{resolved_api_port}"
    process = ProcessCommandSpec(
        label="supervisor-api",
        command=("go", "run", "./cmd/supervisor-api"),
        cwd=repo_root / "apps" / "supervisor-api",
        env={
            "API_AUTH_MODE": "trusted-worker",
            "API_WORKER_SHARED_SECRET": os.getenv(
                "API_WORKER_SHARED_SECRET",
                "academic-calendar-runtime-smoke-worker-secret",
            ),
            "CAMPUS_AGENT_HTTP_HOST": api_host,
            "CAMPUS_AGENT_HTTP_PORT": str(resolved_api_port),
            "CAMPUS_SHARED_POSTGRES_URL": resolved_database_url,
            "PROMPT_RUNTIME_API_KEY": os.getenv(
                "PROMPT_RUNTIME_API_KEY",
                "academic-calendar-runtime-smoke-prompt-key",
            ),
            "PROMPT_RUNTIME_MODEL": os.getenv("PROMPT_RUNTIME_MODEL", "gpt-5.5"),
            "PROMPT_RUNTIME_PROVIDER": os.getenv("PROMPT_RUNTIME_PROVIDER", "mock-runtime"),
            "PROMPT_STRICT_STRUCTURED_OUTPUTS": os.getenv(
                "PROMPT_STRICT_STRUCTURED_OUTPUTS",
                "true",
            ),
            "SUPERVISOR_API_EXECUTION_AUDIT_ENABLED": "false",
            "SUPERVISOR_API_OTEL_ENABLED": "false",
            "SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET": resolved_secret,
            "SUPERVISOR_STRUCTURED_QUERY_TIMEOUT_MS": os.getenv(
                "SUPERVISOR_STRUCTURED_QUERY_TIMEOUT_MS",
                "2000",
            ),
            "SUPERVISOR_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339": _required_text(
                trusted_time_rfc3339
                or os.getenv("SUPERVISOR_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339")
                or "2026-05-04T00:00:01Z",
                "trusted_time_rfc3339",
            ),
        },
        log_path=output_dir / "supervisor-api.log",
    )
    return AcademicCalendarSelectedWriteRuntimeSmokePlan(
        repo_root=repo_root,
        output_dir=output_dir,
        api_base_url=api_base_url,
        structured_query_secret=resolved_secret,
        database_url=resolved_database_url,
        probes=_default_academic_calendar_runtime_probes(),
        processes=(process,),
    )


def run_academic_calendar_selected_write_runtime_smoke(
    plan: AcademicCalendarSelectedWriteRuntimeSmokePlan,
    *,
    timeout_seconds: float = 20.0,
    startup_timeout_seconds: float = 90.0,
) -> dict[str, object]:
    plan.output_dir.mkdir(parents=True, exist_ok=True)
    started: list[subprocess.Popen[bytes]] = []
    log_files = []
    process_logs: dict[str, str] = {}
    projection: CurrentAcademicCalendarProjectionSummary | None = None
    try:
        projection = load_current_academic_calendar_projection_summary(plan.database_url)
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
            and projection.academic_calendar_records > 0
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
                "academic_calendar_queries": probe_reports,
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


def load_current_academic_calendar_projection_summary(
    database_url: str,
) -> CurrentAcademicCalendarProjectionSummary:
    try:
        import psycopg
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("psycopg is required for academic calendar runtime smoke") from exc

    with psycopg.connect(database_url) as connection, connection.cursor() as cursor:
        cursor.execute(
            """
            select release_id
            from ingestion_projection.structured_projection_current
            where corpus = 'calendar' and collection = 'academic_calendar'
            """
        )
        row = cursor.fetchone()
        if row is None or not str(row[0] or "").strip():
            raise RuntimeError("current calendar/academic_calendar release is missing")
        release_id = str(row[0])
        record_count = _count_release_rows(
            cursor,
            "ingestion_projection.academic_calendar_read_model",
            release_id,
        )
    return CurrentAcademicCalendarProjectionSummary(
        release_id=release_id,
        academic_calendar_records=record_count,
    )


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
    probe: AcademicCalendarRuntimeProbe,
    secret: str,
    timeout_seconds: float,
) -> dict[str, object]:
    status, body = _post_academic_calendar_probe(
        f"{base_url}/internal/query/calendar/academic-calendar",
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


def _post_academic_calendar_probe(
    url: str,
    probe: AcademicCalendarRuntimeProbe,
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
            "x-supervisor-query-auth": secret,
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
    probe: AcademicCalendarRuntimeProbe,
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
    source_refs = body.get("source_refs")
    if probe.expected_outcome == "resolved_current" and not _string_list(source_refs):
        failures.append("source_refs_missing")
    for key, expected in (probe.expected_fields or {}).items():
        if body.get(key) != expected:
            failures.append(f"{key}={body.get(key)}; expected={expected}")
    body_text = json.dumps(body, ensure_ascii=False, sort_keys=True)
    for token in probe.expected_body_tokens:
        if token not in body_text:
            failures.append(f"missing_body_token={token}")
    return not failures, failures


def _default_academic_calendar_runtime_probes() -> tuple[AcademicCalendarRuntimeProbe, ...]:
    return (
        AcademicCalendarRuntimeProbe(
            probe_id="teaching_week_current",
            payload={
                "query_text": "今天第几教学周",
                "temporal_query": {"mode": "current"},
                "date_hint": "2026-05-04",
            },
            expected_fields={"week_index": 10},
        ),
        AcademicCalendarRuntimeProbe(
            probe_id="holiday_current",
            payload={
                "query_text": "五一放几天",
                "temporal_query": {"mode": "current"},
            },
            expected_fields={
                "day_kind": "course_suspension",
                "display_start_date": "2026-04-27",
                "display_end_date": "2026-05-05",
            },
            expected_body_tokens=("运动会、春季社会实践周、劳动节假期课程调整",),
        ),
        AcademicCalendarRuntimeProbe(
            probe_id="spring_break_alias_current",
            payload={
                "query_text": "今年春假是什么时候",
                "query_kind": "named_event_range",
                "event_query": "春假",
                "temporal_query": {"mode": "current_year", "year_hint": "2026"},
            },
            expected_body_tokens=("运动会、春季社会实践周、劳动节假期课程调整", "春假"),
            expected_fields={
                "day_kind": "course_suspension",
                "display_start_date": "2026-04-27",
                "display_end_date": "2026-05-05",
            },
        ),
        AcademicCalendarRuntimeProbe(
            probe_id="notice_rest_day_current",
            payload={
                "query_text": "2026-05-09 上课吗",
                "query_kind": "day_status",
                "target_date": "2026-05-09",
                "temporal_query": {"mode": "current"},
            },
            expected_fields={"day_kind": "normal_rest_day", "is_makeup_class": False},
            expected_body_tokens=("calendar:official_web:baseline-2026-05-09",),
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


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [text for item in value if (text := str(item or "").strip())]


def _available_tcp_port(host: str) -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind((host, 0))
        return int(sock.getsockname()[1])


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Run a local read-only smoke for current calendar/academic_calendar "
            "structured projection consumption."
        )
    )
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--database-url", default=None)
    parser.add_argument("--structured-query-secret", default=None)
    parser.add_argument(
        "--api-port",
        type=int,
        default=0,
        help="Port for supervisor-api. Defaults to an available local port.",
    )
    parser.add_argument("--timeout-seconds", type=float, default=20.0)
    parser.add_argument("--startup-timeout-seconds", type=float, default=90.0)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    repo_root = Path(__file__).resolve().parents[1]
    plan = build_academic_calendar_selected_write_runtime_smoke_plan(
        repo_root=repo_root,
        output_dir=Path(args.output_dir),
        database_url=args.database_url,
        structured_query_secret=args.structured_query_secret,
        api_port=args.api_port,
    )
    report = run_academic_calendar_selected_write_runtime_smoke(
        plan,
        timeout_seconds=args.timeout_seconds,
        startup_timeout_seconds=args.startup_timeout_seconds,
    )
    print(json.dumps(report, ensure_ascii=False, default=str))
    return 0 if report.get("passed") is True else 1


if __name__ == "__main__":
    raise SystemExit(main())
