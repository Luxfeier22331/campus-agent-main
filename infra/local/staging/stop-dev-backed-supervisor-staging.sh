#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${script_dir}/dev-backed-supervisor-common.sh"

stop_process() {
  local label="$1"
  local pid_file="$2"
  local pid
  local attempt

  dev_backed_supervisor_cleanup_stale_pidfile "${pid_file}"
  if ! dev_backed_supervisor_pid_is_running "${pid_file}"; then
    rm -f "${pid_file}"
    echo "${label}: already stopped"
    return 0
  fi

  pid="$(dev_backed_supervisor_read_pid "${pid_file}")"
  dev_backed_supervisor_kill_managed_process "${pid}" TERM || true

  for ((attempt = 1; attempt <= 15; attempt += 1)); do
    if ! kill -0 "${pid}" 2>/dev/null; then
      rm -f "${pid_file}"
      echo "${label}: stopped"
      return 0
    fi
    sleep 1
  done

  echo "${label}: still running after SIGTERM, escalating to SIGKILL (pid ${pid})" >&2
  dev_backed_supervisor_kill_managed_process "${pid}" KILL || true

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

dev_backed_supervisor_ensure_runtime_dirs
dev_backed_supervisor_acquire_lock
dev_backed_supervisor_adopt_existing_process \
  "cloudflared" \
  "${dev_backed_supervisor_cloudflared_pid_file}" \
  "${dev_backed_supervisor_cloudflared_match_pattern}" || true
dev_backed_supervisor_adopt_existing_process \
  "supervisor-api" \
  "${dev_backed_supervisor_supervisor_pid_file}" \
  "${dev_backed_supervisor_supervisor_match_pattern}" || true

stop_process "cloudflared" "${dev_backed_supervisor_cloudflared_pid_file}"
stop_process "supervisor-api" "${dev_backed_supervisor_supervisor_pid_file}"
