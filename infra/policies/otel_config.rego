package campus.otel.config

trusted_statements := [
	"delete_matching_keys(span.attributes, \"(?i)(authorization|cookie|credential|jwt|password|secret|api[._-]?key|access[._-]?token|refresh[._-]?token|observability[._-]?canary|(^|[._-])headers?([._-]|$))\")",
	"delete_matching_keys(resource.attributes, \"(?i)(authorization|cookie|credential|jwt|password|secret|api[._-]?key|access[._-]?token|refresh[._-]?token|observability[._-]?canary|(^|[._-])headers?([._-]|$))\")",
	"delete_matching_keys(instrumentation_scope.attributes, \"(?i)(authorization|cookie|credential|jwt|password|secret|api[._-]?key|access[._-]?token|refresh[._-]?token|observability[._-]?canary|(^|[._-])headers?([._-]|$))\")",
]

trusted_config := object.get(object.get(input, "processors", {}), "transform/trusted_credentials", null)

violation contains "trusted OTLP receivers require the credential sanitizer" if {
	object.get(object.get(input, "receivers", {}), "otlp/agent_trusted", null) != null
	trusted_config == null
}

violation contains "credential sanitizer must propagate failures" if {
	trusted_config != null
	object.get(trusted_config, "error_mode", "") != "propagate"
}

violation contains "credential sanitizer statements differ from the declared contract" if {
	trusted_config != null
	object.get(trusted_config, "trace_statements", []) != trusted_statements
}

violation contains "agent runtime Langfuse pipeline must sanitize trusted credentials" if {
	object.get(object.get(input, "receivers", {}), "otlp/agent_trusted", null) != null
	pipeline := object.get(object.get(object.get(input, "service", {}), "pipelines", {}), "traces/agent_runtime", {})
	processors := object.get(pipeline, "processors", [])
	processors != ["memory_limiter", "resource/campus", "filter/drop_marked", "transform/trusted_credentials", "batch"]
}

violation contains "Hindsight Langfuse pipeline must sanitize before enrichment" if {
	object.get(object.get(input, "receivers", {}), "otlp/hindsight_trusted", null) != null
	pipeline := object.get(object.get(object.get(input, "service", {}), "pipelines", {}), "traces/hindsight", {})
	processors := object.get(pipeline, "processors", [])
	processors != ["memory_limiter", "resource/campus", "filter/drop_marked", "transform/trusted_credentials", "transform/hindsight_langfuse", "batch"]
}

violation contains "Langfuse exporter must use the basicauth extension" if {
	exporter := object.get(object.get(input, "exporters", {}), "otlphttp/langfuse", null)
	exporter != null
	object.get(object.get(exporter, "auth", {}), "authenticator", "") != "basicauth/langfuse"
}

violation contains "Langfuse basicauth must derive credentials from canonical keys" if {
	exporter := object.get(object.get(input, "exporters", {}), "otlphttp/langfuse", null)
	exporter != null
	client_auth := object.get(object.get(object.get(input, "extensions", {}), "basicauth/langfuse", {}), "client_auth", {})
	client_auth != {
		"username": "${env:LANGFUSE_PUBLIC_KEY}",
		"password": "${env:LANGFUSE_SECRET_KEY}",
	}
}

violation contains "Collector config must not consume prebuilt authorization headers" if {
	some _, value in walk(input)
	is_string(value)
	regex.match("OTEL_COLLECTOR_(AXIOM|LANGFUSE)_AUTH_HEADER", value)
}

violation contains "kubeletstats must use service account authentication" if {
	receiver := object.get(object.get(input, "receivers", {}), "kubeletstats", null)
	receiver != null
	object.get(receiver, "auth_type", "") != "serviceAccount"
}

violation contains "kubeletstats must verify TLS with the service account CA" if {
	receiver := object.get(object.get(input, "receivers", {}), "kubeletstats", null)
	receiver != null
	object.get(receiver, "ca_file", "") != "/var/run/secrets/kubernetes.io/serviceaccount/ca.crt"
}

violation contains "kubeletstats must not skip TLS verification" if {
	receiver := object.get(object.get(input, "receivers", {}), "kubeletstats", null)
	receiver != null
	object.get(receiver, "insecure_skip_verify", true) != false
}

violation contains "k8sattributes must use service account authentication" if {
	receiver := object.get(object.get(input, "receivers", {}), "kubeletstats", null)
	receiver != null
	processor := object.get(object.get(input, "processors", {}), "k8sattributes", {})
	object.get(processor, "auth_type", "") != "serviceAccount"
}
