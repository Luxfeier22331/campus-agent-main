#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
compose_file="${EXECUTION_CONTROL_RUNTIME_COMPOSE_FILE:-${repo_root}/infra/local/docker-compose.execution-control-runtime.yml}"
compose_project_name="${EXECUTION_CONTROL_RUNTIME_COMPOSE_PROJECT_NAME:-campus-execution-control-runtime-local}"
compose_parallel_limit="${EXECUTION_CONTROL_RUNTIME_COMPOSE_PARALLEL_LIMIT:-1}"
api_host_port="${EXECUTION_CONTROL_HOST_PORT:-27051}"
data_plane_network="${CAMPUS_AGENT_DATA_PLANE_NETWORK:-campus-agent-data-plane}"
generated_runtime_env="${repo_root}/infra/local/.generated/runtime.env"

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

ensure_local_runtime_secrets() {
  local node_bin

  node_bin="$(require_command node)"
  "${node_bin}" "${repo_root}/infra/local/scripts/ensure-runtime-secrets.mjs" >/dev/null
}

load_runtime_env() {
  local env_key
  local env_value
  local node_bin

  node_bin="$(require_command node)"
  while IFS= read -r -d '' env_key && IFS= read -r -d '' env_value; do
    export "${env_key}=${env_value}"
  done < <(
    "${node_bin}" - "${repo_root}/.env" "${repo_root}/apps/app-api/.dev.vars" "${generated_runtime_env}" "${repo_root}" "${compose_project_name}" <<'NODE'
const fs = require("node:fs");
const crypto = require("node:crypto");

const [repoEnvPath, appApiDevVarsPath, generatedRuntimeEnvPath, repoRoot, composeProjectName] = process.argv.slice(2);

for (const filePath of [repoEnvPath, appApiDevVarsPath, generatedRuntimeEnvPath]) {
  try {
    mergeEnvFile(filePath);
  } catch (error) {
    if (!(error instanceof Error && "code" in error) || error.code !== "ENOENT") {
      throw error;
    }
  }
}

function mergeEnvFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex <= 0) {
      continue;
    }
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (key && !(process.env[key] || "").trim()) {
      process.env[key] = value;
    }
  }
}

