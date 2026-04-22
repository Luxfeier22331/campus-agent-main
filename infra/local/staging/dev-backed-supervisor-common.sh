#!/usr/bin/env bash

dev_backed_supervisor_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dev_backed_supervisor_repo_root="$(cd "${dev_backed_supervisor_script_dir}/../../.." && pwd)"

dev_backed_supervisor_runtime_dir="${DEV_BACKED_SUPERVISOR_RUNTIME_DIR:-${dev_backed_supervisor_repo_root}/.tmp/dev-backed-supervisor-staging}"
dev_backed_supervisor_log_dir="${dev_backed_supervisor_runtime_dir}/logs"
dev_backed_supervisor_lock_file="${dev_backed_supervisor_runtime_dir}/lifecycle.lock"
dev_backed_supervisor_supervisor_pid_file="${dev_backed_supervisor_runtime_dir}/supervisor-api.pid"
dev_backed_supervisor_cloudflared_pid_file="${dev_backed_supervisor_runtime_dir}/cloudflared.pid"
dev_backed_supervisor_supervisor_log_file="${dev_backed_supervisor_log_dir}/supervisor-api.log"
dev_backed_supervisor_cloudflared_log_file="${dev_backed_supervisor_log_dir}/cloudflared.log"

dev_backed_supervisor_host="${DEV_BACKED_SUPERVISOR_HOST:-127.0.0.1}"
dev_backed_supervisor_port="${DEV_BACKED_SUPERVISOR_PORT:-8081}"
dev_backed_supervisor_tunnel_name="${DEV_BACKED_SUPERVISOR_TUNNEL_NAME:-supervisor-api-staging}"
dev_backed_supervisor_public_base_url="${DEV_BACKED_SUPERVISOR_PUBLIC_BASE_URL:-https://exec-staging.ayafeed.com}"
dev_backed_supervisor_app_api_base_url="${DEV_BACKED_SUPERVISOR_APP_API_BASE_URL:-https://campus-api-staging.ayafeed.com}"
dev_backed_supervisor_cloudflared_config_file="${DEV_BACKED_SUPERVISOR_CLOUDFLARED_CONFIG_FILE:-${HOME}/.cloudflared/config.yml}"
dev_backed_supervisor_cloudflared_metrics_address="${DEV_BACKED_SUPERVISOR_CLOUDFLARED_METRICS_ADDRESS:-127.0.0.1:20245}"
dev_backed_supervisor_cloudflared_edge_ip_version="${DEV_BACKED_SUPERVISOR_CLOUDFLARED_EDGE_IP_VERSION:-4}"
dev_backed_supervisor_lock_wait_seconds="${DEV_BACKED_SUPERVISOR_LOCK_WAIT_SECONDS:-180}"
dev_backed_supervisor_supervisor_match_pattern="${DEV_BACKED_SUPERVISOR_SUPERVISOR_MATCH_PATTERN:-uv run --all-packages( --no-sync)? campus-supervisor-api-dev}"
dev_backed_supervisor_cloudflared_match_pattern="${DEV_BACKED_SUPERVISOR_CLOUDFLARED_MATCH_PATTERN:-cloudflared tunnel( .*)? run ${dev_backed_supervisor_tunnel_name}}"
dev_backed_supervisor_log_rotate_max_bytes=$((20 * 1024 * 1024))
dev_backed_supervisor_log_rotate_keep_count=5

dev_backed_supervisor_local_readyz_url="http://${dev_backed_supervisor_host}:${dev_backed_supervisor_port}/readyz"
dev_backed_supervisor_public_readyz_url=""
if [[ -n "${dev_backed_supervisor_public_base_url}" ]]; then
  dev_backed_supervisor_public_readyz_url="${dev_backed_supervisor_public_base_url%/}/readyz"
fi
dev_backed_supervisor_app_api_readyz_url=""
if [[ -n "${dev_backed_supervisor_app_api_base_url}" ]]; then
  dev_backed_supervisor_app_api_readyz_url="${dev_backed_supervisor_app_api_base_url%/}/readyz"
fi

dev_backed_supervisor_runtime_globals_declared() {
  : "${dev_backed_supervisor_runtime_dir}" \
    "${dev_backed_supervisor_log_dir}" \
    "${dev_backed_supervisor_lock_file}" \
    "${dev_backed_supervisor_supervisor_pid_file}" \
    "${dev_backed_supervisor_cloudflared_pid_file}" \
    "${dev_backed_supervisor_supervisor_log_file}" \
    "${dev_backed_supervisor_cloudflared_log_file}" \
    "${dev_backed_supervisor_host}" \
    "${dev_backed_supervisor_port}" \
    "${dev_backed_supervisor_tunnel_name}" \
    "${dev_backed_supervisor_public_base_url}" \
    "${dev_backed_supervisor_app_api_base_url}" \
    "${dev_backed_supervisor_cloudflared_config_file}" \
    "${dev_backed_supervisor_cloudflared_metrics_address}" \
    "${dev_backed_supervisor_cloudflared_edge_ip_version}" \
    "${dev_backed_supervisor_lock_wait_seconds}" \
    "${dev_backed_supervisor_supervisor_match_pattern}" \
    "${dev_backed_supervisor_cloudflared_match_pattern}" \
    "${dev_backed_supervisor_log_rotate_max_bytes}" \
    "${dev_backed_supervisor_log_rotate_keep_count}" \
    "${dev_backed_supervisor_local_readyz_url}" \
    "${dev_backed_supervisor_public_readyz_url}" \
    "${dev_backed_supervisor_app_api_readyz_url}"
}

