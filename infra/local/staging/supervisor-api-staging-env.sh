#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2154

supervisor_api_staging_load_env() {
  local node_bin
  local repo_env_path="${supervisor_api_staging_repo_root}/.env"
  local repo_staging_env_path="${supervisor_api_staging_repo_root}/.env.staging.local"
  local app_api_dev_vars="${supervisor_api_staging_repo_root}/apps/app-api/.dev.vars"
  local export_script

  node_bin="$(supervisor_api_staging_require_command node)"
  export_script="$(
    "${node_bin}" - "${repo_env_path}" "${repo_staging_env_path}" "${app_api_dev_vars}" <<'NODE'
const [repoEnvPath, repoStagingEnvPath, appApiDevVarsPath] = process.argv.slice(2);
const loadedPaths = [];
const fs = require("node:fs");
const { parseEnv } = require("node:util");
if (typeof parseEnv !== "function") {
  throw new Error("node:util.parseEnv is required for staging env projection");
}
const fileEnv = new Map();

for (const filePath of [repoEnvPath, repoStagingEnvPath, appApiDevVarsPath]) {
  if (!filePath) {
    continue;
  }
  try {
    const parsed = parseEnv(fs.readFileSync(filePath, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      fileEnv.set(key, value);
    }
    loadedPaths.push(filePath);
  } catch (error) {
    if (!(error instanceof Error && "code" in error) || error.code !== "ENOENT") {
      throw error;
    }
  }
}

function sourceEnvValue(key) {
  const processValue = process.env[key]?.trim() || "";
  if (processValue) {
    return processValue;
  }
  return fileEnv.get(key)?.trim() || "";
}

const keys = [
  "CAMPUS_AGENT_APP_NAME",
  "AGENT_RUNTIME_PROVIDER",
  "PROMPT_RUNTIME_PROVIDER",
  "PROMPT_RUNTIME_TRANSPORT",
  "PROMPT_RUNTIME_MODEL",
  "SUPERVISOR_PROMPT_MODEL",
  "AGENT_PROMPT_MODEL",
  "PROMPT_RUNTIME_API_KEY",
  "PROMPT_RUNTIME_BASE_URL",
  "PROMPT_RUNTIME_REASONING_EFFORT",
  "PROMPT_RUNTIME_MAX_OUTPUT_TOKENS",
  "PROMPT_RUNTIME_CONNECT_TIMEOUT_SECONDS",
  "PROMPT_RUNTIME_READ_TIMEOUT_SECONDS",
  "PROMPT_RUNTIME_WRITE_TIMEOUT_SECONDS",
  "PROMPT_RUNTIME_POOL_TIMEOUT_SECONDS",
  "PROMPT_RUNTIME_MAX_CONNECTIONS",
  "PROMPT_RUNTIME_MAX_KEEPALIVE_CONNECTIONS",
  "PROMPT_RUNTIME_KEEPALIVE_EXPIRY_SECONDS",
  "PROMPT_STRICT_STRUCTURED_OUTPUTS",
  "LLM_API_KEY",
  "LLM_BASE_URL",
  "AUDIT_LOG_PATH",
  "AUDIT_QUEUE_CAPACITY",
  "APP_API_INTERNAL_SHARED_SECRET",
  "SUPERVISOR_API_MAX_CONCURRENT_ANSWERS",
  "SUPERVISOR_API_RUNTIME_PROFILE",
  "SUPERVISOR_API_QUEUE_CAPACITY",
  "SUPERVISOR_API_QUEUE_TIMEOUT_MS",
  "SUPERVISOR_API_REQUEST_TIMEOUT_MS",
  "SUPERVISOR_API_SHUTDOWN_GRACE_MS",
  "SUPERVISOR_API_METRICS_BEARER_TOKEN",
  "SUPERVISOR_API_OTEL_ENABLED",
  "SUPERVISOR_API_OTEL_METRICS_ENABLED",
  "SUPERVISOR_API_OTEL_EXPORTER_OTLP_HEADERS",
  "SUPERVISOR_API_OTEL_SERVICE_NAME",
  "SUPERVISOR_API_OTEL_EXPORT_TIMEOUT_MS",
  "SUPERVISOR_API_OTEL_EXPORT_INTERVAL_MS",
  "SUPERVISOR_AGENT_WORKER_OTEL_ENABLED",
  "SUPERVISOR_AGENT_WORKER_OTEL_SERVICE_NAME",
  "SUPERVISOR_AGENT_WORKER_OTEL_ALLOWED_ATTRIBUTES_VERSION",
  "SUPERVISOR_AGENT_WORKER_OTEL_EXPORT_TIMEOUT_SECONDS",
  "SUPERVISOR_AGENT_WORKER_OTEL_EXPORT_INTERVAL_SECONDS",
  "SUPERVISOR_AGENT_WORKER_OTEL_EXPORTER_OTLP_HEADERS",
  "OTEL_COLLECTOR_OTLP_GRPC_ENDPOINT",
  "OTEL_COLLECTOR_OTLP_HTTP_ENDPOINT",
  "OTEL_COLLECTOR_HEALTH_CHECK_ENDPOINT",
  "OTEL_COLLECTOR_MEMORY_LIMIT_MIB",
  "OTEL_COLLECTOR_MEMORY_SPIKE_LIMIT_MIB",
  "OTEL_COLLECTOR_TRACE_SAMPLING_PERCENTAGE",
  "OTEL_COLLECTOR_LOG_SAMPLING_PERCENTAGE",
  "OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT",
  "OTEL_COLLECTOR_SENTRY_AUTH_VALUE",
  "AXIOM_ENDPOINT",
  "OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT",
  "OTEL_COLLECTOR_AXIOM_AUTH_HEADER",
  "OTEL_COLLECTOR_AXIOM_EVENTS_DATASET",
  "SUPERVISOR_API_EXECUTION_AUDIT_ENABLED",
  "SUPERVISOR_API_EXECUTION_AUDIT_URL",
  "SUPERVISOR_API_EXECUTION_AUDIT_SHARED_SECRET",
  "SUPERVISOR_API_EXECUTION_AUDIT_TIMEOUT_MS",
  "SUPERVISOR_AGENT_WORKER_THREADS",
  "SUPERVISOR_AGENT_WORKER_BASE_URL",
  "SUPERVISOR_API_SHARED_SECRET",
  "SUPERVISOR_AGENT_WORKER_TIMEOUT_MS",
  "SUPERVISOR_API_BRIDGE_BREAKER_FAILURE_THRESHOLD",
  "SUPERVISOR_API_BRIDGE_BREAKER_OPEN_MS",
  "SUPERVISOR_API_BRIDGE_RETRY_MAX_ATTEMPTS",
  "SUPERVISOR_API_BRIDGE_RETRY_BASE_MS",
  "SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET",
  "SUPERVISOR_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339",
  "SUPERVISOR_STRUCTURED_QUERY_TIMEOUT_MS",
  "SUPERVISOR_STRUCTURED_QUERY_TIMEOUT_SECONDS",
  "INTERNAL_NOTICE_READ_MODEL_DATABASE_URL",
  "INTERNAL_NOTICE_READ_MODEL_TABLE",
  "SUPERVISOR_API_STAGING_UV_BIN",
  "SUPERVISOR_API_STAGING_TUNNEL_TOKEN",
];

function projectLoopbackUrlHost(value, dockerHost, dockerPort) {
  if (!value) {
    return value;
  }
  try {
    const parsed = new URL(value);
    if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") {
      parsed.hostname = dockerHost;
      if (dockerPort) {
        parsed.port = dockerPort;
      }
      return parsed.toString().replace(/\/$/, "");
    }
  } catch {
    return value;
  }
  return value;
}

function projectQdrantForDocker(value) {
  return projectLoopbackUrlHost(value, "qdrant", "6333");
}

function projectPostgresForDocker(value) {
  return projectLoopbackUrlHost(value, "postgres", "5432");
}

function projectObjectStoreForDocker(value) {
  return projectLoopbackUrlHost(value, "minio", "9000");
}

const resolved = new Map();
for (const key of keys) {
  const value = sourceEnvValue(key);
  if (value) {
    resolved.set(key, value);
  }
}

const bridgeSharedSecret =
  sourceEnvValue("SUPERVISOR_AGENT_WORKER_STAGING_SHARED_SECRET") ||
  sourceEnvValue("SUPERVISOR_AGENT_WORKER_SHARED_SECRET") ||
  "";
const bridgeBaseUrl =
  sourceEnvValue("SUPERVISOR_AGENT_WORKER_BASE_URL") || "http://supervisor-agent-worker:27052";
resolved.set("SUPERVISOR_AGENT_WORKER_SHARED_SECRET", bridgeSharedSecret);
resolved.set("SUPERVISOR_AGENT_WORKER_BASE_URL", bridgeBaseUrl);
const workerSharedSecret =
  sourceEnvValue("API_WORKER_SHARED_SECRET") ||
  sourceEnvValue("SUPERVISOR_API_SHARED_SECRET") ||
  "";
resolved.set("API_WORKER_SHARED_SECRET", workerSharedSecret);

const stagingRequiredMappings = [
  ["STAGING_INGESTION_SHARED_POSTGRES_URL", "CAMPUS_SHARED_POSTGRES_URL"],
  ["STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL", "DOCUMENT_REGISTRY_DATABASE_URL"],
  ["STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL", "RAW_ASSET_REGISTRY_DATABASE_URL"],
  ["STAGING_INGESTION_OBJECT_STORE_ENDPOINT", "OBJECT_STORE_ENDPOINT"],
  ["STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED", "OBJECT_STORE_BUCKET_DERIVED"],
  ["STAGING_INGESTION_QDRANT_URL", "QDRANT_URL"],
  ["STAGING_INGESTION_EMBEDDING_PROVIDER", "EMBEDDING_PROVIDER"],
  ["STAGING_INGESTION_EMBEDDING_BASE_URL", "EMBEDDING_BASE_URL"],
  ["STAGING_INGESTION_EMBEDDING_API_KEY", "EMBEDDING_API_KEY"],
  ["STAGING_INGESTION_EMBEDDING_MODEL", "EMBEDDING_MODEL"],
  ["STAGING_INGESTION_EMBEDDING_DIMENSIONS", "EMBEDDING_DIMENSIONS"],
  ["STAGING_INGESTION_SPARSE_PROVIDER", "SPARSE_PROVIDER"],
  ["STAGING_INGESTION_SPARSE_MODEL", "SPARSE_MODEL"],
  ["STAGING_INGESTION_SPARSE_TOKENIZER", "SPARSE_TOKENIZER"],
  ["STAGING_INGESTION_SPARSE_LANGUAGE", "SPARSE_LANGUAGE"],
];
const stagingOptionalMappings = [
  ["STAGING_INGESTION_SHARED_POSTGRES_OPERATOR_URL", "CAMPUS_SHARED_POSTGRES_OPERATOR_URL"],
  [
    "STAGING_INGESTION_DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL",
    "DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL",
  ],
  [
    "STAGING_INGESTION_RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL",
    "RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL",
  ],
  ["STAGING_INGESTION_OBJECT_STORE_ACCESS_KEY", "OBJECT_STORE_ACCESS_KEY"],
  ["STAGING_INGESTION_OBJECT_STORE_SECRET_KEY", "OBJECT_STORE_SECRET_KEY"],
  ["STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY", "OBJECT_STORE_DERIVED_ACCESS_KEY"],
  ["STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY", "OBJECT_STORE_DERIVED_SECRET_KEY"],
  ["STAGING_INGESTION_OBJECT_STORE_REGION", "OBJECT_STORE_REGION"],
  ["STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED", "OBJECT_STORE_BUCKET_DERIVED"],
  ["STAGING_INGESTION_QDRANT_API_KEY", "QDRANT_API_KEY"],
  ["STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY", "QDRANT_READ_ONLY_API_KEY"],
  ["STAGING_INGESTION_QDRANT_TIMEOUT_SECONDS", "QDRANT_TIMEOUT_SECONDS"],
];

function envValue(key) {
  return sourceEnvValue(key);
}

function isLocalEndpoint(value) {
  if (!value) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return ["127.0.0.1", "localhost"].includes(parsed.hostname);
  } catch {
    return false;
  }
}

