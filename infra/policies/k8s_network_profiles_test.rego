package campus.k8s.config_secrets

test_pre_workload_egress_policy_requires_earlier_wave if {
	violations := violation with input as {
		"kind": "NetworkPolicy",
		"metadata": {"name": "execution-runtime-platform-egress"},
	}
	"NetworkPolicy execution-runtime-platform-egress must be ready in sync wave -2 before database hooks" in violations
}

test_pre_workload_egress_policy_accepts_declared_wave if {
	violations := violation with input as {
		"kind": "NetworkPolicy",
		"metadata": {
			"name": "ops-web-database-grants-egress",
			"annotations": {"argocd.argoproj.io/sync-wave": "-2"},
		},
	}
	count(violations) == 0
}

allowing_network_policy(name, selector) := policy if {
	policy := {
		"kind": "NetworkPolicy",
		"metadata": {"name": name},
		"spec": {
			"egress": [{}],
			"podSelector": selector,
		},
	}
}

valid_ops_web_egress_policy := {
	"kind": "NetworkPolicy",
	"metadata": {"name": "ops-web-egress"},
	"spec": {
		"podSelector": {"matchLabels": {"app.kubernetes.io/name": "ops-web"}},
		"policyTypes": ["Egress"],
		"egress": [
			{
				"to": [{"namespaceSelector": {"matchLabels": {"kubernetes.io/metadata.name": "kube-system"}}}],
				"ports": [
					{"protocol": "UDP", "port": 53},
					{"protocol": "TCP", "port": 53},
				],
			},
			{
				"to": [{"podSelector": {"matchLabels": {"cnpg.io/cluster": "campus-agent-postgres"}}}],
				"ports": [{"protocol": "TCP", "port": 5432}],
			},
			{
				"to": [{"podSelector": {"matchLabels": {"app.kubernetes.io/name": "agent-control"}}}],
				"ports": [{"protocol": "TCP", "port": 8000}],
			},
			{
				"to": [{"podSelector": {"matchLabels": {"app.kubernetes.io/name": "model-config"}}}],
				"ports": [{"protocol": "TCP", "port": 8000}],
			},
			{
				"to": [{"podSelector": {"matchLabels": {"app.kubernetes.io/name": "object-store"}}}],
				"ports": [{"protocol": "TCP", "port": 9000}],
			},
			{
				"to": [{"podSelector": {"matchLabels": {"app.kubernetes.io/name": "agent-runtime-worker"}}}],
				"ports": [{"protocol": "TCP", "port": 8000}],
			},
			{
				"to": [{"podSelector": {"matchLabels": {"app.kubernetes.io/part-of": "temporal"}}}],
				"ports": [{"protocol": "TCP", "port": 7233}],
			},
			{
				"to": [{"ipBlock": {"cidr": "0.0.0.0/0"}}],
				"ports": [
					{"protocol": "TCP", "port": 443},
					{"protocol": "TCP", "port": 6443},
				],
			},
		],
	},
}

ops_web_policy_with_external_rule(peer, allowed_port) := policy if {
	egress := array.concat(
		array.slice(valid_ops_web_egress_policy.spec.egress, 0, 7),
		[{"to": [peer], "ports": [allowed_port]}],
	)
	policy := object.union(valid_ops_web_egress_policy, {"spec": object.union(valid_ops_web_egress_policy.spec, {"egress": egress})})
}

test_match_labels_policy_selecting_ops_web_without_profile_exclusion_is_rejected if {
	policy := allowing_network_policy(
		"future-campus-agent-wide-egress",
		{"matchLabels": {"app.kubernetes.io/part-of": "campus-agent"}},
	)
	violations := violation with input as policy
	"NetworkPolicy future-campus-agent-wide-egress selects dedicated ops-web and must exclude its network policy profile" in violations
}

test_match_labels_policy_with_dedicated_profile_exclusion_is_allowed if {
	policy := allowing_network_policy(
		"future-campus-agent-wide-egress",
		{
			"matchLabels": {"app.kubernetes.io/part-of": "campus-agent"},
			"matchExpressions": [{
				"key": "campus-agent.muc.wiki/network-policy-profile",
				"operator": "DoesNotExist",
			}],
		},
	)
	violations := violation with input as policy
	count(violations) == 0
}

test_empty_pod_selector_with_allow_rule_is_rejected if {
	policy := allowing_network_policy("future-namespace-wide-egress", {})
	violations := violation with input as policy
	"NetworkPolicy future-namespace-wide-egress selects dedicated ops-web and must exclude its network policy profile" in violations
}

