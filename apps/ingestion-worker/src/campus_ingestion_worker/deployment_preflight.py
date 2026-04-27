from __future__ import annotations

import argparse
import json
import os
import platform
import shutil
import sys
from collections.abc import Mapping, Sequence
from pathlib import Path
from typing import Any

from campus_ingestion_core.object_store import S3ObjectStoreClientFactory
from campus_ingestion_core.postgres_runtime import (
    build_operator_postgres_connection_url,
    open_postgres_connection,
    validate_persistent_postgres_runtime_url,
)
from campus_ingestion_core.settings import ObjectStoreSettings

from campus_ingestion_worker.env_bootstrap import load_worker_env
from campus_ingestion_worker.resource_profile import utc_now_iso

PREFLIGHT_SCHEMA_VERSION = "campus_ingestion_worker_deployment_preflight.v1"

SUPPORTED_BATCH_KINDS = (
    "internal-notice-multimodal-drain",
    "official-web-handoffs",
    "authenticated-notice-closeout",
    "wechat-public-notices",
)

SHARED_POSTGRES_KEY = "CAMPUS_SHARED_POSTGRES_URL"
OPERATOR_POSTGRES_KEY = "CAMPUS_SHARED_POSTGRES_OPERATOR_URL"
LEGACY_OPERATOR_POSTGRES_KEY = "CAMPUS_SHARED_POSTGRES_MANAGEMENT_URL"


def run_deployment_preflight(
    *,
    batch_kinds: Sequence[str],
    env: Mapping[str, str] | None = None,
    live: bool = False,
    lock_dir: Path | str = ".tmp/ingestion-locks",
    report_dir: Path | str = ".tmp/ingestion-reports",
) -> dict[str, Any]:
    source = dict(os.environ if env is None else env)
    normalized_batch_kinds = _normalize_batch_kinds(batch_kinds)
    checks: list[dict[str, Any]] = [
        _passed(
            "python_runtime",
            f"Python {platform.python_version()} on {platform.system().lower() or 'unknown'}",
            details={"executable": sys.executable},
        ),
        _check_writable_dir(name="report_dir_writable", path=Path(report_dir)),
        _check_writable_dir(name="lock_dir_writable", path=Path(lock_dir)),
        _check_postgres_config(source),
        _check_object_store_config(source),
        _check_batch_resource_policy(source),
        _check_report_retention_policy(source),
    ]
    checks.extend(_check_batch_specific_dirs(normalized_batch_kinds, source))
    checks.extend(_check_batch_specific_env(normalized_batch_kinds, source))
    checks.append(_check_optional_docker_runtime())
    if live:
        checks.extend(_run_live_checks(source))
    else:
        checks.append(
            _skipped(
                "live_connectivity", "Skipped live DB/object-store probes; pass --live to run them."
            )
        )

    status = "failed" if any(check["status"] == "failed" for check in checks) else "passed"
    return {
        "schema_version": PREFLIGHT_SCHEMA_VERSION,
        "status": status,
        "checked_at": utc_now_iso(),
        "batch_kinds": list(normalized_batch_kinds),
        "live": bool(live),
        "report_dir": str(Path(report_dir)),
        "lock_dir": str(Path(lock_dir)),
        "checks": checks,
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Preflight ingestion-worker deployment env, directories, and optional live dependencies."
    )
    parser.add_argument(
        "--batch-kind",
        action="append",
        choices=SUPPORTED_BATCH_KINDS,
        dest="batch_kinds",
        help="Batch kind to preflight. Repeatable. Defaults to internal-notice-multimodal-drain.",
    )
    parser.add_argument("--live", action="store_true", help="Probe Postgres and object storage.")
    parser.add_argument(
        "--report-dir",
        default=os.getenv("INGESTION_ON_DEMAND_REPORT_DIR", ".tmp/ingestion-reports"),
    )
    parser.add_argument(
        "--lock-dir",
        default=os.getenv("INGESTION_ON_DEMAND_LOCK_DIR", ".tmp/ingestion-locks"),
    )
    return parser


