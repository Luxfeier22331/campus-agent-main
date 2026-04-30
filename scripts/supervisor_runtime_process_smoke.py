from __future__ import annotations

import argparse
import json
import os
import re
import signal
import subprocess
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse, urlunparse

STRUCTURED_DIRECT_OPENED_TRUSTED_TIME = "2026-04-24T20:30:00+08:00"


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
    answer_path: str
    answer_response_kind: str
    answer_payload: dict[str, object]
    expected_status: int
    expected_readyz_statuses: tuple[int, ...]
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
    object_store_host: str = "127.0.0.1",
    object_store_port: int = 18082,
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
    object_store_base_url = f"http://{object_store_host}:{object_store_port}"
    profile_api_env = _profile_api_env(profile, object_store_base_url=object_store_base_url)
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
        **profile_api_env,
    }
    (
        answer_payload,
        expected_status,
        expected_body_tokens,
        answer_path,
        answer_response_kind,
        expected_readyz_statuses,
    ) = _profile_answer_expectation(profile)
    processes = (
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
    )
    if _profile_requires_object_store(profile):
        processes = (
            processes[0],
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
            processes[1],
        )
    return ProcessSmokePlan(
        repo_root=repo_root,
        output_dir=output_dir,
        profile=profile,
        api_base_url=api_base_url,
        worker_base_url=worker_base_url,
        answer_path=answer_path,
        answer_response_kind=answer_response_kind,
        answer_payload=answer_payload,
        expected_status=expected_status,
        expected_readyz_statuses=expected_readyz_statuses,
        expected_body_tokens=expected_body_tokens,
        processes=processes,
    )


def _profile_answer_expectation(
    profile: str,
) -> tuple[dict[str, object], int, tuple[str, ...], str, str, tuple[int, ...]]:
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
            "/api/v1/answer",
            "json",
            (200,),
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
            "/api/v1/answer",
            "json",
            (200,),
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
            "/api/v1/answer",
            "json",
            (200,),
        )
    if profile == "structured_direct_opened":
        return (
            {
                "user_goal": "我明天早上要去丰台上课，最早的班车是几点",
                "request_id": "process-smoke-structured-direct-opened",
                "requested_capability": "campus_services",
                "context": context,
            },
            200,
            (
                "campus-services-agent",
                "transport_schedule_lookup",
                "resolved_current",
                "direct_runtime",
                "agent_execution_projection",
                "result_guardrail",
            ),
            "/api/v1/answer",
            "json",
            (200,),
        )
    if profile == "structured_direct_opened_stream":
        return (
            {
                "user_goal": "我明天早上要去丰台上课，最早的班车是几点",
                "request_id": "process-smoke-structured-direct-opened-stream",
                "requested_capability": "campus_services",
                "context": context,
            },
            200,
            (
                "event: execution.completed",
                "campus-services-agent",
                "transport_schedule_lookup",
                "resolved_current",
                "direct_runtime",
                "agent_execution_projection",
                "result_guardrail",
            ),
            "/api/v1/answer/stream",
            "sse",
            (200,),
        )
    if profile == "notice_get_direct_opened":
        notice_context = {
            **context,
            "session": {
                "selected_notice_ref": {
                    "notice_id": "notice:smoke:001",
                    "source_family": "wechat_public_notice",
                    "title": "烟雾测试通知",
                },
                "turn_count": 2,
            },
        }
        return (
            {
                "user_goal": "这条通知详情",
                "request_id": "process-smoke-notice-get-direct-opened",
                "requested_capability": "notice",
                "context": notice_context,
            },
            200,
            (
                "notice-agent",
                "campus_notice_get",
                "resolved_current",
                "烟雾测试通知",
                "direct_runtime",
                "agent_execution_projection",
                "result_guardrail",
            ),
            "/api/v1/answer",
            "json",
            (200,),
        )
    raise ValueError(f"unsupported process smoke profile: {profile}")


def _profile_api_env(profile: str, *, object_store_base_url: str) -> dict[str, str]:
    if profile in {"structured_direct_opened", "structured_direct_opened_stream"}:
        return {
            "SUPERVISOR_API_OPEN_CAPABILITIES": "campus_services",
            "SUPERVISOR_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339": (
                STRUCTURED_DIRECT_OPENED_TRUSTED_TIME
            ),
        }
    if profile == "notice_get_direct_opened":
        return {
            "SUPERVISOR_API_OPEN_CAPABILITIES": "notice",
            "OBJECT_STORE_ENDPOINT": object_store_base_url,
            "OBJECT_STORE_ACCESS_KEY": "smoke-access-key",
            "OBJECT_STORE_SECRET_KEY": "smoke-secret-key",
            "OBJECT_STORE_BUCKET_DERIVED": "campus-rag-derived",
        }
    return {}


