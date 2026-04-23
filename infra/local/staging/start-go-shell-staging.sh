#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=infra/local/staging/go-shell-staging-common.sh
source "${script_dir}/go-shell-staging-common.sh"

go_shell_staging_ensure_runtime_dirs
go_shell_staging_acquire_lock "${go_shell_staging_lock_wait_seconds}"
go_shell_staging_rotate_logs_if_needed
go_shell_staging_load_env
go_shell_staging_require_runtime_env
go_shell_staging_require_legacy_supervisor_stopped
go_shell_staging_run_doctor

cloudflared_bin="$(go_shell_staging_require_command cloudflared)"

go_shell_staging_adopt_existing_process \
  "cloudflared" \
  "${go_shell_staging_cloudflared_pid_file}" \
  "${go_shell_staging_cloudflared_match_pattern}" || true

if go_shell_staging_compose_project_running; then
  echo "go-shell staging runtime already running (${go_shell_staging_compose_project_name})"
else
  go_shell_staging_compose up -d --build
fi

go_shell_staging_wait_for_http_ok "${go_shell_staging_local_healthz_url}" 45 2
go_shell_staging_wait_for_http_ok "${go_shell_staging_local_readyz_url}" 45 2
go_shell_staging_wait_for_http_ok "${go_shell_staging_local_metrics_url}" 15 1
go_shell_staging_capture_compose_logs

if go_shell_staging_pid_is_running "${go_shell_staging_cloudflared_pid_file}"; then
  echo "cloudflared already running (pid $(go_shell_staging_read_pid "${go_shell_staging_cloudflared_pid_file}"))"
else
  setsid -f env \
    -u HTTP_PROXY \
    -u HTTPS_PROXY \
    -u ALL_PROXY \
    -u http_proxy \
    -u https_proxy \
    -u all_proxy \
    "${cloudflared_bin}" tunnel \
    --config "${go_shell_staging_cloudflared_config_file}" \
    --no-autoupdate \
    --edge-ip-version "${go_shell_staging_cloudflared_edge_ip_version}" \
    --metrics "${go_shell_staging_cloudflared_metrics_address}" \
    run "${go_shell_staging_tunnel_name}" \
    9>&- \
    >>"${go_shell_staging_cloudflared_log_file}" 2>&1
fi

go_shell_staging_adopt_existing_process \
  "cloudflared" \
  "${go_shell_staging_cloudflared_pid_file}" \
  "${go_shell_staging_cloudflared_match_pattern}" >/dev/null

if [[ -n "${go_shell_staging_public_readyz_url}" ]]; then
  go_shell_staging_wait_for_http_ok "${go_shell_staging_public_readyz_url}" 30 2
fi

echo "go-shell staging local healthz: ${go_shell_staging_local_healthz_url}"
echo "go-shell staging local readyz: ${go_shell_staging_local_readyz_url}"
echo "go-shell staging local metrics: ${go_shell_staging_local_metrics_url}"
if [[ -n "${go_shell_staging_public_readyz_url}" ]]; then
  echo "go-shell staging public readyz: ${go_shell_staging_public_readyz_url}"
else
  echo "Set GO_SHELL_STAGING_PUBLIC_BASE_URL to verify the public tunnel hostname."
fi
echo "logs:"
echo "  ${go_shell_staging_supervisor_shell_log_file}"
echo "  ${go_shell_staging_supervisor_orchestrator_log_file}"
echo "  ${go_shell_staging_cloudflared_log_file}"