function isLocalPostgresEndpoint(value) {
  if (!value) {
    return false;
  }
  try {
    const parsed = new URL(value);
    return (
      ["postgres:", "postgresql:"].includes(parsed.protocol) &&
      ["127.0.0.1", "localhost"].includes(parsed.hostname)
    );
  } catch {
    return false;
  }
}

function parseLocalPostgresConfig(source, value) {
  if (!isLocalPostgresEndpoint(value)) {
    return null;
  }
  const parsed = new URL(value);
  return {
    source,
    database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
    username: decodeURIComponent(parsed.username || ""),
    password: decodeURIComponent(parsed.password || ""),
    port: parsed.port || "5432",
  };
}

function localPostgresConfigSignature(config) {
  return JSON.stringify({
    database: config.database,
    username: config.username,
    password: config.password,
    port: config.port,
  });
}

function acceptsSameHostStagingEndpoint(source) {
  return [
    "STAGING_INGESTION_SHARED_POSTGRES_URL",
    "STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL",
    "STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL",
    "STAGING_INGESTION_SHARED_POSTGRES_OPERATOR_URL",
    "STAGING_INGESTION_DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL",
    "STAGING_INGESTION_RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL",
    "STAGING_INGESTION_OBJECT_STORE_ENDPOINT",
    "STAGING_INGESTION_QDRANT_URL",
  ].includes(source);
}