test_empty_pod_selector_without_allow_rule_is_allowed if {
	violations := violation with input as {
		"kind": "NetworkPolicy",
		"metadata": {"name": "future-default-deny"},
		"spec": {"podSelector": {}},
	}
	count(violations) == 0
}

test_in_expression_selecting_campus_agent_is_rejected if {
	policy := allowing_network_policy("future-in-egress", {"matchExpressions": [{
		"key": "app.kubernetes.io/part-of",
		"operator": "In",
		"values": ["campus-agent"],
	}]})
	violations := violation with input as policy
	"NetworkPolicy future-in-egress selects dedicated ops-web and must exclude its network policy profile" in violations
}

test_in_expression_not_selecting_ops_web_is_allowed if {
	policy := allowing_network_policy("future-in-other-egress", {"matchExpressions": [{
		"key": "app.kubernetes.io/name",
		"operator": "In",
		"values": ["another-app"],
	}]})
	violations := violation with input as policy
	count(violations) == 0
}

test_not_in_expression_excluding_ops_web_profile_is_allowed if {
	policy := allowing_network_policy("future-not-in-egress", {"matchExpressions": [{
		"key": "campus-agent.muc.wiki/network-policy-profile",
		"operator": "NotIn",
		"values": ["ops-web"],
	}]})
	violations := violation with input as policy
	count(violations) == 0
}

test_not_in_expression_with_other_value_still_selects_ops_web if {
	policy := allowing_network_policy("future-not-in-other-egress", {"matchExpressions": [{
		"key": "campus-agent.muc.wiki/network-policy-profile",
		"operator": "NotIn",
		"values": ["another-profile"],
	}]})
	violations := violation with input as policy
	"NetworkPolicy future-not-in-other-egress selects dedicated ops-web and must exclude its network policy profile" in violations
}

test_not_in_expression_matches_when_label_key_is_absent if {
	policy := allowing_network_policy("future-not-in-absent-egress", {"matchExpressions": [{
		"key": "example.invalid/absent",
		"operator": "NotIn",
		"values": ["blocked"],
	}]})
	violations := violation with input as policy
	"NetworkPolicy future-not-in-absent-egress selects dedicated ops-web and must exclude its network policy profile" in violations
}

test_exists_expression_selecting_ops_web_profile_is_rejected if {
	policy := allowing_network_policy("future-exists-egress", {"matchExpressions": [{
		"key": "campus-agent.muc.wiki/network-policy-profile",
		"operator": "Exists",
	}]})
	violations := violation with input as policy
	"NetworkPolicy future-exists-egress selects dedicated ops-web and must exclude its network policy profile" in violations
}

test_exists_expression_for_absent_label_is_allowed if {
	policy := allowing_network_policy("future-exists-absent-egress", {"matchExpressions": [{
		"key": "example.invalid/absent",
		"operator": "Exists",
	}]})
	violations := violation with input as policy
	count(violations) == 0
}

test_does_not_exist_expression_excluding_ops_web_profile_is_allowed if {
	policy := allowing_network_policy("future-does-not-exist-egress", {"matchExpressions": [{
		"key": "campus-agent.muc.wiki/network-policy-profile",
		"operator": "DoesNotExist",
	}]})
	violations := violation with input as policy
	count(violations) == 0
}

test_does_not_exist_expression_for_absent_label_still_selects_ops_web if {
	policy := allowing_network_policy("future-does-not-exist-absent-egress", {"matchExpressions": [{
		"key": "example.invalid/absent",
		"operator": "DoesNotExist",
	}]})
	violations := violation with input as policy
	"NetworkPolicy future-does-not-exist-absent-egress selects dedicated ops-web and must exclude its network policy profile" in violations
}

test_ops_web_without_dedicated_profile_is_rejected if {
	violations := violation with input as {
		"kind": "Deployment",
		"metadata": {"name": "ops-web"},
		"spec": {"template": {"metadata": {"labels": {
			"app.kubernetes.io/name": "ops-web",
			"app.kubernetes.io/part-of": "campus-agent",
		}}}},
	}
	"Deployment ops-web must use the dedicated ops-web network policy profile" in violations
}

