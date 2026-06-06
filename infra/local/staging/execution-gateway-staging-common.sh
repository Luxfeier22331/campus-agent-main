#!/usr/bin/env bash

execution_gateway_staging_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
execution_gateway_staging_repo_root="$(cd "${execution_gateway_staging_script_dir}/../../.." && pwd)"

execution_gateway_staging_runtime_dir="${EXECUTION_GATEWAY_STAGING_RUNTIME_DIR:-${execution_gateway_staging_repo_root}/.tmp/execution-gateway-staging}"
execution_gateway_staging_log_dir="${execution_gateway_staging_runtime_dir}/logs"
execution_gateway_staging_lock_file="${execution_gateway_staging_runtime_dir}/lifecycle.lock"
execution_gateway_staging_cloudflared_pid_file="${execution_gateway_staging_runtime_dir}/cloudflared.pid"
execution_gateway_staging_cloudflared_log_file="${execution_gateway_staging_log_dir}/cloudflared.log"
execution_gateway_staging_execution_gateway_log_file="${execution_gateway_staging_log_dir}/execution-gateway.log"
execution_gateway_staging_supervisor_agent_worker_log_file="${execution_gateway_staging_log_dir}/supervisor-agent-worker.log"
execution_gateway_staging_otel_collector_log_file="${execution_gateway_staging_log_dir}/otel-collector.log"
execution_gateway_staging_otel_collector_recent_log_file="${execution_gateway_staging_log_dir}/otel-collector.recent.log"

execution_gateway_staging_host="${EXECUTION_GATEWAY_STAGING_HOST:-127.0.0.1}"
execution_gateway_staging_port="${EXECUTION_GATEWAY_STAGING_PORT:-27051}"
execution_gateway_staging_compose_file="${EXECUTION_GATEWAY_STAGING_COMPOSE_FILE:-${execution_gateway_staging_repo_root}/infra/local/docker-compose.supervisor-runtime.yml}"
execution_gateway_staging_compose_project_name="${EXECUTION_GATEWAY_STAGING_COMPOSE_PROJECT_NAME:-campus-execution-gateway-staging}"
execution_gateway_staging_postgres_compose_file="${EXECUTION_GATEWAY_STAGING_POSTGRES_COMPOSE_FILE:-${execution_gateway_staging_repo_root}/infra/local/docker-compose.postgres.yml}"
execution_gateway_staging_postgres_compose_project_name="${EXECUTION_GATEWAY_STAGING_POSTGRES_COMPOSE_PROJECT_NAME:-campus-agent-local}"
execution_gateway_staging_minio_compose_file="${EXECUTION_GATEWAY_STAGING_MINIO_COMPOSE_FILE:-${execution_gateway_staging_repo_root}/infra/local/docker-compose.minio.yml}"
execution_gateway_staging_minio_compose_project_name="${EXECUTION_GATEWAY_STAGING_MINIO_COMPOSE_PROJECT_NAME:-campus-agent-local}"
execution_gateway_staging_qdrant_compose_file="${EXECUTION_GATEWAY_STAGING_QDRANT_COMPOSE_FILE:-${execution_gateway_staging_repo_root}/infra/local/docker-compose.qdrant-single-node.yml}"
execution_gateway_staging_qdrant_compose_project_name="${EXECUTION_GATEWAY_STAGING_QDRANT_COMPOSE_PROJECT_NAME:-local}"
execution_gateway_staging_tunnel_name="${EXECUTION_GATEWAY_STAGING_TUNNEL_NAME:-execution-gateway-staging}"
execution_gateway_staging_public_base_url="${EXECUTION_GATEWAY_STAGING_PUBLIC_BASE_URL:-https://exec-staging.mucwiki-edge.link}"
execution_gateway_staging_app_api_base_url="${EXECUTION_GATEWAY_STAGING_APP_API_BASE_URL:-https://api-staging.mucwiki-edge.link}"
execution_gateway_staging_cloudflared_metrics_address="${EXECUTION_GATEWAY_STAGING_CLOUDFLARED_METRICS_ADDRESS:-127.0.0.1:20245}"
execution_gateway_staging_cloudflared_edge_ip_version="${EXECUTION_GATEWAY_STAGING_CLOUDFLARED_EDGE_IP_VERSION:-4}"
execution_gateway_staging_data_plane_network="${CAMPUS_AGENT_DATA_PLANE_NETWORK:-campus-agent-data-plane}"
execution_gateway_staging_lock_wait_seconds="${EXECUTION_GATEWAY_STAGING_LOCK_WAIT_SECONDS:-180}"
execution_gateway_staging_cloudflared_match_pattern="${EXECUTION_GATEWAY_STAGING_CLOUDFLARED_MATCH_PATTERN:-cloudflared tunnel .* run}"
execution_gateway_staging_log_rotate_max_bytes=$((20 * 1024 * 1024))
execution_gateway_staging_log_rotate_keep_count=5

