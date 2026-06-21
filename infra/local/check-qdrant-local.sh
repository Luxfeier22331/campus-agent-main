#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/../.." && pwd)"
projection_script="${repo_root}/infra/local/scripts/project-local-runtime-env.mjs"
qdrant_url="${QDRANT_LOCAL_CHECK_URL:-http://127.0.0.1:6333}"

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
      --compose-project-name "campus-agent-qdrant-local" \
      --sync-app-api-dev-vars \
      --skip-hindsight-provider-config \
      --format env
  )
}

main() {
  require_command curl
  load_runtime_env

  if [[ -z "${QDRANT_QUERY_API_KEY:-}" ]]; then
    echo "QDRANT_QUERY_API_KEY is required; run infra/local/start-qdrant-local.sh first." >&2
    return 1
  fi

  local collections_json
  curl -fsS -H "api-key: ${QDRANT_QUERY_API_KEY}" "${qdrant_url%/}/readyz" >/dev/null
  collections_json="$(curl -fsS -H "api-key: ${QDRANT_QUERY_API_KEY}" "${qdrant_url%/}/collections")"
  COLLECTIONS_JSON="${collections_json}" node - <<'NODE'
const payload = JSON.parse(process.env.COLLECTIONS_JSON || "{}");
const collections = payload?.result?.collections;
if (!Array.isArray(collections) || collections.length === 0) {
  console.error("local Qdrant is reachable but has no collections; restore snapshots or run indexing before activating rag_query_embedding.");
  process.exit(1);
}
NODE
  echo "local Qdrant is reachable at ${qdrant_url}"
}

main "$@"