test_ops_web_internal_peer_cannot_add_namespace_selector if {
	violations := violation with input as {
		"kind": "NetworkPolicy",
		"metadata": {"name": "ops-web-egress"},
		"spec": {
			"egress": [{
				"to": [{
					"namespaceSelector": {},
					"podSelector": {"matchLabels": {"app.kubernetes.io/name": "agent-control"}},
				}],
				"ports": [{"protocol": "TCP", "port": 8000}],
			}],
			"podSelector": {"matchLabels": {"app.kubernetes.io/name": "ops-web"}},
		},
	}
	"NetworkPolicy ops-web-egress contains a destination or port outside its dependency allowlist" in violations
}

test_ops_web_dns_peer_cannot_add_pod_selector if {
	violations := violation with input as {
		"kind": "NetworkPolicy",
		"metadata": {"name": "ops-web-egress"},
		"spec": {
			"egress": [{
				"to": [{
					"namespaceSelector": {"matchLabels": {"kubernetes.io/metadata.name": "kube-system"}},
					"podSelector": {},
				}],
				"ports": [{"protocol": "UDP", "port": 53}],
			}],
			"podSelector": {"matchLabels": {"app.kubernetes.io/name": "ops-web"}},
		},
	}
	"NetworkPolicy ops-web-egress contains a destination or port outside its dependency allowlist" in violations
}

test_ops_web_port_cannot_add_end_port if {
	violations := violation with input as {
		"kind": "NetworkPolicy",
		"metadata": {"name": "ops-web-egress"},
		"spec": {
			"egress": [{
				"to": [{"podSelector": {"matchLabels": {"app.kubernetes.io/name": "agent-control"}}}],
				"ports": [{"endPort": 8001, "protocol": "TCP", "port": 8000}],
			}],
			"podSelector": {"matchLabels": {"app.kubernetes.io/name": "ops-web"}},
		},
	}
	"NetworkPolicy ops-web-egress contains a destination or port outside its dependency allowlist" in violations
}

test_ops_web_external_egress_is_required if {
	policy := object.union(valid_ops_web_egress_policy, {"spec": object.union(valid_ops_web_egress_policy.spec, {"egress": array.slice(valid_ops_web_egress_policy.spec.egress, 0, 7)})})
	violations := violation with input as policy
	"NetworkPolicy ops-web-egress must allow external HTTPS on TCP 443" in violations
}

test_ops_web_kubernetes_api_egress_is_required if {
	policy := object.union(valid_ops_web_egress_policy, {"spec": object.union(valid_ops_web_egress_policy.spec, {"egress": array.concat(
		array.slice(valid_ops_web_egress_policy.spec.egress, 0, 7),
		[{
			"to": [{"ipBlock": {"cidr": "0.0.0.0/0"}}],
			"ports": [{"protocol": "TCP", "port": 443}],
		}],
	)})})
	violations := violation with input as policy
	"NetworkPolicy ops-web-egress must allow the Kubernetes API backend on TCP 6443" in violations
}

test_ops_web_agent_runtime_egress_is_required if {
	egress := array.concat(
		array.slice(valid_ops_web_egress_policy.spec.egress, 0, 5),
		array.slice(valid_ops_web_egress_policy.spec.egress, 6, 8),
	)
	policy := object.union(valid_ops_web_egress_policy, {"spec": object.union(valid_ops_web_egress_policy.spec, {"egress": egress})})
	violations := violation with input as policy
	"NetworkPolicy ops-web-egress must allow agent-runtime on TCP 8000" in violations
}

test_ops_web_object_store_egress_is_required if {
	egress := array.concat(
		array.slice(valid_ops_web_egress_policy.spec.egress, 0, 4),
		array.slice(valid_ops_web_egress_policy.spec.egress, 5, 8),
	)
	policy := object.union(valid_ops_web_egress_policy, {"spec": object.union(valid_ops_web_egress_policy.spec, {"egress": egress})})
	violations := violation with input as policy
	"NetworkPolicy ops-web-egress must allow object-store on TCP 9000" in violations
}

test_ops_web_external_egress_cannot_use_http if {
	policy := ops_web_policy_with_external_rule(
		{"ipBlock": {"cidr": "0.0.0.0/0"}},
		{"protocol": "TCP", "port": 80},
	)
	violations := violation with input as policy
	"NetworkPolicy ops-web-egress contains a destination or port outside its dependency allowlist" in violations
}

test_ops_web_external_egress_must_use_tcp if {
	policy := ops_web_policy_with_external_rule(
		{"ipBlock": {"cidr": "0.0.0.0/0"}},
		{"protocol": "UDP", "port": 443},
	)
	violations := violation with input as policy
	"NetworkPolicy ops-web-egress contains a destination or port outside its dependency allowlist" in violations
}

