#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=infra/local/staging/dev-backed-supervisor-common.sh
source "${script_dir}/dev-backed-supervisor-common.sh"

dev_backed_supervisor_ensure_runtime_dirs
dev_backed_supervisor_acquire_lock "${dev_backed_supervisor_lock_wait_seconds}"
dev_backed_supervisor_rotate_logs_if_needed
dev_backed_supervisor_load_env

uv_bin="$(dev_backed_supervisor_require_command uv)"
cloudflared_bin="$(dev_backed_supervisor_require_command cloudflared)"

if [[ -z "${SUPERVISOR_API_SHARED_SECRET:-}" ]]; then
  echo "SUPERVISOR_API_SHARED_SECRET is missing. Populate apps/app-api/.dev.vars first." >&2
  exit 1
fi

if [[ ! -f "${dev_backed_supervisor_cloudflared_config_file}" ]]; then
  echo "Missing ${dev_backed_supervisor_cloudflared_config_file}. Create the named tunnel config first." >&2
  exit 1
fi

dev_backed_supervisor_adopt_existing_process \
  "supervisor-api" \
  "${dev_backed_supervisor_supervisor_pid_file}" \
  "${dev_backed_supervisor_supervisor_match_pattern}" || true
dev_backed_supervisor_adopt_existing_process \
  "cloudflared" \
  "${dev_backed_supervisor_cloudflared_pid_file}" \
  "${dev_backed_supervisor_cloudflared_match_pattern}" || true

cd "${dev_backed_supervisor_repo_root}"

if dev_backed_supervisor_pid_is_running "${dev_backed_supervisor_supervisor_pid_file}"; then
  echo "supervisor-api already running (pid $(dev_backed_supervisor_read_pid "${dev_backed_supervisor_supervisor_pid_file}"))"
else
  setsid -f env \
    API_AUTH_MODE=trusted-worker \
    CAMPUS_AGENT_HTTP_HOST="${dev_backed_supervisor_host}" \
    CAMPUS_AGENT_HTTP_PORT="${dev_backed_supervisor_port}" \
    API_WORKER_SHARED_SECRET="${SUPERVISOR_API_SHARED_SECRET}" \
    UV_CACHE_DIR="${UV_CACHE_DIR:-/tmp/uv-cache}" \
    "${uv_bin}" run --all-packages campus-supervisor-api-dev \
    9>&- \
    >>"${dev_backed_supervisor_supervisor_log_file}" 2>&1
fi

dev_backed_supervisor_wait_for_http_ok "${dev_backed_supervisor_local_readyz_url}"
dev_backed_supervisor_adopt_existing_process \
  "supervisor-api" \
  "${dev_backed_supervisor_supervisor_pid_file}" \
  "${dev_backed_supervisor_supervisor_match_pattern}" >/dev/null

if dev_backed_supervisor_pid_is_running "${dev_backed_supervisor_cloudflared_pid_file}"; then
  echo "cloudflared already running (pid $(dev_backed_supervisor_read_pid "${dev_backed_supervisor_cloudflared_pid_file}"))"
else
  setsid -f env \
    -u HTTP_PROXY \
    -u HTTPS_PROXY \
    -u ALL_PROXY \
    -u http_proxy \
    -u https_proxy \
    -u all_proxy \
    "${cloudflared_bin}" tunnel \
    --config "${dev_backed_supervisor_cloudflared_config_file}" \
    --no-autoupdate \
    --edge-ip-version "${dev_backed_supervisor_cloudflared_edge_ip_version}" \
    --metrics "${dev_backed_supervisor_cloudflared_metrics_address}" \
    run "${dev_backed_supervisor_tunnel_name}" \
    9>&- \
    >>"${dev_backed_supervisor_cloudflared_log_file}" 2>&1
fi

if [[ -n "${dev_backed_supervisor_public_readyz_url}" ]]; then
  dev_backed_supervisor_wait_for_http_ok "${dev_backed_supervisor_public_readyz_url}"
fi
dev_backed_supervisor_adopt_existing_process \
  "cloudflared" \
  "${dev_backed_supervisor_cloudflared_pid_file}" \
  "${dev_backed_supervisor_cloudflared_match_pattern}" >/dev/null

echo "supervisor-api local readyz: ${dev_backed_supervisor_local_readyz_url}"
if [[ -n "${dev_backed_supervisor_public_readyz_url}" ]]; then
  echo "supervisor-api public readyz: ${dev_backed_supervisor_public_readyz_url}"
else
  echo "Set DEV_BACKED_SUPERVISOR_PUBLIC_BASE_URL to verify the public tunnel hostname."
fi
echo "logs:"
echo "  ${dev_backed_supervisor_supervisor_log_file}"
echo "  ${dev_backed_supervisor_cloudflared_log_file}"
