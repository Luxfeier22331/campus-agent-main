#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
compose_file="${EXECUTION_CONTROL_RUNTIME_COMPOSE_FILE:-${repo_root}/infra/local/docker-compose.execution-control-runtime.yml}"
compose_project_name="${EXECUTION_CONTROL_RUNTIME_COMPOSE_PROJECT_NAME:-campus-execution-control-runtime-local}"
compose_parallel_limit="${EXECUTION_CONTROL_RUNTIME_COMPOSE_PARALLEL_LIMIT:-1}"
api_host_port="${EXECUTION_CONTROL_HOST_PORT:-27051}"
data_plane_network="${CAMPUS_AGENT_DATA_PLANE_NETWORK:-campus-agent-data-plane}"

require_command() {
  local command_name="$1"
  local resolved

  resolved="$(command -v "${command_name}" || true)"
  if [[ -z "${resolved}" ]]; then
    echo "Missing required command: ${command_name}" >&2
    return 1
  fi

  printf '%s\n' "${resolved}"
}

ensure_data_plane_network() {
  local docker_bin
  docker_bin="$(require_command docker)"
  if ! "${docker_bin}" network inspect "${data_plane_network}" >/dev/null 2>&1; then
    "${docker_bin}" network create "${data_plane_network}" >/dev/null
  fi
}

