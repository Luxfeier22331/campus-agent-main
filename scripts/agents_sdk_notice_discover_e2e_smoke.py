from __future__ import annotations

import argparse
import json
import os
import subprocess
from collections.abc import Mapping
from pathlib import Path

from scripts.supervisor_runtime_process_smoke import (
    DEFAULT_STARTUP_TIMEOUT_SECONDS,
    ProcessCommandSpec,
    ProcessSmokePlan,
    _prepare_process_smoke_runtime,
    _processes_with_env_overlay,
    process_spec_to_artifact,
)
from scripts.supervisor_runtime_process_smoke_http import (
    _post_json,
    _request_status,
    terminate_processes,
    wait_for_json_status,
    wait_for_status,
)

AGENTS_SDK_NOTICE_DISCOVER_E2E_PROFILE = "agents_sdk_notice_discover_e2e"
SMOKE_SCHEMA_VERSION = "agents-sdk-notice-discover-e2e-smoke.v1"
DEFAULT_OUTPUT_DIR = Path(".tmp/agents-sdk-notice-discover-e2e-smoke")
_QUERY_SECRET = "supervisor-internal-query-sdk-e2e-placeholder"
_BRIDGE_SECRET = "supervisor-agent-worker-sdk-e2e-placeholder"
_SEED_NOTICE_TITLE = "烟雾测试通知"
_SEED_NOTICE_SOURCE_URL = "https://example.invalid/notices/smoke"
_OLD_INTERNAL_QUERY_ENV_SUFFIXES = ("STRUCTURED_QUERY_BASE_URL", "STRUCTURED_QUERY_SHARED_SECRET")


