#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=infra/local/staging/go-shell-staging-common.sh
source "${script_dir}/go-shell-staging-common.sh"

stop_process() {
  local label="$1"
  local pid_file="$2"
  local pid
  local attempt

  go_shell_staging_cleanup_stale_pidfile "${pid_file}"
  if ! go_shell_staging_pid_is_running "${pid_file}"; then
    rm -f "${pid_file}"
    echo "${label}: already stopped"
    return 0
  fi

  pid="$(go_shell_staging_read_pid "${pid_file}")"
  go_shell_staging_kill_managed_process "${pid}" TERM || true

  for ((attempt = 1; attempt <= 15; attempt += 1)); do
    if ! kill -0 "${pid}" 2>/dev/null; then
      rm -f "${pid_file}"
      echo "${label}: stopped"
      return 0
    fi
    sleep 1
  done

  echo "${label}: still running after SIGTERM, escalating to SIGKILL (pid ${pid})" >&2
  go_shell_staging_kill_managed_process "${pid}" KILL || true

  for ((attempt = 1; attempt <= 5; attempt += 1)); do
    if ! kill -0 "${pid}" 2>/dev/null; then
      rm -f "${pid_file}"
      echo "${label}: stopped"
      return 0
    fi
    sleep 1
  done

  echo "${label}: still running after SIGKILL (pid ${pid})" >&2
  return 1
}

go_shell_staging_ensure_runtime_dirs
go_shell_staging_acquire_lock "${go_shell_staging_lock_wait_seconds}"
go_shell_staging_load_env
go_shell_staging_adopt_existing_process \
  "cloudflared" \
  "${go_shell_staging_cloudflared_pid_file}" \
  "${go_shell_staging_cloudflared_match_pattern}" || true

go_shell_staging_capture_compose_logs
go_shell_staging_compose down --remove-orphans || true
stop_process "cloudflared" "${go_shell_staging_cloudflared_pid_file}"
