#!/usr/bin/env bash

go_shell_staging_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
go_shell_staging_repo_root="$(cd "${go_shell_staging_script_dir}/../../.." && pwd)"

go_shell_staging_runtime_dir="${GO_SHELL_STAGING_RUNTIME_DIR:-${go_shell_staging_repo_root}/.tmp/go-shell-staging}"
go_shell_staging_log_dir="${go_shell_staging_runtime_dir}/logs"
go_shell_staging_lock_file="${go_shell_staging_runtime_dir}/lifecycle.lock"
go_shell_staging_cloudflared_pid_file="${go_shell_staging_runtime_dir}/cloudflared.pid"
go_shell_staging_cloudflared_log_file="${go_shell_staging_log_dir}/cloudflared.log"
go_shell_staging_supervisor_shell_log_file="${go_shell_staging_log_dir}/supervisor-shell.log"
go_shell_staging_supervisor_orchestrator_log_file="${go_shell_staging_log_dir}/supervisor-orchestrator.log"

go_shell_staging_host="${GO_SHELL_STAGING_HOST:-127.0.0.1}"
go_shell_staging_port="${GO_SHELL_STAGING_PORT:-27010}"
go_shell_staging_compose_file="${GO_SHELL_STAGING_COMPOSE_FILE:-${go_shell_staging_repo_root}/infra/local/docker-compose.supervisor-runtime.yml}"
go_shell_staging_compose_project_name="${GO_SHELL_STAGING_COMPOSE_PROJECT_NAME:-campus-go-shell-staging}"
go_shell_staging_tunnel_name="${GO_SHELL_STAGING_TUNNEL_NAME:-supervisor-api-staging}"
go_shell_staging_public_base_url="${GO_SHELL_STAGING_PUBLIC_BASE_URL:-https://exec-staging.ayafeed.com}"
go_shell_staging_app_api_base_url="${GO_SHELL_STAGING_APP_API_BASE_URL:-https://campus-api-staging.ayafeed.com}"
go_shell_staging_cloudflared_config_file="${GO_SHELL_STAGING_CLOUDFLARED_CONFIG_FILE:-${HOME}/.cloudflared/config.yml}"
go_shell_staging_cloudflared_metrics_address="${GO_SHELL_STAGING_CLOUDFLARED_METRICS_ADDRESS:-127.0.0.1:20245}"
go_shell_staging_cloudflared_edge_ip_version="${GO_SHELL_STAGING_CLOUDFLARED_EDGE_IP_VERSION:-4}"
go_shell_staging_lock_wait_seconds="${GO_SHELL_STAGING_LOCK_WAIT_SECONDS:-180}"
go_shell_staging_cloudflared_match_pattern="${GO_SHELL_STAGING_CLOUDFLARED_MATCH_PATTERN:-cloudflared tunnel( .*)? run ${go_shell_staging_tunnel_name}}"
go_shell_staging_legacy_supervisor_match_pattern="${GO_SHELL_STAGING_LEGACY_SUPERVISOR_MATCH_PATTERN:-uv run --all-packages( --no-sync)? campus-supervisor-api-dev}"
go_shell_staging_log_rotate_max_bytes=$((20 * 1024 * 1024))
go_shell_staging_log_rotate_keep_count=5

go_shell_staging_local_healthz_url="http://${go_shell_staging_host}:${go_shell_staging_port}/healthz"
go_shell_staging_local_readyz_url="http://${go_shell_staging_host}:${go_shell_staging_port}/readyz"
go_shell_staging_local_metrics_url="http://${go_shell_staging_host}:${go_shell_staging_port}/metrics"
go_shell_staging_public_readyz_url=""
if [[ -n "${go_shell_staging_public_base_url}" ]]; then
  go_shell_staging_public_readyz_url="${go_shell_staging_public_base_url%/}/readyz"
fi
go_shell_staging_app_api_readyz_url=""
if [[ -n "${go_shell_staging_app_api_base_url}" ]]; then
  go_shell_staging_app_api_readyz_url="${go_shell_staging_app_api_base_url%/}/readyz"
fi

go_shell_staging_bridge_shared_secret=""

