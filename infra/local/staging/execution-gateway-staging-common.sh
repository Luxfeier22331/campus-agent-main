#!/usr/bin/env bash

supervisor_api_staging_script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
supervisor_api_staging_repo_root="$(cd "${supervisor_api_staging_script_dir}/../../.." && pwd)"

supervisor_api_staging_runtime_dir="${SUPERVISOR_API_STAGING_RUNTIME_DIR:-${supervisor_api_staging_repo_root}/.tmp/supervisor-api-staging}"
supervisor_api_staging_log_dir="${supervisor_api_staging_runtime_dir}/logs"
supervisor_api_staging_lock_file="${supervisor_api_staging_runtime_dir}/lifecycle.lock"
supervisor_api_staging_cloudflared_pid_file="${supervisor_api_staging_runtime_dir}/cloudflared.pid"
supervisor_api_staging_cloudflared_log_file="${supervisor_api_staging_log_dir}/cloudflared.log"
supervisor_api_staging_supervisor_api_log_file="${supervisor_api_staging_log_dir}/supervisor-api.log"
supervisor_api_staging_supervisor_agent_worker_log_file="${supervisor_api_staging_log_dir}/supervisor-agent-worker.log"
supervisor_api_staging_otel_collector_log_file="${supervisor_api_staging_log_dir}/otel-collector.log"
supervisor_api_staging_otel_collector_recent_log_file="${supervisor_api_staging_log_dir}/otel-collector.recent.log"

supervisor_api_staging_host="${SUPERVISOR_API_STAGING_HOST:-127.0.0.1}"
supervisor_api_staging_port="${SUPERVISOR_API_STAGING_PORT:-27051}"
supervisor_api_staging_compose_file="${SUPERVISOR_API_STAGING_COMPOSE_FILE:-${supervisor_api_staging_repo_root}/infra/local/docker-compose.supervisor-runtime.yml}"
supervisor_api_staging_compose_project_name="${SUPERVISOR_API_STAGING_COMPOSE_PROJECT_NAME:-campus-supervisor-api-staging}"
supervisor_api_staging_postgres_compose_file="${SUPERVISOR_API_STAGING_POSTGRES_COMPOSE_FILE:-${supervisor_api_staging_repo_root}/infra/local/docker-compose.postgres.yml}"
supervisor_api_staging_postgres_compose_project_name="${SUPERVISOR_API_STAGING_POSTGRES_COMPOSE_PROJECT_NAME:-campus-agent-local}"
supervisor_api_staging_minio_compose_file="${SUPERVISOR_API_STAGING_MINIO_COMPOSE_FILE:-${supervisor_api_staging_repo_root}/infra/local/docker-compose.minio.yml}"
supervisor_api_staging_minio_compose_project_name="${SUPERVISOR_API_STAGING_MINIO_COMPOSE_PROJECT_NAME:-campus-agent-local}"
supervisor_api_staging_qdrant_compose_file="${SUPERVISOR_API_STAGING_QDRANT_COMPOSE_FILE:-${supervisor_api_staging_repo_root}/infra/local/docker-compose.qdrant-single-node.yml}"
supervisor_api_staging_qdrant_compose_project_name="${SUPERVISOR_API_STAGING_QDRANT_COMPOSE_PROJECT_NAME:-local}"
supervisor_api_staging_tunnel_name="${SUPERVISOR_API_STAGING_TUNNEL_NAME:-supervisor-api-staging}"
supervisor_api_staging_public_base_url="${SUPERVISOR_API_STAGING_PUBLIC_BASE_URL:-https://exec-staging.mucwiki-edge.link}"
supervisor_api_staging_app_api_base_url="${SUPERVISOR_API_STAGING_APP_API_BASE_URL:-https://api-staging.mucwiki-edge.link}"
supervisor_api_staging_cloudflared_metrics_address="${SUPERVISOR_API_STAGING_CLOUDFLARED_METRICS_ADDRESS:-127.0.0.1:20245}"
supervisor_api_staging_cloudflared_edge_ip_version="${SUPERVISOR_API_STAGING_CLOUDFLARED_EDGE_IP_VERSION:-4}"
supervisor_api_staging_data_plane_network="${CAMPUS_AGENT_DATA_PLANE_NETWORK:-campus-agent-data-plane}"
supervisor_api_staging_lock_wait_seconds="${SUPERVISOR_API_STAGING_LOCK_WAIT_SECONDS:-180}"
supervisor_api_staging_cloudflared_match_pattern="${SUPERVISOR_API_STAGING_CLOUDFLARED_MATCH_PATTERN:-cloudflared tunnel .* run}"
supervisor_api_staging_log_rotate_max_bytes=$((20 * 1024 * 1024))
supervisor_api_staging_log_rotate_keep_count=5

