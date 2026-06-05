#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=infra/local/staging/supervisor-api-staging-common.sh
source "${script_dir}/supervisor-api-staging-common.sh"

export SUPERVISOR_API_STAGING_RUNTIME_KIND=local-durable-proof

supervisor_api_staging_load_env
supervisor_api_staging_acquire_lock 30
supervisor_api_staging_require_local_durable_proof_env
supervisor_api_staging_require_isolated_durable_proof_runtime
supervisor_api_staging_require_data_plane_ready
supervisor_api_staging_capture_compose_logs

local_healthz_body="$(mktemp)"
local_readyz_body="$(mktemp)"
local_metrics_body="$(mktemp)"
trap 'rm -f "${local_healthz_body}" "${local_readyz_body}" "${local_metrics_body}"' EXIT

failures=()

if ! supervisor_api_staging_compose_project_running; then
  failures+=("supervisor-api compose project is not fully running")
elif ! supervisor_api_staging_require_container_qdrant_ready; then
  failures+=("supervisor-agent-worker cannot reach Qdrant through container data-plane network")
fi

local_healthz_status="$(
  supervisor_api_staging_probe_http_url "${supervisor_api_staging_local_healthz_url}" "${local_healthz_body}"
)"
if [[ "${local_healthz_status}" != "200" ]]; then
  failures+=("local healthz returned HTTP ${local_healthz_status}")
fi

local_readyz_status="$(
  supervisor_api_staging_probe_http_url \
    "${supervisor_api_staging_local_readyz_url}" \
    "${local_readyz_body}" \
    0 \
    "${SUPERVISOR_API_SHARED_SECRET:?SUPERVISOR_API_SHARED_SECRET is required}" \
    "x-worker-origin-auth"
)"
if [[ "${local_readyz_status}" != "200" ]]; then
  failures+=("local readyz returned HTTP ${local_readyz_status}")
fi
if ! supervisor_api_staging_probe_json_path_equals "${local_readyz_body}" "durable_runtime.configured" "true" ||
  ! supervisor_api_staging_probe_json_path_equals "${local_readyz_body}" "durable_runtime.healthy" "true"; then
  failures+=("local readyz payload is not durable_runtime ready")
fi
if ! supervisor_api_staging_probe_json_path_equals "${local_readyz_body}" "durable_worker_loop.enabled" "true" ||
  ! supervisor_api_staging_probe_json_path_equals "${local_readyz_body}" "durable_worker_loop.configured" "true" ||
  ! supervisor_api_staging_probe_json_path_equals "${local_readyz_body}" "durable_worker_loop.healthy" "true" ||
  ! supervisor_api_staging_probe_json_path_equals "${local_readyz_body}" "durable_worker_loop.started" "true"; then
  failures+=("local readyz payload is not durable_worker_loop started")
fi
if ! supervisor_api_staging_probe_json_path_equals "${local_readyz_body}" "durable_recovery_loop.enabled" "true" ||
  ! supervisor_api_staging_probe_json_path_equals "${local_readyz_body}" "durable_recovery_loop.configured" "true" ||
  ! supervisor_api_staging_probe_json_path_equals "${local_readyz_body}" "durable_recovery_loop.healthy" "true" ||
  ! supervisor_api_staging_probe_json_path_equals "${local_readyz_body}" "durable_recovery_loop.started" "true"; then
  failures+=("local readyz payload is not durable_recovery_loop started")
fi

local_metrics_status="$(
  supervisor_api_staging_probe_http_url \
    "${supervisor_api_staging_local_metrics_url}" \
    "${local_metrics_body}" \
    0 \
    "${SUPERVISOR_API_METRICS_BEARER_TOKEN}" \
    "authorization"
)"
if [[ "${local_metrics_status}" != "200" ]]; then
  failures+=("local metrics returned HTTP ${local_metrics_status}")
fi

if supervisor_api_staging_collector_logs_have_export_errors; then
  failures+=("otel-collector log contains permanent exporter failures")
fi

if (( ${#failures[@]} > 0 )); then
  echo "local durable proof: failed" >&2
  for failure in "${failures[@]}"; do
    echo "  - ${failure}" >&2
  done
  exit 1
fi

echo "local durable proof: ok"
echo "  - local healthz: ${supervisor_api_staging_local_healthz_url}"
echo "  - local readyz: ${supervisor_api_staging_local_readyz_url}"
echo "  - local metrics: ${supervisor_api_staging_local_metrics_url}"