go_shell_staging_runtime_globals_declared() {
  : "${go_shell_staging_runtime_dir}" \
    "${go_shell_staging_log_dir}" \
    "${go_shell_staging_lock_file}" \
    "${go_shell_staging_cloudflared_pid_file}" \
    "${go_shell_staging_cloudflared_log_file}" \
    "${go_shell_staging_supervisor_shell_log_file}" \
    "${go_shell_staging_supervisor_orchestrator_log_file}" \
    "${go_shell_staging_host}" \
    "${go_shell_staging_port}" \
    "${go_shell_staging_compose_file}" \
    "${go_shell_staging_compose_project_name}" \
    "${go_shell_staging_tunnel_name}" \
    "${go_shell_staging_public_base_url}" \
    "${go_shell_staging_app_api_base_url}" \
    "${go_shell_staging_cloudflared_config_file}" \
    "${go_shell_staging_cloudflared_metrics_address}" \
    "${go_shell_staging_cloudflared_edge_ip_version}" \
    "${go_shell_staging_lock_wait_seconds}" \
    "${go_shell_staging_cloudflared_match_pattern}" \
    "${go_shell_staging_legacy_supervisor_match_pattern}" \
    "${go_shell_staging_log_rotate_max_bytes}" \
    "${go_shell_staging_log_rotate_keep_count}" \
    "${go_shell_staging_local_healthz_url}" \
    "${go_shell_staging_local_readyz_url}" \
    "${go_shell_staging_local_metrics_url}" \
    "${go_shell_staging_public_readyz_url}" \
    "${go_shell_staging_app_api_readyz_url}"
}

go_shell_staging_ensure_runtime_dirs() {
  mkdir -p "${go_shell_staging_log_dir}"
}

go_shell_staging_acquire_lock() {
  local wait_seconds="${1:-${go_shell_staging_lock_wait_seconds}}"

  exec 9>"${go_shell_staging_lock_file}"
  if ! flock -w "${wait_seconds}" 9; then
    echo "Timed out waiting for ${go_shell_staging_lock_file}; another staging lifecycle command is still active." >&2
    return 1
  fi
}

go_shell_staging_require_command() {
  local command_name="$1"
  local resolved

  resolved="$(command -v "${command_name}" || true)"
  if [[ -z "${resolved}" ]]; then
    echo "Missing required command: ${command_name}" >&2
    return 1
  fi

  printf '%s\n' "${resolved}"
}

go_shell_staging_load_env() {
  local node_bin
  local repo_env_path="${go_shell_staging_repo_root}/.env"
  local app_api_dev_vars="${go_shell_staging_repo_root}/apps/app-api/.dev.vars"
  local export_script

  node_bin="$(go_shell_staging_require_command node)"
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
  "SPECIALIST_PROMPT_MODEL",
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
  "SUPERVISOR_API_MAX_CONCURRENT_ANSWERS",
  "SUPERVISOR_API_TRANSPORT_WORKER_THREADS",
  "SUPERVISOR_API_SHARED_SECRET",
  "SUPERVISOR_PY_BRIDGE_TIMEOUT_MS",
];

const resolved = new Map();
for (const key of keys) {
  const value = process.env[key];
  if (typeof value === "string") {
    resolved.set(key, value.trim());
  }
}

const bridgeSharedSecret =
  process.env.GO_SHELL_STAGING_BRIDGE_SHARED_SECRET?.trim() ||
  process.env.SUPERVISOR_PY_BRIDGE_SHARED_SECRET?.trim() ||
  process.env.SUPERVISOR_API_SHARED_SECRET?.trim() ||
  "";
resolved.set("SUPERVISOR_PY_BRIDGE_SHARED_SECRET", bridgeSharedSecret);

for (const [key, value] of resolved.entries()) {
  process.stdout.write(`export ${key}=${JSON.stringify(value)}\n`);
}
NODE
  )"
  eval "${export_script}"

  go_shell_staging_bridge_shared_secret="${SUPERVISOR_PY_BRIDGE_SHARED_SECRET:-${SUPERVISOR_API_SHARED_SECRET:-}}"
}

go_shell_staging_read_pid() {
  local pid_file="$1"

  if [[ ! -f "${pid_file}" ]]; then
    return 1
  fi

  tr -d '[:space:]' <"${pid_file}"
}

go_shell_staging_pid_is_running() {
  local pid_file="$1"
  local pid

  pid="$(go_shell_staging_read_pid "${pid_file}" 2>/dev/null || true)"
  if [[ -z "${pid}" ]]; then
    return 1
  fi

  kill -0 "${pid}" 2>/dev/null
}

go_shell_staging_cleanup_stale_pidfile() {
  local pid_file="$1"

  if [[ -f "${pid_file}" ]] && ! go_shell_staging_pid_is_running "${pid_file}"; then
    rm -f "${pid_file}"
  fi
}

