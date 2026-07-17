package campus.k8s.config_secrets

test_configmap_secret_owned_key_is_rejected if {
	violations := violation with input as {
		"kind": "ConfigMap",
		"metadata": {"name": "unsafe-config"},
		"data": {"EXECUTION_CONTROL_PROVIDER_CONFIG_ADMIN_COMMAND_TOKEN": "plaintext"},
	}
	"ConfigMap unsafe-config contains secret-owned key EXECUTION_CONTROL_PROVIDER_CONFIG_ADMIN_COMMAND_TOKEN" in violations
}

test_secret_config_owned_key_is_rejected if {
	violations := violation with input as {
		"kind": "Secret",
		"metadata": {"name": "unsafe-secret"},
		"stringData": {"EXECUTION_CONTROL_RUNTIME_MODE": "staging"},
	}
	"Secret unsafe-secret contains config-owned key EXECUTION_CONTROL_RUNTIME_MODE" in violations
}

test_safe_configmap_is_allowed if {
	violations := violation with input as {
		"kind": "ConfigMap",
		"metadata": {"name": "safe-config"},
		"data": {"EXECUTION_CONTROL_RUNTIME_MODE": "staging"},
	}
	count(violations) == 0
}
