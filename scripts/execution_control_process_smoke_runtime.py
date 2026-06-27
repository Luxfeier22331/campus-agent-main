from __future__ import annotations

import json
import os
import re
import time
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlparse, urlunparse

from campus_ingestion_core.postgres_runtime import close_persistent_postgres_pools
from campus_ingestion_core.structured_projection_postgres import (
    build_structured_projection_publisher_from_env,
    projection_artifact_checksum,
)

from scripts.execution_control_process_smoke_models import (
    ProcessCommandSpec,
    ProcessSmokePlan,
)
from scripts.execution_control_process_smoke_profiles import (
    TOOL_READ_MODEL_OPENED_TRUSTED_TIME,
    TRANSPORT_NOTICE_OVERRIDE_TRUSTED_TIME,
    profile_requires_notice_read_model,
    profile_requires_temporary_postgres,
    profile_requires_tool_read_model_projection,
    profile_requires_workflow_run_store,
)


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
    if not profile_requires_temporary_postgres(plan.profile):
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
    seed_log_path = plan.output_dir / "tool-read-model-projection-seed.log"
    cleanup = _create_temporary_postgres_database(management_url, database_name)
    env_overlay: dict[str, str] = {}
    artifacts: list[dict[str, object]] = []
    try:
        if profile_requires_tool_read_model_projection(plan.profile):
            selected_collections = _tool_read_model_projection_seed_collections(plan.profile)
            trusted_time = _profile_trusted_time(plan.profile)
            _seed_tool_read_model_projection_smoke(
                repo_root=plan.repo_root,
                runtime_database_url=runtime_database_url,
                log_path=seed_log_path,
                timeout_seconds=timeout_seconds,
                collections=selected_collections,
                generated_at=trusted_time,
            )
            env_overlay["CAMPUS_SHARED_POSTGRES_URL"] = runtime_database_url
            env_overlay["EXECUTION_CONTROL_TOOL_READ_MODEL_TRUSTED_TIME_RFC3339"] = trusted_time
            artifacts.append(
                {
                    "kind": "temporary_postgres_tool_read_model_projection",
                    "seed_log_path": str(seed_log_path),
                    "trusted_time": trusted_time,
                    "collections": list(selected_collections),
                }
            )
        if profile_requires_notice_read_model(plan.profile):
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
        env_overlay["EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL"] = runtime_database_url
        env_overlay["EXECUTION_CONTROL_RUN_PROJECTION_AUTO_MIGRATE"] = "true"
        artifacts.append(
            {
                "kind": "temporary_postgres_execution_projection_store",
                "schema": "runtime.agent_runs",
            }
        )
        if profile_requires_workflow_run_store(plan.profile):
            env_overlay["EXECUTION_CONTROL_WORKFLOW_RUN_DATABASE_URL"] = runtime_database_url
            env_overlay["EXECUTION_CONTROL_WORKFLOW_RUN_AUTO_MIGRATE"] = "true"
            artifacts.append(
                {
                    "kind": "temporary_postgres_workflow_run_store",
                    "schema": "runtime.workflow_runs",
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
        raise RuntimeError("psycopg is required for tool read-model process smoke") from exc

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


def _seed_tool_read_model_projection_smoke(
    *,
    repo_root: Path,
    runtime_database_url: str,
    log_path: Path,
    timeout_seconds: float,
    collections: Sequence[str],
    generated_at: str,
) -> None:
    log_path.parent.mkdir(parents=True, exist_ok=True)
    publisher = build_structured_projection_publisher_from_env(
        {"CAMPUS_SHARED_POSTGRES_URL": runtime_database_url},
        bootstrap_collections=collections,
    )
    if publisher is None:
        raise ValueError("CAMPUS_SHARED_POSTGRES_URL is required")
    reports = {}
    try:
        for collection in collections:
            bundle = _tool_read_model_projection_smoke_bundles()[collection]
            corpus = "calendar" if collection == "academic_calendar" else "campus_services"
            release_id = f"execution-control-process-smoke-{collection.replace('_', '-')}"
            report = publisher.publish_release(
                corpus=corpus,
                collection=collection,
                release_id=release_id,
                generated_at=generated_at,
                schema_version=str(bundle["schema_version"]),
                artifact_object_key=(
                    f"campus_services/releases/{collection}/"
                    f"{release_id}/tool-read-model-projection-smoke.json"
                ),
                artifact_checksum=projection_artifact_checksum(bundle),
                bundle=bundle,
                validation_status="smoke_valid",
            )
            current_release_id = publisher.get_current_release(
                corpus=corpus,
                collection=collection,
            )
            if current_release_id != release_id:
                raise RuntimeError(
                    f"{collection} tool read-model projection smoke current release = "
                    f"{current_release_id}, want {release_id}"
                )
            reports[collection] = {
                "release_id": report.release_id,
                "counts": report.counts,
            }
    finally:
        close_persistent_postgres_pools()
    log_path.write_text(
        json.dumps(
            {
                "status": "ok",
                "corpus": "campus_services",
                "collections": list(collections),
                "releases": reports,
            },
            ensure_ascii=False,
            indent=2,
            sort_keys=True,
        )
        + "\n",
        encoding="utf-8",
    )


def _tool_read_model_projection_seed_collections(profile: str) -> tuple[str, ...]:
    if profile == "transport_notice_override_multistep":
        return ("transport_schedule",)
    if (
        profile == "transport_schedule_sdk_opened"
        or profile == "transport_schedule_sdk_opened_stream"
    ):
        return ("transport_schedule",)
    return ("transport_schedule",)


def _profile_trusted_time(profile: str) -> str:
    if profile == "transport_notice_override_multistep":
        return TRANSPORT_NOTICE_OVERRIDE_TRUSTED_TIME
    return TOOL_READ_MODEL_OPENED_TRUSTED_TIME


def _tool_read_model_projection_smoke_bundles() -> dict[str, dict[str, object]]:
    return {
        "transport_schedule": _smoke_transport_schedule_bundle(),
    }


def _smoke_transport_schedule_bundle() -> dict[str, object]:
    return {
        "schema_version": "campus_services_projection_bundle.v1",
        "transport_schedule_snapshots": [
            {
                "snapshot_id": "snapshot:bus:smoke-2026-04-20",
                "published_at": "2026-04-20T18:00:00+08:00",
                "effective_from": "2026-04-21T00:00:00+08:00",
                "source_ref": "smoke:transport-schedule",
                "is_current": True,
                "schedule_scope": "baseline_revision",
            }
        ],
        "transport_routes": [
            {
                "route_id": "route:haidian-to-fengtai",
                "display_name": "海淀到丰台通勤车",
                "service_family": "intercampus_commute",
                "aliases": ["校车", "通勤车"],
                "origin_campus": "haidian",
                "destination_campus": "fengtai",
                "stops": [
                    {"stop_id": "stop:haidian-east-gate", "display_name": "海淀东门"},
                    {"stop_id": "stop:fengtai-main-gate", "display_name": "丰台南门"},
                ],
            },
            {
                "route_id": "route:fengtai-to-haidian",
                "display_name": "丰台到海淀通勤车",
                "service_family": "intercampus_commute",
                "aliases": ["回海淀", "海淀线"],
                "origin_campus": "fengtai",
                "destination_campus": "haidian",
                "stops": [
                    {"stop_id": "stop:fengtai-main-gate", "display_name": "丰台南门"},
                    {"stop_id": "stop:haidian-east-gate", "display_name": "海淀东门"},
                ],
            },
        ],
        "scheduled_departures": [
            {
                "snapshot_id": "snapshot:bus:smoke-2026-04-20",
                "route_id": "route:haidian-to-fengtai",
                "service_dates": ["2026-04-25"],
                "departure_time": "06:50",
                "arrival_time": "08:05",
                "origin_stop_id": "stop:haidian-east-gate",
                "destination_stop_id": "stop:fengtai-main-gate",
                "related_notice_refs": ["smoke:transport-schedule"],
            },
            {
                "snapshot_id": "snapshot:bus:smoke-2026-04-20",
                "route_id": "route:fengtai-to-haidian",
                "service_dates": ["2026-05-07"],
                "departure_time": "07:30",
                "arrival_time": "08:30",
                "origin_stop_id": "stop:fengtai-main-gate",
                "destination_stop_id": "stop:haidian-east-gate",
                "related_notice_refs": ["smoke:transport-schedule"],
            },
        ],
        "transport_service_exceptions": [],
        "transport_operational_notices": [
            {
                "notice_id": "353903",
                "source_ref": "notice:353903",
                "notice_kind": "boarding_point_change",
                "route_ids": ["route:fengtai-to-haidian"],
                "effective_from": "2026-05-07T00:00:00+08:00",
                "effective_until": "",
                "operational_comment": "丰台校区乘车点调整至南门外停车区",
            }
        ],
    }


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
        projection_updated_at=TOOL_READ_MODEL_OPENED_TRUSTED_TIME,
        updated_at=TOOL_READ_MODEL_OPENED_TRUSTED_TIME,
    )
    restricted_record = InternalNoticeReadModelEntry(
        source_family="internal_notice_restricted",
        source_corpus="campus_notices",
        source_collection="internal_notice",
        source_notice_id="notice:transport:355122",
        unit_id="notice_unit:transport:355122:body",
        primary_role="notice_window",
        target_surface="notice_level_query",
        consumption_status="ready",
        queryable=True,
        title="关于两校区学生通勤班车增加班次的通知",
        visibility_level="restricted",
        entitlement_groups=("students",),
        policy_projection_version="phase1-authorization-projection-v1",
        published_at="2026-03-18T08:00:00+08:00",
        source_url="https://example.invalid/notices/355122",
        canonical_url="https://example.invalid/notices/355122",
        canonical_document_id="doc:transport-notice-355122",
        canonical_markdown_object_key=(
            "campus_notices/documents/internal_notice/355122/canonical.md"
        ),
        body_excerpt="自 3 月 18 日起增加若干学生通勤班车班次。",
        search_text="两校区学生通勤班车 增加班次 班车通知 355122",
        projection_updated_at=TOOL_READ_MODEL_OPENED_TRUSTED_TIME,
        updated_at=TOOL_READ_MODEL_OPENED_TRUSTED_TIME,
    )
    transport_override_record = InternalNoticeReadModelEntry(
        source_family="internal_notice_restricted",
        source_corpus="campus_notices",
        source_collection="internal_notice",
        source_notice_id="353903",
        unit_id="notice_unit:transport:353903:body",
        primary_role="notice_window",
        target_surface="campus_services/service_status_candidate",
        consumption_status="ready",
        queryable=True,
        title="关于通勤班车丰台校区乘车点调整的通知",
        visibility_level="restricted",
        entitlement_groups=("students",),
        policy_projection_version="phase1-authorization-projection-v1",
        published_at="2026-01-01T08:00:00+08:00",
        source_url="https://portal.example.edu/notices/353903",
        canonical_url="https://portal.example.edu/notices/353903",
        canonical_document_id="doc:transport-notice-353903",
        canonical_markdown_object_key=(
            "campus_notices/documents/internal_notice/353903/canonical.md"
        ),
        body_excerpt="通勤班车丰台校区乘车点调整至南门外停车区。",
        search_text="丰台到海淀通勤车 乘车点 调整 丰台校区 南门外停车区 353903",
        projection_updated_at=TOOL_READ_MODEL_OPENED_TRUSTED_TIME,
        updated_at=TOOL_READ_MODEL_OPENED_TRUSTED_TIME,
    )
    store.upsert_many((record, restricted_record, transport_override_record))
    log_path.write_text(
        json.dumps(
            {
                "status": "ok",
                "table": store.table_name,
                "notice_ids": [
                    record.source_notice_id,
                    restricted_record.source_notice_id,
                    transport_override_record.source_notice_id,
                ],
                "source_families": [
                    record.source_family,
                    restricted_record.source_family,
                    transport_override_record.source_family,
                ],
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
    target_labels: tuple[str, ...] = ("execution-control",),
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
