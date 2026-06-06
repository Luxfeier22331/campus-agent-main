#!/usr/bin/env bash

execution_control_staging_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
execution_control_staging_repo_root="$(cd "${execution_control_staging_script_dir}/../../.." && pwd)"

execution_control_staging_runtime_dir="${EXECUTION_CONTROL_STAGING_RUNTIME_DIR:-${execution_control_staging_repo_root}/.tmp/execution-control-staging}"
execution_control_staging_log_dir="${execution_control_staging_runtime_dir}/logs"
execution_control_staging_lock_file="${execution_control_staging_runtime_dir}/lifecycle.lock"
execution_control_staging_execution_control_log_file="${execution_control_staging_log_dir}/execution-control.log"
execution_control_staging_supervisor_agent_worker_log_file="${execution_control_staging_log_dir}/supervisor-agent-worker.log"
execution_control_staging_otel_collector_log_file="${execution_control_staging_log_dir}/otel-collector.log"
execution_control_staging_otel_collector_recent_log_file="${execution_control_staging_log_dir}/otel-collector.recent.log"

execution_control_staging_host="${EXECUTION_CONTROL_STAGING_HOST:-127.0.0.1}"
execution_control_staging_port="${EXECUTION_CONTROL_STAGING_PORT:-27051}"
execution_control_staging_compose_file="${EXECUTION_CONTROL_STAGING_COMPOSE_FILE:-${execution_control_staging_repo_root}/infra/local/docker-compose.execution-control-runtime.yml}"
execution_control_staging_compose_project_name="${EXECUTION_CONTROL_STAGING_COMPOSE_PROJECT_NAME:-campus-execution-control-staging}"
execution_control_staging_postgres_compose_file="${EXECUTION_CONTROL_STAGING_POSTGRES_COMPOSE_FILE:-${execution_control_staging_repo_root}/infra/local/docker-compose.postgres.yml}"
execution_control_staging_postgres_compose_project_name="${EXECUTION_CONTROL_STAGING_POSTGRES_COMPOSE_PROJECT_NAME:-campus-agent-local}"
execution_control_staging_minio_compose_file="${EXECUTION_CONTROL_STAGING_MINIO_COMPOSE_FILE:-${execution_control_staging_repo_root}/infra/local/docker-compose.minio.yml}"
execution_control_staging_minio_compose_project_name="${EXECUTION_CONTROL_STAGING_MINIO_COMPOSE_PROJECT_NAME:-campus-agent-local}"
execution_control_staging_qdrant_compose_file="${EXECUTION_CONTROL_STAGING_QDRANT_COMPOSE_FILE:-${execution_control_staging_repo_root}/infra/local/docker-compose.qdrant-single-node.yml}"
execution_control_staging_qdrant_compose_project_name="${EXECUTION_CONTROL_STAGING_QDRANT_COMPOSE_PROJECT_NAME:-local}"
execution_control_staging_app_api_base_url="${EXECUTION_CONTROL_STAGING_APP_API_BASE_URL:-https://api-staging.mucwiki-edge.link}"
execution_control_staging_data_plane_network="${CAMPUS_AGENT_DATA_PLANE_NETWORK:-campus-agent-data-plane}"
execution_control_staging_lock_wait_seconds="${EXECUTION_CONTROL_STAGING_LOCK_WAIT_SECONDS:-180}"
execution_control_staging_log_rotate_max_bytes=$((20 * 1024 * 1024))
execution_control_staging_log_rotate_keep_count=5

execution_control_staging_local_healthz_url="http://${execution_control_staging_host}:${execution_control_staging_port}/healthz"
execution_control_staging_local_readyz_url="http://${execution_control_staging_host}:${execution_control_staging_port}/readyz"
execution_control_staging_local_metrics_url="http://${execution_control_staging_host}:${execution_control_staging_port}/metrics"
execution_control_staging_app_api_readyz_url=""
if [[ -n "${execution_control_staging_app_api_base_url}" ]]; then
  execution_control_staging_app_api_readyz_url="${execution_control_staging_app_api_base_url%/}/readyz"
