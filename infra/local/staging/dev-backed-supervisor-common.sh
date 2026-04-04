#!/usr/bin/env bash

dev_backed_supervisor_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
dev_backed_supervisor_repo_root="$(cd "${dev_backed_supervisor_script_dir}/../../.." && pwd)"

dev_backed_supervisor_runtime_dir="${DEV_BACKED_SUPERVISOR_RUNTIME_DIR:-${dev_backed_supervisor_repo_root}/.tmp/dev-backed-supervisor-staging}"
dev_backed_supervisor_log_dir="${dev_backed_supervisor_runtime_dir}/logs"
dev_backed_supervisor_supervisor_pid_file="${dev_backed_supervisor_runtime_dir}/supervisor-api.pid"
dev_backed_supervisor_cloudflared_pid_file="${dev_backed_supervisor_runtime_dir}/cloudflared.pid"
dev_backed_supervisor_supervisor_log_file="${dev_backed_supervisor_log_dir}/supervisor-api.log"
dev_backed_supervisor_cloudflared_log_file="${dev_backed_supervisor_log_dir}/cloudflared.log"

dev_backed_supervisor_host="${DEV_BACKED_SUPERVISOR_HOST:-127.0.0.1}"
dev_backed_supervisor_port="${DEV_BACKED_SUPERVISOR_PORT:-8081}"
dev_backed_supervisor_tunnel_name="${DEV_BACKED_SUPERVISOR_TUNNEL_NAME:-supervisor-api-staging}"
dev_backed_supervisor_public_base_url="${DEV_BACKED_SUPERVISOR_PUBLIC_BASE_URL:-}"
dev_backed_supervisor_supervisor_match_pattern="${DEV_BACKED_SUPERVISOR_SUPERVISOR_MATCH_PATTERN:-uv run --all-packages campus-supervisor-api-dev}"
dev_backed_supervisor_cloudflared_match_pattern="${DEV_BACKED_SUPERVISOR_CLOUDFLARED_MATCH_PATTERN:-cloudflared tunnel run ${dev_backed_supervisor_tunnel_name}}"

dev_backed_supervisor_local_readyz_url="http://${dev_backed_supervisor_host}:${dev_backed_supervisor_port}/readyz"
dev_backed_supervisor_public_readyz_url=""
if [[ -n "${dev_backed_supervisor_public_base_url}" ]]; then
  dev_backed_supervisor_public_readyz_url="${dev_backed_supervisor_public_base_url%/}/readyz"
fi

dev_backed_supervisor_ensure_runtime_dirs() {
  mkdir -p "${dev_backed_supervisor_log_dir}"
}

dev_backed_supervisor_load_env() {
  local app_api_dev_vars="${dev_backed_supervisor_repo_root}/apps/app-api/.dev.vars"

  if [[ -f "${app_api_dev_vars}" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "${app_api_dev_vars}"
    set +a
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