load_runtime_env() {
  local env_key
  local env_value
  local node_bin

  node_bin="$(require_command node)"
  while IFS= read -r -d '' env_key && IFS= read -r -d '' env_value; do
    export "${env_key}=${env_value}"
  done < <(
    "${node_bin}" - "${repo_root}/.env" "${repo_root}/apps/app-api/.dev.vars" <<'NODE'
const [repoEnvPath, appApiDevVarsPath] = process.argv.slice(2);

for (const filePath of [repoEnvPath, appApiDevVarsPath]) {
  try {
    process.loadEnvFile(filePath);
  } catch (error) {
    if (!(error instanceof Error && "code" in error) || error.code !== "ENOENT") {
      throw error;
    }
  }
}

const keys = [
  "CAMPUS_AGENT_APP_NAME",
  "EXECUTION_CONTROL_DOCKER_GOPROXY",
  "EXECUTION_CONTROL_DOCKER_GOSUMDB",
  "AGENT_RUNTIME_PROVIDER",
  "PROMPT_RUNTIME_PROVIDER",
  "PROMPT_RUNTIME_TRANSPORT",
  "PROMPT_RUNTIME_MODEL",
  "EXECUTION_PROMPT_MODEL",
  "AGENT_PROMPT_MODEL",
  "PROMPT_RUNTIME_API_KEY",
  "PROMPT_RUNTIME_BASE_URL",
  "EXECUTION_CONTROL_PROVIDER_PRICING_PATH",
  "PROMPT_RUNTIME_REASONING_EFFORT",
  "PROMPT_RUNTIME_MAX_OUTPUT_TOKENS",
  "PROMPT_RUNTIME_CONNECT_TIMEOUT_SECONDS",
  "PROMPT_RUNTIME_READ_TIMEOUT_SECONDS",
  "PROMPT_RUNTIME_WRITE_TIMEOUT_SECONDS",
  "PROMPT_RUNTIME_POOL_TIMEOUT_SECONDS",
  "PROMPT_RUNTIME_MAX_CONNECTIONS",
  "PROMPT_RUNTIME_MAX_KEEPALIVE_CONNECTIONS",
  "PROMPT_RUNTIME_KEEPALIVE_EXPIRY_SECONDS",
  "PROMPT_STRICT_STRUCTURED_OUTPUTS",
  "LLM_API_KEY",
  "LLM_BASE_URL",
  "OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT",
  "OTEL_COLLECTOR_SENTRY_AUTH_VALUE",
  "OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT",
  "OTEL_COLLECTOR_AXIOM_AUTH_HEADER",
  "OTEL_COLLECTOR_AXIOM_EVENTS_DATASET",
  "TEMPORAL_POSTGRES_PASSWORD",
  "TEMPORAL_POSTGRES_USER",
  "TEMPORAL_UI_CORS_ORIGINS",
  "TEMPORAL_UI_HOST_PORT",
  "AUDIT_LOG_PATH",
  "AUDIT_QUEUE_CAPACITY",
  "APP_API_INTERNAL_SHARED_SECRET",
  "EXECUTION_CONTROL_MAX_CONCURRENT_ANSWERS",
  "EXECUTION_CONTROL_QUEUE_CAPACITY",
  "EXECUTION_CONTROL_QUEUE_TIMEOUT_MS",
  "EXECUTION_CONTROL_REQUEST_TIMEOUT_MS",
  "EXECUTION_CONTROL_SHUTDOWN_GRACE_MS",
  "EXECUTION_CONTROL_METRICS_BEARER_TOKEN",
  "EXECUTION_CONTROL_EXECUTION_AUDIT_ENABLED",
  "EXECUTION_CONTROL_EXECUTION_AUDIT_URL",
  "EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET",
  "EXECUTION_CONTROL_EXECUTION_AUDIT_TIMEOUT_MS",
  "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL",
  "EXECUTION_CONTROL_RUN_PROJECTION_AUTO_MIGRATE",
  "EXECUTION_CONTROL_TEMPORAL_ADDRESS",
  "EXECUTION_CONTROL_TEMPORAL_NAMESPACE",
  "EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE",
  "EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_CONTEXT_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_CAMPUS_SERVICES_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_NOTICE_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_NAVIGATION_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_FINALIZATION_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT",
  "EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS",
  "EXECUTION_CONTROL_SHARED_SECRET",
  "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET",
  "EXECUTION_CONTROL_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339",
  "EXECUTION_CONTROL_STRUCTURED_QUERY_TIMEOUT_MS",
  "EXECUTION_CONTROL_STRUCTURED_QUERY_TIMEOUT_SECONDS",
  "INTERNAL_NOTICE_READ_MODEL_DATABASE_URL",
  "INTERNAL_NOTICE_READ_MODEL_TABLE",
  "OBJECT_STORE_ENDPOINT",
  "OBJECT_STORE_DERIVED_ACCESS_KEY",
  "OBJECT_STORE_DERIVED_SECRET_KEY",
  "OBJECT_STORE_ACCESS_KEY",
  "OBJECT_STORE_SECRET_KEY",
  "OBJECT_STORE_REGION",
  "OBJECT_STORE_BUCKET_DERIVED",
  "QDRANT_URL",
  "QDRANT_QUERY_API_KEY",
  "QDRANT_WRITE_API_KEY",
  "QDRANT_TLS_CA_CERT_PATH",
  "QDRANT_TLS_DIR",
  "QDRANT_TIMEOUT_SECONDS",
  "DOCUMENT_REGISTRY_DATABASE_URL",
  "CAMPUS_SHARED_POSTGRES_URL",
  "EMBEDDING_PROVIDER",
  "EMBEDDING_BASE_URL",
  "EMBEDDING_API_KEY",
  "EMBEDDING_MODEL",
  "EMBEDDING_DIMENSIONS",
  "SPARSE_PROVIDER",
  "SPARSE_MODEL",
  "SPARSE_TOKENIZER",
  "SPARSE_LANGUAGE",
];

function projectLocalServiceDns(value, serviceName) {
  if (!value) {
    return value;
  }
  try {
    const parsed = new URL(value);
    if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") {
      parsed.hostname = serviceName;
      return parsed.toString().replace(/\/$/, "");
    }
  } catch {
    return value;
  }
  return value;
}

const resolved = new Map();
for (const key of keys) {
  const value = process.env[key];
  if (typeof value === "string") {
    resolved.set(key, value.trim());
  }
}

const workerSharedSecret =
  process.env.API_WORKER_SHARED_SECRET?.trim() ||
  process.env.EXECUTION_CONTROL_SHARED_SECRET?.trim() ||
  "execution-control-local-placeholder";
const internalQuerySharedSecret =
  process.env.EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET?.trim() ||
  "execution-control-internal-query-local-placeholder";

resolved.set("API_WORKER_SHARED_SECRET", workerSharedSecret);
resolved.set("EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET", internalQuerySharedSecret);
if (!resolved.get("EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY")) {
  resolved.set("EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY", "local:execution-control:001");
}
if (!resolved.get("EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY")) {
  resolved.set("EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY", "local:workflow-worker:001");
}
if (!resolved.get("EXECUTION_CONTROL_TEMPORAL_CONTEXT_WORKER_IDENTITY")) {
  resolved.set("EXECUTION_CONTROL_TEMPORAL_CONTEXT_WORKER_IDENTITY", "local:activity-context:001");
}
if (!resolved.get("EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_WORKER_IDENTITY")) {
  resolved.set("EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_WORKER_IDENTITY", "local:activity-knowledge:001");
}
if (!resolved.get("EXECUTION_CONTROL_TEMPORAL_CAMPUS_SERVICES_WORKER_IDENTITY")) {
  resolved.set("EXECUTION_CONTROL_TEMPORAL_CAMPUS_SERVICES_WORKER_IDENTITY", "local:activity-campus-services:001");
}
if (!resolved.get("EXECUTION_CONTROL_TEMPORAL_NOTICE_WORKER_IDENTITY")) {
  resolved.set("EXECUTION_CONTROL_TEMPORAL_NOTICE_WORKER_IDENTITY", "local:activity-notice:001");
}
if (!resolved.get("EXECUTION_CONTROL_TEMPORAL_NAVIGATION_WORKER_IDENTITY")) {
  resolved.set("EXECUTION_CONTROL_TEMPORAL_NAVIGATION_WORKER_IDENTITY", "local:activity-navigation:001");
}
if (!resolved.get("EXECUTION_CONTROL_TEMPORAL_FINALIZATION_WORKER_IDENTITY")) {
  resolved.set(
    "EXECUTION_CONTROL_TEMPORAL_FINALIZATION_WORKER_IDENTITY",
    "local:activity-finalization:001",
  );
}

for (const [key, value] of resolved.entries()) {
  let outputValue = value;
  if (key === "DOCUMENT_REGISTRY_DATABASE_URL" || key === "CAMPUS_SHARED_POSTGRES_URL") {
    outputValue = projectLocalServiceDns(value, "postgres");
  } else if (key === "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL") {
    outputValue = projectLocalServiceDns(value, "postgres");
  } else if (key === "OBJECT_STORE_ENDPOINT") {
    outputValue = projectLocalServiceDns(value, "minio");
  } else if (key === "QDRANT_URL") {
    outputValue = projectLocalServiceDns(value, "qdrant");
  }
  process.stdout.write(`${key}\0${outputValue}\0`);
}
NODE
  )
  if [[ -z "${QDRANT_TLS_DIR:-}" && -n "${QDRANT_TLS_CA_CERT_PATH:-}" ]]; then
    QDRANT_TLS_DIR="$(dirname "${QDRANT_TLS_CA_CERT_PATH}")"
    export QDRANT_TLS_DIR
  fi
}