def build_e2e_smoke_plan(
    *,
    repo_root: Path,
    output_dir: Path = DEFAULT_OUTPUT_DIR,
    api_host: str = "127.0.0.1",
    api_port: int = 27071,
    worker_host: str = "127.0.0.1",
    worker_port: int = 27072,
    provider_env: Mapping[str, str] | None = None,
) -> ProcessSmokePlan:
    api_base_url = f"http://{api_host}:{api_port}"
    worker_base_url = f"http://{worker_host}:{worker_port}"
    resolved_provider_env = _provider_env(provider_env)
    common_env = {
        "PROMPT_STRICT_STRUCTURED_OUTPUTS": "true",
        **resolved_provider_env,
    }
    worker_env = {
        **common_env,
        "SUPERVISOR_AGENT_WORKER_HOST": worker_host,
        "SUPERVISOR_AGENT_WORKER_PORT": str(worker_port),
        "SUPERVISOR_AGENT_WORKER_SHARED_SECRET": _BRIDGE_SECRET,
        "SUPERVISOR_INTERNAL_QUERY_BASE_URL": api_base_url,
        "SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET": _QUERY_SECRET,
        "SUPERVISOR_STRUCTURED_QUERY_TIMEOUT_SECONDS": "3.0",
        "SUPERVISOR_AGENTS_SDK_RUNTIME_ENABLED": "true",
        "SUPERVISOR_AGENTS_SDK_ALLOWED_TARGETS": "notice-agent",
        "SUPERVISOR_AGENTS_SDK_ALLOWED_TOOLS": "campus_notice_discover",
    }
    api_env = {
        **common_env,
        "API_AUTH_MODE": "trusted-worker",
        "API_WORKER_SHARED_SECRET": "supervisor-api-sdk-e2e-placeholder",
        "CAMPUS_AGENT_HTTP_HOST": api_host,
        "CAMPUS_AGENT_HTTP_PORT": str(api_port),
        "SUPERVISOR_AGENT_WORKER_BASE_URL": worker_base_url,
        "SUPERVISOR_AGENT_WORKER_SHARED_SECRET": _BRIDGE_SECRET,
        "SUPERVISOR_API_OPEN_CAPABILITIES": "",
        "SUPERVISOR_API_OTEL_ENABLED": "false",
        "SUPERVISOR_API_EXECUTION_AUDIT_ENABLED": "false",
        "SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET": _QUERY_SECRET,
    }
    _assert_old_env_absent(worker_env)
    _assert_old_env_absent(api_env)
    return ProcessSmokePlan(
        repo_root=repo_root,
        output_dir=output_dir,
        profile=AGENTS_SDK_NOTICE_DISCOVER_E2E_PROFILE,
        api_base_url=api_base_url,
        worker_base_url=worker_base_url,
        answer_path="/internal/bridge/supervisor/answer",
        answer_response_kind="json",
        answer_payload=_build_bridge_payload(),
        expected_status=200,
        expected_readyz_statuses=(200, 503),
        expected_body_tokens=(
            "notice-agent",
            "campus_notice_discover",
            "sdk_completed",
            _SEED_NOTICE_TITLE,
            _SEED_NOTICE_SOURCE_URL,
        ),
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


def run_smoke(
    *,
    plan: ProcessSmokePlan | None = None,
    output_dir: Path = DEFAULT_OUTPUT_DIR,
    timeout_seconds: float = 60.0,
    startup_timeout_seconds: float | None = None,
) -> dict[str, object]:
    _load_repo_env()
    runtime_plan = plan or build_e2e_smoke_plan(
        repo_root=Path.cwd(),
        output_dir=output_dir,
    )
    runtime_plan.output_dir.mkdir(parents=True, exist_ok=True)
    started: list[subprocess.Popen[bytes]] = []
    log_files = []
    process_logs: dict[str, str] = {}
    runtime_preparation = None
    startup_timeout = max(
        timeout_seconds,
        startup_timeout_seconds
        if startup_timeout_seconds is not None
        else DEFAULT_STARTUP_TIMEOUT_SECONDS,
    )
    try:
        runtime_preparation = _prepare_process_smoke_runtime(
            runtime_plan,
            timeout_seconds=startup_timeout,
        )
        processes = _processes_with_env_overlay(
            runtime_plan.processes,
            runtime_preparation.process_env_overlay if runtime_preparation is not None else {},
            target_labels=("supervisor-api",),
        )
        process_by_label = {process.label: process for process in processes}
        for process_spec in processes:
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
        worker_healthz = wait_for_status(
            f"{runtime_plan.worker_base_url}/internal/bridge/healthz",
            expected_statuses={200},
            timeout_seconds=startup_timeout,
            headers={
                "x-supervisor-bridge-auth": process_by_label["supervisor-agent-worker"].env[
                    "SUPERVISOR_AGENT_WORKER_SHARED_SECRET"
                ]
            },
        )
        api_healthz = wait_for_status(
            f"{runtime_plan.api_base_url}/healthz",
            expected_statuses={200},
            timeout_seconds=startup_timeout,
        )
        worker_readyz = wait_for_json_status(
            f"{runtime_plan.worker_base_url}/internal/bridge/readyz",
            expected_statuses={200},
            timeout_seconds=startup_timeout,
            headers={
                "x-supervisor-bridge-auth": process_by_label["supervisor-agent-worker"].env[
                    "SUPERVISOR_AGENT_WORKER_SHARED_SECRET"
                ]
            },
        )
        api_readyz = wait_for_json_status(
            f"{runtime_plan.api_base_url}/readyz",
            expected_statuses=set(runtime_plan.expected_readyz_statuses),
            timeout_seconds=startup_timeout,
        )
        metrics_status = _request_status(f"{runtime_plan.api_base_url}/metrics")
        answer_status, answer_body = _post_json(
            f"{runtime_plan.worker_base_url}{runtime_plan.answer_path}",
            runtime_plan.answer_payload,
            headers={
                "x-supervisor-bridge-auth": process_by_label["supervisor-agent-worker"].env[
                    "SUPERVISOR_AGENT_WORKER_SHARED_SECRET"
                ]
            },
            timeout_seconds=timeout_seconds,
        )
        bridge_passed, bridge_checks = _bridge_response_passed(answer_status, answer_body)
        answer_text = json.dumps(answer_body, ensure_ascii=False)
        env_checks = _env_checks(processes)
        passed = (
            worker_healthz == 200
            and api_healthz == 200
            and worker_readyz[0] == 200
            and api_readyz[0] in runtime_plan.expected_readyz_statuses
            and metrics_status == 200
            and bridge_passed
            and all(token in answer_text for token in runtime_plan.expected_body_tokens)
            and env_checks["old_internal_query_env_absent"]
        )
        summary = {
            "schema_version": SMOKE_SCHEMA_VERSION,
            "profile": runtime_plan.profile,
            "passed": passed,
            "mode": "real_openai_agents_sdk_with_go_structured_query_pg_read_model",
            "structured_query_e2e": bridge_checks["structured_query_e2e"],
            "api_base_url": runtime_plan.api_base_url,
            "worker_base_url": runtime_plan.worker_base_url,
            "processes": [process_spec_to_artifact(process) for process in processes],
            "process_logs": process_logs,
            "runtime_preparation": (
                runtime_preparation.artifact if runtime_preparation is not None else {}
            ),
            "env_checks": env_checks,
            "probes": {
                "worker_healthz_status": worker_healthz,
                "worker_readyz_status": worker_readyz[0],
                "api_healthz_status": api_healthz,
                "api_readyz_status": api_readyz[0],
                "metrics_status": metrics_status,
                "answer_status": answer_status,
                "answer_timeout_seconds": timeout_seconds,
                "startup_timeout_seconds": startup_timeout,
                "bridge_checks": bridge_checks,
            },
            "answer": answer_body,
        }
    except Exception as exc:
        summary = {
            "schema_version": SMOKE_SCHEMA_VERSION,
            "profile": runtime_plan.profile,
            "passed": False,
            "mode": "real_openai_agents_sdk_with_go_structured_query_pg_read_model",
            "structured_query_e2e": False,
            "api_base_url": runtime_plan.api_base_url,
            "worker_base_url": runtime_plan.worker_base_url,
            "process_logs": process_logs,
            "error": str(exc),
        }
    finally:
        terminate_processes(started)
        for log_file in log_files:
            log_file.close()
        if runtime_preparation is not None:
            runtime_preparation.cleanup()
    report_path = runtime_plan.output_dir / "agents-sdk-notice-discover-e2e-summary.json"
    report_path.write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, default=str) + "\n",
        encoding="utf-8",
    )
    return summary


