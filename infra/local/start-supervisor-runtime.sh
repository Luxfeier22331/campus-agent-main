#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
compose_file="${SUPERVISOR_RUNTIME_COMPOSE_FILE:-${repo_root}/infra/local/docker-compose.supervisor-runtime.yml}"
compose_project_name="${SUPERVISOR_RUNTIME_COMPOSE_PROJECT_NAME:-campus-supervisor-runtime-local}"
compose_parallel_limit="${SUPERVISOR_RUNTIME_COMPOSE_PARALLEL_LIMIT:-1}"
api_host_port="${SUPERVISOR_API_HOST_PORT:-18080}"

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
  "SUPERVISOR_API_DOCKER_GOPROXY",
  "SUPERVISOR_API_DOCKER_GOSUMDB",
  "AGENT_RUNTIME_PROVIDER",
  "PROMPT_RUNTIME_PROVIDER",
  "PROMPT_RUNTIME_TRANSPORT",
  "PROMPT_RUNTIME_MODEL",
  "SUPERVISOR_PROMPT_MODEL",
  "AGENT_PROMPT_MODEL",
  "PROMPT_RUNTIME_API_KEY",
  "PROMPT_RUNTIME_BASE_URL",
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
  "AUDIT_LOG_PATH",
  "AUDIT_QUEUE_CAPACITY",
  "APP_API_INTERNAL_SHARED_SECRET",
  "SUPERVISOR_API_MAX_CONCURRENT_ANSWERS",
  "SUPERVISOR_API_QUEUE_CAPACITY",
  "SUPERVISOR_API_QUEUE_TIMEOUT_MS",
  "SUPERVISOR_API_REQUEST_TIMEOUT_MS",
  "SUPERVISOR_API_SHUTDOWN_GRACE_MS",
  "SUPERVISOR_API_METRICS_BEARER_TOKEN",
  "SUPERVISOR_API_EXECUTION_AUDIT_ENABLED",
  "SUPERVISOR_API_EXECUTION_AUDIT_URL",
  "SUPERVISOR_API_EXECUTION_AUDIT_SHARED_SECRET",
  "SUPERVISOR_API_EXECUTION_AUDIT_TIMEOUT_MS",
  "SUPERVISOR_API_EXECUTION_AUDIT_QUEUE_CAPACITY",
  "SUPERVISOR_AGENT_WORKER_THREADS",
  "SUPERVISOR_API_SHARED_SECRET",
  "SUPERVISOR_AGENT_WORKER_TIMEOUT_MS",
  "SUPERVISOR_STRUCTURED_QUERY_SHARED_SECRET",
  "SUPERVISOR_STRUCTURED_QUERY_PROJECTION_PATH",
  "SUPERVISOR_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339",
  "SUPERVISOR_STRUCTURED_QUERY_TIMEOUT_MS",
  "SUPERVISOR_STRUCTURED_QUERY_TIMEOUT_SECONDS",
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
  "QDRANT_API_KEY",
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

function rewriteLocalhostForDocker(value) {
  if (!value) {
    return value;
  }
  try {
    const parsed = new URL(value);
    if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") {
      parsed.hostname = "host.docker.internal";
      return parsed.toString();
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
  process.env.SUPERVISOR_API_SHARED_SECRET?.trim() ||
  "supervisor-api-local-placeholder";
const bridgeSharedSecret =
  process.env.SUPERVISOR_AGENT_WORKER_SHARED_SECRET?.trim() ||
  process.env.SUPERVISOR_AGENT_WORKER_LOCAL_SHARED_SECRET?.trim() ||
  process.env.SUPERVISOR_API_SHARED_SECRET?.trim() ||
  "supervisor-agent-worker-local-placeholder";

resolved.set("API_WORKER_SHARED_SECRET", workerSharedSecret);
resolved.set("SUPERVISOR_AGENT_WORKER_SHARED_SECRET", bridgeSharedSecret);

for (const [key, value] of resolved.entries()) {
  const outputValue =
    key === "DOCUMENT_REGISTRY_DATABASE_URL" ||
    key === "CAMPUS_SHARED_POSTGRES_URL" ||
    key === "SUPERVISOR_API_EXECUTION_AUDIT_URL" ||
    key === "OBJECT_STORE_ENDPOINT"
      ? rewriteLocalhostForDocker(value)
      : value;
  process.stdout.write(`${key}\0${outputValue}\0`);
}
NODE
  )
}

main() {
  local docker_bin

  docker_bin="$(require_command docker)"
  load_runtime_env

  if [[ "$#" -eq 0 ]]; then
    set -- up -d --build
  fi

  (
    cd "${repo_root}" || exit
    COMPOSE_PROJECT_NAME="${compose_project_name}" \
    COMPOSE_PARALLEL_LIMIT="${compose_parallel_limit}" \
    SUPERVISOR_API_HOST_PORT="${api_host_port}" \
    API_AUTH_MODE="${API_AUTH_MODE:-trusted-worker}" \
    "${docker_bin}" compose -f "${compose_file}" "$@"
  )
}

main "$@"