const keys = [
  "CAMPUS_AGENT_APP_NAME",
  "EXECUTION_CONTROL_DOCKER_GOPROXY",
  "EXECUTION_CONTROL_DOCKER_GOSUMDB",
  "EXECUTION_CONTROL_RUNTIME_CONFIG_PATH",
  "AGENT_RUNTIME_PORT",
  "AGENT_RUNTIME_SHARED_SECRET",
  "AGENT_RUNTIME_TOOL_CATALOG_PATH",
  "AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL",
  "AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET",
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
  "APP_API_INTERNAL_BASE_URL",
  "APP_API_INTERNAL_SHARED_SECRET",
  "APP_API_BASE_URL",
  "EXECUTION_CONTROL_METRICS_BEARER_TOKEN",
  "EXECUTION_CONTROL_EXECUTION_AUDIT_URL",
  "EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET",
  "EXECUTION_CONTROL_APP_API_INTERNAL_BASE_URL",
  "EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET",
  "EXECUTION_CONTROL_APP_API_INTERNAL_TIMEOUT_MS",
  "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL",
  "EXECUTION_CONTROL_RUN_PROJECTION_AUTO_MIGRATE",
  "EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL",
  "EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET",
  "EXECUTION_CONTROL_AGENT_RUNTIME_TIMEOUT_MS",
  "EXECUTION_CONTROL_TEMPORAL_ADDRESS",
  "EXECUTION_CONTROL_TEMPORAL_NAMESPACE",
  "EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE",
  "EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_CONTEXT_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_AGENT_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_PLAN_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_RETRIEVAL_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_SYNTHESIS_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_CAMPUS_SERVICES_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_NOTICE_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_NAVIGATION_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_FINALIZATION_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT",
  "EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS",
  "EXECUTION_CONTROL_SHARED_SECRET",
  "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET",
  "EXECUTION_CONTROL_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339",
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
  "PERSONAL_MEMORY_BASE_URL",
  "PERSONAL_MEMORY_API_SECRET",
  "PERSONAL_MEMORY_OWNER_SALT",
  "HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY",
  "HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL",
  "HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL",
  "HINDSIGHT_API_EMBEDDINGS_PROVIDER",
  "HINDSIGHT_API_IMAGE",
  "HINDSIGHT_API_LLM_API_KEY",
  "HINDSIGHT_API_LLM_BASE_URL",
  "HINDSIGHT_API_LLM_MODEL",
  "HINDSIGHT_API_LLM_PROVIDER",
  "HINDSIGHT_API_RERANKER_PROVIDER",
  "HINDSIGHT_POSTGRES_PASSWORD",
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
  "";
const agentRuntimeExecutionControlSharedSecret =
  process.env.AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET?.trim() ||
  internalQuerySharedSecret;
if (agentRuntimeExecutionControlSharedSecret !== internalQuerySharedSecret) {
  throw new Error(
    "AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET must match EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET",
  );
}
const agentRuntimeSharedSecret =
  process.env.EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET?.trim() ||
  process.env.AGENT_RUNTIME_SHARED_SECRET?.trim() ||
  "";
const appApiInternalBaseUrl =
  process.env.EXECUTION_CONTROL_APP_API_INTERNAL_BASE_URL?.trim() ||
  process.env.APP_API_INTERNAL_BASE_URL?.trim() ||
  "http://host.docker.internal:27031";
const appApiInternalSharedSecret =
  process.env.EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET?.trim() ||
  process.env.APP_API_INTERNAL_SHARED_SECRET?.trim() ||
  "";
const qdrantQueryAPIKey =
  process.env.QDRANT_QUERY_API_KEY?.trim() ||
  process.env.QDRANT_READ_ONLY_API_KEY?.trim() ||
  "";

function deriveAgentRuntimeBridgeSecret() {
  if (!workerSharedSecret || !internalQuerySharedSecret) {
    return "";
  }
  return crypto
    .createHash("sha256")
    .update("campus-agent:agent-runtime-bridge:v1\0")
    .update(workerSharedSecret)
    .update("\0")
    .update(internalQuerySharedSecret)
    .digest("hex");
}

const resolvedAgentRuntimeSharedSecret =
  agentRuntimeSharedSecret || deriveAgentRuntimeBridgeSecret();

resolved.set("API_WORKER_SHARED_SECRET", workerSharedSecret);
resolved.set("EXECUTION_CONTROL_COMPOSE_PROJECT_DIRECTORY", repoRoot);
resolved.set("EXECUTION_CONTROL_COMPOSE_PROJECT_NAME", composeProjectName);
if (qdrantQueryAPIKey) {
  resolved.set("QDRANT_QUERY_API_KEY", qdrantQueryAPIKey);
}
if (internalQuerySharedSecret) {
  resolved.set("EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET", internalQuerySharedSecret);
  resolved.set("AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET", agentRuntimeExecutionControlSharedSecret);
}
if (resolvedAgentRuntimeSharedSecret) {
  resolved.set("EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET", resolvedAgentRuntimeSharedSecret);
  resolved.set("AGENT_RUNTIME_SHARED_SECRET", resolvedAgentRuntimeSharedSecret);
}
if (!resolved.get("EXECUTION_CONTROL_RUNTIME_CONFIG_PATH")) {
  resolved.set("EXECUTION_CONTROL_RUNTIME_CONFIG_PATH", "/etc/campus-agent/runtime-profile.local-real-provider.json");
}
resolved.set("EXECUTION_CONTROL_APP_API_INTERNAL_BASE_URL", appApiInternalBaseUrl.replace(/\/+$/, ""));
if (appApiInternalSharedSecret) {
  resolved.set("EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET", appApiInternalSharedSecret);
}
if (!resolved.get("EXECUTION_CONTROL_APP_API_INTERNAL_TIMEOUT_MS")) {
  resolved.set("EXECUTION_CONTROL_APP_API_INTERNAL_TIMEOUT_MS", "1000");
}
if (!resolved.get("EXECUTION_CONTROL_APP_API_BASE_URL")) {
  resolved.set("EXECUTION_CONTROL_APP_API_BASE_URL", appApiInternalBaseUrl.replace(/\/+$/, ""));
}
if (!resolved.get("EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL")) {
  resolved.set(
    "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL",
    "postgresql://postgres:postgres@campus-agent-postgres:5432/campus_agent?sslmode=disable",
  );
}
if (!resolved.get("CAMPUS_SHARED_POSTGRES_URL")) {
  resolved.set("CAMPUS_SHARED_POSTGRES_URL", "postgresql://postgres:postgres@campus-agent-postgres:5432/campus_agent?sslmode=disable");
}
if (!resolved.get("DOCUMENT_REGISTRY_DATABASE_URL")) {
  resolved.set("DOCUMENT_REGISTRY_DATABASE_URL", "postgresql://postgres:postgres@campus-agent-postgres:5432/campus_agent?sslmode=disable");
}
if (!resolved.get("QDRANT_URL")) {
  resolved.set("QDRANT_URL", "http://qdrant:6333");
}
if (!resolved.get("EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL")) {
  resolved.set("EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL", "http://agent-runtime:27062");
}
if (!resolved.get("EXECUTION_CONTROL_AGENT_RUNTIME_TIMEOUT_MS")) {
  resolved.set("EXECUTION_CONTROL_AGENT_RUNTIME_TIMEOUT_MS", "30000");
}
if (!resolved.get("AGENT_RUNTIME_PORT")) {
  resolved.set("AGENT_RUNTIME_PORT", "27062");
}
if (!resolved.get("AGENT_RUNTIME_TOOL_CATALOG_PATH")) {
  resolved.set("AGENT_RUNTIME_TOOL_CATALOG_PATH", "configs/runtime/tool-catalog.v1.json");
}
if (!resolved.get("AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL")) {
  resolved.set("AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL", "http://execution-control:8000");
}
if (!resolved.get("EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY")) {
  resolved.set("EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY", "local:execution-control:001");
}
if (!resolved.get("EXECUTION_CONTROL_TEMPORAL_ADDRESS")) {
  resolved.set("EXECUTION_CONTROL_TEMPORAL_ADDRESS", "temporal:7233");
}
if (!resolved.get("EXECUTION_CONTROL_TEMPORAL_NAMESPACE")) {
  resolved.set("EXECUTION_CONTROL_TEMPORAL_NAMESPACE", "campus-agent-staging");
}
if (!resolved.get("EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY")) {
  resolved.set("EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY", "local:workflow-worker:001");
}
if (!resolved.get("EXECUTION_CONTROL_TEMPORAL_CONTEXT_WORKER_IDENTITY")) {
  resolved.set("EXECUTION_CONTROL_TEMPORAL_CONTEXT_WORKER_IDENTITY", "local:activity-context:001");
}
if (!resolved.get("EXECUTION_CONTROL_TEMPORAL_AGENT_WORKER_IDENTITY")) {
  resolved.set("EXECUTION_CONTROL_TEMPORAL_AGENT_WORKER_IDENTITY", "local:activity-agent:001");
}
if (!resolved.get("EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_PLAN_WORKER_IDENTITY")) {
  resolved.set("EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_PLAN_WORKER_IDENTITY", "local:activity-knowledge-plan:001");
}
if (!resolved.get("EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_RETRIEVAL_WORKER_IDENTITY")) {
  resolved.set(
    "EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_RETRIEVAL_WORKER_IDENTITY",
    "local:activity-knowledge-retrieval:001",
  );
}
if (!resolved.get("EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_SYNTHESIS_WORKER_IDENTITY")) {
  resolved.set(
    "EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_SYNTHESIS_WORKER_IDENTITY",
    "local:activity-knowledge-synthesis:001",
  );
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
if (!resolved.get("EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE_SAMPLER_IDENTITY")) {
  resolved.set(
    "EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE_SAMPLER_IDENTITY",
    "local:temporal-task-queue-sampler:001",
  );
}
if (!resolved.get("PERSONAL_MEMORY_BASE_URL")) {
  resolved.set("PERSONAL_MEMORY_BASE_URL", "http://hindsight-api:8888");
}
if (!resolved.get("HINDSIGHT_API_LLM_MODEL")) {
  resolved.set("HINDSIGHT_API_LLM_MODEL", "gpt-4o-mini");
}
if (!resolved.get("HINDSIGHT_API_LLM_PROVIDER")) {
  resolved.set("HINDSIGHT_API_LLM_PROVIDER", "openai");
}
if (!resolved.get("HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY")) {
  const embeddingsApiKey = process.env.EMBEDDING_API_KEY?.trim() || resolved.get("HINDSIGHT_API_LLM_API_KEY") || "";
  if (embeddingsApiKey) {
    resolved.set("HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY", embeddingsApiKey);
  }
}
if (!resolved.get("HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL")) {
  const embeddingsBaseUrl = process.env.EMBEDDING_BASE_URL?.trim() || resolved.get("HINDSIGHT_API_LLM_BASE_URL") || "";
  if (embeddingsBaseUrl) {
    resolved.set("HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL", embeddingsBaseUrl);
  }
}
if (!resolved.get("HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL")) {
  resolved.set("HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL", process.env.EMBEDDING_MODEL?.trim() || "text-embedding-3-small");
}
if (!resolved.get("HINDSIGHT_API_EMBEDDINGS_PROVIDER")) {
  resolved.set("HINDSIGHT_API_EMBEDDINGS_PROVIDER", "openai");
}
if (!resolved.get("HINDSIGHT_API_IMAGE")) {
  resolved.set("HINDSIGHT_API_IMAGE", "ghcr.io/vectorize-io/hindsight-api:0.8.2");
}
if (!resolved.get("HINDSIGHT_API_RERANKER_PROVIDER")) {
  resolved.set("HINDSIGHT_API_RERANKER_PROVIDER", "rrf");
}

for (const [key, value] of resolved.entries()) {
  let outputValue = value;
  if (key === "DOCUMENT_REGISTRY_DATABASE_URL" || key === "CAMPUS_SHARED_POSTGRES_URL") {
    outputValue = projectLocalServiceDns(value, "campus-agent-postgres");
  } else if (key === "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL") {
    outputValue = projectLocalServiceDns(value, "campus-agent-postgres");
  } else if (key === "OBJECT_STORE_ENDPOINT") {
    outputValue = projectLocalServiceDns(value, "minio");
  } else if (key === "QDRANT_URL") {
    outputValue = projectLocalServiceDns(value, "qdrant");
  } else if (key === "EXECUTION_CONTROL_APP_API_INTERNAL_BASE_URL") {
    outputValue = projectLocalServiceDns(value, "host.docker.internal");
  } else if (key === "HINDSIGHT_API_LLM_BASE_URL" || key === "HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL") {
    outputValue = projectLocalServiceDns(value, "host.docker.internal");
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
  if [[ "${QDRANT_URL}" != http://* && "${QDRANT_URL}" != https://* ]]; then
    echo "QDRANT_URL must use http or https." >&2
    return 1
  fi
  if [[ -z "${QDRANT_QUERY_API_KEY:-}" ]]; then
    echo "QDRANT_QUERY_API_KEY is required for online Qdrant query access." >&2
    return 1
  fi
  if [[ "${QDRANT_URL}" == https://* ]]; then
    if [[ -z "${QDRANT_TLS_CA_CERT_PATH:-}" ]]; then
      echo "QDRANT_TLS_CA_CERT_PATH is required for HTTPS Qdrant data-plane." >&2
      return 1
    fi
    if [[ -z "${QDRANT_TLS_DIR:-}" ]]; then
      echo "QDRANT_TLS_DIR is required for mounting Qdrant TLS trust material." >&2
      return 1
    fi
  fi
  if [[ -z "${EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET:-}" ]]; then
    echo "EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET or APP_API_INTERNAL_SHARED_SECRET is required for provider-config runtime access." >&2
    return 1
  fi
  if [[ -z "${HINDSIGHT_POSTGRES_PASSWORD:-}" ]]; then
    echo "HINDSIGHT_POSTGRES_PASSWORD is required for local Hindsight Postgres." >&2
    return 1
  fi
  if [[ -z "${PERSONAL_MEMORY_API_SECRET:-}" ]]; then
    echo "PERSONAL_MEMORY_API_SECRET is required for Hindsight API authentication." >&2
    return 1
  fi
  if [[ -z "${PERSONAL_MEMORY_OWNER_SALT:-}" ]]; then
    echo "PERSONAL_MEMORY_OWNER_SALT is required for Hindsight scoped bank ids." >&2
    return 1
  fi
  if [[ -z "${HINDSIGHT_API_LLM_API_KEY:-}" ]]; then
    echo "HINDSIGHT_API_LLM_API_KEY is required for Hindsight retain/recall." >&2
    return 1
  fi
  if [[ -z "${HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY:-}" ]]; then
    echo "HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY or EMBEDDING_API_KEY is required for Hindsight embeddings." >&2
    return 1
  fi
}

print_projected_env() {
  ensure_local_runtime_secrets
  load_runtime_env
  execution_control_runtime_require_runtime_env
  env -0
}

main() {
  local docker_bin

  docker_bin="$(require_command docker)"
  ensure_local_runtime_secrets
  load_runtime_env
  execution_control_runtime_require_runtime_env
  ensure_data_plane_network

  if [[ "$#" -eq 0 ]]; then
    set -- up -d --build --remove-orphans
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

if [[ "${1:-}" == "__campus_agent_print_projected_env" ]]; then
  print_projected_env
else
  main "$@"
fi
