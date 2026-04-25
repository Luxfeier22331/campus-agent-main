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

supervisor_api_staging_host="${SUPERVISOR_API_STAGING_HOST:-127.0.0.1}"
supervisor_api_staging_port="${SUPERVISOR_API_STAGING_PORT:-27010}"
supervisor_api_staging_compose_file="${SUPERVISOR_API_STAGING_COMPOSE_FILE:-${supervisor_api_staging_repo_root}/infra/local/docker-compose.supervisor-runtime.yml}"
supervisor_api_staging_compose_project_name="${SUPERVISOR_API_STAGING_COMPOSE_PROJECT_NAME:-campus-supervisor-api-staging}"
supervisor_api_staging_tunnel_name="${SUPERVISOR_API_STAGING_TUNNEL_NAME:-supervisor-api-staging}"
supervisor_api_staging_public_base_url="${SUPERVISOR_API_STAGING_PUBLIC_BASE_URL:-https://exec-staging.ayafeed.com}"
supervisor_api_staging_app_api_base_url="${SUPERVISOR_API_STAGING_APP_API_BASE_URL:-https://campus-api-staging.ayafeed.com}"
supervisor_api_staging_cloudflared_config_file="${SUPERVISOR_API_STAGING_CLOUDFLARED_CONFIG_FILE:-${HOME}/.cloudflared/config.yml}"
supervisor_api_staging_cloudflared_metrics_address="${SUPERVISOR_API_STAGING_CLOUDFLARED_METRICS_ADDRESS:-127.0.0.1:20245}"
supervisor_api_staging_cloudflared_edge_ip_version="${SUPERVISOR_API_STAGING_CLOUDFLARED_EDGE_IP_VERSION:-4}"
supervisor_api_staging_lock_wait_seconds="${SUPERVISOR_API_STAGING_LOCK_WAIT_SECONDS:-180}"
supervisor_api_staging_cloudflared_match_pattern="${SUPERVISOR_API_STAGING_CLOUDFLARED_MATCH_PATTERN:-cloudflared tunnel( .*)? run ${supervisor_api_staging_tunnel_name}}"
supervisor_api_staging_log_rotate_max_bytes=$((20 * 1024 * 1024))
supervisor_api_staging_log_rotate_keep_count=5

supervisor_api_staging_local_healthz_url="http://${supervisor_api_staging_host}:${supervisor_api_staging_port}/healthz"
supervisor_api_staging_local_readyz_url="http://${supervisor_api_staging_host}:${supervisor_api_staging_port}/readyz"
supervisor_api_staging_local_metrics_url="http://${supervisor_api_staging_host}:${supervisor_api_staging_port}/metrics"
supervisor_api_staging_public_readyz_url=""
if [[ -n "${supervisor_api_staging_public_base_url}" ]]; then
  supervisor_api_staging_public_readyz_url="${supervisor_api_staging_public_base_url%/}/readyz"
fi
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
    "${supervisor_api_staging_host}" \
    "${supervisor_api_staging_port}" \
    "${supervisor_api_staging_compose_file}" \
    "${supervisor_api_staging_compose_project_name}" \
    "${supervisor_api_staging_tunnel_name}" \
    "${supervisor_api_staging_public_base_url}" \
    "${supervisor_api_staging_app_api_base_url}" \
    "${supervisor_api_staging_cloudflared_config_file}" \
    "${supervisor_api_staging_cloudflared_metrics_address}" \
    "${supervisor_api_staging_cloudflared_edge_ip_version}" \
    "${supervisor_api_staging_lock_wait_seconds}" \
    "${supervisor_api_staging_cloudflared_match_pattern}" \
    "${supervisor_api_staging_log_rotate_max_bytes}" \
    "${supervisor_api_staging_log_rotate_keep_count}" \
    "${supervisor_api_staging_local_healthz_url}" \
    "${supervisor_api_staging_local_readyz_url}" \
    "${supervisor_api_staging_local_metrics_url}" \
    "${supervisor_api_staging_public_readyz_url}" \
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
  local app_api_dev_vars="${supervisor_api_staging_repo_root}/apps/app-api/.dev.vars"
  local export_script

  node_bin="$(supervisor_api_staging_require_command node)"
  export_script="$(
    "${node_bin}" - "${repo_env_path}" "${app_api_dev_vars}" <<'NODE'