def _build_bridge_payload() -> dict[str, object]:
    context = {
        "actor": {
            "user_id": "smoke-student",
            "principal_id": "smoke-student",
            "principal_type": "student",
            "roles": ["student"],
        },
        "authorization": {
            "principal_id": "smoke-student",
            "retrieval_filter": {
                "entitlement_groups": [],
                "visibility_level": "public",
                "policy_projection_version": "phase1-authorization-projection-v1",
            },
        },
    }
    user_goal = _SEED_NOTICE_TITLE
    request_id = "agents-sdk-notice-discover-e2e-smoke"
    trace_id = "trace-agents-sdk-notice-discover-e2e"
    return {
        "bridge_version": "supervisor_bridge_v6",
        "response_contract": "agent_response",
        "user_goal": user_goal,
        "conversation_id": "",
        "request_id": request_id,
        "trace": {"trace_id": trace_id},
        "requested_capability": "notice",
        "effective_capability": "notice",
        "lane": "notice",
        "actor": context["actor"],
        "context": context,
        "version_query": {"mode": "current"},
        "runtime_decisions": {
            "schema_version": "supervisor-runtime-decisions-v1",
            "effective_capability": "notice",
            "lane": "notice",
            "scope_gate": {
                "decision": "in_scope",
                "reason": "sdk_e2e_smoke",
                "matched_signal": "",
            },
            "policy_gate": {
                "decision": "delegate",
                "reason": "",
                "risk_level": "low",
                "matched_signal": "",
            },
            "context_preflight": {
                "state": "not_follow_up",
                "reference_type": "none",
                "missing_slots": [],
                "resolved_slots": {},
                "matched_signal": "",
                "ambiguity_reason": "",
            },
            "tool_policy": {"policy_version": "runtime-policy-v1"},
            "routing_frame": {
                "capability": "notice",
                "task_kind": "notice_lookup",
                "domain_candidates": ["notice"],
                "missing_slots": [],
                "risk_level": "low",
                "needs_clarification": False,
                "suggested_next_action": "delegate",
                "personalization_mode": "generic",
                "clarification_subject": "",
                "scope_class": "in_scope",
                "policy_reason": "",
                "launch_state": "open",
                "scope_reason": "sdk_e2e_smoke",
                "matched_signal": "",
                "classifier_version": "go-runtime-policy-v2",
                "schema_version": "intent-schema-1.0.0",
                "routing_confidence": "high",
                "ambiguity_signal": "",
                "context_resolution_state": "not_follow_up",
                "context_reference_type": "none",
                "resolved_slots": {},
                "ambiguity_reason": "",
            },
            "runtime_decision_summary": {
                "schema_version": "runtime-decision-summary-v1",
                "scope_gate_decision": "in_scope",
                "policy_gate_decision": "delegate",
                "context_preflight_state": "not_follow_up",
                "routing_next_action": "delegate",
                "planning_outcome": "preplanned",
            },
            "handoff": {
                "planning_outcome": "preplanned",
                "target": "notice-agent",
                "allowed_tools": ["campus_notice_discover"],
                "agent_request": {
                    "target": "notice-agent",
                    "user_goal": user_goal,
                    "conversation_id": "",
                    "request_id": request_id,
                    "safety_identifier": None,
                    "trace": {"trace_id": trace_id},
                    "actor": context["actor"],
                    "context": context,
                    "payload": {
                        "kind": "campus_notice_discover",
                        "payload": {
                            "query_text": user_goal,
                            "temporal_query": {"mode": "current"},
                            "source_families": ["wechat_public_notice"],
                            "target_surfaces": ["notice_level_query"],
                            "max_results": 3,
                        },
                    },
                    "allowed_tools": ["campus_notice_discover"],
                },
            },
        },
    }


