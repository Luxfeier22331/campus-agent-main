#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=infra/local/staging/execution-control-staging-common.sh
source "${script_dir}/execution-control-staging-common.sh"

namespace="${EXECUTION_CONTROL_K8S_NAMESPACE:-campus-agent-staging}"
provider_projection_path="${CAMPUS_PROVIDER_CONFIG_SNAPSHOT_HOST_PATH:-}"
qdrant_tls_ca_path="${QDRANT_TLS_CA_CERT_PATH:-}"
temp_dir=""

cleanup() {
  if [[ -n "${temp_dir}" && -d "${temp_dir}" ]]; then
    rm -rf "${temp_dir}"
  fi
}
trap cleanup EXIT

execution_control_staging_load_env

execution_runtime_k8s_project_postgres_url() {
  local env_key="$1"
  local value="${!env_key:-}"

  if [[ -z "${value}" ]]; then
    return 0
  fi

  export "${env_key}=$(
    node - "${env_key}" "${value}" <<'NODE'
const [envKey, rawValue] = process.argv.slice(2);
let parsed;
try {
  parsed = new URL(rawValue);
} catch (error) {
  throw new Error(`${envKey} must be a valid Postgres URL for K8s secret rendering: ${error.message}`);
}
if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
  throw new Error(`${envKey} must be a Postgres URL for K8s secret rendering`);
}
if (["127.0.0.1", "localhost"].includes(parsed.hostname)) {
  parsed.hostname = "campus-agent-postgres";
  parsed.port = "5432";
  parsed.searchParams.delete("gssencmode");
}
if (parsed.hostname === "campus-agent-postgres") {
  parsed.searchParams.delete("gssencmode");
}
process.stdout.write(parsed.toString());
NODE
  )"
}

execution_runtime_k8s_project_postgres_url "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL"
execution_runtime_k8s_project_postgres_url "CAMPUS_SHARED_POSTGRES_URL"
execution_runtime_k8s_project_postgres_url "INTERNAL_NOTICE_READ_MODEL_DATABASE_URL"

provider_projection_path="${CAMPUS_PROVIDER_CONFIG_SNAPSHOT_HOST_PATH:-${provider_projection_path}}"
qdrant_tls_ca_path="${QDRANT_TLS_CA_CERT_PATH:-${qdrant_tls_ca_path}}"

if [[ -z "${provider_projection_path}" || ! -f "${provider_projection_path}" ]]; then
  echo "CAMPUS_PROVIDER_CONFIG_SNAPSHOT_HOST_PATH must point to the provider projection artifact." >&2
  exit 1
fi
if [[ -z "${qdrant_tls_ca_path}" || ! -f "${qdrant_tls_ca_path}" ]]; then
  echo "QDRANT_TLS_CA_CERT_PATH must point to the Qdrant CA certificate." >&2
  exit 1
fi

temp_dir="$(mktemp -d)"
resolved_env_file="${temp_dir}/execution-runtime.env"

env | awk -F= '
  $1 ~ /^(DEPLOYMENT_ENVIRONMENT|AGENT_RUNTIME_|EXECUTION_CONTROL_|API_|QDRANT_|EMBEDDING_|PERSONAL_MEMORY_|CAMPUS_SHARED_POSTGRES_URL|INTERNAL_NOTICE_READ_MODEL_|OTEL_COLLECTOR_|APP_API_OTEL_|HINDSIGHT_)/ {
    print
  }
' | sort >"${resolved_env_file}"

kubectl -n "${namespace}" create secret generic execution-runtime-secrets \
  --from-env-file "${resolved_env_file}" \
  --dry-run=client -o yaml
printf '%s\n' "---"
kubectl -n "${namespace}" create secret generic execution-runtime-provider-config-projection \
  --from-file "provider-config-projection.json=${provider_projection_path}" \
  --dry-run=client -o yaml
printf '%s\n' "---"
kubectl -n "${namespace}" create secret generic execution-runtime-qdrant-tls-ca \
  --from-file "ca.crt=${qdrant_tls_ca_path}" \
  --dry-run=client -o yaml
