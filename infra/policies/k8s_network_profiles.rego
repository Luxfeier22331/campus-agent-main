package campus.k8s.config_secrets

dedicated_profile_key := "campus-agent.muc.wiki/network-policy-profile"

pre_workload_egress_waves := {
	"execution-runtime-platform-egress": "-2",
	"ops-web-database-grants-egress": "-2",
}

ops_web_canonical_labels := {
	"app.kubernetes.io/name": "ops-web",
	"app.kubernetes.io/part-of": "campus-agent",
	"campus-agent.muc.wiki/network-policy-profile": "ops-web",
}

label_key_exists(labels, key) if {
	_ := labels[key]
}

violation contains msg if {
	input.kind == "NetworkPolicy"
	name := object.get(input.metadata, "name", "")
	expected_wave := pre_workload_egress_waves[name]
	annotations := object.get(input.metadata, "annotations", {})
	object.get(annotations, "argocd.argoproj.io/sync-wave", "") != expected_wave
	msg := sprintf("NetworkPolicy %s must be ready in sync wave %s before database hooks", [name, expected_wave])
}

label_has_value(labels, key, value) if {
	labels[key] == value
}

label_has_listed_value(labels, key, values) if {
	value := labels[key]
	some candidate in values
	candidate == value
}

label_expression_matches(expression, labels) if {
	object.get(expression, "operator", "") == "In"
	key := object.get(expression, "key", "")
	label_has_listed_value(labels, key, object.get(expression, "values", []))
}

label_expression_matches(expression, labels) if {
	object.get(expression, "operator", "") == "NotIn"
	key := object.get(expression, "key", "")
	not label_has_listed_value(labels, key, object.get(expression, "values", []))
}

label_expression_matches(expression, labels) if {
	object.get(expression, "operator", "") == "Exists"
	label_key_exists(labels, object.get(expression, "key", ""))
}

label_expression_matches(expression, labels) if {
	object.get(expression, "operator", "") == "DoesNotExist"
	not label_key_exists(labels, object.get(expression, "key", ""))
}

label_selector_match_label_mismatch(selector, labels) if {
	some key, value in object.get(selector, "matchLabels", {})
	not label_has_value(labels, key, value)
}

label_selector_match_expression_mismatch(selector, labels) if {
	some expression in object.get(selector, "matchExpressions", [])
	not label_expression_matches(expression, labels)
}

label_selector_matches(selector, labels) if {
	not label_selector_match_label_mismatch(selector, labels)
	not label_selector_match_expression_mismatch(selector, labels)
}

exact_namespace_peer(peer, key, value) if {
	count(peer) == 1
	selector := peer.namespaceSelector
	count(selector) == 1
	labels := selector.matchLabels
	count(labels) == 1
	labels[key] == value
}

exact_pod_peer(peer, key, value) if {
	count(peer) == 1
	selector := peer.podSelector
	count(selector) == 1
	labels := selector.matchLabels
	count(labels) == 1
	labels[key] == value
}

exact_ip_block_peer(peer, cidr) if {
	count(peer) == 1
	ip_block := peer.ipBlock
	count(ip_block) == 1
	ip_block.cidr == cidr
}

exact_port(allowed_port, protocol, port) if {
	count(allowed_port) == 2
	allowed_port.protocol == protocol
	allowed_port.port == port
}

exact_ops_web_policy_selector(selector) if {
	count(selector) == 1
	labels := selector.matchLabels
	count(labels) == 1
	labels["app.kubernetes.io/name"] == "ops-web"
}

allows_pod(egress, key, value, port) if {
	some rule in egress
	some peer in object.get(rule, "to", [])
	exact_pod_peer(peer, key, value)
	some allowed_port in object.get(rule, "ports", [])
	exact_port(allowed_port, "TCP", port)
}

allows_dns(egress, protocol) if {
	some rule in egress
	some peer in object.get(rule, "to", [])
	exact_namespace_peer(peer, "kubernetes.io/metadata.name", "kube-system")
	some allowed_port in object.get(rule, "ports", [])
	exact_port(allowed_port, protocol, 53)
}

allows_external_https(egress) if {
	some rule in egress
	some peer in object.get(rule, "to", [])
	exact_ip_block_peer(peer, "0.0.0.0/0")
	some allowed_port in object.get(rule, "ports", [])
	exact_port(allowed_port, "TCP", 443)
}

allowed_ops_web_peer_port(peer, allowed_port) if {
	exact_namespace_peer(peer, "kubernetes.io/metadata.name", "kube-system")
	protocol := {"TCP", "UDP"}[_]
	exact_port(allowed_port, protocol, 53)
}

