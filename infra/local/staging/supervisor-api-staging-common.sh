#!/usr/bin/env bash

supervisor_api_staging_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
supervisor_api_staging_repo_root="$(cd "${supervisor_api_staging_script_dir}/../../.." && pwd)"

supervisor_api_staging_runtime_dir="${SUPERVISOR_API_STAGING_RUNTIME_DIR:-${supervisor_api_staging_repo_root}/.tmp/supervisor-api-staging}"
supervisor_api_staging_log_dir="${supervisor_api_staging_runtime_dir}/logs"
supervisor_api_staging_lock_file="${supervisor_api_staging_runtime_dir}/lifecycle.lock"
supervisor_api_staging_cloudflared_pid_file="${supervisor_api_staging_runtime_dir}/cloudflared.pid"
supervisor_api_staging_cloudflared_log_file="${supervisor_api_staging_log_dir}/cloudflared.log"
supervisor_api_staging_supervisor_api_log_file="${supervisor_api_staging_log_dir}/supervisor-api.log"
supervisor_api_staging_supervisor_agent_worker_log_file="${supervisor_api_staging_log_dir}/supervisor-agent-worker.log"
supervisor_api_staging_otel_collector_log_file="${supervisor_api_staging_log_dir}/otel-collector.log"

supervisor_api_staging_host="${SUPERVISOR_API_STAGING_HOST:-127.0.0.1}"
supervisor_api_staging_port="${SUPERVISOR_API_STAGING_PORT:-27051}"
supervisor_api_staging_compose_file="${SUPERVISOR_API_STAGING_COMPOSE_FILE:-${supervisor_api_staging_repo_root}/infra/local/docker-compose.supervisor-runtime.yml}"
supervisor_api_staging_compose_project_name="${SUPERVISOR_API_STAGING_COMPOSE_PROJECT_NAME:-campus-supervisor-api-staging}"
supervisor_api_staging_tunnel_name="${SUPERVISOR_API_STAGING_TUNNEL_NAME:-supervisor-api-staging}"
supervisor_api_staging_public_base_url="${SUPERVISOR_API_STAGING_PUBLIC_BASE_URL:-https://exec-staging.mucwiki-edge.link}"
supervisor_api_staging_app_api_base_url="${SUPERVISOR_API_STAGING_APP_API_BASE_URL:-https://api-staging.mucwiki-edge.link}"
supervisor_api_staging_cloudflared_metrics_address="${SUPERVISOR_API_STAGING_CLOUDFLARED_METRICS_ADDRESS:-127.0.0.1:20245}"
supervisor_api_staging_cloudflared_edge_ip_version="${SUPERVISOR_API_STAGING_CLOUDFLARED_EDGE_IP_VERSION:-4}"
supervisor_api_staging_lock_wait_seconds="${SUPERVISOR_API_STAGING_LOCK_WAIT_SECONDS:-180}"
supervisor_api_staging_cloudflared_match_pattern="${SUPERVISOR_API_STAGING_CLOUDFLARED_MATCH_PATTERN:-cloudflared tunnel .* run}"
supervisor_api_staging_log_rotate_max_bytes=$((20 * 1024 * 1024))
supervisor_api_staging_log_rotate_keep_count=5

supervisor_api_staging_local_healthz_url="http://${supervisor_api_staging_host}:${supervisor_api_staging_port}/healthz"
supervisor_api_staging_local_readyz_url="http://${supervisor_api_staging_host}:${supervisor_api_staging_port}/readyz"
supervisor_api_staging_local_metrics_url="http://${supervisor_api_staging_host}:${supervisor_api_staging_port}/metrics"
supervisor_api_staging_app_api_readyz_url=""
if [[ -n "${supervisor_api_staging_app_api_base_url}" ]]; then
  supervisor_api_staging_app_api_readyz_url="${supervisor_api_staging_app_api_base_url%/}/readyz"
fi

supervisor_api_staging_bridge_shared_secret=""

supervisor_api_staging_runtime_globals_declared() {
  : "${supervisor_api_staging_runtime_dir}" \
    "${supervisor_api_staging_log_dir}" \
    "${supervisor_api_staging_lock_file}" \
    "${supervisor_api_staging_cloudflared_pid_file}" \
    "${supervisor_api_staging_cloudflared_log_file}" \
    "${supervisor_api_staging_supervisor_api_log_file}" \
    "${supervisor_api_staging_supervisor_agent_worker_log_file}" \
    "${supervisor_api_staging_otel_collector_log_file}" \
    "${supervisor_api_staging_host}" \
    "${supervisor_api_staging_port}" \
    "${supervisor_api_staging_compose_file}" \
    "${supervisor_api_staging_compose_project_name}" \
    "${supervisor_api_staging_tunnel_name}" \
    "${supervisor_api_staging_public_base_url}" \
    "${supervisor_api_staging_app_api_base_url}" \
    "${supervisor_api_staging_cloudflared_metrics_address}" \
    "${supervisor_api_staging_cloudflared_edge_ip_version}" \
    "${supervisor_api_staging_lock_wait_seconds}" \
    "${supervisor_api_staging_cloudflared_match_pattern}" \
    "${supervisor_api_staging_log_rotate_max_bytes}" \
    "${supervisor_api_staging_log_rotate_keep_count}" \
    "${supervisor_api_staging_local_healthz_url}" \
    "${supervisor_api_staging_local_readyz_url}" \
    "${supervisor_api_staging_local_metrics_url}" \
    "${supervisor_api_staging_app_api_readyz_url}"
}

supervisor_api_staging_ensure_runtime_dirs() {
  mkdir -p "${supervisor_api_staging_log_dir}"
}

