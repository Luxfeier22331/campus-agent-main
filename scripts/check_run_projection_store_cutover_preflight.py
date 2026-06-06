from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from urllib.parse import urlparse

REQUIRED_STAGING_ENV_KEYS = [
    "STAGING_EXECUTION_CONTROL_BASE_URL",
    "STAGING_INGESTION_SHARED_POSTGRES_URL",
    "STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL",
    "STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL",
    "STAGING_INGESTION_OBJECT_STORE_ENDPOINT",
    "STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED",
    "STAGING_INGESTION_OBJECT_STORE_REGION",
    "STAGING_INGESTION_QDRANT_URL",
    "STAGING_INGESTION_QDRANT_API_KEY",
    "STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY",
    "STAGING_INGESTION_EMBEDDING_PROVIDER",
    "STAGING_INGESTION_EMBEDDING_BASE_URL",
    "STAGING_INGESTION_EMBEDDING_API_KEY",
    "STAGING_INGESTION_EMBEDDING_MODEL",
    "STAGING_INGESTION_EMBEDDING_DIMENSIONS",
    "STAGING_INGESTION_SPARSE_PROVIDER",
    "STAGING_INGESTION_SPARSE_MODEL",
    "STAGING_INGESTION_SPARSE_TOKENIZER",
    "STAGING_INGESTION_SPARSE_LANGUAGE",
    "AXIOM_ENDPOINT",
    "OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT",
    "OTEL_COLLECTOR_SENTRY_AUTH_VALUE",
    "OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT",
    "OTEL_COLLECTOR_AXIOM_AUTH_HEADER",
    "OTEL_COLLECTOR_AXIOM_EVENTS_DATASET",
    "EXECUTION_CONTROL_METRICS_BEARER_TOKEN",
    "SUPERVISOR_AGENT_WORKER_SHARED_SECRET",
    "SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET",
    "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL",
    "TEMPORAL_POSTGRES_PASSWORD",
    "EXECUTION_CONTROL_TEMPORAL_ADDRESS",
    "EXECUTION_CONTROL_TEMPORAL_NAMESPACE",
    "EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE",
    "EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY",
    "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY",
    "EXECUTION_CONTROL_TEMPORAL_RAG_WORKER_IDENTITY",
    "EXECUTION_CONTROL_TEMPORAL_FINALIZATION_WORKER_IDENTITY",
    "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT",
    "EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS",
]

OBJECT_STORE_CREDENTIAL_SETS = [
    (
        "STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY",
        "STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY",
    ),
    ("STAGING_INGESTION_OBJECT_STORE_ACCESS_KEY", "STAGING_INGESTION_OBJECT_STORE_SECRET_KEY"),
]

REQUIRED_APP_API_DEV_VARS = ["EXECUTION_CONTROL_SHARED_SECRET"]

EXPECTED_STAGING_VALUES = {
    "STAGING_EXECUTION_CONTROL_BASE_URL": "https://exec-staging.mucwiki-edge.link",
    "STAGING_INGESTION_EMBEDDING_PROVIDER": "gitee",
    "STAGING_INGESTION_EMBEDDING_BASE_URL": "https://ai.gitee.com/v1",
    "STAGING_INGESTION_EMBEDDING_MODEL": "Qwen3-Embedding-4B",
    "STAGING_INGESTION_EMBEDDING_DIMENSIONS": "2560",
    "STAGING_INGESTION_SPARSE_PROVIDER": "qdrant",
    "STAGING_INGESTION_SPARSE_MODEL": "qdrant/bm25",
    "STAGING_INGESTION_SPARSE_TOKENIZER": "multilingual",
    "STAGING_INGESTION_SPARSE_LANGUAGE": "none",
    "EXECUTION_CONTROL_TEMPORAL_ADDRESS": "temporal:7233",
    "EXECUTION_CONTROL_TEMPORAL_NAMESPACE": "campus-agent-staging",
    "EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE": "campus-agent.workflow",
}

POSITIVE_INTEGER_KEYS = [
    "STAGING_INGESTION_EMBEDDING_DIMENSIONS",
    "EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS",
]