dev_backed_supervisor_ensure_runtime_dirs() {
  mkdir -p "${dev_backed_supervisor_log_dir}"
}

dev_backed_supervisor_acquire_lock() {
  local wait_seconds="${1:-${dev_backed_supervisor_lock_wait_seconds}}"

  exec 9>"${dev_backed_supervisor_lock_file}"
  if ! flock -w "${wait_seconds}" 9; then
    echo "Timed out waiting for ${dev_backed_supervisor_lock_file}; another staging lifecycle command is still active." >&2
    return 1
  fi
}

dev_backed_supervisor_load_env() {
  local app_api_dev_vars="${dev_backed_supervisor_repo_root}/apps/app-api/.dev.vars"
  local node_bin
  local supervisor_shared_secret

  if [[ -f "${app_api_dev_vars}" ]]; then
    node_bin="$(dev_backed_supervisor_require_command node)"
    supervisor_shared_secret="$(
      "${node_bin}" -e '
        const process = require("node:process");

        try {
          process.loadEnvFile(process.argv[1]);
        } catch (error) {
          console.error(error instanceof Error ? error.message : String(error));
          process.exit(1);
        }

        process.stdout.write(process.env.SUPERVISOR_API_SHARED_SECRET ?? "");
      ' "${app_api_dev_vars}"
    )"

    if [[ -n "${supervisor_shared_secret}" ]]; then
      export SUPERVISOR_API_SHARED_SECRET="${supervisor_shared_secret}"
    fi
  fi
}

dev_backed_supervisor_require_command() {
  local command_name="$1"
  local resolved

  resolved="$(command -v "${command_name}" || true)"
  if [[ -z "${resolved}" ]]; then
    echo "Missing required command: ${command_name}" >&2
    return 1
  fi

  printf '%s\n' "${resolved}"
}

dev_backed_supervisor_read_pid() {
  local pid_file="$1"

  if [[ ! -f "${pid_file}" ]]; then
    return 1
  fi

  tr -d '[:space:]' <"${pid_file}"
}

dev_backed_supervisor_pid_is_running() {
  local pid_file="$1"
  local pid

  pid="$(dev_backed_supervisor_read_pid "${pid_file}" 2>/dev/null || true)"
  if [[ -z "${pid}" ]]; then
    return 1
  fi

  kill -0 "${pid}" 2>/dev/null
}

dev_backed_supervisor_cleanup_stale_pidfile() {
  local pid_file="$1"

  if [[ -f "${pid_file}" ]] && ! dev_backed_supervisor_pid_is_running "${pid_file}"; then
    rm -f "${pid_file}"
  fi
}

dev_backed_supervisor_adopt_existing_process() {
  local label="$1"
  local pid_file="$2"
  local match_pattern="$3"
  local -a matched_pids

  dev_backed_supervisor_cleanup_stale_pidfile "${pid_file}"
  if dev_backed_supervisor_pid_is_running "${pid_file}"; then
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

dev_backed_supervisor_wait_for_http_ok() {
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

dev_backed_supervisor_rotate_log_file_if_needed() {
  local log_file="$1"
  local max_bytes="${2:-${dev_backed_supervisor_log_rotate_max_bytes}}"
  local keep_count="${3:-${dev_backed_supervisor_log_rotate_keep_count}}"
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

dev_backed_supervisor_rotate_logs_if_needed() {
  dev_backed_supervisor_rotate_log_file_if_needed "${dev_backed_supervisor_supervisor_log_file}"
  dev_backed_supervisor_rotate_log_file_if_needed "${dev_backed_supervisor_cloudflared_log_file}"
}

dev_backed_supervisor_kill_managed_process() {
  local pid="$1"
  local signal="${2:-TERM}"

  if kill "-${signal}" -- "-${pid}" 2>/dev/null; then
    return 0
  fi

  kill "-${signal}" "${pid}" 2>/dev/null
}

dev_backed_supervisor_print_process_status() {
  local label="$1"
  local pid_file="$2"

  dev_backed_supervisor_cleanup_stale_pidfile "${pid_file}"
  if dev_backed_supervisor_pid_is_running "${pid_file}"; then
    echo "${label}: running (pid $(dev_backed_supervisor_read_pid "${pid_file}"))"
    return 0
  fi

  echo "${label}: stopped"
  return 1
}