def _bridge_response_passed(status_code: int, body: object) -> tuple[bool, dict[str, bool]]:
    response = body if isinstance(body, dict) else {}
    observability = _dict(response.get("agent_observability"))
    safe_details = _dict(observability.get("safe_details"))
    runner_projection = _dict(safe_details.get("agents_sdk_runner_projection"))
    tool_result = _dict(runner_projection.get("tool_result_projection"))
    answer_text = str(response.get("answer_text") or "")
    titles = _string_list(tool_result.get("titles"))
    source_urls = _string_list(tool_result.get("source_urls"))
    checks = {
        "status_code_ok": status_code == 200,
        "response_completed": response.get("status") == "completed",
        "notice_agent_target": response.get("target") == "notice-agent",
        "selected_tool_ok": observability.get("selected_tool") == "campus_notice_discover",
        "tool_outcome_ok": observability.get("tool_outcome") == "sdk_completed",
        "tool_called_once": runner_projection.get("tool_call_count") == 1,
        "tool_executed_once": runner_projection.get("tool_execution_count") == 1,
        "source_ref_count_positive": _int(observability.get("source_ref_count")) > 0,
        "tool_result_source_ref_count_positive": _int(tool_result.get("source_ref_count")) > 0,
        "tool_result_resolved_current": tool_result.get("outcome") == "resolved_current",
        "seed_notice_card_count_positive": _int(tool_result.get("notice_card_count")) > 0,
        "seed_notice_title_present": _SEED_NOTICE_TITLE in titles
        or _SEED_NOTICE_TITLE in answer_text,
        "seed_notice_source_url_present": (
            _SEED_NOTICE_SOURCE_URL in source_urls or _SEED_NOTICE_SOURCE_URL in answer_text
        ),
    }
    checks["structured_query_e2e"] = (
        checks["tool_executed_once"]
        and checks["tool_result_resolved_current"]
        and checks["seed_notice_card_count_positive"]
        and checks["seed_notice_title_present"]
        and checks["seed_notice_source_url_present"]
    )
    return all(checks.values()), checks


