from __future__ import annotations

import argparse
import json
import os
import signal
import subprocess
import time
import urllib.error
import urllib.request
from collections.abc import Sequence
from dataclasses import dataclass
from pathlib import Path


@dataclass(frozen=True, slots=True)
class ProcessCommandSpec:
    label: str
    command: tuple[str, ...]
    cwd: Path
    env: dict[str, str]
    log_path: Path


@dataclass(frozen=True, slots=True)
class ProcessSmokePlan:
    repo_root: Path
    output_dir: Path
    profile: str
    api_base_url: str
    worker_base_url: str
    answer_payload: dict[str, object]
    expected_status: int
    expected_body_tokens: tuple[str, ...]
    processes: tuple[ProcessCommandSpec, ...]


def build_process_smoke_plan(
    *,
    repo_root: Path,
    output_dir: Path,
    profile: str = "closed_gate",
    api_host: str = "127.0.0.1",
    api_port: int = 18080,
    worker_host: str = "127.0.0.1",
    worker_port: int = 18081,
) -> ProcessSmokePlan:
    api_secret = os.getenv("API_WORKER_SHARED_SECRET", "supervisor-api-local-placeholder")
    bridge_secret = os.getenv(
        "SUPERVISOR_AGENT_WORKER_SHARED_SECRET",
        "supervisor-agent-worker-local-placeholder",
    )
    api_base_url = f"http://{api_host}:{api_port}"
    worker_base_url = f"http://{worker_host}:{worker_port}"
    common_env = {
        "AGENT_RUNTIME_PROVIDER": os.getenv("AGENT_RUNTIME_PROVIDER", "mock-runtime"),
        "PROMPT_RUNTIME_PROVIDER": os.getenv("PROMPT_RUNTIME_PROVIDER", "mock-runtime"),
        "PROMPT_STRICT_STRUCTURED_OUTPUTS": os.getenv("PROMPT_STRICT_STRUCTURED_OUTPUTS", "true"),
        "SUPERVISOR_AGENT_WORKER_SHARED_SECRET": bridge_secret,
    }
    worker_env = {
        **common_env,
        "SUPERVISOR_AGENT_WORKER_HOST": worker_host,
        "SUPERVISOR_AGENT_WORKER_PORT": str(worker_port),
    }
    api_env = {
        **common_env,
        "API_AUTH_MODE": "trusted-worker",
        "API_WORKER_SHARED_SECRET": api_secret,
        "CAMPUS_AGENT_HTTP_HOST": api_host,
        "CAMPUS_AGENT_HTTP_PORT": str(api_port),
        "SUPERVISOR_AGENT_WORKER_BASE_URL": worker_base_url,
        "SUPERVISOR_API_OTEL_ENABLED": "false",
        "SUPERVISOR_API_EXECUTION_AUDIT_ENABLED": "false",
        "SUPERVISOR_API_OPEN_CAPABILITIES": os.getenv("SUPERVISOR_API_OPEN_CAPABILITIES", ""),
    }
    answer_payload, expected_status, expected_body_tokens = _profile_answer_expectation(profile)
    return ProcessSmokePlan(
        repo_root=repo_root,
        output_dir=output_dir,
        profile=profile,
        api_base_url=api_base_url,
        worker_base_url=worker_base_url,
        answer_payload=answer_payload,
        expected_status=expected_status,
        expected_body_tokens=expected_body_tokens,
        processes=(
            ProcessCommandSpec(
                label="supervisor-agent-worker",
                command=(
                    "uv",
                    "run",
                    "--all-packages",
                    "python",
                    "-m",
                    "campus_supervisor_agent_worker.bridge_server",
                ),
                cwd=repo_root,
                env=worker_env,
                log_path=output_dir / "supervisor-agent-worker.log",
            ),
            ProcessCommandSpec(
                label="supervisor-api",
                command=("go", "run", "./cmd/supervisor-api"),
                cwd=repo_root / "apps" / "supervisor-api",
                env=api_env,
                log_path=output_dir / "supervisor-api.log",
            ),
        ),
    )


def _profile_answer_expectation(profile: str) -> tuple[dict[str, object], int, tuple[str, ...]]:
    context = {
        "actor": {
            "user_id": "smoke-student",
            "principal_id": "smoke-student",
            "principal_type": "student",
            "roles": ["student"],
        },
        "authorization": {
            "retrieval_filter": {
                "entitlement_groups": [],
                "visibility_level": "public",
                "policy_projection_version": "phase1-authorization-projection-v1",
            }
        },
    }
    if profile == "closed_gate":
        return (
            {
                "user_goal": "campus shuttle schedule",
                "request_id": "process-smoke-structured-runtime-closed",
                "requested_capability": "campus_services",
                "context": context,
            },
            503,
            ("structured_runtime_closed",),
        )
    if profile == "terminal_fail_close":
        return (
            {
                "user_goal": "解释一下 AI",
                "request_id": "process-smoke-terminal-fail-close",
                "requested_capability": "knowledge",
                "context": context,
            },
            200,
            ("product_scope_boundary",),
        )
    if profile == "rag_delegate":
        return (
            {
                "user_goal": "学生证补办要求是什么",
                "request_id": "process-smoke-rag-delegate",
                "requested_capability": "knowledge",
                "requested_scope": {
                    "corpus": "regulations",
                    "collection": "student_rules",
                },
                "context": context,
            },
            200,
            ("workflow_trace_summary", "agent_execution_projection", "agent_plan"),
        )
    raise ValueError(f"unsupported process smoke profile: {profile}")


