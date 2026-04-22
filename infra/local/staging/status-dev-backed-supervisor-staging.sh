#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=infra/local/staging/dev-backed-supervisor-common.sh
source "${script_dir}/dev-backed-supervisor-common.sh"

strict_mode=0
if (( $# > 1 )); then
  echo "Usage: $0 [--check]" >&2
  exit 2
fi

if (( $# == 1 )); then
  if [[ "$1" != "--check" ]]; then
    echo "Usage: $0 [--check]" >&2
    exit 2
  fi
  strict_mode=1
fi

probe_http_url() {
  local url="$1"
  local body_file="$2"
  local use_noproxy="${3:-0}"
  local -a curl_command

  curl_command=(curl -sS -o "${body_file}" -w "%{http_code}")
  if [[ "${use_noproxy}" == "1" ]]; then
    curl_command+=(--noproxy '*')
  fi
  curl_command+=("${url}")

  "${curl_command[@]}" || true
}

dev_backed_supervisor_ensure_runtime_dirs
dev_backed_supervisor_acquire_lock 30
dev_backed_supervisor_adopt_existing_process \
  "supervisor-api" \
  "${dev_backed_supervisor_supervisor_pid_file}" \
  "${dev_backed_supervisor_supervisor_match_pattern}" || true
dev_backed_supervisor_adopt_existing_process \
  "cloudflared" \
  "${dev_backed_supervisor_cloudflared_pid_file}" \
  "${dev_backed_supervisor_cloudflared_match_pattern}" || true

if (( strict_mode == 0 )); then
  dev_backed_supervisor_print_process_status "supervisor-api" "${dev_backed_supervisor_supervisor_pid_file}" || true
  dev_backed_supervisor_print_process_status "cloudflared" "${dev_backed_supervisor_cloudflared_pid_file}" || true

  echo "local readyz: ${dev_backed_supervisor_local_readyz_url}"
  curl -sS -i "${dev_backed_supervisor_local_readyz_url}" || true

  if [[ -n "${dev_backed_supervisor_public_readyz_url}" ]]; then
    echo
    echo "public readyz: ${dev_backed_supervisor_public_readyz_url}"
    curl --noproxy '*' -sS -i "${dev_backed_supervisor_public_readyz_url}" || true
  fi

  if [[ -n "${dev_backed_supervisor_app_api_readyz_url}" ]]; then
    echo
    echo "app-api readyz: ${dev_backed_supervisor_app_api_readyz_url}"
    curl --noproxy '*' -sS -i "${dev_backed_supervisor_app_api_readyz_url}" || true
  fi

  echo
  echo "logs:"
  echo "  ${dev_backed_supervisor_supervisor_log_file}"
  echo "  ${dev_backed_supervisor_cloudflared_log_file}"
  exit 0
fi

local_readyz_body="$(mktemp)"
public_readyz_body="$(mktemp)"
app_api_readyz_body="$(mktemp)"
trap 'rm -f "${local_readyz_body}" "${public_readyz_body}" "${app_api_readyz_body}"' EXIT

failures=()

if ! dev_backed_supervisor_pid_is_running "${dev_backed_supervisor_supervisor_pid_file}"; then
  failures+=("supervisor-api process is not running")
fi

if ! dev_backed_supervisor_pid_is_running "${dev_backed_supervisor_cloudflared_pid_file}"; then
  failures+=("cloudflared process is not running")
fi

local_readyz_status="$(probe_http_url "${dev_backed_supervisor_local_readyz_url}" "${local_readyz_body}")"
if [[ "${local_readyz_status}" != "200" ]]; then
  failures+=("local readyz returned HTTP ${local_readyz_status}")
fi

if [[ -n "${dev_backed_supervisor_public_readyz_url}" ]]; then
  public_readyz_status="$(probe_http_url "${dev_backed_supervisor_public_readyz_url}" "${public_readyz_body}" 1)"
  if [[ "${public_readyz_status}" != "200" ]]; then
    failures+=("public readyz returned HTTP ${public_readyz_status}")
  fi
fi

if [[ -n "${dev_backed_supervisor_app_api_readyz_url}" ]]; then
  app_api_readyz_status="$(probe_http_url "${dev_backed_supervisor_app_api_readyz_url}" "${app_api_readyz_body}" 1)"
  app_api_readyz_payload="$(tr -d '[:space:]' <"${app_api_readyz_body}")"

  if [[ "${app_api_readyz_status}" != "200" ]]; then
    failures+=("app-api readyz returned HTTP ${app_api_readyz_status}")
  fi
  if [[ "${app_api_readyz_payload}" != *'"status":"ready"'* ]]; then
    failures+=("app-api readyz payload is not status=ready")
  fi
  if [[ "${app_api_readyz_payload}" != *'"auth":"ready"'* ]]; then
    failures+=("app-api readyz payload is not auth=ready")
  fi
  if [[ "${app_api_readyz_payload}" != *'"database":"ready"'* ]]; then
    failures+=("app-api readyz payload is not database=ready")
  fi
  if [[ "${app_api_readyz_payload}" != *'"supervisorApi":"ready"'* ]]; then
    failures+=("app-api readyz payload is not supervisorApi=ready")
  fi
fi

if (( ${#failures[@]} > 0 )); then
  echo "strict check: failed" >&2
  for failure in "${failures[@]}"; do
    echo "  - ${failure}" >&2
  done
  exit 1
fi

echo "strict check: ok"
echo "  - local readyz: ${dev_backed_supervisor_local_readyz_url}"
if [[ -n "${dev_backed_supervisor_public_readyz_url}" ]]; then
  echo "  - public readyz: ${dev_backed_supervisor_public_readyz_url}"
fi
if [[ -n "${dev_backed_supervisor_app_api_readyz_url}" ]]; then
  echo "  - app-api readyz: ${dev_backed_supervisor_app_api_readyz_url}"
fi