URL_KEYS = [
    "STAGING_EXECUTION_CONTROL_BASE_URL",
    "STAGING_INGESTION_SHARED_POSTGRES_URL",
    "STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL",
    "STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL",
    "STAGING_INGESTION_OBJECT_STORE_ENDPOINT",
    "STAGING_INGESTION_QDRANT_URL",
    "STAGING_INGESTION_EMBEDDING_BASE_URL",
    "AXIOM_ENDPOINT",
    "OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT",
    "OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT",
    "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL",
]

RETIRED_STAGING_ENV_KEYS = [
    "EXECUTION_CONTROL_DURABLE_WORKER_LOOP_ENABLED",
    "EXECUTION_CONTROL_DURABLE_WORKER_LOOP_WORKER_ID",
    "EXECUTION_CONTROL_DURABLE_WORKER_LOOP_LANE",
    "EXECUTION_CONTROL_DURABLE_WORKER_LOOP_STEP_ID",
    "EXECUTION_CONTROL_DURABLE_WORKER_LOOP_POLL_INTERVAL_MS",
    "EXECUTION_CONTROL_DURABLE_WORKER_LOOP_LEASE_TTL_MS",
    "EXECUTION_CONTROL_DURABLE_WORKER_LOOP_LEASE_HEARTBEAT_INTERVAL_MS",
    "EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_ENABLED",
    "EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_INTERVAL_MS",
    "EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_MAX_RETRY_ATTEMPTS",
]

OBJECT_STORE_PROFILES = {
    "local_minio_isolated_proof": {
        "endpoint_hosts": {"127.0.0.1", "localhost"},
        "bucket": "campus-rag-derived",
        "region": "us-east-1",
        "schemes": {"http"},
    },
    "r2_public_staging": {
        "endpoint_host_suffix": ".r2.cloudflarestorage.com",
        "bucket": "campus-rag-derived-staging",
        "region": "auto",
        "schemes": {"https"},
    },
}