def main(argv: Sequence[str] | None = None) -> None:
    load_worker_env()
    parser = build_parser()
    args = parser.parse_args(list(argv) if argv is not None else None)
    report = run_deployment_preflight(
        batch_kinds=tuple(args.batch_kinds or ("internal-notice-multimodal-drain",)),
        live=bool(args.live),
        report_dir=Path(args.report_dir),
        lock_dir=Path(args.lock_dir),
    )
    print(json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True))
    if report["status"] != "passed":
        raise SystemExit(1)


def _normalize_batch_kinds(batch_kinds: Sequence[str]) -> tuple[str, ...]:
    normalized = tuple(
        dict.fromkeys(str(item).strip() for item in batch_kinds if str(item).strip())
    )
    if not normalized:
        return ("internal-notice-multimodal-drain",)
    unsupported = tuple(item for item in normalized if item not in SUPPORTED_BATCH_KINDS)
    if unsupported:
        expected = ", ".join(SUPPORTED_BATCH_KINDS)
        raise ValueError(
            f"unsupported batch kind(s): {', '.join(unsupported)}; expected {expected}"
        )
    return normalized


def _check_writable_dir(*, name: str, path: Path) -> dict[str, Any]:
    try:
        path.mkdir(parents=True, exist_ok=True)
        probe = path / ".preflight-write-check"
        probe.write_text("ok\n", encoding="utf-8")
        probe.unlink(missing_ok=True)
    except OSError as exc:
        return _failed(name, f"{path} is not writable: {exc}")
    return _passed(name, f"{path} is writable", details={"path": str(path)})


def _check_postgres_config(env: Mapping[str, str]) -> dict[str, Any]:
    shared_url = _env_text(env, SHARED_POSTGRES_KEY)
    operator_url = _operator_postgres_url(env)
    missing: list[str] = []
    if not shared_url:
        missing.append(SHARED_POSTGRES_KEY)
    if not operator_url:
        missing.append(f"{OPERATOR_POSTGRES_KEY} or legacy {LEGACY_OPERATOR_POSTGRES_KEY}")
    if missing:
        return _failed("postgres_config", "Missing required Postgres env: " + ", ".join(missing))

    try:
        validate_persistent_postgres_runtime_url(shared_url)
        build_operator_postgres_connection_url(operator_url)
    except ValueError as exc:
        return _failed("postgres_config", str(exc))
    return _passed(
        "postgres_config",
        "Postgres env is syntactically valid for shared runtime and operator access.",
        details={
            "shared_key": SHARED_POSTGRES_KEY,
            "operator_key": OPERATOR_POSTGRES_KEY
            if _env_text(env, OPERATOR_POSTGRES_KEY)
            else LEGACY_OPERATOR_POSTGRES_KEY,
        },
    )


def _check_object_store_config(env: Mapping[str, str]) -> dict[str, Any]:
    try:
        settings = ObjectStoreSettings.from_env(dict(env))
    except ValueError as exc:
        return _failed("object_store_config", str(exc))
    return _passed(
        "object_store_config",
        "Object store env is syntactically valid.",
        details={
            "endpoint": settings.endpoint,
            "source_bucket": settings.bucket_source,
            "derived_bucket": settings.bucket_derived,
            "shared_credentials": settings.has_shared_credentials,
            "source_credentials": settings.has_source_credentials,
            "derived_credentials": settings.has_derived_credentials,
        },
    )


def _check_batch_specific_dirs(
    batch_kinds: Sequence[str], env: Mapping[str, str]
) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    if "official-web-handoffs" in batch_kinds:
        checks.append(
            _check_writable_dir(
                name="official_web_handoff_inbox_dir_writable",
                path=Path(
                    _env_text(env, "INGESTION_WORKER_OFFICIAL_WEB_HANDOFF_INBOX_DIR")
                    or "./var/official-web-handoffs"
                ),
            )
        )
        checks.append(
            _check_writable_dir(
                name="official_web_handoff_execution_dir_writable",
                path=Path(
                    _env_text(env, "INGESTION_WORKER_OFFICIAL_WEB_HANDOFF_EXECUTION_ROOT_DIR")
                    or "./var/official-web-handoff-executions"
                ),
            )
        )
    return checks


