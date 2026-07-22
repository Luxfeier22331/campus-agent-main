package campus.k8s.config_secrets

test_configmap_secret_owned_key_is_rejected if {
	violations := violation with input as {
		"kind": "ConfigMap",
		"metadata": {"name": "unsafe-config"},
		"data": {"OPS_WEB_INTERNAL_TOKEN": "plaintext"},
	}
	"ConfigMap unsafe-config contains secret-owned key OPS_WEB_INTERNAL_TOKEN" in violations
}

test_secret_config_owned_key_is_rejected if {
	violations := violation with input as {
		"kind": "Secret",
		"metadata": {"name": "unsafe-secret"},
		"stringData": {"DEPLOYMENT_ENVIRONMENT": "staging"},
	}
	"Secret unsafe-secret contains config-owned key DEPLOYMENT_ENVIRONMENT" in violations
}

test_safe_configmap_is_allowed if {
	violations := violation with input as {
		"kind": "ConfigMap",
		"metadata": {"name": "safe-config"},
		"data": {"DEPLOYMENT_ENVIRONMENT": "staging"},
	}
	count(violations) == 0
}

test_explicit_config_owned_token_is_allowed_in_configmap if {
	violations := violation with input as {
		"kind": "ConfigMap",
		"metadata": {"name": "dining-config"},
		"data": {"DINING_LARK_BASE_TOKEN": "base-resource-id"},
	}
	count(violations) == 0
}

test_workload_secret_env_from_is_rejected if {
	violations := violation with input as {
		"apiVersion": "apps/v1",
		"kind": "Deployment",
		"metadata": {"name": "unsafe-workload"},
		"spec": {"template": {"spec": {"containers": [{
			"name": "app",
			"envFrom": [{"secretRef": {"name": "broad-secret"}}],
		}]}}},
	}
	"workload unsafe-workload must project Secret broad-secret with explicit secretKeyRef entries" in violations
}

test_workload_explicit_secret_key_ref_is_allowed if {
	violations := violation with input as {
		"apiVersion": "apps/v1",
		"kind": "Deployment",
		"metadata": {"name": "safe-workload"},
		"spec": {"template": {"spec": {"containers": [{
			"name": "app",
			"env": [{
				"name": "API_TOKEN",
				"valueFrom": {"secretKeyRef": {"name": "scoped-secret", "key": "API_TOKEN"}},
			}],
		}]}}},
	}
	count(violations) == 0
}
