#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=infra/local/staging/execution-control-staging-common.sh
source "${script_dir}/execution-control-staging-common.sh"

namespace="${EXECUTION_CONTROL_K8S_NAMESPACE:-campus-agent-staging}"
provider_projection_path="${CAMPUS_PROVIDER_CONFIG_SNAPSHOT_HOST_PATH:-}"
qdrant_tls_ca_path="${QDRANT_TLS_CA_CERT_PATH:-}"
temp_dir=""

execution_runtime_config_keys=(
  DEPLOYMENT_ENVIRONMENT
  EXECUTION_CONTROL_RUNTIME_PROFILE
  EXECUTION_CONTROL_RUNTIME_RELEASE
  EXECUTION_CONTROL_RUNTIME_CONFIG_PATH
  EXECUTION_CONTROL_RUN_PROJECTION_AUTO_MIGRATE
  EXECUTION_CONTROL_TEMPORAL_ADDRESS
  EXECUTION_CONTROL_TEMPORAL_NAMESPACE
  EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE
  EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS
  EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL
  EXECUTION_CONTROL_AGENT_RUNTIME_TIMEOUT_MS
  EXECUTION_CONTROL_APP_API_BASE_URL
  EXECUTION_CONTROL_APP_API_INTERNAL_BASE_URL
  EXECUTION_CONTROL_APP_API_INTERNAL_TIMEOUT_MS
  EXECUTION_CONTROL_EXECUTION_AUDIT_URL
  EXECUTION_CONTROL_PROVIDER_CONFIG_SNAPSHOT_PATH
  EXECUTION_CONTROL_TOOL_READ_MODEL_TRUSTED_TIME_RFC3339
  INTERNAL_NOTICE_READ_MODEL_TABLE
  EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ENDPOINT
  EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_REGION
  EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_BUCKET
  EXECUTION_CONTROL_NOTICE_BODY_LIMIT_BYTES
  PERSONAL_MEMORY_BASE_URL
  QDRANT_URL
  QDRANT_TLS_CA_CERT_PATH
  QDRANT_TIMEOUT_SECONDS
  AGENT_RUNTIME_HOST
  AGENT_RUNTIME_PORT
  AGENT_RUNTIME_TOOL_CATALOG_PATH
  AGENT_RUNTIME_TOOL_REGISTRY_PATH
  AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL
  EMBEDDING_PROVIDER
  EMBEDDING_BASE_URL
  EMBEDDING_MODEL
  EMBEDDING_DIMENSIONS
  HINDSIGHT_API_HOST
  HINDSIGHT_API_PORT
  HINDSIGHT_API_LLM_PROVIDER
  HINDSIGHT_API_LLM_BASE_URL
  HINDSIGHT_API_LLM_MODEL
  HINDSIGHT_API_EMBEDDINGS_PROVIDER
  HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL
  HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL
  HINDSIGHT_API_RERANKER_PROVIDER
  OTEL_COLLECTOR_OTLP_GRPC_ENDPOINT
  OTEL_COLLECTOR_OTLP_HTTP_ENDPOINT
  OTEL_COLLECTOR_HEALTH_CHECK_ENDPOINT
  OTEL_COLLECTOR_MEMORY_LIMIT_MIB
  OTEL_COLLECTOR_MEMORY_SPIKE_LIMIT_MIB
  OTEL_COLLECTOR_TRACE_SAMPLING_PERCENTAGE
  OTEL_COLLECTOR_LOG_SAMPLING_PERCENTAGE
  OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT
  OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT
  OTEL_COLLECTOR_AXIOM_EVENTS_DATASET
  OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT
  OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION
)

execution_runtime_secret_keys=(
  API_BEARER_TOKEN
  API_WORKER_SHARED_SECRET
  EXECUTION_CONTROL_SHARED_SECRET
  EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET
  EXECUTION_CONTROL_METRICS_BEARER_TOKEN
  EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET
  EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET
  EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET
  EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT
  EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL
  EXECUTION_CONTROL_WORKFLOW_RUN_DATABASE_URL
  CAMPUS_SHARED_POSTGRES_URL
  INTERNAL_NOTICE_READ_MODEL_DATABASE_URL
  HINDSIGHT_API_DATABASE_URL
  AGENT_RUNTIME_SHARED_SECRET
  AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET
  PERSONAL_MEMORY_API_SECRET
  PERSONAL_MEMORY_OWNER_SALT
  TEMPORAL_POSTGRES_PASSWORD
  HINDSIGHT_POSTGRES_PASSWORD
  HINDSIGHT_API_TENANT_API_KEY
  HINDSIGHT_API_LLM_API_KEY
  HINDSIGHT_API_LLM_DEFAULT_HEADERS
  HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY
  QDRANT_API_KEY
  QDRANT_READ_ONLY_API_KEY
  QDRANT_QUERY_API_KEY
  EMBEDDING_API_KEY
  EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ACCESS_KEY
  EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_SECRET_KEY
  APP_API_OTEL_INGEST_SHARED_SECRET
  EXECUTION_CONTROL_OTEL_EXPORTER_OTLP_HEADERS
  OTEL_COLLECTOR_SENTRY_AUTH_VALUE
  OTEL_COLLECTOR_AXIOM_AUTH_HEADER
  OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER
)