test_ops_web_external_egress_cannot_change_cidr if {
	policy := ops_web_policy_with_external_rule(
		{"ipBlock": {"cidr": "203.0.113.0/24"}},
		{"protocol": "TCP", "port": 443},
	)
	violations := violation with input as policy
	"NetworkPolicy ops-web-egress contains a destination or port outside its dependency allowlist" in violations
}

test_ops_web_external_egress_cannot_add_ip_block_except if {
	policy := ops_web_policy_with_external_rule(
		{"ipBlock": {"cidr": "0.0.0.0/0", "except": ["10.0.0.0/8"]}},
		{"protocol": "TCP", "port": 443},
	)
	violations := violation with input as policy
	"NetworkPolicy ops-web-egress contains a destination or port outside its dependency allowlist" in violations
}

test_ops_web_egress_policy_cannot_disable_egress_policy_type if {
	violations := violation with input as {
		"kind": "NetworkPolicy",
		"metadata": {"name": "ops-web-egress"},
		"spec": {
			"egress": [],
			"podSelector": {"matchLabels": {"app.kubernetes.io/name": "ops-web"}},
			"policyTypes": ["Ingress"],
		},
	}
	"NetworkPolicy ops-web-egress policyTypes must be exactly Egress" in violations
}

test_ops_web_egress_policy_cannot_exclude_its_profile_from_target_selector if {
	violations := violation with input as {
		"kind": "NetworkPolicy",
		"metadata": {"name": "ops-web-egress"},
		"spec": {
			"egress": [],
			"podSelector": {
				"matchExpressions": [{
					"key": "campus-agent.muc.wiki/network-policy-profile",
					"operator": "DoesNotExist",
				}],
				"matchLabels": {"app.kubernetes.io/name": "ops-web"},
			},
			"policyTypes": ["Egress"],
		},
	}
	"NetworkPolicy ops-web-egress must select only ops-web" in violations
}

test_validated_ops_web_egress_is_the_explicit_safe_exception if {
	violations := violation with input as valid_ops_web_egress_policy
	count(violations) == 0
}

test_ops_web_egress_name_alone_cannot_bypass_selector_guard if {
	policy := allowing_network_policy(
		"ops-web-egress",
		{"matchLabels": {"app.kubernetes.io/name": "ops-web"}},
	)
	violations := violation with input as policy
	"NetworkPolicy ops-web-egress selects dedicated ops-web and must exclude its network policy profile" in violations
}

test_copy_of_validated_allowlist_without_reserved_name_is_rejected if {
	policy := object.union(valid_ops_web_egress_policy, {"metadata": {"name": "ops-web-egress-copy"}})
	violations := violation with input as policy
	"NetworkPolicy ops-web-egress-copy selects dedicated ops-web and must exclude its network policy profile" in violations
}

test_ops_pipeline_ingress_accepts_exact_worker if {
	policy := {"kind": "NetworkPolicy", "metadata": {"name": "ops-web-notice-pipeline-ingress"}, "spec": {
		"podSelector": {"matchLabels": {"app.kubernetes.io/name": "ops-web"}}, "policyTypes": ["Ingress"],
		"ingress": [{"from": [{"podSelector": {"matchLabels": {"app.kubernetes.io/name": "notice-pipeline-worker"}}}], "ports": [{"protocol": "TCP", "port": 5178}]}],
	}}
	violations := violation with input as policy
	count(violations) == 0
}

test_ops_pipeline_ingress_rejects_broad_peer if {
	policy := {"kind": "NetworkPolicy", "metadata": {"name": "ops-web-notice-pipeline-ingress"}, "spec": {
		"podSelector": {"matchLabels": {"app.kubernetes.io/name": "ops-web"}}, "policyTypes": ["Ingress"],
		"ingress": [{"from": [{"podSelector": {}}], "ports": [{"protocol": "TCP", "port": 5178}]}],
	}}
	violations := violation with input as policy
	count(violations) > 0
}

test_ops_web_requires_temporal_dependency if {
	rules := [rule | some rule in valid_ops_web_egress_policy.spec.egress; not allows_pod([rule], "app.kubernetes.io/part-of", "temporal", 7233)]
	spec := object.union(valid_ops_web_egress_policy.spec, {"egress": rules})
	policy := object.union(valid_ops_web_egress_policy, {"spec": spec})
	violations := violation with input as policy
	"NetworkPolicy ops-web-egress must allow Temporal on TCP 7233" in violations
}
