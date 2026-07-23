package campus.k8s.config_secrets

secret_like_key(key) if {
	regex.match("(?i)(secret|password|api[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?(header|value)|database[_-]?url|dsn|token|salt)", key)
}

provider_profile_keys := {
	"LLM_API_KEY",
	"EMBEDDING_API_KEY",
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
	"DEPLOYMENT_ENVIRONMENT",
	"EXECUTION_CONTROL_AGENT_RUNTIME_BASE_URL",
	"EXECUTION_CONTROL_PRODUCT_CALLBACK_BASE_URL",
	"EXECUTION_CONTROL_TEMPORAL_ADDRESS",
	"EXECUTION_CONTROL_TEMPORAL_NAMESPACE",
	"PERSONAL_MEMORY_BASE_URL",
	"QDRANT_TLS_CA_CERT_PATH",
	"QDRANT_URL",
}

secret_owned_keys := {
	"EXECUTION_AGENT_RUNTIME_SHARED_SECRET",
	"APP_API_EXECUTION_SHARED_SECRET",
	"AXIOM_QUERY_TOKEN",
	"CAMPUS_AGENT_POSTGRES_PASSWORD",
	"CAMPUS_SHARED_POSTGRES_URL",
	"OPS_WEB_INTERNAL_TOKEN",
	"EXECUTION_CONTROL_PROVIDER_CONFIG_ADMIN_DATABASE_URL",
	"EXECUTION_CONTROL_PROVIDER_CONFIG_READER_DATABASE_URL",
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
	not config_owned_keys[key]
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
	[path, value] := walk(input)
	path[_] == "envFrom"
	value.secretRef
	secret_name := object.get(value.secretRef, "name", "<unknown>")
	msg := sprintf("workload %s must project Secret %s with explicit secretKeyRef entries", [input.metadata.name, secret_name])
}

violation contains msg if {
	input.kind == "Secret"
	input.stringData
	key := object.keys(input.stringData)[_]
	provider_profile_keys[key]
	msg := sprintf("provider profile key %s must not be rendered in Secret %s", [key, input.metadata.name])
}
