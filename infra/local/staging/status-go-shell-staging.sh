#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=infra/local/staging/go-shell-staging-common.sh
source "${script_dir}/go-shell-staging-common.sh"

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
  local bearer_token="${4:-}"
  local -a curl_command

  curl_command=(curl -sS -o "${body_file}" -w "%{http_code}")
  if [[ "${use_noproxy}" == "1" ]]; then
    curl_command+=(--noproxy '*')
  fi
  if [[ -n "${bearer_token}" ]]; then
    curl_command+=(-H "authorization: Bearer ${bearer_token}")
  fi
  curl_command+=("${url}")

  "${curl_command[@]}" || true
}

go_shell_staging_ensure_runtime_dirs
go_shell_staging_acquire_lock 30
go_shell_staging_load_env
go_shell_staging_adopt_existing_process \
  "cloudflared" \
  "${go_shell_staging_cloudflared_pid_file}" \
  "${go_shell_staging_cloudflared_match_pattern}" || true
go_shell_staging_capture_compose_logs

if (( strict_mode == 0 )); then
  if go_shell_staging_legacy_supervisor_running; then
    echo "legacy campus-supervisor-api-dev: running"
  else
    echo "legacy campus-supervisor-api-dev: stopped"
  fi

  go_shell_staging_print_process_status "cloudflared" "${go_shell_staging_cloudflared_pid_file}" || true
  echo
  echo "docker compose project: ${go_shell_staging_compose_project_name}"
  go_shell_staging_compose ps || true

  echo
  echo "local healthz: ${go_shell_staging_local_healthz_url}"
  curl -sS -i "${go_shell_staging_local_healthz_url}" || true

  echo
  echo "local readyz: ${go_shell_staging_local_readyz_url}"
  curl -sS -i "${go_shell_staging_local_readyz_url}" || true

  echo
  echo "local metrics: ${go_shell_staging_local_metrics_url}"
  if [[ -n "${SUPERVISOR_API_METRICS_BEARER_TOKEN:-}" ]]; then
    curl -sS -i \
      -H "authorization: Bearer ${SUPERVISOR_API_METRICS_BEARER_TOKEN}" \
      "${go_shell_staging_local_metrics_url}" || true
  else
    curl -sS -i "${go_shell_staging_local_metrics_url}" || true
  fi

  if [[ -n "${go_shell_staging_public_readyz_url}" ]]; then
    echo
    echo "public readyz: ${go_shell_staging_public_readyz_url}"
    curl --noproxy '*' -sS -i "${go_shell_staging_public_readyz_url}" || true
  fi

  if [[ -n "${go_shell_staging_app_api_readyz_url}" ]]; then
    echo
    echo "app-api readyz: ${go_shell_staging_app_api_readyz_url}"
    curl --noproxy '*' -sS -i "${go_shell_staging_app_api_readyz_url}" || true
  fi

  echo
  echo "logs:"
  echo "  ${go_shell_staging_supervisor_shell_log_file}"
  echo "  ${go_shell_staging_supervisor_orchestrator_log_file}"
  echo "  ${go_shell_staging_cloudflared_log_file}"
  exit 0
fi

local_healthz_body="$(mktemp)"
local_readyz_body="$(mktemp)"
local_metrics_body="$(mktemp)"
public_readyz_body="$(mktemp)"
app_api_readyz_body="$(mktemp)"
trap 'rm -f "${local_healthz_body}" "${local_readyz_body}" "${local_metrics_body}" "${public_readyz_body}" "${app_api_readyz_body}"' EXIT

failures=()

if go_shell_staging_legacy_supervisor_running; then
  failures+=("legacy campus-supervisor-api-dev process is still running")
fi

if ! go_shell_staging_compose_project_running; then
  failures+=("go-shell compose project is not fully running")
fi

if [[ -n "${go_shell_staging_public_readyz_url}" ]] && ! go_shell_staging_pid_is_running "${go_shell_staging_cloudflared_pid_file}"; then
  failures+=("cloudflared process is not running")
fi

local_healthz_status="$(probe_http_url "${go_shell_staging_local_healthz_url}" "${local_healthz_body}")"
if [[ "${local_healthz_status}" != "200" ]]; then
  failures+=("local healthz returned HTTP ${local_healthz_status}")
fi

local_readyz_status="$(probe_http_url "${go_shell_staging_local_readyz_url}" "${local_readyz_body}")"
if [[ "${local_readyz_status}" != "200" ]]; then
  failures+=("local readyz returned HTTP ${local_readyz_status}")
fi

local_metrics_status="$(
  probe_http_url \
    "${go_shell_staging_local_metrics_url}" \
    "${local_metrics_body}" \
    0 \
    "${SUPERVISOR_API_METRICS_BEARER_TOKEN:-}"
)"
if [[ "${local_metrics_status}" != "200" ]]; then
  failures+=("local metrics returned HTTP ${local_metrics_status}")
fi

if [[ -n "${go_shell_staging_public_readyz_url}" ]]; then
  public_readyz_status="$(probe_http_url "${go_shell_staging_public_readyz_url}" "${public_readyz_body}" 1)"
  if [[ "${public_readyz_status}" != "200" ]]; then
    failures+=("public readyz returned HTTP ${public_readyz_status}")
  fi
fi

if [[ -n "${go_shell_staging_app_api_readyz_url}" ]]; then
  app_api_readyz_status="$(probe_http_url "${go_shell_staging_app_api_readyz_url}" "${app_api_readyz_body}" 1)"
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
echo "  - local healthz: ${go_shell_staging_local_healthz_url}"
echo "  - local readyz: ${go_shell_staging_local_readyz_url}"
echo "  - local metrics: ${go_shell_staging_local_metrics_url}"
if [[ -n "${go_shell_staging_public_readyz_url}" ]]; then
  echo "  - public readyz: ${go_shell_staging_public_readyz_url}"
fi
if [[ -n "${go_shell_staging_app_api_readyz_url}" ]]; then
  echo "  - app-api readyz: ${go_shell_staging_app_api_readyz_url}"
fi