def _check_batch_specific_env(
    batch_kinds: Sequence[str], env: Mapping[str, str]
) -> list[dict[str, Any]]:
    checks: list[dict[str, Any]] = []
    if "wechat-public-notices" in batch_kinds:
        ledger_url = _env_text(env, "WECHAT_OFFICIAL_ACCOUNT_CAPTURE_LEDGER_DATABASE_URL")
        if ledger_url:
            try:
                validate_persistent_postgres_runtime_url(ledger_url)
            except ValueError as exc:
                checks.append(_failed("wechat_capture_ledger_config", str(exc)))
            else:
                checks.append(
                    _passed(
                        "wechat_capture_ledger_config",
                        "WeChat capture ledger URL is configured and syntactically valid.",
                        details={"env_key": "WECHAT_OFFICIAL_ACCOUNT_CAPTURE_LEDGER_DATABASE_URL"},
                    )
                )
        else:
            checks.append(
                _skipped(
                    "wechat_capture_ledger_config",
                    "WeChat capture ledger URL is not configured; required only for capture-run selection.",
                    details={"env_key": "WECHAT_OFFICIAL_ACCOUNT_CAPTURE_LEDGER_DATABASE_URL"},
                )
            )
    return checks


def _run_live_checks(env: Mapping[str, str]) -> list[dict[str, Any]]:
    return [
        _check_live_postgres(env),
        _check_live_object_store(env),
    ]


def _check_live_postgres(env: Mapping[str, str]) -> dict[str, Any]:
    urls = {
        SHARED_POSTGRES_KEY: _env_text(env, SHARED_POSTGRES_KEY),
        OPERATOR_POSTGRES_KEY: _operator_postgres_url(env),
    }
    try:
        for key, url in urls.items():
            if not url:
                raise ValueError(f"{key} is required")
            connection_url = (
                build_operator_postgres_connection_url(url) if key == OPERATOR_POSTGRES_KEY else url
            )
            with open_postgres_connection(connection_url) as conn, conn.cursor() as cursor:
                cursor.execute("select 1")
                cursor.fetchone()
    except Exception as exc:  # pragma: no cover - exercised by deployment smoke
        return _failed("postgres_live_connectivity", str(exc))
    return _passed("postgres_live_connectivity", "Postgres SELECT 1 passed.")


def _check_live_object_store(env: Mapping[str, str]) -> dict[str, Any]:
    try:
        settings = ObjectStoreSettings.from_env(dict(env))
        for bucket in (settings.bucket_source, settings.bucket_derived):
            client = S3ObjectStoreClientFactory(settings).create(bucket=bucket)
            client.list_objects_v2(Bucket=bucket, MaxKeys=0)
    except Exception as exc:  # pragma: no cover - exercised by deployment smoke
        return _failed("object_store_live_connectivity", str(exc))
    return _passed("object_store_live_connectivity", "Object store bucket list probes passed.")


def _operator_postgres_url(env: Mapping[str, str]) -> str:
    return _env_text(env, OPERATOR_POSTGRES_KEY) or _env_text(env, LEGACY_OPERATOR_POSTGRES_KEY)


def _env_text(env: Mapping[str, str], key: str) -> str:
    return str(env.get(key) or "").strip()