supervisor_api_staging_local_healthz_url="http://${supervisor_api_staging_host}:${supervisor_api_staging_port}/healthz"
supervisor_api_staging_local_readyz_url="http://${supervisor_api_staging_host}:${supervisor_api_staging_port}/readyz"
supervisor_api_staging_local_metrics_url="http://${supervisor_api_staging_host}:${supervisor_api_staging_port}/metrics"
supervisor_api_staging_app_api_readyz_url=""
if [[ -n "${supervisor_api_staging_app_api_base_url}" ]]; then
  supervisor_api_staging_app_api_readyz_url="${supervisor_api_staging_app_api_base_url%/}/readyz"
fi

supervisor_api_staging_bridge_shared_secret=""

supervisor_api_staging_refresh_runtime_topology_from_env() {
  supervisor_api_staging_runtime_dir="${SUPERVISOR_API_STAGING_RUNTIME_DIR:-${supervisor_api_staging_repo_root}/.tmp/supervisor-api-staging}"
  supervisor_api_staging_log_dir="${supervisor_api_staging_runtime_dir}/logs"
  supervisor_api_staging_lock_file="${supervisor_api_staging_runtime_dir}/lifecycle.lock"
  supervisor_api_staging_cloudflared_pid_file="${supervisor_api_staging_runtime_dir}/cloudflared.pid"
  supervisor_api_staging_cloudflared_log_file="${supervisor_api_staging_log_dir}/cloudflared.log"
  supervisor_api_staging_supervisor_api_log_file="${supervisor_api_staging_log_dir}/supervisor-api.log"
  supervisor_api_staging_supervisor_agent_worker_log_file="${supervisor_api_staging_log_dir}/supervisor-agent-worker.log"
  supervisor_api_staging_otel_collector_log_file="${supervisor_api_staging_log_dir}/otel-collector.log"
  supervisor_api_staging_otel_collector_recent_log_file="${supervisor_api_staging_log_dir}/otel-collector.recent.log"
  supervisor_api_staging_host="${SUPERVISOR_API_STAGING_HOST:-127.0.0.1}"
  supervisor_api_staging_port="${SUPERVISOR_API_STAGING_PORT:-27051}"
  supervisor_api_staging_compose_file="${SUPERVISOR_API_STAGING_COMPOSE_FILE:-${supervisor_api_staging_repo_root}/infra/local/docker-compose.supervisor-runtime.yml}"
  supervisor_api_staging_compose_project_name="${SUPERVISOR_API_STAGING_COMPOSE_PROJECT_NAME:-campus-supervisor-api-staging}"
  supervisor_api_staging_local_healthz_url="http://${supervisor_api_staging_host}:${supervisor_api_staging_port}/healthz"
  supervisor_api_staging_local_readyz_url="http://${supervisor_api_staging_host}:${supervisor_api_staging_port}/readyz"
  supervisor_api_staging_local_metrics_url="http://${supervisor_api_staging_host}:${supervisor_api_staging_port}/metrics"
}

supervisor_api_staging_runtime_globals_declared() {
  : "${supervisor_api_staging_runtime_dir}" \
    "${supervisor_api_staging_log_dir}" \
    "${supervisor_api_staging_lock_file}" \
    "${supervisor_api_staging_cloudflared_pid_file}" \
    "${supervisor_api_staging_cloudflared_log_file}" \
    "${supervisor_api_staging_supervisor_api_log_file}" \
    "${supervisor_api_staging_supervisor_agent_worker_log_file}" \
    "${supervisor_api_staging_otel_collector_log_file}" \
    "${supervisor_api_staging_otel_collector_recent_log_file}" \
    "${supervisor_api_staging_host}" \
    "${supervisor_api_staging_port}" \
    "${supervisor_api_staging_compose_file}" \
    "${supervisor_api_staging_compose_project_name}" \
    "${supervisor_api_staging_tunnel_name}" \
    "${supervisor_api_staging_public_base_url}" \
    "${supervisor_api_staging_app_api_base_url}" \
    "${supervisor_api_staging_cloudflared_metrics_address}" \
    "${supervisor_api_staging_cloudflared_edge_ip_version}" \
    "${supervisor_api_staging_lock_wait_seconds}" \
    "${supervisor_api_staging_cloudflared_match_pattern}" \
    "${supervisor_api_staging_log_rotate_max_bytes}" \
    "${supervisor_api_staging_log_rotate_keep_count}" \
    "${supervisor_api_staging_local_healthz_url}" \
    "${supervisor_api_staging_local_readyz_url}" \
    "${supervisor_api_staging_local_metrics_url}" \
    "${supervisor_api_staging_app_api_readyz_url}"
}

# shellcheck source=infra/local/staging/supervisor-api-staging-core.sh
source "${supervisor_api_staging_script_dir}/supervisor-api-staging-core.sh"
# shellcheck source=infra/local/staging/supervisor-api-staging-env.sh
source "${supervisor_api_staging_script_dir}/supervisor-api-staging-env.sh"
# shellcheck source=infra/local/staging/supervisor-api-staging-data-plane.sh
source "${supervisor_api_staging_script_dir}/supervisor-api-staging-data-plane.sh"
# shellcheck source=infra/local/staging/supervisor-api-staging-observability.sh
source "${supervisor_api_staging_script_dir}/supervisor-api-staging-observability.sh"