allowed_ops_web_peer_port(peer, allowed_port) if {
	exact_pod_peer(peer, "cnpg.io/cluster", "campus-agent-postgres")
	exact_port(allowed_port, "TCP", 5432)
}

allowed_ops_web_peer_port(peer, allowed_port) if {
	exact_pod_peer(peer, "app.kubernetes.io/name", "execution-control")
	exact_port(allowed_port, "TCP", 8000)
}

allowed_ops_web_peer_port(peer, allowed_port) if {
	exact_pod_peer(peer, "app.kubernetes.io/name", "model-config")
	exact_port(allowed_port, "TCP", 8000)
}

allowed_ops_web_peer_port(peer, allowed_port) if {
	exact_pod_peer(peer, "app.kubernetes.io/name", "ingestion-control")
	exact_port(allowed_port, "TCP", 8000)
}

allowed_ops_web_peer_port(peer, allowed_port) if {
	exact_pod_peer(peer, "app.kubernetes.io/name", "object-store")
	exact_port(allowed_port, "TCP", 9000)
}

allowed_ops_web_peer_port(peer, allowed_port) if {
	exact_pod_peer(peer, "app.kubernetes.io/name", "agent-runtime")
	exact_port(allowed_port, "TCP", 27062)
}

allowed_ops_web_peer_port(peer, allowed_port) if {
	exact_ip_block_peer(peer, "0.0.0.0/0")
	exact_port(allowed_port, "TCP", 443)
}

network_policy_has_allow_rules(spec) if {
	count(object.get(spec, "ingress", [])) > 0
}

network_policy_has_allow_rules(spec) if {
	count(object.get(spec, "egress", [])) > 0
}

ops_web_egress_rule_without_destination(egress) if {
	some rule in egress
	count(object.get(rule, "to", [])) == 0
}

ops_web_egress_rule_without_port(egress) if {
	some rule in egress
	count(object.get(rule, "ports", [])) == 0
}

ops_web_egress_has_invalid_peer_port(egress) if {
	some rule in egress
	some peer in object.get(rule, "to", [])
	some allowed_port in object.get(rule, "ports", [])
	not allowed_ops_web_peer_port(peer, allowed_port)
}

ops_web_egress_allowlist_is_complete(egress) if {
	count(egress) == 8
	not ops_web_egress_rule_without_destination(egress)
	not ops_web_egress_rule_without_port(egress)
	not ops_web_egress_has_invalid_peer_port(egress)
	allows_dns(egress, "UDP")
	allows_dns(egress, "TCP")
	allows_pod(egress, "cnpg.io/cluster", "campus-agent-postgres", 5432)
	allows_pod(egress, "app.kubernetes.io/name", "execution-control", 8000)
	allows_pod(egress, "app.kubernetes.io/name", "model-config", 8000)
	allows_pod(egress, "app.kubernetes.io/name", "ingestion-control", 8000)
	allows_pod(egress, "app.kubernetes.io/name", "object-store", 9000)
	allows_pod(egress, "app.kubernetes.io/name", "agent-runtime", 27062)
	allows_external_https(egress)
}

validated_ops_web_egress_policy(policy) if {
	policy.kind == "NetworkPolicy"
	object.get(policy.metadata, "name", "") == "ops-web-egress"
	spec := object.get(policy, "spec", {})
	exact_ops_web_policy_selector(object.get(spec, "podSelector", {}))
	object.get(spec, "policyTypes", []) == ["Egress"]
	count(object.get(spec, "ingress", [])) == 0
	ops_web_egress_allowlist_is_complete(object.get(spec, "egress", []))
}

violation contains msg if {
	input.kind == "NetworkPolicy"
	spec := object.get(input, "spec", {})
	network_policy_has_allow_rules(spec)
	label_selector_matches(object.get(spec, "podSelector", {}), ops_web_canonical_labels)
	not validated_ops_web_egress_policy(input)
	msg := sprintf("NetworkPolicy %s selects dedicated ops-web and must exclude its network policy profile", [input.metadata.name])
}

violation contains msg if {
	input.kind == "Deployment"
	input.metadata.name == "ops-web"
	template := object.get(input.spec, "template", {})
	metadata := object.get(template, "metadata", {})
	labels := object.get(metadata, "labels", {})
	object.get(labels, dedicated_profile_key, "") != "ops-web"
	msg := "Deployment ops-web must use the dedicated ops-web network policy profile"
}

violation contains msg if {
	input.kind == "NetworkPolicy"
	input.metadata.name == "ops-web-egress"
	selector := object.get(input.spec, "podSelector", {})
	not exact_ops_web_policy_selector(selector)
	msg := "NetworkPolicy ops-web-egress must select only ops-web"
}