execution_control_runtime_require_runtime_env() {
  if [[ -z "${QDRANT_URL:-}" ]]; then
    echo "QDRANT_URL is required for execution-control runtime." >&2
    return 1
  fi
  if [[ "${QDRANT_URL}" != https://* ]]; then
    echo "QDRANT_URL must use https for authenticated Qdrant data-plane." >&2
    return 1
  fi
  if [[ -z "${QDRANT_QUERY_API_KEY:-}" ]]; then
    echo "QDRANT_QUERY_API_KEY is required for online Qdrant query access." >&2
    return 1
  fi
  if [[ -z "${QDRANT_WRITE_API_KEY:-}" ]]; then
    echo "QDRANT_WRITE_API_KEY is required for personal memory indexing." >&2
    return 1
  fi
  if [[ -z "${QDRANT_TLS_CA_CERT_PATH:-}" ]]; then
    echo "QDRANT_TLS_CA_CERT_PATH is required for HTTPS Qdrant data-plane." >&2
    return 1
  fi
  if [[ -z "${QDRANT_TLS_DIR:-}" ]]; then
    echo "QDRANT_TLS_DIR is required for mounting Qdrant TLS trust material." >&2
    return 1
  fi
}

main() {
  local docker_bin

  docker_bin="$(require_command docker)"
  load_runtime_env
  execution_control_runtime_require_runtime_env
  ensure_data_plane_network

  if [[ "$#" -eq 0 ]]; then
    set -- up -d --build
  fi

  (
    cd "${repo_root}" || exit
    COMPOSE_PROJECT_NAME="${compose_project_name}" \
    COMPOSE_PARALLEL_LIMIT="${compose_parallel_limit}" \
    CAMPUS_AGENT_DATA_PLANE_NETWORK="${data_plane_network}" \
    EXECUTION_CONTROL_HOST_PORT="${api_host_port}" \
    API_AUTH_MODE="${API_AUTH_MODE:-trusted-worker}" \
    "${docker_bin}" compose -f "${compose_file}" "$@"
  )
}

if [[ "${1:-}" != "__campus_agent_print_projected_env" ]]; then
  main "$@"
fi