fi

execution_control_staging_bridge_shared_secret=""

execution_control_staging_refresh_runtime_topology_from_env() {
  execution_control_staging_runtime_dir="${EXECUTION_CONTROL_STAGING_RUNTIME_DIR:-${execution_control_staging_repo_root}/.tmp/execution-control-staging}"
  execution_control_staging_log_dir="${execution_control_staging_runtime_dir}/logs"
  execution_control_staging_lock_file="${execution_control_staging_runtime_dir}/lifecycle.lock"
  execution_control_staging_execution_control_log_file="${execution_control_staging_log_dir}/execution-control.log"
  execution_control_staging_supervisor_agent_worker_log_file="${execution_control_staging_log_dir}/supervisor-agent-worker.log"
  execution_control_staging_otel_collector_log_file="${execution_control_staging_log_dir}/otel-collector.log"
  execution_control_staging_otel_collector_recent_log_file="${execution_control_staging_log_dir}/otel-collector.recent.log"
  execution_control_staging_host="${EXECUTION_CONTROL_STAGING_HOST:-127.0.0.1}"
  execution_control_staging_port="${EXECUTION_CONTROL_STAGING_PORT:-27051}"
  execution_control_staging_compose_file="${EXECUTION_CONTROL_STAGING_COMPOSE_FILE:-${execution_control_staging_repo_root}/infra/local/docker-compose.execution-control-runtime.yml}"
  execution_control_staging_compose_project_name="${EXECUTION_CONTROL_STAGING_COMPOSE_PROJECT_NAME:-campus-execution-control-staging}"
  execution_control_staging_local_healthz_url="http://${execution_control_staging_host}:${execution_control_staging_port}/healthz"
  execution_control_staging_local_readyz_url="http://${execution_control_staging_host}:${execution_control_staging_port}/readyz"
  execution_control_staging_local_metrics_url="http://${execution_control_staging_host}:${execution_control_staging_port}/metrics"
}

execution_control_staging_runtime_globals_declared() {
  : "${execution_control_staging_runtime_dir}" \
    "${execution_control_staging_log_dir}" \
    "${execution_control_staging_lock_file}" \
    "${execution_control_staging_execution_control_log_file}" \
    "${execution_control_staging_supervisor_agent_worker_log_file}" \
    "${execution_control_staging_otel_collector_log_file}" \
    "${execution_control_staging_otel_collector_recent_log_file}" \
    "${execution_control_staging_host}" \
    "${execution_control_staging_port}" \
    "${execution_control_staging_compose_file}" \
    "${execution_control_staging_compose_project_name}" \
    "${execution_control_staging_app_api_base_url}" \
    "${execution_control_staging_lock_wait_seconds}" \
    "${execution_control_staging_log_rotate_max_bytes}" \
    "${execution_control_staging_log_rotate_keep_count}" \
    "${execution_control_staging_local_healthz_url}" \
    "${execution_control_staging_local_readyz_url}" \
    "${execution_control_staging_local_metrics_url}" \
    "${execution_control_staging_app_api_readyz_url}"
}

# shellcheck source=infra/local/staging/execution-control-staging-core.sh
source "${execution_control_staging_script_dir}/execution-control-staging-core.sh"
# shellcheck source=infra/local/staging/execution-control-staging-env.sh
source "${execution_control_staging_script_dir}/execution-control-staging-env.sh"
# shellcheck source=infra/local/staging/execution-control-staging-data-plane.sh
source "${execution_control_staging_script_dir}/execution-control-staging-data-plane.sh"
# shellcheck source=infra/local/staging/execution-control-staging-observability.sh
source "${execution_control_staging_script_dir}/execution-control-staging-observability.sh"