violation contains msg if {
	input.kind == "NetworkPolicy"
	input.metadata.name == "ops-web-egress"
	object.get(input.spec, "policyTypes", []) != ["Egress"]
	msg := "NetworkPolicy ops-web-egress policyTypes must be exactly Egress"
}

violation contains msg if {
	input.kind == "NetworkPolicy"
	input.metadata.name == "ops-web-egress"
	egress := object.get(input.spec, "egress", [])
	count(egress) != 8
	msg := "NetworkPolicy ops-web-egress must contain exactly eight dependency rules"
}

violation contains msg if {
	input.kind == "NetworkPolicy"
	input.metadata.name == "ops-web-egress"
	some rule in object.get(input.spec, "egress", [])
	count(object.get(rule, "to", [])) == 0
	msg := "NetworkPolicy ops-web-egress rules must not allow every destination"
}

violation contains msg if {
	input.kind == "NetworkPolicy"
	input.metadata.name == "ops-web-egress"
	some rule in object.get(input.spec, "egress", [])
	count(object.get(rule, "ports", [])) == 0
	msg := "NetworkPolicy ops-web-egress rules must not allow every port"
}

violation contains msg if {
	input.kind == "NetworkPolicy"
	input.metadata.name == "ops-web-egress"
	some rule in object.get(input.spec, "egress", [])
	some peer in object.get(rule, "to", [])
	some allowed_port in object.get(rule, "ports", [])
	not allowed_ops_web_peer_port(peer, allowed_port)
	msg := "NetworkPolicy ops-web-egress contains a destination or port outside its dependency allowlist"
}

violation contains msg if {
	input.kind == "NetworkPolicy"
	input.metadata.name == "ops-web-egress"
	egress := object.get(input.spec, "egress", [])
	not allows_dns(egress, "UDP")
	msg := "NetworkPolicy ops-web-egress must allow kube-system UDP DNS"
}

violation contains msg if {
	input.kind == "NetworkPolicy"
	input.metadata.name == "ops-web-egress"
	egress := object.get(input.spec, "egress", [])
	not allows_dns(egress, "TCP")
	msg := "NetworkPolicy ops-web-egress must allow kube-system TCP DNS"
}

violation contains msg if {
	input.kind == "NetworkPolicy"
	input.metadata.name == "ops-web-egress"
	egress := object.get(input.spec, "egress", [])
	not allows_pod(egress, "cnpg.io/cluster", "campus-agent-postgres", 5432)
	msg := "NetworkPolicy ops-web-egress must allow the campus-agent PostgreSQL pods on TCP 5432"
}

violation contains msg if {
	input.kind == "NetworkPolicy"
	input.metadata.name == "ops-web-egress"
	egress := object.get(input.spec, "egress", [])
	not allows_pod(egress, "app.kubernetes.io/name", "execution-control", 8000)
	msg := "NetworkPolicy ops-web-egress must allow execution-control on TCP 8000"
}

violation contains msg if {
	input.kind == "NetworkPolicy"
	input.metadata.name == "ops-web-egress"
	egress := object.get(input.spec, "egress", [])
	not allows_pod(egress, "app.kubernetes.io/name", "model-config", 8000)
	msg := "NetworkPolicy ops-web-egress must allow model-config on TCP 8000"
}

violation contains msg if {
	input.kind == "NetworkPolicy"
	input.metadata.name == "ops-web-egress"
	egress := object.get(input.spec, "egress", [])
	not allows_pod(egress, "app.kubernetes.io/name", "ingestion-control", 8000)
	msg := "NetworkPolicy ops-web-egress must allow ingestion-control on TCP 8000"
}

violation contains msg if {
	input.kind == "NetworkPolicy"
	input.metadata.name == "ops-web-egress"
	egress := object.get(input.spec, "egress", [])
	not allows_pod(egress, "app.kubernetes.io/name", "object-store", 9000)
	msg := "NetworkPolicy ops-web-egress must allow object-store on TCP 9000"
}

violation contains msg if {
	input.kind == "NetworkPolicy"
	input.metadata.name == "ops-web-egress"
	egress := object.get(input.spec, "egress", [])
	not allows_pod(egress, "app.kubernetes.io/name", "agent-runtime", 27062)
	msg := "NetworkPolicy ops-web-egress must allow agent-runtime on TCP 27062"
}

violation contains msg if {
	input.kind == "NetworkPolicy"
	input.metadata.name == "ops-web-egress"
	egress := object.get(input.spec, "egress", [])
	not allows_external_https(egress)
	msg := "NetworkPolicy ops-web-egress must allow external HTTPS on TCP 443"
}
