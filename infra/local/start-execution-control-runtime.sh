#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
compose_file="${EXECUTION_CONTROL_RUNTIME_COMPOSE_FILE:-${repo_root}/infra/local/docker-compose.execution-control-runtime.yml}"
compose_local_file="${EXECUTION_CONTROL_RUNTIME_LOCAL_COMPOSE_FILE:-${repo_root}/infra/local/docker-compose.execution-control-runtime.local.yml}"
compose_langfuse_file="${EXECUTION_CONTROL_RUNTIME_LANGFUSE_COMPOSE_FILE:-${repo_root}/infra/local/docker-compose.execution-control-runtime.langfuse.yml}"
compose_minimal_file="${EXECUTION_CONTROL_RUNTIME_MINIMAL_COMPOSE_FILE:-${repo_root}/infra/local/docker-compose.execution-control-runtime.minimal.yml}"
compose_project_name="${EXECUTION_CONTROL_RUNTIME_COMPOSE_PROJECT_NAME:-campus-execution-control-runtime-local}"
compose_parallel_limit="${EXECUTION_CONTROL_RUNTIME_COMPOSE_PARALLEL_LIMIT:-1}"
runtime_flavor="${EXECUTION_CONTROL_RUNTIME_FLAVOR:-prodlike}"
api_host_port="${EXECUTION_CONTROL_HOST_PORT:-27051}"
data_plane_network="${CAMPUS_AGENT_DATA_PLANE_NETWORK:-campus-agent-data-plane}"
projection_script="${repo_root}/infra/local/scripts/project-local-runtime-env.mjs"

require_command() {
  local command_name="$1"
  local resolved

  resolved="$(command -v "${command_name}" || true)"
  if [[ -z "${resolved}" ]]; then
    echo "Missing required command: ${command_name}" >&2
    return 1
  fi

  printf '%s\n' "${resolved}"
}

ensure_data_plane_network() {
  local docker_bin
  docker_bin="$(require_command docker)"
  if ! "${docker_bin}" network inspect "${data_plane_network}" >/dev/null 2>&1; then
    "${docker_bin}" network create "${data_plane_network}" >/dev/null
  fi
}

load_runtime_env() {
  local env_key
  local env_value
  local node_bin

  node_bin="$(require_command node)"
  while IFS= read -r -d '' env_key && IFS= read -r -d '' env_value; do
    export "${env_key}=${env_value}"
  done < <(
    "${node_bin}" "${projection_script}" \
      --repo-root "${repo_root}" \
      --compose-project-name "${compose_project_name}" \
      --sync-app-api-dev-vars \
      --format env
  )

  if [[ -z "${QDRANT_TLS_DIR:-}" && -n "${QDRANT_TLS_CA_CERT_PATH:-}" ]]; then
    QDRANT_TLS_DIR="$(dirname "${QDRANT_TLS_CA_CERT_PATH}")"
    export QDRANT_TLS_DIR
  fi
}