def parse_env_file(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        value = value.strip().strip('"').strip("'")
        if value:
            values[key.strip()] = value
    return values


def missing_required_keys(values: dict[str, str], keys: list[str]) -> list[str]:
    return [key for key in keys if not values.get(key)]


def has_object_store_credentials(values: dict[str, str]) -> bool:
    return any(
        all(values.get(key) for key in credential_set)
        for credential_set in OBJECT_STORE_CREDENTIAL_SETS
    )


def positive_int(value: str) -> int | None:
    try:
        parsed = int(value)
    except ValueError:
        return None
    if parsed <= 0:
        return None
    return parsed


def valid_url(value: str) -> bool:
    parsed = urlparse(value)
    return bool(parsed.scheme and parsed.netloc)


def valid_object_store_profile(values: dict[str, str]) -> bool:
    endpoint = values.get("STAGING_INGESTION_OBJECT_STORE_ENDPOINT", "")
    bucket = values.get("STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED", "")
    region = values.get("STAGING_INGESTION_OBJECT_STORE_REGION", "")
    parsed = urlparse(endpoint)
    host = parsed.hostname or ""
    local_profile = OBJECT_STORE_PROFILES["local_minio_isolated_proof"]
    if (
        parsed.scheme in local_profile["schemes"]
        and host in local_profile["endpoint_hosts"]
        and bucket == local_profile["bucket"]
        and region == local_profile["region"]
    ):
        return True
    r2_profile = OBJECT_STORE_PROFILES["r2_public_staging"]
    return (
        parsed.scheme in r2_profile["schemes"]
        and host.endswith(r2_profile["endpoint_host_suffix"])
        and bucket == r2_profile["bucket"]
        and region == r2_profile["region"]
    )


def invalid_observability_keys(values: dict[str, str]) -> list[str]:
    invalid: list[str] = []
    axiom_endpoint = values.get("AXIOM_ENDPOINT", "").rstrip("/")
    axiom_collector_endpoint = values.get("OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT", "").rstrip("/")
    if axiom_endpoint and axiom_collector_endpoint and axiom_endpoint != axiom_collector_endpoint:
        invalid.append("OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT")
    if values.get("OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT", "") and "/" in (
        values["OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT"]
        .removeprefix("https://")
        .removeprefix("http://")
        .rstrip("/")
    ):
        invalid.append("OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT")
    if values.get("OTEL_COLLECTOR_AXIOM_EVENTS_DATASET") != "campus-agent-runtime":
        invalid.append("OTEL_COLLECTOR_AXIOM_EVENTS_DATASET")
    axiom_auth = values.get("OTEL_COLLECTOR_AXIOM_AUTH_HEADER", "")
    if axiom_auth and not axiom_auth.startswith("Bearer "):
        invalid.append("OTEL_COLLECTOR_AXIOM_AUTH_HEADER")
    sentry_auth = values.get("OTEL_COLLECTOR_SENTRY_AUTH_VALUE", "")
    if sentry_auth and not sentry_auth.startswith("sentry sentry_key="):
        invalid.append("OTEL_COLLECTOR_SENTRY_AUTH_VALUE")
    return invalid


def invalid_contract_keys(values: dict[str, str]) -> list[str]:
    invalid: list[str] = []
    for key, expected in EXPECTED_STAGING_VALUES.items():
        actual = values.get(key)
        if actual and actual != expected:
            invalid.append(key)
    for key in POSITIVE_INTEGER_KEYS:
        actual = values.get(key)
        if actual and positive_int(actual) is None:
            invalid.append(key)
    for key in URL_KEYS:
        actual = values.get(key)
        if actual and not valid_url(actual):
            invalid.append(key)
    for worker_identity_key in (
        "EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY",
        "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY",
        "EXECUTION_CONTROL_TEMPORAL_RAG_WORKER_IDENTITY",
        "EXECUTION_CONTROL_TEMPORAL_FINALIZATION_WORKER_IDENTITY",
    ):
        worker_identity = values.get(worker_identity_key, "")
        if worker_identity and worker_identity.count(":") < 2:
            invalid.append(worker_identity_key)
    for key in RETIRED_STAGING_ENV_KEYS:
        if values.get(key):
            invalid.append(key)
    qdrant_url = values.get("STAGING_INGESTION_QDRANT_URL", "")
    if qdrant_url and urlparse(qdrant_url).scheme != "http":
        invalid.append("STAGING_INGESTION_QDRANT_URL")
    object_store_fields = (
        "STAGING_INGESTION_OBJECT_STORE_ENDPOINT",
        "STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED",
        "STAGING_INGESTION_OBJECT_STORE_REGION",
    )
    if all(values.get(key) for key in object_store_fields) and not valid_object_store_profile(
        values
    ):
        invalid.append("STAGING_INGESTION_OBJECT_STORE_PROFILE")
    invalid.extend(invalid_observability_keys(values))
    return invalid


def build_report(repo_root: Path, env: dict[str, str]) -> dict[str, object]:
    staging_env_path = repo_root / ".env.staging.local"
    app_api_dev_vars_path = repo_root / "apps" / "app-api" / ".dev.vars"
    staging_env = parse_env_file(staging_env_path)
    app_api_dev_vars = parse_env_file(app_api_dev_vars_path)
    blockers: list[str] = []
    blockers.extend(missing_required_keys(staging_env, REQUIRED_STAGING_ENV_KEYS))
    blockers.extend(missing_required_keys(app_api_dev_vars, REQUIRED_APP_API_DEV_VARS))
    blockers.extend(invalid_contract_keys(staging_env))
    if not has_object_store_credentials(staging_env):
        blockers.append("STAGING_INGESTION_OBJECT_STORE_CREDENTIAL_PAIR")
    if not env.get("CLOUDFLARE_API_TOKEN", "").strip():
        blockers.append("CLOUDFLARE_API_TOKEN")
    blockers = sorted(set(blockers))
    return {
        "app_api_dev_vars_path": str(app_api_dev_vars_path),
        "blockers": blockers,
        "repo_root": str(repo_root),
        "staging_env_path": str(staging_env_path),
        "status": "ready" if not blockers else "blocked",
    }


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Check Temporal execution-control staging cutover inputs."
    )
    parser.add_argument("--repo-root", default=".", help="repository root to inspect")
    parser.add_argument("--json", action="store_true", help="emit JSON report")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    report = build_report(Path(args.repo_root).resolve(), dict(os.environ))
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    elif report["status"] == "ready":
        print("Temporal execution-control cutover preflight: ready")
    else:
        print("Temporal execution-control cutover preflight: blocked", file=sys.stderr)
        for blocker in report["blockers"]:
            print(f"  - {blocker}", file=sys.stderr)
    return 0 if report["status"] == "ready" else 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
