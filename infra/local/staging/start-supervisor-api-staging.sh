#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=infra/local/staging/supervisor-api-staging-common.sh
source "${script_dir}/supervisor-api-staging-common.sh"

supervisor_api_staging_ensure_runtime_dirs
supervisor_api_staging_acquire_lock "${supervisor_api_staging_lock_wait_seconds}"
supervisor_api_staging_rotate_logs_if_needed
supervisor_api_staging_load_env
supervisor_api_staging_require_runtime_env
supervisor_api_staging_run_doctor

cloudflared_bin="$(supervisor_api_staging_require_command cloudflared)"

supervisor_api_staging_adopt_existing_process \
  "cloudflared" \
  "${supervisor_api_staging_cloudflared_pid_file}" \
  "${supervisor_api_staging_cloudflared_match_pattern}" || true

if supervisor_api_staging_compose_project_running; then
  echo "supervisor-api staging runtime already running (${supervisor_api_staging_compose_project_name})"
else
  supervisor_api_staging_compose up -d --build
fi

supervisor_api_staging_wait_for_http_ok "${supervisor_api_staging_local_healthz_url}" 45 2
supervisor_api_staging_wait_for_http_ok "${supervisor_api_staging_local_readyz_url}" 45 2
supervisor_api_staging_wait_for_http_ok "${supervisor_api_staging_local_metrics_url}" 15 1
supervisor_api_staging_capture_compose_logs

if supervisor_api_staging_pid_is_running "${supervisor_api_staging_cloudflared_pid_file}"; then
  echo "cloudflared already running (pid $(supervisor_api_staging_read_pid "${supervisor_api_staging_cloudflared_pid_file}"))"
else
  setsid -f env \
    -u HTTP_PROXY \
    -u HTTPS_PROXY \
    -u ALL_PROXY \
    -u http_proxy \
    -u https_proxy \
    -u all_proxy \
    "${cloudflared_bin}" tunnel \
    --config "${supervisor_api_staging_cloudflared_config_file}" \
    --no-autoupdate \
    --edge-ip-version "${supervisor_api_staging_cloudflared_edge_ip_version}" \
    --metrics "${supervisor_api_staging_cloudflared_metrics_address}" \
    run "${supervisor_api_staging_tunnel_name}" \
    9>&- \
    >>"${supervisor_api_staging_cloudflared_log_file}" 2>&1
fi

supervisor_api_staging_adopt_existing_process \
  "cloudflared" \
  "${supervisor_api_staging_cloudflared_pid_file}" \
  "${supervisor_api_staging_cloudflared_match_pattern}" >/dev/null

if [[ -n "${supervisor_api_staging_public_readyz_url}" ]]; then
  supervisor_api_staging_wait_for_http_ok "${supervisor_api_staging_public_readyz_url}" 30 2
fi

echo "supervisor-api staging local healthz: ${supervisor_api_staging_local_healthz_url}"
echo "supervisor-api staging local readyz: ${supervisor_api_staging_local_readyz_url}"
echo "supervisor-api staging local metrics: ${supervisor_api_staging_local_metrics_url}"
if [[ -n "${supervisor_api_staging_public_readyz_url}" ]]; then
  echo "supervisor-api staging public readyz: ${supervisor_api_staging_public_readyz_url}"
else
  echo "Set SUPERVISOR_API_STAGING_PUBLIC_BASE_URL to verify the public tunnel hostname."
fi
echo "logs:"
echo "  ${supervisor_api_staging_supervisor_api_log_file}"
echo "  ${supervisor_api_staging_supervisor_core_worker_log_file}"
echo "  ${supervisor_api_staging_cloudflared_log_file}"
