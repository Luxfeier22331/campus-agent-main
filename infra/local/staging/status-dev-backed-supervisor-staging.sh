#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck disable=SC1091
source "${script_dir}/dev-backed-supervisor-common.sh"

dev_backed_supervisor_ensure_runtime_dirs
dev_backed_supervisor_adopt_existing_process \
  "supervisor-api" \
  "${dev_backed_supervisor_supervisor_pid_file}" \
  "${dev_backed_supervisor_supervisor_match_pattern}" || true
dev_backed_supervisor_adopt_existing_process \
  "cloudflared" \
  "${dev_backed_supervisor_cloudflared_pid_file}" \
  "${dev_backed_supervisor_cloudflared_match_pattern}" || true

dev_backed_supervisor_print_process_status "supervisor-api" "${dev_backed_supervisor_supervisor_pid_file}" || true
dev_backed_supervisor_print_process_status "cloudflared" "${dev_backed_supervisor_cloudflared_pid_file}" || true

echo "local readyz: ${dev_backed_supervisor_local_readyz_url}"
curl -sS -i "${dev_backed_supervisor_local_readyz_url}" || true

if [[ -n "${dev_backed_supervisor_public_readyz_url}" ]]; then
  echo
  echo "public readyz: ${dev_backed_supervisor_public_readyz_url}"
  curl --noproxy '*' -sS -i "${dev_backed_supervisor_public_readyz_url}" || true
fi

echo
echo "logs:"
echo "  ${dev_backed_supervisor_supervisor_log_file}"
echo "  ${dev_backed_supervisor_cloudflared_log_file}"