execution_control_runtime_require_runtime_env() {
  if [[ -z "${QDRANT_URL:-}" ]]; then
    echo "QDRANT_URL is required for execution-control runtime." >&2
    return 1
  fi
  if [[ "${QDRANT_URL}" != http://* && "${QDRANT_URL}" != https://* ]]; then
    echo "QDRANT_URL must use http or https." >&2
    return 1
  fi
  if [[ -z "${QDRANT_QUERY_API_KEY:-}" ]]; then
    echo "QDRANT_QUERY_API_KEY is required for online Qdrant query access." >&2
    return 1
  fi
  if [[ "${QDRANT_URL}" == https://* ]]; then
    if [[ -z "${QDRANT_TLS_CA_CERT_PATH:-}" ]]; then
      echo "QDRANT_TLS_CA_CERT_PATH is required for HTTPS Qdrant data-plane." >&2
      return 1
    fi
    if [[ -z "${QDRANT_TLS_DIR:-}" ]]; then
      echo "QDRANT_TLS_DIR is required for mounting Qdrant TLS trust material." >&2
      return 1
    fi
  fi
  if [[ -z "${EXECUTION_CONTROL_RUNTIME_RELEASE:-}" ]]; then
    echo "EXECUTION_CONTROL_RUNTIME_RELEASE is required for runtime telemetry identity." >&2
    return 1
  fi
  if [[ -z "${EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET:-}" ]]; then
    echo "EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET or APP_API_INTERNAL_SHARED_SECRET is required for provider-config runtime access." >&2
    return 1
  fi
  if [[ -z "${HINDSIGHT_POSTGRES_PASSWORD:-}" ]]; then
    echo "HINDSIGHT_POSTGRES_PASSWORD is required for local Hindsight Postgres." >&2
    return 1
  fi
  if [[ -z "${PERSONAL_MEMORY_API_SECRET:-}" ]]; then
    echo "PERSONAL_MEMORY_API_SECRET is required for Hindsight API authentication." >&2
    return 1
  fi
  if [[ -z "${PERSONAL_MEMORY_OWNER_SALT:-}" ]]; then
    echo "PERSONAL_MEMORY_OWNER_SALT is required for Hindsight scoped bank ids." >&2
    return 1
  fi
  if [[ -z "${HINDSIGHT_API_LLM_API_KEY:-}" ]]; then
    echo "HINDSIGHT_API_LLM_API_KEY or LLM_API_KEY is required for Hindsight retain/recall." >&2
    return 1
  fi
  if [[ -z "${HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY:-}" ]]; then
    echo "HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY or EMBEDDING_API_KEY is required for Hindsight embeddings." >&2
    return 1
  fi
  if [[ -z "${EMBEDDING_API_KEY:-}" ]]; then
    echo "EMBEDDING_API_KEY is required for local real-provider RAG runtime." >&2
    return 1
  fi
  if [[ -z "${EMBEDDING_MODEL:-}" ]]; then
    echo "EMBEDDING_MODEL is required for local real-provider RAG runtime." >&2
    return 1
  fi
  if [[ -z "${EMBEDDING_DIMENSIONS:-}" ]]; then
    echo "EMBEDDING_DIMENSIONS is required for local real-provider RAG runtime." >&2
    return 1
  fi
}

compose_file_args() {
  local files
  local file

  if [[ -n "${EXECUTION_CONTROL_RUNTIME_COMPOSE_FILES:-}" ]]; then
    IFS=':' read -r -a files <<<"${EXECUTION_CONTROL_RUNTIME_COMPOSE_FILES}"
  elif [[ -n "${EXECUTION_CONTROL_RUNTIME_COMPOSE_FILE:-}" ]]; then
    files=("${compose_file}")
  elif [[ "${runtime_flavor}" == "minimal" ]]; then
    files=("${compose_file}" "${compose_minimal_file}")
  elif [[ "${runtime_flavor}" == "prodlike" ]]; then
    files=("${compose_file}" "${compose_local_file}" "${compose_langfuse_file}")
  else
    echo "EXECUTION_CONTROL_RUNTIME_FLAVOR must be prodlike or minimal." >&2
    return 1
  fi

  for file in "${files[@]}"; do
    printf '%s\0%s\0' "-f" "${file}"
  done
}

print_projected_env() {
  load_runtime_env
  execution_control_runtime_require_runtime_env
  "${node_bin:-$(require_command node)}" "${projection_script}" \
    --repo-root "${repo_root}" \
    --compose-project-name "${compose_project_name}" \
    --sync-app-api-dev-vars \
    --format env
}

main() {
  local docker_bin
  local compose_args=()
  local part

  docker_bin="$(require_command docker)"
  load_runtime_env
  if [[ "${1:-}" != "down" ]]; then
    execution_control_runtime_require_runtime_env
  fi
  ensure_data_plane_network

  if [[ "$#" -eq 0 ]]; then
    set -- up -d --build --remove-orphans
  fi

  while IFS= read -r -d '' part; do
    compose_args+=("${part}")
  done < <(compose_file_args)

  (
    cd "${repo_root}" || exit
    COMPOSE_PROJECT_NAME="${compose_project_name}" \
    COMPOSE_PARALLEL_LIMIT="${compose_parallel_limit}" \
    CAMPUS_AGENT_DATA_PLANE_NETWORK="${data_plane_network}" \
    EXECUTION_CONTROL_HOST_PORT="${api_host_port}" \
    API_AUTH_MODE="${API_AUTH_MODE:-trusted-worker}" \
    "${docker_bin}" compose "${compose_args[@]}" "$@"
  )
}

if [[ "${1:-}" == "__campus_agent_print_projected_env" ]]; then
  print_projected_env
else
  main "$@"
fi