function projectDataPlaneValue(source, value) {
  if (
    source === "STAGING_INGESTION_SHARED_POSTGRES_URL" ||
    source === "STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL" ||
    source === "STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL" ||
    source === "STAGING_INGESTION_SHARED_POSTGRES_OPERATOR_URL" ||
    source === "STAGING_INGESTION_DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL" ||
    source === "STAGING_INGESTION_RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL"
  ) {
    return projectPostgresForDocker(value);
  }
  if (source === "STAGING_INGESTION_OBJECT_STORE_ENDPOINT") {
    return projectObjectStoreForDocker(value);
  }
  if (source === "STAGING_INGESTION_QDRANT_URL") {
    return projectQdrantForDocker(value);
  }
  return value;
}

function validateStagingPostgresRuntimeUrl(errors, source, value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    errors.push(`${source} must be a valid postgres URL`);
    return;
  }
  if (!["postgres:", "postgresql:"].includes(parsed.protocol)) {
    errors.push(`${source} must be a postgres URL`);
    return;
  }
  const hostname = parsed.hostname.toLowerCase();
  const isSupabaseSessionPooler = hostname.endsWith(".pooler.supabase.com");
  const isSupabaseDirectHost = hostname.endsWith(".supabase.co") && hostname.startsWith("db.");
  if (isSupabaseSessionPooler) {
    if (parsed.port && parsed.port !== "5432") {
      errors.push(`${source} must use the Supabase session pooler on port 5432`);
      return;
    }
    if (parsed.searchParams.get("sslmode") !== "require") {
      errors.push(`${source} must include sslmode=require for Supabase session pooler`);
    }
    return;
  }
  if (isSupabaseDirectHost) {
    errors.push(`${source} must use the Supabase session pooler, not direct connection`);
  }
}