go_shell_staging_adopt_existing_process() {
  local label="$1"
  local pid_file="$2"
  local match_pattern="$3"
  local -a matched_pids

  go_shell_staging_cleanup_stale_pidfile "${pid_file}"
  if go_shell_staging_pid_is_running "${pid_file}"; then
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

go_shell_staging_wait_for_http_ok() {
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

go_shell_staging_rotate_log_file_if_needed() {
  local log_file="$1"
  local max_bytes="${2:-${go_shell_staging_log_rotate_max_bytes}}"
  local keep_count="${3:-${go_shell_staging_log_rotate_keep_count}}"
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

go_shell_staging_rotate_logs_if_needed() {
  go_shell_staging_rotate_log_file_if_needed "${go_shell_staging_cloudflared_log_file}"
  go_shell_staging_rotate_log_file_if_needed "${go_shell_staging_supervisor_shell_log_file}"
  go_shell_staging_rotate_log_file_if_needed "${go_shell_staging_supervisor_orchestrator_log_file}"
}

go_shell_staging_kill_managed_process() {
  local pid="$1"
  local signal="${2:-TERM}"

  if kill "-${signal}" -- "-${pid}" 2>/dev/null; then
    return 0
  fi

  kill "-${signal}" "${pid}" 2>/dev/null
}

go_shell_staging_print_process_status() {
  local label="$1"
  local pid_file="$2"

  go_shell_staging_cleanup_stale_pidfile "${pid_file}"
  if go_shell_staging_pid_is_running "${pid_file}"; then
    echo "${label}: running (pid $(go_shell_staging_read_pid "${pid_file}"))"
    return 0
  fi

  echo "${label}: stopped"
  return 1
}

go_shell_staging_compose() {
  local docker_bin
  local worker_shared_secret
  local bridge_shared_secret
  docker_bin="$(go_shell_staging_require_command docker)"
  worker_shared_secret="${SUPERVISOR_API_SHARED_SECRET:-go-shell-staging-placeholder}"
  bridge_shared_secret="${go_shell_staging_bridge_shared_secret:-${SUPERVISOR_API_SHARED_SECRET:-go-shell-staging-placeholder}}"

  (
    cd "${go_shell_staging_repo_root}" || exit
    COMPOSE_PROJECT_NAME="${go_shell_staging_compose_project_name}" \
    SUPERVISOR_SHELL_HOST_PORT="${go_shell_staging_port}" \
    API_AUTH_MODE=trusted-worker \
    API_WORKER_SHARED_SECRET="${worker_shared_secret}" \
    SUPERVISOR_PY_BRIDGE_SHARED_SECRET="${bridge_shared_secret}" \
    "${docker_bin}" compose -f "${go_shell_staging_compose_file}" "$@"
  )
}

go_shell_staging_capture_compose_logs() {
  go_shell_staging_compose logs --no-color supervisor-shell >"${go_shell_staging_supervisor_shell_log_file}" 2>&1 || true
  go_shell_staging_compose logs --no-color supervisor-orchestrator >"${go_shell_staging_supervisor_orchestrator_log_file}" 2>&1 || true
}

go_shell_staging_compose_running_services() {
  go_shell_staging_compose ps --services --status running
}

go_shell_staging_compose_project_running() {
  local services
  services="$(go_shell_staging_compose_running_services 2>/dev/null || true)"
  [[ "${services}" == *"supervisor-shell"* ]] && [[ "${services}" == *"supervisor-orchestrator"* ]]
}

go_shell_staging_legacy_supervisor_running() {
  pgrep -f -- "${go_shell_staging_legacy_supervisor_match_pattern}" >/dev/null 2>&1
}

go_shell_staging_require_legacy_supervisor_stopped() {
  if go_shell_staging_legacy_supervisor_running; then
    echo "Legacy campus-supervisor-api-dev process is still running. Stop it with infra/local/staging/stop-dev-backed-supervisor-staging.sh before starting go-shell staging." >&2
    return 1
  fi
}

go_shell_staging_require_runtime_env() {
  if [[ -z "${SUPERVISOR_API_SHARED_SECRET:-}" ]]; then
    echo "SUPERVISOR_API_SHARED_SECRET is missing. Populate apps/app-api/.dev.vars first." >&2
    return 1
  fi

  if [[ -z "${go_shell_staging_bridge_shared_secret}" ]]; then
    echo "SUPERVISOR_PY_BRIDGE_SHARED_SECRET is missing. Set GO_SHELL_STAGING_BRIDGE_SHARED_SECRET or export SUPERVISOR_PY_BRIDGE_SHARED_SECRET." >&2
    return 1
  fi

  if [[ ! -f "${go_shell_staging_cloudflared_config_file}" ]]; then
    echo "Missing ${go_shell_staging_cloudflared_config_file}. Create the named tunnel config first." >&2
    return 1
  fi
}

go_shell_staging_run_doctor() {
  local uv_bin
  uv_bin="$(go_shell_staging_require_command uv)"
  (
    cd "${go_shell_staging_repo_root}" || exit
    "${uv_bin}" run --all-packages python -m scripts.doctor_env supervisor-api --json >/dev/null
  )
}