cleanup() {
  if [[ -n "${temp_dir}" && -d "${temp_dir}" ]]; then
    rm -rf "${temp_dir}"
  fi
}
trap cleanup EXIT

execution_control_staging_load_env

execution_runtime_k8s_project_postgres_url() {
  local env_key="$1"
  local service_name="$2"
  local value="${!env_key:-}"

  if [[ -z "${value}" ]]; then
    return 0
  fi

  export "${env_key}=$(
    node - "${env_key}" "${value}" "${service_name}" <<'NODE'
const [envKey, rawValue, serviceName] = process.argv.slice(2);
let parsed;
try {
  parsed = new URL(rawValue);
} catch (error) {
  throw new Error(`${envKey} must be a valid Postgres URL for K8s env rendering: ${error.message}`);
}
if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
  throw new Error(`${envKey} must be a Postgres URL for K8s env rendering`);
}
if (["127.0.0.1", "localhost"].includes(parsed.hostname)) {
  parsed.hostname = serviceName;
  parsed.port = "5432";
  parsed.searchParams.delete("gssencmode");
}
if (parsed.hostname === serviceName) {
  parsed.searchParams.delete("gssencmode");
}
process.stdout.write(parsed.toString());
NODE
  )"
}

execution_runtime_k8s_assert_env_contract() {
  local key
  local -A seen=()
  for key in "${execution_runtime_config_keys[@]}"; do
    if [[ "${key}" =~ (SECRET|PASSWORD|API_KEY|AUTH_HEADER|AUTH_VALUE|DATABASE_URL|BEARER_TOKEN) ]]; then
      echo "${key} is secret-like and cannot be rendered into execution-runtime-rendered-config." >&2
      exit 1
    fi
    seen["${key}"]="config"
  done
  for key in "${execution_runtime_secret_keys[@]}"; do
    if [[ "${seen[${key}]:-}" == "config" ]]; then
      echo "${key} is listed in both rendered ConfigMap and Secret key sets." >&2
      exit 1
    fi
  done
}

execution_runtime_k8s_write_env_file() {
  local output_path="$1"
  shift
  local key
  local value
  : >"${output_path}"
  for key in "$@"; do
    value="${!key:-}"
    if [[ -n "${value}" ]]; then
      printf '%s=%s\n' "${key}" "${value}"
    fi
  done | sort >"${output_path}"
}

execution_runtime_k8s_project_postgres_url "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL" "campus-agent-postgres"
execution_runtime_k8s_project_postgres_url "EXECUTION_CONTROL_WORKFLOW_RUN_DATABASE_URL" "campus-agent-postgres"
execution_runtime_k8s_project_postgres_url "CAMPUS_SHARED_POSTGRES_URL" "campus-agent-postgres"
execution_runtime_k8s_project_postgres_url "INTERNAL_NOTICE_READ_MODEL_DATABASE_URL" "campus-agent-postgres"
execution_runtime_k8s_project_postgres_url "HINDSIGHT_API_DATABASE_URL" "hindsight-postgres"

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
resolved_config_file="${temp_dir}/execution-runtime-rendered-config.env"
resolved_secret_file="${temp_dir}/execution-runtime-secrets.env"

execution_runtime_k8s_assert_env_contract
execution_runtime_k8s_write_env_file "${resolved_config_file}" "${execution_runtime_config_keys[@]}"
execution_runtime_k8s_write_env_file "${resolved_secret_file}" "${execution_runtime_secret_keys[@]}"

kubectl -n "${namespace}" create configmap execution-runtime-rendered-config \
  --from-env-file "${resolved_config_file}" \
  --dry-run=client -o yaml
printf '%s\n' "---"
kubectl -n "${namespace}" create secret generic execution-runtime-secrets \
  --from-env-file "${resolved_secret_file}" \
  --dry-run=client -o yaml
printf '%s\n' "---"
kubectl -n "${namespace}" create secret generic execution-runtime-provider-config-projection \
  --from-file "provider-config-projection.json=${provider_projection_path}" \
  --dry-run=client -o yaml
printf '%s\n' "---"
kubectl -n "${namespace}" create secret generic execution-runtime-qdrant-tls-ca \
  --from-file "ca.crt=${qdrant_tls_ca_path}" \
  --dry-run=client -o yaml