def _check_batch_resource_policy(env: Mapping[str, str]) -> dict[str, Any]:
    try:
        max_batch_items = _read_policy_int(
            env,
            "INGESTION_ON_DEMAND_MAX_BATCH_ITEMS",
            default=200,
            minimum=1,
        )
        max_attachment_bytes = _read_policy_int(
            env,
            "INGESTION_ON_DEMAND_MAX_ATTACHMENT_BYTES",
            default=25 * 1024 * 1024,
            minimum=1,
        )
        max_ocr_input_bytes = _read_policy_int(
            env,
            "INGESTION_ON_DEMAND_MAX_OCR_INPUT_BYTES",
            default=25 * 1024 * 1024,
            minimum=1,
        )
        max_cache_entries = _read_policy_int(
            env,
            "INGESTION_ON_DEMAND_OCR_CACHE_MAX_ENTRIES",
            default=1,
            minimum=0,
        )
        max_cache_bytes = _read_policy_int(
            env,
            "INGESTION_ON_DEMAND_OCR_CACHE_MAX_TOTAL_BYTES",
            default=4 * 1024 * 1024,
            minimum=0,
        )
        peak_rss_warn_kb = _read_policy_int(
            env,
            "INGESTION_ON_DEMAND_PEAK_RSS_WARN_KB",
            default=512 * 1024,
            minimum=1,
        )
        peak_rss_hard_kb = _read_policy_int(
            env,
            "INGESTION_ON_DEMAND_PEAK_RSS_HARD_KB",
            default=768 * 1024,
            minimum=1,
        )
        if peak_rss_hard_kb < peak_rss_warn_kb:
            return _failed(
                "batch_resource_policy",
                "INGESTION_ON_DEMAND_PEAK_RSS_HARD_KB must be >= INGESTION_ON_DEMAND_PEAK_RSS_WARN_KB",
            )
    except ValueError as exc:
        return _failed("batch_resource_policy", str(exc))
    return _passed(
        "batch_resource_policy",
        "Batch resource policy env is syntactically valid.",
        details={
            "max_batch_items": max_batch_items,
            "max_attachment_bytes": max_attachment_bytes,
            "max_ocr_input_bytes": max_ocr_input_bytes,
            "max_ocr_cache_entries": max_cache_entries,
            "max_ocr_cache_total_bytes": max_cache_bytes,
            "peak_rss_warn_kb": peak_rss_warn_kb,
            "peak_rss_hard_kb": peak_rss_hard_kb,
        },
    )


def _check_report_retention_policy(env: Mapping[str, str]) -> dict[str, Any]:
    try:
        max_age_days = _read_policy_int(
            env,
            "INGESTION_REPORT_RETENTION_MAX_AGE_DAYS",
            default=14,
            minimum=1,
        )
        max_count = _read_policy_int(
            env,
            "INGESTION_REPORT_RETENTION_MAX_COUNT",
            default=200,
            minimum=1,
        )
        keep_failed = _read_policy_bool(
            env,
            "INGESTION_REPORT_RETENTION_KEEP_FAILED",
            default=True,
        )
    except ValueError as exc:
        return _failed("report_retention_policy", str(exc))
    return _passed(
        "report_retention_policy",
        "Report retention policy env is syntactically valid.",
        details={
            "max_age_days": max_age_days,
            "max_count": max_count,
            "keep_failed": keep_failed,
        },
    )


def _check_optional_docker_runtime() -> dict[str, Any]:
    docker_path = shutil.which("docker")
    if docker_path:
        return _passed(
            "docker_runtime_optional",
            "Docker binary detected.",
            details={"docker_path": docker_path},
        )
    return _skipped(
        "docker_runtime_optional",
        "Docker binary not found; acceptable for local dev-only preflight.",
    )


def _read_policy_int(
    env: Mapping[str, str],
    key: str,
    *,
    default: int,
    minimum: int,
) -> int:
    raw = _env_text(env, key)
    if not raw:
        return default
    value = int(raw)
    if value < minimum:
        raise ValueError(f"{key} must be >= {minimum}")
    return value


def _read_policy_bool(env: Mapping[str, str], key: str, *, default: bool) -> bool:
    raw = _env_text(env, key)
    if not raw:
        return default
    normalized = raw.lower()
    if normalized in {"1", "true", "yes", "on"}:
        return True
    if normalized in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{key} must be a boolean value")


def _passed(name: str, message: str, *, details: Mapping[str, Any] | None = None) -> dict[str, Any]:
    return _check(name=name, status="passed", message=message, details=details)


def _failed(name: str, message: str, *, details: Mapping[str, Any] | None = None) -> dict[str, Any]:
    return _check(name=name, status="failed", message=message, details=details)


def _skipped(
    name: str, message: str, *, details: Mapping[str, Any] | None = None
) -> dict[str, Any]:
    return _check(name=name, status="skipped", message=message, details=details)


def _check(
    *,
    name: str,
    status: str,
    message: str,
    details: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "name": name,
        "status": status,
        "message": message,
        "details": dict(details or {}),
    }


__all__ = [
    "PREFLIGHT_SCHEMA_VERSION",
    "SUPPORTED_BATCH_KINDS",
    "build_parser",
    "main",
    "run_deployment_preflight",
]


if __name__ == "__main__":
    main()
