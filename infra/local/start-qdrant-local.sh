#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
compose_file="${QDRANT_LOCAL_COMPOSE_FILE:-${repo_root}/infra/local/docker-compose.qdrant-local.yml}"
compose_project_name="${QDRANT_LOCAL_COMPOSE_PROJECT_NAME:-campus-agent-qdrant-local}"
data_plane_network="${CAMPUS_AGENT_DATA_PLANE_NETWORK:-campus-agent-data-plane}"
projection_script="${repo_root}/infra/local/scripts/project-local-runtime-env.mjs"

require_command() {
  local command_name="$1"
  command -v "${command_name}" >/dev/null 2>&1 || {
    echo "Missing required command: ${command_name}" >&2
    return 1
  }
}

load_runtime_env() {
  local env_key
  local env_value

  require_command node
  while IFS= read -r -d '' env_key && IFS= read -r -d '' env_value; do
    export "${env_key}=${env_value}"
  done < <(
    node "${projection_script}" \
      --repo-root "${repo_root}" \
      --compose-project-name "${compose_project_name}" \
      --sync-app-api-dev-vars \
      --format env
  )
}

ensure_data_plane_network() {
  require_command docker
  if ! docker network inspect "${data_plane_network}" >/dev/null 2>&1; then
    docker network create "${data_plane_network}" >/dev/null
  fi
}

main() {
  require_command docker
  load_runtime_env
  ensure_data_plane_network

  if [[ "$#" -eq 0 ]]; then
    set -- up -d --remove-orphans
  fi

  (
    cd "${repo_root}" || exit
    COMPOSE_PROJECT_NAME="${compose_project_name}" \
    CAMPUS_AGENT_DATA_PLANE_NETWORK="${data_plane_network}" \
    docker compose -f "${compose_file}" "$@"
  )
}

main "$@"
