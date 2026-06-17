from __future__ import annotations

import argparse
import json
import os
import subprocess
from collections.abc import Sequence
from pathlib import Path

from scripts import execution_control_process_smoke_runtime as _runtime
from scripts.execution_control_process_smoke_http import (
    _request_status,
    post_execution_run_probe,
    terminate_processes,
    wait_for_json_status,
    wait_for_status,
)
from scripts.execution_control_process_smoke_models import ProcessCommandSpec, ProcessSmokePlan
from scripts.execution_control_process_smoke_profiles import (
    MULTI_STEP_WORKFLOW_PROFILES,
    RAG_RETRIEVAL_PROFILES,
    SELECTED_NOTICE_GUARDRAIL_PROFILES,
    STRUCTURED_DIRECT_OPENED_TRUSTED_TIME,
    TRANSPORT_NOTICE_OVERRIDE_TRUSTED_TIME,
    campus_services_sdk_profiles,
    profile_execution_run_expectation,
    profile_requires_object_store,
)

DEFAULT_STARTUP_TIMEOUT_SECONDS = 180.0

_RuntimePreparation = _runtime._RuntimePreparation
_create_temporary_postgres_database = _runtime._create_temporary_postgres_database
_postgres_url_with_database = _runtime._postgres_url_with_database
_process_smoke_base_postgres_url = _runtime._process_smoke_base_postgres_url
_processes_with_env_overlay = _runtime._processes_with_env_overlay
_sanitize_postgres_database_name = _runtime._sanitize_postgres_database_name
_seed_notice_read_model_smoke = _runtime._seed_notice_read_model_smoke
_seed_structured_projection_smoke = _runtime._seed_structured_projection_smoke
process_spec_to_artifact = _runtime.process_spec_to_artifact


def _prepare_process_smoke_runtime(
    plan: ProcessSmokePlan,
    *,
    timeout_seconds: float,
) -> _RuntimePreparation | None:
    _runtime._create_temporary_postgres_database = _create_temporary_postgres_database
    _runtime._postgres_url_with_database = _postgres_url_with_database
    _runtime._process_smoke_base_postgres_url = _process_smoke_base_postgres_url
    _runtime._seed_notice_read_model_smoke = _seed_notice_read_model_smoke
    _runtime._seed_structured_projection_smoke = _seed_structured_projection_smoke
    return _runtime._prepare_process_smoke_runtime(plan, timeout_seconds=timeout_seconds)


def build_process_smoke_plan(
    *,
    repo_root: Path,
    output_dir: Path,
    profile: str = "closed_gate",
    api_host: str = "127.0.0.1",
    api_port: int = 27051,
    object_store_host: str = "127.0.0.1",
    object_store_port: int = 27061,
) -> ProcessSmokePlan:
    api_secret = os.getenv("API_WORKER_SHARED_SECRET", "execution-control-local-placeholder")
    structured_query_secret = _env_or_default(
        "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET",
        "execution-control-structured-query-local-placeholder",
    )
    api_base_url = f"http://{api_host}:{api_port}"
    common_env = {
        "PROMPT_RUNTIME_PROVIDER": "mock-runtime",
        "PROMPT_RUNTIME_MODEL": "gpt-5.5",
        "PROMPT_RUNTIME_API_KEY": "process-smoke-prompt-key",
        "PROMPT_STRICT_STRUCTURED_OUTPUTS": "true",
    }
    object_store_base_url = f"http://{object_store_host}:{object_store_port}"
    output_dir.mkdir(parents=True, exist_ok=True)
    runtime_config_path = _write_process_smoke_runtime_profile(
        repo_root=repo_root,
        output_dir=output_dir,
        profile=profile,
    )
    profile_api_env = _profile_resource_env(
        profile,
        object_store_base_url=object_store_base_url,
        structured_query_secret=structured_query_secret,
    )
    api_env = {
        **common_env,
        "API_AUTH_MODE": "trusted-worker",
        "API_WORKER_SHARED_SECRET": api_secret,
        "CAMPUS_AGENT_HTTP_HOST": api_host,
        "CAMPUS_AGENT_HTTP_PORT": str(api_port),
        "EXECUTION_CONTROL_RUNTIME_CONFIG_PATH": str(runtime_config_path),
        **_temporal_env(),
        **profile_api_env,
    }
    (
        execution_run_payload,
        expected_run_status,
        expected_run_body_tokens,
        execution_run_path,
        expected_readyz_statuses,
    ) = profile_execution_run_expectation(profile)
    processes = (
        ProcessCommandSpec(
            label="execution-control",
            command=("go", "run", "./cmd/execution-control"),
            cwd=repo_root / "apps" / "execution-control",
            env=api_env,
            log_path=output_dir / "execution-control.log",
        ),
    )
    if profile_requires_object_store(profile):
        processes = (
            ProcessCommandSpec(
                label="s3-smoke-object-store",
                command=(
                    "uv",
                    "run",
                    "--all-packages",
                    "python",
                    "-m",
                    "scripts.smoke_s3_object_store",
                    "--host",
                    object_store_host,
                    "--port",
                    str(object_store_port),
                ),
                cwd=repo_root,
                env={
                    "SMOKE_S3_BUCKET": "campus-rag-derived",
                    "SMOKE_S3_RESPONSE_BODY": _notice_smoke_body(),
                },
                log_path=output_dir / "s3-smoke-object-store.log",
            ),
            *processes,
        )
    return ProcessSmokePlan(
        repo_root=repo_root,
        output_dir=output_dir,
        profile=profile,
        api_base_url=api_base_url,
        execution_run_path=execution_run_path,
        execution_run_payload=execution_run_payload,
        expected_run_status=expected_run_status,
        expected_readyz_statuses=expected_readyz_statuses,
        expected_run_body_tokens=expected_run_body_tokens,
        processes=processes,
    )


