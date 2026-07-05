#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "$0")" && pwd)"
# shellcheck source=infra/local/staging/execution-control-staging-common.sh
source "${script_dir}/execution-control-staging-common.sh"

namespace="${EXECUTION_CONTROL_K8S_NAMESPACE:-campus-agent-staging}"
provider_projection_path="${CAMPUS_PROVIDER_CONFIG_SNAPSHOT_HOST_PATH:-}"
qdrant_tls_ca_path="${QDRANT_TLS_CA_CERT_PATH:-}"
boundary_path="${EXECUTION_RUNTIME_K8S_ENV_BOUNDARY_PATH:-configs/runtime/k8s-execution-runtime-env-boundary.v1.json}"
render_profile="${EXECUTION_RUNTIME_K8S_ENV_PROFILE:-nc-arm-6c-slim}"
temp_dir=""

cleanup() {
  if [[ -n "${temp_dir}" && -d "${temp_dir}" ]]; then
    rm -rf "${temp_dir}"
  fi
}
trap cleanup EXIT

execution_control_staging_load_env

if [[ "${boundary_path}" != /* ]]; then
  boundary_path="${execution_control_staging_repo_root}/${boundary_path}"
fi

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
  node - "${boundary_path}" "${render_profile}" <<'NODE'
const fs = require("node:fs");
const [boundaryPath, profileName] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(boundaryPath, "utf8"));
if (payload.schema_version !== "campus_k8s_execution_runtime_env_boundary.v1") {
  throw new Error("unsupported K8s env boundary schema_version");
}
const profile = payload.profiles?.[profileName];
if (!profile || typeof profile !== "object" || Array.isArray(profile)) {
  throw new Error(`unsupported K8s env render profile ${profileName}`);
}
const secretLike = /(SECRET|PASSWORD|API_KEY|ACCESS_KEY|PRIVATE_KEY|AUTH_HEADER|AUTH_VALUE|DATABASE_URL|BEARER_TOKEN|TOKEN|SALT)/;
const seen = new Map();
for (const [name, keys] of Object.entries(payload.configmaps ?? {})) {
  for (const key of keys) {
    if (secretLike.test(key)) {
      throw new Error(`${key} is secret-like and cannot be rendered into ConfigMap ${name}.`);
    }
    const previous = seen.get(key);
    if (previous) {
      throw new Error(`${key} appears in both ${previous} and ConfigMap ${name}.`);
    }
    seen.set(key, `ConfigMap ${name}`);
  }
}
for (const [name, keys] of Object.entries(payload.secrets ?? {})) {
  for (const key of keys) {
    const previous = seen.get(key);
    if (previous) {
      throw new Error(`${key} appears in both ${previous} and Secret ${name}.`);
    }
    seen.set(key, `Secret ${name}`);
  }
}
for (const section of ["configmaps", "secrets", "files"]) {
  const names = payload[section] ?? {};
  for (const name of profile[section] ?? []) {
    if (!Object.hasOwn(names, name)) {
      throw new Error(`profile ${profileName} references undefined ${section}.${name}`);
    }
  }
  const referenced = new Set(
    Object.values(payload.profiles ?? {})
      .flatMap((candidateProfile) => Array.isArray(candidateProfile?.[section]) ? candidateProfile[section] : [])
  );
  for (const name of Object.keys(names)) {
    if (!referenced.has(name)) {
      throw new Error(`${section}.${name} is not referenced by any profile`);
    }
  }
}
NODE
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

execution_runtime_k8s_profile_names() {
  local section="$1"
  node - "${boundary_path}" "${render_profile}" "${section}" <<'NODE'
const fs = require("node:fs");
const [boundaryPath, profileName, section] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(boundaryPath, "utf8"));
const names = payload.profiles?.[profileName]?.[section];
if (!Array.isArray(names)) {
  throw new Error(`profile ${profileName} does not define ${section}`);
}
for (const name of [...names].sort()) {
  console.log(name);
}
NODE
}

execution_runtime_k8s_boundary_keys() {
  local section="$1"
  local name="$2"
  node - "${boundary_path}" "${section}" "${name}" <<'NODE'
const fs = require("node:fs");
const [boundaryPath, section, name] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(boundaryPath, "utf8"));
const keys = payload[section]?.[name];
if (!Array.isArray(keys)) {
  throw new Error(`${section}.${name} is not defined in K8s env boundary`);
}
for (const key of keys) {
  console.log(key);
}
NODE
}

execution_runtime_k8s_create_env_resources() {
  local section="$1"
  local kind="$2"
  local name
  local output_file
  local -a keys=()
  local first=1
  while IFS= read -r name; do
    [[ -n "${name}" ]] || continue
    mapfile -t keys < <(execution_runtime_k8s_boundary_keys "${section}" "${name}")
    output_file="${temp_dir}/${name}.env"
    execution_runtime_k8s_write_env_file "${output_file}" "${keys[@]}"
    execution_runtime_k8s_require_env_keys "${name}" "${keys[@]}"
    if (( first != 1 )); then
      printf '%s\n' "---"
    fi
    first=0
    if [[ "${kind}" == "configmap" ]]; then
      kubectl -n "${namespace}" create configmap "${name}" \
        --from-env-file "${output_file}" \
        --dry-run=client -o yaml
    else
      kubectl -n "${namespace}" create secret generic "${name}" \
        --from-env-file "${output_file}" \
        --dry-run=client -o yaml
    fi
  done < <(execution_runtime_k8s_profile_names "${section}")
  [[ "${first}" == "0" ]]
}

execution_runtime_k8s_create_file_resources() {
  local name
  local first=1
  local -a keys=()
  while IFS= read -r name; do
    [[ -n "${name}" ]] || continue
    mapfile -t keys < <(execution_runtime_k8s_boundary_keys "files" "${name}")
    if (( ${#keys[@]} != 1 )); then
      printf '%s must define exactly one file key.\n' "${name}" >&2
      exit 1
    fi
    if (( first != 1 )); then
      printf '%s\n' "---"
    fi
    first=0
    case "${name}" in
      execution-runtime-provider-config-projection)
        kubectl -n "${namespace}" create secret generic "${name}" \
          --from-file "${keys[0]}=${provider_projection_path}" \
          --dry-run=client -o yaml
        ;;
      execution-runtime-qdrant-tls-ca)
        kubectl -n "${namespace}" create configmap "${name}" \
          --from-file "${keys[0]}=${qdrant_tls_ca_path}" \
          --dry-run=client -o yaml
        ;;
      *)
        printf 'unsupported K8s env file resource in profile %s: %s\n' \
          "${render_profile}" \
          "${name}" >&2
        exit 1
        ;;
    esac
  done < <(execution_runtime_k8s_profile_names "files")
  [[ "${first}" == "0" ]]
}

execution_runtime_k8s_require_env_keys() {
  local resource_name="$1"
  shift
  local missing=()
  local key
  for key in "$@"; do
    if [[ -z "${!key:-}" ]]; then
      missing+=("${key}")
    fi
  done
  if (( ${#missing[@]} > 0 )); then
    printf '%s requires missing env keys: %s\n' \
      "${resource_name}" \
      "${missing[*]}" >&2
    exit 1
  fi
}

execution_runtime_k8s_assert_open_tool_profile_support() {
  if [[ "${EXECUTION_CONTROL_STAGING_TOOL_READ_MODEL_RUNTIME_REQUIRED:-false}" != "true" ]]; then
    return 0
  fi

  node - "${boundary_path}" "${render_profile}" <<'NODE'
const fs = require("node:fs");
const [boundaryPath, profileName] = process.argv.slice(2);
const payload = JSON.parse(fs.readFileSync(boundaryPath, "utf8"));
const profile = payload.profiles?.[profileName];
if (!profile) {
  throw new Error(`unsupported K8s env render profile ${profileName}`);
}
const profileKeys = new Set();
for (const section of ["configmaps", "secrets"]) {
  for (const name of profile[section] ?? []) {
    for (const key of payload[section]?.[name] ?? []) {
      profileKeys.add(key);
    }
  }
}
const missing = [];
if (!profileKeys.has("CAMPUS_SHARED_POSTGRES_URL")) {
  missing.push("CAMPUS_SHARED_POSTGRES_URL");
}
if (missing.length > 0) {
  throw new Error(
    `K8s env profile ${profileName} cannot render typed tool read-model runtime; missing profile-owned delivery keys: ${missing.join(", ")}. Keep typed read-model tools closed or add a role-scoped tool read-model resource.`,
  );
}
NODE
}

execution_runtime_k8s_project_postgres_url "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL" "campus-agent-postgres"
execution_runtime_k8s_project_postgres_url "CAMPUS_SHARED_POSTGRES_URL" "campus-agent-postgres"
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

execution_runtime_k8s_assert_env_contract
execution_runtime_k8s_assert_open_tool_profile_support

execution_runtime_k8s_create_env_resources "configmaps" "configmap"
printf '%s\n' "---"
execution_runtime_k8s_create_env_resources "secrets" "secret"
printf '%s\n' "---"
execution_runtime_k8s_create_file_resources