def run_process_smoke(
    plan: ProcessSmokePlan, *, timeout_seconds: float = 45.0
) -> dict[str, object]:
    plan.output_dir.mkdir(parents=True, exist_ok=True)
    started: list[subprocess.Popen[bytes]] = []
    log_files = []
    process_logs = {}
    try:
        for process_spec in plan.processes:
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
                )
            )
        worker_healthz = _wait_for_status(
            f"{plan.worker_base_url}/internal/bridge/healthz",
            expected_statuses={200},
            timeout_seconds=timeout_seconds,
            headers={
                "x-supervisor-bridge-auth": plan.processes[0].env[
                    "SUPERVISOR_AGENT_WORKER_SHARED_SECRET"
                ]
            },
        )
        api_healthz = _wait_for_status(
            f"{plan.api_base_url}/healthz",
            expected_statuses={200},
            timeout_seconds=timeout_seconds,
        )
        readyz = _request_json(f"{plan.api_base_url}/readyz")
        metrics_status = _request_status(f"{plan.api_base_url}/metrics")
        answer_status, answer_body = _post_json(
            f"{plan.api_base_url}/api/v1/answer",
            plan.answer_payload,
            headers={"x-worker-origin-auth": plan.processes[1].env["API_WORKER_SHARED_SECRET"]},
            timeout_seconds=timeout_seconds,
        )
        answer_text = json.dumps(answer_body, ensure_ascii=False)
        passed = (
            worker_healthz == 200
            and api_healthz == 200
            and metrics_status == 200
            and answer_status == plan.expected_status
            and all(token in answer_text for token in plan.expected_body_tokens)
        )
        summary = {
            "schema_version": "supervisor_runtime_process_smoke.v1",
            "profile": plan.profile,
            "passed": passed,
            "api_base_url": plan.api_base_url,
            "worker_base_url": plan.worker_base_url,
            "processes": [process_spec_to_artifact(process) for process in plan.processes],
            "process_logs": process_logs,
            "probes": {
                "worker_healthz_status": worker_healthz,
                "api_healthz_status": api_healthz,
                "readyz_status": readyz[0],
                "metrics_status": metrics_status,
                "answer_status": answer_status,
                "expected_answer_status": plan.expected_status,
                "expected_body_tokens": plan.expected_body_tokens,
            },
            "answer": answer_body,
        }
    except Exception as exc:
        summary = {
            "schema_version": "supervisor_runtime_process_smoke.v1",
            "profile": plan.profile,
            "passed": False,
            "api_base_url": plan.api_base_url,
            "worker_base_url": plan.worker_base_url,
            "process_logs": process_logs,
            "error": str(exc),
        }
    finally:
        _terminate_processes(started)
        for log_file in log_files:
            log_file.close()
    (plan.output_dir / "process-smoke-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, default=str) + "\n",
        encoding="utf-8",
    )
    return summary


def process_spec_to_artifact(process: ProcessCommandSpec) -> dict[str, object]:
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
    normalized = key.strip().upper()
    if any(token in normalized for token in ("SECRET", "TOKEN", "API_KEY", "ACCESS_KEY")):
        return "<redacted>"
    return value


def _wait_for_status(
    url: str,
    *,
    expected_statuses: set[int],
    timeout_seconds: float,
    headers: dict[str, str] | None = None,
) -> int:
    deadline = time.monotonic() + timeout_seconds
    last_status = 0
    while time.monotonic() < deadline:
        last_status = _request_status(url, headers=headers)
        if last_status in expected_statuses:
            return last_status
        time.sleep(0.5)
    raise RuntimeError(f"timed out waiting for {url}; last_status={last_status}")


def _request_status(url: str, *, headers: dict[str, str] | None = None) -> int:
    try:
        request = urllib.request.Request(url, headers=headers or {})
        with urllib.request.urlopen(request, timeout=2) as response:
            return int(response.status)
    except urllib.error.HTTPError as exc:
        return int(exc.code)
    except OSError:
        return 0


def _request_json(url: str) -> tuple[int, object]:
    try:
        with urllib.request.urlopen(url, timeout=3) as response:
            return int(response.status), json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        return int(exc.code), json.loads(exc.read().decode("utf-8") or "{}")


def _post_json(
    url: str,
    payload: dict[str, object],
    *,
    headers: dict[str, str],
    timeout_seconds: float,
) -> tuple[int, object]:
    request = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"content-type": "application/json", **headers},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            return int(response.status), json.loads(response.read().decode("utf-8") or "{}")
    except urllib.error.HTTPError as exc:
        return int(exc.code), json.loads(exc.read().decode("utf-8") or "{}")


def _terminate_processes(processes: list[subprocess.Popen[bytes]]) -> None:
    for process in reversed(processes):
        if process.poll() is None:
            process.send_signal(signal.SIGTERM)
    deadline = time.monotonic() + 8
    for process in reversed(processes):
        remaining = max(0.1, deadline - time.monotonic())
        try:
            process.wait(timeout=remaining)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=2)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Run supervisor-api + supervisor-agent-worker local process smoke."
    )
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--profile", default="closed_gate")
    parser.add_argument("--api-port", type=int, default=18080)
    parser.add_argument("--worker-port", type=int, default=18081)
    parser.add_argument("--timeout-seconds", type=float, default=45.0)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    repo_root = Path(__file__).resolve().parents[1]
    plan = build_process_smoke_plan(
        repo_root=repo_root,
        output_dir=Path(args.output_dir),
        profile=args.profile,
        api_port=args.api_port,
        worker_port=args.worker_port,
    )
    summary = run_process_smoke(plan, timeout_seconds=args.timeout_seconds)
    print(json.dumps(summary, ensure_ascii=False, default=str))
    return 0 if summary.get("passed") is True else 1


if __name__ == "__main__":
    raise SystemExit(main())
