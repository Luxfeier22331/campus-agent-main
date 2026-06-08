#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=infra/local/staging/execution-control-staging-common.sh
source "${script_dir}/execution-control-staging-common.sh"

export EXECUTION_CONTROL_STAGING_RUNTIME_KIND=local-temporal-proof

execution_control_staging_load_env
execution_control_staging_acquire_lock 30
execution_control_staging_require_local_temporal_proof_env
execution_control_staging_require_isolated_temporal_proof_runtime
execution_control_staging_require_data_plane_ready
execution_control_staging_capture_compose_logs

local_healthz_body="$(mktemp)"
local_readyz_body="$(mktemp)"
local_metrics_body="$(mktemp)"
trap 'rm -f "${local_healthz_body}" "${local_readyz_body}" "${local_metrics_body}"' EXIT

failures=()

if ! execution_control_staging_compose_project_running; then
  failures+=("execution-control compose project is not fully running")
elif ! execution_control_staging_require_container_qdrant_ready; then
  failures+=("supervisor-agent-worker cannot reach Qdrant through container data-plane network")
fi

local_healthz_status="$(
  execution_control_staging_probe_http_url "${execution_control_staging_local_healthz_url}" "${local_healthz_body}"
)"
if [[ "${local_healthz_status}" != "200" ]]; then
  failures+=("local healthz returned HTTP ${local_healthz_status}")
fi

local_readyz_status="$(
  execution_control_staging_probe_http_url \
    "${execution_control_staging_local_readyz_url}" \
    "${local_readyz_body}" \
    0 \
    "${EXECUTION_CONTROL_SHARED_SECRET:?EXECUTION_CONTROL_SHARED_SECRET is required}" \
    "x-worker-origin-auth"
)"
if [[ "${local_readyz_status}" != "200" ]]; then
  failures+=("local readyz returned HTTP ${local_readyz_status}")
fi
if ! execution_control_staging_probe_json_path_equals "${local_readyz_body}" "run_projection_store.configured" "true" ||
  ! execution_control_staging_probe_json_path_equals "${local_readyz_body}" "run_projection_store.healthy" "true"; then
  failures+=("local readyz payload is not run_projection_store ready")
fi
if ! execution_control_staging_probe_json_path_equals "${local_readyz_body}" "temporal_runtime.configured" "true" ||
  ! execution_control_staging_probe_json_path_equals "${local_readyz_body}" "temporal_runtime.healthy" "true"; then
  failures+=("local readyz payload is not temporal_runtime ready")
fi
local_metrics_status="$(
  execution_control_staging_probe_http_url \
    "${execution_control_staging_local_metrics_url}" \
    "${local_metrics_body}" \
    0 \
    "${EXECUTION_CONTROL_METRICS_BEARER_TOKEN}" \
    "authorization"
)"
if [[ "${local_metrics_status}" != "200" ]]; then
  failures+=("local metrics returned HTTP ${local_metrics_status}")
fi

if execution_control_staging_collector_logs_have_export_errors; then
  failures+=("otel-collector log contains permanent exporter failures")
fi

if (( ${#failures[@]} > 0 )); then
  echo "local temporal proof: failed" >&2
  for failure in "${failures[@]}"; do
    echo "  - ${failure}" >&2
  done
  exit 1
fi

echo "local temporal proof: ok"
echo "  - local healthz: ${execution_control_staging_local_healthz_url}"
echo "  - local readyz: ${execution_control_staging_local_readyz_url}"
echo "  - local metrics: ${execution_control_staging_local_metrics_url}"
