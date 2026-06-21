#!/usr/bin/env bash
# shellcheck shell=bash
# shellcheck disable=SC2154

execution_control_staging_load_env() {
  local node_bin
  local runtime_release_sha
  local runtime_env_path="${execution_control_staging_env_file}"
  local runtime_secrets_env_path="${execution_control_staging_runtime_secrets_env_file}"
  local export_script

  if [[ -z "${runtime_env_path}" ]]; then
    echo "EXECUTION_CONTROL_STAGING_ENV_FILE is required for execution-control staging; default is ${execution_control_staging_default_env_file}." >&2
    return 1
  fi
  if [[ ! -f "${runtime_env_path}" ]]; then
    echo "EXECUTION_CONTROL_STAGING_ENV_FILE is required for execution-control staging and must point to an existing ops-owned runtime env file: ${runtime_env_path} (default: ${execution_control_staging_default_env_file})." >&2
    return 1
  fi

  node_bin="$(execution_control_staging_require_command node)"
  export_script="$(
    "${node_bin}" - "${runtime_env_path}" "${runtime_secrets_env_path}" <<'NODE'
const [runtimeEnvPath, runtimeSecretsEnvPath] = process.argv.slice(2);
const loadedPaths = [];
const fs = require("node:fs");
const crypto = require("node:crypto");
const path = require("node:path");
const { parseEnv } = require("node:util");
if (typeof parseEnv !== "function") {
  throw new Error("node:util.parseEnv is required for staging env projection");
}
const fileEnv = new Map();
const generatedRuntimeEnv = new Map();

readEnvInto(runtimeEnvPath, fileEnv);
ensureRuntimeEnv(runtimeSecretsEnvPath, fileEnv);
readEnvInto(runtimeSecretsEnvPath, generatedRuntimeEnv);

function readEnvInto(filePath, target) {
  if (!filePath) {
    return;
  }
  try {
    const parsed = parseEnv(fs.readFileSync(filePath, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      target.set(key, value);
    }
    loadedPaths.push(filePath);
  } catch (error) {
    if (!(error instanceof Error && "code" in error) || error.code !== "ENOENT") {
      throw error;
    }
  }
}

function ensureRuntimeEnv(filePath, runtimeEnv) {
  if (!filePath) {
    return;
  }
  const existing = new Map();
  try {
    const parsed = parseEnv(fs.readFileSync(filePath, "utf8"));
    for (const [key, value] of Object.entries(parsed)) {
      existing.set(key, value);
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error) || error.code !== "ENOENT") {
      throw error;
    }
  }
  let changed = false;
  for (const key of [
    "PERSONAL_MEMORY_API_SECRET",
    "PERSONAL_MEMORY_OWNER_SALT",
    "HINDSIGHT_POSTGRES_PASSWORD",
    "TEMPORAL_POSTGRES_PASSWORD",
    "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT",
    "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET",
    "EXECUTION_CONTROL_METRICS_BEARER_TOKEN",
    "QDRANT_API_KEY",
    "QDRANT_READ_ONLY_API_KEY",
    "LANGFUSE_NEXTAUTH_SECRET",
    "LANGFUSE_SALT",
    "LANGFUSE_ENCRYPTION_KEY",
    "LANGFUSE_POSTGRES_PASSWORD",
    "LANGFUSE_CLICKHOUSE_PASSWORD",
    "LANGFUSE_REDIS_AUTH",
    "LANGFUSE_MINIO_ROOT_PASSWORD",
    "LANGFUSE_INIT_PROJECT_PUBLIC_KEY",
    "LANGFUSE_INIT_PROJECT_SECRET_KEY",
    "LANGFUSE_INIT_USER_PASSWORD",
  ]) {
    if (!existing.get(key)?.trim() && !runtimeEnv.get(key)?.trim() && !process.env[key]?.trim()) {
      existing.set(key, randomRuntimeValueForKey(key));
      changed = true;
    }
  }
  if (changed || !fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(
      filePath,
      `${[...existing.entries()].map(([key, value]) => `${key}=${value}`).join("\n")}\n`,
      { mode: 0o600 },
    );
  }
  if (process.platform !== "win32") {
    fs.chmodSync(filePath, 0o600);
  }
}

function randomRuntimeSecret() {
  return crypto.randomBytes(32).toString("base64url");
}

function randomRuntimeHexSecret() {
  return crypto.randomBytes(32).toString("hex");
}

function randomRuntimeValueForKey(key) {
  if (key === "LANGFUSE_ENCRYPTION_KEY") {
    return randomRuntimeHexSecret();
  }
  if (key === "LANGFUSE_INIT_PROJECT_PUBLIC_KEY") {
    return `pk-lf-local-${randomRuntimeSecret()}`;
  }
  if (key === "LANGFUSE_INIT_PROJECT_SECRET_KEY") {
    return `sk-lf-local-${randomRuntimeSecret()}`;
  }
  return randomRuntimeSecret();
}

function sourceEnvValue(key) {
  const processValue = process.env[key]?.trim() || "";
  if (processValue) {
    return processValue;
  }
  return fileEnv.get(key)?.trim() || generatedRuntimeEnv.get(key)?.trim() || "";
}

const keys = [
  "CAMPUS_AGENT_APP_NAME",
  "AGENT_RUNTIME_PORT",
  "AGENT_RUNTIME_SHARED_SECRET",
  "AGENT_RUNTIME_TOOL_CATALOG_PATH",
  "AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL",
  "AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET",
  "EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL",
  "EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET",
  "EXECUTION_CONTROL_AGENT_RUNTIME_TIMEOUT_MS",
  "LLM_API_KEY",
  "LLM_BASE_URL",
  "OTEL_INGEST_SHARED_SECRET",
  "APP_API_OTEL_INGEST_ENDPOINT",
  "APP_API_OTEL_INGEST_SHARED_SECRET",
  "AUDIT_LOG_PATH",
  "AUDIT_QUEUE_CAPACITY",
  "APP_API_INTERNAL_SHARED_SECRET",
  "EXECUTION_CONTROL_APP_API_BASE_URL",
  "EXECUTION_CONTROL_APP_API_INTERNAL_BASE_URL",
  "EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET",
  "EXECUTION_CONTROL_APP_API_INTERNAL_TIMEOUT_MS",
  "EXECUTION_CONTROL_RUNTIME_PROFILE",
  "EXECUTION_CONTROL_RUNTIME_CONFIG_PATH",
  "EXECUTION_CONTROL_METRICS_BEARER_TOKEN",
  "EXECUTION_CONTROL_OTEL_EXPORTER_OTLP_HEADERS",
  "OTEL_COLLECTOR_OTLP_GRPC_ENDPOINT",
  "OTEL_COLLECTOR_OTLP_HTTP_ENDPOINT",
  "OTEL_COLLECTOR_HEALTH_CHECK_ENDPOINT",
  "OTEL_COLLECTOR_MEMORY_LIMIT_MIB",
  "OTEL_COLLECTOR_MEMORY_SPIKE_LIMIT_MIB",
  "OTEL_COLLECTOR_TRACE_SAMPLING_PERCENTAGE",
  "OTEL_COLLECTOR_LOG_SAMPLING_PERCENTAGE",
  "OTEL_COLLECTOR_SENTRY_OTLP_ENDPOINT",
  "OTEL_COLLECTOR_SENTRY_AUTH_VALUE",
  "OTEL_COLLECTOR_AXIOM_OTLP_ENDPOINT",
  "OTEL_COLLECTOR_AXIOM_AUTH_HEADER",
  "OTEL_COLLECTOR_AXIOM_EVENTS_DATASET",
  "OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT",
  "OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER",
  "OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION",
  "EXECUTION_CONTROL_EXECUTION_AUDIT_URL",
  "EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET",
  "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL",
  "TEMPORAL_POSTGRES_PASSWORD",
  "EXECUTION_CONTROL_TEMPORAL_ADDRESS",
  "EXECUTION_CONTROL_TEMPORAL_NAMESPACE",
  "EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE",
  "EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_CONTEXT_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_AGENT_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_PLAN_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_RETRIEVAL_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_SYNTHESIS_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE_SAMPLER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_CAMPUS_SERVICES_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_NOTICE_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_NAVIGATION_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_FINALIZATION_WORKER_IDENTITY",
  "EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT",
  "EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS",
  "EXECUTION_CONTROL_SHARED_SECRET",
  "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET",
  "EXECUTION_CONTROL_STRUCTURED_QUERY_TRUSTED_TIME_RFC3339",
  "INTERNAL_NOTICE_READ_MODEL_DATABASE_URL",
  "INTERNAL_NOTICE_READ_MODEL_TABLE",
  "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ENDPOINT",
  "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ACCESS_KEY",
  "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_SECRET_KEY",
  "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_REGION",
  "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_BUCKET",
  "EXECUTION_CONTROL_STAGING_UV_BIN",
  "EXECUTION_CONTROL_STAGING_COMPOSE_FILES",
  "EXECUTION_CONTROL_STAGING_COMPOSE_PROJECT_NAME",
  "EXECUTION_CONTROL_STAGING_RUNTIME_DIR",
  "EXECUTION_CONTROL_STAGING_HOST",
  "EXECUTION_CONTROL_STAGING_PORT",
  "LLM_MODEL",
  "EMBEDDING_PROVIDER",
  "EMBEDDING_MODEL",
  "EMBEDDING_DIMENSIONS",
  "HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY",
  "HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL",
  "HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL",
  "HINDSIGHT_API_EMBEDDINGS_PROVIDER",
  "HINDSIGHT_API_LLM_API_KEY",
  "HINDSIGHT_API_LLM_BASE_URL",
  "HINDSIGHT_API_LLM_MODEL",
  "HINDSIGHT_API_LLM_PROVIDER",
  "HINDSIGHT_API_RERANKER_PROVIDER",
  "LANGFUSE_HOST_PORT",
  "LANGFUSE_MINIO_HOST_PORT",
  "LANGFUSE_BASE_URL",
  "LANGFUSE_NEXTAUTH_URL",
  "LANGFUSE_MINIO_ROOT_USER",
  "LANGFUSE_NEXTAUTH_SECRET",
  "LANGFUSE_SALT",
  "LANGFUSE_ENCRYPTION_KEY",
  "LANGFUSE_POSTGRES_PASSWORD",
  "LANGFUSE_CLICKHOUSE_PASSWORD",
  "LANGFUSE_REDIS_AUTH",
  "LANGFUSE_MINIO_ROOT_PASSWORD",
  "LANGFUSE_INIT_ORG_ID",
  "LANGFUSE_INIT_ORG_NAME",
  "LANGFUSE_INIT_PROJECT_ID",
  "LANGFUSE_INIT_PROJECT_NAME",
  "LANGFUSE_INIT_PROJECT_PUBLIC_KEY",
  "LANGFUSE_INIT_PROJECT_SECRET_KEY",
  "LANGFUSE_INIT_USER_EMAIL",
  "LANGFUSE_INIT_USER_NAME",
  "LANGFUSE_INIT_USER_PASSWORD",
  "LANGFUSE_ENVIRONMENT",
  "LANGFUSE_PUBLIC_KEY",
  "LANGFUSE_SECRET_KEY",
  "QDRANT_QUERY_API_KEY",
  "QDRANT_API_KEY",
  "QDRANT_READ_ONLY_API_KEY",
  "QDRANT_TLS_DIR",
  "QDRANT_TLS_CA_CERT_PATH",
  "PERSONAL_MEMORY_BASE_URL",
  "PERSONAL_MEMORY_API_SECRET",
  "PERSONAL_MEMORY_OWNER_SALT",
  "HINDSIGHT_POSTGRES_PASSWORD",
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

function removeUrlSearchParam(value, name) {
  if (!value) {
    return value;
  }
  try {
    const parsed = new URL(value);
    parsed.searchParams.delete(name);
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return value;
  }
}

function projectQdrantForDocker(value) {
  return projectLoopbackUrlHost(value, "qdrant", "6333");
}

function projectPostgresForDocker(value) {
  return removeUrlSearchParam(
    projectLoopbackUrlHost(value, "campus-agent-postgres", "5432"),
    "gssencmode",
  );
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

function resolvedValue(key) {
  return resolved.get(key)?.trim() || "";
}

function setDefault(key, value) {
  if (!resolvedValue(key) && value) {
    resolved.set(key, value);
  }
}

const workerSharedSecret =
  sourceEnvValue("API_WORKER_SHARED_SECRET") ||
  sourceEnvValue("EXECUTION_CONTROL_SHARED_SECRET") ||
  "";
resolved.set("API_WORKER_SHARED_SECRET", workerSharedSecret);
const internalQuerySharedSecret = resolvedValue("EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET");
if (workerSharedSecret && internalQuerySharedSecret) {
  const otelIngestSharedSecret =
    resolvedValue("OTEL_INGEST_SHARED_SECRET") ||
    resolvedValue("APP_API_OTEL_INGEST_SHARED_SECRET") ||
    crypto
      .createHash("sha256")
      .update("campus-agent:otel-ingest:v1\0")
      .update(workerSharedSecret)
      .update("\0")
      .update(internalQuerySharedSecret)
      .digest("hex");
  setDefault("OTEL_INGEST_SHARED_SECRET", otelIngestSharedSecret);
  setDefault("APP_API_OTEL_INGEST_SHARED_SECRET", otelIngestSharedSecret);
}
setDefault("APP_API_OTEL_INGEST_ENDPOINT", "https://otel-ingest-staging.mucwiki-edge.link");
const stagingAppAPIBaseURL =
  sourceEnvValue("EXECUTION_CONTROL_STAGING_APP_API_BASE_URL") ||
  "https://api-staging.mucwiki-edge.link";
setDefault("EXECUTION_CONTROL_APP_API_BASE_URL", stagingAppAPIBaseURL);
setDefault("EXECUTION_CONTROL_APP_API_INTERNAL_BASE_URL", stagingAppAPIBaseURL);
setDefault("EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET", resolvedValue("APP_API_INTERNAL_SHARED_SECRET"));
setDefault("EXECUTION_CONTROL_APP_API_INTERNAL_TIMEOUT_MS", "30000");
if (!resolved.get("PERSONAL_MEMORY_BASE_URL")) {
  resolved.set("PERSONAL_MEMORY_BASE_URL", "http://hindsight-api:8888");
}
setDefault("HINDSIGHT_API_LLM_API_KEY", resolvedValue("LLM_API_KEY"));
setDefault("HINDSIGHT_API_LLM_BASE_URL", resolvedValue("LLM_BASE_URL"));
setDefault("HINDSIGHT_API_LLM_MODEL", resolvedValue("LLM_MODEL"));
setDefault("HINDSIGHT_API_LLM_PROVIDER", "openai");
setDefault("HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY", resolvedValue("EMBEDDING_API_KEY"));
setDefault("HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL", resolvedValue("EMBEDDING_BASE_URL"));
setDefault("HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL", resolvedValue("EMBEDDING_MODEL"));
setDefault("HINDSIGHT_API_EMBEDDINGS_PROVIDER", "openai");
setDefault("HINDSIGHT_API_RERANKER_PROVIDER", "rrf");

const explicitLangfuseBaseURL = sourceEnvValue("LANGFUSE_BASE_URL");
setDefault("LANGFUSE_HOST_PORT", "3000");
setDefault("LANGFUSE_MINIO_HOST_PORT", "9090");
setDefault("LANGFUSE_BASE_URL", `http://127.0.0.1:${resolvedValue("LANGFUSE_HOST_PORT") || "3000"}`);
setDefault("LANGFUSE_NEXTAUTH_URL", resolvedValue("LANGFUSE_BASE_URL"));
setDefault("LANGFUSE_MINIO_ROOT_USER", "minio");
setDefault("LANGFUSE_INIT_ORG_ID", "campus-agent-staging");
setDefault("LANGFUSE_INIT_ORG_NAME", "campus-agent-staging");
setDefault("LANGFUSE_INIT_PROJECT_ID", "campus-agent-staging");
setDefault("LANGFUSE_INIT_PROJECT_NAME", "campus-agent-staging");
setDefault("LANGFUSE_INIT_USER_EMAIL", "langfuse-staging@campus-agent.local");
setDefault("LANGFUSE_INIT_USER_NAME", "Campus Agent Staging");
setDefault("LANGFUSE_ENVIRONMENT", resolvedValue("DEPLOYMENT_ENVIRONMENT") || "staging");
setDefault("LANGFUSE_PUBLIC_KEY", resolvedValue("LANGFUSE_INIT_PROJECT_PUBLIC_KEY"));
setDefault("LANGFUSE_SECRET_KEY", resolvedValue("LANGFUSE_INIT_PROJECT_SECRET_KEY"));
setDefault("LANGFUSE_INIT_PROJECT_PUBLIC_KEY", resolvedValue("LANGFUSE_PUBLIC_KEY"));
setDefault("LANGFUSE_INIT_PROJECT_SECRET_KEY", resolvedValue("LANGFUSE_SECRET_KEY"));
const langfuseCollectorBaseURL = explicitLangfuseBaseURL || "http://langfuse-web:3000";
setDefault(
  "OTEL_COLLECTOR_LANGFUSE_OTLP_ENDPOINT",
  `${langfuseCollectorBaseURL.replace(/\/+$/, "")}/api/public/otel`,
);
if (resolvedValue("LANGFUSE_PUBLIC_KEY") && resolvedValue("LANGFUSE_SECRET_KEY")) {
  setDefault(
    "OTEL_COLLECTOR_LANGFUSE_AUTH_HEADER",
    `Basic ${Buffer.from(
      `${resolvedValue("LANGFUSE_PUBLIC_KEY")}:${resolvedValue("LANGFUSE_SECRET_KEY")}`,
    ).toString("base64")}`,
  );
}
setDefault("OTEL_COLLECTOR_LANGFUSE_INGESTION_VERSION", "4");
if (!resolved.get("QDRANT_API_KEY") && sourceEnvValue("QDRANT_API_KEY")) {
  resolved.set("QDRANT_API_KEY", sourceEnvValue("QDRANT_API_KEY"));
}
if (!resolved.get("QDRANT_READ_ONLY_API_KEY") && sourceEnvValue("QDRANT_READ_ONLY_API_KEY")) {
  resolved.set("QDRANT_READ_ONLY_API_KEY", sourceEnvValue("QDRANT_READ_ONLY_API_KEY"));
}
if (!resolved.get("QDRANT_QUERY_API_KEY")) {
  const generatedReadOnlyKey = sourceEnvValue("QDRANT_READ_ONLY_API_KEY");
  if (generatedReadOnlyKey) {
    resolved.set("QDRANT_QUERY_API_KEY", generatedReadOnlyKey);
  }
}

const retiredEnvErrors = [];
for (const retiredKey of [
  "EXECUTION_CONTROL_DURABLE_WORKER_LOOP_ENABLED",
  "EXECUTION_CONTROL_DURABLE_WORKER_LOOP_WORKER_ID",
  "EXECUTION_CONTROL_DURABLE_WORKER_LOOP_LANE",
  "EXECUTION_CONTROL_DURABLE_WORKER_LOOP_STEP_ID",
  "EXECUTION_CONTROL_DURABLE_WORKER_LOOP_POLL_INTERVAL_MS",
  "EXECUTION_CONTROL_DURABLE_WORKER_LOOP_LEASE_TTL_MS",
  "EXECUTION_CONTROL_DURABLE_WORKER_LOOP_LEASE_HEARTBEAT_INTERVAL_MS",
  "EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_ENABLED",
  "EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_INTERVAL_MS",
  "EXECUTION_CONTROL_DURABLE_RECOVERY_LOOP_MAX_RETRY_ATTEMPTS",
  "EXECUTION_CONTROL_BRIDGE_BREAKER_FAILURE_THRESHOLD",
  "EXECUTION_CONTROL_BRIDGE_BREAKER_OPEN_MS",
  "EXECUTION_CONTROL_BRIDGE_RETRY_MAX_ATTEMPTS",
  "EXECUTION_CONTROL_BRIDGE_RETRY_BASE_MS",
]) {
  if (sourceEnvValue(retiredKey)) {
    retiredEnvErrors.push(`${retiredKey} is retired; use Go Temporal RAG worker settings`);
  }
}
resolved.set("EXECUTION_CONTROL_STAGING_RETIRED_ENV_ERRORS", retiredEnvErrors.join("\n"));

const stagingRequiredMappings = [
  ["STAGING_INGESTION_SHARED_POSTGRES_URL", "CAMPUS_SHARED_POSTGRES_URL"],
  ["STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL", "DOCUMENT_REGISTRY_DATABASE_URL"],
  ["STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL", "RAW_ASSET_REGISTRY_DATABASE_URL"],
  ["STAGING_INGESTION_OBJECT_STORE_ENDPOINT", "OBJECT_STORE_ENDPOINT"],
  ["STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED", "OBJECT_STORE_BUCKET_DERIVED"],
  ["STAGING_INGESTION_EMBEDDING_BASE_URL", "EMBEDDING_BASE_URL"],
  ["STAGING_INGESTION_EMBEDDING_API_KEY", "EMBEDDING_API_KEY"],
  ["STAGING_INGESTION_EMBEDDING_MODEL", "EMBEDDING_MODEL"],
  ["STAGING_INGESTION_EMBEDDING_DIMENSIONS", "EMBEDDING_DIMENSIONS"],
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
  ["STAGING_INGESTION_QDRANT_URL", "QDRANT_URL"],
  ["STAGING_INGESTION_QDRANT_TLS_CA_CERT_PATH", "QDRANT_TLS_CA_CERT_PATH"],
  ["STAGING_INGESTION_QDRANT_TIMEOUT_SECONDS", "QDRANT_TIMEOUT_SECONDS"],
  ["STAGING_INGESTION_EMBEDDING_PROVIDER", "EMBEDDING_PROVIDER"],
];

function envValue(key) {
  return sourceEnvValue(key);
}

function deriveAgentRuntimeBridgeSecret() {
  const executionControlSecret = envValue("EXECUTION_CONTROL_SHARED_SECRET");
  const internalQuerySecret = envValue("EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET");
  if (!executionControlSecret || !internalQuerySecret) {
    return "";
  }
  return crypto
    .createHash("sha256")
    .update("campus-agent:agent-runtime-bridge:v1\0")
    .update(executionControlSecret)
    .update("\0")
    .update(internalQuerySecret)
    .digest("hex");
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

function validateStagingQdrantRuntimeUrl(errors, source, value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    errors.push(`${source} must be a valid https URL`);
    return;
  }
  const selfHostedInternalHosts = new Set(["qdrant", "127.0.0.1", "localhost"]);
  if (parsed.protocol === "http:" && selfHostedInternalHosts.has(parsed.hostname)) {
    return;
  }
  if (parsed.protocol !== "https:") {
    errors.push(`${source} must use https unless it targets the self-hosted internal Qdrant service`);
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
    dataPlaneErrors.push(`${source} is required for execution-control staging data plane`);
    continue;
  }
  if (isLocalEndpoint(value) && !acceptsSameHostStagingEndpoint(source)) {
    dataPlaneErrors.push(`${source} must not point at localhost for execution-control staging`);
    continue;
  }
  if (
    source === "STAGING_INGESTION_SHARED_POSTGRES_URL" ||
    source === "STAGING_INGESTION_DOCUMENT_REGISTRY_DATABASE_URL" ||
    source === "STAGING_INGESTION_RAW_ASSET_REGISTRY_DATABASE_URL"
  ) {
    validateStagingPostgresRuntimeUrl(dataPlaneErrors, source, value);
  }
  if (source === "STAGING_INGESTION_QDRANT_URL") {
    validateStagingQdrantRuntimeUrl(dataPlaneErrors, source, value);
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
      dataPlaneErrors.push(`${source} must not point at localhost for execution-control staging`);
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
const supervisorNoticeBodyAccessKey = hasDerivedObjectStorePair
  ? envValue("STAGING_INGESTION_OBJECT_STORE_DERIVED_ACCESS_KEY")
  : envValue("STAGING_INGESTION_OBJECT_STORE_ACCESS_KEY");
const supervisorNoticeBodySecretKey = hasDerivedObjectStorePair
  ? envValue("STAGING_INGESTION_OBJECT_STORE_DERIVED_SECRET_KEY")
  : envValue("STAGING_INGESTION_OBJECT_STORE_SECRET_KEY");
resolved.set(
  "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ENDPOINT",
  projectObjectStoreForDocker(envValue("STAGING_INGESTION_OBJECT_STORE_ENDPOINT")),
);
resolved.set("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ACCESS_KEY", supervisorNoticeBodyAccessKey);
resolved.set("EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_SECRET_KEY", supervisorNoticeBodySecretKey);
resolved.set(
  "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_REGION",
  envValue("STAGING_INGESTION_OBJECT_STORE_REGION") || "us-east-1",
);
resolved.set(
  "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_BUCKET",
  envValue("STAGING_INGESTION_OBJECT_STORE_BUCKET_DERIVED"),
);
setDefault("HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY", resolvedValue("EMBEDDING_API_KEY"));
setDefault("HINDSIGHT_API_EMBEDDINGS_OPENAI_BASE_URL", resolvedValue("EMBEDDING_BASE_URL"));
setDefault("HINDSIGHT_API_EMBEDDINGS_OPENAI_MODEL", resolvedValue("EMBEDDING_MODEL"));
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
  resolved.set("EXECUTION_CONTROL_STAGING_LOCAL_POSTGRES_DB", firstConfig.database);
  resolved.set("EXECUTION_CONTROL_STAGING_LOCAL_POSTGRES_USER", firstConfig.username);
  resolved.set("EXECUTION_CONTROL_STAGING_LOCAL_POSTGRES_PASSWORD", firstConfig.password);
  resolved.set("EXECUTION_CONTROL_STAGING_LOCAL_POSTGRES_PORT", firstConfig.port);
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
  resolved.set("EXECUTION_CONTROL_STAGING_LOCAL_MINIO_ACCESS_KEY", localMinioAccess);
  resolved.set("EXECUTION_CONTROL_STAGING_LOCAL_MINIO_SECRET_KEY", localMinioSecret);
}
if (!resolved.has("QDRANT_URL")) {
  resolved.set("QDRANT_URL", "http://qdrant:6333");
  resolved.set("QDRANT_DOCKER_URL", "http://qdrant:6333");
}
if (!resolved.has("QDRANT_DOCKER_URL")) {
  resolved.set("QDRANT_DOCKER_URL", projectQdrantForDocker(resolved.get("QDRANT_URL")));
}
if (!resolved.has("QDRANT_READ_ONLY_API_KEY") && envValue("QDRANT_READ_ONLY_API_KEY")) {
  resolved.set("QDRANT_READ_ONLY_API_KEY", envValue("QDRANT_READ_ONLY_API_KEY"));
}
if (resolved.get("QDRANT_READ_ONLY_API_KEY")) {
  resolved.set("QDRANT_QUERY_API_KEY", resolved.get("QDRANT_READ_ONLY_API_KEY"));
} else if (!resolved.has("QDRANT_QUERY_API_KEY")) {
  resolved.set("QDRANT_QUERY_API_KEY", "");
}
if (!resolved.has("QDRANT_TLS_DIR") && resolved.get("QDRANT_TLS_CA_CERT_PATH")) {
  resolved.set("QDRANT_TLS_DIR", path.dirname(resolved.get("QDRANT_TLS_CA_CERT_PATH")));
}
resolved.set(
  "EXECUTION_CONTROL_STAGING_REQUIRES_LOCAL_POSTGRES",
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
  "EXECUTION_CONTROL_STAGING_REQUIRES_LOCAL_MINIO",
  isLocalEndpoint(envValue("STAGING_INGESTION_OBJECT_STORE_ENDPOINT")) ? "true" : "false",
);
resolved.set(
  "EXECUTION_CONTROL_STAGING_REQUIRES_LOCAL_QDRANT",
  isLocalEndpoint(envValue("STAGING_INGESTION_QDRANT_URL")) ? "true" : "false",
);
if (!resolved.has("EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL")) {
  resolved.set(
    "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL",
    "postgresql://postgres:postgres@campus-agent-postgres:5432/campus_agent?sslmode=disable",
  );
}
if (envValue("EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL")) {
  resolved.set(
    "EXECUTION_CONTROL_RUN_PROJECTION_DOCKER_DATABASE_URL",
    projectPostgresForDocker(envValue("EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL")),
  );
} else {
  resolved.set(
    "EXECUTION_CONTROL_RUN_PROJECTION_DOCKER_DATABASE_URL",
    resolved.get("EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL"),
  );
}
if (!resolved.has("EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL")) {
  resolved.set("EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL", "http://agent-runtime:27062");
}
if (!resolved.has("EXECUTION_CONTROL_AGENT_RUNTIME_TIMEOUT_MS")) {
  resolved.set("EXECUTION_CONTROL_AGENT_RUNTIME_TIMEOUT_MS", "30000");
}
if (!resolved.has("AGENT_RUNTIME_TOOL_CATALOG_PATH")) {
  resolved.set("AGENT_RUNTIME_TOOL_CATALOG_PATH", "configs/runtime/tool-catalog.v1.json");
}
const agentRuntimeSharedSecret =
  envValue("EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET") ||
  envValue("AGENT_RUNTIME_SHARED_SECRET") ||
  deriveAgentRuntimeBridgeSecret();
if (
  envValue("EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET") &&
  envValue("AGENT_RUNTIME_SHARED_SECRET") &&
  envValue("EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET") !== envValue("AGENT_RUNTIME_SHARED_SECRET")
) {
  dataPlaneErrors.push(
    "EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET and AGENT_RUNTIME_SHARED_SECRET must match",
  );
}
if (agentRuntimeSharedSecret) {
  resolved.set("EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET", agentRuntimeSharedSecret);
  resolved.set("AGENT_RUNTIME_SHARED_SECRET", agentRuntimeSharedSecret);
}
if (!resolved.has("AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL")) {
  resolved.set("AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL", "http://execution-control:8000");
}
const agentRuntimeExecutionControlSharedSecret =
  envValue("AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET") ||
  envValue("EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET") ||
  "";
if (
  envValue("AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET") &&
  envValue("EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET") &&
  envValue("AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET") !==
    envValue("EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET")
) {
  dataPlaneErrors.push(
    "AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET must match EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET",
  );
}
if (agentRuntimeExecutionControlSharedSecret) {
  resolved.set(
    "AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET",
    agentRuntimeExecutionControlSharedSecret,
  );
}
resolved.set("EXECUTION_CONTROL_STAGING_DATA_PLANE_ERRORS", dataPlaneErrors.join("\n"));
if (!resolved.has("EXECUTION_CONTROL_TEMPORAL_ADDRESS")) {
  resolved.set("EXECUTION_CONTROL_TEMPORAL_ADDRESS", "temporal:7233");
}
if (!resolved.has("EXECUTION_CONTROL_TEMPORAL_NAMESPACE")) {
  resolved.set("EXECUTION_CONTROL_TEMPORAL_NAMESPACE", "campus-agent-staging");
}
if (!resolved.has("EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE")) {
  resolved.set("EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE", "campus-agent.workflow");
}
if (!resolved.has("EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS")) {
  resolved.set("EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS", "5000");
}
if (!resolved.has("EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY")) {
  resolved.set("EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY", "staging:execution-control:001");
}
if (!resolved.has("EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY")) {
  resolved.set("EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY", "staging:workflow-worker:001");
}
if (!resolved.has("EXECUTION_CONTROL_TEMPORAL_CONTEXT_WORKER_IDENTITY")) {
  resolved.set("EXECUTION_CONTROL_TEMPORAL_CONTEXT_WORKER_IDENTITY", "staging:activity-context:001");
}
if (!resolved.has("EXECUTION_CONTROL_TEMPORAL_AGENT_WORKER_IDENTITY")) {
  resolved.set("EXECUTION_CONTROL_TEMPORAL_AGENT_WORKER_IDENTITY", "staging:activity-agent:001");
}
if (!resolved.has("EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_PLAN_WORKER_IDENTITY")) {
  resolved.set("EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_PLAN_WORKER_IDENTITY", "staging:activity-knowledge-plan:001");
}
if (!resolved.has("EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_RETRIEVAL_WORKER_IDENTITY")) {
  resolved.set(
    "EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_RETRIEVAL_WORKER_IDENTITY",
    "staging:activity-knowledge-retrieval:001",
  );
}
if (!resolved.has("EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_SYNTHESIS_WORKER_IDENTITY")) {
  resolved.set(
    "EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_SYNTHESIS_WORKER_IDENTITY",
    "staging:activity-knowledge-synthesis:001",
  );
}
if (!resolved.has("EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE_SAMPLER_IDENTITY")) {
  resolved.set(
    "EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE_SAMPLER_IDENTITY",
    "staging:temporal-task-queue-sampler:001",
  );
}
if (!resolved.has("EXECUTION_CONTROL_TEMPORAL_CAMPUS_SERVICES_WORKER_IDENTITY")) {
  resolved.set(
    "EXECUTION_CONTROL_TEMPORAL_CAMPUS_SERVICES_WORKER_IDENTITY",
    "staging:activity-campus-services:001",
  );
}
if (!resolved.has("EXECUTION_CONTROL_TEMPORAL_NOTICE_WORKER_IDENTITY")) {
  resolved.set("EXECUTION_CONTROL_TEMPORAL_NOTICE_WORKER_IDENTITY", "staging:activity-notice:001");
}
if (!resolved.has("EXECUTION_CONTROL_TEMPORAL_NAVIGATION_WORKER_IDENTITY")) {
  resolved.set("EXECUTION_CONTROL_TEMPORAL_NAVIGATION_WORKER_IDENTITY", "staging:activity-navigation:001");
}
if (!resolved.has("EXECUTION_CONTROL_TEMPORAL_FINALIZATION_WORKER_IDENTITY")) {
  resolved.set(
    "EXECUTION_CONTROL_TEMPORAL_FINALIZATION_WORKER_IDENTITY",
    "staging:activity-finalization:001",
  );
}

for (const [key, value] of resolved.entries()) {
  process.stdout.write(`export ${key}=${JSON.stringify(value)}\n`);
}

NODE
  )"
  eval "${export_script}"
  execution_control_staging_refresh_runtime_topology_from_env
  export EXECUTION_CONTROL_STAGING_COMPOSE_PROJECT_NAME="${execution_control_staging_compose_project_name}"
  export EXECUTION_CONTROL_STAGING_RUNTIME_DIR="${execution_control_staging_runtime_dir}"
  export EXECUTION_CONTROL_STAGING_HOST="${execution_control_staging_host}"
  export EXECUTION_CONTROL_STAGING_PORT="${execution_control_staging_port}"
  export EXECUTION_CONTROL_COMPOSE_PROJECT_DIRECTORY="${EXECUTION_CONTROL_COMPOSE_PROJECT_DIRECTORY:-${execution_control_staging_repo_root}}"
  export EXECUTION_CONTROL_COMPOSE_PROJECT_NAME="${EXECUTION_CONTROL_COMPOSE_PROJECT_NAME:-${execution_control_staging_compose_project_name}}"
  execution_control_staging_ensure_runtime_dirs

  if [[ -z "${API_WORKER_SHARED_SECRET:-}" ]]; then
    echo "API_WORKER_SHARED_SECRET is required for execution-control staging trusted-worker auth; set API_WORKER_SHARED_SECRET or EXECUTION_CONTROL_SHARED_SECRET in ${execution_control_staging_env_file}." >&2
    return 1
  fi
  if [[ -z "${EXECUTION_CONTROL_EXECUTION_AUDIT_URL:-}" && -n "${execution_control_staging_app_api_base_url}" ]]; then
    export EXECUTION_CONTROL_EXECUTION_AUDIT_URL="${execution_control_staging_app_api_base_url%/}/api/internal/execution/audit-events"
  fi
  if [[ -z "${EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET:-}" && -n "${APP_API_INTERNAL_SHARED_SECRET:-}" ]]; then
    export EXECUTION_CONTROL_EXECUTION_AUDIT_SHARED_SECRET="${APP_API_INTERNAL_SHARED_SECRET}"
  fi
  export EXECUTION_CONTROL_RUNTIME_CONFIG_PATH="${EXECUTION_CONTROL_RUNTIME_CONFIG_PATH:-/etc/campus-agent/runtime-profile.staging.json}"
  export DEPLOYMENT_ENVIRONMENT="${DEPLOYMENT_ENVIRONMENT:-staging}"
  if [[ -z "${EXECUTION_CONTROL_RUNTIME_RELEASE:-}" ]]; then
    runtime_release_sha="${EXECUTION_CONTROL_STAGING_EXPECTED_SHA:-}"
    if [[ -z "${runtime_release_sha}" ]]; then
      runtime_release_sha="$(git -C "${execution_control_staging_repo_root}" rev-parse HEAD)"
    fi
    export EXECUTION_CONTROL_RUNTIME_RELEASE="execution-control@${runtime_release_sha}"
  fi
  export OTEL_COLLECTOR_OTLP_GRPC_ENDPOINT="${OTEL_COLLECTOR_OTLP_GRPC_ENDPOINT:-0.0.0.0:4317}"
  export OTEL_COLLECTOR_OTLP_HTTP_ENDPOINT="${OTEL_COLLECTOR_OTLP_HTTP_ENDPOINT:-0.0.0.0:4318}"
  export OTEL_COLLECTOR_HEALTH_CHECK_ENDPOINT="${OTEL_COLLECTOR_HEALTH_CHECK_ENDPOINT:-0.0.0.0:13133}"
  export OTEL_COLLECTOR_MEMORY_LIMIT_MIB="${OTEL_COLLECTOR_MEMORY_LIMIT_MIB:-512}"
  export OTEL_COLLECTOR_MEMORY_SPIKE_LIMIT_MIB="${OTEL_COLLECTOR_MEMORY_SPIKE_LIMIT_MIB:-128}"
  export OTEL_COLLECTOR_TRACE_SAMPLING_PERCENTAGE="${OTEL_COLLECTOR_TRACE_SAMPLING_PERCENTAGE:-100}"
  export OTEL_COLLECTOR_LOG_SAMPLING_PERCENTAGE="${OTEL_COLLECTOR_LOG_SAMPLING_PERCENTAGE:-100}"
}

execution_control_staging_require_runtime_env() {
  execution_control_staging_require_canonical_runtime_topology
  execution_control_staging_require_runtime_env_core
  execution_control_staging_validate_axiom_collector_endpoint
}

execution_control_staging_require_status_env() {
  execution_control_staging_require_canonical_runtime_topology
  execution_control_staging_require_runtime_env_core
  execution_control_staging_validate_axiom_collector_endpoint
}

execution_control_staging_require_local_temporal_proof_env() {
  if [[ "${EXECUTION_CONTROL_STAGING_RUNTIME_KIND:-}" != "local-temporal-proof" ]]; then
    echo "EXECUTION_CONTROL_STAGING_RUNTIME_KIND=local-temporal-proof is required for the local temporal proof script." >&2
    return 1
  fi
  execution_control_staging_require_runtime_env_core
  execution_control_staging_require_isolated_temporal_proof_runtime
  execution_control_staging_validate_axiom_collector_endpoint
}

execution_control_staging_require_canonical_runtime_topology() {
  if [[ "${EXECUTION_CONTROL_STAGING_RUNTIME_KIND:-canonical}" != "canonical" ]]; then
    echo "Canonical execution-control staging lifecycle requires EXECUTION_CONTROL_STAGING_RUNTIME_KIND=canonical or unset." >&2
    return 1
  fi
  if [[ "${execution_control_staging_compose_project_name}" != "campus-execution-control-staging" ]]; then
    echo "Canonical execution-control staging compose project must be campus-execution-control-staging." >&2
    return 1
  fi
  if [[ "${execution_control_staging_runtime_dir}" != "${execution_control_staging_repo_root}/.tmp/execution-control-staging" ]]; then
    echo "Canonical execution-control staging runtime dir must be ${execution_control_staging_repo_root}/.tmp/execution-control-staging." >&2
    return 1
  fi
  if [[ "${execution_control_staging_host}" != "127.0.0.1" ]]; then
    echo "Canonical execution-control staging host must be 127.0.0.1." >&2
    return 1
  fi
  if [[ "${execution_control_staging_port}" != "27051" ]]; then
    echo "Canonical execution-control staging port must be 27051." >&2
    return 1
  fi
}

execution_control_staging_require_isolated_temporal_proof_runtime() {
  if [[ -z "${EXECUTION_CONTROL_STAGING_COMPOSE_PROJECT_NAME:-}" ]]; then
    echo "EXECUTION_CONTROL_STAGING_COMPOSE_PROJECT_NAME is required for local temporal proof; use an isolated compose project, not the canonical staging runtime." >&2
    return 1
  fi
  if [[ -z "${EXECUTION_CONTROL_STAGING_RUNTIME_DIR:-}" ]]; then
    echo "EXECUTION_CONTROL_STAGING_RUNTIME_DIR is required for local temporal proof; use an isolated runtime directory, not the canonical staging runtime." >&2
    return 1
  fi
  if [[ -z "${EXECUTION_CONTROL_STAGING_PORT:-}" ]]; then
    echo "EXECUTION_CONTROL_STAGING_PORT is required for local temporal proof; use an isolated host port, not the canonical staging runtime." >&2
    return 1
  fi
  if [[ "${EXECUTION_CONTROL_STAGING_COMPOSE_PROJECT_NAME}" == "campus-execution-control-staging" ]]; then
    echo "EXECUTION_CONTROL_STAGING_COMPOSE_PROJECT_NAME must not be campus-execution-control-staging for local temporal proof." >&2
    return 1
  fi
  if [[ "${EXECUTION_CONTROL_STAGING_RUNTIME_DIR}" == "${execution_control_staging_repo_root}/.tmp/execution-control-staging" ]]; then
    echo "EXECUTION_CONTROL_STAGING_RUNTIME_DIR must not use the canonical staging runtime directory for local temporal proof." >&2
    return 1
  fi
  if [[ "${EXECUTION_CONTROL_STAGING_PORT}" == "27051" ]]; then
    echo "EXECUTION_CONTROL_STAGING_PORT must not use canonical staging port 27051 for local temporal proof." >&2
    return 1
  fi
}

execution_control_staging_require_runtime_env_core() {
  execution_control_staging_require_observability_env

  if [[ -n "${EXECUTION_CONTROL_STAGING_DATA_PLANE_ERRORS:-}" ]]; then
    echo "execution-control staging data-plane env is invalid:" >&2
    while IFS= read -r data_plane_error; do
      if [[ -n "${data_plane_error}" ]]; then
        echo "  - ${data_plane_error}" >&2
      fi
    done <<<"${EXECUTION_CONTROL_STAGING_DATA_PLANE_ERRORS}"
    return 1
  fi

  if [[ -n "${EXECUTION_CONTROL_STAGING_RETIRED_ENV_ERRORS:-}" ]]; then
    echo "execution-control staging env contains retired PG lease loop settings:" >&2
    while IFS= read -r retired_env_error; do
      if [[ -n "${retired_env_error}" ]]; then
        echo "  - ${retired_env_error}" >&2
      fi
    done <<<"${EXECUTION_CONTROL_STAGING_RETIRED_ENV_ERRORS}"
    return 1
  fi

  if [[ -z "${EXECUTION_CONTROL_SHARED_SECRET:-}" ]]; then
    echo "EXECUTION_CONTROL_SHARED_SECRET is missing. Populate ${execution_control_staging_env_file} or the Docker/ops secret source that renders it." >&2
    return 1
  fi

  if [[ -z "${EXECUTION_CONTROL_METRICS_BEARER_TOKEN:-}" ]]; then
    echo "EXECUTION_CONTROL_METRICS_BEARER_TOKEN is required for staging supervisor metrics." >&2
    return 1
  fi

  if [[ -z "${EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET:-}" ]]; then
    echo "EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET is required for execution-control staging structured query runtime." >&2
    return 1
  fi

  if [[ -z "${EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL:-}" ]]; then
    echo "EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL is required for execution-control staging run projection store." >&2
    return 1
  fi

  if [[ -z "${EXECUTION_CONTROL_RUNTIME_RELEASE:-}" ]]; then
    echo "EXECUTION_CONTROL_RUNTIME_RELEASE is required for execution-control staging observability." >&2
    return 1
  fi

  if [[ -z "${TEMPORAL_POSTGRES_PASSWORD:-}" ]]; then
    echo "TEMPORAL_POSTGRES_PASSWORD is required for self-hosted Temporal Postgres." >&2
    return 1
  fi

  local temporal_required_keys=(
    EXECUTION_CONTROL_TEMPORAL_ADDRESS
    EXECUTION_CONTROL_TEMPORAL_NAMESPACE
    EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE
    EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY
    EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY
    EXECUTION_CONTROL_TEMPORAL_CONTEXT_WORKER_IDENTITY
    EXECUTION_CONTROL_TEMPORAL_AGENT_WORKER_IDENTITY
    EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_PLAN_WORKER_IDENTITY
    EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_RETRIEVAL_WORKER_IDENTITY
    EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_SYNTHESIS_WORKER_IDENTITY
    EXECUTION_CONTROL_TEMPORAL_CAMPUS_SERVICES_WORKER_IDENTITY
    EXECUTION_CONTROL_TEMPORAL_NOTICE_WORKER_IDENTITY
    EXECUTION_CONTROL_TEMPORAL_NAVIGATION_WORKER_IDENTITY
    EXECUTION_CONTROL_TEMPORAL_FINALIZATION_WORKER_IDENTITY
    EXECUTION_CONTROL_TEMPORAL_WORKFLOW_ID_SALT
    EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS
  )
  local temporal_required_key
  for temporal_required_key in "${temporal_required_keys[@]}"; do
    if [[ -z "${!temporal_required_key:-}" ]]; then
      echo "${temporal_required_key} is required for execution-control staging Temporal runtime." >&2
      return 1
    fi
  done
  if [[ "${EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY}" != *:*:* ]]; then
    echo "EXECUTION_CONTROL_TEMPORAL_WORKER_IDENTITY must be <env>:<role>:<instance>." >&2
    return 1
  fi
  for temporal_worker_identity_key in \
    EXECUTION_CONTROL_TEMPORAL_WORKFLOW_WORKER_IDENTITY \
    EXECUTION_CONTROL_TEMPORAL_CONTEXT_WORKER_IDENTITY \
    EXECUTION_CONTROL_TEMPORAL_AGENT_WORKER_IDENTITY \
    EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_PLAN_WORKER_IDENTITY \
    EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_RETRIEVAL_WORKER_IDENTITY \
    EXECUTION_CONTROL_TEMPORAL_KNOWLEDGE_SYNTHESIS_WORKER_IDENTITY \
    EXECUTION_CONTROL_TEMPORAL_CAMPUS_SERVICES_WORKER_IDENTITY \
    EXECUTION_CONTROL_TEMPORAL_NOTICE_WORKER_IDENTITY \
    EXECUTION_CONTROL_TEMPORAL_NAVIGATION_WORKER_IDENTITY \
    EXECUTION_CONTROL_TEMPORAL_FINALIZATION_WORKER_IDENTITY; do
    if [[ "${!temporal_worker_identity_key}" != *:*:* ]]; then
      echo "${temporal_worker_identity_key} must be <env>:<role>:<instance>." >&2
      return 1
    fi
  done
  if ! [[ "${EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS}" =~ ^[1-9][0-9]*$ ]]; then
    echo "EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS must be a positive integer." >&2
    return 1
  fi

  if [[ -z "${EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL:-}" ]]; then
    echo "EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL was not projected for primary agent runtime bridge; fix staging env projection." >&2
    return 1
  fi
  if [[ "${EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL}" != http://agent-runtime:27062 ]]; then
    echo "EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL must be http://agent-runtime:27062 for canonical staging runtime." >&2
    return 1
  fi
  if [[ -z "${EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET:-}" ]]; then
    echo "EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET was not projected for primary agent runtime bridge; fix staging env projection." >&2
    return 1
  fi
  if [[ -z "${AGENT_RUNTIME_SHARED_SECRET:-}" ]]; then
    echo "AGENT_RUNTIME_SHARED_SECRET was not projected for primary agent runtime server; fix staging env projection." >&2
    return 1
  fi
  if [[ "${EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET}" != "${AGENT_RUNTIME_SHARED_SECRET}" ]]; then
    echo "EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET and AGENT_RUNTIME_SHARED_SECRET must match." >&2
    return 1
  fi
  if [[ -z "${AGENT_RUNTIME_TOOL_CATALOG_PATH:-}" ]]; then
    echo "AGENT_RUNTIME_TOOL_CATALOG_PATH is required for primary agent runtime tool catalog." >&2
    return 1
  fi
  if [[ -z "${AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL:-}" ]]; then
    echo "AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL is required for primary agent runtime typed tool executor." >&2
    return 1
  fi
  if [[ "${AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL}" != http://execution-control:8000 ]]; then
    echo "AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL must be http://execution-control:8000 for canonical staging runtime." >&2
    return 1
  fi
  if [[ -z "${AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET:-}" ]]; then
    echo "AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET is required for primary agent runtime typed tool executor." >&2
    return 1
  fi
  if [[ "${AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET}" != "${EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET}" ]]; then
    echo "AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET must match EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET." >&2
    return 1
  fi
  if ! [[ "${EXECUTION_CONTROL_AGENT_RUNTIME_TIMEOUT_MS:-30000}" =~ ^[1-9][0-9]*$ ]]; then
    echo "EXECUTION_CONTROL_AGENT_RUNTIME_TIMEOUT_MS must be a positive integer." >&2
    return 1
  fi
  local accepted_temporal_namespaces=(
    campus-agent-staging
    campus-agent-prod
  )
  local temporal_namespace_accepted=0
  local accepted_temporal_namespace
  for accepted_temporal_namespace in "${accepted_temporal_namespaces[@]}"; do
    if [[ "${EXECUTION_CONTROL_TEMPORAL_NAMESPACE}" == "${accepted_temporal_namespace}" ]]; then
      temporal_namespace_accepted=1
    fi
  done
  if (( temporal_namespace_accepted != 1 )); then
    echo "EXECUTION_CONTROL_TEMPORAL_NAMESPACE must be campus-agent-staging or campus-agent-prod." >&2
    return 1
  fi
  case "${EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE}" in
    campus-agent.workflow)
      ;;
    *)
      echo "EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE must be campus-agent.workflow." >&2
      return 1
      ;;
  esac

  if [[ -z "${CAMPUS_SHARED_POSTGRES_URL:-}" ]]; then
    echo "CAMPUS_SHARED_POSTGRES_URL is required after STAGING_INGESTION_SHARED_POSTGRES_URL projection." >&2
    return 1
  fi

  if [[ -z "${DOCUMENT_REGISTRY_DATABASE_URL:-}" ]]; then
    echo "DOCUMENT_REGISTRY_DATABASE_URL is required after staging data-plane projection." >&2
    return 1
  fi

  if [[ -z "${OBJECT_STORE_ENDPOINT:-}" ]]; then
    echo "OBJECT_STORE_ENDPOINT is required for ingestion/agent-worker data-plane projection." >&2
    return 1
  fi

  if [[ -z "${EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ENDPOINT:-}" ]]; then
    echo "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ENDPOINT is required after staging notice body projection." >&2
    return 1
  fi

  if [[ -z "${EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ACCESS_KEY:-}" || -z "${EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_SECRET_KEY:-}" ]]; then
    echo "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_ACCESS_KEY and EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_SECRET_KEY are required after staging notice body projection." >&2
    return 1
  fi

  if [[ -z "${EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_BUCKET:-}" ]]; then
    echo "EXECUTION_CONTROL_NOTICE_BODY_OBJECT_STORE_BUCKET is required after staging notice body projection." >&2
    return 1
  fi

  if [[ -z "${QDRANT_URL:-}" ]]; then
    echo "QDRANT_URL is required after STAGING_INGESTION_QDRANT_URL projection." >&2
    return 1
  fi

  if [[ "${QDRANT_URL}" != http://* && "${QDRANT_URL}" != https://* ]]; then
    echo "QDRANT_URL must use http or https." >&2
    return 1
  fi

  if [[ -z "${QDRANT_QUERY_API_KEY:-}" ]]; then
    echo "QDRANT_QUERY_API_KEY is required after STAGING_INGESTION_QDRANT_READ_ONLY_API_KEY projection." >&2
    return 1
  fi

  if [[ "${QDRANT_URL}" == http://* ]]; then
    case "${QDRANT_URL}" in
      http://qdrant:*|http://127.0.0.1:*|http://localhost:*)
        ;;
      *)
        echo "QDRANT_URL may use http only for the self-hosted internal Qdrant service." >&2
        return 1
        ;;
    esac
  fi

  if [[ "${QDRANT_URL}" == https://* && -z "${QDRANT_TLS_CA_CERT_PATH:-}" ]]; then
    echo "QDRANT_TLS_CA_CERT_PATH is required for HTTPS Qdrant data-plane." >&2
    return 1
  fi
}
