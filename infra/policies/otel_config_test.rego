package campus.otel.config

valid_gateway := {
	"receivers": {"otlp/agent_trusted": {}, "otlp/hindsight_trusted": {}},
	"extensions": {"basicauth/langfuse": {"client_auth": {
		"username": "${env:LANGFUSE_PUBLIC_KEY}",
		"password": "${env:LANGFUSE_SECRET_KEY}",
	}}},
	"processors": {"transform/trusted_credentials": {
		"error_mode": "propagate",
		"trace_statements": trusted_statements,
	}},
	"exporters": {"otlphttp/langfuse": {"auth": {"authenticator": "basicauth/langfuse"}}},
	"service": {"pipelines": {
		"traces/agent_runtime": {"processors": ["memory_limiter", "resource/campus", "filter/drop_marked", "transform/trusted_credentials", "batch"]},
		"traces/hindsight": {"processors": ["memory_limiter", "resource/campus", "filter/drop_marked", "transform/trusted_credentials", "transform/hindsight_langfuse", "batch"]},
	}},
}

valid_orchestration_gateway := {
	"receivers": {"otlp/orchestration": {}},
	"processors": {"transform/orchestration_langfuse": {
		"error_mode": "propagate",
		"trace_statements": ["keep_keys(span.attributes, [\"grounding_mode\", \"grounding_status\", \"grounding_selected_scopes\", \"grounding_covered_scopes\", \"grounding_candidate_count\", \"grounding_evidence_count\", \"grounding_token_count\", \"grounding_model_context_chars\", \"grounding.embedding_ms\", \"grounding.search_ms\", \"grounding.rerank_ms\", \"grounding.pack_ms\"])"],
	}},
}

test_valid_gateway_is_allowed if {
	violations := violation with input as valid_gateway
	count(violations) == 0
}

test_orchestration_requires_grounding_allowlist if {
	violations := violation with input as valid_orchestration_gateway
	count(violations) == 0
}

test_orchestration_without_grounding_allowlist_is_rejected if {
	config := object.union(valid_orchestration_gateway, {"processors": {"transform/orchestration_langfuse": {
		"error_mode": "propagate",
		"trace_statements": ["keep_keys(span.attributes, [\"step_id\"])"],
	}}})
	violations := violation with input as config
	"orchestration Langfuse pipeline must retain the grounding summary attributes" in violations
}

test_orchestration_without_transform_is_rejected if {
	config := object.remove(valid_orchestration_gateway, ["processors"])
	violations := violation with input as config
	"orchestration Langfuse pipeline must retain the grounding summary attributes" in violations
}

test_missing_sanitizer_is_rejected if {
	config := object.remove(valid_gateway, ["processors"])
	violations := violation with input as config
	"trusted OTLP receivers require the credential sanitizer" in violations
}

test_missing_agent_runtime_pipeline_is_rejected if {
	pipelines := object.remove(valid_gateway.service.pipelines, ["traces/agent_runtime"])
	config_without_service := object.remove(valid_gateway, ["service"])
	config := object.union(config_without_service, {"service": {"pipelines": pipelines}})
	violations := violation with input as config
	"agent runtime Langfuse pipeline must sanitize trusted credentials" in violations
}

test_missing_hindsight_pipeline_is_rejected if {
	pipelines := object.remove(valid_gateway.service.pipelines, ["traces/hindsight"])
	config_without_service := object.remove(valid_gateway, ["service"])
	config := object.union(config_without_service, {"service": {"pipelines": pipelines}})
	violations := violation with input as config
	"Hindsight Langfuse pipeline must sanitize before enrichment" in violations
}

test_prebuilt_header_is_rejected if {
	config := object.union(valid_gateway, {"headers": {"authorization": "${env:OTEL_COLLECTOR_AXIOM_AUTH_HEADER}"}})
	violations := violation with input as config
	"Collector config must not consume prebuilt authorization headers" in violations
}

test_agent_requires_service_account_tls if {
	violations := violation with input as {
		"receivers": {"kubeletstats": {"auth_type": "none", "insecure_skip_verify": true}},
		"processors": {"k8sattributes": {"auth_type": "none"}},
	}
	"kubeletstats must use service account authentication" in violations
	"kubeletstats must verify TLS with the service account CA" in violations
	"kubeletstats must not skip TLS verification" in violations
	"k8sattributes must use service account authentication" in violations
}