function hasPair(accessKeyName, secretKeyName) {
  return Boolean(envValue(accessKeyName) && envValue(secretKeyName));
}

function requireCompletePair(errors, accessKeyName, secretKeyName) {
  const hasAccessKey = Boolean(envValue(accessKeyName));
  const hasSecretKey = Boolean(envValue(secretKeyName));
  if (hasAccessKey === hasSecretKey) {
    return;
  }
  errors.push(`${accessKeyName} and ${secretKeyName} must be configured together`);
}

const dataPlaneErrors = [];
for (const [source, target] of stagingRequiredMappings) {
  const value = envValue(source);
  if (!value) {
    dataPlaneErrors.push(`${source} is required for supervisor-api staging data plane`);
    continue;
  }
  if (isLocalEndpoint(value) && !acceptsSameHostStagingEndpoint(source)) {
    dataPlaneErrors.push(`${source} must not point at localhost for supervisor-api staging`);
    continue;
  }
  if (
    source === "STAGING_INGESTION_SHARED_POSTGRES_URL" ||
    source === "STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL" ||
    source === "STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL"
  ) {
    validateStagingPostgresRuntimeUrl(dataPlaneErrors, source, value);
  }
  resolved.set(target, value);
  const dockerValue = projectDataPlaneValue(source, value);
  if (source === "STAGING_INGESTION_SHARED_POSTGRES_URL") {
    resolved.set("CAMPUS_SHARED_POSTGRES_DOCKER_URL", dockerValue);
  }
  if (source === "STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL") {
    resolved.set("DOCUMENT_REGISTRY_DOCKER_DATABASE_URL", dockerValue);
  }
  if (source === "STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL") {
    resolved.set("RAW_ASSET_REGISTRY_DOCKER_DATABASE_URL", dockerValue);
  }
  if (source === "STAGING_INGESTION_OBJECT_STORE_ENDPOINT") {
    resolved.set("OBJECT_STORE_DOCKER_ENDPOINT", dockerValue);
  }
  if (source === "STAGING_INGESTION_QDRANT_URL") {
    resolved.set("QDRANT_DOCKER_URL", dockerValue);
  }
}
for (const [source, target] of stagingOptionalMappings) {
  const value = envValue(source);
  if (value) {
    if (
      [
        "STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL",
        "STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL",
        "STAGING_INGESTION_OBJECT_STORE_ENDPOINT",
      ].includes(source) &&
      isLocalEndpoint(value)
    ) {
      dataPlaneErrors.push(`${source} must not point at localhost for supervisor-api staging`);
      continue;
    }
    if (
      [
        "STAGING_INGESTION_SHARED_POSTGRES_OPERATOR_URL",
        "STAGING_INGESTION_DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL",
        "STAGING_INGESTION_RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL",
      ].includes(source)
    ) {
      validateStagingPostgresRuntimeUrl(dataPlaneErrors, source, value);
    }
    resolved.set(target, value);
    const dockerValue = projectDataPlaneValue(source, value);
    if (source === "STAGING_INGESTION_SHARED_POSTGRES_OPERATOR_URL") {
      resolved.set("CAMPUS_SHARED_POSTGRES_OPERATOR_DOCKER_URL", dockerValue);
    }
    if (source === "STAGING_INGESTION_DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL") {
      resolved.set("DOCUMENT_REGISTRY_OPERATOR_DOCKER_DATABASE_URL", dockerValue);
    }
    if (source === "STAGING_INGESTION_RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL") {
      resolved.set("RAW_ASSET_REGISTRY_OPERATOR_DOCKER_DATABASE_URL", dockerValue);
    }
    if (source === "STAGING_INGESTION_OBJECT_STORE_ENDPOINT") {
      resolved.set("OBJECT_STORE_DOCKER_ENDPOINT", dockerValue);
    }
    if (source === "STAGING_INGESTION_QDRANT_URL") {
      resolved.set("QDRANT_DOCKER_URL", dockerValue);
    }
  }
}
requireCompletePair(
  dataPlaneErrors,
  "STAGING_INGESTION_OBJECT_STORE_ACCESS_KEY",
  "STAGING_INGESTION_OBJECT_STORE_SECRET_KEY",
);
requireCompletePair(
  dataPlaneErrors,
  "STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY",
  "STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY",
);
const hasSharedObjectStorePair = hasPair(
  "STAGING_INGESTION_OBJECT_STORE_ACCESS_KEY",
  "STAGING_INGESTION_OBJECT_STORE_SECRET_KEY",
);
const hasDerivedObjectStorePair = hasPair(
  "STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY",
  "STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY",
);
if (
  !(
    hasSharedObjectStorePair ||
    hasDerivedObjectStorePair
  )
) {
  dataPlaneErrors.push(
    "staging supervisor object-store credentials are required: configure shared or derived credential pair",
  );
}
const localPostgresConfigs = [
  ["STAGING_INGESTION_SHARED_POSTGRES_URL", envValue("STAGING_INGESTION_SHARED_POSTGRES_URL")],
  [
    "STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL",
    envValue("STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL"),
  ],
  [
    "STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL",
    envValue("STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL"),
  ],
  [
    "STAGING_INGESTION_SHARED_POSTGRES_OPERATOR_URL",
    envValue("STAGING_INGESTION_SHARED_POSTGRES_OPERATOR_URL"),
  ],
  [
    "STAGING_INGESTION_DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL",
    envValue("STAGING_INGESTION_DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL"),
  ],
  [
    "STAGING_INGESTION_RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL",
    envValue("STAGING_INGESTION_RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL"),
  ],
]
  .map(([source, value]) => parseLocalPostgresConfig(source, value))
  .filter(Boolean);