def _profile_requires_object_store(profile: str) -> bool:
    return profile == "notice_get_direct_opened"


def _profile_requires_structured_projection(profile: str) -> bool:
    return profile in {"structured_direct_opened", "structured_direct_opened_stream"}


def _profile_requires_notice_read_model(profile: str) -> bool:
    return profile == "notice_get_direct_opened"


def _profile_requires_temporary_postgres(profile: str) -> bool:
    return _profile_requires_structured_projection(profile) or _profile_requires_notice_read_model(
        profile
    )


def _notice_smoke_body() -> str:
    return "# 烟雾测试通知\n\n这是一条用于 notice-agent direct runtime smoke 的通知正文。\n"


def run_process_smoke(
    plan: ProcessSmokePlan, *, timeout_seconds: float = 45.0
) -> dict[str, object]:
    plan.output_dir.mkdir(parents=True, exist_ok=True)
    started: list[subprocess.Popen[bytes]] = []
    log_files = []
    process_logs = {}
    runtime_preparation: _RuntimePreparation | None = None
    try:
        runtime_preparation = _prepare_process_smoke_runtime(plan, timeout_seconds=timeout_seconds)
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
                )
            )
        worker_healthz = _wait_for_status(
            f"{plan.worker_base_url}/internal/bridge/healthz",
            expected_statuses={200},
            timeout_seconds=timeout_seconds,
            headers={
                "x-supervisor-bridge-auth": process_by_label["supervisor-agent-worker"].env[
                    "SUPERVISOR_AGENT_WORKER_SHARED_SECRET"
                ]
            },
        )
        api_healthz = _wait_for_status(
            f"{plan.api_base_url}/healthz",
            expected_statuses={200},
            timeout_seconds=timeout_seconds,
        )
        readyz = _wait_for_json_status(
            f"{plan.api_base_url}/readyz",
            expected_statuses=set(plan.expected_readyz_statuses),
            timeout_seconds=timeout_seconds,
        )
        metrics_status = _request_status(f"{plan.api_base_url}/metrics")
        answer_status, answer_body = _post_answer_probe(
            f"{plan.api_base_url}{plan.answer_path}",
            plan.answer_payload,
            response_kind=plan.answer_response_kind,
            headers={
                "x-worker-origin-auth": process_by_label["supervisor-api"].env[
                    "API_WORKER_SHARED_SECRET"
                ]
            },
            timeout_seconds=timeout_seconds,
        )
        answer_text = json.dumps(answer_body, ensure_ascii=False)
        passed = (
            worker_healthz == 200
            and api_healthz == 200
            and readyz[0] in plan.expected_readyz_statuses
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
            "processes": [process_spec_to_artifact(process) for process in processes],
            "process_logs": process_logs,
            "runtime_preparation": (
                runtime_preparation.artifact if runtime_preparation is not None else {}
            ),
            "probes": {
                "worker_healthz_status": worker_healthz,
                "api_healthz_status": api_healthz,
                "readyz_status": readyz[0],
                "expected_readyz_statuses": plan.expected_readyz_statuses,
                "metrics_status": metrics_status,
                "answer_status": answer_status,
                "expected_answer_status": plan.expected_status,
                "answer_path": plan.answer_path,
                "answer_response_kind": plan.answer_response_kind,
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
        if runtime_preparation is not None:
            runtime_preparation.cleanup()
    (plan.output_dir / "process-smoke-summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, default=str) + "\n",
        encoding="utf-8",
    )
    return summary


@dataclass(frozen=True, slots=True)
class _RuntimePreparation:
    process_env_overlay: dict[str, str]
    artifact: dict[str, object]
    cleanup: Callable[[], None]


def _prepare_process_smoke_runtime(
    plan: ProcessSmokePlan,
    *,
    timeout_seconds: float,
) -> _RuntimePreparation | None:
    if not _profile_requires_temporary_postgres(plan.profile):
        return None
    base_database_url = _process_smoke_base_postgres_url(plan.repo_root)
    if not base_database_url:
        raise RuntimeError(
            f"{plan.profile} process smoke requires CAMPUS_SHARED_POSTGRES_URL "
            "in the shell environment or repo root .env"
        )
    database_name = _temporary_process_smoke_database_name()
    management_url = _postgres_url_with_database(base_database_url, "postgres")
    runtime_database_url = _postgres_url_with_database(base_database_url, database_name)
    seed_log_path = plan.output_dir / "structured-projection-seed.log"
    cleanup = _create_temporary_postgres_database(management_url, database_name)
    env_overlay: dict[str, str] = {}
    artifacts: list[dict[str, object]] = []
    try:
        if _profile_requires_structured_projection(plan.profile):
            _seed_structured_projection_smoke(
                repo_root=plan.repo_root,
                runtime_database_url=runtime_database_url,
                log_path=seed_log_path,
                timeout_seconds=timeout_seconds,
            )
            env_overlay["CAMPUS_SHARED_POSTGRES_URL"] = runtime_database_url
            env_overlay["SUPERVISOR_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339"] = (
                STRUCTURED_DIRECT_OPENED_TRUSTED_TIME
            )
            artifacts.append(
                {
                    "kind": "temporary_postgres_structured_projection",
                    "seed_log_path": str(seed_log_path),
                    "trusted_time": STRUCTURED_DIRECT_OPENED_TRUSTED_TIME,
                }
            )
        if _profile_requires_notice_read_model(plan.profile):
            notice_seed_log_path = plan.output_dir / "notice-read-model-seed.log"
            _seed_notice_read_model_smoke(
                runtime_database_url=runtime_database_url,
                log_path=notice_seed_log_path,
            )
            env_overlay["INTERNAL_NOTICE_READ_MODEL_DATABASE_URL"] = runtime_database_url
            artifacts.append(
                {
                    "kind": "temporary_postgres_notice_read_model",
                    "seed_log_path": str(notice_seed_log_path),
                    "notice_id": "notice:smoke:001",
                }
            )
    except Exception:
        cleanup()
        raise
    return _RuntimePreparation(
        process_env_overlay=env_overlay,
        artifact={
            "kind": "temporary_postgres_runtime",
            "database_name": database_name,
            "seed_artifacts": artifacts,
        },
        cleanup=cleanup,
    )


def _process_smoke_base_postgres_url(repo_root: Path) -> str:
    value = os.getenv("CAMPUS_SHARED_POSTGRES_URL", "").strip()
    if value:
        return value
    return _root_env_value(repo_root, "CAMPUS_SHARED_POSTGRES_URL")


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


def _temporary_process_smoke_database_name() -> str:
    suffix = f"{int(time.time() * 1000)}_{os.getpid()}"
    return _sanitize_postgres_database_name(f"campus_agent_process_smoke_{suffix}")


def _sanitize_postgres_database_name(value: str) -> str:
    normalized = re.sub(r"[^a-zA-Z0-9_]", "_", value).lower().strip("_")
    if not normalized:
        normalized = "campus_agent_process_smoke"
    if not re.match(r"^[a-z_]", normalized):
        normalized = f"smoke_{normalized}"
    return normalized[:63]


def _postgres_url_with_database(database_url: str, database_name: str) -> str:
    parsed = urlparse(database_url)
    if parsed.scheme not in {"postgres", "postgresql"}:
        raise ValueError("CAMPUS_SHARED_POSTGRES_URL must be a postgres/postgresql URL")
    return urlunparse(parsed._replace(path=f"/{database_name}"))


def _create_temporary_postgres_database(management_url: str, database_name: str):
    try:
        import psycopg
        from psycopg import sql
    except ImportError as exc:  # pragma: no cover
        raise RuntimeError("psycopg is required for structured_direct_opened smoke") from exc

    with (
        psycopg.connect(management_url, autocommit=True) as connection,
        connection.cursor() as cursor,
    ):
        _drop_temporary_postgres_database(cursor, database_name, sql)
        cursor.execute(sql.SQL("create database {}").format(sql.Identifier(database_name)))

    cleaned = False

    def cleanup() -> None:
        nonlocal cleaned
        if cleaned:
            return
        cleaned = True
        try:
            with (
                psycopg.connect(management_url, autocommit=True) as connection,
                connection.cursor() as cursor,
            ):
                _drop_temporary_postgres_database(cursor, database_name, sql)
        except Exception:
            return

    return cleanup


def _drop_temporary_postgres_database(cursor: object, database_name: str, sql: object) -> None:
    cursor.execute(
        """
        select pg_terminate_backend(pid)
        from pg_stat_activity
        where datname = %s and pid <> pg_backend_pid()
        """,
        (database_name,),
    )
    cursor.execute(sql.SQL("drop database if exists {}").format(sql.Identifier(database_name)))


def _seed_structured_projection_smoke(
    *,
    repo_root: Path,
    runtime_database_url: str,
    log_path: Path,
    timeout_seconds: float,
) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    with log_path.open("ab") as log_file:
        subprocess.run(
            (
                "uv",
                "run",
                "--all-packages",
                "campus-ingestion-smoke-structured-projection-postgres",
                "--release-id",
                "supervisor-runtime-process-smoke",
                "--generated-at",
                STRUCTURED_DIRECT_OPENED_TRUSTED_TIME,
            ),
            cwd=repo_root,
            env={**os.environ, "CAMPUS_SHARED_POSTGRES_URL": runtime_database_url},
            stdout=log_file,
            stderr=subprocess.STDOUT,
            check=True,
            timeout=max(10.0, timeout_seconds),
        )


def _seed_notice_read_model_smoke(
    *,
    runtime_database_url: str,
    log_path: Path,
) -> None:
    from campus_ingestion_core.internal_notice_read_model import (
        InternalNoticeReadModelEntry,
        PostgresInternalNoticeReadModelStore,
    )

    log_path.parent.mkdir(parents=True, exist_ok=True)
    store = PostgresInternalNoticeReadModelStore(runtime_database_url)
    record = InternalNoticeReadModelEntry(
        source_family="wechat_public_notice",
        source_corpus="campus_notices",
        source_collection="internal_notice",
        source_notice_id="notice:smoke:001",
        unit_id="notice_unit:smoke:001:body",
        primary_role="notice_window",
        target_surface="notice_level_query",
        consumption_status="ready",
        queryable=True,
        title="烟雾测试通知",
        visibility_level="public",
        entitlement_groups=(),
        policy_projection_version="phase1-authorization-projection-v1",
        published_at="2026-04-24T20:00:00+08:00",
        source_url="https://example.invalid/notices/smoke",
        canonical_url="https://example.invalid/notices/smoke",
        canonical_document_id="doc:smoke-notice",
        canonical_markdown_object_key=(
            "campus_notices/documents/wechat_public_notice/smoke/canonical.md"
        ),
        body_excerpt="烟雾测试通知正文摘要。",
        search_text="烟雾测试通知 通知详情 原文",
        projection_updated_at=STRUCTURED_DIRECT_OPENED_TRUSTED_TIME,
        updated_at=STRUCTURED_DIRECT_OPENED_TRUSTED_TIME,
    )
    store.upsert_many((record,))
    log_path.write_text(
        json.dumps(
            {
                "status": "ok",
                "table": store.table_name,
                "notice_id": record.source_notice_id,
                "source_family": record.source_family,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )


def _processes_with_env_overlay(
    processes: tuple[ProcessCommandSpec, ...],
    env_overlay: dict[str, str],
    target_labels: tuple[str, ...] = ("supervisor-api",),
) -> tuple[ProcessCommandSpec, ...]:
    if not env_overlay:
        return processes
    targets = set(target_labels)
    return tuple(
        ProcessCommandSpec(
            label=process.label,
            command=process.command,
            cwd=process.cwd,
            env={**process.env, **env_overlay} if process.label in targets else process.env,
            log_path=process.log_path,
        )
        for process in processes
    )


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
    if any(
        token in normalized
        for token in (
            "SECRET",
            "TOKEN",
            "API_KEY",
            "ACCESS_KEY",
            "DATABASE_URL",
            "POSTGRES_URL",
        )
    ):
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


def _wait_for_json_status(
    url: str,
    *,
    expected_statuses: set[int],
    timeout_seconds: float,
) -> tuple[int, object]:
    deadline = time.monotonic() + timeout_seconds
    last_response: tuple[int, object] = (0, {})
    while time.monotonic() < deadline:
        last_response = _request_json(url)
        if last_response[0] in expected_statuses:
            return last_response
        time.sleep(0.5)
    raise RuntimeError(f"timed out waiting for {url}; last_status={last_response[0]}")


def _post_answer_probe(
    url: str,
    payload: dict[str, object],
    *,
    response_kind: str,
    headers: dict[str, str],
    timeout_seconds: float,
) -> tuple[int, object]:
    if response_kind == "sse":
        return _post_sse(url, payload, headers=headers, timeout_seconds=timeout_seconds)
    if response_kind == "json":
        return _post_json(url, payload, headers=headers, timeout_seconds=timeout_seconds)
    raise ValueError(f"unsupported answer response kind: {response_kind}")


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


def _post_sse(
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
            return int(response.status), _parse_sse_response(response.read())
    except urllib.error.HTTPError as exc:
        return int(exc.code), _parse_sse_response(exc.read())


def _parse_sse_response(raw_body: bytes) -> dict[str, object]:
    body_text = raw_body.decode("utf-8", errors="replace")
    events: list[dict[str, object]] = []
    event_name = "message"
    data_lines: list[str] = []
    for line in body_text.splitlines():
        if line == "":
            if data_lines:
                events.append(_sse_event(event_name, "\n".join(data_lines)))
            event_name = "message"
            data_lines = []
            continue
        if line.startswith("event:"):
            event_name = line.removeprefix("event:").strip() or "message"
        elif line.startswith("data:"):
            data_lines.append(line.removeprefix("data:").strip())
    if data_lines:
        events.append(_sse_event(event_name, "\n".join(data_lines)))
    return {
        "kind": "sse",
        "body_text": body_text,
        "events": events,
    }


def _sse_event(event_name: str, data_text: str) -> dict[str, object]:
    try:
        data: object = json.loads(data_text)
    except json.JSONDecodeError:
        data = data_text
    return {
        "event": event_name,
        "data": data,
    }


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
