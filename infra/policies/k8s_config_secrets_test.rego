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

test_environment_prefixed_configmap_keys_are_rejected if {
	violations := violation with input as {
		"kind": "ConfigMap",
		"metadata": {"name": "prefixed-config"},
		"data": {
			"STAGING_ENDPOINT": "example",
			"DEV_MODE": "example",
			"DEVELOPMENT_REGION": "example",
			"PROD_HOST": "example",
			"PRODUCTION_PORT": "example",
		},
	}
	count(violations) == 5
}

test_environment_prefixed_secret_keys_are_rejected if {
	violations := violation with input as {
		"kind": "Secret",
		"metadata": {"name": "prefixed-secret"},
		"data": {"STAGING_ENDPOINT": "ZXhhbXBsZQ=="},
		"stringData": {"DEV_MODE": "example"},
	}
	count(violations) == 2
}

environment_prefixed_workloads := {
	"Deployment": {"kind": "Deployment", "metadata": {"name": "deployment"}, "spec": {"template": {"spec": {"containers": [{"name": "app", "env": [{"name": "STAGING_MODE"}]}]}}}},
	"StatefulSet": {"kind": "StatefulSet", "metadata": {"name": "statefulset"}, "spec": {"template": {"spec": {"containers": [{"name": "app", "env": [{"name": "DEV_MODE"}]}]}}}},
	"DaemonSet": {"kind": "DaemonSet", "metadata": {"name": "daemonset"}, "spec": {"template": {"spec": {"initContainers": [{"name": "init", "env": [{"name": "DEVELOPMENT_MODE"}]}], "containers": [{"name": "app"}]}}}},
	"Job": {"kind": "Job", "metadata": {"name": "job"}, "spec": {"template": {"spec": {"containers": [{"name": "app", "env": [{"name": "PROD_MODE"}]}]}}}},
	"CronJob": {"kind": "CronJob", "metadata": {"name": "cronjob"}, "spec": {"jobTemplate": {"spec": {"template": {"spec": {"containers": [{"name": "app", "env": [{"name": "PRODUCTION_MODE"}]}]}}}}}},
}

environment_prefixed_names := {
	"Deployment": "STAGING_MODE",
	"StatefulSet": "DEV_MODE",
	"DaemonSet": "DEVELOPMENT_MODE",
	"Job": "PROD_MODE",
	"CronJob": "PRODUCTION_MODE",
}

test_environment_prefixed_workload_variables_are_rejected if {
	rejected := {kind |
		some kind, document in environment_prefixed_workloads
		violations := violation with input as document
		name := environment_prefixed_names[kind]
		sprintf("%s/%s environment variable %s must not encode deployment environment", [kind, document.metadata.name, name]) in violations
	}
	count(rejected) == 5
}

test_deployment_environment_variable_is_allowed if {
	violations := violation with input as {
		"kind": "Job",
		"metadata": {"name": "allowed-environment"},
		"spec": {"template": {"spec": {"containers": [{
			"name": "app",
			"env": [{"name": "DEPLOYMENT_ENVIRONMENT", "value": "staging"}],
		}]}}},
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