supervisor_api_staging_acquire_lock() {
  local wait_seconds="${1:-${supervisor_api_staging_lock_wait_seconds}}"

  exec 9>"${supervisor_api_staging_lock_file}"
  if ! flock -w "${wait_seconds}" 9; then
    echo "Timed out waiting for ${supervisor_api_staging_lock_file}; another staging lifecycle command is still active." >&2
    return 1
  fi
}

supervisor_api_staging_require_command() {
  local command_name="$1"
  local resolved

  resolved="$(command -v "${command_name}" || true)"
  if [[ -z "${resolved}" ]]; then
    echo "Missing required command: ${command_name}" >&2
    return 1
  fi

  printf '%s\n' "${resolved}"
}

supervisor_api_staging_load_env() {
  local node_bin
  local repo_env_path="${supervisor_api_staging_repo_root}/.env"
  local repo_staging_env_path="${supervisor_api_staging_repo_root}/.env.staging.local"
  local app_api_dev_vars="${supervisor_api_staging_repo_root}/apps/app-api/.dev.vars"
  local export_script

  node_bin="$(supervisor_api_staging_require_command node)"
  export_script="$(
    "${node_bin}" - "${repo_env_path}" "${repo_staging_env_path}" "${app_api_dev_vars}" <<'NODE'
const [repoEnvPath, repoStagingEnvPath, appApiDevVarsPath] = process.argv.slice(2);
const loadedPaths = [];
for (const filePath of [repoEnvPath, repoStagingEnvPath, appApiDevVarsPath]) {
  if (!filePath) {
    continue;
  }
  try {
    process.loadEnvFile(filePath);
    loadedPaths.push(filePath);
  } catch (error) {
    if (!(error instanceof Error && "code" in error) || error.code !== "ENOENT") {
      throw error;
    }
  }
}

const keys = [
  "CAMPUS_AGENT_APP_NAME",
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
  "SUPERVISOR_API_RUNTIME_PROFILE",
  "SUPERVISOR_API_QUEUE_CAPACITY",
  "SUPERVISOR_API_QUEUE_TIMEOUT_MS",
  "SUPERVISOR_API_REQUEST_TIMEOUT_MS",
  "SUPERVISOR_API_SHUTDOWN_GRACE_MS",
  "SUPERVISOR_API_METRICS_BEARER_TOKEN",
  "SUPERVISOR_API_OTEL_ENABLED",
  "SUPERVISOR_API_OTEL_METRICS_ENABLED",
  "SUPERVISOR_API_OTEL_EXPORTER_OTLP_HEADERS",
  "SUPERVISOR_API_OTEL_SERVICE_NAME",
  "SUPERVISOR_API_OTEL_EXPORT_TIMEOUT_MS",
  "SUPERVISOR_API_OTEL_EXPORT_INTERVAL_MS",
  "SUPERVISOR_AGENT_WORKER_OTEL_ENABLED",
  "SUPERVISOR_AGENT_WORKER_OTEL_SERVICE_NAME",
  "SUPERVISOR_AGENT_WORKER_OTEL_ALLOWED_ATTRIBUTES_VERSION",
  "SUPERVISOR_AGENT_WORKER_OTEL_EXPORT_TIMEOUT_SECONDS",
  "SUPERVISOR_AGENT_WORKER_OTEL_EXPORT_INTERVAL_SECONDS",
  "SUPERVISOR_AGENT_WORKER_OTEL_EXPORTER_OTLP_HEADERS",
  "OTEL_COLLECTOR_OTLP_GRPC_ENDPOINT",
  "OTEL_COLLECTOR_OTLP_HTTP_ENDPOINT",
  "OTEL_COLLECTOR_HEALTH_CHECK_ENDPOINT",
  "OTEL_COLLECTOR_MEMORY_LIMIT_MIB",
  "OTEL_COLLECTOR_MEMORY_SPIKE_LIMIT_MIB",
  "OTEL_COLLECTOR_TRACE_SAMPLING_PERCENTAGE",
  "OTEL_COLLECTOR_LOG_SAMPLING_PERCENTAGE",
  "OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT",
  "OTEL_COLLECTOR_SENTRY_AUTH_VALUE",
  "AXIOM_ENDPOINT",
  "OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT",
  "OTEL_COLLECTOR_AXIOM_AUTH_HEADER",
  "OTEL_COLLECTOR_AXIOM_EVENTS_DATASET",
  "OTEL_COLLECTOR_AXIOM_METRICS_DATASET",
  "SUPERVISOR_API_EXECUTION_AUDIT_ENABLED",
  "SUPERVISOR_API_EXECUTION_AUDIT_URL",
  "SUPERVISOR_API_EXECUTION_AUDIT_SHARED_SECRET",
  "SUPERVISOR_API_EXECUTION_AUDIT_TIMEOUT_MS",
  "SUPERVISOR_AGENT_WORKER_THREADS",
  "SUPERVISOR_AGENT_WORKER_BASE_URL",
  "SUPERVISOR_API_SHARED_SECRET",
  "SUPERVISOR_AGENT_WORKER_TIMEOUT_MS",
  "SUPERVISOR_API_BRIDGE_BREAKER_FAILURE_THRESHOLD",
  "SUPERVISOR_API_BRIDGE_BREAKER_OPEN_MS",
  "SUPERVISOR_API_BRIDGE_RETRY_MAX_ATTEMPTS",
  "SUPERVISOR_API_BRIDGE_RETRY_BASE_MS",
  "SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET",
  "SUPERVISOR_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339",
  "SUPERVISOR_STRUCTURED_QUERY_TIMEOUT_MS",
  "SUPERVISOR_STRUCTURED_QUERY_TIMEOUT_SECONDS",
  "INTERNAL_NOTICE_READ_MODEL_DATABASE_URL",
  "INTERNAL_NOTICE_READ_MODEL_TABLE",
  "SUPERVISOR_API_STAGING_UV_BIN",
  "SUPERVISOR_API_STAGING_TUNNEL_TOKEN",
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

const bridgeSharedSecret =
  process.env.SUPERVISOR_AGENT_WORKER_STAGING_SHARED_SECRET?.trim() ||
  process.env.SUPERVISOR_AGENT_WORKER_SHARED_SECRET?.trim() ||
  "";
const bridgeBaseUrl =
  process.env.SUPERVISOR_AGENT_WORKER_BASE_URL?.trim() ||
  "http://supervisor-agent-worker:27052";
resolved.set("SUPERVISOR_AGENT_WORKER_SHARED_SECRET", bridgeSharedSecret);
resolved.set("SUPERVISOR_AGENT_WORKER_BASE_URL", bridgeBaseUrl);

const stagingRequiredMappings = [
  ["STAGING_INGESTION_SHARED_POSTGRES_URL", "CAMPUS_SHARED_POSTGRES_URL"],
  ["STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL", "DOCUMENT_REGISTRY_DATABASE_URL"],
  ["STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL", "RAW_ASSET_REGISTRY_DATABASE_URL"],
  ["STAGING_INGESTION_OBJECT_STORE_ENDPOINT", "OBJECT_STORE_ENDPOINT"],
  ["STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED", "OBJECT_STORE_BUCKET_DERIVED"],
  ["STAGING_INGESTION_QDRANT_URL", "QDRANT_URL"],
  ["STAGING_INGESTION_EMBEDDING_PROVIDER", "EMBEDDING_PROVIDER"],
  ["STAGING_INGESTION_EMBEDDING_MODEL", "EMBEDDING_MODEL"],
  ["STAGING_INGESTION_EMBEDDING_DIMENSIONS", "EMBEDDING_DIMENSIONS"],
  ["STAGING_INGESTION_SPARSE_PROVIDER", "SPARSE_PROVIDER"],
  ["STAGING_INGESTION_SPARSE_MODEL", "SPARSE_MODEL"],
  ["STAGING_INGESTION_SPARSE_TOKENIZER", "SPARSE_TOKENIZER"],
  ["STAGING_INGESTION_SPARSE_LANGUAGE", "SPARSE_LANGUAGE"],
];
const stagingOptionalMappings = [
  ["STAGING_INGESTION_SHARED_POSTGRES_OPERATOR_URL", "CAMPUS_SHARED_POSTGRES_OPERATOR_URL"],
  [
    "STAGING_INGESTION_DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL",
    "DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL",
  ],
  [
    "STAGING_INGESTION_RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL",
    "RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL",
  ],
  ["STAGING_INGESTION_OBJECT_STORE_ACCESS_KEY", "OBJECT_STORE_ACCESS_KEY"],
  ["STAGING_INGESTION_OBJECT_STORE_SECRET_KEY", "OBJECT_STORE_SECRET_KEY"],
  ["STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY", "OBJECT_STORE_DERIVED_ACCESS_KEY"],
  ["STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY", "OBJECT_STORE_DERIVED_SECRET_KEY"],
  ["STAGING_INGESTION_OBJECT_STORE_REGION", "OBJECT_STORE_REGION"],
  ["STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED", "OBJECT_STORE_BUCKET_DERIVED"],
  ["STAGING_INGESTION_QDRANT_API_KEY", "QDRANT_API_KEY"],
  ["STAGING_INGESTION_QDRANT_TIMEOUT_SECONDS", "QDRANT_TIMEOUT_SECONDS"],
  ["STAGING_INGESTION_EMBEDDING_BASE_URL", "EMBEDDING_BASE_URL"],
  ["STAGING_INGESTION_EMBEDDING_API_KEY", "EMBEDDING_API_KEY"],
];

function envValue(key) {
  return process.env[key]?.trim() || "";
}

function isLocalEndpoint(value) {
  if (!value) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return ["127.0.0.1", "localhost", "host.docker.internal"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function acceptsSameHostStagingEndpoint(source) {
  return source === "STAGING_INGESTION_QDRANT_URL";
}

function projectDataPlaneValue(source, value) {
  if (acceptsSameHostStagingEndpoint(source)) {
    return rewriteLocalhostForDocker(value);
  }
  return value;
}

function validateStagingPostgresRuntimeUrl(errors, source, value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    errors.push(`${source} must be a valid postgres URL`);
    return;
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    errors.push(`${source} must be a postgres URL`);
    return;
  }
  const hostname = parsed.hostname.toLowerCase();
  const isSupabaseSessionPooler = hostname.endsWith(".pooler.supabase.com");
  const isSupabaseDirectHost = hostname.endsWith(".supabase.co") && hostname.startsWith("db.");
  if (isSupabaseSessionPooler) {
    if (parsed.port && parsed.port !== "5432") {
      errors.push(`${source} must use the Supabase session pooler on port 5432`);
      return;
    }
    if (parsed.searchParams.get("sslmode") !== "require") {
      errors.push(`${source} must include sslmode=require for Supabase session pooler`);
    }
    return;
  }
  if (isSupabaseDirectHost) {
    errors.push(`${source} must use the Supabase session pooler, not direct connection`);
  }
}

function hasPair(accessKeyName, secretKeyName) {
  return Boolean(envValue(accessKeyName) && envValue(secretKeyName));
}

function requireCompletePair(errors, accessKeyName, secretKeyName) {
  const hasAccessKey = Boolean(envValue(accessKeyName));
  const hasSecretKey = Boolean(envValue(secretKeyName));
  if (hasAccessKey === hasSecretKey) {
    return;
  }
  errors.push(`${accessKeyName} and ${secretKeyName} must be configured together`);
}

const dataPlaneErrors = [];
for (const [source, target] of stagingRequiredMappings) {
  const value = envValue(source);
  if (!value) {
    dataPlaneErrors.push(`${source} is required for supervisor-api staging data plane`);
    continue;
  }
  if (isLocalEndpoint(value) && !acceptsSameHostStagingEndpoint(source)) {
    dataPlaneErrors.push(`${source} must not point at localhost for supervisor-api staging`);
    continue;
  }
  if (
    source === "STAGING_INGESTION_SHARED_POSTGRES_URL" ||
    source === "STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL" ||
    source === "STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL"
  ) {
    validateStagingPostgresRuntimeUrl(dataPlaneErrors, source, value);
  }
  resolved.set(target, value);
  if (source === "STAGING_INGESTION_QDRANT_URL") {
    resolved.set("QDRANT_DOCKER_URL", projectDataPlaneValue(source, value));
  }
}
for (const [source, target] of stagingOptionalMappings) {
  const value = envValue(source);
  if (value) {
    if (
      [
        "STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL",
        "STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL",
        "STAGING_INGESTION_OBJECT_STORE_ENDPOINT",
      ].includes(source) &&
      isLocalEndpoint(value)
    ) {
      dataPlaneErrors.push(`${source} must not point at localhost for supervisor-api staging`);
      continue;
    }
    if (
      [
        "STAGING_INGESTION_SHARED_POSTGRES_OPERATOR_URL",
        "STAGING_INGESTION_DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL",
        "STAGING_INGESTION_RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL",
      ].includes(source)
    ) {
      validateStagingPostgresRuntimeUrl(dataPlaneErrors, source, value);
    }
    resolved.set(target, value);
    if (source === "STAGING_INGESTION_QDRANT_URL") {
      resolved.set("QDRANT_DOCKER_URL", projectDataPlaneValue(source, value));
    }
  }
}
requireCompletePair(
  dataPlaneErrors,
  "STAGING_INGESTION_OBJECT_STORE_ACCESS_KEY",
  "STAGING_INGESTION_OBJECT_STORE_SECRET_KEY",
);
requireCompletePair(
  dataPlaneErrors,
  "STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY",
  "STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY",
);
if (
  !(
    hasPair(
      "STAGING_INGESTION_OBJECT_STORE_ACCESS_KEY",
      "STAGING_INGESTION_OBJECT_STORE_SECRET_KEY",
    ) ||
    hasPair(
      "STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY",
      "STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY",
    )
  )
) {
  dataPlaneErrors.push(
    "staging supervisor object-store credentials are required: configure shared or derived credential pair",
  );
}
resolved.set("SUPERVISOR_API_STAGING_DATA_PLANE_ERRORS", dataPlaneErrors.join("\n"));

for (const [key, value] of resolved.entries()) {
  if (
    key === "SUPERVISOR_API_EXECUTION_AUDIT_URL"
  ) {
    process.stdout.write(`export ${key}=${JSON.stringify(rewriteLocalhostForDocker(value))}\n`);
    continue;
  }
  process.stdout.write(`export ${key}=${JSON.stringify(value)}\n`);
}
NODE
  )"
  eval "${export_script}"

  supervisor_api_staging_bridge_shared_secret="${SUPERVISOR_AGENT_WORKER_SHARED_SECRET:-}"
  if [[ -z "${SUPERVISOR_API_EXECUTION_AUDIT_URL:-}" && -n "${supervisor_api_staging_app_api_base_url}" ]]; then
    export SUPERVISOR_API_EXECUTION_AUDIT_URL="${supervisor_api_staging_app_api_base_url%/}/api/internal/execution/audit-events"
  fi
  if [[ -z "${SUPERVISOR_API_EXECUTION_AUDIT_SHARED_SECRET:-}" && -n "${APP_API_INTERNAL_SHARED_SECRET:-}" ]]; then
    export SUPERVISOR_API_EXECUTION_AUDIT_SHARED_SECRET="${APP_API_INTERNAL_SHARED_SECRET}"
  fi
  if [[ -z "${SUPERVISOR_API_EXECUTION_AUDIT_ENABLED:-}" ]]; then
    if [[ -n "${SUPERVISOR_API_EXECUTION_AUDIT_URL:-}" && -n "${SUPERVISOR_API_EXECUTION_AUDIT_SHARED_SECRET:-}" ]]; then
      export SUPERVISOR_API_EXECUTION_AUDIT_ENABLED=true
    else
      export SUPERVISOR_API_EXECUTION_AUDIT_ENABLED=false
    fi
  fi
  export SUPERVISOR_API_EXECUTION_AUDIT_TIMEOUT_MS="${SUPERVISOR_API_EXECUTION_AUDIT_TIMEOUT_MS:-500}"
  export SUPERVISOR_API_OTEL_ENABLED="${SUPERVISOR_API_OTEL_ENABLED:-true}"
  export SUPERVISOR_API_OTEL_METRICS_ENABLED="${SUPERVISOR_API_OTEL_METRICS_ENABLED:-true}"
  export SUPERVISOR_API_OTEL_EXPORT_TIMEOUT_MS="${SUPERVISOR_API_OTEL_EXPORT_TIMEOUT_MS:-1000}"
  export SUPERVISOR_API_OTEL_EXPORT_INTERVAL_MS="${SUPERVISOR_API_OTEL_EXPORT_INTERVAL_MS:-15000}"
  export SUPERVISOR_AGENT_WORKER_OTEL_ENABLED="${SUPERVISOR_AGENT_WORKER_OTEL_ENABLED:-true}"
  export SUPERVISOR_AGENT_WORKER_OTEL_SERVICE_NAME="${SUPERVISOR_AGENT_WORKER_OTEL_SERVICE_NAME:-campus-supervisor-agent-worker}"
  export SUPERVISOR_AGENT_WORKER_OTEL_ALLOWED_ATTRIBUTES_VERSION="${SUPERVISOR_AGENT_WORKER_OTEL_ALLOWED_ATTRIBUTES_VERSION:-supervisor-agent-worker-otel-attrs-v1}"
  export SUPERVISOR_AGENT_WORKER_OTEL_EXPORT_TIMEOUT_SECONDS="${SUPERVISOR_AGENT_WORKER_OTEL_EXPORT_TIMEOUT_SECONDS:-1}"
  export SUPERVISOR_AGENT_WORKER_OTEL_EXPORT_INTERVAL_SECONDS="${SUPERVISOR_AGENT_WORKER_OTEL_EXPORT_INTERVAL_SECONDS:-5}"
  export DEPLOYMENT_ENVIRONMENT="${DEPLOYMENT_ENVIRONMENT:-staging}"
  export OTEL_COLLECTOR_OTLP_GRPC_ENDPOINT="${OTEL_COLLECTOR_OTLP_GRPC_ENDPOINT:-0.0.0.0:4317}"
  export OTEL_COLLECTOR_OTLP_HTTP_ENDPOINT="${OTEL_COLLECTOR_OTLP_HTTP_ENDPOINT:-0.0.0.0:4318}"
  export OTEL_COLLECTOR_HEALTH_CHECK_ENDPOINT="${OTEL_COLLECTOR_HEALTH_CHECK_ENDPOINT:-0.0.0.0:13133}"
  export OTEL_COLLECTOR_MEMORY_LIMIT_MIB="${OTEL_COLLECTOR_MEMORY_LIMIT_MIB:-512}"
  export OTEL_COLLECTOR_MEMORY_SPIKE_LIMIT_MIB="${OTEL_COLLECTOR_MEMORY_SPIKE_LIMIT_MIB:-128}"
  export OTEL_COLLECTOR_TRACE_SAMPLING_PERCENTAGE="${OTEL_COLLECTOR_TRACE_SAMPLING_PERCENTAGE:-100}"
  export OTEL_COLLECTOR_LOG_SAMPLING_PERCENTAGE="${OTEL_COLLECTOR_LOG_SAMPLING_PERCENTAGE:-100}"
}

supervisor_api_staging_read_pid() {
  local pid_file="$1"

  if [[ ! -f "${pid_file}" ]]; then
    return 1
  fi

  tr -d '[:space:]' <"${pid_file}"
}

supervisor_api_staging_pid_is_running() {
  local pid_file="$1"
  local pid
  local kill_output

  pid="$(supervisor_api_staging_read_pid "${pid_file}" 2>/dev/null || true)"
  if [[ -z "${pid}" ]]; then
    return 1
  fi

  if kill -0 "${pid}" 2>/dev/null; then
    return 0
  fi

  kill_output="$(kill -0 "${pid}" 2>&1 || true)"
  if [[ "${kill_output}" == *"Operation not permitted"* ]]; then
    return 0
  fi

  return 1
}

supervisor_api_staging_cleanup_stale_pidfile() {
  local pid_file="$1"

  if [[ -f "${pid_file}" ]] && ! supervisor_api_staging_pid_is_running "${pid_file}"; then
    rm -f "${pid_file}"
  fi
}

supervisor_api_staging_adopt_existing_process() {
  local label="$1"
  local pid_file="$2"
  local match_pattern="$3"
  local -a matched_pids

  supervisor_api_staging_cleanup_stale_pidfile "${pid_file}"
  if supervisor_api_staging_pid_is_running "${pid_file}"; then
    return 0
  fi

  mapfile -t matched_pids < <(pgrep -f -- "${match_pattern}" || true)
  if (( ${#matched_pids[@]} == 1 )); then
    printf '%s\n' "${matched_pids[0]}" >"${pid_file}"
    echo "${label}: adopted existing pid ${matched_pids[0]}"
    return 0
  fi

  if (( ${#matched_pids[@]} > 1 )); then
    echo "${label}: multiple matching processes found (${matched_pids[*]}), refusing automatic adoption" >&2
  fi

  return 1
}

supervisor_api_staging_wait_for_http_ok() {
  local url="$1"
  local attempts="${2:-30}"
  local sleep_seconds="${3:-1}"
  local header_value="${4:-}"
  local header_kind="${5:-}"
  local attempt
  local status_code
  local -a curl_args

  curl_args=(-sS -o /dev/null -w "%{http_code}")
  supervisor_api_staging_append_probe_auth_header curl_args "${header_value}" "${header_kind}"
  curl_args+=("${url}")

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    status_code="$(curl "${curl_args[@]}" || true)"
    if [[ "${status_code}" == "200" ]]; then
      return 0
    fi
    sleep "${sleep_seconds}"
  done

  echo "Timed out waiting for ${url} to return 200." >&2
  return 1
}

supervisor_api_staging_append_probe_auth_header() {
  local -n curl_args_ref="$1"
  local header_value="${2:-}"
  local header_kind="${3:-}"

  if [[ -z "${header_value}" ]]; then
    return 0
  fi

  case "${header_kind}" in
    authorization)
      curl_args_ref+=(-H "authorization: Bearer ${header_value}")
      ;;
    x-worker-origin-auth)
      curl_args_ref+=(-H "x-worker-origin-auth: ${header_value}")
      ;;
    "")
      curl_args_ref+=(-H "authorization: Bearer ${header_value}")
      ;;
    *)
      echo "Unsupported probe auth header kind: ${header_kind}" >&2
      return 1
      ;;
  esac
}

supervisor_api_staging_rotate_log_file_if_needed() {
  local log_file="$1"
  local max_bytes="${2:-${supervisor_api_staging_log_rotate_max_bytes}}"
  local keep_count="${3:-${supervisor_api_staging_log_rotate_keep_count}}"
  local file_size
  local backup_index
  local backup_path
  local backup_suffix
  local -a existing_backups

  if [[ ! -f "${log_file}" ]]; then
    return 0
  fi

  file_size="$(wc -c <"${log_file}")"
  if (( file_size <= max_bytes )); then
    return 0
  fi

  shopt -s nullglob
  existing_backups=("${log_file}".*)
  shopt -u nullglob
  for backup_path in "${existing_backups[@]}"; do
    backup_suffix="${backup_path##*.}"
    if [[ "${backup_suffix}" =~ ^[0-9]+$ ]] && (( backup_suffix > keep_count )); then
      rm -f "${backup_path}"
    fi
  done

  rm -f "${log_file}.${keep_count}"
  for ((backup_index = keep_count - 1; backup_index >= 1; backup_index -= 1)); do
    if [[ -f "${log_file}.${backup_index}" ]]; then
      mv "${log_file}.${backup_index}" "${log_file}.$((backup_index + 1))"
    fi
  done

  cp "${log_file}" "${log_file}.1"
  : >"${log_file}"
}

supervisor_api_staging_rotate_logs_if_needed() {
  supervisor_api_staging_rotate_log_file_if_needed "${supervisor_api_staging_cloudflared_log_file}"
  supervisor_api_staging_rotate_log_file_if_needed "${supervisor_api_staging_supervisor_api_log_file}"
  supervisor_api_staging_rotate_log_file_if_needed "${supervisor_api_staging_supervisor_agent_worker_log_file}"
  supervisor_api_staging_rotate_log_file_if_needed "${supervisor_api_staging_otel_collector_log_file}"
}

supervisor_api_staging_kill_managed_process() {
  local pid="$1"
  local signal="${2:-TERM}"

  if kill "-${signal}" -- "-${pid}" 2>/dev/null; then
    return 0
  fi

  kill "-${signal}" "${pid}" 2>/dev/null
}

supervisor_api_staging_print_process_status() {
  local label="$1"
  local pid_file="$2"

  supervisor_api_staging_cleanup_stale_pidfile "${pid_file}"
  if supervisor_api_staging_pid_is_running "${pid_file}"; then
    echo "${label}: running (pid $(supervisor_api_staging_read_pid "${pid_file}"))"
    return 0
  fi

  echo "${label}: stopped"
  return 1
}

supervisor_api_staging_compose() {
  local docker_bin
  local worker_shared_secret
  local bridge_shared_secret
  docker_bin="$(supervisor_api_staging_require_command docker)"
  worker_shared_secret="${SUPERVISOR_API_SHARED_SECRET:?SUPERVISOR_API_SHARED_SECRET is required}"
  bridge_shared_secret="${supervisor_api_staging_bridge_shared_secret:?SUPERVISOR_AGENT_WORKER_SHARED_SECRET is required}"

  (
    cd "${supervisor_api_staging_repo_root}" || exit
    COMPOSE_PROJECT_NAME="${supervisor_api_staging_compose_project_name}" \
    SUPERVISOR_API_HOST_PORT="${supervisor_api_staging_port}" \
    SUPERVISOR_API_RUNTIME_PROFILE=staging \
    API_AUTH_MODE=trusted-worker \
    API_WORKER_SHARED_SECRET="${worker_shared_secret}" \
    SUPERVISOR_AGENT_WORKER_SHARED_SECRET="${bridge_shared_secret}" \
    QDRANT_URL="${QDRANT_DOCKER_URL:?QDRANT_DOCKER_URL is required}" \
    "${docker_bin}" compose -f "${supervisor_api_staging_compose_file}" "$@"
  )
}

supervisor_api_staging_capture_compose_logs() {
  supervisor_api_staging_compose logs --no-color otel-collector >"${supervisor_api_staging_otel_collector_log_file}" 2>&1 || true
  supervisor_api_staging_compose logs --no-color supervisor-api >"${supervisor_api_staging_supervisor_api_log_file}" 2>&1 || true
  supervisor_api_staging_compose logs --no-color supervisor-agent-worker >"${supervisor_api_staging_supervisor_agent_worker_log_file}" 2>&1 || true
}

supervisor_api_staging_collector_logs_have_export_errors() {
  local log_file="${supervisor_api_staging_otel_collector_log_file}"

  if [[ ! -f "${log_file}" ]]; then
    return 1
  fi

  grep -Eq 'Exporting failed\. Dropping data\.|not retryable error:|Permanent error:' "${log_file}"
}

supervisor_api_staging_compose_running_services() {
  supervisor_api_staging_compose ps --services --status running
}

supervisor_api_staging_compose_project_running() {
  local services
  services="$(supervisor_api_staging_compose_running_services 2>/dev/null || true)"
  [[ "${services}" == *"otel-collector"* ]] && [[ "${services}" == *"supervisor-api"* ]] && [[ "${services}" == *"supervisor-agent-worker"* ]]
}

supervisor_api_staging_require_runtime_env() {
  if [[ -n "${SUPERVISOR_API_STAGING_DATA_PLANE_ERRORS:-}" ]]; then
    echo "supervisor-api staging data-plane env is invalid:" >&2
    while IFS= read -r data_plane_error; do
      if [[ -n "${data_plane_error}" ]]; then
        echo "  - ${data_plane_error}" >&2
      fi
    done <<<"${SUPERVISOR_API_STAGING_DATA_PLANE_ERRORS}"
    return 1
  fi

  if [[ -z "${SUPERVISOR_API_SHARED_SECRET:-}" ]]; then
    echo "SUPERVISOR_API_SHARED_SECRET is missing. Populate apps/app-api/.dev.vars first." >&2
    return 1
  fi

  if [[ -z "${SUPERVISOR_API_METRICS_BEARER_TOKEN:-}" ]]; then
    echo "SUPERVISOR_API_METRICS_BEARER_TOKEN is required for staging supervisor metrics." >&2
    return 1
  fi

  if [[ -z "${supervisor_api_staging_bridge_shared_secret}" ]]; then
    echo "SUPERVISOR_AGENT_WORKER_SHARED_SECRET is missing. Set SUPERVISOR_AGENT_WORKER_STAGING_SHARED_SECRET or export SUPERVISOR_AGENT_WORKER_SHARED_SECRET." >&2
    return 1
  fi

  if [[ -z "${SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET:-}" ]]; then
    echo "SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET is required for supervisor-api staging structured query runtime." >&2
    return 1
  fi

  if [[ -z "${CAMPUS_SHARED_POSTGRES_URL:-}" ]]; then
    echo "CAMPUS_SHARED_POSTGRES_URL is required after STAGING_INGESTION_SHARED_POSTGRES_URL projection." >&2
    return 1
  fi

  if [[ -z "${DOCUMENT_REGISTRY_DATABASE_URL:-}" ]]; then
    echo "DOCUMENT_REGISTRY_DATABASE_URL is required after staging data-plane projection." >&2
    return 1
  fi

  if [[ -z "${OBJECT_STORE_ENDPOINT:-}" ]]; then
    echo "OBJECT_STORE_ENDPOINT is required after STAGING_INGESTION_OBJECT_STORE_ENDPOINT projection." >&2
    return 1
  fi

  if [[ -z "${QDRANT_URL:-}" ]]; then
    echo "QDRANT_URL is required after STAGING_INGESTION_QDRANT_URL projection." >&2
    return 1
  fi

  if [[ -z "${SUPERVISOR_API_STAGING_TUNNEL_TOKEN:-${TUNNEL_TOKEN:-}}" ]]; then
    echo "SUPERVISOR_API_STAGING_TUNNEL_TOKEN is required for the remote-managed supervisor-api-staging tunnel." >&2
    return 1
  fi

  supervisor_api_staging_validate_axiom_collector_endpoint
  supervisor_api_staging_require_registry_collection_rename_closed
  supervisor_api_staging_require_rag_runtime_ready
}

supervisor_api_staging_validate_axiom_collector_endpoint() {
  local endpoint="${OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT:-}"
  local source_endpoint="${AXIOM_ENDPOINT:-}"
  local normalized_endpoint="${endpoint%/}"
  local normalized_source_endpoint="${source_endpoint%/}"

  if [[ -z "${endpoint}" ]]; then
    return 0
  fi

  if [[ ! "${endpoint}" =~ ^https?://[^/]+/?$ ]]; then
    cat >&2 <<EOF
OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT must be the Axiom OTLP base domain, for example
https://us-east-1.aws.edge.axiom.co
Do not include signal paths like /v1/traces or /v1/metrics here because the Collector
otlphttp exporter appends those paths automatically.
Current value: ${endpoint}
EOF
    return 1
  fi

  if [[ -n "${source_endpoint}" && "${normalized_endpoint}" != "${normalized_source_endpoint}" ]]; then
    cat >&2 <<EOF
OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT must match AXIOM_ENDPOINT so Worker and Collector
export to the same Axiom edge deployment.
AXIOM_ENDPOINT=${source_endpoint}
OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT=${endpoint}
EOF
    return 1
  fi
}

supervisor_api_staging_require_registry_collection_rename_closed() {
  local uv_bin
  local node_bin
  local audit_json
  local legacy_summary

  uv_bin="$(supervisor_api_staging_resolve_uv_bin)"
  node_bin="$(supervisor_api_staging_require_command node)"
  if ! audit_json="$(
    cd "${supervisor_api_staging_repo_root}" || exit
    "${uv_bin}" run --all-packages python -m \
      campus_ingestion_worker.collection_rename_registry_backfill audit
  )"; then
    echo "supervisor-api staging registry collection rename audit failed." >&2
    return 1
  fi

  if ! legacy_summary="$(
    REGISTRY_COLLECTION_RENAME_AUDIT_JSON="${audit_json}" "${node_bin}" <<'NODE'
const payload = JSON.parse(process.env.REGISTRY_COLLECTION_RENAME_AUDIT_JSON || "{}");
const targets = Array.isArray(payload.targets) ? payload.targets : [];
const legacyLines = [];

for (const target of targets) {
  const count = Number(target.legacy_row_count || 0);
  if (count <= 0) {
    continue;
  }
  const targetNames = Array.isArray(target.target_names) ? target.target_names.join(",") : "";
  const samples = Array.isArray(target.sample_rows)
    ? target.sample_rows
        .map((sample) => {
          const identity = String(sample.identity || "");
          const column = String(sample.column_collection || "");
          const record = sample.record_collection == null ? "" : String(sample.record_collection);
          return `${identity} column=${column} record=${record}`;
        })
        .filter(Boolean)
        .join("; ")
    : "";
  legacyLines.push(
    `${target.kind || "unknown"} ${target.table_name || "unknown"} (${targetNames}): ${count} legacy rows remain${samples ? `; samples: ${samples}` : ""}`,
  );
}

if (legacyLines.length > 0) {
  console.log(legacyLines.join("\n"));
}
NODE
  )"; then
    echo "supervisor-api staging registry collection rename audit returned invalid JSON." >&2
    return 1
  fi

  if [[ -n "${legacy_summary}" ]]; then
    echo "supervisor-api staging registry collection rename is incomplete:" >&2
    echo "  - legacy collection names remain in ingestion registry; run collection_rename_registry_backfill apply before starting staging runtime." >&2
    echo "  - required renames: student_handbook -> student_rules; institutional_regulations -> institutional_rules" >&2
    while IFS= read -r legacy_line; do
      if [[ -n "${legacy_line}" ]]; then
        echo "  - ${legacy_line}" >&2
      fi
    done <<<"${legacy_summary}"
    return 1
  fi
}

supervisor_api_staging_require_rag_runtime_ready() {
  local uv_bin
  local node_bin
  local readiness_json
  local readiness_summary

  uv_bin="$(supervisor_api_staging_resolve_uv_bin)"
  node_bin="$(supervisor_api_staging_require_command node)"
  if ! readiness_json="$(
    cd "${supervisor_api_staging_repo_root}" || exit
    "${uv_bin}" run --all-packages python -m \
      campus_ingestion_worker.probe_regulation_rag_release_runtime \
      --scope regulations/student_rules \
      --scope regulations/institutional_rules \
      --scope curriculum/curriculum_plan
  )"; then
    echo "supervisor-api staging RAG runtime readiness probe failed." >&2
    return 1
  fi

  if ! readiness_summary="$(
    RAG_RUNTIME_READINESS_JSON="${readiness_json}" "${node_bin}" <<'NODE'
const payload = JSON.parse(process.env.RAG_RUNTIME_READINESS_JSON || "{}");
const failures = [];
if (payload.qdrant_ready !== "ready") {
  const checks = payload.qdrant_checks && typeof payload.qdrant_checks === "object"
    ? Object.entries(payload.qdrant_checks).map(([path, check]) => {
        const status = check && typeof check === "object" ? check.status : "";
        const body = check && typeof check === "object" ? String(check.body_prefix || "") : "";
        return `${path} status=${status}${body ? ` body=${body.slice(0, 80)}` : ""}`;
      }).join("; ")
    : "";
  failures.push(`qdrant_ready=${payload.qdrant_ready || "<missing>"}${checks ? `; ${checks}` : ""}`);
}
const surfaces = Array.isArray(payload.surfaces) ? payload.surfaces : [];
for (const surface of surfaces) {
  if (!surface || typeof surface !== "object") {
    continue;
  }
  if (surface.readiness_status === "ready") {
    continue;
  }
  const scope = String(surface.scope || "<unknown-scope>");
  const blocker = String(surface.readiness_blocker || "<missing-blocker>");
  const alias = String(surface.alias_name || "");
  const aliasTarget = String(surface.alias_target || "");
  const releaseStatus = String(surface.release_freshness_status || "");
  const latestRelease = String(surface.release_family_latest_physical_collection_name || "");
  const guardStatus = String(surface.release_metadata_guard_status || "");
  const guardMessage = String(surface.release_metadata_guard_message || "");
  const aliasGuardStatus = String(surface.alias_target_guard_status || "");
  const aliasGuardMessage = String(surface.alias_target_guard_message || "");
  failures.push(
    `${scope}: ${blocker}; alias=${alias}${aliasTarget ? `->${aliasTarget}` : ""}; latest=${latestRelease}; release=${releaseStatus}; guard=${guardStatus}${guardMessage ? ` ${guardMessage}` : ""}; alias_guard=${aliasGuardStatus}${aliasGuardMessage ? ` ${aliasGuardMessage}` : ""}`,
  );
}
if (failures.length > 0) {
  console.log(failures.join("\n"));
}
NODE
  )"; then
    echo "supervisor-api staging RAG runtime readiness probe returned invalid JSON." >&2
    return 1
  fi

  if [[ -n "${readiness_summary}" ]]; then
    echo "supervisor-api staging RAG runtime is not ready:" >&2
    while IFS= read -r readiness_line; do
      if [[ -n "${readiness_line}" ]]; then
        echo "  - ${readiness_line}" >&2
      fi
    done <<<"${readiness_summary}"
    return 1
  fi
}

supervisor_api_staging_resolve_uv_bin() {
  local configured_uv_bin="${SUPERVISOR_API_STAGING_UV_BIN:-}"
  local resolved_uv_bin
  local user_uv_bin

  if [[ -n "${configured_uv_bin}" ]]; then
    if [[ ! -x "${configured_uv_bin}" ]]; then
      echo "SUPERVISOR_API_STAGING_UV_BIN is not executable: ${configured_uv_bin}" >&2
      return 1
    fi
    printf '%s\n' "${configured_uv_bin}"
    return 0
  fi

  resolved_uv_bin="$(command -v uv || true)"
  if [[ -n "${resolved_uv_bin}" ]]; then
    printf '%s\n' "${resolved_uv_bin}"
    return 0
  fi

  user_uv_bin="${HOME:-}/.local/bin/uv"
  if [[ -x "${user_uv_bin}" ]]; then
    printf '%s\n' "${user_uv_bin}"
    return 0
  fi

  echo "Missing required command: uv. Set SUPERVISOR_API_STAGING_UV_BIN or install uv at ~/.local/bin/uv." >&2
  return 1
}

supervisor_api_staging_run_doctor() {
  local uv_bin
  uv_bin="$(supervisor_api_staging_resolve_uv_bin)"
  (
    cd "${supervisor_api_staging_repo_root}" || exit
    "${uv_bin}" run --all-packages python -m scripts.doctor_env supervisor-api --json >/dev/null
  )
}
