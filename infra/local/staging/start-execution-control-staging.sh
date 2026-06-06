#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=infra/local/staging/execution-control-staging-common.sh
source "${script_dir}/execution-control-staging-common.sh"

execution_control_staging_ensure_runtime_dirs
execution_control_staging_acquire_lock "${execution_control_staging_lock_wait_seconds}"
execution_control_staging_rotate_logs_if_needed
execution_control_staging_load_env
execution_control_staging_require_runtime_env
execution_control_staging_run_doctor
execution_control_staging_ensure_data_plane_network
execution_control_staging_ensure_self_hosted_data_plane_dependencies
execution_control_staging_require_data_plane_ready
execution_control_staging_ensure_run_projection_store_schema

cloudflared_bin="$(execution_control_staging_require_command cloudflared)"

execution_control_staging_adopt_existing_process \
  "cloudflared" \
  "${execution_control_staging_cloudflared_pid_file}" \
  "${execution_control_staging_cloudflared_match_pattern}" || true

if execution_control_staging_compose_project_running; then
  echo "execution-control staging runtime already running (${execution_control_staging_compose_project_name})"
else
  "${script_dir}/preflight-execution-control-staging.sh"
  execution_control_staging_compose up -d --build
fi

execution_control_staging_temporal_namespace_setup
execution_control_staging_wait_for_http_ok "${execution_control_staging_local_healthz_url}" 45 2
execution_control_staging_wait_for_http_ok \
  "${execution_control_staging_local_readyz_url}" \
  45 \
  2 \
  "${EXECUTION_CONTROL_SHARED_SECRET:?EXECUTION_CONTROL_SHARED_SECRET is required}" \
  "x-worker-origin-auth"
execution_control_staging_wait_for_http_ok \
  "${execution_control_staging_local_metrics_url}" \
  15 \
  1 \
  "${EXECUTION_CONTROL_METRICS_BEARER_TOKEN}" \
  "authorization"
execution_control_staging_capture_compose_logs
execution_control_staging_require_container_qdrant_ready

if execution_control_staging_pid_is_running "${execution_control_staging_cloudflared_pid_file}"; then
  echo "cloudflared already running (pid $(execution_control_staging_read_pid "${execution_control_staging_cloudflared_pid_file}"))"
else
  setsid -f env \
    "TUNNEL_TOKEN=${EXECUTION_CONTROL_STAGING_TUNNEL_TOKEN:-${TUNNEL_TOKEN:?EXECUTION_CONTROL_STAGING_TUNNEL_TOKEN is required}}" \
    -u HTTP_PROXY \
    -u HTTPS_PROXY \
    -u ALL_PROXY \
    -u http_proxy \
    -u https_proxy \
    -u all_proxy \
    "${cloudflared_bin}" tunnel \
    --no-autoupdate \
    --edge-ip-version "${execution_control_staging_cloudflared_edge_ip_version}" \
    --metrics "${execution_control_staging_cloudflared_metrics_address}" \
    run \
    9>&- \
    >>"${execution_control_staging_cloudflared_log_file}" 2>&1
fi

execution_control_staging_adopt_existing_process \
  "cloudflared" \
  "${execution_control_staging_cloudflared_pid_file}" \
  "${execution_control_staging_cloudflared_match_pattern}" >/dev/null

if [[ -n "${execution_control_staging_app_api_readyz_url}" ]]; then
  execution_control_staging_wait_for_http_ok "${execution_control_staging_app_api_readyz_url}" 30 2
fi

echo "execution-control staging local healthz: ${execution_control_staging_local_healthz_url}"
echo "execution-control staging local readyz: ${execution_control_staging_local_readyz_url}"
echo "execution-control staging local metrics: ${execution_control_staging_local_metrics_url}"
if [[ -n "${execution_control_staging_app_api_readyz_url}" ]]; then
  echo "app-api staging public readyz: ${execution_control_staging_app_api_readyz_url}"
else
  echo "Set EXECUTION_CONTROL_STAGING_APP_API_BASE_URL to verify public app-api readiness."
fi
echo "logs:"
echo "  ${execution_control_staging_otel_collector_log_file}"
echo "  ${execution_control_staging_otel_collector_recent_log_file}"
echo "  ${execution_control_staging_execution_control_log_file}"
echo "  ${execution_control_staging_supervisor_agent_worker_log_file}"
echo "  ${execution_control_staging_cloudflared_log_file}"