execution_gateway_staging_local_healthz_url="http://${execution_gateway_staging_host}:${execution_gateway_staging_port}/healthz"
execution_gateway_staging_local_readyz_url="http://${execution_gateway_staging_host}:${execution_gateway_staging_port}/readyz"
execution_gateway_staging_local_metrics_url="http://${execution_gateway_staging_host}:${execution_gateway_staging_port}/metrics"
execution_gateway_staging_app_api_readyz_url=""
if [[ -n "${execution_gateway_staging_app_api_base_url}" ]]; then
  execution_gateway_staging_app_api_readyz_url="${execution_gateway_staging_app_api_base_url%/}/readyz"
fi

execution_gateway_staging_bridge_shared_secret=""

execution_gateway_staging_refresh_runtime_topology_from_env() {
  execution_gateway_staging_runtime_dir="${EXECUTION_GATEWAY_STAGING_RUNTIME_DIR:-${execution_gateway_staging_repo_root}/.tmp/execution-gateway-staging}"
  execution_gateway_staging_log_dir="${execution_gateway_staging_runtime_dir}/logs"
  execution_gateway_staging_lock_file="${execution_gateway_staging_runtime_dir}/lifecycle.lock"
  execution_gateway_staging_cloudflared_pid_file="${execution_gateway_staging_runtime_dir}/cloudflared.pid"
  execution_gateway_staging_cloudflared_log_file="${execution_gateway_staging_log_dir}/cloudflared.log"
  execution_gateway_staging_execution_gateway_log_file="${execution_gateway_staging_log_dir}/execution-gateway.log"
  execution_gateway_staging_supervisor_agent_worker_log_file="${execution_gateway_staging_log_dir}/supervisor-agent-worker.log"
  execution_gateway_staging_otel_collector_log_file="${execution_gateway_staging_log_dir}/otel-collector.log"
  execution_gateway_staging_otel_collector_recent_log_file="${execution_gateway_staging_log_dir}/otel-collector.recent.log"
  execution_gateway_staging_host="${EXECUTION_GATEWAY_STAGING_HOST:-127.0.0.1}"
  execution_gateway_staging_port="${EXECUTION_GATEWAY_STAGING_PORT:-27051}"
  execution_gateway_staging_compose_file="${EXECUTION_GATEWAY_STAGING_COMPOSE_FILE:-${execution_gateway_staging_repo_root}/infra/local/docker-compose.supervisor-runtime.yml}"
  execution_gateway_staging_compose_project_name="${EXECUTION_GATEWAY_STAGING_COMPOSE_PROJECT_NAME:-campus-execution-gateway-staging}"
  execution_gateway_staging_local_healthz_url="http://${execution_gateway_staging_host}:${execution_gateway_staging_port}/healthz"
  execution_gateway_staging_local_readyz_url="http://${execution_gateway_staging_host}:${execution_gateway_staging_port}/readyz"
  execution_gateway_staging_local_metrics_url="http://${execution_gateway_staging_host}:${execution_gateway_staging_port}/metrics"
}

execution_gateway_staging_runtime_globals_declared() {
  : "${execution_gateway_staging_runtime_dir}" \
    "${execution_gateway_staging_log_dir}" \
    "${execution_gateway_staging_lock_file}" \
    "${execution_gateway_staging_cloudflared_pid_file}" \
    "${execution_gateway_staging_cloudflared_log_file}" \
    "${execution_gateway_staging_execution_gateway_log_file}" \
    "${execution_gateway_staging_supervisor_agent_worker_log_file}" \
    "${execution_gateway_staging_otel_collector_log_file}" \
    "${execution_gateway_staging_otel_collector_recent_log_file}" \
    "${execution_gateway_staging_host}" \
    "${execution_gateway_staging_port}" \
    "${execution_gateway_staging_compose_file}" \
    "${execution_gateway_staging_compose_project_name}" \
    "${execution_gateway_staging_tunnel_name}" \
    "${execution_gateway_staging_public_base_url}" \
    "${execution_gateway_staging_app_api_base_url}" \
    "${execution_gateway_staging_cloudflared_metrics_address}" \
    "${execution_gateway_staging_cloudflared_edge_ip_version}" \
    "${execution_gateway_staging_lock_wait_seconds}" \
    "${execution_gateway_staging_cloudflared_match_pattern}" \
    "${execution_gateway_staging_log_rotate_max_bytes}" \
    "${execution_gateway_staging_log_rotate_keep_count}" \
    "${execution_gateway_staging_local_healthz_url}" \
    "${execution_gateway_staging_local_readyz_url}" \
    "${execution_gateway_staging_local_metrics_url}" \
    "${execution_gateway_staging_app_api_readyz_url}"
}

# shellcheck source=infra/local/staging/execution-gateway-staging-core.sh
source "${execution_gateway_staging_script_dir}/execution-gateway-staging-core.sh"
# shellcheck source=infra/local/staging/execution-gateway-staging-env.sh
source "${execution_gateway_staging_script_dir}/execution-gateway-staging-env.sh"
# shellcheck source=infra/local/staging/execution-gateway-staging-data-plane.sh
source "${execution_gateway_staging_script_dir}/execution-gateway-staging-data-plane.sh"
# shellcheck source=infra/local/staging/execution-gateway-staging-observability.sh
source "${execution_gateway_staging_script_dir}/execution-gateway-staging-observability.sh"