def _provider_env(provider_env: Mapping[str, str] | None) -> dict[str, str]:
    source = provider_env or os.environ
    provider = _first_present(source, "PROMPT_RUNTIME_PROVIDER", "AGENT_RUNTIME_PROVIDER")
    model = _first_present(source, "PROMPT_RUNTIME_MODEL", "AGENT_PROMPT_MODEL")
    api_key = _first_present(source, "PROMPT_RUNTIME_API_KEY", "LLM_API_KEY")
    base_url = _first_present(source, "PROMPT_RUNTIME_BASE_URL", "LLM_BASE_URL")
    missing = [
        key
        for key, value in {
            "PROMPT_RUNTIME_PROVIDER or AGENT_RUNTIME_PROVIDER": provider,
            "PROMPT_RUNTIME_MODEL or AGENT_PROMPT_MODEL": model,
            "PROMPT_RUNTIME_API_KEY or LLM_API_KEY": api_key,
            "PROMPT_RUNTIME_BASE_URL or LLM_BASE_URL": base_url,
        }.items()
        if not value
    ]
    if missing:
        raise RuntimeError(f"Agents SDK E2E smoke missing provider env: {', '.join(missing)}")
    return {
        "PROMPT_RUNTIME_PROVIDER": provider,
        "AGENT_RUNTIME_PROVIDER": provider,
        "PROMPT_RUNTIME_MODEL": model,
        "AGENT_PROMPT_MODEL": model,
        "PROMPT_RUNTIME_API_KEY": api_key,
        "PROMPT_RUNTIME_BASE_URL": base_url,
    }


def _first_present(source: Mapping[str, str], *keys: str) -> str:
    for key in keys:
        value = str(source.get(key, "") or "").strip()
        if value:
            return value
    return ""


def _env_checks(processes: tuple[ProcessCommandSpec, ...]) -> dict[str, bool]:
    env_text = "\n".join(
        f"{key}={value}" for process in processes for key, value in sorted(process.env.items())
    )
    old_keys = _old_internal_query_env_keys()
    return {
        "internal_query_base_url_present": "SUPERVISOR_INTERNAL_QUERY_BASE_URL=" in env_text,
        "internal_query_secret_present": "SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET=" in env_text,
        "old_internal_query_env_absent": not any(key in env_text for key in old_keys),
    }


def _assert_old_env_absent(env: Mapping[str, str]) -> None:
    present = [key for key in _old_internal_query_env_keys() if key in env]
    if present:
        raise ValueError(f"old internal query env keys are not allowed: {', '.join(present)}")


def _old_internal_query_env_keys() -> tuple[str, ...]:
    return tuple(f"SUPERVISOR_{suffix}" for suffix in _OLD_INTERNAL_QUERY_ENV_SUFFIXES)


def _dict(value: object) -> dict[str, object]:
    return value if isinstance(value, dict) else {}


def _string_list(value: object) -> list[str]:
    if not isinstance(value, list):
        return []
    return [item for item in value if isinstance(item, str)]


def _int(value: object) -> int:
    return value if isinstance(value, int) else 0


def _load_repo_env() -> None:
    path = Path(".env")
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        if not raw_line.strip() or raw_line.lstrip().startswith("#") or "=" not in raw_line:
            continue
        key, value = raw_line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description=(
            "Run OpenAI Agents SDK notice-agent discover E2E smoke through "
            "Go structured-query and temporary PG notice read model."
        )
    )
    parser.add_argument("--output-dir", default=str(DEFAULT_OUTPUT_DIR))
    parser.add_argument("--api-port", type=int, default=27071)
    parser.add_argument("--worker-port", type=int, default=27072)
    parser.add_argument("--timeout-seconds", type=float, default=60.0)
    parser.add_argument("--startup-timeout-seconds", type=float, default=None)
    return parser


def main() -> None:
    args = build_parser().parse_args()
    _load_repo_env()
    output_dir = Path(args.output_dir)
    report = run_smoke(
        plan=build_e2e_smoke_plan(
            repo_root=Path.cwd(),
            output_dir=output_dir,
            api_port=args.api_port,
            worker_port=args.worker_port,
        ),
        output_dir=output_dir,
        timeout_seconds=args.timeout_seconds,
        startup_timeout_seconds=args.startup_timeout_seconds,
    )
    print(json.dumps(report, ensure_ascii=False, indent=2, default=str))
    if report.get("passed") is not True:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