def _write_process_smoke_runtime_profile(
    *,
    repo_root: Path,
    output_dir: Path,
    profile: str,
) -> Path:
    runtime_profile = {
        "schema_version": "campus_execution_control_runtime_profile.v1",
        "max_concurrent_answers": 8,
        "queue_capacity": 24,
        "queue_timeout_ms": 3000,
        "request_timeout_ms": 45000,
        "request_body_limit_bytes": 1048576,
        "shutdown_grace_ms": 45000,
        "intent_policy_path": str(repo_root / "configs/runtime/intent-policy.v1.json"),
        "provider_pricing_path": str(repo_root / "configs/runtime/provider-pricing.v1.json"),
        "query_serving_scopes_path": str(
            repo_root / "configs/runtime/query-serving-scopes.v1.json"
        ),
        "structured_query_timeout_ms": 1000,
        "open_capabilities": _profile_open_capabilities(profile),
        "multi_step_workflow_enabled": profile in MULTI_STEP_WORKFLOW_PROFILES,
        "otel": {
            "enabled": False,
            "endpoint": "http://127.0.0.1:4318/v1/traces",
            "metrics_enabled": False,
            "metrics_endpoint": "http://127.0.0.1:4318/v1/metrics",
            "service_name": "campus-execution-control-process-smoke",
            "export_timeout_ms": 1000,
            "export_interval_ms": 15000,
            "sample_ratio": 1,
            "allowed_attributes_version": "execution-control-otel-attrs-v1",
        },
        "execution_audit": {
            "enabled": False,
            "timeout_ms": 500,
        },
        "lane_budgets": {
            "rag": {"max_concurrent": 6, "queue_capacity": 12, "queue_timeout_ms": 3000},
            "navigation": {"max_concurrent": 2, "queue_capacity": 4, "queue_timeout_ms": 1500},
            "campus_services": {"max_concurrent": 2, "queue_capacity": 4, "queue_timeout_ms": 1500},
            "notice": {"max_concurrent": 2, "queue_capacity": 4, "queue_timeout_ms": 1500},
            "default": {"max_concurrent": 1, "queue_capacity": 2, "queue_timeout_ms": 1500},
        },
        "rag": {
            "top_k_max": 8,
            "selected_evidence_max": 8,
            "retrieval_max_concurrent": 4,
            "synthesis_max_concurrent": 2,
            "embedding_timeout_ms": 10000,
            "qdrant_timeout_ms": 10000,
            "provider_timeout_ms": 60000,
        },
        "personal_memory": {
            "collection": "personal_memory_v1",
            "top_k": 5,
            "max_chars": 1200,
            "score_threshold": 0,
        },
    }
    path = output_dir / f"runtime-profile.{profile}.json"
    path.write_text(
        json.dumps(runtime_profile, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    return path


def _profile_open_capabilities(profile: str) -> list[str]:
    if profile in campus_services_sdk_profiles() or profile in SELECTED_NOTICE_GUARDRAIL_PROFILES:
        return ["campus_services"]
    if profile == "notice_discover_sdk_opened":
        return ["notice"]
    if profile == "transport_notice_override_multistep":
        return ["campus_services"]
    return []


def _profile_resource_env(
    profile: str,
    *,
    object_store_base_url: str,
    structured_query_secret: str,
) -> dict[str, str]:
    if profile in campus_services_sdk_profiles():
        return {
            "EXECUTION_CONTROL_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339": (
                STRUCTURED_DIRECT_OPENED_TRUSTED_TIME
            ),
            "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET": structured_query_secret,
        }
    if profile == "notice_discover_sdk_opened":
        env = {
            "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET": structured_query_secret,
        }
        if profile_requires_object_store(profile):
            env.update(
                {
                    "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ENDPOINT": object_store_base_url,
                    "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ACCESS_KEY": "smoke-access-key",
                    "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_SECRET_KEY": "smoke-secret-key",
                    "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_BUCKET": "notice-body-smoke",
                }
            )
        return env
    if profile in MULTI_STEP_WORKFLOW_PROFILES:
        env = {
            "EXECUTION_CONTROL_WORKFLOW_RUN_AUTO_MIGRATE": "true",
            "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET": structured_query_secret,
            "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ENDPOINT": object_store_base_url,
            "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ACCESS_KEY": "smoke-access-key",
            "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_SECRET_KEY": "smoke-secret-key",
            "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_BUCKET": "notice-body-smoke",
        }
        if profile == "transport_notice_override_multistep":
            env["EXECUTION_CONTROL_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339"] = (
                TRANSPORT_NOTICE_OVERRIDE_TRUSTED_TIME
            )
        return env
    if profile in SELECTED_NOTICE_GUARDRAIL_PROFILES:
        return {
            "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET": structured_query_secret,
        }
    return {}


def _env_or_default(key: str, default: str) -> str:
    value = os.getenv(key, "").strip()
    return value or default


def _temporal_env() -> dict[str, str]:
    values = {
        key: os.getenv(key, "").strip()
        for key in (
            "EXECUTION_CONTROL_TEMPORAL_ADDRESS",
            "EXECUTION_CONTROL_TEMPORAL_NAMESPACE",
            "EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE",
            "EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY",
            "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT",
            "EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS",
        )
    }
    return {key: value for key, value in values.items() if value}


def _notice_smoke_body() -> str:
    return (
        "# 烟雾测试通知\n\n"
        "这是一条用于 notice direct runtime smoke 的通知正文。"
        "通知事项需要结合学生手册相关规定理解。\n"
    )


def run_process_smoke(
    plan: ProcessSmokePlan,
    *,
    timeout_seconds: float = 45.0,
    startup_timeout_seconds: float | None = None,
) -> dict[str, object]:
    plan.output_dir.mkdir(parents=True, exist_ok=True)
    started: list[subprocess.Popen[bytes]] = []
    log_files = []
    process_logs = {}
    runtime_preparation: _RuntimePreparation | None = None
    runtime_preparation_artifact: dict[str, object] = {}
    startup_timeout = max(
        timeout_seconds,
        startup_timeout_seconds
        if startup_timeout_seconds is not None
        else DEFAULT_STARTUP_TIMEOUT_SECONDS,
    )
    try:
        runtime_preparation = _prepare_process_smoke_runtime(
            plan,
            timeout_seconds=startup_timeout,
        )
        runtime_preparation_artifact = (
            runtime_preparation.artifact if runtime_preparation is not None else {}
        )
        processes = _processes_with_env_overlay(
            plan.processes,
            runtime_preparation.process_env_overlay if runtime_preparation is not None else {},
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
        api_healthz = wait_for_status(
            f"{plan.api_base_url}/healthz",
            expected_statuses={200},
            timeout_seconds=startup_timeout,
        )
        readyz = wait_for_json_status(
            f"{plan.api_base_url}/readyz",
            expected_statuses=set(plan.expected_readyz_statuses),
            timeout_seconds=startup_timeout,
        )
        metrics_status = _request_status(f"{plan.api_base_url}/metrics")
        run_status, run_body = post_execution_run_probe(
            f"{plan.api_base_url}{plan.execution_run_path}",
            plan.execution_run_payload,
            headers={
                "x-worker-origin-auth": process_by_label["execution-control"].env[
                    "API_WORKER_SHARED_SECRET"
                ]
            },
            timeout_seconds=timeout_seconds,
        )
        run_text = json.dumps(run_body, ensure_ascii=False)
        forbidden_body_tokens = _forbidden_body_tokens(plan.profile)
        passed = (
            api_healthz == 200
            and readyz[0] in plan.expected_readyz_statuses
            and metrics_status == 200
            and run_status == plan.expected_run_status
            and all(token in run_text for token in plan.expected_run_body_tokens)
            and not any(token in run_text for token in forbidden_body_tokens)
        )
        summary = {
            "schema_version": "execution_control_process_smoke.v1",
            "profile": plan.profile,
            "passed": passed,
            "api_base_url": plan.api_base_url,
            "processes": [process_spec_to_artifact(process) for process in processes],
            "process_logs": process_logs,
            "runtime_preparation": (runtime_preparation_artifact),
            "probes": {
                "api_healthz_status": api_healthz,
                "readyz_status": readyz[0],
                "readyz_body": readyz[1],
                "expected_readyz_statuses": plan.expected_readyz_statuses,
                "metrics_status": metrics_status,
                "execution_run_status": run_status,
                "expected_execution_run_status": plan.expected_run_status,
                "execution_run_path": plan.execution_run_path,
                "startup_timeout_seconds": startup_timeout,
                "execution_run_timeout_seconds": timeout_seconds,
                "expected_run_body_tokens": plan.expected_run_body_tokens,
                "forbidden_body_tokens": forbidden_body_tokens,
            },
            "execution_run": run_body,
        }
    except Exception as exc:
        process_exit_states = {
            spec.label: (process.poll() if process.poll() is not None else "running")
            for spec, process in zip(plan.processes, started, strict=False)
        }
        summary = {
            "schema_version": "execution_control_process_smoke.v1",
            "profile": plan.profile,
            "passed": False,
            "api_base_url": plan.api_base_url,
            "process_logs": process_logs,
            "runtime_preparation": runtime_preparation_artifact,
            "process_exit_states": process_exit_states,
            "error": str(exc),
        }
    finally:
        terminate_processes(started)
        for log_file in log_files:
            log_file.close()
        if runtime_preparation is not None:
            runtime_preparation.cleanup()
    (plan.output_dir / "process-smoke-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, default=str) + "\n",
        encoding="utf-8",
    )
    return summary


def _forbidden_body_tokens(profile: str) -> tuple[str, ...]:
    if profile in {
        "rag_delegate",
        "rag_delegate_sdk_candidate",
        "rag_delegate_institutional_rules",
    }:
        return ("retrieval_failed", '"status": "no_answer"')
    if profile in RAG_RETRIEVAL_PROFILES:
        return ("retrieval_failed",)
    return ()


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Run execution-control local process smoke.")
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--profile", default="closed_gate")
    parser.add_argument("--api-port", type=int, default=27051)
    parser.add_argument("--object-store-port", type=int, default=27061)
    parser.add_argument("--timeout-seconds", type=float, default=45.0)
    parser.add_argument(
        "--startup-timeout-seconds",
        type=float,
        default=None,
        help=(
            "Maximum time to wait for local processes and /readyz. "
            "Defaults to at least 180 seconds so cold go run builds do not "
            "fail the runtime path smoke."
        ),
    )
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    args = build_parser().parse_args(list(argv) if argv is not None else None)
    repo_root = Path(__file__).resolve().parents[1]
    plan = build_process_smoke_plan(
        repo_root=repo_root,
        output_dir=Path(args.output_dir),
        profile=args.profile,
        api_port=args.api_port,
        object_store_port=args.object_store_port,
    )
    summary = run_process_smoke(
        plan,
        timeout_seconds=args.timeout_seconds,
        startup_timeout_seconds=args.startup_timeout_seconds,
    )
    print(json.dumps(summary, ensure_ascii=False, default=str))
    return 0 if summary.get("passed") is True else 1


if __name__ == "__main__":
    raise SystemExit(main())