if (localPostgresConfigs.length > 0) {
  const firstConfig = localPostgresConfigs[0];
  const firstSignature = localPostgresConfigSignature(firstConfig);
  const mismatchedSources = localPostgresConfigs
    .filter((config) => localPostgresConfigSignature(config) !== firstSignature)
    .map((config) => config.source);
  if (mismatchedSources.length > 0) {
    dataPlaneErrors.push(
      `repo-owned local Postgres uses one database/user/password/port; mismatched local DSNs: ${mismatchedSources.join(", ")}`,
    );
  }
  if (!firstConfig.database || !firstConfig.username || !firstConfig.password) {
    dataPlaneErrors.push(
      "repo-owned local Postgres requires database, username, and password in staging Postgres DSNs",
    );
  }
  resolved.set("SUPERVISOR_API_STAGING_LOCAL_POSTGRES_DB", firstConfig.database);
  resolved.set("SUPERVISOR_API_STAGING_LOCAL_POSTGRES_USER", firstConfig.username);
  resolved.set("SUPERVISOR_API_STAGING_LOCAL_POSTGRES_PASSWORD", firstConfig.password);
  resolved.set("SUPERVISOR_API_STAGING_LOCAL_POSTGRES_PORT", firstConfig.port);
}
if (isLocalEndpoint(envValue("STAGING_INGESTION_OBJECT_STORE_ENDPOINT"))) {
  if (hasSharedObjectStorePair && hasDerivedObjectStorePair) {
    const sharedAccess = envValue("STAGING_INGESTION_OBJECT_STORE_ACCESS_KEY");
    const sharedSecret = envValue("STAGING_INGESTION_OBJECT_STORE_SECRET_KEY");
    const derivedAccess = envValue("STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY");
    const derivedSecret = envValue("STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY");
    if (sharedAccess !== derivedAccess || sharedSecret !== derivedSecret) {
      dataPlaneErrors.push(
        "repo-owned local MinIO uses one credential pair; shared and derived object-store credentials must match or only one pair may be set",
      );
    }
  }
  const localMinioAccess = hasSharedObjectStorePair
    ? envValue("STAGING_INGESTION_OBJECT_STORE_ACCESS_KEY")
    : envValue("STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY");
  const localMinioSecret = hasSharedObjectStorePair
    ? envValue("STAGING_INGESTION_OBJECT_STORE_SECRET_KEY")
    : envValue("STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY");
  resolved.set("SUPERVISOR_API_STAGING_LOCAL_MINIO_ACCESS_KEY", localMinioAccess);
  resolved.set("SUPERVISOR_API_STAGING_LOCAL_MINIO_SECRET_KEY", localMinioSecret);
}
if (
  isLocalEndpoint(envValue("STAGING_INGESTION_QDRANT_URL")) &&
  !envValue("STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY")
) {
  dataPlaneErrors.push(
    "STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY is required for repo-owned local Qdrant",
  );
}
resolved.set("SUPERVISOR_API_STAGING_DATA_PLANE_ERRORS", dataPlaneErrors.join("\n"));
resolved.set(
  "SUPERVISOR_API_STAGING_REQUIRES_LOCAL_POSTGRES",
  [
    envValue("STAGING_INGESTION_SHARED_POSTGRES_URL"),
    envValue("STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL"),
    envValue("STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL"),
    envValue("STAGING_INGESTION_SHARED_POSTGRES_OPERATOR_URL"),
    envValue("STAGING_INGESTION_DOCUMENT_REGISTRY_OPERATOR_DATABASE_URL"),
    envValue("STAGING_INGESTION_RAW_ASSET_REGISTRY_OPERATOR_DATABASE_URL"),
  ].some(isLocalPostgresEndpoint)
    ? "true"
    : "false",
);
resolved.set(
  "SUPERVISOR_API_STAGING_REQUIRES_LOCAL_MINIO",
  isLocalEndpoint(envValue("STAGING_INGESTION_OBJECT_STORE_ENDPOINT")) ? "true" : "false",
);
resolved.set(
  "SUPERVISOR_API_STAGING_REQUIRES_LOCAL_QDRANT",
  isLocalEndpoint(envValue("STAGING_INGESTION_QDRANT_URL")) ? "true" : "false",
);