const [repoEnvPath, appApiDevVarsPath] = process.argv.slice(2);
const loadedPaths = [];
for (const filePath of [repoEnvPath, appApiDevVarsPath]) {
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

const bridgeSharedSecret =
  process.env.SUPERVISOR_AGENT_WORKER_STAGING_SHARED_SECRET?.trim() ||
  process.env.SUPERVISOR_AGENT_WORKER_SHARED_SECRET?.trim() ||
  process.env.SUPERVISOR_API_SHARED_SECRET?.trim() ||
  "";
resolved.set("SUPERVISOR_AGENT_WORKER_SHARED_SECRET", bridgeSharedSecret);

for (const [key, value] of resolved.entries()) {
  if (
    key === "DOCUMENT_REGISTRY_DATABASE_URL" ||
    key === "CAMPUS_SHARED_POSTGRES_URL" ||
    key === "SUPERVISOR_API_EXECUTION_AUDIT_URL" ||
    key === "OBJECT_STORE_ENDPOINT"
  ) {
    process.stdout.write(`export ${key}=${JSON.stringify(rewriteLocalhostForDocker(value))}\n`);
    continue;
  }
  process.stdout.write(`export ${key}=${JSON.stringify(value)}\n`);
}
NODE
  )"
  eval "${export_script}"

  supervisor_api_staging_bridge_shared_secret="${SUPERVISOR_AGENT_WORKER_SHARED_SECRET:-${SUPERVISOR_API_SHARED_SECRET:-}}"
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
  export SUPERVISOR_API_EXECUTION_AUDIT_QUEUE_CAPACITY="${SUPERVISOR_API_EXECUTION_AUDIT_QUEUE_CAPACITY:-128}"
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

  pid="$(supervisor_api_staging_read_pid "${pid_file}" 2>/dev/null || true)"
  if [[ -z "${pid}" ]]; then
    return 1
  fi

  kill -0 "${pid}" 2>/dev/null
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
  local attempt
  local status_code

  for ((attempt = 1; attempt <= attempts; attempt += 1)); do
    status_code="$(curl -sS -o /dev/null -w "%{http_code}" "${url}" || true)"
    if [[ "${status_code}" == "200" ]]; then
      return 0
    fi
    sleep "${sleep_seconds}"
  done

  echo "Timed out waiting for ${url} to return 200." >&2
  return 1
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
  worker_shared_secret="${SUPERVISOR_API_SHARED_SECRET:-supervisor-api-staging-placeholder}"
  bridge_shared_secret="${supervisor_api_staging_bridge_shared_secret:-${SUPERVISOR_API_SHARED_SECRET:-supervisor-agent-worker-staging-placeholder}}"

  (
    cd "${supervisor_api_staging_repo_root}" || exit
    COMPOSE_PROJECT_NAME="${supervisor_api_staging_compose_project_name}" \
    SUPERVISOR_API_HOST_PORT="${supervisor_api_staging_port}" \
    API_AUTH_MODE=trusted-worker \
    API_WORKER_SHARED_SECRET="${worker_shared_secret}" \
    SUPERVISOR_AGENT_WORKER_SHARED_SECRET="${bridge_shared_secret}" \
    "${docker_bin}" compose -f "${supervisor_api_staging_compose_file}" "$@"
  )
}

supervisor_api_staging_capture_compose_logs() {
  supervisor_api_staging_compose logs --no-color supervisor-api >"${supervisor_api_staging_supervisor_api_log_file}" 2>&1 || true
  supervisor_api_staging_compose logs --no-color supervisor-agent-worker >"${supervisor_api_staging_supervisor_agent_worker_log_file}" 2>&1 || true
}

supervisor_api_staging_compose_running_services() {
  supervisor_api_staging_compose ps --services --status running
}

supervisor_api_staging_compose_project_running() {
  local services
  services="$(supervisor_api_staging_compose_running_services 2>/dev/null || true)"
  [[ "${services}" == *"supervisor-api"* ]] && [[ "${services}" == *"supervisor-agent-worker"* ]]
}

supervisor_api_staging_require_runtime_env() {
  if [[ -z "${SUPERVISOR_API_SHARED_SECRET:-}" ]]; then
    echo "SUPERVISOR_API_SHARED_SECRET is missing. Populate apps/app-api/.dev.vars first." >&2
    return 1
  fi

  if [[ -z "${supervisor_api_staging_bridge_shared_secret}" ]]; then
    echo "SUPERVISOR_AGENT_WORKER_SHARED_SECRET is missing. Set SUPERVISOR_AGENT_WORKER_STAGING_SHARED_SECRET or export SUPERVISOR_AGENT_WORKER_SHARED_SECRET." >&2
    return 1
  fi

  if [[ ! -f "${supervisor_api_staging_cloudflared_config_file}" ]]; then
    echo "Missing ${supervisor_api_staging_cloudflared_config_file}. Create the named tunnel config first." >&2
    return 1
  fi
}

supervisor_api_staging_run_doctor() {
  local uv_bin
  uv_bin="$(supervisor_api_staging_require_command uv)"
  (
    cd "${supervisor_api_staging_repo_root}" || exit
    "${uv_bin}" run --all-packages python -m scripts.doctor_env supervisor-api --json >/dev/null
  )
}
