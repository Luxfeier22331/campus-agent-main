#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2154

execution_control_staging_ensure_data_plane_network() {
  local docker_bin
  docker_bin="$(execution_control_staging_require_command docker)"
  if ! "${docker_bin}" network inspect "${execution_control_staging_data_plane_network}" >/dev/null 2>&1; then
    "${docker_bin}" network create "${execution_control_staging_data_plane_network}" >/dev/null
  fi
}

execution_control_staging_requires_local_postgres_dependency() {
  [[ "${EXECUTION_CONTROL_STAGING_REQUIRES_LOCAL_POSTGRES:-false}" == "true" ]]
}

execution_control_staging_requires_local_qdrant_dependency() {
  [[ "${EXECUTION_CONTROL_STAGING_REQUIRES_LOCAL_QDRANT:-false}" == "true" ]]
}

execution_control_staging_dependency_compose() {
  local project_name="$1"
  local compose_file="$2"
  shift 2
  local docker_bin
  docker_bin="$(execution_control_staging_require_command docker)"

  (
    cd "${execution_control_staging_repo_root}" || exit
    COMPOSE_PROJECT_NAME="${project_name}" \
    CAMPUS_AGENT_DATA_PLANE_NETWORK="${execution_control_staging_data_plane_network}" \
    "${docker_bin}" compose -f "${compose_file}" "$@"
  )
}

execution_control_staging_postgres_compose() {
  local docker_bin
  docker_bin="$(execution_control_staging_require_command docker)"

  (
    cd "${execution_control_staging_repo_root}" || exit
    COMPOSE_PROJECT_NAME="${execution_control_staging_postgres_compose_project_name}" \
    CAMPUS_AGENT_DATA_PLANE_NETWORK="${execution_control_staging_data_plane_network}" \
    LOCAL_POSTGRES_DB="${EXECUTION_CONTROL_STAGING_LOCAL_POSTGRES_DB:?EXECUTION_CONTROL_STAGING_LOCAL_POSTGRES_DB is required}" \
    LOCAL_POSTGRES_USER="${EXECUTION_CONTROL_STAGING_LOCAL_POSTGRES_USER:?EXECUTION_CONTROL_STAGING_LOCAL_POSTGRES_USER is required}" \
    LOCAL_POSTGRES_PASSWORD="${EXECUTION_CONTROL_STAGING_LOCAL_POSTGRES_PASSWORD:?EXECUTION_CONTROL_STAGING_LOCAL_POSTGRES_PASSWORD is required}" \
    LOCAL_POSTGRES_PORT="${EXECUTION_CONTROL_STAGING_LOCAL_POSTGRES_PORT:?EXECUTION_CONTROL_STAGING_LOCAL_POSTGRES_PORT is required}" \
    "${docker_bin}" compose -f "${execution_control_staging_postgres_compose_file}" "$@"
  )
}

execution_control_staging_qdrant_compose() {
  local docker_bin
  local qdrant_tls_dir
  docker_bin="$(execution_control_staging_require_command docker)"
  qdrant_tls_dir="${QDRANT_TLS_DIR:-}"
  if [[ -z "${qdrant_tls_dir}" && -n "${QDRANT_TLS_CA_CERT_PATH:-}" ]]; then
    qdrant_tls_dir="$(dirname "${QDRANT_TLS_CA_CERT_PATH}")"
  fi

  (
    cd "${execution_control_staging_repo_root}" || exit
    COMPOSE_PROJECT_NAME="${execution_control_staging_qdrant_compose_project_name}" \
    CAMPUS_AGENT_DATA_PLANE_NETWORK="${execution_control_staging_data_plane_network}" \
    QDRANT_API_KEY="${QDRANT_API_KEY:?QDRANT_API_KEY is required}" \
    QDRANT_READ_ONLY_API_KEY="${QDRANT_READ_ONLY_API_KEY:?QDRANT_READ_ONLY_API_KEY is required}" \
    QDRANT_TLS_DIR="${qdrant_tls_dir:?QDRANT_TLS_DIR or QDRANT_TLS_CA_CERT_PATH is required}" \
    "${docker_bin}" compose -f "${execution_control_staging_qdrant_compose_file}" "$@"
  )
}

execution_control_staging_ensure_self_hosted_data_plane_dependencies() {
  execution_control_staging_ensure_data_plane_network
  if execution_control_staging_requires_local_postgres_dependency; then
    execution_control_staging_postgres_compose up -d postgres
  fi
  if execution_control_staging_requires_local_qdrant_dependency; then
    execution_control_staging_qdrant_compose up -d
  fi
}

execution_control_staging_require_container_qdrant_ready() {
  local readyz_body
  local readyz_status
  readyz_body="$(mktemp)"
  trap 'rm -f "${readyz_body}"' RETURN
  readyz_status="$(
    execution_control_staging_probe_http_url \
      "${execution_control_staging_local_readyz_url}" \
      "${readyz_body}" \
      0 \
      "${EXECUTION_CONTROL_SHARED_SECRET:?EXECUTION_CONTROL_SHARED_SECRET is required}" \
      "x-worker-origin-auth"
  )"
  if [[ "${readyz_status}" != "200" ]]; then
    echo "execution-control /readyz cannot prove Go RAG data-plane readiness; status=${readyz_status}" >&2
    return 1
  fi
  if ! execution_control_staging_probe_json_path_equals "${readyz_body}" "rag_runtime.lookup_healthy" "true"; then
    echo "execution-control Go RAG lookup runtime is not healthy in /readyz." >&2
    return 1
  fi
  if ! execution_control_staging_probe_json_path_equals "${readyz_body}" "rag_runtime.synthesis_healthy" "true"; then
    echo "execution-control Go RAG synthesis runtime is not healthy in /readyz." >&2
    return 1
  fi
}

execution_control_staging_require_data_plane_ready() {
  execution_control_staging_require_rag_runtime_ready
}

execution_control_staging_require_rag_runtime_ready() {
  echo "execution-control staging RAG runtime readiness is asserted by /readyz." >&2
  echo "Legacy Python ingestion probes were removed; release readiness must come from ingestion-control task closeout and operator projections." >&2
}