for (const [key, value] of resolved.entries()) {
  process.stdout.write(`export ${key}=${JSON.stringify(value)}\n`);
}

NODE
  )"
  eval "${export_script}"

  supervisor_api_staging_bridge_shared_secret="${SUPERVISOR_AGENT_WORKER_SHARED_SECRET:-}"
  if [[ -z "${API_WORKER_SHARED_SECRET:-}" ]]; then
    echo "API_WORKER_SHARED_SECRET is required for supervisor-api staging trusted-worker auth; set API_WORKER_SHARED_SECRET or SUPERVISOR_API_SHARED_SECRET" >&2
    return 1
  fi
  if [[ -z "${SUPERVISOR_API_EXECUTION_AUDIT_URL:-}" && -n "${supervisor_api_staging_app_api_base_url}" ]]; then
    export SUPERVISOR_API_EXECUTION_AUDIT_URL="${supervisor_api_staging_app_api_base_url%/}/api/internal/execution/audit-events"
  fi
  if [[ -z "${SUPERVISOR_API_EXECUTION_AUDIT_SHARED_SECRET:-}" && -n "${APP_API_INTERNAL_SHARED_SECRET:-}" ]]; then
    export SUPERVISOR_API_EXECUTION_AUDIT_SHARED_SECRET="${APP_API_INTERNAL_SHARED_SECRET}"
  fi
  if [[ -z "${SUPERVISOR_API_EXECUTION_AUDIT_ENABLED:-}" ]]; then
    if [[ -n "${SUPERVISOR_API_EXECUTION_AUDIT_URL:-}" && -n "${SUPERVISOR_API_EXECUTION_AUDIT_SHARED_SECRET:-}" ]]; then
      export SUPERVISOR_API_EXECUTION_AUDIT_ENABLED=true
    else
      export SUPERVISOR_API_EXECUTION_AUDIT_ENABLED=false
    fi
  fi
  export SUPERVISOR_API_EXECUTION_AUDIT_TIMEOUT_MS="${SUPERVISOR_API_EXECUTION_AUDIT_TIMEOUT_MS:-500}"
  export SUPERVISOR_API_OTEL_ENABLED="${SUPERVISOR_API_OTEL_ENABLED:-true}"
  export SUPERVISOR_API_OTEL_METRICS_ENABLED="${SUPERVISOR_API_OTEL_METRICS_ENABLED:-true}"
  export SUPERVISOR_API_OTEL_EXPORT_TIMEOUT_MS="${SUPERVISOR_API_OTEL_EXPORT_TIMEOUT_MS:-1000}"
  export SUPERVISOR_API_OTEL_EXPORT_INTERVAL_MS="${SUPERVISOR_API_OTEL_EXPORT_INTERVAL_MS:-15000}"
  export SUPERVISOR_AGENT_WORKER_OTEL_ENABLED="${SUPERVISOR_AGENT_WORKER_OTEL_ENABLED:-true}"
  export SUPERVISOR_AGENT_WORKER_OTEL_SERVICE_NAME="${SUPERVISOR_AGENT_WORKER_OTEL_SERVICE_NAME:-campus-supervisor-agent-worker}"
  export SUPERVISOR_AGENT_WORKER_OTEL_ALLOWED_ATTRIBUTES_VERSION="${SUPERVISOR_AGENT_WORKER_OTEL_ALLOWED_ATTRIBUTES_VERSION:-supervisor-agent-worker-otel-attrs-v1}"
  export SUPERVISOR_AGENT_WORKER_OTEL_EXPORT_TIMEOUT_SECONDS="${SUPERVISOR_AGENT_WORKER_OTEL_EXPORT_TIMEOUT_SECONDS:-1}"
  export SUPERVISOR_AGENT_WORKER_OTEL_EXPORT_INTERVAL_SECONDS="${SUPERVISOR_AGENT_WORKER_OTEL_EXPORT_INTERVAL_SECONDS:-5}"
  export DEPLOYMENT_ENVIRONMENT="${DEPLOYMENT_ENVIRONMENT:-staging}"
  export OTEL_COLLECTOR_OTLP_GRPC_ENDPOINT="${OTEL_COLLECTOR_OTLP_GRPC_ENDPOINT:-0.0.0.0:4317}"
  export OTEL_COLLECTOR_OTLP_HTTP_ENDPOINT="${OTEL_COLLECTOR_OTLP_HTTP_ENDPOINT:-0.0.0.0:4318}"
  export OTEL_COLLECTOR_HEALTH_CHECK_ENDPOINT="${OTEL_COLLECTOR_HEALTH_CHECK_ENDPOINT:-0.0.0.0:13133}"
  export OTEL_COLLECTOR_MEMORY_LIMIT_MIB="${OTEL_COLLECTOR_MEMORY_LIMIT_MIB:-512}"
  export OTEL_COLLECTOR_MEMORY_SPIKE_LIMIT_MIB="${OTEL_COLLECTOR_MEMORY_SPIKE_LIMIT_MIB:-128}"
  export OTEL_COLLECTOR_TRACE_SAMPLING_PERCENTAGE="${OTEL_COLLECTOR_TRACE_SAMPLING_PERCENTAGE:-100}"
  export OTEL_COLLECTOR_LOG_SAMPLING_PERCENTAGE="${OTEL_COLLECTOR_LOG_SAMPLING_PERCENTAGE:-100}"
}

