package campus.k8s.config_secrets

secret_like_key(key) if {
	regex.match("(?i)(secret|password|api[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?(header|value)|database[_-]?url|dsn|token|salt)", key)
}

retired_secret_names := {
	"execution-runtime-common-secrets",
	"execution-runtime-secrets",
	"notice-tool-secrets",
	"qdrant-admin-secrets",
}

provider_profile_keys := {
	"LLM_API_KEY",
	"EMBEDDING_API_KEY",
	"RERANK_API_KEY",
	"PUBLIC_WEB_SEARCH_API_KEY",
	"OPENAI_API_KEY",
	"ANTHROPIC_API_KEY",
	"GOOGLE_API_KEY",
	"GEMINI_API_KEY",
	"PERPLEXITY_API_KEY",
	"TAVILY_API_KEY",
	"EXA_API_KEY",
}

config_owned_keys := {
	"AGENT_RUNTIME_EXECUTION_CONTROL_BASE_URL",
	"AGENT_RUNTIME_HOST",
	"AGENT_RUNTIME_PORT",
	"AGENT_RUNTIME_TOOL_REGISTRY_PATH",
	"DEPLOYMENT_ENVIRONMENT",
	"EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL",
	"EXECUTION_CONTROL_AGENT_RUNTIME_TIMEOUT_MS",
	"EXECUTION_CONTROL_APP_API_BASE_URL",
	"EXECUTION_CONTROL_APP_API_INTERNAL_TIMEOUT_MS",
	"EXECUTION_CONTROL_PROVIDER_CONFIG_SNAPSHOT_PATH",
	"EXECUTION_CONTROL_RUNTIME_CONFIG_PATH",
	"EXECUTION_CONTROL_RUNTIME_MODE",
	"EXECUTION_CONTROL_RUNTIME_RELEASE",
	"EXECUTION_CONTROL_RUN_PROJECTION_AUTO_MIGRATE",
	"EXECUTION_CONTROL_TEMPORAL_ADDRESS",
	"EXECUTION_CONTROL_TEMPORAL_NAMESPACE",
	"EXECUTION_CONTROL_TEMPORAL_START_TIMEOUT_MS",
	"EXECUTION_CONTROL_TEMPORAL_TASK_QUEUE",
	"PERSONAL_MEMORY_BASE_URL",
	"QDRANT_TIMEOUT_SECONDS",
	"QDRANT_TLS_CA_CERT_PATH",
	"QDRANT_URL",
}

secret_owned_keys := {
	"AGENT_RUNTIME_EXECUTION_CONTROL_SHARED_SECRET",
	"AGENT_RUNTIME_SHARED_SECRET",
	"API_WORKER_SHARED_SECRET",
	"CAMPUS_AGENT_POSTGRES_PASSWORD",
	"CAMPUS_SHARED_POSTGRES_URL",
	"EXECUTION_CONTROL_AGENT_RUNTIME_SHARED_SECRET",
	"EXECUTION_CONTROL_APP_API_INTERNAL_SHARED_SECRET",
	"EXECUTION_CONTROL_INTERNAL_QUERY_SHARED_SECRET",
	"EXECUTION_CONTROL_METRICS_BEARER_TOKEN",
	"EXECUTION_CONTROL_OTEL_EXPORTER_OTLP_HEADERS",
	"EXECUTION_CONTROL_RUN_PROJECTION_DATABASE_URL",
	"HINDSIGHT_API_DATABASE_URL",
	"HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY",
	"HINDSIGHT_API_LLM_API_KEY",
	"HINDSIGHT_API_TENANT_API_KEY",
	"HINDSIGHT_POSTGRES_PASSWORD",
	"PERSONAL_MEMORY_API_SECRET",
	"PERSONAL_MEMORY_OWNER_SALT",
	"QDRANT_API_KEY",
	"QDRANT_QUERY_API_KEY",
	"QDRANT_READ_ONLY_API_KEY",
	"TEMPORAL_POSTGRES_PASSWORD",
}

violation contains msg if {
	input.kind == "ConfigMap"
	input.data
	key := object.keys(input.data)[_]
	secret_like_key(key)
	msg := sprintf("ConfigMap %s contains secret-like key %s", [input.metadata.name, key])
}

violation contains msg if {
	input.kind == "ConfigMap"
	input.data
	key := object.keys(input.data)[_]
	secret_owned_keys[key]
	msg := sprintf("ConfigMap %s contains secret-owned key %s", [input.metadata.name, key])
}

violation contains msg if {
	input.kind == "Secret"
	input.data
	key := object.keys(input.data)[_]
	config_owned_keys[key]
	msg := sprintf("Secret %s contains config-owned key %s", [input.metadata.name, key])
}

violation contains msg if {
	input.kind == "Secret"
	input.stringData
	key := object.keys(input.stringData)[_]
	config_owned_keys[key]
	msg := sprintf("Secret %s contains config-owned key %s", [input.metadata.name, key])
}

violation contains msg if {
	input.kind == "Secret"
	retired_secret_names[input.metadata.name]
	msg := sprintf("retired Secret %s must not be rendered", [input.metadata.name])
}

violation contains msg if {
	input.kind == "ConfigMap"
	input.data
	key := object.keys(input.data)[_]
	provider_profile_keys[key]
	msg := sprintf("provider profile key %s must not be rendered in ConfigMap %s", [key, input.metadata.name])
}

violation contains msg if {
	input.kind == "Secret"
	input.data
	key := object.keys(input.data)[_]
	provider_profile_keys[key]
	msg := sprintf("provider profile key %s must not be rendered in Secret %s", [key, input.metadata.name])
}

violation contains msg if {
	input.kind == "Secret"
	input.stringData
	key := object.keys(input.stringData)[_]
	provider_profile_keys[key]
	msg := sprintf("provider profile key %s must not be rendered in Secret %s", [key, input.metadata.name])
}
