package campus.k8s.config_secrets

secret_like_key(key) if {
	regex.match("(?i)(secret|password|api[_-]?key|access[_-]?key|private[_-]?key|auth[_-]?(header|value)|database[_-]?url|dsn|token|salt)", key)
}

environment_prefixed_key(key) if {
	regex.match("^(STAGING|DEV|DEVELOPMENT|PROD|PRODUCTION)_", key)
}

environment_workload(document) if {
	document.kind in {"Deployment", "StatefulSet", "DaemonSet", "Job", "CronJob"}
}

ops_web_automation_origin_consumed if {
	input.kind == "Deployment"
	input.metadata.name == "ops-web"
	template_spec := object.get(
		object.get(object.get(input, "spec", {}), "template", {}),
		"spec",
		{},
	)
	some container in object.get(template_spec, "containers", [])
	container.name == "ops-web"
	some env in object.get(container, "env", [])
	env.name == "OPS_WEB_AUTOMATION_ORIGIN"
	ref := object.get(object.get(env, "valueFrom", {}), "configMapKeyRef", {})
	ref.name == "ops-web-config"
	ref.key == "OPS_WEB_AUTOMATION_ORIGIN"
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
	"AGENT_RUNTIME_AGENT_CONTROL_BASE_URL",
	"MEMORY_SERVICE_BASE_URL",
	"MEMORY_SERVICE_PRIVATE_ORIGIN",
	"DEPLOYMENT_ENVIRONMENT",
	"AGENT_CONTROL_AGENT_RUNTIME_BASE_URL",
	"AGENT_CONTROL_PRODUCT_CALLBACK_BASE_URL",
	"AGENT_CONTROL_TEMPORAL_ADDRESS",
	"AGENT_CONTROL_TEMPORAL_NAMESPACE",
	"HINDSIGHT_API_BASE_URL",
	"QDRANT_TLS_CA_CERT_PATH",
	"QDRANT_URL",
	"RETRIEVAL_BASE_URL",
	"CAMPUS_SEARCH_MODEL_CONFIG_URL",
}

secret_owned_keys := {
	"AGENT_CONTROL_RUNTIME_SHARED_SECRET",
	"APP_API_INTERNAL_SHARED_SECRET",
	"CAMPUS_AGENT_POSTGRES_PASSWORD",
	"AGENT_CONTROL_DATABASE_URL",
	"OPS_WEB_INTERNAL_TOKEN",
	"HINDSIGHT_API_DATABASE_URL",
	"HINDSIGHT_API_EMBEDDINGS_OPENAI_API_KEY",
	"MEMORY_DATABASE_URL",
	"MEMORY_INTERNAL_SHARED_SECRET",
	"HINDSIGHT_API_LLM_API_KEY",
	"HINDSIGHT_API_TENANT_API_KEY",
	"HINDSIGHT_POSTGRES_PASSWORD",
	"HINDSIGHT_OWNER_SALT",
	"QDRANT_API_KEY",
	"QDRANT_READ_ONLY_API_KEY",
	"CAMPUS_SEARCH_DATABASE_URL",
	"RETRIEVAL_INTERNAL_TOKEN",
	"CAMPUS_MCP_CLIENT_TOKENS",
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
	input.kind == "Deployment"
	input.metadata.name == "ops-web"
	not ops_web_automation_origin_consumed
	msg := "Deployment ops-web must consume OPS_WEB_AUTOMATION_ORIGIN from ops-web-config"
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
	input.kind == "ConfigMap"
	key := object.keys(object.get(input, "data", {}))[_]
	environment_prefixed_key(key)
	msg := sprintf("ConfigMap %s key %s must not encode deployment environment", [input.metadata.name, key])
}

violation contains msg if {
	input.kind == "Secret"
	section := {"data", "stringData"}[_]
	key := object.keys(object.get(input, section, {}))[_]
	environment_prefixed_key(key)
	msg := sprintf("Secret %s key %s must not encode deployment environment", [input.metadata.name, key])
}

violation contains msg if {
	environment_workload(input)
	[path, value] := walk(input)
	count(path) >= 4
	path[count(path) - 4] in {"containers", "initContainers"}
	path[count(path) - 2] == "env"
	name := object.get(value, "name", "")
	environment_prefixed_key(name)
	msg := sprintf("%s/%s environment variable %s must not encode deployment environment", [input.kind, input.metadata.name, name])
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