supervisor_api_staging_require_runtime_env() {
  if [[ -n "${SUPERVISOR_API_STAGING_DATA_PLANE_ERRORS:-}" ]]; then
    echo "supervisor-api staging data-plane env is invalid:" >&2
    while IFS= read -r data_plane_error; do
      if [[ -n "${data_plane_error}" ]]; then
        echo "  - ${data_plane_error}" >&2
      fi
    done <<<"${SUPERVISOR_API_STAGING_DATA_PLANE_ERRORS}"
    return 1
  fi

  if [[ -z "${SUPERVISOR_API_SHARED_SECRET:-}" ]]; then
    echo "SUPERVISOR_API_SHARED_SECRET is missing. Populate apps/app-api/.dev.vars first." >&2
    return 1
  fi

  if [[ -z "${SUPERVISOR_API_METRICS_BEARER_TOKEN:-}" ]]; then
    echo "SUPERVISOR_API_METRICS_BEARER_TOKEN is required for staging supervisor metrics." >&2
    return 1
  fi

  if [[ -z "${supervisor_api_staging_bridge_shared_secret}" ]]; then
    echo "SUPERVISOR_AGENT_WORKER_SHARED_SECRET is missing. Set SUPERVISOR_AGENT_WORKER_STAGING_SHARED_SECRET or export SUPERVISOR_AGENT_WORKER_SHARED_SECRET." >&2
    return 1
  fi

  if [[ -z "${SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET:-}" ]]; then
    echo "SUPERVISOR_INTERNAL_QUERY_SHARED_SECRET is required for supervisor-api staging structured query runtime." >&2
    return 1
  fi

  if [[ -z "${CAMPUS_SHARED_POSTGRES_URL:-}" ]]; then
    echo "CAMPUS_SHARED_POSTGRES_URL is required after STAGING_INGESTION_SHARED_POSTGRES_URL projection." >&2
    return 1
  fi

  if [[ -z "${DOCUMENT_REGISTRY_DATABASE_URL:-}" ]]; then
    echo "DOCUMENT_REGISTRY_DATABASE_URL is required after staging data-plane projection." >&2
    return 1
  fi

  if [[ -z "${OBJECT_STORE_ENDPOINT:-}" ]]; then
    echo "OBJECT_STORE_ENDPOINT is required after STAGING_INGESTION_OBJECT_STORE_ENDPOINT projection." >&2
    return 1
  fi

  if [[ -z "${QDRANT_URL:-}" ]]; then
    echo "QDRANT_URL is required after STAGING_INGESTION_QDRANT_URL projection." >&2
    return 1
  fi

  if [[ -z "${SUPERVISOR_API_STAGING_TUNNEL_TOKEN:-${TUNNEL_TOKEN:-}}" ]]; then
    echo "SUPERVISOR_API_STAGING_TUNNEL_TOKEN is required for the remote-managed supervisor-api-staging tunnel." >&2
    return 1
  fi

  supervisor_api_staging_validate_axiom_collector_endpoint
}
